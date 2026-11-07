// ════════════════════════════════════════════════════════════════════
//  GUARD CONTRACT — guard/1.0 shared machinery (template kit).
//
//  The pure, local half of the verdict contract (guard-contract.md):
//  request builders, the verdict parser, the failure-stance rule, and
//  the feed-entry builder. Used by the embed (browser), the site's
//  /api/guard/screen route (server), and the conformance tests.
//
//  This file performs NO network calls, NO DOM access, NO storage.
//  Building a request object locally is not sending it; arming the
//  send is a later bite. Data discipline (contract §6) is enforced by
//  construction here: builders reject content-bearing keys outright,
//  and the feed-entry builder's allowlist has no content field at all.
//
//  Load order on a page: guard-config.js, then this file, then
//  guard-embed.js. In Node it is require()-able (module.exports).
// ════════════════════════════════════════════════════════════════════
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.GuardContract = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var CONTRACT_VERSION = "guard/1.0";

  // A screen call is abandoned after this long → treated as no verdict
  // (contract §5). Bite 2's corpus numbers may re-price it.
  var SCREEN_TIMEOUT_MS = 1500;

  var VERDICTS = ["allow", "flag", "block"];

  var SURFACES = [
    "ai-panel", "ai-search", "voice-input",
    "form", "sign-in", "upload", "agent-action"
  ];

  // Spec §2a's five attack classes + the §2c/§2d surface classes.
  var SCREEN_CLASSES = [
    "none",
    "instruction-hijack", "secret-fishing", "tool-baiting",
    "data-smuggling", "jailbreak-dressing",
    "form-abuse", "rate-swarm"
  ];

  // Spec §2b denial reasons for signed actions.
  var ACTION_CLASSES = [
    "none",
    "action-out-of-policy", "action-over-limit", "action-needs-approval"
  ];

  // Outcome-only class for no-verdict gap entries (contract §5).
  // A verdict service may never return this; it is minted locally.
  var GAP_CLASS = "screen-unavailable";

  // Spec §7's recommended defaults, as data (contract §5). Troy's
  // decision changes these values, never the code.
  var DEFAULT_FAILURE_STANCE = { chat: "open", actions: "closed" };

  var LIMITS = {
    textMax: 8000,
    turnTextMax: 8000,
    conversationMaxTurns: 20,
    reasonMax: 280,
    siteKeyMax: 128,
    targetMax: 200
  };

  var COUNT_KEYS = ["screensTotal", "flagsFromSource", "actionsTotal"];

  var ROLES = ["visitor", "agent"];

  // ── errors ────────────────────────────────────────────────────────
  function GuardContractError(code, message) {
    var err = new Error(message);
    err.name = "GuardContractError";
    err.code = code;
    return err;
  }
  function fail(code, message) {
    throw GuardContractError(code, message);
  }

  // ── small validators ──────────────────────────────────────────────
  function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }
  function isNonEmptyString(v, max) {
    return typeof v === "string" && v.length > 0 && v.length <= max;
  }
  function isScore(v) {
    return typeof v === "number" && isFinite(v) && v >= 0 && v <= 1;
  }
  function isFingerprint(v) {
    return typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
  }
  function rejectUnknownKeys(obj, allowed, where) {
    Object.keys(obj).forEach(function (k) {
      if (allowed.indexOf(k) === -1) {
        fail("unknown-field", where + ": unknown field '" + k + "'");
      }
    });
  }

  var idCounter = 0;
  function newId(prefix) {
    idCounter += 1;
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return prefix + "_" + crypto.randomUUID();
    }
    return prefix + "_" + Date.now().toString(36) + "_" +
      idCounter.toString(36) + "_" +
      Math.floor(Math.random() * 0xffffffff).toString(16);
  }

  function sentAt(input) {
    if (input.now !== undefined) {
      if (!isNonEmptyString(input.now, 64)) {
        fail("bad-field", "now must be an ISO timestamp string");
      }
      return input.now;
    }
    return new Date().toISOString();
  }

  function checkSiteAndSurface(input, where) {
    if (!isNonEmptyString(input.siteKey, LIMITS.siteKeyMax)) {
      fail("bad-field", where + ": siteKey must be a non-empty string");
    }
    if (SURFACES.indexOf(input.surface) === -1) {
      fail("bad-field", where + ": unknown surface '" + input.surface + "'");
    }
  }

  // ── screen request builder (contract §1) ──────────────────────────
  function buildScreenRequest(input) {
    if (!isPlainObject(input)) fail("bad-request", "screen request input must be an object");
    rejectUnknownKeys(input,
      ["siteKey", "surface", "text", "conversation", "requestId", "now"],
      "screen request");
    checkSiteAndSurface(input, "screen request");
    if (!isNonEmptyString(input.text, LIMITS.textMax)) {
      fail("bad-field", "screen request: text must be a string of 1.." + LIMITS.textMax + " chars");
    }
    var conversation = [];
    if (input.conversation !== undefined) {
      if (!Array.isArray(input.conversation) ||
          input.conversation.length > LIMITS.conversationMaxTurns) {
        fail("bad-field", "screen request: conversation must be an array of at most " +
          LIMITS.conversationMaxTurns + " turns");
      }
      conversation = input.conversation.map(function (turn, i) {
        if (!isPlainObject(turn)) fail("bad-field", "conversation turn " + i + " must be an object");
        rejectUnknownKeys(turn, ["role", "text"], "conversation turn " + i);
        if (ROLES.indexOf(turn.role) === -1) {
          fail("bad-field", "conversation turn " + i + ": unknown role '" + turn.role + "'");
        }
        if (!isNonEmptyString(turn.text, LIMITS.turnTextMax)) {
          fail("bad-field", "conversation turn " + i + ": text must be 1.." + LIMITS.turnTextMax + " chars");
        }
        return { role: turn.role, text: turn.text };
      });
    }
    return {
      contract: CONTRACT_VERSION,
      kind: "screen",
      requestId: input.requestId || newId("req"),
      siteKey: input.siteKey,
      surface: input.surface,
      input: { text: input.text, conversation: conversation },
      context: { sentAt: sentAt(input) },
      dataHandling: { retention: "transit-only" }
    };
  }

  // ── signed-action envelope builder (contract §2) ──────────────────
  function buildActionRequest(input) {
    if (!isPlainObject(input)) fail("bad-request", "action request input must be an object");
    rejectUnknownKeys(input,
      ["siteKey", "agent", "seat", "site", "actionClass", "authorization",
       "payloadSummary", "requestId", "now"],
      "action request");
    checkSiteAndSurface(
      { siteKey: input.siteKey, surface: "agent-action" }, "action request");
    ["agent", "seat", "site", "actionClass"].forEach(function (k) {
      if (!isNonEmptyString(input[k], 128)) {
        fail("bad-field", "action request: " + k + " must be a non-empty string");
      }
    });
    var auth = input.authorization;
    if (!isPlainObject(auth)) fail("bad-field", "action request: authorization must be an object");
    rejectUnknownKeys(auth, ["by", "scope", "approvalId"], "authorization");
    if (!isNonEmptyString(auth.by, 128) || !isNonEmptyString(auth.scope, 128)) {
      fail("bad-field", "authorization: by and scope must be non-empty strings");
    }
    if (auth.approvalId !== null && !isNonEmptyString(auth.approvalId, 128)) {
      fail("bad-field", "authorization: approvalId must be a string or null");
    }
    var summary = input.payloadSummary;
    if (!isPlainObject(summary)) fail("bad-field", "action request: payloadSummary must be an object");
    // The discipline choke point: target/count/bytes ONLY. A caller
    // trying to pass content (records, notes, the payload itself)
    // throws here — by construction, not by convention.
    rejectUnknownKeys(summary, ["target", "count", "bytes"], "payloadSummary");
    var cleanSummary = {};
    if (summary.target !== undefined) {
      if (!isNonEmptyString(summary.target, LIMITS.targetMax)) {
        fail("bad-field", "payloadSummary: target must be a string of at most " + LIMITS.targetMax + " chars");
      }
      cleanSummary.target = summary.target;
    }
    ["count", "bytes"].forEach(function (k) {
      if (summary[k] !== undefined) {
        if (!Number.isInteger(summary[k]) || summary[k] < 0) {
          fail("bad-field", "payloadSummary: " + k + " must be a non-negative integer");
        }
        cleanSummary[k] = summary[k];
      }
    });
    return {
      contract: CONTRACT_VERSION,
      kind: "action",
      requestId: input.requestId || newId("req"),
      siteKey: input.siteKey,
      surface: "agent-action",
      action: {
        agent: input.agent,
        seat: input.seat,
        site: input.site,
        actionClass: input.actionClass,
        authorization: {
          by: auth.by,
          scope: auth.scope,
          approvalId: auth.approvalId
        },
        payloadSummary: cleanSummary
      },
      context: { sentAt: sentAt(input) },
      dataHandling: { retention: "transit-only" }
    };
  }

  // ── request validation (route side; contract §1/§2/§5) ────────────
  // Rebuilds a received body through the builders so a request that
  // reaches the verdict service is exactly contract-shaped. Anything
  // malformed throws; the route answers 400 and screens nothing.
  function validateScreenRequest(body) {
    if (!isPlainObject(body)) fail("bad-request", "request body must be an object");
    if (body.contract !== CONTRACT_VERSION) {
      fail("bad-version", "unsupported contract '" + body.contract +
        "' (this site speaks " + CONTRACT_VERSION + ")");
    }
    if (body.kind === "screen") {
      if (!isPlainObject(body.input)) fail("bad-field", "request: input must be an object");
      rejectUnknownKeys(body.input, ["text", "conversation"], "request input");
      var rebuiltScreen = buildScreenRequest({
        siteKey: body.siteKey,
        surface: body.surface,
        text: body.input.text,
        conversation: body.input.conversation,
        requestId: body.requestId,
        now: isPlainObject(body.context) ? body.context.sentAt : undefined
      });
      if (!isNonEmptyString(body.requestId, 128)) {
        fail("bad-field", "request: requestId must be a non-empty string");
      }
      return rebuiltScreen;
    }
    if (body.kind === "action") {
      if (!isPlainObject(body.action)) fail("bad-field", "request: action must be an object");
      if (body.surface !== "agent-action") {
        fail("bad-field", "request: action kind requires surface 'agent-action'");
      }
      var a = body.action;
      var rebuiltAction = buildActionRequest({
        siteKey: body.siteKey,
        agent: a.agent, seat: a.seat, site: a.site,
        actionClass: a.actionClass,
        authorization: a.authorization,
        payloadSummary: a.payloadSummary,
        requestId: body.requestId,
        now: isPlainObject(body.context) ? body.context.sentAt : undefined
      });
      if (!isNonEmptyString(body.requestId, 128)) {
        fail("bad-field", "request: requestId must be a non-empty string");
      }
      return rebuiltAction;
    }
    fail("bad-field", "request: unknown kind '" + body.kind + "'");
  }

  // ── verdict parser (contract §3/§5) ───────────────────────────────
  // Strict: anything malformed throws (callers treat a throw as NO
  // VERDICT → failure stance — never as allow). Unknown extra fields
  // are stripped, so the returned object is exactly the contract shape.
  function parseVerdict(raw) {
    if (!isPlainObject(raw)) fail("bad-verdict", "verdict must be an object");
    if (raw.contract !== CONTRACT_VERSION) {
      fail("bad-version", "verdict contract '" + raw.contract +
        "' is not " + CONTRACT_VERSION);
    }
    if (raw.kind !== "screen" && raw.kind !== "action") {
      fail("bad-verdict", "verdict: unknown kind '" + raw.kind + "'");
    }
    if (!isNonEmptyString(raw.requestId, 128)) {
      fail("bad-verdict", "verdict: requestId must be a non-empty string");
    }
    if (VERDICTS.indexOf(raw.verdict) === -1) {
      fail("bad-verdict", "verdict: unknown verdict '" + raw.verdict + "'");
    }
    var classes = raw.kind === "action" ? ACTION_CLASSES : SCREEN_CLASSES;
    if (classes.indexOf(raw.class) === -1) {
      fail("bad-verdict", "verdict: unknown class '" + raw.class +
        "' for kind '" + raw.kind + "'");
    }
    if (raw.verdict === "allow" && raw.class !== "none") {
      fail("bad-verdict", "verdict: allow must carry class 'none'");
    }
    if (raw.verdict !== "allow" && raw.class === "none") {
      fail("bad-verdict", "verdict: flag/block must carry a real class");
    }
    if (!isScore(raw.score)) {
      fail("bad-verdict", "verdict: score must be a number in [0, 1]");
    }
    if (!isNonEmptyString(raw.reason, LIMITS.reasonMax)) {
      fail("bad-verdict", "verdict: reason must be one plain sentence of at most " +
        LIMITS.reasonMax + " chars");
    }
    return {
      contract: CONTRACT_VERSION,
      kind: raw.kind,
      requestId: raw.requestId,
      verdict: raw.verdict,
      class: raw.class,
      score: raw.score,
      reason: raw.reason
    };
  }

  // ── failure stance (contract §5) ──────────────────────────────────
  // What happens when there is NO verdict (malformed verdict, timeout,
  // engine unreachable / not built): a synthetic outcome object,
  // clearly marked, never confused with a real verdict.
  function applyFailureStance(kind, stance) {
    var s = stance || DEFAULT_FAILURE_STANCE;
    if (kind === "action") {
      var closed = s.actions !== "open";
      return {
        synthetic: true,
        kind: "action",
        verdict: closed ? "block" : "allow",
        class: GAP_CLASS,
        score: null,
        reason: closed
          ? "Guard could not check this action, so it did not happen."
          : "Guard could not check this action; the site's policy lets it proceed."
      };
    }
    var open = s.chat !== "closed";
    return {
      synthetic: true,
      kind: "screen",
      verdict: open ? "allow" : "block",
      class: GAP_CLASS,
      score: null,
      reason: open
        ? "Guard could not check this message; the site let it through and noted the gap."
        : "Guard could not check this message, so the panel paused it."
    };
  }

  // ── feed-entry builder (contract §4/§6) ───────────────────────────
  // The ONLY way feed records are made. Allowlist in, allowlist out:
  // the output has no content field, and handing the builder a
  // content-bearing key (text, input, content, message, payload, …)
  // throws. Pass `forbiddenContent` (the raw input text) and the
  // builder also refuses a summary that quotes it.
  var FEED_FORBIDDEN_KEYS = [
    "text", "input", "content", "message", "messages",
    "payload", "conversation", "records", "data"
  ];
  function buildFeedEntry(input) {
    if (!isPlainObject(input)) fail("bad-feed-entry", "feed entry input must be an object");
    Object.keys(input).forEach(function (k) {
      if (FEED_FORBIDDEN_KEYS.indexOf(k) !== -1) {
        fail("data-discipline", "feed entry: content-bearing field '" + k +
          "' may never enter a feed record (contract §6)");
      }
    });
    rejectUnknownKeys(input,
      ["request", "outcome", "fingerprint", "counts", "entryId", "ts", "forbiddenContent"],
      "feed entry");
    var request = input.request;
    var outcome = input.outcome;
    if (!isPlainObject(request) || !isNonEmptyString(request.requestId, 128) ||
        !isNonEmptyString(request.siteKey, LIMITS.siteKeyMax)) {
      fail("bad-feed-entry", "feed entry: a contract request (requestId, siteKey) is required");
    }
    if (!isPlainObject(outcome) || VERDICTS.indexOf(outcome.verdict) === -1 ||
        !isNonEmptyString(outcome.reason, LIMITS.reasonMax)) {
      fail("bad-feed-entry", "feed entry: a verdict or stance outcome is required");
    }
    if (input.forbiddenContent !== undefined &&
        typeof input.forbiddenContent === "string" &&
        input.forbiddenContent.length > 0 &&
        outcome.reason.indexOf(input.forbiddenContent) !== -1) {
      fail("data-discipline", "feed entry: the owner summary quotes the raw input; " +
        "summaries name the class, never the content (contract §6)");
    }
    var fingerprint = input.fingerprint === undefined ? null : input.fingerprint;
    if (fingerprint !== null && !isFingerprint(fingerprint)) {
      fail("bad-feed-entry", "feed entry: fingerprint must be 'sha256:<64 hex>' " +
        "(minted server-side) or null — never a raw identifier");
    }
    var counts = {};
    if (input.counts !== undefined) {
      if (!isPlainObject(input.counts)) fail("bad-feed-entry", "feed entry: counts must be an object");
      Object.keys(input.counts).forEach(function (k) {
        if (COUNT_KEYS.indexOf(k) === -1) {
          fail("bad-feed-entry", "feed entry: unknown count '" + k + "'");
        }
        if (typeof input.counts[k] !== "number" || !isFinite(input.counts[k]) || input.counts[k] < 0) {
          fail("bad-feed-entry", "feed entry: count '" + k + "' must be a non-negative number");
        }
        counts[k] = input.counts[k];
      });
    }
    var signature = null;
    if (request.kind === "action" && isPlainObject(request.action)) {
      var act = request.action;
      signature = {
        agent: act.agent, seat: act.seat, site: act.site,
        actionClass: act.actionClass,
        authorization: {
          by: act.authorization.by,
          scope: act.authorization.scope,
          approvalId: act.authorization.approvalId
        }
      };
    }
    return {
      contract: CONTRACT_VERSION,
      entryId: input.entryId || newId("feed"),
      requestId: request.requestId,
      siteKey: request.siteKey,
      ts: input.ts || new Date().toISOString(),
      kind: outcome.synthetic ? "gap" : request.kind,
      surface: request.surface,
      verdict: outcome.verdict,
      class: outcome.class,
      score: outcome.score === undefined ? null : outcome.score,
      sourceFingerprint: fingerprint,
      counts: counts,
      signature: signature,
      ownerSummary: outcome.reason
    };
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    SCREEN_TIMEOUT_MS: SCREEN_TIMEOUT_MS,
    VERDICTS: VERDICTS,
    SURFACES: SURFACES,
    SCREEN_CLASSES: SCREEN_CLASSES,
    ACTION_CLASSES: ACTION_CLASSES,
    GAP_CLASS: GAP_CLASS,
    DEFAULT_FAILURE_STANCE: DEFAULT_FAILURE_STANCE,
    LIMITS: LIMITS,
    COUNT_KEYS: COUNT_KEYS,
    GuardContractError: GuardContractError,
    isFingerprint: isFingerprint,
    buildScreenRequest: buildScreenRequest,
    buildActionRequest: buildActionRequest,
    validateScreenRequest: validateScreenRequest,
    parseVerdict: parseVerdict,
    applyFailureStance: applyFailureStance,
    buildFeedEntry: buildFeedEntry
  };
});
