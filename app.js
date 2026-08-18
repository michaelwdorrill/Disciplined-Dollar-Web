import { CATEGORIES, SOURCES, BUDGETED, TOTAL_BUDGET } from "./config.js";
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

// A purely display-time filter over the currently-viewed month's already-
// loaded transactions — never touches the network, never affects the budget
// summary table (that answers "how am I doing this month" for the WHOLE
// month; the filter is a "help me find one transaction" tool — same
// separation of concerns as the Android app's TransactionFilter). `null` in
// any field means "no constraint on that field." Reset whenever the viewed
// month changes, so a filter set for one month doesn't silently carry over
// and hide rows in the next.
let filter = { category: null, source: null, dateFrom: null, dateTo: null, amountMin: null, amountMax: null };
let filterExpanded = false;

function isFilterActive(f) {
  return Object.values(f).some((v) => v !== null);
}

function applyFilter(txs, f) {
  if (!isFilterActive(f)) return txs;
  return txs.filter((t) => {
    if (f.category !== null && t.category !== f.category) return false;
    if (f.source !== null && t.source !== f.source) return false;
    if (f.dateFrom !== null && t.date < f.dateFrom) return false;
    if (f.dateTo !== null && t.date > f.dateTo) return false;
    // Compared against the signed dollar amount (a refund is negative), not
    // its magnitude — so amountMin = 0 excludes refunds rather than
    // requiring the user to think in absolute value.
    const amount = t.amountCents / 100;
    if (f.amountMin !== null && amount < f.amountMin) return false;
    if (f.amountMax !== null && amount > f.amountMax) return false;
    return true;
  });
}

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
  filter = { category: null, source: null, dateFrom: null, dateTo: null, amountMin: null, amountMax: null };
  filterExpanded = false;
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
  const filteredTx = applyFilter(monthTx, filter);

  // Budget summary always reflects the WHOLE month, never the filtered
  // subset — see the `filter`/`applyFilter` comment above.
  const spentByCat = {};
  for (const cat of CATEGORIES) spentByCat[cat] = 0;
  for (const t of monthTx) spentByCat[t.category] = (spentByCat[t.category] || 0) + t.amountCents;
  const totalSpentCents = monthTx.reduce((a, t) => a + t.amountCents, 0);
  const totalBudgetCents = Math.round(TOTAL_BUDGET * 100);

  // Only sources actually present this month — includes "Unknown"
  // automatically when a legacy row is present, without special-casing it.
  const availableSources = [...new Set(monthTx.map((t) => t.source))].sort();

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
    ${renderFilterPanel(availableSources)}
    <div class="card">
      <div class="tx-list-header">
        <span>Transactions</span>
        ${isFilterActive(filter) ? `<span class="tx-count">${filteredTx.length} of ${monthTx.length}</span>` : ""}
      </div>
      ${
        filteredTx.length === 0
          ? `<div class="empty-state">${monthTx.length === 0 ? "No transactions this month." : "No transactions match these filters."}</div>`
          : filteredTx.map(renderTxRow).join("")
      }
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
  for (const t of filteredTx) {
    document.getElementById(`tx-${t.id}`).onclick = () => openTxModal(t);
  }
  wireFilterPanel();
}

// ---- filter panel ----
function renderFilterPanel(availableSources) {
  const active = isFilterActive(filter);
  return `
    <div class="card">
      <div class="filter-header" id="filter-toggle">
        <span class="filter-title">
          Filters
          ${active ? `<span class="filter-dot"></span>` : ""}
        </span>
        <span class="filter-chevron">${filterExpanded ? "&and;" : "&or;"}</span>
      </div>
      ${
        filterExpanded
          ? `
        <div class="filter-body">
          <label for="ff-category">Category</label>
          <select id="ff-category">
            <option value="" ${filter.category === null ? "selected" : ""}>All Categories</option>
            ${CATEGORIES.map((c) => `<option value="${c}" ${filter.category === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
          <label for="ff-source">Source</label>
          <select id="ff-source">
            <option value="" ${filter.source === null ? "selected" : ""}>All Sources</option>
            ${availableSources.map((s) => `<option value="${escapeAttr(s)}" ${filter.source === s ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
          </select>
          <div class="filter-row-2">
            <div>
              <label for="ff-date-from">From</label>
              <input type="date" id="ff-date-from" value="${filter.dateFrom !== null ? epochToDateInputValue(filter.dateFrom) : ""}" />
            </div>
            <div>
              <label for="ff-date-to">To</label>
              <input type="date" id="ff-date-to" value="${filter.dateTo !== null ? epochToDateInputValue(filter.dateTo) : ""}" />
            </div>
          </div>
          <div class="filter-row-2">
            <div>
              <label for="ff-amount-min">Min $</label>
              <input type="number" step="0.01" id="ff-amount-min" value="${filter.amountMin !== null ? filter.amountMin : ""}" />
            </div>
            <div>
              <label for="ff-amount-max">Max $</label>
              <input type="number" step="0.01" id="ff-amount-max" value="${filter.amountMax !== null ? filter.amountMax : ""}" />
            </div>
          </div>
          ${active ? `<button class="btn-secondary" id="ff-clear" style="width:100%;margin-top:12px">Clear filters</button>` : ""}
        </div>
      `
          : ""
      }
    </div>
  `;
}

function wireFilterPanel() {
  document.getElementById("filter-toggle").onclick = () => {
    filterExpanded = !filterExpanded;
    renderMain();
  };
  if (!filterExpanded) return;

  document.getElementById("ff-category").onchange = (e) => {
    filter = { ...filter, category: e.target.value || null };
    renderMain();
  };
  document.getElementById("ff-source").onchange = (e) => {
    filter = { ...filter, source: e.target.value || null };
    renderMain();
  };
  document.getElementById("ff-date-from").onchange = (e) => {
    filter = { ...filter, dateFrom: e.target.value ? dateInputValueToEpoch(e.target.value) : null };
    renderMain();
  };
  document.getElementById("ff-date-to").onchange = (e) => {
    filter = { ...filter, dateTo: e.target.value ? dateInputValueToEpoch(e.target.value) : null };
    renderMain();
  };
  // Amount fields re-render on 'change' (blur/enter), not 'input' — a full
  // re-render on every keystroke would steal focus mid-typing (innerHTML
  // replaces the DOM node the user is typing into).
  document.getElementById("ff-amount-min").onchange = (e) => {
    const v = e.target.value === "" ? null : Number(e.target.value);
    filter = { ...filter, amountMin: Number.isFinite(v) ? v : null };
    renderMain();
  };
  document.getElementById("ff-amount-max").onchange = (e) => {
    const v = e.target.value === "" ? null : Number(e.target.value);
    filter = { ...filter, amountMax: Number.isFinite(v) ? v : null };
    renderMain();
  };
  const clearBtn = document.getElementById("ff-clear");
  if (clearBtn) {
    clearBtn.onclick = () => {
      filter = { category: null, source: null, dateFrom: null, dateTo: null, amountMin: null, amountMax: null };
      renderMain();
    };
  }
}

function renderTxRow(t) {
  const isRefund = t.amountCents < 0;
  return `<div class="tx-row" id="tx-${t.id}">
    <div>
      <div>${escapeHtml(t.purchase)}</div>
      <div class="tx-meta">${escapeHtml(t.category)} &bull; ${escapeHtml(t.source)} &bull; ${formatDisplayDate(t.date)}</div>
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
      <label for="f-source">Source</label>
      <select id="f-source">
        ${
          // A legacy row can carry "Unknown" (not in SOURCES — see config.js).
          // Show it as an extra, pre-selected option rather than silently
          // defaulting to a real source the user didn't choose.
          existing && existing.source && !SOURCES.includes(existing.source)
            ? `<option value="${escapeAttr(existing.source)}" selected>${escapeHtml(existing.source)}</option>`
            : ""
        }
        ${SOURCES.map((s) => `<option value="${s}" ${existing?.source === s ? "selected" : ""}>${s}</option>`).join("")}
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
    const source = document.getElementById("f-source").value;

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
          source,
          purchase,
          amountCents,
          date,
          expectedUpdatedAt: existing.updatedAt,
        });
      } else {
        await api.createTransaction({ id: crypto.randomUUID(), category, source, purchase, amountCents, date });
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
