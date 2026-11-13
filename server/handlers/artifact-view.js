// api/artifact-view.js — serve one built website (kind 'artifact') INLINE
// through the app, so the gallery viewer can render it on the next screen.
//
// Why this exists (forensic, 2026-11-13): built pages are stored as public
// Vercel Blob objects, and Blob serves them back with
//   Content-Disposition: attachment
//   Content-Security-Policy: default-src 'none'
// Pointing the viewer's iframe at the raw Blob URL therefore renders a
// black screen (the file is a forced download under a block-everything
// policy) and only the external "Open" works — which drops the user into
// a downloads/files flow. This route fetches the stored HTML server-side
// and returns it from the app's own origin with an inline disposition
// and a sandbox policy that permits the page to render and run its own
// inline code while keeping it in an opaque origin, unable to reach the
// app around it.
//
// Scope matches the gallery read exactly: artifact rows are listed to
// every identity there (retrieveMedia's `OR kind = 'artifact'`), and the
// underlying Blob objects are public — this route exposes nothing the
// gallery does not already show.
import { applyBrowserCors } from '../../lib/security.js';
import { getPool } from './memory.js';

export default async function handler(req, res) {
  applyBrowserCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const id = String(req.query?.id || '').trim();
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'numeric id required' });
  }

  let blobUrl = null;
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT blob_url AS "blobUrl"
         FROM memory_items
        WHERE id = $1
          AND kind = 'artifact'
          AND blob_url IS NOT NULL
          AND (valid_until IS NULL OR valid_until > now())
          AND supersedes IS NULL
        LIMIT 1`,
      [id]
    );
    blobUrl = rows?.[0]?.blobUrl || null;
  } catch (err) {
    console.error('[artifact-view] lookup failed:', err?.message || err);
    return res.status(500).json({ error: 'artifact lookup failed' });
  }
  if (!blobUrl) return res.status(404).json({ error: 'artifact not found' });

  let html = null;
  try {
    const upstream = await fetch(blobUrl);
    if (!upstream.ok) throw new Error(`blob fetch ${upstream.status}`);
    html = await upstream.text();
  } catch (err) {
    console.error('[artifact-view] blob fetch failed:', err?.message || err);
    return res.status(502).json({ error: 'artifact content unavailable' });
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline');
  // Sandbox: the page renders and its own inline scripts run, but it gets
  // an opaque origin — no access to the app's storage, cookies, or DOM.
  res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-modals allow-popups allow-forms');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(html);
}
