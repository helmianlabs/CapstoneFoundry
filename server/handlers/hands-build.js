// server/handlers/hands-build.js — build a real artifact for the user.
//
// Triggered by Mark's trigger_hands_build tool (voice), the app menu's
// build button, or the relay — all three land here. Given a request in
// plain words, this generates a real single-file landing page, stores
// it in Vercel Blob, registers it in the media gallery (kind
// 'artifact' → Gallery → Websites & Apps), and verifies both before
// answering. Success is returned ONLY after the page exists at its
// address and is listed; every failure returns an honest error with
// ok:false. (This handler previously returned an unconditional
// success while its only side effect targeted a lib/db.js that does
// not exist — see the 2026-11-13 forensic audit, §1.5.)
//
// Authorization follows the memory/task rule (authorizeMemoryAccess):
// a browser caller needs a session for the tenant; the agent tool
// needs X-Webhook-Secret, and only then may userId ({{user_id}})
// select the tenant. A raw UUID by itself never authorizes.

import { put } from '@vercel/blob';
import { inspectTextSecurity } from '../../lib/injectionDefense.js';
import { authorizeMemoryAccess } from '../../lib/tenant.js';
import { completeText } from '../../lib/llm.js';
import { saveMediaMemory, retrieveMedia } from '../../lib/mediaMemory.js';
import { buildArtifact, safeSegment, HandsBuildError, BUILD_SYSTEM_PROMPT } from '../../lib/handsBuild.js';

export default async function handleHandsBuild(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const prompt = String(body.prompt || '').trim();
  if (!prompt) {
    return res.status(400).json({ ok: false, error: 'prompt_required', message: 'A build request in plain words is required.' });
  }
  const artifactType = String(body.artifact_type || 'landing_page').trim();
  if (artifactType !== 'landing_page') {
    return res.status(400).json({ ok: false, error: 'unsupported_artifact_type', message: `Only landing pages can be built right now (asked for: ${artifactType}).` });
  }
  // body.target_path is a legacy field from the old façade (it named a
  // static file that shipped with the site). It is accepted and
  // ignored: built pages live in the user's Gallery, not at a
  // hard-coded path.

  // Adversarial & Security Inspection (unchanged from before).
  const security = inspectTextSecurity(prompt);
  if (!security.safe) {
    return res.status(400).json({ ok: false, error: 'security_policy_refusal', reason: security.reason, category: security.category });
  }

  const access = authorizeMemoryAccess(req, body.userId || req.query?.userId);
  if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
  const owner = safeSegment(access.userId || '');
  if (!owner) return res.status(400).json({ ok: false, error: 'userId required' });
  const tenantId = access.tenantId || null;

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return res.status(500).json({ ok: false, error: 'storage_not_configured', message: 'Page storage is not configured on the server.' });
  }

  try {
    const built = await buildArtifact({
      prompt,
      owner,
      tenantId,
      deps: {
        generate: (p) => completeText({
          system: BUILD_SYSTEM_PROMPT,
          user: `Build request: ${p}`,
          // 4500, raised from 2600 on 2026-11-13: at 2600 every
          // full-size landing-page request failed the completeness
          // check (the model spends part of the budget thinking, and
          // a polished multi-section page does not fit in the rest),
          // while a tiny one-section page succeeded end to end in
          // ~4 s. 4500 leaves the whole round trip — generation,
          // storage, registration, read-back — inside the tool's
          // 25 s window with headroom.
          maxTokens: 4500,
          req,
        }),
        store: async (pathname, html) => {
          const blob = await put(pathname, html, {
            access: 'public',
            contentType: 'text/html; charset=utf-8',
            addRandomSuffix: false,
            token: blobToken,
          });
          return blob?.url || null;
        },
        register: (entry) => saveMediaMemory(entry),
        verify: async ({ url }) => {
          const pageRes = await fetch(url).catch(() => null);
          if (!pageRes || !pageRes.ok) return false;
          const served = await pageRes.text().catch(() => '');
          if (!/<html[\s>]/i.test(served)) return false;
          const items = await retrieveMedia({ userId: owner, limit: 20, mediaType: 'artifact', tenantId });
          return Array.isArray(items) && items.some((i) => i.blobUrl === url);
        },
      },
    });

    return res.status(200).json({
      ok: true,
      action: 'hands_build_complete',
      artifact_type: 'landing_page',
      id: built.id,
      title: built.title,
      url: built.url,
      message: `Built a landing page titled "${built.title}" and saved it in the user's Gallery under Websites & Apps. Its address is ${built.url}`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const stage = err instanceof HandsBuildError ? err.stage : 'unknown';
    console.error(`[hands-build] build failed at stage "${stage}":`, err?.message || err);
    return res.status(502).json({
      ok: false,
      error: 'build_failed',
      stage,
      message: err?.message || 'The build failed.',
    });
  }
}
