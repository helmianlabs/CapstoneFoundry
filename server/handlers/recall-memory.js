// api/recall-memory.js — LIVE mid-conversation memory recall tool.
//
// Registered on the ElevenLabs agent as a new `recall_memory` webhook tool
// (see scripts/update-agent-config.mjs) so the agent can look something up
// from Neon DURING a call, not just from the ~30 facts pre-loaded into the
// system prompt at boot (api/prime-agent.js). Uses the same vector-search
// retrieveMemories() the boot path uses, just with a live query.
//
// userId is bound to the {{user_id}} dynamic variable (same mechanism
// index.html already uses for save_memory -- see conversation_config
// dynamic_variables wiring in index.html's elevenlabs-convai:call handler).
//
// Body: { userId, query }
// Response: kept intentionally simple/flat -- ElevenLabs tools have no
// response_body_schema configured, so whatever JSON comes back is handed to
// the LLM as raw context for it to speak naturally, not parsed structurally.

import { retrieveMemoriesWithMeta } from './memory.js';
import { authorizeMemoryAccess } from '../../lib/tenant.js';

// Mid-call recall depth. Was hardcoded 5, which — combined with the silent
// boot fallback — meant the agent only ever saw the same five boot-top
// facts. 8 gives a real search room to surface something beyond the
// briefing's head without flooding the call's context.
export const RECALL_LIMIT = 8;

// The model often reads `summary` and skips the facts array. Include the
// saved name (subject/key) so "BlueSky42" is spoken as the Capstone canary
// code, not as an unlabeled string.
export function formatRecallLine(fact) {
  const value = fact && fact.value != null ? String(fact.value) : '';
  const key = fact && typeof fact.key === 'string' ? fact.key.trim() : '';
  const dateStr = fact && fact.updatedAt ? new Date(fact.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const prefix = dateStr ? `[${dateStr}] ` : '';
  if (key && key !== value) return `${prefix}${key}: ${value}`;
  return `${prefix}${value}`;
}

export function formatRecallSummary(facts) {
  return (Array.isArray(facts) ? facts : []).map(formatRecallLine).filter((line) => line).join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Embedding + a read of whatever this userId has stored. A tenant UUID
  // in the body is not a credential: the signed-in PWA presents its
  // session (and the same id as the widget user_id), and the
  // recall_memory tool presents X-Webhook-Secret. The UUID only selects
  // a tenant the caller is already allowed to read. This does not wait
  // on ENFORCE_TOOL_AUTH — that flag being unset left this route open.
  const userId = req.body?.userId;
  const access = authorizeMemoryAccess(req, userId);
  if (!access.ok) {
    return res.status(access.status).json({ error: access.error });
  }

  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    // MODE VISIBILITY (memory-fix bite, 2026-11-05): the response carries
    // `mode` — 'vector' when the semantic search actually ran,
    // 'boot-fallback' when the query embedding failed and these rows are
    // merely the top boot-ranked facts. Production silently served
    // boot-fallback for every query for weeks (OPENAI_API_KEY is set on
    // the Preview target only); the mode makes that state observable in
    // every tool result and log line from now on.
    const { facts, mode } = await retrieveMemoriesWithMeta(access.userId, { limit: RECALL_LIMIT, query, tenantId: access.tenantId });
    if (!facts.length) {
      return res.status(200).json({ found: false, mode, summary: "I don't have anything saved about that." });
    }
    const summary = formatRecallSummary(facts);
    return res.status(200).json({ found: true, mode, count: facts.length, facts, summary });
  } catch (err) {
    console.error('[recall-memory] failed:', err?.message || err);
    return res.status(200).json({ found: false, summary: "I couldn't check my memory just now.", error: err?.message });
  }
}
