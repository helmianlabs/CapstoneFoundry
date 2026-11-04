// api/browse.js — fetch a URL and return readable text content.
//
// Called by the ElevenLabs agent when the user asks it to visit a website.
// Fetches the page, strips HTML tags, returns clean readable text.
//
// POST body: { url: string }
// GET param: ?url=...
// Response:  { result: string }
//
// Kid-safe: refuses adult/unsafe domains (Layer 3 denylist) up front, and
// moderates the fetched page's main text (Layer 2) before returning it.
//
// Safety posture (safety wiring bite 7): in hosted/enforced mode the
// tenant PROFILE decides — through the shared resolver (lib/profile.js
// resolveProfileSafety) — whether moderation fails closed, exactly as
// on the generation handlers. The browse_url tool carries the session
// tenant as userId (bound to {{user_id}} by the provisioning
// contract), so a minor's or safety-on profile makes an unavailable
// moderation a refusal instead of a pass, and a request body claiming
// safetyMode:false cannot weaken it. The produced summary is screened
// as OUTPUT with the same posture before it is returned — the page
// screen never saw the summary's own wording. Compat mode never
// queries a profile and keeps the historical request-derived
// decision.

import { isSafeUrl, UNSAFE_SITE_MSG } from '../../lib/safeBrowse.js';
import { isAllowed } from '../../lib/moderation.js';
import { requireToolAuth } from '../../lib/security.js';
import { completeText, hasTextLlm } from '../../lib/llm.js';
import { resolveHandlerTenant } from '../../lib/tenant.js';
import { getProfileDb, resolveProfileSafety } from '../../lib/profile.js';
import { safetyDecision, safetyInputsFromRequest } from '../../lib/safety.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Spends OPENAI_API_KEY (moderation, :74) then ANTHROPIC_API_KEY (:80), and
  // additionally fetches an arbitrary attacker-supplied URL from Vercel's
  // network. Had no gate: `POST {}` returned 400 "url required" from anywhere.
  //
  // NO-OP UNTIL ENFORCE_TOOL_AUTH is truthy — see lib/security.js:requireToolAuth.
  if (!requireToolAuth(req, res)) return;

  const url = req.body?.url || req.query?.url;
  if (!url) return res.status(400).json({ error: 'url required' });

  // Basic URL validation
  let target;
  try {
    target = new URL(url.startsWith('http') ? url : 'https://' + url);
  } catch {
    return res.status(400).json({ error: 'invalid url' });
  }

  // Identity (bite 7): the tool's userId is resolved with the same
  // rule as every other tool handler — a session token, or the
  // tenant id carried as userId. Enforced mode with neither is a
  // rejection, never a default tenant.
  const userId = req.body?.userId || req.query?.userId;
  const resolvedTenant = resolveHandlerTenant(req, userId);
  if (!resolvedTenant.ok) {
    return res.status(400).json({ error: 'tenant identity required (session token or tenant user_id)' });
  }

  // Safety posture (bite 7): the request-derived decision seeds the
  // value (and is all that compat mode ever uses); in enforced mode
  // the profile resolver replaces it. When the profile cannot decide
  // (no row, onboarding unfinished, profile read failed) the
  // resolver's safe default applies safety — the request inputs are
  // never the fallback in hosted mode.
  let { failClosed } = safetyDecision(safetyInputsFromRequest(req));
  if (resolvedTenant.enforced && resolvedTenant.tenantId) {
    const resolved = await resolveProfileSafety(getProfileDb, resolvedTenant.tenantId);
    ({ failClosed } = resolved.decision);
    if (resolved.safeDefault) {
      console.error(`[browse] profile safety unresolved (${resolved.source}) — safe default applied`);
    }
  }

  // Layer 3 — refuse adult/unsafe destinations BEFORE fetching.
  const urlSafe = isSafeUrl(target.toString());
  if (!urlSafe.safe) {
    console.warn('[browse] blocked unsafe url:', target.hostname, urlSafe.reason);
    return res.status(200).json({ result: UNSAFE_SITE_MSG });
  }

  try {
    const response = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CapstoneFoundry/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(200).json({
        result: `The page at ${target.toString()} returned an error (${response.status}). It may require login or block automated access.`
      });
    }

    const html = await response.text();

    // Strip HTML to get readable text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#\d+;/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 4000); // cap at 4k chars so the agent can digest it

    // Layer 2 — moderate the page's main text (first ~2000 chars) so a
    // safe-looking domain serving unsafe content still gets refused.
    // Fails closed when the profile decision requires screening: an
    // unavailable moderation refuses here, with no page content and
    // no summary reaching the caller.
    const pageMod = await isAllowed(text.slice(0, 2000), process.env.OPENAI_API_KEY, { failClosed });
    if (!pageMod.allowed) {
      console.warn('[browse] page content blocked by moderation:', target.hostname, pageMod.reason);
      return res.status(200).json({ result: UNSAFE_SITE_MSG });
    }

    if (!hasTextLlm(req)) {
      return res.status(200).json({ result: text.slice(0, 500) });
    }

    // Summarize with Gemini (free) or Anthropic — speakable aloud
    let result;
    try {
      result = await completeText({
        req,
        maxTokens: 300,
        system: 'Summarize this webpage content in 3-5 conversational sentences as if you just read it. Focus on what the site is about, what it offers, and your honest impression. No bullet points — this will be read aloud.',
        user: `URL: ${target.toString()}

Page content:
${text}`,
      });
    } catch {
      result = text.slice(0, 300);
    }

    // Output screening (bite 7): the summary is new text the page
    // moderation never saw — the summarizer's own wording can carry
    // content the raw page screen passed — so it is screened as
    // output with the same fail-closed posture before it reaches the
    // caller. A flagged summary is refused; so is an unscreenable one
    // when the profile decision requires screening. (The raw-text
    // fallback above is a slice of the already-screened page text;
    // screening the final value covers both shapes uniformly.)
    const outMod = await isAllowed(result, process.env.OPENAI_API_KEY, { failClosed });
    if (!outMod.allowed) {
      console.warn('[browse] summary blocked by output moderation:', target.hostname, outMod.reason);
      return res.status(200).json({ result: UNSAFE_SITE_MSG });
    }

    return res.status(200).json({ result });
  } catch (err) {
    console.error('[browse] error:', err);
    return res.status(200).json({
      result: `I had trouble loading ${url}. The site may be blocking automated access or is down.`
    });
  }
}
