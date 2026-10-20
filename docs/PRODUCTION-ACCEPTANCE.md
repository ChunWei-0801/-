# Production acceptance handoff

The deployed application source is `cf0dcdca3ddb70f804335bd7131599d043c3517e` at
`https://fambudget-recovery-20261017.onrender.com` (Render reports live on
2026-10-20, with the source-grounded repair live at 21:59:18 Asia/Taipei). The opt-in browser-local model trial is `/ai-test.html`, and the
authenticated trial is `/#/ai`; see `FREE-LLM.md` and `WORKLOG-20261020.md`.
Deployment status does not establish full production acceptance. The original
acceptance checks and all eight lifestyle features' online interactions remain
pending. These two tools cover the original account/mail/photo/mobile acceptance
scope, not the complete eight-feature online interaction checklist.

The latest v168 user-device screenshot shows genuine Qwen model generation, but
semantic acceptance failed: breakfast 65 was classified as income/SALARY and
lunch 120 as expense/TRANSIT; synthetic case 1 reports `passed:false`. The user
then explicitly reported that errors remain. Complete benchmark completion was
not observed. Generation, schema validity, semantic field correctness and safe
reviewed saving are separate evidence. This supersedes the earlier empty-draft
failure and pending-retest notes. The next repair still needs deployment and a
new real-device correctness check. No overall accuracy is inferred.

The user saved and published the updated environment policy on 2026-10-19.
The current task's observed runtime revision is 752 and still lacks the
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
