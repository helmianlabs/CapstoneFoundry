// api/video-omni.js — text-to-video via Google Gemini Omni Flash.
//
// Google's CURRENT video model on the Gemini Developer API:
// gemini-omni-1.1-flash (Stable), reached through the Interactions
// API. This route replaces the never-built Veo-direct bite (G2):
// Google shut every Veo model down on this API (the last previews
// went dark 2026-10-22) and Veo survives only on the Gemini
// Enterprise Agent Platform — a different platform with different
// credentials, not this key path. Naming stays honest everywhere:
// the model is Omni Flash, never "Veo". (The Runway-hosted route in
// video-runway-veo.js is a separate thing and keeps its own name.)
//
// FLOW — specced at build time from Google's official docs
// (ai.google.dev/gemini-api/docs/omni, .../docs/interactions,
// .../docs/background-execution, read 2026-11-01 for bite G2′):
//   1. POST /v1beta/interactions with background:true and
//      response_format { type:'video', aspect_ratio, resolution:
//      '720p', delivery:'uri' } -> returns the interaction id with
//      status 'in_progress' immediately.
//   2. GET /v1beta/interactions/{id} until status 'completed'.
//      Terminal failures: 'failed' / 'cancelled'; 'requires_action'
//      is terminal here too (this tool has no client action to
//      give). The completed interaction's steps carry a
//      model_output content part { type:'video', uri } pointing at
//      a Files-API file.
//   3. GET /v1beta/files/{fileId} until state 'ACTIVE' ('FAILED' is
//      terminal), then GET /v1beta/files/{fileId}:download?alt=media
//      for the MP4 bytes — the files endpoints are keyed with ?key=
//      exactly as the docs' REST example does; the interactions
//      endpoints above use the x-goog-api-key header, also as
//      documented.
//   4. The MP4 is re-hosted to Vercel Blob under the tenant's video
//      prefix, like the other video handlers, so /api/latest-video
//      finds it across cold starts.
// URI delivery (not the default inline base64) because Google's
// docs steer videos over ~4MB to it and a 720p clip can exceed
// that; both poll loops are the documented REST shapes. The
// Api-Revision header is the one the background-execution guide's
// REST examples carry for this exact flow.
//
// KEY: the existing Gemini key path (lib/llm.js keyForProvider
// 'gemini' — user X-User-Key-GEMINI header first, then
// GEMINI_API_KEY / GOOGLE_GENAI_API_KEY env), same as image-gemini.
//
// METERING (lib/usage.js, action 'video_omni' — a SEPARATE rate,
// never Runway's): Google bills Omni video output by the token:
// $17.50 per 1M video-output tokens at 5,792 tokens per second of
// 720p (pricing page) = $0.1014/s, metered at 110 credits/s. The
// Interactions API documents NO duration request parameter
// (response_format takes type / aspect_ratio / resolution /
// delivery only; clip length is prompt-steered and the model page
// puts output at 3s–10s) and NO usage or duration field in the
// response, so there are no actuals to meter from. This route
// therefore meters the documented worst case — ASSUMED_SECONDS at
// the pinned 720p — gated BEFORE the create call. A caller-supplied
// 'duration' is accepted for tool-contract compatibility with the
// other video routes but is NOT sent to Google (no such parameter
// exists) and does NOT change the meter.
//
// Body: { prompt, userId?, aspect? = 'portrait' | 'landscape' }

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

const MODEL = 'gemini-omni-1.1-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// The revision the background-execution guide's REST examples pin.
const API_REVISION = '2026-05-20';
// Pinned output shape: 720p is the resolution the meter rate is
// priced from (5,792 tokens/s of 720p on the pricing page).
const RESOLUTION = '720p';
// Documented output range is 3s–10s (model page); the meter uses
// the maximum — see the header's metering note.
const ASSUMED_SECONDS = 10;
// Poll cadence: the docs' examples poll every 5s; the timeout
// leaves headroom under the router's 300s maxDuration, same as the
// Runway routes. Env overrides exist for tests / ops only.
const POLL_INTERVAL_MS = Number(process.env.OMNI_POLL_INTERVAL_MS) || 5000;
const POLL_TIMEOUT_MS = Number(process.env.OMNI_POLL_TIMEOUT_MS) || 270000;

const ASPECT_TO_RATIO = {
  portrait: '9:16',
  landscape: '16:9', // the API's default orientation
};

const blobPrefix = (userId) => `thinkinbuddy/videos/${userId}/`;

// Declared in the standard config shape. NOTE: through the single
// api/[...path].js router this export is informational only — the
// effective value lives in the router's ROUTE_FUNCTION_CONFIG map.
export const config = { maxDuration: 300 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The video content part of a completed interaction: scan the steps
// for a model_output part of type 'video' (the documented raw REST
// shape on the Omni page). Returns the part or null.
function videoPartOf(interaction) {
  for (const step of interaction?.steps || []) {
    if (step?.type !== 'model_output') continue;
    for (const part of step?.content || []) {
      if (part?.type === 'video' && (part.uri || part.data)) return part;
    }
  }
  return null;
}

// 'https://…/v1beta/files/<id>:download?alt=media' -> '<id>'
function fileIdFromUri(uri) {
  const m = String(uri || '').match(/\/files\/([^/:?]+)/);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  // Shared-secret gate, same as every ElevenLabs tool route:
  // server-to-server, no browser Origin to check. Video calls are
  // the expensive ones, so this gate matters here most.
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireWebhookSecret(req, res)) return;

  const prompt = req.body?.prompt || req.query?.prompt;
  if (!prompt) return res.status(400).json({ result: 'prompt required' });

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

  const aspect = (req.body?.aspect || req.query?.aspect || 'landscape').toLowerCase();
  const aspectRatio = ASPECT_TO_RATIO[aspect] || ASPECT_TO_RATIO.landscape;

  const { key: apiKey, source: keySource } = keyForProvider(req, 'gemini');
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!apiKey)    return res.status(500).json({ result: 'GEMINI_API_KEY not configured' });
  if (!blobToken) return res.status(500).json({ result: 'BLOB_READ_WRITE_TOKEN not configured' });

  // Kid-safe gate: moderate the prompt BEFORE spending a provider
  // call. Hosted mode: the tenant profile decides fail-closed
  // through the shared resolver (lib/profile.js resolveProfileSafety
  // — safety wiring bite 3's pattern; this handler is born
  // profile-aware, provider wiring bite G2′); when the profile
  // cannot decide (no row, onboarding unfinished, or the profile
  // read failed) the resolver's safe default applies safety — the
  // request inputs are never the fallback in hosted mode. Compat
  // mode never queries a profile.
  let { failClosed } = safetyDecision(safetyInputsFromRequest(req));
  if (resolvedTenant.enforced && resolvedTenant.tenantId) {
    const resolved = await resolveProfileSafety(getProfileDb, resolvedTenant.tenantId);
    ({ failClosed } = resolved.decision);
    if (resolved.safeDefault) {
      console.error(`[video-omni] profile safety unresolved (${resolved.source}) — safe default applied`);
    }
  }
  const mod = await isAllowed(prompt, getKey(req, 'OPENAI_API_KEY'), { failClosed });
  if (!mod.allowed) {
    console.warn('[video-omni] prompt blocked by moderation:', mod.reason);
    return res.status(200).json({ result: SAFE_REFUSAL });
  }

  // Usage metering (hosted model, lib/usage.js): enforced mode + our
  // server key -> the tenant's bucket must cover the estimate BEFORE
  // the provider call (402 credits_exhausted, no provider call made).
  // The estimate is the Omni rate at the documented maximum length
  // (see header). Compat mode and BYO user keys skip metering
  // entirely — see shouldMeter in lib/usage.js.
  const omniReqId = randomUUID();
  const omniEst = costFor('video_omni', { seconds: ASSUMED_SECONDS });
  const omniGate = await meterGate({ db: getUsageDb, tenantId: resolvedTenant.tenantId, keySource, estCredits: omniEst, action: 'video_omni' });
  if (!omniGate.allowed) return denyMetering(res, omniGate);

  const interactionHeaders = {
    'x-goog-api-key': apiKey,
    'Content-Type': 'application/json',
    'Api-Revision': API_REVISION,
  };
  // The docs' files-endpoint REST example keys with ?key=.
  const keyQuery = `key=${encodeURIComponent(apiKey)}`;

  try {
    const startedAt = Date.now();
    const timedOut = () => Date.now() - startedAt >= POLL_TIMEOUT_MS;

    // 1) Create the background interaction (docs: background:true
    // returns the id immediately; store stays at its default true,
    // which background execution requires).
    const createRes = await fetch(`${API_BASE}/interactions`, {
      method: 'POST',
      headers: interactionHeaders,
      body: JSON.stringify({
        model: MODEL,
        input: prompt,
        background: true,
        response_format: {
          type: 'video',
          aspect_ratio: aspectRatio,
          resolution: RESOLUTION,
          delivery: 'uri',
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      const msg = err?.error?.message || `Google ${createRes.status}`;
      console.error('[video-omni] Google create error:', msg);
      return res.status(502).json({ result: `Omni video generation failed: ${msg}` });
    }

    let interaction = await createRes.json().catch(() => null);
    const interactionId = interaction?.id;
    if (!interactionId) {
      console.error('[video-omni] Google returned no interaction id:', JSON.stringify(interaction));
      return res.status(502).json({ result: 'Google returned no interaction id' });
    }

    // 2) Poll the interaction until it completes (background guide:
    // in_progress -> completed | failed | cancelled).
    let lastStatus = interaction?.status || 'in_progress';
    while (lastStatus !== 'completed') {
      if (lastStatus === 'failed' || lastStatus === 'cancelled' || lastStatus === 'requires_action') {
        console.error('[video-omni] interaction ended with status', lastStatus);
        return res.status(502).json({ result: `Omni video generation failed: interaction ${lastStatus}` });
      }
      if (timedOut()) {
        console.error('[video-omni] interaction poll timed out at status', lastStatus);
        return res.status(504).json({ result: `Video generation timed out (last status: ${lastStatus})` });
      }
      await sleep(POLL_INTERVAL_MS);
      const pollRes = await fetch(`${API_BASE}/interactions/${encodeURIComponent(interactionId)}`, {
        headers: interactionHeaders,
      });
      if (!pollRes.ok) {
        // Transient — keep polling, same posture as the Runway routes.
        continue;
      }
      interaction = await pollRes.json().catch(() => interaction);
      lastStatus = interaction?.status || lastStatus;
    }

    // 3) The completed interaction's steps carry the video part.
    const part = videoPartOf(interaction);
    if (!part) {
      // No video part: Google blocked the output at its own safety
      // layer or answered without media. Nothing to show.
      console.error('[video-omni] completed interaction carried no video part');
      return res.status(502).json({ result: 'Omni returned no video data' });
    }

    let buf;
    if (part.data) {
      // Inline delivery (the docs' default shape) — decode directly.
      buf = Buffer.from(part.data, 'base64');
    } else {
      // URI delivery: poll the Files API until ACTIVE, then download.
      const fileId = fileIdFromUri(part.uri);
      if (!fileId) {
        console.error('[video-omni] video part carried an unusable uri:', part.uri);
        return res.status(502).json({ result: 'Omni returned an unusable video reference' });
      }
      let fileState = 'PROCESSING';
      while (fileState !== 'ACTIVE') {
        if (fileState === 'FAILED') {
          console.error('[video-omni] file processing FAILED for', fileId);
          return res.status(502).json({ result: 'Omni video generation failed: file processing failed' });
        }
        if (timedOut()) {
          console.error('[video-omni] file poll timed out at state', fileState);
          return res.status(504).json({ result: `Video generation timed out (file state: ${fileState})` });
        }
        const fileRes = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}?${keyQuery}`);
        if (!fileRes.ok) {
          // Transient — keep polling.
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
        const fileInfo = await fileRes.json().catch(() => null);
        fileState = fileInfo?.state || fileState;
        if (fileState !== 'ACTIVE' && fileState !== 'FAILED') await sleep(POLL_INTERVAL_MS);
      }
      const dl = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}:download?alt=media&${keyQuery}`);
      if (!dl.ok) {
        console.error('[video-omni] failed to download generated video:', dl.status);
        return res.status(502).json({ result: 'Failed to download generated video' });
      }
      buf = Buffer.from(await dl.arrayBuffer());
    }

    // 4) Re-host the MP4 in Vercel Blob under the tenant's prefix.
    const ts = Date.now();
    const key = `${blobPrefix(mediaUserId)}${ts}.mp4`;
    const blob = await put(key, buf, {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: false,
      token: blobToken,
    });

    // Sidecar so /api/latest-video can return the original prompt.
    // `duration` here is the metered assumption (ASSUMED_SECONDS),
    // not a measured length — the API reports neither.
    try {
      await put(
        `${blobPrefix(mediaUserId)}${ts}.meta.json`,
        JSON.stringify({ prompt, duration: ASSUMED_SECONDS, provider: 'google', model: MODEL }),
        { access: 'public', contentType: 'application/json', addRandomSuffix: false, token: blobToken }
      );
    } catch (err) {
      console.error('[video-omni] sidecar write failed (non-fatal):', err?.message || err);
    }
    // Persist to Neon memory so this video is recallable by semantic search.
    saveMediaMemory({ userId: mediaUserId, type: 'video', blobUrl: blob.url, prompt, createdAt: ts, tenantId: resolvedTenant.tenantId }).catch(
      (e) => console.error('[video-omni] saveMediaMemory failed (non-fatal):', e?.message || e)
    );

    await recordMetered(omniGate, getUsageDb, {
      tenantId: resolvedTenant.tenantId, provider: 'google', action: 'video_omni',
      units: ASSUMED_SECONDS, credits: omniEst, requestId: omniReqId,
    });

    // Tool-call response: ElevenLabs reads `result` and speaks it; the
    // widget separately polls /api/latest-video and shows the clip.
    return res.status(200).json({
      result: 'Video generated (Gemini Omni Flash).',
      url: blob.url,
      prompt,
      provider: 'google',
      model: MODEL,
    });
  } catch (err) {
    console.error('[video-omni] error:', err?.message || err);
    return res.status(502).json({ result: `Omni video error: ${err?.message || 'unknown'}` });
  }
}
