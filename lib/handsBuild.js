// lib/handsBuild.js — the real build behind Mark's "hands".
//
// Given a plain-language request ("build me a landing page about
// purple zucchini farms"), this generates a complete single-file HTML
// landing page, stores it as a public blob, registers it in the media
// gallery (kind 'artifact', so it appears under Gallery → Websites &
// Apps), and then READS BOTH BACK. The build is only reported as done
// after the page exists at its address AND is listed in the gallery
// store — any earlier stage failing throws a HandsBuildError naming
// the stage, and the handler turns that into an honest error. There
// is no success path that skips verification.
//
// The orchestration lives here with its dependencies injected
// (generate / store / register / verify) so test/hands-build.test.mjs
// can exercise every stage hermetically. server/handlers/hands-build.js
// wires in the real implementations (lib/llm.js completeText, Vercel
// Blob put, lib/mediaMemory.js save/retrieve).

// Same segment rule as server/handlers/task.js: the tenant/user id is
// the only path component a caller can influence, and it must be a
// plain token before it goes anywhere near a storage path.
export function safeSegment(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(s)) return null;
  return s;
}

export class HandsBuildError extends Error {
  constructor(stage, message) {
    super(message);
    this.name = 'HandsBuildError';
    this.stage = stage;
  }
}

// Models sometimes wrap the page in a markdown fence or preface it
// with a sentence. Keep only the document itself.
export function cleanGeneratedHtml(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.trim();
  s = s.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = s.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) s = s.slice(start);
  return s;
}

// A build is only real if the page is a complete document, not a
// fragment or an apologetic paragraph.
export function isCompleteHtml(s) {
  return typeof s === 'string'
    && s.length >= 200
    && /<html[\s>]/i.test(s)
    && /<\/html>\s*$/i.test(s.trim());
}

export function extractTitle(html, prompt) {
  const m = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(html || '');
  const t = (m ? m[1] : '').trim().replace(/\s+/g, ' ');
  if (t) return t;
  const p = String(prompt || '').trim().replace(/\s+/g, ' ');
  return (p || 'Untitled page').slice(0, 80);
}

export const BUILD_SYSTEM_PROMPT = [
  'You are the page builder inside Capstone Foundry.',
  'Given a build request, return ONLY one complete, self-contained HTML landing page.',
  'Rules: a single file; all CSS inside a <style> tag in <head>; no external assets,',
  'scripts, fonts, or images (use CSS and emoji for visuals); include a <title>;',
  'make it polished, responsive, and genuinely about the requested topic;',
  'no markdown fences, no commentary, no explanation — the HTML document only.',
].join(' ');

/**
 * Run one build end to end.
 *
 * @param {object} opts
 * @param {string} opts.prompt  the user's build request, in their words
 * @param {string} opts.owner   authorized user/tenant id (already safeSegment-checked)
 * @param {string|null} [opts.tenantId]  enforced-mode tenant stamp, when resolved
 * @param {object} opts.deps
 * @param {(prompt: string) => Promise<string>} opts.deps.generate  raw page HTML from the LLM
 * @param {(pathname: string, html: string) => Promise<string>} opts.deps.store  persists, returns the public URL
 * @param {(entry: object) => Promise<void>} opts.deps.register  lists the artifact in the gallery store
 * @param {(check: {url: string, owner: string, tenantId: string|null}) => Promise<boolean>} opts.deps.verify  read-back proof
 * @returns {Promise<{id: number, title: string, url: string, pathname: string}>}
 */
export async function buildArtifact({ prompt, owner, tenantId = null, deps }) {
  const { generate, store, register, verify } = deps || {};
  for (const [name, fn] of Object.entries({ generate, store, register, verify })) {
    if (typeof fn !== 'function') throw new HandsBuildError('setup', `build dependency missing: ${name}`);
  }

  // 1 — Generate the page.
  let raw;
  try {
    raw = await generate(prompt);
  } catch (e) {
    throw new HandsBuildError('generate', `Page generation failed: ${e?.message || e}`);
  }
  const html = cleanGeneratedHtml(raw);
  if (!isCompleteHtml(html)) {
    throw new HandsBuildError('generate', 'The generated page was incomplete, so nothing was saved.');
  }
  const title = extractTitle(html, prompt);

  // 2 — Store the page at its own address.
  const id = Date.now();
  const pathname = `thinkinbuddy/artifacts/${owner}/${id}.html`;
  let url;
  try {
    url = await store(pathname, html);
  } catch (e) {
    throw new HandsBuildError('store', `Saving the page failed: ${e?.message || e}`);
  }
  if (!url || typeof url !== 'string') {
    throw new HandsBuildError('store', 'Saving the page returned no address.');
  }

  // 3 — Register it in the gallery store (Websites & Apps).
  try {
    await register({
      userId: owner,
      type: 'artifact',
      blobUrl: url,
      prompt: `${title} — ${prompt}`,
      createdAt: id,
      tenantId,
    });
  } catch (e) {
    throw new HandsBuildError('register', `Listing the page in the gallery failed: ${e?.message || e}`);
  }

  // 4 — Verify before anyone says "built": the page must answer at
  // its address AND be listed in the gallery store. (saveMediaMemory
  // logs-and-swallows insert failures, which is exactly why this
  // read-back exists.)
  let confirmed = false;
  try {
    confirmed = await verify({ url, owner, tenantId });
  } catch {
    confirmed = false;
  }
  if (!confirmed) {
    throw new HandsBuildError('verify', 'The page could not be confirmed saved and listed, so it is not being reported as built.');
  }

  return { id, title, url, pathname };
}
