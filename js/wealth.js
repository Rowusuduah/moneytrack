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
