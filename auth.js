import { AUTH_BASE_URL } from "./config.js";
import { storage } from "./storage.js";

/**
 * Wraps the platform's ISOLATED Budget authentication boundary
 * (`workers/auth/src/budget-auth.ts` in the Home Base repo) — the SAME
 * bearer-only flow the Android app uses, not Better Auth's generic
 * cookie-based sign-in (which Heavy Machinery's web app uses). Deliberately
 * NOT reused here: passes 8-12 rebuilt Budget's auth specifically so that no
 * shared/generic session can ever be upgraded into Budget authority, and
 * copying HM's cookie-based pattern would have quietly reopened exactly that.
 *
 * Every call is a plain Bearer exchange — no cookies anywhere, so
 * `credentials` is never set on these fetches and the server never issues
 * `Access-Control-Allow-Credentials` for this origin (see workers/auth/src/
 * index.ts's CORS comment). A fresh password + TOTP login is required every
 * time to mint a new, isolated, Budget-only session:
 *
 * 1. `POST /api/auth/budget/start` — email + password. Creates a 10-minute,
 *    failure-limited login challenge. Nothing else exists yet.
 * 2. `POST /api/auth/budget/verify-totp` — Bearer <challenge> + the 6-digit
 *    code. On success, returns a new 30-day Budget session token.
 * 3. `POST /api/auth/budget/token` — Bearer <session token>. Returns a fresh
 *    15-minute, budget-audience-only JWT. Call again whenever the cached one
 *    is near expiry.
 * 4. `POST /api/auth/budget/logout` — Bearer <session token>. Revokes it.
 */

export class AuthError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function bodyOrThrow(response, fallbackMessage) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // no JSON body — fall through to the generic message
  }
  if (!response.ok) {
    throw new AuthError(body?.error || fallbackMessage, response.status);
  }
  return body;
}

// Carries state between startLogin() and verifyTotp() — module-level, not
// persisted (a page reload mid-login should just restart the login, not try
// to resume a half-finished challenge). Only cleared on a SUCCESSFUL
// verifyTotp() — a wrong code leaves it intact so the user can retype and
// retry against the same challenge (the server tracks the failure count
// itself and locks the challenge after 5 wrong codes).
let pendingChallenge = null;

export async function startLogin(email, password) {
  const response = await fetch(`${AUTH_BASE_URL}/api/auth/budget/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await bodyOrThrow(response, "Sign-in failed — check your email and password.");
  pendingChallenge = body.challenge;
}

export async function verifyTotp(code) {
  if (!pendingChallenge) throw new AuthError("verifyTotp() called before startLogin().");
  const response = await fetch(`${AUTH_BASE_URL}/api/auth/budget/verify-totp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pendingChallenge}`,
    },
    body: JSON.stringify({ code }),
  });
  const body = await bodyOrThrow(response, "Incorrect code — try again.");
  pendingChallenge = null;
  storage.saveSession(body.budgetSessionToken);
}

function decodeJwtExpiryMs(jwt) {
  try {
    const payload = jwt.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function refreshJwt(sessionToken) {
  const response = await fetch(`${AUTH_BASE_URL}/api/auth/budget/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const body = await bodyOrThrow(response, "Session expired — please sign in again.");
  const expiresAt = decodeJwtExpiryMs(body.token) ?? Date.now() + 14 * 60 * 1000;
  storage.cacheJwt(body.token, expiresAt);
  return body.token;
}

/** A JWT valid for the next few minutes, refreshing via the session token if
 *  the cached one is missing or near expiry. Throws if not signed in. */
export async function getValidJwt() {
  const sessionToken = storage.sessionToken;
  if (!sessionToken) throw new AuthError("Not signed in.", 401);

  const SAFETY_MARGIN_MS = 60 * 1000;
  if (storage.jwt && storage.jwtExpiresAt - SAFETY_MARGIN_MS > Date.now()) {
    return storage.jwt;
  }
  return refreshJwt(sessionToken);
}

export function isSignedIn() {
  return Boolean(storage.sessionToken);
}

/** Local-first logout: local state is cleared unconditionally BEFORE the
 *  network call, so a request that hangs or fails can never leave the page
 *  looking "signed in" — the worst case is a Budget session that keeps
 *  working server-side until its own 30-day expiry. */
export async function signOut() {
  const sessionToken = storage.sessionToken;
  storage.clear();
  if (!sessionToken) return;
  try {
    await fetch(`${AUTH_BASE_URL}/api/auth/budget/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
  } catch {
    // Local sign-out already happened; a failed revoke just leaves the
    // session to expire on its own.
  }
}
