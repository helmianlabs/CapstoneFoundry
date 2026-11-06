// api/media-gallery.js — gallery + semantic recall for generated media.
import { applyBrowserCors } from '../../lib/security.js';
import { retrieveMedia } from '../../lib/mediaMemory.js';
import { resolveTenant, isTenantId, tenantEnforced } from '../../lib/tenant.js';

export default async function handler(req, res) {
  applyBrowserCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const candidate = (req.query?.userId || '').trim();
  if (!candidate) {
    return res.status(400).json({ error: 'userId required' });
  }

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

  const query     = (req.query?.query    || '').trim() || null;
  const limit     = Math.min(Number(req.query?.limit || 30), 100);
  const mediaType = ['image', 'video', 'model3d', 'artifact', 'document'].includes(req.query?.type) ? req.query.type : 'all';

  try {
    const items = await retrieveMedia({ userId: effectiveUser, query, limit, mediaType, tenantId: effectiveTenant });
    return res.status(200).json({ userId: effectiveUser, items });
  } catch (err) {
    console.error('[media-gallery] error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'gallery fetch failed' });
  }
}
