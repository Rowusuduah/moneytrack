# MoneyTrack — CLAUDE.md

## Project Overview

MoneyTrack is a personal finance tracker built as a pure vanilla HTML/CSS/JavaScript SPA with no framework, no build tooling, and no backend. App data is persisted in `localStorage`; an optional Google Drive connection syncs it between devices.

## File Structure

```
Finance Tracker/
├── index.html        # Full app markup — semantic HTML, ARIA roles, tab structure
├── css/
│   └── styles.css    # Design tokens (CSS variables), layout, components, responsive
├── js/
│   ├── app.js        # Core app logic — config, data layer, rendering, events
│   ├── wealth.js     # Wealth tab — PLAN config, category map, live plan renderers
│   └── africa.js     # Africa tab — GHS/USD investments, manual FX rate, renderers
└── tests/
    ├── wealth.test.mjs   # Node unit tests for wealth.js pure functions (node --test)
    └── africa.test.mjs   # Node unit tests for africa.js pure functions (node --test)
```

## Architecture

### Single source of truth for accounts
The `ACCOUNTS` array in `js/app.js` (line 10) is the **only** place account definitions should live. Account IDs, labels, groups (`checking` / `savings` / `debt`), and colors all come from here.

- Do NOT hardcode account IDs (`chase_checking`, `usf_checking`, etc.) elsewhere in the codebase
- Account `<select>` dropdowns (`#txn-account`, `#filter-account`) must be populated dynamically from `ACCOUNTS`
- KPI calculations, NW trend, and export must derive group totals using `.filter(a => a.group === '...')` on `ACCOUNTS`

### Private Wealth plan
`WL_EMPTY_PLAN` in `js/wealth.js` is a zero-valued public schema, not a real
person's plan. Real plan values are imported or edited in the Wealth tab and
stored under `moneytrack_wealth_plan_v1` in browser `localStorage`. The user can
export/import a private JSON backup; the plan is also included in MoneyTrack's
Drive sync and regular JSON export. Drive backups are not encrypted. Never put real pay, allocations, milestones,
or personal immigration/tax details in source, tests, docs, or any deployed file.
`WEALTH_CATEGORY_MAP`
in the same file maps transaction categories to plan groups; a category missing
from the map shows up in the Wealth tab's "not counted" footer — add it to the
map rather than special-casing renderers. Top-level code in wealth.js must stay
DOM-free and app.js-free so `node --test` (run from the repo root) keeps working.
The Wealth tab's Day/Week/Month/Year toggle scales allocations by annualized
factors (12/365.25, 12/52, 1, 12); weeks run Sunday–Saturday; paid chips are
Month-view only. The Tracker Budget card's "Fill from Wealth plan" button
merges `wlPlanBudgets()` (bill-level amounts, first category per bill) into
the saved budgets — it never clears categories the plan doesn't price.

### Lock screen (email code)
`js/email-login.js` is synced from the private `login-codes` repo; never edit it here, re-run
`node scripts/sync-client.mjs` there. "Email me a code" sends a 6-digit code to the owner's
Gmail; a correct code stores a signed 30-day pass in `rowusuduah_login_pass_v1`, shared with
Deadline Tracker and FE Civil on the same origin (Lock in any of them locks all three). A
recovery key (kept offline by the owner; only its SHA-256 is in code) unlocks one page load.
This gate is not encryption: localStorage data and exported or Drive backups need separate
protection.

### Africa investments
The Africa tab (`js/africa.js`, storage key `moneytrack_africa`) tracks
Ghana/Nigeria investments in their own currency (GHS or USD) — amounts are
never converted at rest. One manual rate (GH₵ per 1 USD) powers the
estimate lines and the Accounts-tab "Africa (est.)" / "Global Total" KPIs;
Africa money never enters `calcNetWorth`, snapshots, the NW trend, or
CSV/PDF exports. Top-level africa.js code stays DOM-free so `node --test`
keeps working. Every saved rate is also recorded in `rateHistory` (one point
per day, same-day saves replace); the Africa tab charts it and notes cedi
movement — estimates always use the latest rate only.

### Credit-card flow
Card purchases are logged at buy time as expenses on the card account with
their real category — that is when they count as spending. The statement
payment is a transfer checking → card (a legacy 'Credit Card Payment'
expense is tolerated: NON_EXPENSE_CATS keeps it out of spending, and with a
single debt account it counts as a card payment). `cardOwedNow()` renders
the live per-card balance on Debt Details; KPIs and Net Worth stay
snapshot-based.

### Income and savings-spend gateways
Every income/expense total must go through `isRealIncome()` / `isRealExpense()`
in app.js — never re-implement the type/category checks inline.
`NON_INCOME_CATS` ('Money from Last Month', 'Loan Repaid to Me') keeps the
monthly carryover and returned personal loans out of income totals: neither is
new earnings, so counting them would inflate yearly income. The matching
'Loan Given' category is in `NON_EXPENSE_CATS` — lending money out is an
asset move, not spending. The Tracker's carryover line counts only
'Money from Last Month', never other excluded income. An expense whose account
group is `savings` (`isSavingsSpend()`) is not monthly spending, so it is
excluded from Money Out / Net / budgets / savings rate and still appears in the
Spending-by-account breakdown, which is account-oriented on purpose. Accounts,
Tracker, and Analysis show logged outflows from savings accounts immediately:
expenses and transfers whose source is savings. For a selected
week/month/year/custom period, compare the first saved snapshot inside that
period with its latest saved snapshot. Add only the balance decrease that is
not explained by logged outflows between those snapshots, per account; this
prevents counting the same withdrawal twice. A single dated snapshot cannot
establish a balance decrease, but logged withdrawals still appear. Snapshot-only
withdrawal percentages divide by the starting snapshot balance. Current periods
end today, so future-dated snapshots and transactions cannot enter today's
figures. Analysis "Moved to savings & investments" counts transfers into those
groups from outside them, as well as legacy Savings Transfer/Investment expenses;
internal moves between savings and investments are not new contributions.

### Add sheet, Coming up, backups (everyday flows)
- **Add / edit sheet.** `#txn-form-card` is a dialog sheet, not a Tracker card. It opens from the
  + button (`#fab-add-txn`, hidden on Things and Africa), the Accounts quick action, a transaction row
  (edit) or a bill's Mark paid. The hidden/native selects (`#txn-type`, `#txn-category`, `#txn-account`,
  `#txn-date`) stay the source of truth and `saveTransaction()` still validates them; chips only set
  them. `saveTransaction()` returns the saved id or null. Typing a description fills category and
  account from `txnSuggestion()` (your most common past combination) unless you already picked one.
- **Transactions list.** `renderTransactionLog()` groups by day (`groupTxnsByDay`); one row per
  transaction with `data-edit`; delete lives inside the edit sheet. Type chips mirror `#filter-type`.
- **Coming up (bills).** A bill marked paid stores `paidThrough` (the due date paid), `lastPaidOn`
  and `lastPaidTxn`; `billDueDate()` is then the first date after `paidThrough` (can be overdue).
  Bills never marked paid keep the old next-date-on-or-after-today behaviour. Mark paid logs today's
  transaction via `billTemplate()` (past entries with the bill's name, else `BILL_KEYWORDS`); if
  amount, category or a live account is missing it opens the sheet prefilled instead. Undo removes the
  logged row and restores the bill. Delete is behind Manage bills.
- **Backups.** `moneytrack_last_change` (set by `queueDriveSync()`, which every data save calls) and
  `moneytrack_last_backup` (set on any Drive save/load success and on Export JSON) are device-local
  and deliberately NOT in `BACKUP_KEYS`. The banner shows when there is data and no backup, or changes
  newer than a backup over 7 days old (`backupState`). `init()` asks for persistent storage.

### Safe to spend until payday
The card sits between the net worth hero and the account list (`#safe-card`, rendered by
`renderSafeToSpend()` from `renderAccountKPIs()`). Amount = `checkingNow()` (latest snapshot's
checking accounts plus checking activity logged after it; 'Money from Last Month' is not new money)
− `billsDueBefore()` (unpaid bill dates strictly before payday, overdue included, card-payment bills
skipped via `cardPaymentBillIds()` because the card balance is counted in full) − `cardsOwedNow()`
(live, like Debt Details) − `savingsPlanDue()` (the Wealth plan's monthly savings target over the pay
period, minus transfers into savings accounts since the last payday). `nextPayday()` uses the Wealth
plan's biweekly `payAnchor`, else the rhythm of past 'Paycheck' income (weekly, biweekly or monthly).
Every row of the math is shown on the card; keep it that way so the number is never a mystery.

### Cross-device sync
- `js/sync-merge.js` performs a pure three-way merge of local data, the last synced
  baseline, and the Drive backup. Entity arrays merge by ID; snapshots and rate
  histories merge by date; same-field conflicts and delete/edit conflicts stop
  sync instead of choosing a winner. Unit coverage: `tests/sync.test.mjs`.
- `js/drive-sync.js` stores the baseline in IndexedDB (`moneytrack-sync`) and
  uses Google Drive `MoneyTrack_Backup.json`. It reads all same-named app-created
  copies (older devices could have cached different file IDs), merges compatible
  records, and writes the merged copy to each. It syncs on changes,
  on open, on return online/foreground, and every minute while visible. The
  baseline also holds the prior state of an unconfirmed upload, so a concurrent
  overwrite can be detected and merged on the next read.
- All keys in `BACKUP_KEYS`, including Things custom categories and the private
  Wealth plan, must queue sync when saved. `Replace from Drive` is an explicit
  recovery action; it makes a local safety copy first. Never silently replace
  local data or clear site storage to troubleshoot sync.
- Both devices must use the same Google account. The email-code login is only a
  screen gate; it does not authenticate or encrypt Drive data.

### Data layer
- `loadSnapshots()` / `saveSnapshots()` — account balance snapshots
- `loadTxns()` / `saveTxns()` — transactions
- Both wrap localStorage in try/catch to handle incognito/quota errors gracefully

### Rendering model
- Each tab has a top-level render function: `renderAccountsTab()` and `renderTracker()`
- These orchestrate child render functions; all child functions accept pre-fetched data as arguments
- `getFilteredTxns()` is the single filter gateway — call it once per render cycle, pass the result down
- `renderTracker()` must be called in `init()` so the tracker section is pre-populated

### Security
- All user-controlled strings rendered into HTML must go through `escapeHTML()`
- Colors injected into inline styles must come from the `ACCOUNTS` config or `CATEGORY_COLORS` map — never directly from user input
- No `eval()`, no `innerHTML` with raw user strings

### IDs
- All entity IDs (transactions, loans, bills, goals, things) use `crypto.randomUUID()`

## Coding Conventions

- `'use strict'` is enabled globally
- Money values: always pass through `roundMoney()` before saving; use `fmt()` for display
- Dates: stored as ISO `YYYY-MM-DD` strings; use `todayISO()` for the current date; parse with `new Date(iso + 'T00:00:00')` to avoid UTC offset issues
- CSS: use existing design tokens (`var(--green)`, `var(--surf2)`, etc.) — do not hardcode color hex values in new code
- Inline styles in HTML: avoid adding new ones; prefer CSS classes

## Accessibility Requirements

- All interactive icon-only buttons must have `aria-label`
- Dynamic regions that update in place must have `aria-live="polite"`
- Decorative charts must have `aria-hidden="true"`
- Tab keyboard navigation: Arrow Left/Right to move between tabs (already implemented)
- Maintain the skip link (`<a class="skip-link" href="#main">`)

## No Build Tooling

This project has no `package.json`, no bundler, no transpiler. Files are served as-is. Do not introduce dependencies without explicit discussion.
