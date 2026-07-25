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
  'Tithe': 'giving', 'Offering': 'giving',
  'Rent': 'housing', 'Utilities': 'housing',
  'Gas': 'transport', 'Car Insurance': 'transport', 'Parking': 'transport', 'Rideshare': 'transport',
  'Subscriptions': 'subs', 'Streaming': 'subs',
  'Insurance': 'protect', 'Gifts': 'protect', 'Family Support (US)': 'protect', 'Friends Support': 'protect',
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
function wlAggregate(txns, todayIso) {
  const month = todayIso.slice(0, 7);
  const groups = {};
  PLAN.groups.forEach(g => { groups[g.id] = 0; });
  groups.living = 0;
  const billIndex = {};   // category → bill def
  PLAN.groups.forEach(g => g.bills.forEach(b => b.categories.forEach(c => { billIndex[c] = b; })));

  const bills = {};
  const unmappedByCat = {};
  let savingsThisMonth = 0, netLanded = 0, paychecksLanded = 0;

  for (const t of txns) {
    if (!t.date || t.date.slice(0, 7) !== month) continue;
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
    month, groups, bills, savingsThisMonth, netLanded, paychecksLanded,
    unmapped: Object.entries(unmappedByCat).map(([category, total]) => ({ category, total })),
  };
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

function renderWealthTab() {
  const txns  = loadTxns();
  const today = todayISO();
  const agg   = wlAggregate(txns, today);
  const pay   = wlPaydays(PLAN.payAnchor, today);
  renderWlHeader(agg, pay, today);
  renderWlBoard(agg);
  renderWlSavings(agg, pay);
  renderWlLadder();
  bindWlStudio();
  renderWlStudio();
  renderWlFooter(agg);
}

function renderWlHeader(agg, pay, today) {
  const d = new Date(today + 'T00:00:00');
  const sub = document.getElementById('wl-month-sub');
  if (sub) sub.textContent = WL_MONTHS[d.getMonth()] + ' ' + d.getFullYear() +
    ' · plan target ' + fmt(PLAN.savingsTargetMo) + '/mo saved';
  const el = document.getElementById('wl-header');
  if (!el) return;
  let html =
    '<div class="wl-head-line"><b>' + agg.paychecksLanded + ' of ' + pay.expected +
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

function renderWlBoard(agg) {
  const el = document.getElementById('wl-board');
  if (!el) return;
  let html = '';
  PLAN.groups.forEach(g => {
    const chips = g.bills.map(b => {
      const paid = agg.bills[b.id];
      return paid
        ? '<span class="wl-chip paid">' + escapeHTML(b.label) + ' ✓ paid ' + fmtDate(paid.lastDate) + '</span>'
        : '<span class="wl-chip">' + escapeHTML(b.label) + ' — due</span>';
    }).join('');
    html += wlRowHTML(g.label, g.monthly, agg.groups[g.id] || 0, chips);
  });
  html += wlRowHTML('Daily living', wlDailyLivingMo(), agg.groups.living || 0, '');
  el.innerHTML = html;
}

function renderWlSavings(agg, pay) {
  const el = document.getElementById('wl-savings');
  if (!el) return;
  const target = PLAN.savingsTargetMo;
  const saved  = agg.savingsThisMonth;
  const toGo   = wlRound(Math.max(0, target - saved));
  const pending = pay.expected - agg.paychecksLanded;
  let note;
  if (saved >= target) note = 'Target hit. Anything more is ahead of plan.';
  else note = fmt(toGo) + ' to go' + (pending > 0
    ? ' · ' + pending + ' paycheck' + (pending > 1 ? 's' : '') + ' still to land'
    : ' · all paychecks landed — this month will close short unless you top up');
  el.innerHTML = wlRowHTML('Saved (Savings Transfer + Investment)', target, saved, '') +
    '<p class="wl-sub" style="margin-top:8px">' + escapeHTML(note) + '</p>';
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
function bindWlStudio() {}
function renderWlStudio() {}
