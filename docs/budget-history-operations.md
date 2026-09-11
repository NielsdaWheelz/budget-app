# budget history operations

the [specification](budget-history.md) owns behavior. this document owns setup,
integration, proof commands, and release. local verification is not a deployed
smoke test or a production recovery claim.

verified locally on 2026-09-11: lint, typecheck, build, 33 bun tests (209
assertions), and 8 chromium tests pass. desktop and 390px mobile views inspected.
the bun suite includes migration and backup restoration; the browser suite
includes one journey through the real api and postgres.

## setup and integration

install with `bun install --frozen-lockfile`. configure every required value in
[.env.example](../.env.example). the server uses the direct postgres endpoint
with tls. `BUDGET_ORIGIN` is the exact browser origin, without a trailing slash.
`BUDGET_OWNER_EMAIL` must identify a registered account; migration preserves
existing accounts. integration credentials cannot create an account.

generate two independent random 32-byte secrets in a password manager. store
their sha256 hex digests in `BUDGET_READ_TOKEN_SHA256` and
`BUDGET_WRITE_TOKEN_SHA256`. jarvis receives the plaintext secrets through its
credential configuration; neither browser code nor this repository receives
them. rotation replaces a digest and redeploys; durable command identity remains
`jarvis`. do not log authorization headers, originals, or database error causes.

authenticated `get /api/openapi.json` publishes the schemas; `get /api/catalog`
publishes category keys and limits. use those contracts rather than scraping the
interface. category keys are case-sensitive. transaction creation through imports
requires the write token; plans and source-free entry require the owner session.
labels, payees, namespaces, external keys, and item keys allow 200 utf-16 code units;
notes, references, and reasons allow 2000. derive a stable hash for an unusually
long upstream identity and retain its full reference separately. a partial proposal allows
16 kib of serialized utf-8 json. larger observations stay in the original;
jarvis must submit a concise proposal. these bounds keep paginated responses
within the host's response limit. rejected fields are never silently shortened.

each mutation sends `authorization: Bearer <token>`, `content-type:
application/json`, and `idempotency-key: <stable-command-key>`. persist the key
and exact command before sending. use a different key for a deliberate revision.
reuse it after transport failure or a 500; query `get /api/commands/:key` if the
outcome is unknown. a missing receipt is not proof that an in-flight request
cannot commit: resubmit the same command. a 409 requires reviewing current state;
never silently replace revisions or invent a new key to force an old write.

one paid receipt:

1. `post /api/sources` with the original:

   ```json
   {
     "expected_revision": null,
     "namespace": "mail/personal-account",
     "external_key": "message-id/attachment-id",
     "label": "receipt.txt",
     "media_type": "text/plain",
     "content_base64": "cGFpZA==",
     "external_reference": null
   }
   ```

2. `post /api/imports`, substituting its source id and current revision:

   ```json
   {
     "source_id": "<source-id>",
     "item_key": "purchase-1",
     "expected_source_revision": 1,
     "expected_item_revision": null,
     "kind": "record",
     "transaction": {
       "date": "2026-09-30",
       "kind": "expense",
       "amount_cents": 51595,
       "currency": "USD",
       "payee": "grocer",
       "note": null,
       "payment_reference": null,
       "original_expense_id": null,
       "allocations": [{"category_key": "Groceries", "amount_cents": 51595}]
     }
   }
   ```

3. resolve any other document entries under stable item keys. fetch the source's
   latest revision, then `post /api/sources/:id/complete` with
   `{"expected_revision": 1}` using that revision. completion and resolution are
   separate commits; completion does not mark pending entries paid.
4. read `/api/reports?period=2026-09` or
   `/api/reports?period=2026&through_month=12`. fetch a category's contributions
   with `/api/transactions?from=2026-09-01&until=2026-10-01&category=Groceries`.

unpaid or uncertain evidence uses `hold`, retaining observations and a concrete
reason. a second document for an existing purchase uses `link`. matching filters
are aids to judgment, never duplicate detection by merchant/date/amount. owner
corrections permanently protect the transaction. preserve a correction proposal's
target; resolve it by reviewing/correcting that transaction and linking evidence.

successful mutation responses are 200 with the committed record/outcome. missing
planner, plan, or command is 404. malformed json/utf-8 is 400; schema/domain errors
are 422; authorization, conflicts, and upload limits are 401/403, 409, and 413.
error bodies expose `_tag`, `message`, and optional field `issues`.

## local proof commands

requires bun, node for playwright, and postgres binaries discoverable through
`pg_config --bindir`. tests create and stop their own loopback postgres clusters;
they do not use `DATABASE_URL_UNPOOLED`. run as a non-root user, as postgres requires.

```sh
bunx playwright install chromium
bun run check
bun run typecheck
bun run test
bun run test:browser
```

`test:browser` builds the deployable bundle first. its interface project uses
schema-validated http fixtures; its single journey uses the built browser,
real api, real migrations, and isolated postgres. ports 4173 and 4174 must be free.
failed browser tests retain a trace in ignored `test-results/`.

| proof owner | evidence |
| --- | --- |
| domain | exact cents/dates/splits; september +1595, october refund −2000; independent plan coverage and contribution oracles |
| postgres store | concurrent replay, revision/protection conflicts, evidence identity and repairs; a failed final receipt insert rolls back the whole operation |
| http | scopes/origin/strict schemas, real downloads, request bounds; malformed utf-8 fails and a cold database failure recovers on the same app |
| browser | period/back navigation, content and errors, split entry, retained failed writes even when an audit read fails, pending originals |
| journey | owner saves/adopts a plan; jarvis uploads/imports; browser shows +$15.95 and opens the original |
| recovery | actual migration runner, `pg_dump`/`pg_restore` into a separate local database; bytes/digest, transaction, audit, and replay survive |

red evidence includes a reversed-refund mutant, read-scope write authorization
mutant, the pre-fix malformed-utf-8/cold-start implementation, and the deliberately
failed final receipt insert. these fail their respective oracles. no test-only
financial branch exists in the application.

## hard cutover

backup owner: the account owner operates the hosted database's backups. retain
encrypted daily backups for 30 days and the pre-cutover backup until a subsequent
restore has been verified. configure and confirm this retention with the host;
the application does not provision it. originals enlarge these backups.

1. pass the local proofs. verify production credentials, exact origin, owner
   mapping, and backup retention. stop browser and integration writes.
2. take a custom-format database backup, for example
   `pg_dump --format=custom --file=budget-before-history.dump "$DATABASE_URL_UNPOOLED"`.
   keep it encrypted outside the repository. record the running application commit.
3. restore that backup into a separate disposable database with `pg_restore
   --exit-on-error --no-owner --dbname="$BUDGET_RESTORE_URL" budget-before-history.dump`.
   verify the restored planner against the live planner; never restore over live data
   to test a backup. preserve credentials outside shell history and logs.
4. run `bun run migrate` against the stopped production database, then deploy the
   matching api and ui together. invalid old planner data aborts migration; repair
   it explicitly before rerunning. the migration creates no historical plans or
   transactions. old runtime load/save routes, autosave, and the unused planner
   `updated_at` column are removed; revisions and audit own subsequent changes.
5. read-only smoke: owner login, direct `/planner`, `/history`, `/inbox` navigation;
   read-token catalog/report/source access; original download where present;
   unauthenticated api 401 and unknown api 404. confirm preserved planner values,
   missing-plan labels, and no secrets/originals in logs. then resume writes.

rollback requires restoring the pre-cutover database with its matching app, or a
forward fix. an old app against the renamed schema is unsupported. a rollback
after resuming writes loses later data unless those facts are recovered first.

implementation costs beyond the spec: calendar input ends at year 9998 so report
end boundaries stay four-digit dates; browser drafts and unresolved request keys
are held in memory with navigation/unload guards, not a persistent offline queue;
the installed effect middleware expects one app instance per process. a forced
tab close can lose an unsaved draft. reports use each month's current plan
revision; earlier revisions remain in audit, without an as-of reporting mode.
pending evidence counts cover all periods because unresolved documents may lack
a financial date. overflow is rejected, never rounded. production migration,
retention configuration, and deployed smoke remain release operations, not
claims made by local tests.
