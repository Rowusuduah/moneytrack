'use strict';
/* ═══════════════════════════════════════════════════════════════
   MoneyTrack — Payday Loop cards on the Wealth tab. The pure math
   (wlPaydaySplit, wlMonthsToTarget, wlLoopNormalize, wlLoopAgenda,
   wlPaydayAround) lives in wealth.js and is unit-tested in Node.
   Spec: docs/superpowers/specs/2026-10-25-payday-loop-design.md
   ═══════════════════════════════════════════════════════════════ */

const WL_INFLATION_PCT = 3;
let wlRoadMode = 'real';   // 'real' = today's money · 'paper' = dollars on the statement

function wlLoopLoad() {
  try { return wlLoopNormalize(JSON.parse(localStorage.getItem(WL_LOOP_KEY) || 'null')); }
  catch { return wlLoopNormalize(null); }
}

function wlLoopSave(store) {
  try {
    localStorage.setItem(WL_LOOP_KEY, JSON.stringify(wlLoopNormalize(store)));
  } catch (e) {
    showToast('Could not save on this device: ' + e.message, 'error');
    return false;
  }
  queueDriveSync();
  return true;
}

function wlMonthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function wlAddMonthsYm(todayIso, months) {
  const t = new Date(todayIso + 'T00:00:00');
  const d = new Date(t.getFullYear(), t.getMonth() + months, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Over the last 3 full months: average moved into savings & investments, and average logged
// back out of them (spending from savings, transfers to checking), so the net pace is honest.
function wlActualPace(txns, todayIso) {
  const t = new Date(todayIso + 'T00:00:00');
  const s = wlIsoLocal(new Date(t.getFullYear(), t.getMonth() - 3, 1));
  const e = wlIsoLocal(new Date(t.getFullYear(), t.getMonth(), 0));
  const win = txns.filter(x => x.date >= s && x.date <= e);
  const pool = new Set(ACCOUNTS.filter(a => a.group === 'savings' || a.group === 'investment').map(a => a.id));
  const out = win.reduce((sum, x) => {
    if (!pool.has(x.account)) return sum;
    if (x.type === 'expense' || (x.type === 'transfer' && !pool.has(x.toAccount))) return sum + safeAmt(x.amount);
    return sum;
  }, 0);
  const moved = anMovedToSavingsInvestments(win, ACCOUNTS);
  return { moved: roundMoney(moved / 3), out: roundMoney(out / 3), net: roundMoney((moved - out) / 3) };
}

function wlRoadNumbers(txns, todayIso) {
  const snap = getLatestSnapshot();
  const b = (snap && snap.accounts) || {};
  const start = roundMoney(ACCOUNTS.filter(a => a.group === 'savings' || a.group === 'investment')
    .reduce((s, a) => s + safeAmt(b[a.id]), 0));
  const rate = wlRoadMode === 'real' ? PLAN.returnPct : PLAN.returnPct + WL_INFLATION_PCT;
  const pace = wlActualPace(txns, todayIso);
  const actual = Math.max(0, pace.net);
  const planned = roundMoney(PLAN.savingsTargetMo + PLAN.kMo);
  const at = monthly => {
    const m = wlMonthsToTarget(start, monthly, rate, 1000000);
    return m === null ? null : { months: m, ym: wlAddMonthsYm(todayIso, m) };
  };
  return { start, snapDate: snap ? snap.date : '', rate, pace, actual, planned, atActual: at(actual), atPlan: at(planned) };
}

function renderWlLoop() {
  const wrap = document.getElementById('wl-loop');
  if (!wrap) return;
  wrap.hidden = false;
  const store = wlLoopLoad(), txns = loadTxns(), today = todayISO();
  renderWlLoopPayday(store, txns, today);
  renderWlLoopRoad(store, txns, today);
  renderWlLoopDecisions(store, today);
  bindWlLoop();
}

function renderWlLoopPayday(store, txns, today) {
  const el = document.getElementById('wl-loop-payday');
  if (!el) return;
  const pd = wlPaydayAround(PLAN.payAnchor, today);
  const done = store.paydays.find(p => p.date === pd.last);
  let html = '<div class="card-title">Payday Loop <span class="wl-sub">paycheck of ' +
    escapeHTML(fmtDate(pd.last)) + ' · next ' + escapeHTML(fmtDate(pd.next)) + '</span></div>';
  if (done) {
    html += '<div class="wl-loop-done">✓ Done for this paycheck: ' + fmt(done.savings) + ' to <b>' +
      escapeHTML(done.to) + '</b>.</div><p class="wl-sub">The next split opens on ' + escapeHTML(fmtDate(pd.next)) + '.</p>';
    el.innerHTML = html;
    return;
  }
  const near = txns.find(t => t.type === 'income' && t.category === 'Paycheck' &&
    Math.abs(new Date(t.date + 'T00:00:00') - new Date(pd.last + 'T00:00:00')) <= 3 * 86400000);
  const net = near ? safeAmt(near.amount) : PLAN.netPerCheck;
  const s = wlPaydaySplit(PLAN, net, wlSavingsTotal(getLatestSnapshot()));
  html += '<p class="wl-sub">' + (near ? 'Paycheck logged: ' : 'Planned paycheck: ') + fmt(net) +
    '. One check covers half of each monthly amount.</p>';
  html += '<div class="wl-loop-save"><span>Savings → <b>' + escapeHTML(s.savings.to) + '</b></span><b>' +
    fmt(s.savings.amount) + '</b></div>';
  html += '<div class="wl-loop-rows">' + s.groups.filter(g => g.amount > 0).map(g =>
    '<div class="wl-row-head"><span>' + escapeHTML(g.label) + '</span><span class="amt">' + fmt(g.amount) + '</span></div>'
  ).join('') + '<div class="wl-row-head wl-loop-living"><span>Left to live on</span><span class="amt">' +
    fmt(s.living) + '</span></div></div>';
  if (s.short) {
    html += '<div class="wl-callout">This check is ' + fmt(s.shortBy) +
      ' short of the plan. Lower a group or the savings target in plan settings.</div>';
  }
  const checking = ACCOUNTS.filter(a => a.group === 'checking' && !a.deleted);
  html += '<label class="wl-loop-check"><input type="checkbox" id="wl-loop-logtx" checked> Also log the ' +
    fmt(s.savings.amount) + ' as a Savings Transfer from <select id="wl-loop-from">' +
    checking.map(a => '<option value="' + escapeHTML(a.id) + '">' + escapeHTML(a.label) + '</option>').join('') +
    '</select></label>';
  html += '<button type="button" class="btn btn-green" data-loop="payday" data-net="' + net + '">I moved it</button>';
  el.innerHTML = html;
}

function wlYmDiff(a, b) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5)) - Number(a.slice(5));
}

function renderWlLoopRoad(store, txns, today) {
  const el = document.getElementById('wl-loop-road');
  if (!el) return;
  const r = wlRoadNumbers(txns, today);
  const when = x => x ? '<b class="wl-road-date">' + escapeHTML(wlMonthLabel(x.ym)) + '</b> <span class="wl-sub">(' +
    (x.months / 12).toFixed(1) + ' yrs)</span>' : '<b>not within 100 years</b>';
  const logged = store.paydays.filter(p => p.paceDate).sort((a, b) => a.date.localeCompare(b.date));
  let moved = '';
  if (logged.length >= 2) {
    const diff = wlYmDiff(logged[logged.length - 2].paceDate, logged[logged.length - 1].paceDate);
    moved = '<p class="wl-sub">Since the payday before, your date moved ' + (diff === 0 ? 'not at all' :
      Math.abs(diff) + ' month' + (Math.abs(diff) === 1 ? '' : 's') + (diff < 0 ? ' earlier' : ' later')) + '.</p>';
  }
  const pressed = m => (wlRoadMode === m ? 'true' : 'false');
  el.innerHTML = '<div class="card-title">Road to $1M ' +
    '<span class="wl-loop-mode" role="group" aria-label="Money view">' +
    '<button type="button" data-loop="mode" data-mode="real" aria-pressed="' + pressed('real') + '">Today’s money</button>' +
    '<button type="button" data-loop="mode" data-mode="paper" aria-pressed="' + pressed('paper') + '">On paper</button>' +
    '</span></div>' +
    '<div class="wl-road-grid">' +
    '<div><div class="wl-sub">At what you actually kept (' + fmt(r.pace.net) + '/mo, last 3 months)</div>' +
    (r.pace.net > 0 ? when(r.atActual) : '<b>more came out than went in</b>') +
    '<div class="wl-sub">' + fmt(r.pace.moved) + '/mo moved in − ' + fmt(r.pace.out) + '/mo taken back out</div></div>' +
    '<div><div class="wl-sub">At your plan pace (' + fmt(r.planned) + '/mo)</div>' + when(r.atPlan) + '</div></div>' +
    moved +
    '<p class="wl-sub">Starts from ' + fmt(r.start) + ' in savings and investments' +
    (r.snapDate ? ' (snapshot ' + escapeHTML(fmtDate(r.snapDate)) + ')' : '') + '. Assumes ' + r.rate.toFixed(1) +
    '% a year ' + (wlRoadMode === 'real'
      ? 'after inflation, so $1M means today’s buying power'
      : '(your plan’s ' + PLAN.returnPct + '% after inflation + ' + WL_INFLATION_PCT + '% inflation)') +
    '. Markets vary year to year; this is an illustration, not a promise.</p>';
}

function renderWlLoopDecisions(store, today) {
  const el = document.getElementById('wl-loop-decisions');
  if (!el) return;
  const ag = wlLoopAgenda(store, today);
  const item = (d, extra) => '<div class="wl-dec"><div class="wl-row-head"><span><b>' + escapeHTML(d.what) +
    '</b></span><span class="amt">' + extra + '</span></div>' +
    (d.why ? '<div class="wl-sub">Why: ' + escapeHTML(d.why) + '</div>' : '') +
    (d.expect ? '<div class="wl-sub">Expected: ' + escapeHTML(d.expect) + '</div>' : '') + '</div>';
  let html = '<div class="card-title">Decisions <span class="wl-sub">decide, then check later whether it worked</span></div>';
  if (ag.decideSoon.length) {
    html += '<div class="wl-dec-h">Decide soon</div>' + ag.decideSoon.map(d =>
      item(d, (d.decideBy < today ? 'overdue · ' : 'by ') + escapeHTML(fmtDate(d.decideBy)))).join('');
  }
  if (ag.reviewsDue.length) {
    html += '<div class="wl-dec-h">Review now: did it do what you expected?</div>' + ag.reviewsDue.map(d =>
      item(d, 'decided ' + escapeHTML(fmtDate(d.date))) +
      '<div class="wl-dec-review"><input type="text" maxlength="500" placeholder="What actually happened?" ' +
      'aria-label="What actually happened" data-loop-outcome="' + escapeHTML(d.id) + '">' +
      ['better', 'as expected', 'worse'].map(x => '<button type="button" class="btn btn-ghost btn-sm" data-loop="rate" data-id="' +
        escapeHTML(d.id) + '" data-rating="' + x + '">' + x[0].toUpperCase() + x.slice(1) + '</button>').join('') +
      '</div>').join('');
  }
  const shown = new Set([...ag.decideSoon, ...ag.reviewsDue].map(d => d.id));
  const open = store.decisions.filter(d => !d.rating && !shown.has(d.id))
    .sort((a, b) => (a.decideBy || a.reviewOn).localeCompare(b.decideBy || b.reviewOn));
  if (open.length) {
    html += '<div class="wl-dec-h">Open</div>' + open.map(d => item(d, d.decideBy
      ? 'decide by ' + escapeHTML(fmtDate(d.decideBy)) : 'review ' + escapeHTML(fmtDate(d.reviewOn)))).join('');
  }
  if (!ag.decideSoon.length && !ag.reviewsDue.length && !open.length) {
    html += '<p class="wl-sub">Nothing due. Add a decision below when you make one.</p>';
  }
  html += '<details class="wl-dec-add"><summary>Add a decision</summary>' +
    '<label>What did you decide?<input type="text" id="wl-dec-what" maxlength="200"></label>' +
    '<label>Why?<input type="text" id="wl-dec-why" maxlength="500"></label>' +
    '<label>What do you expect to happen?<input type="text" id="wl-dec-expect" maxlength="500"></label>' +
    '<div class="wl-dec-row"><label>Review in<select id="wl-dec-review"><option value="3">3 months</option>' +
    '<option value="6" selected>6 months</option><option value="12">12 months</option></select></label>' +
    '<label>Decide by (optional)<input type="date" id="wl-dec-by"></label></div>' +
    '<button type="button" class="btn btn-green btn-sm" data-loop="add">Save decision</button></details>';
  const past = store.decisions.filter(d => d.rating).slice(-5).reverse();
  if (past.length) {
    html += '<div class="wl-dec-h">Reviewed</div>' + past.map(d => item(d, escapeHTML(d.rating)) +
      (d.outcome ? '<div class="wl-sub">Outcome: ' + escapeHTML(d.outcome) + '</div>' : '')).join('');
  }
  el.innerHTML = html;
}

function wlLoopUid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function wlLoopLogPayday(store, today) {
  const pd = wlPaydayAround(PLAN.payAnchor, today);
  if (store.paydays.some(p => p.date === pd.last)) return;
  const btn = document.querySelector('[data-loop="payday"]');
  const net = safeAmt(Number(btn && btn.dataset.net));
  const s = wlPaydaySplit(PLAN, net, wlSavingsTotal(getLatestSnapshot()));
  if (document.getElementById('wl-loop-logtx')?.checked && s.savings.amount > 0) {
    const from = document.getElementById('wl-loop-from')?.value;
    if (!ACCOUNTS.some(a => a.id === from && a.group === 'checking')) { showToast('Choose a checking account.', 'error'); return; }
    const txns = loadTxns();
    txns.push({ id: wlLoopUid(), date: today, type: 'expense', amount: roundMoney(s.savings.amount), account: from,
      toAccount: '', category: 'Savings Transfer', description: 'Payday Loop: savings to ' + s.savings.to, recurring: '' });
    saveTxns(txns);
  }
  const road = wlRoadNumbers(loadTxns(), today);
  store.paydays.push({ id: wlLoopUid(), date: pd.last, net, savings: s.savings.amount, to: s.savings.to,
    paceDate: road.atActual ? road.atActual.ym : '' });
  if (wlLoopSave(store)) showToast('Payday logged. Nice work.', 'success');
  renderWealthTab();
}

function bindWlLoop() {
  const wrap = document.getElementById('wl-loop');
  if (!wrap || wrap._wlBound) return;
  wrap._wlBound = true;
  wrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-loop]');
    if (!btn) return;
    const kind = btn.dataset.loop, store = wlLoopLoad(), today = todayISO();
    if (kind === 'mode') { wlRoadMode = btn.dataset.mode === 'paper' ? 'paper' : 'real'; renderWlLoop(); return; }
    if (kind === 'payday') { wlLoopLogPayday(store, today); return; }
    if (kind === 'add') {
      const v = id => (document.getElementById(id)?.value || '').trim();
      if (!v('wl-dec-what')) { showToast('Write what you decided first.', 'error'); return; }
      store.decisions.push({ id: wlLoopUid(), date: today, what: v('wl-dec-what'), why: v('wl-dec-why'),
        expect: v('wl-dec-expect'), reviewMonths: Number(v('wl-dec-review')), decideBy: v('wl-dec-by'), outcome: '', rating: '' });
      if (wlLoopSave(store)) showToast('Decision saved.', 'success');
      renderWlLoop();
      return;
    }
    if (kind === 'rate') {
      const d = store.decisions.find(x => x.id === btn.dataset.id);
      if (!d) return;
      d.rating = btn.dataset.rating;
      d.outcome = (wrap.querySelector('[data-loop-outcome="' + CSS.escape(d.id) + '"]')?.value || '').trim();
      if (wlLoopSave(store)) showToast('Review saved.', 'success');
      renderWlLoop();
    }
  });
}
