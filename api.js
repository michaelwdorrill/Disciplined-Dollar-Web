import { API_BASE_URL } from "./config.js";
import { getValidJwt } from "./auth.js";

/**
 * Talks to the `budget` Worker. Verified against `workers/budget/src/
 * index.ts` in the Home Base repo — same contract the Android app's
 * `BudgetApi.kt` uses. Plain CRUD, server is the sole source of truth.
 */
export class ApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

let onUnauthorized = () => {};
/** Wired from app.js: called once when the server rejects a request with 401
 *  despite a presented token (session revoked/expired server-side), so the UI
 *  can drop back to the login screen instead of silently retrying. */
export function setOnUnauthorized(fn) {
  onUnauthorized = fn;
}

async function authedFetch(path, init = {}) {
  const jwt = await getValidJwt();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${jwt}` },
  });
  if (response.status === 401) onUnauthorized();
  return response;
}

async function bodyOrThrow(response, fallbackMessage) {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(text || fallbackMessage, response.status);
  }
  return response.json();
}

/** Loops through every page (the server always returns a bounded page +
 *  `nextCursor`) and returns the full, concatenated list. */
export async function listAll() {
  const all = [];
  let cursor = null;
  do {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const response = await authedFetch(`/budget/transactions${qs}`);
    const page = await bodyOrThrow(response, "Failed to load transactions.");
    all.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

/** Idempotent: `input.id` is client-generated (crypto.randomUUID()), so
 *  retrying this exact call after a lost response returns the already-stored
 *  row, not a duplicate. */
export async function createTransaction(input) {
  const response = await authedFetch("/budget/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return bodyOrThrow(response, "Failed to create transaction.");
}

/** Throws [ApiError] with statusCode 409 if `input.expectedUpdatedAt` no
 *  longer matches the row's current `updatedAt`. */
export async function updateTransaction(id, input) {
  const response = await authedFetch(`/budget/transactions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return bodyOrThrow(response, "Failed to update transaction.");
}

/** Same optimistic-concurrency precondition as [updateTransaction]. */
export async function deleteTransaction(id, expectedUpdatedAt) {
  const response = await authedFetch(
    `/budget/transactions/${id}?expectedUpdatedAt=${expectedUpdatedAt}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(text || "Failed to delete transaction.", response.status);
  }
}
