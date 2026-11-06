-- sql/store/012_claim_legacy_memories.sql
--
-- Operator-only, one-time claim. Moves stranded single-user-era rows off
-- the fixed legacy tenant (sql/store/001_tenants.sql) onto ONE existing
-- email account. Signup (lib/accounts.js createAccount) mints a new empty
-- tenant, and 002 stamped every pre-account memory_items /
-- conversation_sessions / conversation_turns row onto the legacy tenant,
-- so a signed-in account's prime/recall (tenant_id filter in
-- server/handlers/memory.js) cannot see them.
--
-- This file is NOT a blind schema migration. Running it with no target
-- email aborts and writes nothing. It does not INSERT or DELETE tenants,
-- does not delete rows, and does not name an application owner. The
-- destination is whichever active tenant the operator names.
--
-- Same session, before this file:
--
--   SET capstone.claim_target_email = 'the-existing-account@example.com';
--
-- Then:
--
--   psql "$DATABASE_URL_MEMORY" -v ON_ERROR_STOP=1 \
--     -f sql/store/012_claim_legacy_memories.sql
--
-- Re-run is a no-op: every UPDATE is limited to rows still on the legacy
-- tenant (plus leftover conversation_turns whose session already sits on
-- the destination). memory_items.user_id is left as the legacy sub-identity
-- ('troy'): enforced-mode retrieval filters on tenant_id alone
-- (server/handlers/memory.js). conversation_sessions.user_id is rewritten
-- to the destination tenant id because enforced-mode writers stamp that
-- id (server/handlers/conversation-turn.js) and conversation-history
-- filters on user_id AND tenant_id.
--
-- Counts are RAISE NOTICE lines. No memory or transcript text is selected.

BEGIN;

DO $claim$
DECLARE
  legacy uuid := '00000000-0000-4000-8000-000000000001';
  legacy_user text := 'troy';
  target_email text := current_setting('capstone.claim_target_email', true);
  dest uuid;
  dest_status text;
  n int;
  moved_memories int := 0;
  moved_sessions int := 0;
  moved_turns int := 0;
  swept_turns int := 0;
  repaired_session_user int := 0;
BEGIN
  IF target_email IS NULL OR btrim(target_email) = '' THEN
    RAISE EXCEPTION
      'refusing: set capstone.claim_target_email to an existing account email before running this file';
  END IF;
  target_email := lower(btrim(target_email));

  SELECT count(*) INTO n
    FROM tenants
   WHERE lower(email) = target_email;
  IF n <> 1 THEN
    RAISE EXCEPTION 'refusing: email matched % tenant row(s); need exactly 1', n;
  END IF;

  SELECT id, status INTO dest, dest_status
    FROM tenants
   WHERE lower(email) = target_email;

  IF dest = legacy THEN
    RAISE EXCEPTION 'refusing: resolved tenant is the legacy tenant';
  END IF;
  IF dest_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'refusing: destination status is % (need active)', dest_status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'memory_items' AND column_name = 'tenant_id'
  ) THEN
    RAISE EXCEPTION 'refusing: memory_items.tenant_id is missing (sql/store/002_tenant_columns.sql not applied)';
  END IF;

  -- Suppress BEFORE UPDATE touch triggers for this transaction only, so a
  -- tenancy correction does not rewrite updated_at. replica role is
  -- privilege-gated; without it the move still proceeds.
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
    RAISE NOTICE 'trigger suppression: session_replication_role=replica (transaction-local)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'trigger suppression unavailable (%); updated_at may bump', SQLERRM;
  END;

  SELECT count(*) INTO n
    FROM memory_items
   WHERE tenant_id = legacy AND user_id = legacy_user;
  RAISE NOTICE 'before memory_items legacy user_id=% : %', legacy_user, n;

  SELECT count(*) INTO n
    FROM memory_items
   WHERE tenant_id = legacy AND user_id IS DISTINCT FROM legacy_user;
  IF n > 0 THEN
    RAISE NOTICE 'left in place: % memory_items on the legacy tenant with a user_id other than %', n, legacy_user;
  END IF;

  SELECT count(*) INTO n
    FROM memory_items
   WHERE tenant_id = dest
     AND scope = 'semantic'
     AND (valid_until IS NULL OR valid_until > now());
  RAISE NOTICE 'before prime-visible semantic memories on destination % : %', dest, n;

  SELECT count(*) INTO n
    FROM conversation_sessions
   WHERE tenant_id = legacy AND user_id = legacy_user;
  RAISE NOTICE 'before conversation_sessions legacy user_id=% : %', legacy_user, n;

  SELECT count(*) INTO n
    FROM conversation_turns t
    JOIN conversation_sessions s ON s.id = t.session_id
   WHERE s.tenant_id = legacy AND s.user_id = legacy_user;
  RAISE NOTICE 'before conversation_turns on those sessions : %', n;

  -- Lock the rows this transaction will retarget.
  PERFORM 1 FROM memory_items
   WHERE tenant_id = legacy AND user_id = legacy_user
   FOR UPDATE;
  PERFORM 1 FROM conversation_sessions
   WHERE tenant_id = legacy AND user_id = legacy_user
   FOR UPDATE;
  PERFORM 1
    FROM conversation_turns t
    JOIN conversation_sessions s ON s.id = t.session_id
   WHERE s.tenant_id = legacy
     AND s.user_id = legacy_user
     FOR UPDATE OF t;

  UPDATE memory_items
     SET tenant_id = dest
   WHERE tenant_id = legacy
     AND user_id = legacy_user;
  GET DIAGNOSTICS moved_memories = ROW_COUNT;

  UPDATE conversation_turns t
     SET tenant_id = dest
    FROM conversation_sessions s
   WHERE t.session_id = s.id
     AND s.tenant_id = legacy
     AND s.user_id = legacy_user
     AND t.tenant_id IS DISTINCT FROM dest;
  GET DIAGNOSTICS moved_turns = ROW_COUNT;

  UPDATE conversation_sessions
     SET tenant_id = dest,
         user_id = dest::text
   WHERE tenant_id = legacy
     AND user_id = legacy_user;
  GET DIAGNOSTICS moved_sessions = ROW_COUNT;

  -- Idempotent repair: turns still stamped legacy whose session is already
  -- on the destination (a previous attempt moved the session first).
  UPDATE conversation_turns t
     SET tenant_id = dest
    FROM conversation_sessions s
   WHERE t.session_id = s.id
     AND s.tenant_id = dest
     AND s.user_id IN (dest::text, legacy_user)
     AND t.tenant_id = legacy;
  GET DIAGNOSTICS swept_turns = ROW_COUNT;

  -- Idempotent repair: destination sessions still carrying the legacy
  -- user_id constant. Enforced-mode writers never store that constant
  -- (they stamp the tenant id), so a 'troy' row already on the destination
  -- is a partial claim, not a new hosted session.
  UPDATE conversation_sessions
     SET user_id = dest::text
   WHERE tenant_id = dest
     AND user_id = legacy_user;
  GET DIAGNOSTICS repaired_session_user = ROW_COUNT;

  SELECT count(*) INTO n
    FROM memory_items
   WHERE tenant_id = legacy AND user_id = legacy_user;
  RAISE NOTICE 'after memory_items still on legacy user_id=% : %', legacy_user, n;

  SELECT count(*) INTO n
    FROM memory_items
   WHERE tenant_id = dest
     AND scope = 'semantic'
     AND (valid_until IS NULL OR valid_until > now());
  RAISE NOTICE 'after prime-visible semantic memories on destination % : %', dest, n;

  SELECT count(*) INTO n
    FROM conversation_sessions
   WHERE tenant_id = dest AND user_id = dest::text;
  RAISE NOTICE 'after conversation_sessions on destination with tenant user_id : %', n;

  RAISE NOTICE 'moved memory_items=% sessions=% turns=% swept_turns=% repaired_session_user_id=% destination=%',
    moved_memories, moved_sessions, moved_turns, swept_turns, repaired_session_user, dest;
END
$claim$;

COMMIT;
