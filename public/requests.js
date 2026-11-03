// public/requests.js — ThinkinBuddy client for the unified request
// box (requests bite B2; design: curriculum-requests-spec.md §1–§2 in
// ~/workspace/thinkinbuddy-launch/).
//
// PLAIN ES module, no build step, loaded by public/onboarding.js via a
// dynamic import (same pattern as ./billing.js and ./alarms.js). The
// door's MARKUP lives in index.html's Settings -> Account & Safety
// pane ("Ask for something we don't have"); this module is the logic:
// the two field sets' vocabularies, client-side validation mirroring
// the server's caps, the POST/GET calls, and the own-requests list
// rendering. onboarding.js binds the DOM elements to these functions.
//
// ─── Server contract (bite B1, server/handlers/requests.js) ─────────
//   POST /api/requests  { kind, ...kind fields } ->
//     201 { ok: true, request: { id, kind, payload, status,
//           status_label, created_at } }
//     400 { error: 'invalid_*' } — nothing stored
//   GET  /api/requests  -> 200 { requests: [...] } — the CALLER's rows
//     only, newest first, each carrying the plain status_label the
//     requester sees (Received / On the list / Being built /
//     In verification / Added / Not planned). The client renders the
//     server's label verbatim — it never invents its own wording for
//     a status, so the words can only ever be the server's.
//
// ─── Identity ───────────────────────────────────────────────────────
// This module invents NO identity and sends none: every call rides
// the fetch function onboarding.js injects (its tbFetch, which
// attaches the account session's Authorization header when one is
// stored). The tenant is resolved server-side from that session,
// never from a body field — the bodies built here contain ONLY
// { kind, ...the kind's whitelisted fields }, even if the caller
// hands the validator extra keys (tenant_id, status, plan, ... are
// stripped, mirroring lib/requests.js). In compat (legacy
// single-user) deployments the same call is accepted server-side
// under the legacy identity (B1's handler behavior) — the door does
// not special-case compat; like the rest of the Account pane, the
// door's markup simply hides with the pane in legacy mode.
//
// ─── A suggestion box, not a control surface ────────────────────────
// Statuses move ONLY on the operator's side (the transition
// function in lib/requests.js refuses every other actor, and B1's
// handler exposes no verb that moves one). This module therefore
// contains no
// status-changing call at all — it can POST a new request and GET
// the caller's list, nothing else. The door displays status; it
// never offers to change it.

// ─── Vocabularies (mirror lib/requests.js exactly) ──────────────────

export const PROVIDER_CAPABILITIES = [
  { value: 'chat', label: 'Chat' },
  { value: 'image', label: 'Make images' },
  { value: 'video', label: 'Make videos' },
  { value: 'voice', label: 'Voice' },
  { value: 'other', label: 'Something else' },
];

export const CURRICULUM_ROLES = [
  { value: 'parent', label: 'Parent' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'educator', label: 'Educator' },
  { value: 'student', label: 'Student' },
  { value: 'other', label: 'Other' },
];

export const CURRICULUM_LEVELS = [
  { value: '6-8', label: 'Ages 6–8' },
  { value: '9-12', label: 'Ages 9–12' },
  { value: '13-17', label: 'Ages 13–17' },
  { value: 'college', label: 'College' },
  { value: 'adult', label: 'Adult' },
];

// Length caps — the same numbers lib/requests.js enforces server-side
// (spec §2 pins subject/goal/links; provider_name/use_case mirror
// them per B1). The markup also carries maxlength attributes, but
// this validation is the real gate: it runs on whatever the fields
// hold, however the values got there.
export const CAPS = { provider_name: 120, use_case: 300, subject: 80, goal: 300, source_link: 500 };
export const MAX_SOURCE_LINKS = 3;

/** The confirmation the requester sees on a successful send (spec §1.3). */
export const REQUEST_NOTED_TEXT = 'Request noted — we read every one.';

const capabilityValues = PROVIDER_CAPABILITIES.map(o => o.value);
const roleValues = CURRICULUM_ROLES.map(o => o.value);
const levelValues = CURRICULUM_LEVELS.map(o => o.value);

function labelFor(options, value) {
  return options.find(o => o.value === value)?.label || value || '';
}

// ─── Validation + payload building (pure, unit-tested) ──────────────

function cleanRequired(value, emptyText, cap, capText) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return { ok: false, error: emptyText };
  if (text.length > cap) return { ok: false, error: capText };
  return { ok: true, value: text };
}

/**
 * Split the trusted-materials textarea into candidate links: one per
 * line, trimmed, blank lines dropped. Validation of the links
 * themselves happens in validateCurriculumFields.
 */
export function parseSourceLinks(text) {
  if (typeof text !== 'string') return [];
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}

function cleanSourceLinks(links) {
  if (links.length > MAX_SOURCE_LINKS) {
    return { ok: false, error: 'Up to 3 links — keep the ones you trust most.' };
  }
  const out = [];
  for (const link of links) {
    if (typeof link !== 'string' || link.length > CAPS.source_link) {
      return { ok: false, error: 'Each link needs to be a full web address (starting https://).' };
    }
    let url;
    try { url = new URL(link); } catch {
      return { ok: false, error: 'Each link needs to be a full web address (starting https://).' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'Each link needs to be a full web address (starting https://).' };
    }
    out.push(url.toString());
  }
  return { ok: true, value: out };
}

/**
 * Validate the provider field set and build EXACTLY the payload B1
 * stores: { provider_name, capability, use_case } — trimmed, capped,
 * and nothing else, however many extra keys the input carries.
 * @returns {{ ok: true, payload: object } | { ok: false, error: string }}
 */
export function validateProviderFields(fields = {}) {
  const name = cleanRequired(
    fields.provider_name,
    'Give the tool or service a name.',
    CAPS.provider_name,
    `Keep the name to ${CAPS.provider_name} characters or fewer.`,
  );
  if (!name.ok) return name;
  if (!capabilityValues.includes(fields.capability)) {
    return { ok: false, error: 'Pick what it should do.' };
  }
  const useCase = cleanRequired(
    fields.use_case,
    'Tell us what you would use it for.',
    CAPS.use_case,
    `Keep that to ${CAPS.use_case} characters or fewer.`,
  );
  if (!useCase.ok) return useCase;
  return {
    ok: true,
    payload: { provider_name: name.value, capability: fields.capability, use_case: useCase.value },
  };
}

/**
 * Validate the curriculum field set (spec §2's five phone-short
 * fields) and build EXACTLY the payload B1 stores:
 * { role, subject, level, goal, source_links? } — source_links is
 * present only when at least one valid link was given (the server's
 * own rule). The links may arrive as an array or as the textarea's
 * raw text (source_links_text), which parseSourceLinks splits.
 * @returns {{ ok: true, payload: object } | { ok: false, error: string }}
 */
export function validateCurriculumFields(fields = {}) {
  if (!roleValues.includes(fields.role)) {
    return { ok: false, error: 'Pick who this is from.' };
  }
  const subject = cleanRequired(
    fields.subject,
    'Name the subject.',
    CAPS.subject,
    `Keep the subject to ${CAPS.subject} characters or fewer.`,
  );
  if (!subject.ok) return subject;
  if (!levelValues.includes(fields.level)) {
    return { ok: false, error: 'Pick a level.' };
  }
  const goal = cleanRequired(
    fields.goal,
    'Tell us what success looks like.',
    CAPS.goal,
    `Keep that to ${CAPS.goal} characters or fewer.`,
  );
  if (!goal.ok) return goal;
  const payload = { role: fields.role, subject: subject.value, level: fields.level, goal: goal.value };
  const rawLinks = Array.isArray(fields.source_links)
    ? fields.source_links
    : parseSourceLinks(fields.source_links_text);
  if (rawLinks.length) {
    const links = cleanSourceLinks(rawLinks);
    if (!links.ok) return links;
    payload.source_links = links.value;
  }
  return { ok: true, payload };
}

/**
 * The exact POST body for a kind: { kind, ...whitelisted payload }.
 * Validation failures return the plain error and NO body — the
 * caller must not send anything.
 */
export function buildRequestBody(kind, fields = {}) {
  const checked = kind === 'provider'
    ? validateProviderFields(fields)
    : kind === 'curriculum'
      ? validateCurriculumFields(fields)
      : { ok: false, error: 'Pick what to ask for — a tool or a subject.' };
  if (!checked.ok) return checked;
  return { ok: true, body: { kind, ...checked.payload } };
}

// ─── Server refusals, in plain words ────────────────────────────────

/**
 * B1 answers a refused POST with 400 { error: 'invalid_*' }. The
 * requester never sees the raw code — each maps to the plain words
 * for what to fix. (Client-side validation mirrors the same rules,
 * so reaching this map means the two disagreed; the words still
 * point at the field family that failed.)
 */
export function refusalText(code) {
  switch (code) {
    case 'invalid_capability': return 'Pick what the tool should do — chat, images, video, voice, or something else.';
    case 'invalid_role': return 'Pick who this is from — parent, teacher, educator, student, or other.';
    case 'invalid_level': return 'Pick a level for the subject.';
    case 'invalid_source_links': return "Those links didn't work — up to 3 full web addresses (starting https://), one per line.";
    case 'invalid_kind': return "That kind of request isn't one we take — pick tool or subject and try again.";
    case 'invalid_field': return 'One of the fields is missing or too long — check them and try again.';
    default: return 'Something went wrong — please try again.';
  }
}

// ─── The calls (fetch injected — alarms.js deps style) ──────────────
// deps.fetchFn is a fetch-shaped function (path, opts) -> Response.
// In the app it is onboarding.js's tbFetch, which attaches the
// account session; in tests it is a stub. Neither function ever
// throws: outcomes come back as result objects, like the rest of
// the client's modules.

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

/**
 * File one request. Client-side validation runs first — an invalid
 * field set returns its plain error and the network is never touched
 * (the form keeps the text; onboarding.js only clears on success).
 * @returns {Promise<{ ok: true, request: object } |
 *   { ok: false, stage: 'validation'|'server'|'network', error: string, status?: number }>}
 */
export async function submitRequest(kind, fields = {}, deps = {}) {
  const built = buildRequestBody(kind, fields);
  if (!built.ok) return { ok: false, stage: 'validation', error: built.error };
  const fetchFn = deps.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) return { ok: false, stage: 'network', error: 'Could not reach the server — please try again.' };
  let res;
  try {
    res = await fetchFn('/api/requests', { method: 'POST', body: built.body });
  } catch {
    return { ok: false, stage: 'network', error: 'Could not reach the server — please try again.' };
  }
  const data = await readJson(res);
  if (res.status === 201 && data?.request) return { ok: true, request: data.request };
  if (res.status === 401) {
    return { ok: false, stage: 'server', status: 401, error: 'Your session has expired — log in again, then send it.' };
  }
  if (res.status === 400) {
    return { ok: false, stage: 'server', status: 400, error: refusalText(data?.error) };
  }
  return { ok: false, stage: 'server', status: res.status, error: 'Something went wrong — please try again.' };
}

/**
 * The caller's own requests, newest first, exactly as the server
 * serialized them (status_label included — rendered verbatim).
 * @returns {Promise<{ ok: true, requests: object[] } |
 *   { ok: false, stage: 'server'|'network', error: string, status?: number }>}
 */
export async function fetchOwnRequests(deps = {}) {
  const fetchFn = deps.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) return { ok: false, stage: 'network', error: 'Could not reach the server — please try again.' };
  let res;
  try {
    res = await fetchFn('/api/requests');
  } catch {
    return { ok: false, stage: 'network', error: 'Could not reach the server — please try again.' };
  }
  const data = await readJson(res);
  if (res.status === 200 && Array.isArray(data?.requests)) return { ok: true, requests: data.requests };
  if (res.status === 401) {
    return { ok: false, stage: 'server', status: 401, error: 'Your session has expired — log in again to see your requests.' };
  }
  return { ok: false, stage: 'server', status: res.status, error: 'Could not load your requests — try again.' };
}

// ─── List rendering (pure) ──────────────────────────────────────────

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One-line summary of a request row's payload (what was asked for). */
export function requestSummary(row) {
  const p = row?.payload || {};
  if (row?.kind === 'curriculum') {
    return {
      heading: p.subject || 'A subject',
      meta: [labelFor(CURRICULUM_LEVELS, p.level), labelFor(CURRICULUM_ROLES, p.role)]
        .filter(Boolean).join(' · '),
      detail: p.goal || '',
    };
  }
  return {
    heading: p.provider_name || 'A tool or service',
    meta: labelFor(PROVIDER_CAPABILITIES, p.capability),
    detail: p.use_case || '',
  };
}

/**
 * The own-requests list as HTML for the door's list container. The
 * status shown is the server's status_label, verbatim; every
 * payload-derived string is escaped. An empty list says so plainly.
 */
export function requestListHtml(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return '<div class="test-line">You haven\'t asked for anything yet.</div>';
  }
  return list.map((row) => {
    const s = requestSummary(row);
    const label = row?.status_label || '';
    return '<div class="storage-note" style="margin-bottom:10px;">'
      + `<strong>${escapeHtml(s.heading)}</strong>`
      + (s.meta ? ` — ${escapeHtml(s.meta)}` : '')
      + (label ? `<br/>Status: ${escapeHtml(label)}` : '')
      + (s.detail ? `<br/>${escapeHtml(s.detail)}` : '')
      + '</div>';
  }).join('');
}
