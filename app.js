import { CATEGORIES, BUDGETED, TOTAL_BUDGET } from "./config.js";
import * as auth from "./auth.js";
import * as api from "./api.js";

const root = document.getElementById("app");

// ---- date helpers — UTC civil-day convention, matching the Android app's
// util/DateUtils.kt: a transaction `date` is the epoch-millis of UTC
// midnight of that calendar day, read back in UTC (not local time). ----
function civilDateToEpoch(y, m, d) {
  return Date.UTC(y, m - 1, d);
}
function epochToParts(epochMs) {
  const d = new Date(epochMs);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
function epochToDateInputValue(epochMs) {
  const { year, month, day } = epochToParts(epochMs);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function dateInputValueToEpoch(value) {
  const [y, m, d] = value.split("-").map(Number);
  return civilDateToEpoch(y, m, d);
}
function todayUtcMidnight() {
  const now = new Date();
  return civilDateToEpoch(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
function formatDisplayDate(epochMs) {
  const { year, month, day } = epochToParts(epochMs);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
function formatMonthYear(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
// Negative amountCents = a refund/credit. Sign goes before the "$", not after.
function formatDollars(cents) {
  const value = cents / 100;
  const abs = Math.abs(value).toFixed(2);
  return value < 0 ? `-$${abs}` : `$${abs}`;
}

// ---- app state ----
let transactions = []; // full cache — mirrors TransactionRepository's approach
let viewYear;
let viewMonth;

function setViewToToday() {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth() + 1;
}
setViewToToday();

function shiftMonth(delta) {
  let m = viewMonth + delta;
  let y = viewYear;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  if (m > 12) {
    m = 1;
    y += 1;
  }
  viewMonth = m;
  viewYear = y;
}

// A 401 on any Budget API call (session revoked/expired server-side) signs
// out locally — the caller's own catch block notices isSignedIn() is false
// afterward and bounces to the login screen (F-02/09-style central
// invalidation, kept as one hook rather than duplicated per call site).
api.setOnUnauthorized(async () => {
  await auth.signOut();
});

async function main() {
  if (!auth.isSignedIn()) {
    renderLogin();
    return;
  }
  await loadAndRenderMain();
}

async function loadAndRenderMain() {
  root.innerHTML = `<p>Loading…</p>`;
  try {
    transactions = await api.listAll();
    renderMain();
  } catch (e) {
    if (!auth.isSignedIn()) {
      // The 401 hook already signed us out — show login, not a stale error.
      renderLogin();
      return;
    }
    root.innerHTML = `
      <div class="card">
        <p class="error">${escapeHtml(e.message || "Failed to load transactions.")}</p>
        <button class="btn-secondary" id="retry">Retry</button>
      </div>`;
    document.getElementById("retry").onclick = loadAndRenderMain;
  }
}

function txForViewMonth() {
  return transactions.filter((t) => {
    const p = epochToParts(t.date);
    return p.year === viewYear && p.month === viewMonth;
  });
}

function renderMain() {
  const monthTx = txForViewMonth().sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);

  const spentByCat = {};
  for (const cat of CATEGORIES) spentByCat[cat] = 0;
  for (const t of monthTx) spentByCat[t.category] = (spentByCat[t.category] || 0) + t.amountCents;
  const totalSpentCents = monthTx.reduce((a, t) => a + t.amountCents, 0);
  const totalBudgetCents = Math.round(TOTAL_BUDGET * 100);

  root.innerHTML = `
    <div class="top-bar">
      <h1>Disciplined Dollar</h1>
      <button class="btn-secondary btn-small" id="logout">Log Out</button>
    </div>
    <div class="fab-row">
      <button class="btn-primary" id="add-tx">+ Log Transaction</button>
    </div>
    <div class="month-nav">
      <button class="btn-secondary btn-small" id="prev-month">&lsaquo;</button>
      <h2>${formatMonthYear(viewYear, viewMonth)}</h2>
      <button class="btn-secondary btn-small" id="next-month">&rsaquo;</button>
    </div>
    <div class="card">
      <table class="summary">
        <thead>
          <tr><th>Category</th><th>Budget</th><th>Spent</th><th>Remaining</th></tr>
        </thead>
        <tbody>
          ${CATEGORIES.map((cat) => {
            const budgetedCents = Math.round((BUDGETED[cat] || 0) * 100);
            const spent = spentByCat[cat] || 0;
            const remaining = budgetedCents - spent;
            return `<tr>
              <td>${escapeHtml(cat)}</td>
              <td>${formatDollars(budgetedCents)}</td>
              <td>${formatDollars(spent)}</td>
              <td class="${remaining < 0 ? "over" : ""}">${formatDollars(remaining)}</td>
            </tr>`;
          }).join("")}
          <tr style="font-weight:600">
            <td>Total</td>
            <td>${formatDollars(totalBudgetCents)}</td>
            <td>${formatDollars(totalSpentCents)}</td>
            <td class="${totalBudgetCents - totalSpentCents < 0 ? "over" : ""}">${formatDollars(totalBudgetCents - totalSpentCents)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="card">
      ${monthTx.length === 0 ? `<div class="empty-state">No transactions this month.</div>` : monthTx.map(renderTxRow).join("")}
    </div>
  `;

  document.getElementById("logout").onclick = async () => {
    await auth.signOut();
    await main();
  };
  document.getElementById("add-tx").onclick = () => openTxModal(null);
  document.getElementById("prev-month").onclick = () => {
    shiftMonth(-1);
    renderMain();
  };
  document.getElementById("next-month").onclick = () => {
    shiftMonth(1);
    renderMain();
  };
  for (const t of monthTx) {
    document.getElementById(`tx-${t.id}`).onclick = () => openTxModal(t);
  }
}

function renderTxRow(t) {
  const isRefund = t.amountCents < 0;
  return `<div class="tx-row" id="tx-${t.id}">
    <div>
      <div>${escapeHtml(t.purchase)}</div>
      <div class="tx-meta">${escapeHtml(t.category)} &bull; ${formatDisplayDate(t.date)}</div>
    </div>
    <div class="tx-amount ${isRefund ? "refund" : ""}">${formatDollars(t.amountCents)}</div>
  </div>`;
}

// ---- add/edit modal ----
function openTxModal(existing) {
  const isEdit = Boolean(existing);
  const magnitude = existing ? Math.abs(existing.amountCents) / 100 : "";
  const isRefund = existing ? existing.amountCents < 0 : false;
  const dateVal = existing ? epochToDateInputValue(existing.date) : epochToDateInputValue(todayUtcMidnight());

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h2>${isEdit ? "Edit Transaction" : "Log Transaction"}</h2>
      <label for="f-date">Date</label>
      <input type="date" id="f-date" value="${dateVal}" />
      <label for="f-amount">Amount ($)</label>
      <input type="number" id="f-amount" min="0.01" step="0.01" value="${magnitude}" />
      <div class="checkbox-row">
        <input type="checkbox" id="f-refund" ${isRefund ? "checked" : ""} />
        <label style="margin:0" for="f-refund">This is a refund / credit (subtracts from the category total)</label>
      </div>
      <label for="f-purchase">Description</label>
      <input type="text" id="f-purchase" value="${existing ? escapeAttr(existing.purchase) : ""}" />
      <label for="f-category">Category</label>
      <select id="f-category">
        ${CATEGORIES.map((c) => `<option value="${c}" ${existing?.category === c ? "selected" : ""}>${c}</option>`).join("")}
      </select>
      <div class="error" id="f-error" style="display:none"></div>
      <div class="modal-actions">
        ${isEdit ? `<button class="btn-danger" id="f-delete" type="button">Delete</button>` : ""}
        <button class="btn-secondary" id="f-cancel" type="button">Cancel</button>
        <button class="btn-primary" id="f-save" type="button">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  document.getElementById("f-cancel").onclick = close;
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  function showFormError(msg) {
    const el = document.getElementById("f-error");
    el.textContent = msg;
    el.style.display = "block";
  }

  // A 401 mid-modal means the session died server-side — close out and bounce
  // to login rather than showing an error the user can't act on.
  async function handleError(e) {
    if (!auth.isSignedIn()) {
      close();
      await main();
      return;
    }
    if (e.statusCode === 409) {
      showFormError("This transaction changed since you opened it. Close and try again.");
    } else {
      showFormError(e.message || "Something went wrong.");
    }
  }

  if (isEdit) {
    document.getElementById("f-delete").onclick = async () => {
      if (!confirm("Delete this transaction?")) return;
      try {
        await api.deleteTransaction(existing.id, existing.updatedAt);
        close();
        await loadAndRenderMain();
      } catch (e) {
        await handleError(e);
      }
    };
  }

  document.getElementById("f-save").onclick = async () => {
    const dateStr = document.getElementById("f-date").value;
    const amountStr = document.getElementById("f-amount").value;
    const isRefundChecked = document.getElementById("f-refund").checked;
    const purchase = document.getElementById("f-purchase").value.trim();
    const category = document.getElementById("f-category").value;

    const magnitudeNum = Number(amountStr);
    if (!dateStr || !amountStr || !Number.isFinite(magnitudeNum) || magnitudeNum <= 0) {
      showFormError("Please enter a valid amount.");
      return;
    }
    if (!purchase) {
      showFormError("Please enter a description.");
      return;
    }
    const amountCents = Math.round(magnitudeNum * 100) * (isRefundChecked ? -1 : 1);
    const date = dateInputValueToEpoch(dateStr);

    try {
      if (isEdit) {
        await api.updateTransaction(existing.id, {
          category,
          purchase,
          amountCents,
          date,
          expectedUpdatedAt: existing.updatedAt,
        });
      } else {
        await api.createTransaction({ id: crypto.randomUUID(), category, purchase, amountCents, date });
      }
      close();
      await loadAndRenderMain();
    } catch (e) {
      await handleError(e);
    }
  };
}

// ---- login (isolated Budget flow — see auth.js) ----
function renderLogin() {
  root.innerHTML = `
    <h1>Disciplined Dollar</h1>
    <div class="card">
      <label for="l-email">Email</label>
      <input type="email" id="l-email" autocomplete="username" />
      <label for="l-password">Password</label>
      <input type="password" id="l-password" autocomplete="current-password" />
      <div class="error" id="l-error" style="display:none"></div>
      <button class="btn-primary" id="l-submit">Sign In</button>
    </div>
  `;
  const showError = (msg) => {
    const el = document.getElementById("l-error");
    el.textContent = msg;
    el.style.display = "block";
  };
  document.getElementById("l-submit").onclick = async () => {
    const email = document.getElementById("l-email").value.trim();
    const password = document.getElementById("l-password").value;
    if (!email || !password) return showError("Enter your email and password.");
    try {
      await auth.startLogin(email, password);
      renderTotp();
    } catch (e) {
      showError(e.message);
    }
  };
}

function renderTotp() {
  root.innerHTML = `
    <h1>Disciplined Dollar</h1>
    <div class="card">
      <label for="t-code">6-digit code</label>
      <input type="text" id="t-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
      <div class="error" id="t-error" style="display:none"></div>
      <button class="btn-primary" id="t-submit">Verify</button>
      <button class="btn-secondary" id="t-back" style="margin-top:8px;width:100%">Back</button>
    </div>
  `;
  const showError = (msg) => {
    const el = document.getElementById("t-error");
    el.textContent = msg;
    el.style.display = "block";
  };
  document.getElementById("t-back").onclick = renderLogin;
  document.getElementById("t-submit").onclick = async () => {
    const code = document.getElementById("t-code").value.trim();
    if (code.length !== 6) return showError("Enter the 6-digit code.");
    try {
      await auth.verifyTotp(code);
      await main();
    } catch (e) {
      showError(e.message);
    }
  };
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

main();
