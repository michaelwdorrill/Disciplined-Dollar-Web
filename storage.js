// Thin localStorage wrapper, mirroring the Heavy Machinery web app's
// storage.js. This is a single-owner personal tool with no third-party
// script on the page, so localStorage (survives tab close, avoids re-login
// every visit) is an accepted tradeoff over sessionStorage — same reasoning
// HM's site already uses, extended here to Budget's own isolated session
// token. Sign out clears everything below.
const KEYS = {
  sessionToken: "budget_session_token",
  jwt: "budget_jwt",
  jwtExpiresAt: "budget_jwt_expires_at",
};

export const storage = {
  get sessionToken() {
    return localStorage.getItem(KEYS.sessionToken);
  },
  saveSession(sessionToken) {
    localStorage.setItem(KEYS.sessionToken, sessionToken);
  },
  get jwt() {
    return localStorage.getItem(KEYS.jwt);
  },
  get jwtExpiresAt() {
    const raw = localStorage.getItem(KEYS.jwtExpiresAt);
    return raw ? Number(raw) : 0;
  },
  cacheJwt(jwt, expiresAtMs) {
    localStorage.setItem(KEYS.jwt, jwt);
    localStorage.setItem(KEYS.jwtExpiresAt, String(expiresAtMs));
  },
  clear() {
    for (const key of Object.values(KEYS)) localStorage.removeItem(key);
  },
};
