# Claim legacy-tenant memories

Operator runbook for moving Troy's pre-account Mark memories onto the
tenant created when `troyhalter1@gmail.com` signed up. This is a data
move for that one existing account. It does not make the address an
application owner, and it does not delete any account.

## Why the rows are stranded

Confirmed in this repo:

- `lib/accounts.js` `createAccount` inserts a new `tenants` row with a
  fresh UUID, plus an empty profile and a free entitlement. It does not
  attach existing memories.
- `sql/store/001_tenants.sql` creates one fixed legacy tenant,
  `00000000-0000-4000-8000-000000000001`.
- `sql/store/002_tenant_columns.sql` stamps every `memory_items`,
  `conversation_sessions`, and `conversation_turns` row whose
  `tenant_id` was null onto that legacy tenant.
- Those rows keep `user_id = 'troy'` (the old single-user id from
  `index.html` `genUserId`).
- With `SESSION_SECRET` set, `server/handlers/prime-agent.js` reads
  memories for the session's tenant only. `server/handlers/memory.js`
  filters that read on `tenant_id` alone, so a legacy `user_id` is fine
  once the row's `tenant_id` is the signed-in tenant. Until this move,
  prime and recall for the new tenant return no rows.

## What the move changes

| Table | Change | Left alone |
|---|---|---|
| `memory_items` | `tenant_id` from the legacy tenant to the email's tenant, only where `user_id = 'troy'` | `user_id`, content, embeddings |
| `conversation_sessions` | same tenant move, and `user_id` rewritten from `'troy'` to the destination tenant id | transcript text |
| `conversation_turns` | `tenant_id` for turns on those sessions, plus a sweep of turns still on the legacy tenant whose session is already on the destination | turn text |

Rows on the legacy tenant with any other `user_id` are counted and left
in place. No `DELETE`. No new tenant. A second run matches zero legacy
rows.

Conversation `user_id` is rewritten because hosted writers stamp the
tenant id (`server/handlers/conversation-turn.js`) and
`conversation-history` filters on both `user_id` and `tenant_id`.
Memory `user_id` stays `'troy'` because retrieval does not filter on it
in enforced mode.

Actionable tables, profiles, entitlements, and billing rows are not
part of this move.

## Agent access (2026-11-06)

The production move was not executed from the cloud agent. The thinkbuddy
Vercel project has `DATABASE_URL_MEMORY`, `DATABASE_URL`, and
`SESSION_SECRET` stored as sensitive. The project env API returns those
values empty (`decrypted: false`) even when decryption is requested, and
this machine has no Neon connection string of its own. Nothing was written
to the hosted database.

## Run

Use the memory database (`DATABASE_URL_MEMORY` on the thinkbuddy Vercel
project). Do not print the connection string.

Dry-run first (counts only):

```bash
DATABASE_URL_MEMORY='postgresql://…' \
  node scripts/claim-legacy-tenant-memories.mjs \
  --email=troyhalter1@gmail.com
```

Read the JSON. Expect `legacyTroyMemoryCount` above 0,
`destinationPrimeVisible` at 0 before the move, and
`legacyOtherMemoryCount` at 0. If other user ids show up, stop and
decide before applying — those rows are not moved.

Apply the same predicate inside one transaction:

```bash
DATABASE_URL_MEMORY='postgresql://…' \
  node scripts/claim-legacy-tenant-memories.mjs \
  --email=troyhalter1@gmail.com \
  --apply
```

Equivalent SQL, if you would rather use `psql`. Set the email in the
session so the file stays generic. The file aborts when the setting is
missing, when the email is not exactly one active tenant, or when that
tenant is the legacy tenant.

```bash
psql "$DATABASE_URL_MEMORY" -v ON_ERROR_STOP=1 <<'SQL'
SET capstone.claim_target_email = 'troyhalter1@gmail.com';
\i sql/store/012_claim_legacy_memories.sql
SQL
```

`\i` from a heredoc is unreliable in some `psql` builds. This form is
the one to use:

```bash
psql "$DATABASE_URL_MEMORY" -v ON_ERROR_STOP=1 \
  -c "SET capstone.claim_target_email = 'troyhalter1@gmail.com'" \
  -f sql/store/012_claim_legacy_memories.sql
```

`SET` without `LOCAL` lasts for the session, and `-c` plus `-f` share
one session.

## Verify

The script's after-counts should show:

- `legacyTroyMemoryCount` = 0
- `destinationPrimeVisible` > 0 (semantic rows with no `valid_until` in
  the past — the same predicate prime uses on the boot path)

Signed-in prime, without printing the prompt (the prompt contains the
memories):

```bash
DATABASE_URL_MEMORY='postgresql://…' SESSION_SECRET='…' \
  node scripts/claim-legacy-tenant-memories.mjs \
  --email=troyhalter1@gmail.com \
  --verify-prime
```

That mints a two-minute session for the resolved tenant and POSTs to
`https://thinkbuddy-sandy.vercel.app/api/prime-agent`. Success is
`prime.ok`, `prime.memoryCount > 0`, and `prime.tenantId` equal to the
destination UUID. Exit code 3 means the HTTP check did not show that.

## ElevenLabs tools

The signed-in page already sends the tenant id as the widget
`user_id` dynamic variable (`index.html` `tbCallUserId`). Prime does
not depend on the agent tool schema.

If the live ElevenLabs tools still send the constant `userId` `'troy'`
instead of `{{user_id}}`, hosted mode rejects those tool calls
(`resolveHandlerTenant` requires a session token or a UUID tenant id).
That rejection is independent of this move: after the claim, a tool
that still posts `'troy'` does not read the legacy tenant and does not
read the signed-in tenant either. Fixing the agent tool bindings is a
later punch-list item. It is not required for the prime check above.

`ENFORCE_TOOL_AUTH` is not part of this move.
