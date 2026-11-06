// api/task.js — save_task_for_clyde.
//
// Storage is one JSON blob per task. The prefix is the authorized
// tenant, never a caller-supplied id by itself:
//   tasks/<authorized userId>/<id>.json
//
// A raw UUID does not authorize. Browser callers need a session for
// that tenant. The agent tool needs X-Webhook-Secret, and only then
// may userId ({{user_id}}) select the tenant. Same rule as memory
// (authorizeMemoryAccess). ENFORCE_TOOL_AUTH is not the gate.
//
// Older blobs at tasks/<id>.json have no tenant. They are not listed
// and not migrated.

import { authorizeMemoryAccess } from '../../lib/tenant.js';

function safeSegment(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(s)) return null;
  return s;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const candidate = req.method === 'POST'
    ? (req.body?.userId || req.query?.userId)
    : req.query?.userId;
  const access = authorizeMemoryAccess(req, candidate);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  const owner = safeSegment(access.userId);
  if (!owner) return res.status(400).json({ error: 'userId required' });

  const { put, list, del } = await import('@vercel/blob');
  const prefix = `tasks/${owner}/`;

  if (req.method === 'POST') {
    const { task, project } = req.body || {};
    if (!task) return res.status(400).json({ error: 'task is required' });
    const id = Date.now();
    const entry = {
      id,
      task,
      project: project || 'general',
      userId: owner,
      created: new Date().toISOString(),
    };
    try {
      await put(`${prefix}${id}.json`, JSON.stringify(entry), {
        access: 'public',
        contentType: 'application/json',
      });
    } catch (e) {
      console.error('[task] blob write failed:', e?.message || e);
      return res.status(500).json({ error: 'Could not save task' });
    }
    return res.status(200).json({ ok: true, message: `Got it. Task saved for Clyde: ${task}` });
  }

  if (req.method === 'GET') {
    try {
      const { blobs } = await list({ prefix });
      const tasks = await Promise.all(
        blobs.map(b => fetch(b.url).then(r => r.json()).catch(() => null))
      );
      const own = tasks.filter((t) => t && (!t.userId || safeSegment(String(t.userId)) === owner));
      return res.status(200).json(own.sort((a, b) => a.id - b.id));
    } catch (e) {
      console.error('[task] list failed:', e?.message || e);
      return res.status(500).json({ error: 'Could not list tasks' });
    }
  }

  const id = safeSegment(req.query?.id == null ? '' : String(req.query.id));
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const { blobs } = await list({ prefix: `${prefix}${id}` });
    const exact = blobs.find((b) => b.pathname === `${prefix}${id}.json`);
    if (exact) await del(exact.url);
  } catch (e) {
    console.error('[task] delete failed:', e?.message || e);
    return res.status(500).json({ error: 'Could not delete task' });
  }
  return res.status(200).json({ ok: true });
}
