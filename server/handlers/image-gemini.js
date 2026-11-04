// api/image-gemini.js — image generation via Google Gemini ("Nano Banana").
//
// Replaces the retired Imagen route (handler deleted Oct 2026 after
// Google shut the Gemini-API Imagen path down — provider inventory
// row 25). This is Google's CURRENT native image generation: a
// generateContent call with image output requested, the image part
// returned as base64, re-hosted to Vercel Blob so the widget can
// display it with a plain <img src> and the /api/latest-image poller
// can find it — exactly like the other image handlers.
//
// MODEL: gemini-3.1-flash-image (Nano Banana 2), pinned 2026-11-01
// from Google's official pricing page + image-generation docs
// (ai.google.dev/gemini-api/docs/pricing and .../docs/image-generation,
// read at build time for provider wiring bite G1). The inventory's
// gemini-2.5-flash-image class is now Google's LEGACY image model
// (the docs recommend migrating away from it); the newer
// gemini-nano-banana-2.1 is presented through Google's Interactions
// API, so this generateContent route pins the current flash-image
// workhorse instead. Google renames these models — the constant
// below is the one line to change.
//
// KEY: the existing Gemini key path (lib/llm.js keyForProvider 'gemini'
// — user X-User-Key-GEMINI header first, then GEMINI_API_KEY /
// GOOGLE_GENAI_API_KEY env). Deliberately NOT GOOGLE_API_KEY: that
// name is taken in production by an unrelated Google key (see
// lib/actionable/providers.js).
//
// Body: { prompt, userId?, aspect? = 'portrait' | 'square' | 'landscape' }

import { put } from '@vercel/blob';
import { requireWebhookSecret } from '../../lib/security.js';
import { isAllowed, SAFE_REFUSAL } from '../../lib/moderation.js';
import { getKey } from '../../lib/userKeys.js';
import { keyForProvider } from '../../lib/llm.js';
import { resolveHandlerTenant } from '../../lib/tenant.js';
import { costFor, meterGate, denyMetering, recordMetered, getUsageDb } from '../../lib/usage.js';
import { randomUUID } from 'node:crypto';
import { safetyDecision, safetyInputsFromRequest } from '../../lib/safety.js';
import { getProfileDb, resolveProfileSafety } from '../../lib/profile.js';
import { saveMediaMemory } from '../../lib/mediaMemory.js';

const MODEL = 'gemini-3.1-flash-image';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Gemini imageConfig aspect ratios (API reference, ImageConfig):
// portrait is the phone-fill default, same as the other image routes.
const ASPECT_TO_RATIO = {
  square:    '1:1',
  portrait:  '9:16',
  landscape: '16:9',
};

const blobPrefix = (userId) => `thinkinbuddy/images/${userId}/`;

export default async function handler(req, res) {
  // Shared-secret gate, same as every ElevenLabs tool route (see
  // image.js): server-to-server, no browser Origin to check.
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireWebhookSecret(req, res)) return;

  const prompt = req.body?.prompt || req.query?.prompt;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const userId = req.body?.userId || req.query?.userId || 'anonymous';
  // Tenant for metering (lib/tenant.js, bite-1b pattern): compat mode
  // resolves ok with no scoping tenant and the metering block below is
  // a no-op; enforced (hosted) mode requires a session token or the
  // tenant id carried as userId.
  const resolvedTenant = resolveHandlerTenant(req, userId);
  if (!resolvedTenant.ok) {
    return res.status(400).json({ error: 'tenant identity required (session token or tenant user_id)' });
  }

  // Media identity (safety wiring bite 4): in enforced mode the
  // resolved tenant — never a caller-claimed userId — keys Blob
  // storage and media memory, so the session-scoped latest-media
  // pollers find this tenant's media and no one else's. Compat mode
  // preserves the legacy request userId exactly.
  const mediaUserId = resolvedTenant.enforced ? resolvedTenant.tenantId : userId;

  const aspect = (req.body?.aspect || req.query?.aspect || 'portrait').toLowerCase();
  const aspectRatio = ASPECT_TO_RATIO[aspect] || ASPECT_TO_RATIO.portrait;

  const { key: apiKey, source: keySource } = keyForProvider(req, 'gemini');
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!apiKey)    return res.status(500).json({ result: 'GEMINI_API_KEY not configured' });
  if (!blobToken) return res.status(500).json({ result: 'BLOB_READ_WRITE_TOKEN not configured' });

  // Kid-safe gate: moderate the prompt BEFORE spending a provider call.
  // Hosted mode: the tenant profile decides fail-closed through the
  // shared resolver (lib/profile.js resolveProfileSafety — safety
  // wiring bite 1; this handler is born profile-aware, provider
  // wiring bite G1); when the profile cannot decide (no row,
  // onboarding unfinished, or the profile read failed) the resolver's
  // safe default applies safety — the request inputs are never the
  // fallback in hosted mode. Compat mode never queries a profile.
  // Moderation itself is OpenAI's free endpoint, keyed like the FLUX
  // route (the Gemini key cannot call it).
  let { failClosed } = safetyDecision(safetyInputsFromRequest(req));
  if (resolvedTenant.enforced && resolvedTenant.tenantId) {
    const resolved = await resolveProfileSafety(getProfileDb, resolvedTenant.tenantId);
    ({ failClosed } = resolved.decision);
    if (resolved.safeDefault) {
      console.error(`[image-gemini] profile safety unresolved (${resolved.source}) — safe default applied`);
    }
  }
  const mod = await isAllowed(prompt, getKey(req, 'OPENAI_API_KEY'), { failClosed });
  if (!mod.allowed) {
    console.warn('[image-gemini] prompt blocked by moderation:', mod.reason);
    return res.status(200).json({ result: SAFE_REFUSAL });
  }

  // Usage metering (hosted model, lib/usage.js): enforced mode + our
  // server key -> the tenant's bucket must cover the estimate BEFORE
  // the provider call (402 credits_exhausted, no provider call made).
  // Compat mode and BYO user keys skip metering entirely — see
  // shouldMeter in lib/usage.js.
  const imgReqId = randomUUID();
  const imgEst = costFor('image');
  const imgGate = await meterGate({ db: getUsageDb, tenantId: resolvedTenant.tenantId, keySource, estCredits: imgEst, action: 'image' });
  if (!imgGate.allowed) return denyMetering(res, imgGate);

  try {
    const response = await fetch(`${API_BASE}/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio },
        },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err?.error?.message || `Google ${response.status}`;
      console.error('[image-gemini] Google error:', msg);
      // Tools get a speakable failure string; status reflects the real failure.
      return res.status(502).json({ result: `Gemini image generation failed: ${msg}` });
    }

    const data = await response.json().catch(() => null);
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find((p) => p?.inlineData?.data);
    if (!imgPart) {
      // No image part: either Google blocked the prompt at its own
      // safety layer (promptFeedback.blockReason) or the model
      // answered text-only. Either way there is nothing to show.
      const blocked = data?.promptFeedback?.blockReason;
      if (blocked) console.warn('[image-gemini] prompt blocked by Google:', blocked);
      return res.status(502).json({ result: 'Gemini returned no image data' });
    }

    const mimeType = imgPart.inlineData.mimeType || 'image/png';
    const buf = Buffer.from(imgPart.inlineData.data, 'base64');
    const ts = Date.now();
    const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const key = `${blobPrefix(mediaUserId)}${ts}.${ext}`;
    const blob = await put(key, buf, {
      access: 'public',
      contentType: mimeType,
      addRandomSuffix: false,
      token: blobToken,
    });
    const publicUrl = blob.url;
    // Sidecar so /api/latest-image can return the original prompt as caption.
    try {
      await put(
        `${blobPrefix(mediaUserId)}${ts}.meta.json`,
        JSON.stringify({ prompt, provider: 'gemini', model: MODEL }),
        { access: 'public', contentType: 'application/json', addRandomSuffix: false, token: blobToken },
      );
    } catch (err) {
      console.error('[image-gemini] sidecar write failed (non-fatal):', err?.message || err);
    }
    // Persist to Neon memory so this image is recallable by semantic search.
    saveMediaMemory({ userId: mediaUserId, type: 'image', blobUrl: publicUrl, prompt, createdAt: ts, tenantId: resolvedTenant.tenantId }).catch(
      (e) => console.error('[image-gemini] saveMediaMemory failed (non-fatal):', e?.message || e)
    );

    await recordMetered(imgGate, getUsageDb, {
      tenantId: resolvedTenant.tenantId, provider: 'google', action: 'image',
      units: 1, credits: imgEst, requestId: imgReqId,
    });

    // Tool-call response: ElevenLabs reads `result` and speaks it; the widget
    // separately polls /api/latest-image and shows the picture once it lands.
    return res.status(200).json({
      result: 'Image generated.',
      url: publicUrl,
      prompt,
      provider: 'gemini',
      model: MODEL,
    });
  } catch (err) {
    console.error('[image-gemini] error:', err?.message || err);
    return res.status(502).json({ result: `Gemini image error: ${err?.message || 'unknown'}` });
  }
}
