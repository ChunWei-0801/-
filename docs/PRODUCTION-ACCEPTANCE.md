# Production acceptance handoff

The current deployed source is `316f6d96c5296d54c4e2a672f3d52278359e6abe`,
resource version **176**, at `https://fambudget-recovery-20261017.onrender.com`.
Render `dep-dbd39g67bikc73adlmr0` reports live, finished
2026-10-23 00:09:15 Asia/Taipei. The service remains free with auto-deploy off.
GitHub run [39810873137](https://github.com/ChunWei-0801/-/actions/runs/39810873137)
passed checks and real Chromium browser jobs for that exact source. Complete
local backend: 1068 passed. Related frontend: 134 passed, zero skips; two
additional actual-page note/camera checks and the standalone lifestyle browser
also passed. All 69 changed remote blobs were verified; the complete source
history bundle was saved and verified. Original failed environment retained.

## v176 accessibility, receipt entry and multiple savings jars

- Direct dashboard touch/mouse/keyboard shortcut arrangement persists only on
  explicit completion, with cancel/retry. Hidden shortcut settings remain.
- Transaction notes are the last desktop column and the last readable mobile
  field. Scan receipt opens camera/file OCR, then one large editable reviewed
  entry. Photo upload retry does not create another transaction.
- The AI assistant only presents finance coach and operation helper. The latter
  can interpret quoted report fields, or take explicit filters without waiting
  for a model. Read-only permission checks, full Decimal totals, paginated detail
  and real complete xlsx/docx exports use the same authorized scope. Unknown
  years must be selected; a location means recorded merchant/note/activity text.
- Global speech input requires start/review/apply and never auto-submits. TTS
  lists real OS voices; a device with fewer than five gets free OS installation
  guidance, not five fabricated voice names. Five rate/pitch styles are separate
  from five distinct voices. Remote speech/voices require opt-in. Family original
  recordings stay account-scoped on this browser with play/rename/delete/download;
  they are not cloned voices or cross-device backups.
- Savings supports multiple independently named jars, goals, shapes, amounts
  and photos. The original remains intact; additive migration 0008 creates only
  the additional-jar table/index. TWD changes use whole yuan, minimum new goal
  and deposit 1. Historical decimals are not silently rewritten. The currency
  unit helper does not imply that multi-currency jars were added.
- Route animations honor reduced motion and account boundaries. Six languages
  have 1557 aligned message keys. API/screen/table catalogs match 125/26/32.

Start with `/?v=176#/`, then `/#/savings-game`, `/#/entry`, `/#/ai` or the voice
button. The no-write model trial is `/ai-test.html?v=176`. Users should first
check new independent jars and photo capture with their own chosen test inputs.
Physical camera/microphone/OS voice availability, fresh Qwen inference including
report understanding, and new production interactions remain pending user
acceptance. No production test transaction, invitation or email was created.

Two real OCR synthetic-image runs found total 105 and date 2026-07-03, excluding
subtotal/tax/cash/change; their 1.9–2.0 second timings are two local observations,
not general phone/OCR accuracy claims. Frontend speech tests use controlled
browser capability doubles; actual MediaRecorder/IndexedDB/download is tested
with a synthetic audio source. No fresh Qwen accuracy or latency improvement
was measured here. Full production database backup/isolated restore and actual
government feed synchronization remain pending as detailed below. See
WORKLOG-20261022-ACCESSIBILITY.md for scope, evidence and continuation.

## v175 local AI latency and accuracy work

- Same pinned free Qwen 0.5B and schema/source/amount guards. Default compact-v1
  shortens instructions, removes unrelated few-shot examples and unmentioned
  calendar aliases; one bounded repair now cites safe, specific error metadata.
  Valid empty extraction is not rerun, which saves a pass but can retain a false
  empty prediction. Existing baseline flow remains for actual comparison.
- Public no-write test `/ai-test.html?v=175`: four synthetic cases cover mixed
  expenses, salary, winnings and third-party rejection. A folded optional panel
  runs eight counterbalanced baseline/compact observations on the same model.
  Failed cases continue; cancellation preserves completed synthetic results.
- Raw-model and assisted scores stay separate, with exact fields distinct from
  amount/kind detection. Failed/cancelled references remain in end-to-end
  denominators; only verified real empty replies can pass negative cases.
  Unstarted cases never count as model attempts. Exports whitelist fixed case
  and model identifiers plus counts/timings, excluding input and transaction data.
- Worker total includes final resetChat; controller requestMs includes automatic
  loading and message overhead. First output is not a usable draft or pure GPU
  timing. UI separates loading, real elapsed time and reviewable drafts, folds
  diagnostics, highlights fields to complete and batches non-draft stream updates.
- The 24-reference registry, 69 controller/worker/evaluation checks and 106
  related frontend checks are synthetic/contract evidence. Historical literal
  failed-output replay also passed through real worker/controller/Chromium.
  No fresh model inference was possible in this cloud environment; **no new
  accuracy percentage or observed speedup has been claimed**. User-device
  comparison and acceptance remain pending. Do not reuse prior timings as proof
  of this prompt's performance. See FREE-LLM.md and WORKLOG-20261022.md.

## v174 activity and transaction changes

- Personal ledger is now called 收支明細; ledgers are 活動. The header only
  lists activities and has an honest empty state. The dashboard keeps the
  all-details entry; historical private-container data remains accessible.
- Authorized year/month folders, Taipei month-end closed status, month search,
  200-row pagination and activity name filtering retain existing edit, photo
  and selection actions. Grouping does not move, delete or lock transactions.
- Nine authenticated invitation routes allow code or full-email account
  invitations independent of family membership. Codes are hashed, single-use
  and expire after seven days; acceptance is atomic. Independent joins survive
  family departure; legacy family-sharing revocation remains intact. Only the
  joined activity's records become visible. Additive migration 0007 preserves
  prior data in isolated upgrade tests; PostgreSQL offline DDL also validated.
- The current device is omitted from the other-device list and keeps its
  session after revocation. Unknown parsed direction/category stay explicitly
  unselected until a manual choice. Lottery purchases and actual winnings use
  opposite directions with disclosed rule assistance and preserved raw model
  predictions; synthetic tests are not fresh model-quality measurements.

For the v174 activity changes, test the refreshed site with `/?v=175#/`, details `/#/entry`, activities
`/#/groups`, devices `/#/profile`, and no-write AI `/ai-test.html?v=175`.
No real friend was messaged and no production test transactions were created.
New device/production interaction acceptance remains pending user testing.
See WORKLOG-20261022.md for the full release record.

## Current changes and evidence limits

- AI row isolation keeps source-grounded candidates and excludes fabricated
  candidates with visible reasons, preserving raw model rows and provenance.
  Actual user salary-failure output now passes the real worker/controller/
  Chromium recorded-output replay, as does the breakfast/lunch case. It is not
  fresh model inference. On v171, the user's real breakfast/lunch final drafts
  already passed while raw model labels failed; the salary extra row exposed
  the defect repaired in v172. New salary-device inference remains pending.
- Public fraud shortcut and dismissible all-page reminders, government CSV
  fetching with honest freshness/errors, three referenced education summaries
  for explicit local-model coaching, current-session preserving logout, and
  six-language 24-hour button/fallback verification-email presentation are live.
- Actual government sync is **not verified**: management/deployment requests
  work, but Render logs API returns a Cloudflare HTML attention page (403),
  and public web inspection cannot open the deployed page/feed API. Controlled
  source parsing, cache and failure tests passed; these are not provider proof.
- No new real verification email was sent in this stage. Full production
  registration/mail-link/photos/mobile/eight-feature interactions, and current
  production PostgreSQL private backup plus isolated restore remain pending.
  The three verified private historical/QA backups remain separate evidence.
- Original failed environment retained; changes committed and pushed in stages.

Public no-write AI test: `/ai-test.html?v=175`. Public fraud page: `/#/fraud`.
Reload first so an old tab does not keep the previous logout implementation.
Reference-site research is documented in `LLM-REFERENCE-REVIEW.md`; historical
public code does not establish that external site's current model or state.
See `FREE-LLM.md` and `WORKLOG-20261021.md` for details.

## Existing acceptance and backup handoff

The user saved and published the updated environment policy on 2026-10-19.
The latest observed runtime revision is 943 (2026-10-22) and still lacks the
production website and database destinations: the additional HTTP host allowlist
contains `api.render.com`, `api.brevo.com`, and `open.er-api.com` alongside package
manager presets; the production hostname was denied with `Tunnel 403`.
[The official environment workflow](https://learn.chatgpt.com/docs/environments/cloud-environments)
requires a **new task** to use the republished environment; existing tasks retain
their own state. Do not retry the target under that old policy, bypass the proxy,
or treat the acknowledgement flag below as a policy change.

In the new task, inspect the effective policy and confirm that the exact production
hostname and `api.brevo.com` are permitted, proxy/CA trust is inherited, and the
deployed source and real mail configuration are correct. Only then set
`PRODUCTION_QA_POLICY_READY=yes`. Both tools reject another site origin and
default to a dry run. No production requests or mail were sent while preparing
this handoff.

## Private inputs

Keep credentials, browser screenshots, reports and backups outside every Git
checkout. Use an existing owner-held `0700` directory and owner-held `0600`
regular credential files; symbolic/hard links are rejected. Never paste a real
password, API key, verification token or mail body into chat, logs or Git.
Supply the authorized dedicated QA mailbox with `--qa-email` or
`FAMBUDGET_QA_EMAIL`; it must exactly match the credential JSON. Bind
`BREVO_API_KEY` through the environment without printing its value.

Required initial credential keys are `baseUrl`, `qaOnly`, `email`, `name`,
`password` and `tag`. The following is **schema documentation only**: every value
is synthetic, and `.test` mailboxes are explicitly rejected for execution.
Do not execute this example or replace a preserved account manifest with it.

```json
{
  "baseUrl": "https://fambudget-recovery-20261017.onrender.com",
  "qaOnly": true,
  "email": "qa-only@EXAMPLE.TEST",
  "name": "QA synthetic example",
  "password": "SYNTHETIC-EXAMPLE-ONLY-123",
  "tag": "QA-SYNTHETIC-EXAMPLE"
}
```

`name` must start with `QA `; `tag` must contain `QA` and be 3–80 characters
without control characters. Password length must be 12–72 UTF-8 bytes. The
Python tool creates a **new** dedicated account, stops on an existing email
without resetting or changing it, then privately adds `expectedUserId` and
`expectedFamilyId` to the same manifest. Authenticated browser execution requires
both of those actual IDs and verifies them, the email, name and verification state
before allowing presentation changes. Browser credentials must be outside its
artifact directory so reports cannot overwrite them.

## Local checks and later execution

These commands are safe local dry runs and do not read private account files:

```sh
python backend/tools/production_acceptance.py
node frontend/tests/production-mobile.cjs
```

For the **new policy-ready task only**, set `QA_PRIVATE` to an existing private
directory outside Git and `QA_MOBILE` to a separate existing private artifact
directory. Select the actual authorized QA mailbox through
`FAMBUDGET_QA_EMAIL`. Run public mobile checks first, then the account/mail checks,
then authenticated mobile checks:

```sh
node frontend/tests/production-mobile.cjs --execute --output "$QA_MOBILE"
python backend/tools/production_acceptance.py --execute \
  --credentials "$QA_PRIVATE/qa-account.json" \
  --report "$QA_PRIVATE/production-e2e-report.json" \
  --qa-email "$FAMBUDGET_QA_EMAIL"
node frontend/tests/production-mobile.cjs --execute --auth \
  --credentials "$QA_PRIVATE/qa-account.json" \
  --output "$QA_MOBILE" --qa-email "$FAMBUDGET_QA_EMAIL"
```

Python requires Pillow. Browser execution requires Playwright plus an installed
Chromium; use the standard `playwright` module or `PLAYWRIGHT_MODULE`, and
optionally `CHROMIUM_EXECUTABLE`. It requires and inherits the managed
`HTTPS_PROXY`/`HTTP_PROXY` configuration. Keep the existing CA trust; do not add
TLS exceptions, direct connections or proxy bypasses.

The Python run sends real verification mail, reads the actual Brevo sent body,
checks its exact-origin link and a delivered event, confirms the token once, and
tests replay rejection. A delivered event is provider delivery evidence; human
inbox receipt remains a separate check. It retains clearly marked synthetic QA
household, ledger, photo and puzzle records, verifies photos/session rotation and
an actual exchange quote, and does not delete existing real-user data. Inspect a
failed run before retrying: registration deliberately stops when the account
already exists.

The browser checks widths 389/390, languages, tutorial and account presentation.
Public mode blocks all account writes and form submissions. Auth mode allows
login/session operations and only its verified QA account's presentation fields
and synthetic background upload; ledger, household, puzzle and deletion writes
are blocked. External origins are blocked, service workers disabled, and optional
Google font requests are recorded as skipped; screenshots use fallback fonts.
Reports omit raw exceptions, passwords, tokens and mail bodies. Screenshots can
contain QA account details and must remain private. Cross-account ACL checks,
physical camera behavior, all eight lifestyle online interactions, and a human
mailbox receipt still require their own evidence.

## Full database backup remains pending

The complete private database backup still needs the external PostgreSQL hostname
and permitted TCP access (normally port 5432). The internal Render database URL
and HTTP-only API allowlist are insufficient. After those are available in the
new task, use the existing `backend/tools/backup_restore.py` with credentials
bound privately, store the backup outside Git with restrictive permissions, and
validate restoration into an isolated database. Do not restore into production.
These acceptance scripts do not create a full database backup.

The original SQLite snapshot, the lifestyle QA snapshot, and the newer isolated
AI/API QA snapshot have private Google Drive copies with separately stored
recovery keys. Each was downloaded and restored in isolation, with full row and
photo hashes verified; these are historical/test data, not production PostgreSQL.
The newest QA snapshot verifies 31 tables, 415 rows and 11 photo blobs. Do not
mark the production backup checkbox complete based on these successful drills.

The repaired trial source is `91892b5f42f1dcd637cb4a3ead88025ac9a765e8`.
Render deployment `dep-dbbmpobbc2fs73bn8e20` is live, and resource version 168
versions both the controller and worker. The user was asked to retest the same
two-purchase input at `/ai-test.html?v=168`. The repair passed 38 local
controller/UI/API checks and 12 actual WASM schema checks with a synthetic
tokenizer; real model output on the user's device remains pending. Do not mark
the earlier failed trial as a pass or infer model accuracy from these checks.

Resource version 169 is now live from `cf0dcdca3ddb70f804335bd7131599d043c3517e`
(Render deployment `dep-dbbn6p8n74is73d8jvd0`, 2026-10-20 21:59:18 Asia/Taipei).
It uses model-quoted source fields and readable classification labels, then
mechanically validates/maps them to canonical drafts. The UI exposes raw output
and mapped drafts separately, and compares actual synthetic outputs without
correcting them. All 49 local contract/UI checks, 19 actual WASM schema checks
(synthetic tokenizer) and full GitHub CI passed. The new user-device retest at
`/ai-test.html?v=169` is pending; the v168 semantic failure remains the last
observed device result. Production account/mail/photo/mobile acceptance and
production database backup/restore remain incomplete.

The latest v169 device check rejected a draft with `AI_INVALID_DRAFT`. The user
provided real runtime metrics (two attempts, 56,704 ms, finish reason stop), but
not the raw model JSON. It also exposed untranslated diagnostic disclosure
keys. See `WORKLOG-20261021.md` for the confirmed parser/translation readiness
repair and fixed validation diagnostics. These changes do not establish a
model-quality pass or a production database backup.

The version 170 deployment `dep-dbbvmrdpkucs73d3gs9g` is live from the source
above. The checks and real-browser CI jobs both passed in run 39516042343.
The user was directed to the auto-expanded raw-output box on a failed draft.
Actual raw model JSON is still missing; diagnosis and correct-draft acceptance
remain pending. Preserve the earlier real runtime metrics and failed results.
