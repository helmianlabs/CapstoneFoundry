// api/client-log.js — client error beacon receiver.
//
// The app (index.html) POSTs small JSON reports here when the voice
// widget misbehaves: widget lifecycle events, microphone probe results,
// and window errors. Everything is written to the function log with a
// [CLIENT-LOG] prefix, which is the remote substitute for logcat when
// debugging the installed app on a phone that cannot be plugged in
// here (added 2026-11-04 after the first on-phone test: calls died at
// 0 seconds with no visible error and no permission prompt).
//
// Deliberately storage-free: no database writes, nothing retained
// beyond the platform's function logs. Payloads are capped and only
// the expected fields are logged.

const MAX_BODY_BYTES = 4096;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    let body = req.body;
    if (typeof body === 'string') {
      if (body.length > MAX_BODY_BYTES) return res.status(413).json({ error: 'Too large' });
      body = JSON.parse(body || '{}');
    }
    const kind = typeof body?.kind === 'string' ? body.kind.slice(0, 60) : 'unknown';
    const data = body?.data && typeof body.data === 'object' ? body.data : {};
    const safe = {};
    for (const [k, v] of Object.entries(data).slice(0, 12)) {
      if (typeof v === 'string') safe[k] = v.slice(0, 300);
      else if (typeof v === 'number' || typeof v === 'boolean') safe[k] = v;
      else if (Array.isArray(v)) safe[k] = v.slice(0, 12).map((x) => String(x).slice(0, 60));
    }
    const ua = typeof body?.ua === 'string' ? body.ua.slice(0, 200) : '';
    console.log('[CLIENT-LOG]', JSON.stringify({ kind, data: safe, ua }));
  } catch (e) {
    console.log('[CLIENT-LOG] unparsable body');
  }
  return res.status(204).end();
}
