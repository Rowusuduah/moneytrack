# Card Flow, Treating Friends & Live Card Balance — Design Spec

**Date:** 2026-07-26
**Status:** Approved by Richmond (brainstorming session)

## Problems being solved

1. **Double-counted spending.** A Discover purchase is logged as an expense
   (with details) and the later statement payment is logged as a second
   expense under "Credit Card Payment" — the Tracker/Analysis count the same
   money twice. `NON_EXPENSE_CATS` (app.js:73) excludes only `Bill Reserve`
   and `Loan Payment`.
2. **No pile-up view.** Richmond wants to log card purchases with full
   details on the day he buys (that's when he has them), watch what he owes
   on Discover grow, and have nothing "deducted" until he pays the statement.
3. **Treating friends** inflates his personal Dining Out budget; the whole
   bill is his own spending (no repayment tracking wanted — confirmed).

## Decisions made

| Question | Decision |
|---|---|
| Group outings | Always his treat → new dedicated category, no owed-by-friends tracking. |
| Treat category | New `Treating Friends` (not reusing Friends Support, not Dining Out). |
| Card pile-up | Yes — live "Owed now" per debt account on the Debt Details card. |
| Card charge data model | Plain expense txns on the card account (NO new transaction type). |
| KPIs / Net Worth | Unchanged — stay snapshot-based. "Owed now" is a live view only. |

## 1. Double-count fix + card conventions

- `NON_EXPENSE_CATS` becomes `new Set(['Bill Reserve', 'Loan Payment', 'Credit Card Payment'])`.
  Every Tracker/Analysis consumer already filters through this set; no other
  call sites change. (wealth.js already excludes it — now consistent.)
- Convention (documented in CLAUDE.md): purchases are logged at buy time as
  `type: 'expense'`, `account: <card>` with the real category and details;
  the statement payment is `type: 'transfer'` from checking → card. A
  legacy-style `Credit Card Payment` expense stays harmless (excluded from
  spending) and still counts as a payment for "Owed now" (see §3).

## 2. Treating Friends category

- `index.html`: `<option value="Treating Friends">Treating Friends</option>`
  next to the Family/Friends Support options in the category select.
- `CATEGORY_COLORS` (app.js): `'Treating Friends': '#e879f9'` (support family).
- `WEALTH_CATEGORY_MAP` (wealth.js): `'Treating Friends': 'protect'`
  (Protection & obligations group on the Wealth board).
- Budget card `expenseCats`: add `Treating Friends` so it can be capped.

## 3. Live "Owed now" per debt account

New pure function in app.js (unit-testable via the app.test.mjs harness):

```js
// Live card balance: last snapshot's figure plus charges logged since,
// minus payments since. Snapshot day itself is already in the snapshot.
function cardOwedNow(account, snap, txns, debtAccountCount) →
  { owed, base, charges, payments, since }
```

Rules:
- `base` = `safeAmt(snap.accounts[account.id])`; `since` = `snap.date`.
  With no snapshot: `base = 0`, `since = ''` (all txns count).
- `charges` = sum of txns with `type === 'expense'`, `account === account.id`,
  `date > since`, category NOT `Credit Card Payment` (paying one card with
  another is out of scope).
- `payments` = sum of txns with `date > since` that are either
  `type === 'transfer' && toAccount === account.id`, or (only when
  `debtAccountCount === 1`) `type === 'expense' && category === 'Credit Card Payment'`
  regardless of source account (legacy habit attribution is unambiguous with
  a single card).
- `owed` = `roundMoney(base + charges − payments)` — no clamping; honest math.
- All sums via `safeAmt`, result via `roundMoney`.

Display — in `renderDebtDetails()`, each debt card gains under its header:

```
Owed now: $296.40
snapshot $210.00 (Jul 20) + $86.40 charges − $0.00 payments
```

- "Owed now" value styled like the existing debt balance (red); breakdown in
  muted small text. When there are no charges and no payments since the
  snapshot, show only "Owed now" equal to the snapshot figure without the
  breakdown line (no noise).
- The existing APR/min-payment stats keep using the snapshot balance
  (unchanged) — payoff math stays tied to the recorded statement balance.
- Net Worth, KPIs, NW trend, exports: untouched.

## 4. Tests & plumbing

- `tests/app.test.mjs` additions: `cardOwedNow` (base+charges−payments; no
  snapshot; strictly-after-date boundary; transfer payments; single-card
  Credit Card Payment attribution; multi-card ignores legacy payments;
  Credit Card Payment charges on the card itself excluded) and a regression
  test that `NON_EXPENSE_CATS` contains all three categories.
- `tests/wealth.test.mjs`: existing category-map test automatically covers
  the new `Treating Friends → protect` entry.
- `sw.js`: cache bump to `moneytrack-v18` (index.html/app.js/wealth.js change).
- `CLAUDE.md`: card-flow conventions paragraph (purchases at buy time on the
  card account; statement payment as transfer; Credit Card Payment excluded
  from spending everywhere).

## Out of scope

Owed-by-friends/split-bill tracking, a new "card charge" transaction type,
statement periods/due dates for cards, interest accrual in "Owed now",
multi-card attribution of legacy Credit Card Payment expenses.
