// POST /api/guard/screen — Guard screening route (template kit).
//
// Ships with every template site (copy this file to the site's
// api/guard/screen.js), shaped like api/elevenlabs/signed-url.js:
// the secret stays on the server, always.
//
// State after spec bite 3 (guard-contract.md, guard/1.0):
//
//   → 405 non-POST
//   → 503 Guard not armed (no GUARD_SECRET_KEY, or no
//         GUARD_VERDICT_URL) — with env absent the route calls
//         NOTHING and validates nothing, exactly as the skeleton did
//   → with env present, the ARMED PATH runs: the body is validated
//         against guard/1.0 (malformed → 400, nothing is screened on
//         a guess), the source fingerprint is minted server-side
//         (salted hash — never a raw identifier), and the request is
//         handed to the screening engine (guard-engine.js,
//         rules-first, spec bite 2 — local and deterministic; the
//         verdict is validated with contract.parseVerdict before it
//         is answered, and a parse failure answers 503 no-verdict,
//         which callers treat via the failure stance, never as an
//         allow).
//   → signed-ACTION requests still answer 503 engine-not-built: the
//         action policy engine is spec bite 5, not built here.
//   → FEED WIRING (bite 3): every judged outcome leaves exactly the
//         record the contract allows — a feed entry built ONLY by
//         contract.buildFeedEntry (verdict, class, score, counts,
//         salted fingerprint, the one-sentence summary; never the
//         visitor's words):
//           · flag / block verdicts → an entry
//           · no-verdict outcomes (engine-not-built actions, a
//             malformed engine answer) → a "gap" entry on the
//             contract's default stance outcome, so the owner sees
//             the hole (contract §5)
//           · allow verdicts → NO entry: the feed is not a
//             surveillance log of ordinary visitors (spec §3); the
//             screen is counted in the aggregate counters only.
//         Entries are delivered to the feed sink named by
//         GUARD_FEED_URL (POST, secret as a server-to-server Bearer
//         credential — never in a body). With NO sink configured,
//         entries are counted and dropped with an honest log line —
//         delivery is never pretended. A sink failure likewise drops
//         the entry (counted, logged) and NEVER changes the screen
//         answer: Guard's bookkeeping cannot break the site's panel.
//   Nothing about this file arms a site: with env absent the route
//   calls nothing and validates nothing, exactly as before.
//
// Env (server-side only, never committed, never sent to the browser):
//   GUARD_SECRET_KEY        — the site's Guard secret key (Guard Live)
//   GUARD_VERDICT_URL       — the verdict service endpoint (bite 2)
//   GUARD_FINGERPRINT_SALT  — salt for source fingerprints (contract
//                             §6: fingerprints are minted here, or not
//                             at all — absent salt ⇒ fingerprint null)
//   GUARD_FEED_URL          — the owner-feed sink endpoint (bite 3);
//                             absent ⇒ entries counted + dropped,
//                             loudly, per the feed wiring above

import { createHash } from "node:crypto";
import contract from "../_guard/guard-contract.js";
import guardEngine from "../_guard/guard-engine.js";

const { CONTRACT_VERSION, validateScreenRequest } = contract;

// ── SCREENING ENGINE (Guard embed spec, bite 2) ───────────────────
// The rules-first engine lives in guard-engine.js (server-side only,
// deterministic, no network, no model calls). Screen requests are
// screened locally and the raw verdict is returned for
// contract.parseVerdict below. Signed-action requests still report
// engine-not-built — the action policy engine is spec bite 5.
// GUARD_VERDICT_URL remains part of the armed-path config gate in
// this bite; the local engine does not call it.
async function screenWithVerdictService(serviceRequest, _verdictUrl) {
  if (serviceRequest.kind !== "screen") {
    return { status: "engine-not-built" };
  }
  return { status: "ok", verdict: guardEngine.screen(serviceRequest) };
}

// Contract §6 rule 4: fingerprints are minted server-side only, from
// the connection, salted with a server-only salt. No raw identifier
// ever leaves in a request or a feed entry.
function mintSourceFingerprint(req) {
  const salt = process.env.GUARD_FINGERPRINT_SALT?.trim();
  if (!salt) return null;
  const forwarded = req.headers?.["x-forwarded-for"];
  const source =
    (typeof forwarded === "string" && forwarded.split(",")[0].trim()) ||
    req.socket?.remoteAddress ||
    "unknown";
  return "sha256:" + createHash("sha256").update(salt + "|" + source).digest("hex");
}

// ── FEED WIRING (spec bite 3) ─────────────────────────────────────
// Counters are per-process (a serverless instance counts its own
// traffic; the sink is where entries accumulate durably). The stats
// object is exported so tests — and only tests — can read the books.
export const feedStats = {
  screens: 0,        // validated screen requests judged
  actions: 0,        // validated action requests judged
  entriesBuilt: 0,   // feed entries minted by the contract builder
  delivered: 0,      // entries the sink accepted
  dropped: 0         // entries counted and dropped (no sink / sink failed)
};
const flagsByFingerprint = new Map();
const FEED_TIMEOUT_MS = 1500;

// Deliver one entry to the sink, or count + drop it — loudly either
// way. Log lines carry the entry id and outcome ONLY: never content,
// never the visitor's words (contract §6).
async function deliverFeedEntry(entry, secretKey) {
  feedStats.entriesBuilt += 1;
  const url = process.env.GUARD_FEED_URL?.trim();
  if (!url) {
    feedStats.dropped += 1;
    console.warn(
      `[guard] feed sink not configured (GUARD_FEED_URL unset): entry ${entry.entryId} ` +
      `(${entry.verdict}/${entry.class}) counted and dropped — not delivered`);
    return;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secretKey}`
      },
      body: JSON.stringify(entry),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`sink answered ${res.status}`);
    feedStats.delivered += 1;
  } catch (err) {
    feedStats.dropped += 1;
    console.warn(
      `[guard] feed delivery failed (${err.message}): entry ${entry.entryId} ` +
      `(${entry.verdict}/${entry.class}) counted and dropped`);
  }
}

// Record one judged outcome per the feed discipline in the header:
// allow verdicts move only the aggregate counters; flags, blocks,
// and stance (gap) outcomes mint a contract feed entry and deliver
// it. Feed trouble never reaches the caller's answer — every failure
// inside is counted, logged, and swallowed by design.
async function recordFeed(request, outcome, fingerprint, forbiddenContent, secretKey) {
  try {
    const counts = {};
    if (request.kind === "screen") {
      feedStats.screens += 1;
      counts.screensTotal = feedStats.screens;
    } else {
      feedStats.actions += 1;
      counts.actionsTotal = feedStats.actions;
    }
    const isGap = outcome.synthetic === true;
    if (!isGap && outcome.verdict === "allow") return; // counters only (spec §3)
    if (fingerprint && (outcome.verdict === "flag" || outcome.verdict === "block")) {
      const n = (flagsByFingerprint.get(fingerprint) || 0) + 1;
      flagsByFingerprint.set(fingerprint, n);
      counts.flagsFromSource = n;
    }
    const entry = contract.buildFeedEntry({
      request, outcome, fingerprint, counts, forbiddenContent
    });
    await deliverFeedEntry(entry, secretKey);
  } catch {
    console.warn(
      `[guard] feed entry could not be built for request ${request.requestId} — outcome not recorded`);
  }
}

function readBody(req) {
  if (req.body === undefined || req.body === null) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null; // unparseable → malformed → 400 below
    }
  }
  return req.body;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secretKey = process.env.GUARD_SECRET_KEY?.trim();
  if (!secretKey) {
    res.status(503).json({
      error: "Guard not armed on this site (missing GUARD_SECRET_KEY on env)",
    });
    return;
  }

  const verdictUrl = process.env.GUARD_VERDICT_URL?.trim();
  if (!verdictUrl) {
    res.status(503).json({
      error: "Guard verdict service not configured (missing GUARD_VERDICT_URL on env)",
    });
    return;
  }

  // ARMED PATH (contract guard/1.0).
  let request;
  try {
    const body = readBody(req);
    if (body === null) {
      throw contract.GuardContractError("bad-request", "request body is not valid JSON");
    }
    request = validateScreenRequest(body);
  } catch (err) {
    res.status(400).json({
      contract: CONTRACT_VERSION,
      error: "Malformed Guard screen request",
      code: err.code || "bad-request",
    });
    return;
  }

  const serviceRequest = {
    ...request,
    sourceFingerprint: mintSourceFingerprint(req),
  };
  const engine = await screenWithVerdictService(serviceRequest, verdictUrl);
  if (engine.status === "engine-not-built") {
    // Signed actions (bite 5): the feed still gets its gap entry —
    // the contract-default stance outcome, naming the agent through
    // the envelope's signature block (contract §5).
    await recordFeed(
      request,
      contract.applyFailureStance("action"),
      serviceRequest.sourceFingerprint,
      undefined,
      secretKey
    );
    res.status(503).json({
      contract: CONTRACT_VERSION,
      error: "Guard action policy engine not built yet (contract guard/1.0, spec bite 5)",
      code: "engine-not-built",
    });
    return;
  }

  // The engine's verdict is validated with contract.parseVerdict
  // before anything honors it; a parse throw means NO VERDICT, and
  // the caller applies the failure stance — it is never upgraded
  // to an allow here. The gap lands in the feed either way.
  let verdict;
  try {
    verdict = contract.parseVerdict(engine.verdict);
  } catch {
    await recordFeed(
      request,
      contract.applyFailureStance("screen"),
      serviceRequest.sourceFingerprint,
      request.input?.text,
      secretKey
    );
    res.status(503).json({
      contract: CONTRACT_VERSION,
      error: "Guard screening returned no usable verdict",
      code: "no-verdict",
    });
    return;
  }

  await recordFeed(
    request, verdict, serviceRequest.sourceFingerprint,
    request.input?.text, secretKey
  );
  res.status(200).json(verdict);
}
