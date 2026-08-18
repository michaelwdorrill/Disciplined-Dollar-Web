// Home Base platform URLs — same Workers the Android app talks to.
export const AUTH_BASE_URL = "https://auth.homebase-app.workers.dev";
export const API_BASE_URL = "https://budget.homebase-app.workers.dev";

// Mirrors app/src/main/java/com/dorrill/budgetapp/util/BudgetConstants.kt —
// keep these two in sync by hand (no shared package between the Android app
// and this static site).
export const CATEGORIES = [
  "Supermarket",
  "Restaurants",
  "Activities",
  "Merchandise",
  "Subscriptions",
  "Bills",
];

// Which card/account paid for it. Mirrors workers/budget/src/sources.ts and
// BudgetConstants.SOURCES in the Android app. Note: a transaction can read
// back with source "Unknown" (rows written before this field existed) even
// though it's not one of these — see api.js/app.js, which treat that as a
// display-only value never offered as a picker choice.
export const SOURCES = ["Citi", "Capital One", "Discover", "Venmo", "Schwab"];

export const BUDGETED = {
  Supermarket: 600,
  Restaurants: 300,
  Activities: 450,
  Merchandise: 700,
  Subscriptions: 100,
  Bills: 175,
};

export const TOTAL_BUDGET = Object.values(BUDGETED).reduce((a, b) => a + b, 0);
