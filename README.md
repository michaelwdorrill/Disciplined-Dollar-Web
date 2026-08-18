# Disciplined Dollar — Web

A web client for the Disciplined Dollar budget tracker. Plain HTML/CSS/JS,
no build step, deployed via GitHub Pages — same pattern as the sibling
[Heavy-Machinery-WebApp](https://github.com/michaelwdorrill/Heavy-Machinery-WebApp).

## Auth model — deliberately NOT the same as Heavy Machinery's site

Heavy Machinery's web app signs in through Better Auth's generic cookie-based
flow (`sign-in/email` → `two-factor/verify-totp` → `token`). This site does
**not** do that. Budget's server-side auth was rebuilt across several review
passes specifically so that no shared/generic session can ever be upgraded
into Budget authority — reusing HM's pattern here would have quietly reopened
that.

Instead, `auth.js` calls the **same isolated, bearer-only flow the Android
app uses** (`workers/auth/src/budget-auth.ts` in the Home Base repo):
`POST /api/auth/budget/start` → `verify-totp` → `token`. No cookies, ever. A
fresh password + TOTP login is required every time to mint a new session —
nothing generic or shared is ever accepted.

CORS for `/api/auth/budget/*` and `/budget/*` is scoped to this GitHub Pages
account's origin (`https://michaelwdorrill.github.io`) with `credentials`
left off entirely, since this flow never uses cookies.

## What it does

- Sign in (email/password/TOTP)
- Current-month category summary (budgeted / spent / remaining) with
  month-by-month navigation through archives
- Log, edit, and delete transactions — including refunds/credits (a checkbox,
  not a typed minus sign — see the note in `app.js`/the Android app's
  `LogTransactionViewModel.kt` about why: many mobile numeric keyboards have
  no minus key at all)

## What it doesn't do (yet)

- CSV export (the Android app's share-sheet export doesn't map cleanly to a
  browser download without more work — not attempted in this first pass)
- No offline/service-worker caching — every load re-fetches from the server

## Session storage — a deliberate, flagged tradeoff

The 30-day Budget session token lives in `localStorage`, same tradeoff HM's
site already makes for its own session token: acceptable for a
dependency-free, single-owner personal site with no third-party script on
the page, but genuinely softer than the Android app's Keystore-backed
`EncryptedSharedPreferences` — there's no hardware-backed encryption
equivalent in a browser. If this ever gains a build step or a third-party
dependency, revisit this.

## Local development

No build step — just serve the directory and open it:

```bash
python -m http.server 8080
```

(Signing in will fail from `localhost` — CORS is intentionally scoped to the
production GitHub Pages origin only.)

## Deployment

GitHub Pages, served from `main` / root — same as HM's site, no separate
build or `gh-pages` branch.
