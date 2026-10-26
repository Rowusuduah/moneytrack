# Payday Loop — design (2026-10-25)

## Why
The owner has built many money tools that never produced a decision. Payday Loop turns each
paycheck into one confirmed decision, keeps a dated journal of money decisions, and reviews
them later. It builds on the existing Wealth plan (pay, payday, groups, savings target,
milestone ladder) instead of adding a new system.

## Goals
- **Payday card:** for the current pay period, show the split of one paycheck: each plan
  group's per-check share, the savings share routed to the first unfilled milestone (then
  "Long-term" once every milestone is full), and what is left for living. "I moved it"
  logs the payday; optionally it also logs the savings share as a Savings Transfer expense,
  matching the owner's existing convention.
- **Road to a target ($1M by default):** months and date to reach the target from the
  latest snapshot's savings + investments, at (a) the actual pace (average moved to
  savings & investments over the last 3 full months) and (b) the plan pace. Two views:
  "today's money" (real return from the plan) and "on paper" (real + inflation, default 3%).
  Each logged payday stores the actual-pace date, so the card shows how the date moved.
- **Decisions:** a dated journal (what, why, expected result, review in 3/6/12 months,
  optional "decide by" date). Upcoming decide-by dates and due reviews appear first. A review
  records the outcome (better / as expected / worse) and a note.

## Non-goals
Picking investments; Millionaire Lab (historical replay) and Market Brief — designed in the
owner's plan document as later phases, built only after the Loop is used on two paydays.

## Constraints
- No personal values in source, tests or docs. Data lives in `moneytrack_loop_v1`
  (localStorage), is in `BACKUP_KEYS`, and every save queues Drive sync (record arrays carry
  `id`, so the existing three-way merge applies).
- Pure functions stay DOM-free in `js/wealth.js` and are unit-tested in Node.
- Shown only when the Wealth plan is configured; otherwise the Wealth setup prompt stays.
- All user strings through `escapeHTML()`; money through `roundMoney()`/`fmt()`.

## Pure functions
- `wlMonthsToTarget(start, monthly, annualPct, target)` → months (0 if already there), or
  null if not reached within 100 years.
- `wlPaydaySplit(plan, net, savingsTotal)` → `{ groups:[{id,label,amount}], savings:{amount,
  to}, living }`, per check = monthly / 2; savings routed down the milestone ladder.
- `wlLoopNormalize(raw)` → `{ paydays:[], decisions:[] }` with validated fields.
- `wlLoopAgenda(store, todayIso)` → `{ decideSoon:[], reviewsDue:[] }` (decide-by within 30
  days or overdue; reviews whose date has passed without an outcome).
