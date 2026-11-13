// api/media-gallery.js — gallery + semantic recall for generated media.
//
// GET  ?userId=&type=&query=&limit=&filed=1 | &stored=1
//      Lists media rows from the Neon store (memory_items). Default view is
//      the main list, organized by name server-side; filed=1 lists only the
//      Saved place (rows the user filed away from the viewer — never
//      deleted, always reopenable); stored=1 lists only the Database
//      place (rows the user stored into the database, Troy's order
//      2026-11-13 — also by name, and the name search applies to it).
// POST { userId, id, filed: true|false|'archive' }
//      Files (true), unfiles (false), or archives ('archive' — reserved for
//      agent test residue) one row. State lives in memory_items.category
//      via lib/mediaMemory.js setMediaFiled.
// POST { userId, id, stored: true|false }
//      Stores one row in the Database place (true — text artifacts and
//      documents also snapshot their full content into the row), or
//      restores it to the main list (false), via setMediaStored with the
//      same identity scope as every other verb here.
import { applyBrowserCors } from '../../lib/security.js';
import { retrieveMedia, setMediaFiled, setMediaStored } from '../../lib/mediaMemory.js';
import { resolveTenant, isTenantId, tenantEnforced } from '../../lib/tenant.js';

// The one identity resolution both verbs share — identical to the rule
// this handler has always applied to its reads, so a caller can file
// exactly the rows it can see.
function resolveGalleryIdentity(req, candidate) {
  const token = resolveTenant(req);
  let effectiveTenant = null;
  let effectiveUser = candidate;

  if (token) {
    effectiveTenant = token.tenantId;
    effectiveUser = token.tenantId;
  } else if (tenantEnforced()) {
    // If a tenant UUID was requested without a valid token, isolate tenant data
    // by falling back to guest scope so public artifacts still render without 401.
    if (isTenantId(candidate)) {
      effectiveTenant = null;
      effectiveUser = 'guest';
    } else {
      effectiveUser = candidate;
    }
  }
  return { effectiveTenant, effectiveUser };
}

export default async function handler(req, res) {
  applyBrowserCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const candidate = String(body.userId || '').trim();
    const id = body.id;
    if (!candidate) return res.status(400).json({ error: 'userId required' });
    if (id == null || id === '') return res.status(400).json({ error: 'id required' });

    const { effectiveTenant, effectiveUser } = resolveGalleryIdentity(req, candidate);

    // Store / restore (the Database place) — a distinct action from
    // filing, selected by the presence of a boolean `stored` field.
    if (typeof body.stored === 'boolean') {
      try {
        const result = await setMediaStored({ userId: effectiveUser, tenantId: effectiveTenant, id, stored: body.stored });
        if (!result.updated) {
          return res.status(result.error ? 502 : 404).json({ error: result.error || 'media item not found' });
        }
        return res.status(200).json({
          ok: true,
          id,
          state: body.stored ? 'stored' : 'general',
          snapshotted: !!result.snapshotted,
        });
      } catch (err) {
        console.error('[media-gallery] store error:', err?.message || err);
        return res.status(500).json({ error: err?.message || 'store update failed' });
      }
    }

    const state = body.filed === 'archive' ? 'test-residue'
      : body.filed === true ? 'filed'
      : body.filed === false ? 'general'
      : null;
    if (!state) return res.status(400).json({ error: 'filed must be true, false, or "archive"; or stored must be true or false' });

    try {
      const updated = await setMediaFiled({ userId: effectiveUser, tenantId: effectiveTenant, id, state });
      if (!updated) return res.status(404).json({ error: 'media item not found' });
      return res.status(200).json({ ok: true, id, state });
    } catch (err) {
      console.error('[media-gallery] file error:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'file update failed' });
    }
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const candidate = (req.query?.userId || '').trim();
  if (!candidate) {
    return res.status(400).json({ error: 'userId required' });
  }

  const { effectiveTenant, effectiveUser } = resolveGalleryIdentity(req, candidate);

  const query     = (req.query?.query    || '').trim() || null;
  const limit     = Math.min(Number(req.query?.limit || 30), 100);
  const mediaType = ['image', 'video', 'model3d', 'artifact', 'document'].includes(req.query?.type) ? req.query.type : 'all';
  const filed     = req.query?.filed === '1' || req.query?.filed === 'true';
  const stored    = req.query?.stored === '1' || req.query?.stored === 'true';

  try {
    const items = await retrieveMedia({ userId: effectiveUser, query, limit, mediaType, tenantId: effectiveTenant, filed, stored });
    return res.status(200).json({ userId: effectiveUser, items });
  } catch (err) {
    console.error('[media-gallery] error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'gallery fetch failed' });
  }
}
