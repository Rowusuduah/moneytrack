'use strict';
/* ═══════════════════════════════════════════════════════════════
   MoneyTrack — Wealth tab (live view of the Wealth Corridor plan)

   PLAN below is the ONLY place plan numbers live (see CLAUDE.md).
   Amounts are monthly; biweekly plan lines were ×2 from plan.html.
   Top-level code here must stay DOM-free and app.js-free: the pure
   functions are unit-tested in Node (tests/wealth.test.mjs).
   ═══════════════════════════════════════════════════════════════ */

const PLAN = {
  netPerCheck: 2778.95,          // net per biweekly paycheck
  payAnchor: '2026-07-24',       // any real payday; biweekly from here
  savingsTargetMo: 3000,         // chosen target (plan.html: "$3,000 budgeted")
  kMo: 652.56,                   // 401k you+match monthly = (167.32+133.86)*26/12
  returnPct: 6.7,                // studio default real return
  years: 30,                     // studio default horizon
  // Nine fixed groups. monthly = plan.html biweekly sub × 2.
  // bills = lines that get a paid/due chip, matched by txn category.
  groups: [
    { id: 'giving',    label: 'Giving',                   monthly: 595.80, color: '#a78bfa',
      bills: [ { id: 'tithe',     label: 'Tithe',         monthly: 555.80, categories: ['Tithe'] },
               { id: 'offering',  label: 'Offering',      monthly: 40.00,  categories: ['Offering'] } ] },
    { id: 'housing',   label: 'Housing',                  monthly: 845.00, color: '#60a5fa',
      bills: [ { id: 'rent',      label: 'Rent',          monthly: 745.00, categories: ['Rent'] },
               { id: 'utilities', label: 'Utilities',     monthly: 100.00, categories: ['Utilities'] } ] },
    { id: 'transport', label: 'Transport',                monthly: 458.00, color: '#2dd4bf',
      bills: [ { id: 'carins',    label: 'Car insurance', monthly: 163.00, categories: ['Car Insurance'] } ] },
    { id: 'subs',      label: 'Subscriptions',            monthly: 129.00, color: '#f472b6', bills: [] },
    { id: 'protect',   label: 'Protection & obligations', monthly: 70.00,  color: '#fbbf24', bills: [] },
    { id: 'explore',   label: 'Exploration',              monthly: 75.00,  color: '#fb923c', bills: [] },
    { id: 'ghana',     label: 'Ghana family',             monthly: 200.00, color: '#f87171',
      bills: [ { id: 'remit',     label: 'Remittance',    monthly: 200.00, categories: ['Family Support (Ghana)'] } ] },
    { id: 'annual',    label: 'Annual irregular',         monthly: 27.08,  color: '#8a8aa6', bills: [] },
    { id: 'profdev',   label: 'Professional dev',         monthly: 50.00,  color: '#e879f9', bills: [] },
  ],
  livingColor: '#fbbf24',
  savingsColor: '#4ade80',
  // Daily-living split, display only (plan.html LIVING)
  livingSplit: [
    ['Groceries', 0.42], ['Solo dining out', 0.11], ['Personal care', 0.10],
    ['Clothing fund', 0.09], ['Medical & pharmacy', 0.09], ['Household supplies', 0.06],
    ['Buffer / unplanned', 0.09], ['Gym & fitness', 0.04],
  ],
  milestones: [
    { id: 'starter', label: 'Starter buffer', amount: 2000 },
    { id: 'taxres',  label: 'Tax reserve',    amount: 3500 },
    { id: 'ef',      label: 'Emergency fund', amount: 13000 },
    { id: 'niw',     label: 'NIW reserve',    amount: 10000 },
  ],
};

// MoneyTrack txn category → plan group id ('living' = Daily living card)
const WEALTH_CATEGORY_MAP = {
  'Tithe': 'giving', 'Offering': 'giving', 'Donations': 'giving',
  'Rent': 'housing', 'Utilities': 'housing',
  'Gas': 'transport', 'Car Insurance': 'transport', 'Parking': 'transport', 'Rideshare': 'transport',
  'Subscriptions': 'subs', 'Streaming': 'subs',
  'Insurance': 'protect', 'Gifts': 'protect', 'Family Support (US)': 'protect', 'Friends Support': 'protect',
  'Treating Friends': 'protect',
  'Travel': 'explore', 'Events': 'explore',
  'Family Support (Ghana)': 'ghana',
  'Education': 'profdev',
  'Groceries': 'living', 'Dining Out': 'living', 'Fast Food': 'living', 'Food Delivery': 'living',
  'Snacks & Drinks': 'living', 'Coffee': 'living', 'Personal Care': 'living', 'Beauty & Grooming': 'living',
  'Clothing': 'living', 'Shoes & Accessories': 'living', 'Medical': 'living', 'Pharmacy': 'living',
  'Gym': 'living', 'Household Essentials': 'living', 'Home & Furniture': 'living', 'Amazon': 'living',
  'Online Shopping': 'living', 'Electronics': 'living', 'School Supplies': 'living', 'Laundry': 'living',
  'Hobbies': 'living', 'Miscellaneous': 'living',
};
const WEALTH_SAVINGS_CATS  = ['Savings Transfer', 'Investment'];
const WEALTH_EXCLUDED_CATS = ['Bill Reserve', 'Loan Payment', 'Credit Card Payment', 'Bank Fee'];

function wlRound(n) { return Math.round(n * 100) / 100; }   // local: no app.js at top level
function wlPlan() { return PLAN; }
function wlCatToGroup() { return WEALTH_CATEGORY_MAP; }
function wlFixedMo() { return wlRound(PLAN.groups.reduce((s, g) => s + g.monthly, 0)); }
function wlAvailMo() { return wlRound(2 * PLAN.netPerCheck - wlFixedMo()); }
function wlDailyLivingMo() { return wlRound(wlAvailMo() - PLAN.savingsTargetMo); }

// Bill-level plan amounts keyed by txn category, for the Tracker Budget
// card's "Fill from Wealth plan" prefill. A bill prices its line once: the
// amount lands on its first category, so alias categories never double it.
function wlPlanBudgets() {
  const out = {};
  PLAN.groups.forEach(g => g.bills.forEach(b => {
    if (b.categories.length) out[b.categories[0]] = wlRound(b.monthly);
  }));
  return out;
}

const WL_FACTORS = { day: 12 / 365.25, week: 12 / 52, month: 1, year: 12 };
const WL_MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function wlSpendBudget(mode) {
  return wlRound((wlFixedMo() + wlDailyLivingMo()) * WL_FACTORS[mode]);
}

// Calendar window containing todayIso. Weeks run Sunday–Saturday.
function wlWindowBounds(mode, todayIso) {
  const t = new Date(todayIso + 'T00:00:00');
  let start, end, label;
  if (mode === 'day') {
    start = new Date(t); end = new Date(t);
    label = 'Today · ' + WL_MON3[t.getMonth()] + ' ' + t.getDate();
  } else if (mode === 'week') {
    start = new Date(t); start.setDate(t.getDate() - t.getDay());
    end = new Date(start); end.setDate(start.getDate() + 6);
    label = 'Week of ' + WL_MON3[start.getMonth()] + ' ' + start.getDate() + '–' +
      (start.getMonth() === end.getMonth() ? '' : WL_MON3[end.getMonth()] + ' ') + end.getDate();
  } else if (mode === 'year') {
    start = new Date(t.getFullYear(), 0, 1); end = new Date(t.getFullYear(), 11, 31);
    label = String(t.getFullYear());
  } else {
    start = new Date(t.getFullYear(), t.getMonth(), 1);
    end   = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    label = WL_MONTHS[t.getMonth()] + ' ' + t.getFullYear();
  }
  const DAY = 86400000;
  return {
    mode, startIso: wlIsoLocal(start), endIso: wlIsoLocal(end),
    factor: WL_FACTORS[mode], label,
    daysTotal: Math.round((end - start) / DAY) + 1,
    daysElapsed: Math.round((t - start) / DAY) + 1,
  };
}

function wlIsoLocal(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// Biweekly paydays landing in the month containing todayIso.
// setDate(±14) (not ms math) so DST never shifts the calendar day.
function wlPaydays(anchorIso, todayIso) {
  const d     = new Date(anchorIso + 'T00:00:00');
  const today = new Date(todayIso + 'T00:00:00');
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last  = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  while (d > first) d.setDate(d.getDate() - 14);
  while (d < first) d.setDate(d.getDate() + 14);
  const dates = [];
  while (d <= last) { dates.push(wlIsoLocal(d)); d.setDate(d.getDate() + 14); }
  return {
    expected: dates.length,
    dueByToday: dates.filter(x => x <= todayIso).length,
    dates,
  };
}

// One pass over the txn log → everything the live blocks need.
// Inclusive ISO date range; string comparison is safe for YYYY-MM-DD.
function wlAggregateRange(txns, startIso, endIso) {
  const groups = {};
  PLAN.groups.forEach(g => { groups[g.id] = 0; });
  groups.living = 0;
  const billIndex = {};   // category → bill def
  PLAN.groups.forEach(g => g.bills.forEach(b => b.categories.forEach(c => { billIndex[c] = b; })));

  const bills = {};
  const unmappedByCat = {};
  let savingsThisMonth = 0, netLanded = 0, paychecksLanded = 0;

  for (const t of txns) {
    if (!t.date || t.date < startIso || t.date > endIso) continue;
    const amt = Number(t.amount) || 0;

    if (t.type === 'income') {
      if (t.category === 'Paycheck') { paychecksLanded++; netLanded = wlRound(netLanded + amt); }
      continue;                                    // other income is outside the plan
    }
    if (WEALTH_SAVINGS_CATS.includes(t.category)) { // counts whether logged as transfer or expense
      savingsThisMonth = wlRound(savingsThisMonth + amt);
      continue;
    }
    if (t.type === 'transfer') continue;            // account moves are not spending
    if (t.type !== 'expense') continue;
    if (WEALTH_EXCLUDED_CATS.includes(t.category)) continue;

    const gid = WEALTH_CATEGORY_MAP[t.category];
    if (!gid) {
      unmappedByCat[t.category] = wlRound((unmappedByCat[t.category] || 0) + amt);
      continue;
    }
    groups[gid] = wlRound(groups[gid] + amt);
    const bill = billIndex[t.category];
    if (bill) {
      const cur = bills[bill.id] || { total: 0, lastDate: '' };
      cur.total = wlRound(cur.total + amt);
      if (t.date > cur.lastDate) cur.lastDate = t.date;
      bills[bill.id] = cur;
    }
  }

  return {
    groups, bills, savingsThisMonth, netLanded, paychecksLanded,
    unmapped: Object.entries(unmappedByCat).map(([category, total]) => ({ category, total })),
  };
}

// v1 signature preserved: calendar month of todayIso.
function wlAggregate(txns, todayIso) {
  const b = wlWindowBounds('month', todayIso);
  const agg = wlAggregateRange(txns, b.startIso, b.endIso);
  agg.month = todayIso.slice(0, 7);
  return agg;
}

// Daily spending totals + running cumulative for a window (spending only:
// expenses that are neither savings-categorized nor excluded).
function wlPaceSeries(txns, bounds) {
  const idx = {};
  for (const t of txns) {
    if (!t.date || t.date < bounds.startIso || t.date > bounds.endIso) continue;
    if (t.type !== 'expense') continue;
    if (WEALTH_SAVINGS_CATS.includes(t.category)) continue;
    if (WEALTH_EXCLUDED_CATS.includes(t.category)) continue;
    idx[t.date] = wlRound((idx[t.date] || 0) + (Number(t.amount) || 0));
  }
  const days = [], cumulative = [];
  const d = new Date(bounds.startIso + 'T00:00:00');
  const end = new Date(bounds.endIso + 'T00:00:00');
  let run = 0;
  while (d <= end) {
    const iso = wlIsoLocal(d);
    const total = idx[iso] || 0;
    run = wlRound(run + total);
    days.push({ iso, total });
    cumulative.push(run);
    d.setDate(d.getDate() + 1);
  }
  return { days, cumulative };
}

// Savings Transfer + Investment totals for the last n calendar months
// (including the current one), zero-filled, oldest first.
function wlSavingsByMonth(txns, todayIso, n) {
  const count = n || 6;
  const t = new Date(todayIso + 'T00:00:00');
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
    const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    out.push({ ym, label: WL_MON3[d.getMonth()], total: 0 });
  }
  const byYm = {};
  out.forEach(o => { byYm[o.ym] = o; });
  for (const t2 of txns) {
    if (!t2.date || !WEALTH_SAVINGS_CATS.includes(t2.category)) continue;
    const o = byYm[t2.date.slice(0, 7)];
    if (o) o.total = wlRound(o.total + (Number(t2.amount) || 0));
  }
  return out;
}

// Sequential fill of the four reserve milestones from total savings balance.
function wlMilestones(savingsTotal) {
  let remaining = Math.max(0, savingsTotal || 0);
  let activeSeen = false;
  return PLAN.milestones.map(ms => {
    const filled = wlRound(Math.min(ms.amount, remaining));
    remaining = wlRound(Math.max(0, remaining - ms.amount));
    const done = filled >= ms.amount - 0.005;
    const active = !done && !activeSeen && (activeSeen = true);
    return { id: ms.id, label: ms.label, amount: ms.amount, filled, done, active };
  });
}

// Level of service for a given monthly daily-living amount (plan.html grade()).
function wlGrade(livMo) {
  if (livMo >= 1300) return { g: 'A', t: 'Comfortable',     cls: 'a' };
  if (livMo >= 1050) return { g: 'B', t: 'Sustainable',     cls: 'b' };
  if (livMo >= 850)  return { g: 'C', t: 'Disciplined',     cls: 'c' };
  if (livMo >= 650)  return { g: 'D', t: 'Tight',           cls: 'd' };
  if (livMo >= 500)  return { g: 'E', t: 'Very tight',      cls: 'e' };
  return               { g: 'F', t: 'Not sustainable', cls: 'f' };
}

function wlFV(p, r, n) { const i = r / 12; return i === 0 ? p * n : p * ((Math.pow(1 + i, n) - 1) / i); }

// Reserve phase (cash at 4%) until the 28,500 ladder is funded, then invest.
function wlProject(savMo, retPct, years) {
  const n = years * 12, r = retPct / 100;
  const reserve = PLAN.milestones.reduce((s, m) => s + m.amount, 0);
  const fundM = Math.min(Math.ceil(reserve / savMo), n);
  const res   = wlFV(savMo, 0.04, fundM) * Math.pow(1 + 0.04 / 12, Math.max(0, n - fundM));
  const brok  = wlFV(savMo, r, Math.max(0, n - fundM));
  const k     = wlFV(PLAN.kMo, r, n);
  const total = res + brok + k;
  const contrib = savMo * n + PLAN.kMo * n;
  return { total, contrib, growth: total - contrib, fundM };
}

/* ── Renderers (browser only — app.js globals allowed from here down) ── */

const WL_MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

let wlView = 'month';   // 'day' | 'week' | 'month' | 'year' — resets each load

function bindWlToggle() {
  const el = document.getElementById('wl-toggle');
  if (!el || el._wlToggleBound) return;
  el._wlToggleBound = true;
  el.addEventListener('click', e => {
    const btn = e.target.closest('button[data-wlv]');
    if (!btn) return;
    wlView = btn.dataset.wlv;
    renderWealthTab();
  });
}

function renderWlToggle() {
  document.querySelectorAll('#wl-toggle button[data-wlv]').forEach(b => {
    const on = b.dataset.wlv === wlView;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.classList.toggle('on', on);
  });
}

function renderWealthTab() {
  const txns   = loadTxns();
  const today  = todayISO();
  const bounds = wlWindowBounds(wlView, today);
  const agg    = wlAggregateRange(txns, bounds.startIso, bounds.endIso);
  const pay    = wlPaydays(PLAN.payAnchor, today);
  bindWlToggle();
  renderWlToggle();
  renderWlHeader(agg, pay, today, bounds);
  renderWlPace(txns, bounds);
  renderWlBoard(agg, bounds);
  renderWlVariance(agg, bounds);
  renderWlSavings(agg, pay, bounds);
  renderWlSavingsTrend(txns, today);
  renderWlLadder();
  bindWlStudio();
  renderWlStudio();
  renderWlFooter(agg);
}

function renderWlHeader(agg, pay, today, bounds) {
  const sub = document.getElementById('wl-month-sub');
  if (sub) sub.textContent = bounds.label +
    ' · plan target ' + fmt(PLAN.savingsTargetMo) + '/mo saved';
  const el = document.getElementById('wl-header');
  if (!el) return;
  let html;
  if (bounds.mode === 'month') {
    html = '<div class="wl-head-line"><b>' + agg.paychecksLanded + ' of ' + pay.expected +
      '</b> paychecks landed · <b>' + fmt(agg.netLanded) + '</b> net so far</div>';
    if (pay.expected === 3) {
      html += '<div class="wl-callout">Third-paycheck month — an extra ' +
        fmt(PLAN.netPerCheck) + ' lands on top of the plan. The plan says sweep it to savings.</div>';
    }
    if (agg.paychecksLanded < pay.dueByToday) {
      html += '<div class="wl-callout">Heads up: ' + pay.dueByToday +
        ' payday(s) have passed this month but only ' + agg.paychecksLanded +
        ' Paycheck transaction(s) are logged.</div>';
    }
  } else if (bounds.mode === 'year') {
    html = '<div class="wl-head-line"><b>' + agg.paychecksLanded +
      '</b> paychecks landed · <b>' + fmt(agg.netLanded) + '</b> net so far this year</div>';
  } else {
    html = '<div class="wl-head-line"><b>' + fmt(agg.netLanded) + '</b> net landed</div>';
  }
  el.innerHTML = html;
}

// Filled in Task 4
function wlBarClass(spent, alloc) {
  if (alloc <= 0) return spent > 0 ? 'over' : '';
  const r = spent / alloc;
  return r > 1 ? 'over' : r >= 0.8 ? 'warn' : '';
}

function wlRowHTML(label, alloc, spent, chipsHTML) {
  const left = wlRound(alloc - spent);
  const pct  = alloc > 0 ? Math.min(100, spent / alloc * 100) : (spent > 0 ? 100 : 0);
  const cls  = wlBarClass(spent, alloc);
  const leftTxt = left >= 0
    ? '<span class="wl-left">' + fmt(left) + ' left</span>'
    : '<span class="wl-left over">over by ' + fmt(-left) + '</span>';
  return '<div class="wl-row">' +
    '<div class="wl-row-head"><span>' + escapeHTML(label) + '</span>' +
    '<span><span class="amt">' + fmt(spent) + ' of ' + fmt(alloc) + ' · </span>' + leftTxt + '</span></div>' +
    '<div class="wl-bar"><div class="wl-bar-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
    (chipsHTML ? '<div class="wl-chips">' + chipsHTML + '</div>' : '') +
    '</div>';
}

function renderWlBoard(agg, bounds) {
  const el = document.getElementById('wl-board');
  if (!el) return;
  let html = '';
  PLAN.groups.forEach(g => {
    const chips = bounds.mode !== 'month' ? '' : g.bills.map(b => {
      const paid = agg.bills[b.id];
      return paid
        ? '<span class="wl-chip paid">' + escapeHTML(b.label) + ' ✓ paid ' + fmtDate(paid.lastDate) + '</span>'
        : '<span class="wl-chip">' + escapeHTML(b.label) + ' — due</span>';
    }).join('');
    html += wlRowHTML(g.label, wlRound(g.monthly * bounds.factor), agg.groups[g.id] || 0, chips);
  });
  html += wlRowHTML('Daily living', wlRound(wlDailyLivingMo() * bounds.factor), agg.groups.living || 0, '');
  el.innerHTML = html;
}

function renderWlSavings(agg, pay, bounds) {
  const el = document.getElementById('wl-savings');
  if (!el) return;
  const target = wlRound(PLAN.savingsTargetMo * bounds.factor);
  const saved  = agg.savingsThisMonth;
  const toGo   = wlRound(Math.max(0, target - saved));
  let note;
  if (saved >= target) note = 'Target hit. Anything more is ahead of plan.';
  else if (bounds.mode === 'month') {
    const pending = pay.expected - agg.paychecksLanded;
    note = fmt(toGo) + ' to go' + (pending > 0
      ? ' · ' + pending + ' paycheck' + (pending > 1 ? 's' : '') + ' still to land'
      : ' · all paychecks landed — this month will close short unless you top up');
  } else {
    note = fmt(toGo) + ' to go this ' + (bounds.mode === 'day' ? 'day' : bounds.mode);
  }
  el.innerHTML = wlRowHTML('Saved (Savings Transfer + Investment)', target, saved, '') +
    '<p class="wl-sub" style="margin-top:8px">' + escapeHTML(note) + '</p>';
}
// Spending pace. Week/Month/Year: cumulative actual (green under pace, red
// over) vs a dashed straight budget-pace line. Day: last 14 days as daily
// columns vs the daily budget line (txns carry no time of day).
function renderWlPace(txns, bounds) {
  const svg = document.getElementById('wl-pace');
  const cap = document.getElementById('wl-pace-cap');
  if (!svg) return;
  const W = 620, H = 180, L = 46, R = 12, T = 12, B = 22;
  const kFmt = n => n >= 1000 ? '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : '$' + Math.round(n);
  let g = '';

  if (bounds.mode === 'day') {
    const endD = new Date(bounds.endIso + 'T00:00:00');
    const startD = new Date(endD); startD.setDate(endD.getDate() - 13);
    const series = wlPaceSeries(txns, { startIso: wlIsoLocal(startD), endIso: bounds.endIso });
    const budget = wlSpendBudget('day');
    const max = Math.max(budget * 1.5, ...series.days.map(d => d.total)) || 1;
    const n = series.days.length;
    const bw = (W - L - R) / n;
    const Y = v => H - B - (v / max) * (H - T - B);
    series.days.forEach((d2, i) => {
      const x = L + i * bw;
      const over = d2.total > budget;
      if (d2.total > 0) {
        g += '<rect x="' + (x + 2).toFixed(1) + '" y="' + Y(d2.total).toFixed(1) +
          '" width="' + (bw - 4).toFixed(1) + '" height="' + (H - B - Y(d2.total)).toFixed(1) +
          '" class="wl-ch-col' + (over ? ' over' : '') + '"/>';
      }
      if (i % 2 === 1) {
        const dd = new Date(d2.iso + 'T00:00:00');
        g += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) +
          '" fill="currentColor" opacity="0.55" font-size="9" text-anchor="middle">' +
          WL_MON3[dd.getMonth()] + ' ' + dd.getDate() + '</text>';
      }
    });
    g += '<line x1="' + L + '" y1="' + Y(budget).toFixed(1) + '" x2="' + (W - R) +
      '" y2="' + Y(budget).toFixed(1) + '" class="wl-ch-target"/>';
    const spentToday = series.days[n - 1].total;
    if (cap) cap.textContent = 'Last 14 days · today ' + fmt(spentToday) + ' vs ' +
      fmt(budget) + '/day budget' + (spentToday > budget ? ' — over' : '');
  } else {
    const series = wlPaceSeries(txns, bounds);
    const budget = wlSpendBudget(bounds.mode);
    const n = series.cumulative.length;
    const upto = Math.min(Math.max(1, bounds.daysElapsed), n);
    const actual = series.cumulative[upto - 1] || 0;
    const max = (Math.max(budget, actual) * 1.05) || 1;
    const X = i => L + (i / Math.max(1, n - 1)) * (W - L - R);
    const Y = v => H - B - (v / max) * (H - T - B);
    for (let i = 0; i <= 3; i++) {
      const v = max * i / 3, y = Y(v);
      g += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) +
        '" stroke="currentColor" opacity="0.12"/>';
      g += '<text x="' + (L - 6) + '" y="' + (y + 3.5).toFixed(1) + '" fill="currentColor" opacity="0.55" ' +
        'font-size="9" text-anchor="end">' + kFmt(v) + '</text>';
    }
    g += '<line x1="' + X(0).toFixed(1) + '" y1="' + Y(0).toFixed(1) + '" x2="' + X(n - 1).toFixed(1) +
      '" y2="' + Y(budget).toFixed(1) + '" class="wl-ch-pace"/>';
    for (let i = 1; i < upto; i++) {
      const paceHere = budget * i / Math.max(1, n - 1);
      const cls = series.cumulative[i] > paceHere ? 'wl-ch-over' : 'wl-ch-under';
      g += '<line x1="' + X(i - 1).toFixed(1) + '" y1="' + Y(series.cumulative[i - 1]).toFixed(1) +
        '" x2="' + X(i).toFixed(1) + '" y2="' + Y(series.cumulative[i]).toFixed(1) +
        '" class="' + cls + '"/>';
    }
    const paceToDate = wlRound(budget * bounds.daysElapsed / bounds.daysTotal);
    const delta = wlRound(actual - paceToDate);
    if (cap) cap.textContent = fmt(actual) + ' spent · pace says ' + fmt(paceToDate) +
      ' by day ' + bounds.daysElapsed + ' of ' + bounds.daysTotal + ' — ' +
      (delta > 0 ? 'over pace by ' + fmt(delta) : 'under pace by ' + fmt(-delta));
  }
  svg.innerHTML = g;
}

// Plan vs. actual: one bar per group, worst overspend first. Bar scale is
// 0–200% of allocation (the 100% reference sits mid-track); ▸ marks >200%.
function renderWlVariance(agg, bounds) {
  const el = document.getElementById('wl-variance');
  if (!el) return;
  const rows = PLAN.groups.map(g => ({
    label: g.label,
    alloc: wlRound(g.monthly * bounds.factor),
    spent: agg.groups[g.id] || 0,
  }));
  rows.push({ label: 'Daily living', alloc: wlRound(wlDailyLivingMo() * bounds.factor),
    spent: agg.groups.living || 0 });
  rows.forEach(r => { r.delta = wlRound(r.spent - r.alloc); });
  rows.sort((a, b) => b.delta - a.delta);
  el.innerHTML = rows.map(r => {
    const ratio = r.alloc > 0 ? r.spent / r.alloc : (r.spent > 0 ? 2.01 : 0);
    const over = r.delta > 0.005;
    const width = Math.min(100, ratio * 50);
    return '<div class="wl-varrow">' +
      '<span class="wl-var-label">' + escapeHTML(r.label) + '</span>' +
      '<span class="wl-var-track"><i class="wl-var-fill' + (over ? ' over' : '') +
      '" style="width:' + width.toFixed(1) + '%"></i><i class="wl-var-ref"></i>' +
      (ratio > 2 ? '<b class="wl-var-clip">▸</b>' : '') + '</span>' +
      '<span class="wl-var-delta' + (over ? ' over' : '') + '">' +
      (over ? '+' + fmt(r.delta) + ' over' : fmt(-r.delta) + ' under') + '</span>' +
      '</div>';
  }).join('');
}

// Last 6 months of savings vs the monthly target line. Always monthly.
function renderWlSavingsTrend(txns, today) {
  const svg = document.getElementById('wl-sav-trend');
  if (!svg) return;
  const months = wlSavingsByMonth(txns, today, 6);
  const target = PLAN.savingsTargetMo;
  const max = Math.max(target * 1.25, ...months.map(m => m.total)) || 1;
  const W = 620, H = 150, L = 46, R = 12, T = 10, B = 22;
  const bw = (W - L - R) / months.length;
  const Y = v => H - B - (v / max) * (H - T - B);
  let g = '';
  months.forEach((m, i) => {
    const x = L + i * bw;
    const met = m.total >= target;
    if (m.total > 0) {
      g += '<rect x="' + (x + bw * 0.18).toFixed(1) + '" y="' + Y(m.total).toFixed(1) +
        '" width="' + (bw * 0.64).toFixed(1) + '" height="' + Math.max(0, H - B - Y(m.total)).toFixed(1) +
        '" class="wl-ch-col' + (met ? '' : ' short') + '"/>';
      g += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (Y(m.total) - 4).toFixed(1) +
        '" fill="currentColor" opacity="0.7" font-size="9" text-anchor="middle">' + wlM0(m.total) + '</text>';
    }
    g += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) +
      '" fill="currentColor" opacity="0.55" font-size="9" text-anchor="middle">' + m.label + '</text>';
  });
  g += '<line x1="' + L + '" y1="' + Y(target).toFixed(1) + '" x2="' + (W - R) +
    '" y2="' + Y(target).toFixed(1) + '" class="wl-ch-target"/>';
  g += '<text x="' + (W - R) + '" y="' + (Y(target) - 4).toFixed(1) +
    '" fill="currentColor" opacity="0.7" font-size="9" text-anchor="end">target ' + wlM0(target) + '</text>';
  svg.innerHTML = g;
}

// Filled in Task 5
function wlSavingsTotal(snap) {
  const b = (snap && snap.accounts) || {};
  return roundMoney(ACCOUNTS.filter(a => a.group === 'savings')
    .reduce((s, a) => s + safeAmt(b[a.id]), 0));
}

function renderWlLadder() {
  const el = document.getElementById('wl-ladder');
  if (!el) return;
  const snap = getLatestSnapshot();
  if (!snap) {
    el.innerHTML = '<p class="wl-sub">No snapshot yet — record your balances in the ' +
      'Accounts tab and the ladder fills from your savings accounts.</p>';
    return;
  }
  const total  = wlSavingsTotal(snap);
  const stages = wlMilestones(total);
  let html = '';
  stages.forEach((s, i) => {
    const pct = Math.min(100, s.amount > 0 ? s.filled / s.amount * 100 : 0);
    html += '<div class="wl-stage ' + (s.done ? 'done' : s.active ? 'active' : '') + '">' +
      '<div class="wl-stage-n">' + (s.done ? '✓' : i + 1) + '</div>' +
      '<div class="wl-stage-body">' +
      '<div class="wl-row-head"><span>' + escapeHTML(s.label) + '</span>' +
      '<span class="amt">' + fmt(s.filled) + ' of ' + fmt(s.amount) + '</span></div>' +
      '<div class="wl-bar"><div class="wl-bar-fill' + (s.done ? '' : ' warn') + '" style="width:' + pct + '%"></div></div>' +
      '</div></div>';
  });
  html += '<p class="wl-sub" style="margin-top:8px">' + fmt(total) +
    ' in savings accounts · as of ' + fmtDate(snap.date) + ' snapshot</p>';
  el.innerHTML = html;
}

function renderWlFooter(agg) {
  const el = document.getElementById('wl-footer');
  if (!el) return;
  let html = '';
  if (agg.unmapped.length) {
    html += '<div class="wl-callout"><b>Not counted on the board:</b> ' +
      agg.unmapped.map(u => escapeHTML(u.category) + ' ' + fmt(u.total)).join(' · ') +
      ' — add these categories to WEALTH_CATEGORY_MAP in js/wealth.js if they belong to a group.</div>';
  }
  html += '<p class="wl-sub" style="margin-top:' + (agg.unmapped.length ? '10px' : '0') + '">' +
    'The full plan — investing mechanics, nonresident tax, Ghana, 97-year scenarios — ' +
    '<a href="plan.html" target="_blank" rel="noopener">read it here</a>.</p>';
  el.innerHTML = html;
}
// Filled in Task 6
function bindWlStudio() {
  const sec = document.getElementById('sec-wealth');
  if (!sec || sec._wlStudioBound) return;
  sec._wlStudioBound = true;
  ['wl-sl-save', 'wl-sl-ret', 'wl-sl-yrs'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderWlStudio);
  });
}

function wlM0(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

function renderWlStudio() {
  const savMo = +(document.getElementById('wl-sl-save')?.value || PLAN.savingsTargetMo);
  const ret   = +(document.getElementById('wl-sl-ret')?.value  || PLAN.returnPct);
  const yrs   = +(document.getElementById('wl-sl-yrs')?.value  || PLAN.years);
  const livMo = wlRound(wlAvailMo() - savMo);
  const grade = wlGrade(livMo);

  const gEl = document.getElementById('wl-st-grade');
  if (gEl) { gEl.textContent = grade.g; gEl.className = 'wl-grade ' + grade.cls; }
  const tEl = document.getElementById('wl-st-title');
  if (tEl) tEl.textContent = grade.t;
  const vEl = document.getElementById('wl-st-verdict');
  if (vEl) vEl.textContent = 'Saving ' + wlM0(savMo) + '/mo leaves ' + wlM0(livMo) +
    ' a month for groceries, medical, clothing and everything unplanned. ' +
    'Third-paycheck months add ' + wlM0(2 * PLAN.netPerCheck) + ' a year on top.';
  const sEl = document.getElementById('wl-st-save');
  if (sEl) sEl.textContent = wlM0(savMo) + '/mo · ' + wlM0(savMo / 2) + ' per check';

  // Corridor: fixed groups + daily living (dim) + savings, % of the 2-check month
  const moNet = 2 * PLAN.netPerCheck;
  const corr = document.getElementById('wl-corr'), key = document.getElementById('wl-corr-key');
  if (corr && key) {
    const segs = PLAN.groups.map(g => ({ label: g.label, v: g.monthly, color: g.color }));
    segs.push({ label: 'Daily living', v: Math.max(0, livMo), color: PLAN.livingColor, dim: true });
    segs.push({ label: 'Savings', v: savMo, color: PLAN.savingsColor });
    corr.innerHTML = segs.map(s =>
      '<div style="width:' + (s.v / moNet * 100) + '%;background:' + s.color +
      (s.dim ? ';opacity:.45' : '') + '" title="' + escapeHTML(s.label + ' — ' + fmt(s.v)) + '"></div>'
    ).join('');
    key.innerHTML = segs.map(s =>
      '<span><i style="background:' + s.color + '"></i>' + escapeHTML(s.label) +
      ' <b>' + wlM0(s.v) + '</b></span>').join('');
  }

  // Projection
  const p = wlProject(savMo, ret, yrs);
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set('wl-proj-total', wlM0(p.total));
  set('wl-proj-cap', 'at age ' + (29 + yrs) + " · today's dollars · reserves full in " + p.fundM + ' mo');
  set('wl-proj-contrib', wlM0(p.contrib));
  set('wl-st-ret', ret.toFixed(1) + '% real');
  set('wl-st-yrs', yrs + ' yrs');

  // Chart: yearly balance curve (same math as wlProject, evaluated per year)
  const svg = document.getElementById('wl-chart');
  if (!svg) return;
  const W = 620, H = 210, L = 54, R = 12, T = 12, B = 24;
  const pts = [];
  for (let y = 0; y <= yrs; y++) {
    const n = y * 12, fm = Math.min(p.fundM, n), r = ret / 100;
    pts.push([y,
      wlFV(savMo, 0.04, fm) * Math.pow(1 + 0.04 / 12, Math.max(0, n - fm)) +
      wlFV(savMo, r, Math.max(0, n - fm)) + wlFV(PLAN.kMo, r, n)]);
  }
  const max = pts[pts.length - 1][1] || 1;
  const X = y => L + (y / yrs) * (W - L - R), Y = v => H - B - (v / max) * (H - T - B);
  const kFmt = n => n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : '$' + Math.round(n / 1000) + 'k';
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4, y = Y(v);
    g += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y +
      '" stroke="currentColor" opacity="0.12"/>';
    g += '<text x="' + (L - 7) + '" y="' + (y + 3.5) + '" fill="currentColor" opacity="0.55" ' +
      'font-size="9" text-anchor="end">' + kFmt(v) + '</text>';
  }
  const step = yrs <= 10 ? 2 : 5;
  for (let y = 0; y <= yrs; y += step) {
    g += '<text x="' + X(y) + '" y="' + (H - 7) + '" fill="currentColor" opacity="0.55" ' +
      'font-size="9" text-anchor="middle">' + (29 + y) + '</text>';
  }
  let d = 'M' + X(0) + ',' + Y(0);
  pts.forEach(pt => { d += ' L' + X(pt[0]).toFixed(1) + ',' + Y(pt[1]).toFixed(1); });
  g += '<path d="' + d + ' L' + X(yrs) + ',' + (H - B) + ' L' + L + ',' + (H - B) +
    ' Z" fill="' + PLAN.savingsColor + '" opacity="0.15"/>';
  g += '<path d="' + d + '" fill="none" stroke="' + PLAN.savingsColor + '" stroke-width="2"/>';
  svg.innerHTML = g;
}
