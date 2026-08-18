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

export const BUDGETED = {
  Supermarket: 600,
  Restaurants: 300,
  Activities: 450,
  Merchandise: 700,
  Subscriptions: 100,
  Bills: 175,
};

export const TOTAL_BUDGET = Object.values(BUDGETED).reduce((a, b) => a + b, 0);
