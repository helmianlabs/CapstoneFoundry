// api/alarm.js — ElevenLabs webhook tool endpoint for scheduling alarms / reminders.
//
// Mark (ThinkinBuddy) calls this when the user says "remind me", "set an alarm",
// "wake me up", "alert me when", etc.  The endpoint persists the alarm to Vercel
// Blob and returns a JSON payload.  The CLIENT (public/alarms.js, loaded by
// public/onboarding.js) polls /api/alarm and schedules each alarm
// on-device through the Capacitor LocalNotifications bridge — because
// ElevenLabs tools run server-side and can't touch the native APK layer
// directly.  Two-step handshake:
//
//   1. Agent tool call  →  POST /api/alarm  (server saves)
//   2. Client sync      →  GET  /api/alarm?userId=...  (pending only)
//                          GET  /api/alarm?userId=...&all=1  (every
//                          saved entry; the client uses it to notice an
//                          entry deleted server-side and cancel it
//                          on-device)
//
// The path is /api/alarm, not /api/alarm/pending. The platform router
// only matches one segment, so a second path segment never reaches
// this handler. pending vs all is the ?all=1 query.
//
// Why this split: The Capacitor LocalNotifications.schedule() call must happen
// in the WebView JS context so it can cross the Capacitor Bridge into the native
// Java layer (TimedNotificationPublisher / AlarmManager).  A server-side webhook
// has no access to that bridge.

import { authorizeMemoryAccess } from '../../lib/tenant.js';
import { putPrivateJson, readPrivateJson } from '../../lib/privateBlob.js';

function safeSegment(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(s)) return null;
  return s;
}

export default async function handler(req, res) {
  // Allow the ElevenLabs agent (different origin) to POST here, plus the
  // in-page polling GET/DELETE from the Capacitor native WebView
  // (https://localhost / capacitor://localhost) and the web app. The agent
  // doesn't send a browser Origin, and the native app's Origin varies by
  // platform, so wildcard is the correct, low-risk choice for this endpoint.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Preflight: return 204 No Content with the CORS headers already set above.
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // A userId UUID is not a credential, and a missing userId must not
  // fall through to the 'troy' bucket. Session (signed-in PWA) or
  // X-Webhook-Secret (set_alarm) first; the authorized id is the only
  // blob prefix. ENFORCE_TOOL_AUTH does not gate this route.
  const candidate = req.method === 'POST'
    ? (req.body?.userId || req.query?.userId)
    : req.query?.userId;
  const access = authorizeMemoryAccess(req, candidate);
  if (!access.ok) return res.status(access.status).json({ error: access.error });
  const userId = safeSegment(access.userId);
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

  const { list } = await import('@vercel/blob');

  // ── POST /api/alarm — agent calls this to schedule a reminder ─────────────
  if (req.method === 'POST') {
    const body = req.body || {};

    // title      — short alarm label  (e.g. "Pick up kids")
    // body       — longer note         (optional)
    // schedule   — ISO-8601 datetime or "+Nm" relative offset string
    //              Examples: "2026-06-17T07:30:00", "+30m", "+2h", "+1d"
    const title    = (body.title    || body.label || 'Reminder').slice(0, 100);
    const noteText = (body.body     || body.note  || '').slice(0, 500);
    const schedule = body.schedule  || body.at    || body.time || '';

    if (!schedule) {
      return res.status(400).json({ ok: false, error: 'schedule is required (ISO-8601 or "+Nm"/"+Nh")' });
    }

    // Resolve the fire-at timestamp
    let fireAt;
    const relMatch = schedule.match(/^\+(\d+)(m|h|d)$/i);
    if (relMatch) {
      const val  = parseInt(relMatch[1], 10);
      const unit = relMatch[2].toLowerCase();
      const ms   = unit === 'm' ? val * 60_000
                 : unit === 'h' ? val * 3_600_000
                 :                val * 86_400_000;
      fireAt = new Date(Date.now() + ms);
    } else {
      fireAt = new Date(schedule);
    }

    if (isNaN(fireAt.getTime())) {
      return res.status(400).json({ ok: false, error: `Cannot parse schedule: "${schedule}"` });
    }

    const id    = Date.now();
    const entry = {
      id,
      userId,
      title,
      body:     noteText,
      fireAt:   fireAt.toISOString(),
      pending:  true,   // client sets this to false once it has called LocalNotifications.schedule()
      created:  new Date().toISOString(),
    };

    try {
      await putPrivateJson(`alarms/${userId}/${id}.json`, entry);
    } catch (e) {
      console.error('[alarm] blob write failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'Could not save alarm' });
    }

    // Human-readable confirmation Mark will say back to the user
    const localTime = fireAt.toLocaleString('en-US', {
      timeZone: 'America/Boise',
      weekday: 'short',
      month:   'short',
      day:     'numeric',
      hour:    'numeric',
      minute:  '2-digit',
    });

    return res.status(200).json({
      ok:       true,
      alarmId:  id,
      title,
      fireAt:   fireAt.toISOString(),
      // Mark speaks this back to the user. HONEST WORDING: this endpoint
      // only SAVED the reminder — it may be called "set" only once the
      // phone app has actually scheduled it on the device (public/
      // alarms.js does that on its next sync). Never claim "set" here.
      message:  `Got it — reminder saved for ${localTime}: "${title}". It'll ring on your phone once the app there has picked it up.`,
    });
  }

  // ── GET /api/alarm/pending?userId=... — client syncs, schedules on-device ──
  // Default: only entries still pending (not yet picked up by any client).
  // ?all=1: every saved entry, pending or delivered — the client diffs its
  // on-device record against this list to cancel alarms that were deleted
  // server-side. Response shape is the same either way.
  if (req.method === 'GET') {
    const wantAll = req.query?.all === '1' || req.query?.all === 'true';

    let pending = [];
    try {
      const { blobs } = await list({ prefix: `alarms/${userId}/` });
      const entries = await Promise.all(
        blobs.map((b) => readPrivateJson(b.pathname).catch(() => null))
      );
      pending = entries
        .filter(e => e && (!e.userId || e.userId === userId) && (wantAll || e.pending === true))
        .sort((a, b) => a.id - b.id);
    } catch (e) {
      console.error('[alarm] list failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'Could not list alarms' });
    }

    return res.status(200).json({ ok: true, alarms: pending });
  }

  // ── DELETE /api/alarm?id=...&userId=... — mark alarm as delivered ─────────
  if (req.method === 'DELETE') {
    const id = safeSegment(req.query?.id == null ? '' : String(req.query.id));
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });

    try {
      const { blobs } = await list({ prefix: `alarms/${userId}/${id}` });
      const exact = blobs.find((b) => b.pathname === `alarms/${userId}/${id}.json`);
      if (exact) {
        // Overwrite with pending=false so we don't reschedule on next poll.
        // @vercel/blob v2.x rejects put() to an existing pathname unless
        // allowOverwrite is set — without it the DELETE/mark-delivered call
        // throws "blob already exists" and the alarm would re-fire forever.
        const original = await readPrivateJson(exact.pathname);
        if (!original) {
          return res.status(500).json({ ok: false, error: 'Could not mark alarm as delivered' });
        }
        await putPrivateJson(exact.pathname, { ...original, pending: false, userId }, { allowOverwrite: true });
      }
    } catch (e) {
      console.error('[alarm] delete/patch failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'Could not mark alarm as delivered' });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
