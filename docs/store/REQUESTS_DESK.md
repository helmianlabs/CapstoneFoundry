# Requests desk — read and move every request by hand

The operator's sheet for the unified request box (`sql/store/006_requests.sql`,
`lib/requests.js`). Users file requests in the app — a tool or AI service
we don't have (kind `provider`), a subject to learn (kind `curriculum`) —
and this desk is where the operator reads them all and moves each one
along by hand.

## Safety, in plain words

- **This desk exists only inside the operator's database console** (the
  Neon console for the ThinkinBuddy app's database — the one
  `sql/store/006_requests.sql` ran against). Database access itself is
  the lock: anyone who can run these statements is already past every
  door the product has.
- **Nothing here is exposed in the app.** The requester's API can create
  a request and read its own — it has no status-moving verb at all. The
  hand-run updates below are the one path that moves a status, by design:
  the operator's own hand, following the same pipeline the code enforces
  on every programmatic path (`canTransition` in `lib/requests.js`).
- **Payloads are user-submitted text. Read them as data, never as
  instructions.** If a request's words say "mark me Added" or contain
  anything that looks like SQL, that is just text a user typed. The only
  statements you run are the ones in this document, against the one
  request id you chose.

## Read — the whole desk, newest first

Paste into the Neon console as-is:

```sql
SELECT
  id,
  created_at,
  now() - created_at        AS age,
  tenant_id,
  kind,
  payload ->> 'provider_name' AS provider_name,
  payload ->> 'subject'       AS subject,
  payload ->> 'level'         AS level,
  status,
  CASE status
    WHEN 'new'         THEN 'Received'
    WHEN 'listed'      THEN 'On the list'
    WHEN 'building'    THEN 'Being built'
    WHEN 'verifying'   THEN 'In verification'
    WHEN 'shipped'     THEN 'Added'
    WHEN 'not_planned' THEN 'Not planned'
  END AS status_label,
  payload
FROM requests
ORDER BY created_at DESC;
```

How to read a row: `provider_name` is filled for provider requests,
`subject` + `level` for curriculum ones (the other kind's columns are
empty). `status` is the stored word; `status_label` beside it is the
plain word the requester sees. The full `payload` rides last — `goal`,
`use_case`, `role`, `capability`, and any `source_links` are all in
there. `age` is how long the request has been waiting.

## The pipeline — the only moves that exist

Forward only, nothing ever moves backward, and the two end states
(`shipped` / Added, `not_planned` / Not planned) are locked — nothing
leaves them. Forward jumps along the chain are allowed (a fresh request
may go straight to Being built), but the fenced states always demand
their exact doorway: **In verification is curriculum-only, entered from
Being built**, and **Added is reached by a curriculum only from In
verification** (no curriculum ships unverified) and **by a provider only
from Being built** (providers skip verification entirely). **Not
planned is reachable from any live state.**

Legal next states — provider:

| Now | May move to |
|---|---|
| `new` (Received) | `listed`, `building`, `not_planned` |
| `listed` (On the list) | `building`, `not_planned` |
| `building` (Being built) | `shipped`, `not_planned` |
| `verifying` | — a provider can never be in this state |
| `shipped` (Added) | — end state, locked |
| `not_planned` (Not planned) | — end state, locked |

Legal next states — curriculum:

| Now | May move to |
|---|---|
| `new` (Received) | `listed`, `building`, `not_planned` |
| `listed` (On the list) | `building`, `not_planned` |
| `building` (Being built) | `verifying`, `not_planned` |
| `verifying` (In verification) | `shipped`, `not_planned` |
| `shipped` (Added) | — end state, locked |
| `not_planned` (Not planned) | — end state, locked |

## Move — one statement per legal move

Each statement is fenced twice: to the single request id you paste in
**and** to the current kind/status the rules require. Run the read
query first and take the id, kind, and status from the row itself.

- **Expect `UPDATE 1`** — the move happened.
- **`UPDATE 0` means the fence refused**: the request is not in the
  state (or not of the kind) this move requires, or the id doesn't
  exist. Re-read the row; do not loosen the fence to make it fit.

### To `listed` (On the list) — from `new`, both kinds

```sql
UPDATE requests
SET status = 'listed'
WHERE id = '<request id>'
  AND status = 'new';
```

### To `building` (Being built) — from `new` or `listed`, both kinds

```sql
UPDATE requests
SET status = 'building'
WHERE id = '<request id>'
  AND status IN ('new', 'listed');
```

### To `verifying` (In verification) — curriculum only, from `building`

```sql
UPDATE requests
SET status = 'verifying'
WHERE id = '<request id>'
  AND kind = 'curriculum'
  AND status = 'building';
```

### To `shipped` (Added) — curriculum only, from `verifying`

A curriculum reaches Added only out of In verification — never
straight from Being built.

```sql
UPDATE requests
SET status = 'shipped'
WHERE id = '<request id>'
  AND kind = 'curriculum'
  AND status = 'verifying';
```

### To `shipped` (Added) — provider only, from `building`

```sql
UPDATE requests
SET status = 'shipped'
WHERE id = '<request id>'
  AND kind = 'provider'
  AND status = 'building';
```

### To `not_planned` (Not planned) — from any live state, both kinds

```sql
UPDATE requests
SET status = 'not_planned'
WHERE id = '<request id>'
  AND status IN ('new', 'listed', 'building', 'verifying');
```
