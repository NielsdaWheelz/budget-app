# budget history

status: implemented in `feat/budget-history`; local verification and release
instructions live in [budget-history-operations.md](budget-history-operations.md).

## target and ownership

send receipts to jarvis → jarvis submits evidence and structured data → budget
stores expenses/refunds → both clients read the same categorized monthly/yearly
plan, recorded spending, and difference. browser uploads and manual entry use
the same financial boundary. originals and pending work survive jarvis outages.

jarvis owns acquisition, extraction, matching judgment, scheduling, retries,
and its authority to act. budget owns accepted facts, evidence, revisions,
access control, replay safety, and reports. no jarvis implementation changes
or dependency on its forthcoming inbox capabilities.

keep the existing income/tax/scenario calculator as the working planner.
exclude shared expenses, payroll actuals, accounts/balances, transfers,
reconciliation, accrual accounting, bank sync, recurring forecasts, currency
conversion, category administration, and local model/worker infrastructure.

## financial contract

- usd only. money is safe integer cents, including aggregate results. transaction
  amounts and allocations are positive; `kind = expense | refund` supplies the
  reporting sign. reject decimals, overflow, zero transactions, and other currencies.
- `date` is a validated calendar date, `yyyy-mm-dd`, never an upload timestamp or
  timezone-converted instant. card purchases count on purchase date; later card
  repayments do not count. unpaid invoices remain pending. record actual paid
  portions on their payment dates; do not infer payment from an invoice.
- allocations are nonempty, have distinct category keys, and sum exactly to the
  amount. use the existing spending-category keys plus `null` for uncategorized.
  refunds reduce spending on their refund date, even below zero; the original
  expense link is optional. corrections revise mistaken facts; refunds are new facts.
- freeze monthly expense amounts, labels, and groups when a plan is adopted.
  planner/scenario edits cannot change adopted months. explicit month amendments
  require a reason and revision; retain the original and every amendment.
- a complete plan has every spending category, including explicit zeros and an
  uncategorized zero. missing month plans are absent, never synthesized from
  today's template. payroll deductions/savings are outside this comparison;
  directly paid expenses still count, under a supported category or uncategorized.
- `recorded = expenses − refunds`; `difference = recorded − planned`. voided
  transactions contribute nothing. changing a transaction date moves its contribution.
  no income-minus-recorded figure may be labeled actual savings.

## schemas and storage

use effect schemas at ingress/egress; reject unknown request fields. use branded
ids/cents/dates internally. follow [database.md](database.md) for storage shape and
foreign keys. new rows use uuidv7 ids, `created_at`, and `extra`.

| table | owned data and identity |
| --- | --- |
| `planner_templates` | existing monthly calculator state, `revision`; unique owner. retain income/deduction/scenario inputs and view period |
| `month_plans` | owner, `month`, `revision`, adopted planner revision, `lines[{category_key,label,group,planned_cents}]`; unique owner/month |
| `transactions` | owner, `date`, `kind`, `amount_cents`, currency, payee, optional note/payment reference/original-expense id, `allocations[{category_key,amount_cents}]`, `revision`, `voided`, `owner_protected` |
| `sources` | owner, namespace, external key, filename/label, media type, original bytes, sha256, optional external reference, `extraction_complete`, `revision`; unique owner/namespace/key |
| `source_items` | source id, stable item key, `revision`, proposed fields, review reason, optional correction target, resolution, accepted input/outcome, optional transaction id; unique source/item key |
| `changes` | owner, entity kind/id, revision, accepted snapshot, authenticated actor, reason, command key; unique kind/id/revision. append revisions; no event-replay dependency |
| `command_receipts` | owner, client identity, opaque key, normalized request digest, final status/body; unique owner/client/key. no expiry in this prototype |

snapshots/outcomes reference originals by id/digest; never copy bytes into audit
or list responses. proposals are partial observations, separate from the strict
accepted-transaction schema; they may retain unreadable amounts/foreign currency.

store allocations and plan lines as validated jsonb; queryable transaction fields
stay columns. one source item resolves to one transaction; multiple items support
multiple transactions, and multiple sources can support the same transaction.
source-item links replace a redundant attachment-link table. manual entries need
no source. original source content is immutable; differing content under the same
external identity conflicts.

source namespaces include connector/account identity. item keys identify stable
document entries, not request attempts. browser upload keys derive from the file
digest. equal merchant/date/amount is NEVER a uniqueness constraint. offer matching
filters; jarvis or the owner decides whether another document supports an existing
event. distinct purchases with identical details remain possible.

pending source items retain partial observations and a concrete reason:
`unreadable | payment_unconfirmed | possible_duplicate | correction_conflict |
unsupported_currency`. unknown category alone does not block a paid expense.
transitions are `pending → pending | recorded | linked | ignored`; create may enter
any state. ordinary imports cannot demote/retarget settled items. owner `reopen`
moves ignored → pending. owner `relink(id,target_revision,reason)` moves recorded/
linked → linked: revise only the evidence association, retaining prior history.
store its replacement accepted operation as `link`; a fresh `record` then conflicts.
relinking neither corrects nor voids the former transaction. old command replay
returns a historical acknowledgement and never restores an old association.

## api and composition

extend the existing effect http api; derive its api description from those schemas.
browser cookies and separate high-entropy
read/write bearer credentials resolve to the same existing owner. configure only
token digests and the owner mapping server-side; derive actor/client/scope from
authentication, never payload fields. client identity is stable per owner:
`browser` or `jarvis`; both bearer scopes share `jarvis`, across rotation. rotation/
revocation is configuration plus redeployment. cookie mutations require same-origin
validation; bearer requests do not inherit cookie privileges. credentials and
originals never enter logs.

read scope fetches catalog, plans, transactions, reports, sources, pending items,
and command outcomes. write scope additionally uploads evidence, resolves imports,
and creates transactions through imports or amends unprotected transactions.
source-free creation, planner/plan changes, voiding, source-item relinking/reopening, and
protected corrections require the owner session. owner creation/edit sets
record-level protection permanently; clients cannot supply protection, ownership,
actor, or assigned revisions. new extraction can propose a correction, never
overwrite it. evidence linking remains allowed.

all routes below have `/api` prefix. `get` is read-only. mutation bodies use the
shared schemas; `expected_revision` is required for updates (`null` means create
only). revisions start at 1. return the committed record/id/revision.
lists use keyset pagination, 100 rows maximum: transactions by descending date/id,
sources by created-at/id, changes by revision. every query enforces owner scope.

| endpoint | contract |
| --- | --- |
| `get /auth/me` | session identity, independent of whether a planner exists |
| `get /catalog` | stable category keys, labels/groups, currency, input limits |
| `get`, `put /planner` | missing or current template; explicit revisioned save |
| `get`, `put /plans/:month` | missing or current plan; adopt a checked planner revision or submit complete explicit amounts; amendments require reason |
| `get /reports?period=yyyy-mm\|yyyy&through_month=…` | canonical comparison; optional cutoff only for year queries |
| `get /transactions` | date range `[from,until)`, category, payee/amount matching filters, cursor; default/max page size 100 |
| `get /transactions/:id`, `post /transactions`, `put /transactions/:id` | detail/owner manual create/full revisioned correction; positive amount + kind; corrections require reason; owner may set voided |
| `post /sources`, `get /sources`, `get /sources/:id`, `get /sources/:id/content` | persist originals; list pending or filter source identity/digest; detail includes items and links |
| `post /sources/:id/complete` | revisioned extraction completion, including zero items; afterward, only owner may add missed item keys |
| `post /imports` | one source item: `record(transaction)`, `link(id,revision)`, `hold(proposal,reason,target_id?)`, `ignore(reason)`, or owner `reopen(reason,review_reason)`/`relink`; source/item revisions required |
| `get /commands/:key` | durable outcome in the authenticated client's namespace, or absent |
| `get /changes?entity_kind=…&entity_id=…` | owner-scoped revision history; paginated |

upload → resolve each stable item → complete extraction. source and item revisions
advance independently; completion is monotonic and does not settle pending items.
existing pending items remain resolvable after completion. correction proposals
cannot create another expense; only owner may change their target. each step is
a separate commit: a crash leaves a visible pending original, never a claimed transaction
without its evidence link. no network/model work inside a commit.

source upload accepts pdf, jpeg, png, webp, or utf-8 text: base64 original plus
metadata, maximum 2 mib decoded and 3 mib total request. reject oversize with 413;
never silently truncate/recompress. serve originals authenticated, as downloads
with `nosniff`, rather than executing uploaded content. this stays below the
[vercel request/response limit](https://vercel.com/docs/functions/limitations).
bound labels/payees/namespaces/external keys/item keys to 200 utf-16 code units, other text
to 2000, and each partial proposal to 16 kib of serialized utf-8 json. publish
these limits in the catalog; reject oversize fields with 422, never truncate.
this bounds paginated metadata/audit responses as well as original downloads.

every financial/evidence/planner mutation requires an idempotency key, scoped to
owner/client and bound to method, target, and normalized payload. authenticate,
authorize, then replay a matching receipt BEFORE checking current revisions.
same key/different input returns 409. source/item identity independently prevents
new-session duplication. `record` on a settled item returns its recorded outcome
for identical normalized financial input (excluding command key/revisions),
otherwise conflict; it never reapplies old values. `link` requires an existing
owned, nonvoided transaction. ignored items require owner reopening before acceptance.

one short serializable postgres transaction owns domain validation, revision and
protection checks, financial writes, source-item outcome, audit snapshots, and
command receipt. retry recognized serialization/deadlock/identity races at most
three attempts; classify unrelated database failures as defects. read reports
from one consistent database snapshot. use the installed effect/sql transaction
primitive; do not build a coordinator or split this atomic owner across services.

errors have a stable tagged code, message, and field issues: malformed input 400,
unauthenticated 401, scope/protection denied 403, absent record 404, identity/revision
conflict 409, oversized 413, invalid financial input 422. unexpected/exhausted
infrastructure failures are logged defects and generic 500 responses, never empty
data. after a lost response, the caller queries/replays the same key. successful
import outcomes are `recorded | linked | pending | ignored`; replay returns the
original status/body. pending/ignored outcomes are also durable.

## reports and designed content

report schema: period, explicit `from`/`until`, currency, included months,
missing-plan months, plan revisions, transaction count, awaiting-extraction source
count, pending-item count, and rows
`{category_key,label,planned_cents|null,recorded_cents,difference_cents|null}`.
include uncategorized in totals. month differences require that month's plan;
year differences require plans for every included month. return known planned
subtotal separately when coverage is partial. zero recorded is a net amount;
only transaction count zero means no entries. neither proves completeness.
inbox counts include originals with no extracted items, separate from pending items.

year queries default to january–december, except the current year defaults to
january–current month. `through_month` is a month number 1–12 selecting the last
included month; december requests the full year. label the actual range. the
current month is not prorated. choose default calendar context in utc; financial
dates remain explicit. every annual figure sums its constituent months; never
use the calculator's annualization helpers. category drilldown uses those same
boundaries and returns contributing nonvoided transactions with their signed
selected-category contribution alongside the full transaction amount.

the designer owns each content contract below before implementation; every row
gets adversarial review. reuse the 720px layout, theme tokens, compact cards/rows, and
tabular numerals. add planner/history/inbox navigation and a transaction detail
panel; no dashboard redesign.

| feature | good content and acceptance |
| --- | --- |
| plan adoption | show month, category amounts, total, and source revision. “use current plan for september 2026.” amendment preview shows old/new amounts and “changes september only.” unsaved templates must be saved first |
| comparison | columns “category · planned · recorded · difference”; compact `+$15.95` has accessible text “$15.95 over plan.” negative is under; zero matches. never use color alone. show “no plan,” “plan saved for 8 of 12 months,” and “september is in progress” where applicable |
| history/detail | payee, date, amount, category, source, correction history. “record refund” explains its refund-date effect; “remove from spending” voids without deleting history. explicit save/cancel; preserve failed drafts. splits show total/assigned/remainder; exact decimal input |
| evidence/review | filename, received time, original download, proposed fields, linked records, specific reason. “2 documents awaiting extraction · 1 item needs review.” actions save/link/keep pending/ignore; owner can reopen, change a link, or add a missed item. correction conflicts require “review existing transaction,” then correct/link; never create another expense |
| api/errors | stable codes plus actionable copy. conflicts: “this transaction changed elsewhere. review the latest version.” loading failures replace the relevant surface with retry while retaining the selected period; they never appear as no data |

## implementation ownership and files

paths below are proposed additions unless named as existing. agree schemas first;
then these work packages own disjoint implementation files. the integration owner
alone edits shared wiring. every package follows red → green → refactor and receives
adversarial review at contract, oracle, implementation, and cutover stages. reviewers
must name a falsifying counterexample; unresolved correctness objections block merge.

| package / owner | files and responsibility | canonical proof boundary |
| --- | --- | --- |
| 1. financial domain | `src/domain/history.ts`, existing `money.ts`, `src/config/budget-config.ts`; exact arithmetic, dates, plan projection, report semantics | colocated bun kernel proof |
| 2. persistence | `src/server/history-store.ts`, `src/server/migrations/00002_budget_history.ts`; all seven tables, atomic mutations, replay, audit, consistent reads | real postgres service proof through store contract; separate migration proof |
| 3. integration | existing `src/shared/schemas.ts`, `src/server/{api,handlers,main}.ts`, `src/server/bin/migrate.ts`, `src/web/api-client.ts`; add `src/server/history-handlers.ts`; auth, http mapping, dependency wiring | real http + postgres capability proof using published schemas |
| 4. interface/content | existing `src/web/{app,main}.tsx`, `src/web/hooks/use-budget.ts`, `src/web/helpers/{format,error-message}.ts`, `src/web/components/{inline-edit,segmented-control}.tsx`; add `src/web/history.tsx`, `transaction-editor.tsx`, `evidence-inbox.tsx` | real chromium feature proof with schema-valid http fixtures |
| 5. verification/release | `package.json`, lockfile, `bin/build.ts`, `tests/`, `playwright.config.ts`, `.env.example`, docs; commands, local infrastructure, one wiring journey, release evidence | one thin browser → real api → postgres journey; restore/migration proof owns persistence recovery |

implemented integration separates wire schemas/errors into
`src/shared/history-{schemas,errors}.ts`, authentication into `src/server/auth.ts`,
hosting into `src/server/app.ts`, serializable transactions into
`src/server/database.ts`, and the migration runner into `src/server/migrations.ts`.
the unused `src/domain/period.ts` and `money.negate` are removed.

reuse scenario calculation for monthly plan adoption and existing cents/category
schemas after strengthening them. reuse the http client, replacing unchecked
decoding and catch-all “no budget.” consolidate identical signed-format helpers
and the duplicated inline-edit formatter. add a separate delta formatter with
explicit positive sign. replace partial decimal parsing with one exact money
parser shared by planner and transaction inputs. actuals must not call payroll,
tax, savings, or annual-scaling services.

use solid router for url-owned view/period/category/selected-transaction state and
route loading, per [frontend.md](frontend.md); update deployment rewrites for
direct navigation without routing unknown api paths to the app. no second state
framework. replace planner debounce autosave with explicit revisioned save.

scoped substitution for the absent coordination framework referenced in
[operation-types.md](operation-types.md) and [database.md](database.md): implement
the required atomicity/replay semantics with the postgres owner above.

## acceptance and verification

keep tests light: bun, dedicated local postgres, playwright/chromium. each boundary
owns its cases once; the journey proves composition. use the independent oracles
below and retain red/fault → green evidence. no production data, owned-code mocks,
arbitrary sleeps, automatic test retries, snapshots, or coverage quotas. most
confidence comes from service proofs; add a small kernel and one thin journey.
add `bun run test` and `bun run test:browser`; cutover also runs existing check/build
and a new `bun run typecheck` (`tsc --noEmit`). no general testing framework.

- domain oracle: september groceries plan 50000; expense 51595 dated september
  30, uploaded october 3 → september 51595, difference +1595. october refund
  2000 → october −2000, never a september rewrite. split 3000+21595 sums to
  24595; 3000+21594 fails. reject invalid dates, unsafe cents, and non-usd input.
- plan/report oracle: september plan survives planner/scenario changes; explicit
  amendment records both versions. september 50000 + october 60000 = 110000,
  regardless of today's template. missing plan suppresses the affected aggregate
  difference; uncategorized spend remains counted. expense 2000 + refund 2000
  gives net 0/count 2. a 10000 expense split 9000/1000 contributes only 9000 to
  the first category's drilldown; contributions sum to the row.
- persistence oracle: concurrent identical requests and lost-response replay
  produce one transaction, link, and revision. changed input conflicts. new command
  key for a settled source item cannot duplicate or resurrect it. two genuinely
  distinct identical-looking purchases survive. stale writes fail; an owner edit
  survives even an importer holding the latest revision. force failure before
  commit: no partial financial/audit/outcome state remains. owner relinking changes
  only evidence; automated replay cannot restore the former association.
- http oracle: read credential cannot mutate; write credential cannot edit plans,
  void, or overwrite protected records; another owner cannot read any record,
  original, or command outcome. malformed/oversized input fails without writes.
  saved originals remain readable while jarvis is absent. 401/404/500 stay distinct.
- interface oracle: positive/negative/missing differences remain intelligible
  without color; keyboard editing and split remainder work; failed/conflicting
  saves retain input; reload/back/deep links preserve report context.
- journey oracle: owner adopts a plan, integration records a source-backed
  expense, browser sees the same report and opens its source. no live jarvis/model.
- cutover oracle: migrate a populated old planner without changing its effective
  values or fabricating history; fresh install reaches the same schema. restore a
  synthetic database backup locally and recover the original digest, accepted
  transaction, audit, and replay outcome. this is not a production recovery claim.

## cutover, final state, and deliberate costs

take a backup, stop writes, run the one-time migration, then deploy matching api
and ui together. rename/migrate `budgets` into `planner_templates`; validate old
state and abort on invalid values. retain users/sessions and current calculator
values. remove old `/budget/load`, `/budget/save`, old schema/client exports,
whole-document autosave, and callers. no dual reads/writes, compatibility aliases,
silent defaults for failed loads, or invented historical plans. historical
migration files remain migration history, not supported runtime paths. rollback
requires a compatible database restore or forward fix, not an old app against
the new schema.

final state: one source of financial truth, one published api, one report
calculation, durable originals/corrections, and a usable manual path without
jarvis. release only after the named proofs, lint, typecheck, build, and read-only
deployed smoke pass. document database backup ownership/retention and restoration
steps; no custom backup service or claim that an untested backup is sufficient.

deliberate costs: fixed usd/categories reject unsupported classification rather
than growing configuration; cash-date spending omits liabilities; recorded totals
cannot establish completeness; monthly adoption has no annual allocation editor;
record protection requires owner intervention for some harmless amendments;
explicit saves add one click; per-item import commands add requests; postgres
originals enlarge backups and the 2 mib limit rejects larger files; static scoped
credentials need manual rotation; utc defaults can select the adjacent month near
local midnight. no fuzzy auto-merge, field-level provenance engine, object store,
oauth server, event sourcing, or distributed workflow framework is justified here.
