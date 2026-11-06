// api/generate-3d.js — Text-to-3D character generation via Meshy.
// Generates a 3D model (.glb) from a natural language prompt, stores the model
// in Vercel Blob, indexes it in Neon memory_items, and returns the public model URL.

import { put } from '@vercel/blob';
import { requireWebhookSecret } from '../../lib/security.js';
import { resolveHandlerTenant } from '../../lib/tenant.js';
import { saveMediaMemory } from '../../lib/mediaMemory.js';
import { classifyMemoryCategory } from './memory.js';

export const config = { maxDuration: 180 };

const blobPrefix = (userId) => `thinkinbuddy/models3d/${userId}/`;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireWebhookSecret(req, res)) return;

  const prompt = req.body?.prompt || req.query?.prompt;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const userId = req.body?.userId || req.query?.userId || 'anonymous';
  const resolvedTenant = resolveHandlerTenant(req, userId);
  if (!resolvedTenant.ok) {
    return res.status(400).json({ error: 'tenant identity required' });
  }

  const mediaUserId = resolvedTenant.enforced ? resolvedTenant.tenantId : userId;
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'MESHY_API_KEY is not configured on server' });
  }

  const base = 'https://api.meshy.ai/openapi/v2/text-to-3d';
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  try {
    console.log(`[generate-3d] Submitting Meshy task for prompt: "${prompt.slice(0, 80)}"...`);
    const submitRes = await fetch(base, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mode: 'preview',
        prompt,
        ai_model: 'meshy-5',
        topology: 'quad',
        target_polycount: 30000,
        should_remesh: true,
        target_formats: ['glb'],
      }),
    });

    if (!submitRes.ok) {
      const errBody = await submitRes.text();
      console.error('[generate-3d] Meshy submission error:', submitRes.status, errBody);
      return res.status(502).json({ result: `3D generation submission failed: ${errBody.slice(0, 200)}` });
    }

    const submitData = await submitRes.json();
    const taskId = submitData.result;
    if (!taskId) {
      return res.status(502).json({ result: 'Meshy returned no task ID' });
    }

    console.log(`[generate-3d] Meshy task ID: ${taskId}, polling status...`);
    const startTime = Date.now();
    const maxWaitMs = 120_000;
    let doneTask = null;

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 6000));
      const pollRes = await fetch(`${base}/${taskId}`, { headers });
      if (!pollRes.ok) continue;
      const t = await pollRes.json();
      console.log(`[generate-3d] task=${taskId} status=${t.status} progress=${t.progress}%`);
      if (t.status === 'SUCCEEDED') {
        doneTask = t;
        break;
      }
      if (t.status === 'FAILED' || t.status === 'EXPIRED') {
        return res.status(502).json({ result: `3D generation failed: ${t.task_error?.message || t.status}` });
      }
    }

    if (!doneTask || !doneTask.model_urls?.glb) {
      return res.status(504).json({ result: '3D generation timed out waiting for mesh to complete' });
    }

    const glbRemoteUrl = doneTask.model_urls.glb;
    console.log('[generate-3d] Downloading generated GLB:', glbRemoteUrl);
    const glbFetch = await fetch(glbRemoteUrl);
    if (!glbFetch.ok) {
      throw new Error(`Failed to download GLB from Meshy: ${glbFetch.status}`);
    }
    const glbBuffer = Buffer.from(await glbFetch.arrayBuffer());

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const ts = Date.now();
    const blobKey = `${blobPrefix(mediaUserId)}${ts}.glb`;
    const blob = await put(blobKey, glbBuffer, {
      access: 'public',
      contentType: 'model/gltf-binary',
      addRandomSuffix: false,
      token: blobToken,
    });

    const publicUrl = blob.url;
    const thumbUrl = doneTask.thumbnail_url || null;

    // Sidecar metadata
    try {
      await put(
        `${blobPrefix(mediaUserId)}${ts}.meta.json`,
        JSON.stringify({ prompt, type: 'model3d', thumbnailUrl: thumbUrl }),
        { access: 'public', contentType: 'application/json', addRandomSuffix: false, token: blobToken }
      );
    } catch (e) {
      console.warn('[generate-3d] sidecar write failed:', e.message);
    }

    // Persist into Neon media memory
    try {
      await saveMediaMemory({
        userId: mediaUserId,
        type: 'model3d',
        blobUrl: publicUrl,
        prompt,
        createdAt: ts,
        tenantId: resolvedTenant.tenantId,
      });
    } catch (e) {
      console.warn('[generate-3d] saveMediaMemory failed:', e.message);
    }

    return res.status(200).json({
      result: `3D character model generated successfully.`,
      modelUrl: publicUrl,
      thumbnailUrl: thumbUrl,
      prompt,
    });
  } catch (err) {
    console.error('[generate-3d] unexpected error:', err);
    return res.status(500).json({ result: `3D generation error: ${err.message || 'unknown'}` });
  }
}
