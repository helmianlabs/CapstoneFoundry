// api/export-document.js — Export structured lesson plans, business summaries,
// and brain dumps to Markdown / HTML / PDF and push to Google Docs.
// Persists permanently in Neon `memory_documents` and Vercel Blob.

import { put } from '@vercel/blob';
import { requireWebhookSecret } from '../../lib/security.js';
import { resolveHandlerTenant } from '../../lib/tenant.js';
import { getPool, classifyMemoryCategory } from './memory.js';

export const config = { maxDuration: 60 };

const blobPrefix = (userId) => `thinkinbuddy/documents/${userId}/`;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireWebhookSecret(req, res)) return;

  const title = (req.body?.title || req.query?.title || 'Exported Document').trim();
  const content = (req.body?.content || req.query?.content || '').trim();
  if (!content) return res.status(400).json({ error: 'content required' });

  const userId = req.body?.userId || req.query?.userId || 'anonymous';
  const resolvedTenant = resolveHandlerTenant(req, userId);
  if (!resolvedTenant.ok) {
    return res.status(400).json({ error: 'tenant identity required' });
  }

  const effectiveUserId = resolvedTenant.enforced ? resolvedTenant.tenantId : userId;
  const tenantId = resolvedTenant.tenantId || null;
  const category = classifyMemoryCategory(title, content);
  const ts = Date.now();

  try {
    // 1. Upload Markdown to Vercel Blob
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const cleanSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) || 'document';
    const blobKey = `${blobPrefix(effectiveUserId)}${ts}-${cleanSlug}.md`;
    const blob = await put(blobKey, Buffer.from(content, 'utf8'), {
      access: 'public',
      contentType: 'text/markdown; charset=utf-8',
      addRandomSuffix: false,
      token: blobToken,
    });
    const downloadUrl = blob.url;

    // 2. Optional push to Google Docs via Google Apps Script webhook
    let gdocUrl = null;
    const docsWebhook = process.env.DOCS_WEBHOOK_URL;
    if (docsWebhook) {
      try {
        console.log(`[export-document] Pushing "${title}" to Google Docs webhook...`);
        const gdocRes = await fetch(docsWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        });
        if (gdocRes.ok) {
          const gdocData = await gdocRes.json().catch(() => ({}));
          gdocUrl = gdocData.url || null;
        }
      } catch (err) {
        console.warn('[export-document] Google Docs push failed (non-fatal):', err.message);
      }
    }

    // 3. Persist in Neon `memory_documents`
    const pool = getPool();
    const docRow = await pool.query(`
      INSERT INTO memory_documents (tenant_id, user_id, title, category, content, blob_url, gdoc_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, created_at
    `, [tenantId, effectiveUserId, title, category, content, downloadUrl, gdocUrl]);

    // 4. File in Librarian `memory_filings`
    try {
      await pool.query(`
        INSERT INTO memory_filings (tenant_id, memory_id, category, rule_key, explanation)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        tenantId,
        `doc:${docRow.rows[0].id}`,
        category,
        `librarian.document.${category}`,
        `Exported document "${title}" filed in ${category}`
      ]);
    } catch (e) {
      // non-fatal
    }

    return res.status(200).json({
      ok: true,
      result: `Document "${title}" exported successfully under ${category.toUpperCase()}. You can access it at: ${gdocUrl || downloadUrl}`,
      title,
      category,
      downloadUrl,
      gdocUrl,
    });
  } catch (err) {
    console.error('[export-document] error:', err);
    return res.status(500).json({ error: err.message || 'Export failed' });
  }
}
