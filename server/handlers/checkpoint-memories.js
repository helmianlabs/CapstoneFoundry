// api/checkpoint-memories.js — DURING-SESSION memory autosave (memory-fix
// bite, 2026-11-05, Troy's direct requirement).
//
// Until this handler existed, memory was written only at the END of a
// call: the client fired /api/extract-memories on disconnect / pagehide /
// a 45-second idle guess, and that endpoint re-fetched the transcript
// from ElevenLabs. Two silent killers lived in that design — the client
// ignoring the response, and (proven 2026-11-05) an ELEVENLABS_API_KEY
// still belonging to the pre-switch account, so the fetch 404'd and
// nothing at all had been saved since 2026-10-23.
//
// This handler removes both dependencies mid-session:
//   - The turns it extracts from are ALREADY in Neon — conversation-turn
//     writes every turn to conversation_turns the moment it happens.
//     No ElevenLabs fetch, no client-held transcript.
//   - The client fires it on an interval and every N turns while a call
//     runs, and forced on pagehide/disconnect — so a drop-off, a dead
//     tab, or a lost signal loses at most the turns since the last
//     checkpoint (a few turns), never the whole conversation.
//
// A per-session cursor (memory_extract_cursors) records the highest
// turn_index already checkpointed, so each checkpoint extracts only the
// new slice; the end-of-call triggers (client extract + post-call
// webhook) still run the full transcript through the same dedup engine,
// which merges anything a checkpoint already saved.
//
// Body: { userId, sessionId, conversationId?, force? }
//   sessionId      — the client's liveSessionId (conversation_sessions.id)
//   conversationId — ElevenLabs' id, used as a fallback session lookup
//                    and as the memories' source_session when known.
//   force          — bypass the minimum-new-turns threshold (pagehide /
//                    disconnect flushes).
// Response: { ok, extracted, inserted, updated, superseded, cursorTurn,
//             newTurns } or { ok: true, extracted: 0, reason, ... }.

import { getPool } from './memory.js';
import { extractAndPersistMemories } from './extract-memories.js';
import { resolveHandlerTenant } from '../../lib/tenant.js';

// A checkpoint fires only once at least this many new turns have been
// captured — bounds the extraction LLM calls per call. Forced flushes
// (pagehide/disconnect) ignore it.
export const CHECKPOINT_MIN_NEW_TURNS = 4;

const CURSOR_DDL = `CREATE TABLE IF NOT EXISTS memory_extract_cursors (
  session_id      UUID PRIMARY KEY,
  conversation_id TEXT,
  last_turn_index INT NOT NULL DEFAULT -1,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

let _cursorReady = null;
function ensureCursorTable(pool) {
  if (!_cursorReady) {
    _cursorReady = pool.query(CURSOR_DDL).catch((e) => {
      // Reset so a later call retries; the checkpoint then fails soft
      // for this invocation instead of crashing the handler import.
      _cursorReady = null;
      throw e;
    });
  }
  return _cursorReady;
}

// Stored turns → the {role, message} transcript shape the extractor
// numbers and reads. Empty turns are dropped (they carry no signal and
// would shift the extractor's source_span indices harmlessly, but the
// spans are only provenance — cleanliness wins).
export function turnsToTranscript(turnRows) {
  if (!Array.isArray(turnRows)) return [];
  return turnRows
    .filter((t) => t && typeof t.content === 'string' && t.content.trim())
    .map((t) => ({
      role: t.role === 'user' ? 'user' : 'agent',
      message: t.content,
    }));
}

// The slice of turns a checkpoint still owes extraction for.
export function selectNewTurns(turnRows, cursor) {
  if (!Array.isArray(turnRows)) return [];
  const c = typeof cursor === 'number' ? cursor : -1;
  return turnRows.filter((t) => t && typeof t.turn_index === 'number' && t.turn_index > c);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, sessionId, conversationId, force } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (!sessionId && !conversationId) {
    return res.status(400).json({ error: 'sessionId or conversationId required' });
  }

  // Same tenant contract as conversation-turn / extract-memories:
  // enforced mode resolves the tenant (never a default), compat mode
  // (today's live deployment) keys on the caller's userId unchanged.
  const resolvedTenant = resolveHandlerTenant(req, userId);
  if (!resolvedTenant.ok) {
    return res.status(400).json({ error: 'tenant identity required (session token or tenant user_id)' });
  }
  const tenantId = resolvedTenant.tenantId;

  try {
    const pool = getPool();
    await ensureCursorTable(pool);

    // Locate the session row: the client's live session id first (the
    // primary path — conversation-turn created the row at call start),
    // then by ElevenLabs conversation_id (a checkpoint that races the
    // first turn write, or a client that only knows the EL id).
    let session = null;
    if (sessionId) {
      const r = await pool.query(
        tenantId
          ? `SELECT id, user_id, conversation_id FROM conversation_sessions WHERE id = $1 AND tenant_id = $2`
          : `SELECT id, user_id, conversation_id FROM conversation_sessions WHERE id = $1`,
        tenantId ? [sessionId, tenantId] : [sessionId]
      );
      session = r.rows[0] || null;
    }
    if (!session && conversationId) {
      const r = await pool.query(
        tenantId
          ? `SELECT id, user_id, conversation_id FROM conversation_sessions WHERE conversation_id = $1 AND tenant_id = $2`
          : `SELECT id, user_id, conversation_id FROM conversation_sessions WHERE conversation_id = $1`,
        tenantId ? [conversationId, tenantId] : [conversationId]
      );
      session = r.rows[0] || null;
    }
    if (!session) {
      // Nothing captured yet (checkpoint beat the first turn write) —
      // not an error; the next interval retries.
      return res.status(200).json({ ok: true, extracted: 0, reason: 'session not captured yet' });
    }

    // Identity the memories are saved under: the tenant in enforced
    // mode, otherwise the session row's own stamped user_id (which is
    // the identity conversation-turn wrote the turns under).
    const effectiveUserId = tenantId || session.user_id || userId;
    const sourceSession = conversationId || session.conversation_id || String(session.id);

    const cursorRes = await pool.query(
      `SELECT last_turn_index FROM memory_extract_cursors WHERE session_id = $1`,
      [session.id]
    );
    const cursor = cursorRes.rows[0]?.last_turn_index ?? -1;

    const turnRes = await pool.query(
      tenantId
        ? `SELECT turn_index, role, content FROM conversation_turns
            WHERE session_id = $1 AND tenant_id = $2 AND turn_index > $3
            ORDER BY turn_index ASC`
        : `SELECT turn_index, role, content FROM conversation_turns
            WHERE session_id = $1 AND turn_index > $2
            ORDER BY turn_index ASC`,
      tenantId ? [session.id, tenantId, cursor] : [session.id, cursor]
    );
    const newTurns = selectNewTurns(turnRes.rows, cursor);

    if (newTurns.length === 0) {
      return res.status(200).json({ ok: true, extracted: 0, reason: 'no new turns', cursorTurn: cursor });
    }
    if (!force && newTurns.length < CHECKPOINT_MIN_NEW_TURNS) {
      return res.status(200).json({
        ok: true, extracted: 0, reason: 'below checkpoint threshold',
        pendingTurns: newTurns.length, cursorTurn: cursor,
      });
    }

    const transcript = turnsToTranscript(newTurns);
    const result = await extractAndPersistMemories({
      transcript,
      userId: effectiveUserId,
      sessionId: sourceSession,
      tenantId,
      req,
    });

    if (result?.skipped) {
      // e.g. no LLM key reachable right now — do NOT advance the
      // cursor, so the next checkpoint retries this same slice.
      return res.status(200).json({ ok: true, extracted: 0, reason: `extraction skipped: ${result.skipped}`, cursorTurn: cursor });
    }

    // Advance the cursor past the turns just processed (success only).
    const maxTurn = newTurns[newTurns.length - 1].turn_index;
    await pool.query(
      `INSERT INTO memory_extract_cursors (session_id, conversation_id, last_turn_index, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (session_id) DO UPDATE
         SET last_turn_index = GREATEST(memory_extract_cursors.last_turn_index, EXCLUDED.last_turn_index),
             conversation_id = COALESCE(EXCLUDED.conversation_id, memory_extract_cursors.conversation_id),
             updated_at = now()`,
      [session.id, sourceSession, maxTurn]
    );

    return res.status(200).json({
      ok: true,
      extracted: result.extracted ?? 0,
      candidates: result.candidates ?? 0,
      path: result.path || null,
      ...(typeof result.inserted === 'number'
        ? { inserted: result.inserted, updated: result.updated, superseded: result.superseded }
        : {}),
      newTurns: newTurns.length,
      cursorTurn: maxTurn,
    });
  } catch (err) {
    console.error('[checkpoint-memories] failed:', err?.message || err);
    // Never breaks the call — the client fires this best-effort, and the
    // cursor was not advanced, so the next checkpoint retries the slice.
    return res.status(500).json({ ok: false, error: err?.message || 'checkpoint failed' });
  }
}
