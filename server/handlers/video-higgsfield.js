// api/video-higgsfield.js — text-to-video via Higgsfield.
//
// Higgsfield is an aggregator: one credential pair reaches a
// catalog of third-party video models (Kling / Seedance / Wan /
// MiniMax class). This route ships ONE workflow from that catalog —
// Kling 2.5 Turbo Pro text-to-video at 1080p — for the same reason
// video-runway.js forces gen4_turbo on bucket-paid requests:
// per-model prices on this provider spread ~10x, so a metered rate
// can only ever be honest for the one model it was fitted to (see
// METERING below). More workflows are later bites, each with its
// own rate.
//
// CONTRACT — pinned at build time from Higgsfield's OWN official
// docs (read 2026-11-01 for provider wiring bite H1):
//   - Quickstart + FAQ (docs.higgsfield.ai/docs/quickstart,
//     .../docs/help/faq): base https://api.higgsfield.ai;
//     authentication is ONE header carrying the Console credential
//     PAIR — `Authorization: Key <KEY_ID>:<KEY_SECRET>` (never a
//     Bearer token); generation is asynchronous (submit returns
//     request_id + status_url + cancel_url; poll status_url);
//     generated files are retained a MINIMUM of 7 days and may be
//     deleted any time after — so this handler downloads and
//     re-hosts the result to Vercel Blob immediately, like the
//     other video handlers; failed and NSFW-flagged requests are
//     not charged by Higgsfield.
//   - Requests and lifecycle (docs.higgsfield.ai/docs/concepts/
//     requests): statuses queued / in_progress (non-terminal) ->
//     completed / failed / nsfw / canceled (terminal). "Use the
//     URLs from the response instead of constructing them
//     manually" — the poll below follows the returned status_url.
//   - Workflow page (docs.higgsfield.ai/docs/models/
//     kling-2-5-turbo/pro-text-to-video): POST
//     /kling-video/v2.5-turbo/pro/text-to-video with JSON body
//     { prompt (required), duration (5 | 10, default 5),
//     cfg_scale, negative_prompt } and an Idempotency-Key header;
//     this endpoint exposes no aspect_ratio or sound field, so
//     none is sent. A completed status response carries the output
//     as { video: { url } }.
//   - Price (open.higgsfield.ai model page for this workflow +
//     open.higgsfield.ai/pricing): $0.035/s is the current 50%-off
//     promo; the STANDARD (list) rate is $0.07/s at 1080p.
//
// CREDENTIALS: the pair HIGGSFIELD_API_KEY_ID + HIGGSFIELD_API_SECRET
// (created in the Higgsfield Console, console.higgsfield.ai), each
// resolved through lib/userKeys.js resolveKey like every other
// provider key (user X-User-Key header first, server env fallback).
// BOTH halves are required — a missing half is the standard 500
// with zero provider calls. The joined auth value exists only in
// this process's memory for the request's life: it is never logged,
// never stored, and never appears in any response or error body
// (provider error details are logged as status codes only).
//
// METERING (lib/usage.js, action 'video_higgsfield' — a DEDICATED
// rate, never Runway's or Omni's): list $0.07/s = 70 credits raw at
// 1 credit = $0.001; metered at 75 credits/s (above-cost headroom,
// the Omni rate's shape). Duration is a REAL parameter here (5 or
// 10 seconds — unlike Omni, whose API takes none), so the estimate
// is the requested duration, gated BEFORE the submit call and
// recorded after success. The workflow is forced in ALL modes, not
// just metered ones: on this provider the "model" IS the endpoint
// path, and honoring a caller-chosen path would let any catalog
// URL ride this route (and this rate). Callers pick the prompt and
// the duration; the workflow is the route's own constant.
//
// Body: { prompt, userId?, duration? = 5 | 10 (seconds? accepted as
// an alias), negativePrompt? }

import { put } from '@vercel/blob';
import { requireWebhookSecret } from '../../lib/security.js';
import { isAllowed, SAFE_REFUSAL } from '../../lib/moderation.js';
import { getKey, resolveKey } from '../../lib/userKeys.js';
import { resolveHandlerTenant } from '../../lib/tenant.js';
import { costFor, meterGate, denyMetering, recordMetered, getUsageDb } from '../../lib/usage.js';
import { randomUUID } from 'node:crypto';
import { safetyDecision, safetyInputsFromRequest } from '../../lib/safety.js';
import { getProfileDb, resolveProfileSafety } from '../../lib/profile.js';
import { saveMediaMemory } from '../../lib/mediaMemory.js';

const API_BASE = 'https://api.higgsfield.ai';
// The one workflow this route ships (docs "Endpoint ID"). Its list
// price is the one the meter rate is fitted to — see the header.
const MODEL = 'kling-video/v2.5-turbo/pro/text-to-video';
// Poll cadence: video generation takes minutes; the timeout leaves
// headroom under the router's 300s maxDuration, same as the other
// video routes. Env overrides exist for tests / ops only.
const POLL_INTERVAL_MS = Number(process.env.HIGGSFIELD_POLL_INTERVAL_MS) || 5000;
const POLL_TIMEOUT_MS = Number(process.env.HIGGSFIELD_POLL_TIMEOUT_MS) || 270000;

const blobPrefix = (userId) => `thinkinbuddy/videos/${userId}/`;

// Declared in the standard config shape. NOTE: through the single
// api/[...path].js router this export is informational only — the
// effective value lives in the router's ROUTE_FUNCTION_CONFIG map.
export const config = { maxDuration: 300 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // The workflow's documented durations are exactly 5 and 10
  // seconds (default 5) — anything else falls back to the default,
  // the video-runway.js posture for its seconds field.
  const requestedDuration = parseInt(req.body?.duration ?? req.body?.seconds ?? req.query?.duration, 10);
  const seconds = [5, 10].includes(requestedDuration) ? requestedDuration : 5;
  const negativePrompt = req.body?.negativePrompt || req.body?.negative_prompt || '';

  // The credential PAIR: both halves through resolveKey. A user who
  // supplies either half under Settings → Keys is paying Higgsfield
  // directly, so the pair counts as a user key for metering
  // (shouldMeter in lib/usage.js); the hosted product's operative
  // case is both halves from the server env.
  const idPart = resolveKey(req, 'HIGGSFIELD_API_KEY_ID');
  const secretPart = resolveKey(req, 'HIGGSFIELD_API_SECRET');
  const keySource = (idPart.source === 'user' || secretPart.source === 'user') ? 'user' : 'env';
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!idPart.key || !secretPart.key) {
    return res.status(500).json({ result: 'HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_SECRET not configured' });
  }
  if (!blobToken) return res.status(500).json({ result: 'BLOB_READ_WRITE_TOKEN not configured' });
  // The documented auth value: `Key <id>:<secret>` in ONE header.
  // Held only in this closure — never logged, never returned.
  const authHeader = `Key ${idPart.key}:${secretPart.key}`;

  // Kid-safe gate: moderate the prompt BEFORE spending a provider
  // call. Hosted mode: the tenant profile decides fail-closed
  // through the shared resolver (lib/profile.js resolveProfileSafety
  // — safety wiring bite 3's pattern; this handler is born
  // profile-aware, provider wiring bite H1); when the profile
  // cannot decide (no row, onboarding unfinished, or the profile
  // read failed) the resolver's safe default applies safety — the
  // request inputs are never the fallback in hosted mode. Compat
  // mode never queries a profile.
  let { failClosed } = safetyDecision(safetyInputsFromRequest(req));
  if (resolvedTenant.enforced && resolvedTenant.tenantId) {
    const resolved = await resolveProfileSafety(getProfileDb, resolvedTenant.tenantId);
    ({ failClosed } = resolved.decision);
    if (resolved.safeDefault) {
      console.error(`[video-higgsfield] profile safety unresolved (${resolved.source}) — safe default applied`);
    }
  }
  const mod = await isAllowed(prompt, getKey(req, 'OPENAI_API_KEY'), { failClosed });
  if (!mod.allowed) {
    console.warn('[video-higgsfield] prompt blocked by moderation:', mod.reason);
    return res.status(200).json({ result: SAFE_REFUSAL });
  }

  // Usage metering (hosted model, lib/usage.js): enforced mode + our
  // server key pair -> the tenant's bucket must cover the estimate
  // BEFORE the provider call (402 credits_exhausted, no provider
  // call made). The estimate is the dedicated Higgsfield rate at
  // the requested duration (see header). Compat mode and BYO user
  // keys skip metering entirely — see shouldMeter in lib/usage.js.
  const hfReqId = randomUUID();
  const hfEst = costFor('video_higgsfield', { seconds });
  const hfGate = await meterGate({ db: getUsageDb, tenantId: resolvedTenant.tenantId, keySource, estCredits: hfEst, action: 'video_higgsfield' });
  if (!hfGate.allowed) return denyMetering(res, hfGate);

  const providerHeaders = {
    'Authorization': authHeader,
    'Content-Type': 'application/json',
  };

  try {
    const startedAt = Date.now();
    const timedOut = () => Date.now() - startedAt >= POLL_TIMEOUT_MS;

    // 1) Submit the generation (docs: an Idempotency-Key makes a
    // timed-out submission safe to repeat; this handler submits
    // once, with a fresh key per generation).
    const submitBody = { prompt, duration: seconds };
    if (negativePrompt) submitBody.negative_prompt = negativePrompt;
    const submitRes = await fetch(`${API_BASE}/${MODEL}`, {
      method: 'POST',
      headers: { ...providerHeaders, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify(submitBody),
    });

    if (!submitRes.ok) {
      // Provider error bodies are { detail: '...' } strings; the
      // detail is never echoed into the response (credential
      // hygiene) — status only.
      console.error('[video-higgsfield] Higgsfield submit error: HTTP', submitRes.status);
      return res.status(502).json({ result: `Higgsfield video generation failed: Higgsfield ${submitRes.status}` });
    }

    const submitted = await submitRes.json().catch(() => null);
    const requestId = submitted?.request_id;
    if (!requestId) {
      console.error('[video-higgsfield] Higgsfield returned no request_id');
      return res.status(502).json({ result: 'Higgsfield returned no request id' });
    }
    // Docs: poll the URL the response returned, not a constructed
    // one. The fallback is the documented status path shape.
    const statusUrl = (typeof submitted?.status_url === 'string' && submitted.status_url.startsWith(`${API_BASE}/`))
      ? submitted.status_url
      : `${API_BASE}/requests/${encodeURIComponent(requestId)}/status`;

    // 2) Poll until a terminal status (lifecycle doc: queued /
    // in_progress -> completed / failed / nsfw / canceled).
    let state = submitted;
    let lastStatus = state?.status || 'queued';
    while (lastStatus !== 'completed') {
      if (lastStatus === 'failed' || lastStatus === 'canceled') {
        console.error('[video-higgsfield] request ended with status', lastStatus);
        return res.status(502).json({ result: `Higgsfield video generation failed: request ${lastStatus}` });
      }
      if (lastStatus === 'nsfw') {
        // Higgsfield's own moderation rejected the input or the
        // output. Not a system failure and (per the FAQ) not
        // charged by Higgsfield — a speakable content outcome,
        // answered 200 like our own moderation refusal.
        console.warn('[video-higgsfield] request flagged nsfw by provider moderation');
        return res.status(200).json({ result: "Higgsfield's safety filter blocked that video — try a different prompt." });
      }
      if (timedOut()) {
        console.error('[video-higgsfield] poll timed out at status', lastStatus);
        return res.status(504).json({ result: `Video generation timed out (last status: ${lastStatus})` });
      }
      await sleep(POLL_INTERVAL_MS);
      const pollRes = await fetch(statusUrl, { headers: providerHeaders });
      if (!pollRes.ok) {
        // Transient — keep polling, same posture as the other
        // video routes.
        continue;
      }
      state = await pollRes.json().catch(() => state);
      lastStatus = state?.status || lastStatus;
    }

    // 3) The completed response carries { video: { url } }.
    const videoUrl = state?.video?.url;
    if (!videoUrl) {
      console.error('[video-higgsfield] completed request carried no video url');
      return res.status(502).json({ result: 'Higgsfield returned no video data' });
    }

    // 4) Download promptly and re-host in Vercel Blob under the
    // tenant's prefix — Higgsfield keeps outputs only >= 7 days
    // (FAQ), so the provider URL is never the durable copy.
    const dl = await fetch(videoUrl);
    if (!dl.ok) {
      console.error('[video-higgsfield] failed to download generated video:', dl.status);
      return res.status(502).json({ result: 'Failed to download generated video' });
    }
    const buf = Buffer.from(await dl.arrayBuffer());

    const ts = Date.now();
    const key = `${blobPrefix(mediaUserId)}${ts}.mp4`;
    const blob = await put(key, buf, {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: false,
      token: blobToken,
    });

    // Sidecar so /api/latest-video can return the original prompt.
    try {
      await put(
        `${blobPrefix(mediaUserId)}${ts}.meta.json`,
        JSON.stringify({ prompt, duration: seconds, provider: 'higgsfield', model: MODEL }),
        { access: 'public', contentType: 'application/json', addRandomSuffix: false, token: blobToken }
      );
    } catch (err) {
      console.error('[video-higgsfield] sidecar write failed (non-fatal):', err?.message || err);
    }
    // Persist to Neon memory so this video is recallable by semantic search.
    saveMediaMemory({ userId: mediaUserId, type: 'video', blobUrl: blob.url, prompt, createdAt: ts, tenantId: resolvedTenant.tenantId }).catch(
      (e) => console.error('[video-higgsfield] saveMediaMemory failed (non-fatal):', e?.message || e)
    );

    await recordMetered(hfGate, getUsageDb, {
      tenantId: resolvedTenant.tenantId, provider: 'higgsfield', action: 'video_higgsfield',
      units: seconds, credits: hfEst, requestId: hfReqId,
    });

    // Tool-call response: ElevenLabs reads `result` and speaks it; the
    // widget separately polls /api/latest-video and shows the clip.
    return res.status(200).json({
      result: 'Video generated (Kling 2.5 Turbo Pro via Higgsfield).',
      url: blob.url,
      prompt,
      provider: 'higgsfield',
      model: MODEL,
    });
  } catch (err) {
    console.error('[video-higgsfield] error:', err?.message || err);
    return res.status(502).json({ result: `Higgsfield video error: ${err?.message || 'unknown'}` });
  }
}
