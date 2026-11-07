// ════════════════════════════════════════════════════════════════════
//  GUARD EMBED — v0.3.0 (template kit): dormant at ship, armed path
//  built (spec bite 3). Guard Live arming happens per site — no live
//  site is armed by this file shipping in the kit.
//
//  Load order: guard-config.js, guard-contract.js, then this file.
//
//  THE THREE STATES (by config, decided at load):
//
//    DORMANT — config.enabled is not true, or no site key.
//      Byte-for-byte the bite-1 behavior: no network calls, no event
//      listeners, no DOM reads or writes, no UI. The footprint is
//      window.HelmianGuard (version stamp + the contract's local
//      machinery). screen() exists so a site's panel wiring can be
//      present from day one: called while dormant, it is a pure
//      pass-through — it sends nothing and blocks nothing.
//
//    ARM REQUESTED, NOT ARMED — enabled + key, but this environment
//      cannot screen (contract file missing, or no fetch transport).
//      armRequested records the owner's intent; armed stays false.
//      screen() answers with the failure stance (contract §5) and
//      sends nothing — the gap is honest, never a silent allow dressed
//      up as a verdict.
//
//    ARMED — enabled + key + contract + transport.
//      screen({surface, text, conversation}) POSTs a guard/1.0 screen
//      request to the site's own /api/guard/screen route (the config's
//      screenEndpoint), capped at the contract's 1,500 ms. The answer
//      is validated with contract.parseVerdict; anything else —
//      non-200, bad JSON, a malformed verdict, a timeout — is NO
//      VERDICT, and the surface's failure stance (config data,
//      contract defaults: chat open) decides. The resolved outcome:
//
//        { proceed, verdict, class, score, reason, note, synthetic,
//          requestId }
//
//      `proceed` is false only on a block: on a chat surface the
//      message does not reach the site's agent, and `note` — the
//      verdict's one plain sentence — is what the visitor/owner sees
//      instead. On allow/flag the message proceeds and the same
//      sentence is the owner-facing note. `synthetic: true` marks a
//      stance-produced outcome, never confused with a real verdict.
//
//  DATA DISCIPLINE (contract §6): the embed's only network act is the
//  screen POST itself — visitor text travels as text-in-flight to the
//  site's OWN route, retention transit-only, exactly as the contract
//  designs it. The embed keeps no copy, writes no log, and produces
//  no records: feed entries are minted server-side by the route,
//  through the contract's allowlist builder, and contain no content.
// ════════════════════════════════════════════════════════════════════
(function () {
  var VERSION = "0.3.0";
  var cfg = (typeof window !== "undefined" && window.GUARD_CONFIG) || {};
  var contract = (typeof window !== "undefined" && window.GuardContract) || null;
  var armRequested = cfg.enabled === true &&
    typeof cfg.siteKey === "string" && cfg.siteKey.length > 0;
  var screenEndpoint = typeof cfg.screenEndpoint === "string" && cfg.screenEndpoint
    ? cfg.screenEndpoint
    : "/api/guard/screen";

  // Failure stance (contract §5/§7): the owner's decision rides as
  // DATA in guard-config.js (`stance: { chat, actions }`); whatever a
  // site doesn't set falls back to the contract's defaults — today
  // chat open / actions closed. Only "open"/"closed" are honored;
  // anything else is ignored, never guessed at. (The actions half is
  // carried for completeness — this embed screens visitor text;
  // agent actions are judged server-side, spec bite 5.)
  var FALLBACK_STANCE = { chat: "open", actions: "closed" }; // mirrors contract.DEFAULT_FAILURE_STANCE
  function resolveStance(raw) {
    var base = contract ? contract.DEFAULT_FAILURE_STANCE : FALLBACK_STANCE;
    var out = { chat: base.chat, actions: base.actions };
    if (raw && typeof raw === "object") {
      if (raw.chat === "open" || raw.chat === "closed") out.chat = raw.chat;
      if (raw.actions === "open" || raw.actions === "closed") out.actions = raw.actions;
    }
    return out;
  }
  var stance = resolveStance(cfg.stance);

  // Armed requires a transport: an embed that cannot send is not
  // armed, whatever the config asks. In a browser, the global fetch
  // IS window.fetch; an environment without one (a test harness, a
  // pre-fetch browser) honestly reports armed: false.
  var transport = typeof fetch === "function" ? fetch : null;
  var armed = armRequested && !!contract && !!transport;

  function outcomeOf(outcome, synthetic, requestId) {
    return {
      proceed: outcome.verdict !== "block",
      verdict: outcome.verdict,
      class: outcome.class,
      score: outcome.score,
      reason: outcome.reason,
      note: outcome.reason,
      synthetic: synthetic === true,
      requestId: requestId || null
    };
  }

  function stanceScreenOutcome() {
    return contract.applyFailureStance("screen", stance);
  }

  // POST the screen request to the site's own route. Resolves the
  // parsed JSON body on a 200, and null for EVERYTHING else —
  // non-200, unparseable body, network error, or the contract's
  // 1,500 ms cap expiring (contract §5: all are NO VERDICT).
  function postScreen(request) {
    var controller = null;
    if (typeof AbortController !== "undefined") {
      try { controller = new AbortController(); } catch (e) { controller = null; }
    }
    var timer = null;
    var timeout = new Promise(function (resolve) {
      timer = setTimeout(function () {
        if (controller) { try { controller.abort(); } catch (e) { /* already settled */ } }
        resolve(null);
      }, contract.SCREEN_TIMEOUT_MS);
    });
    var sent;
    try {
      sent = Promise.resolve(transport(screenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: controller ? controller.signal : undefined
      })).then(function (res) {
        if (!res || res.status !== 200 || typeof res.json !== "function") return null;
        return res.json();
      }).then(function (body) {
        return body || null;
      }, function () {
        return null;
      });
    } catch (e) {
      sent = Promise.resolve(null);
    }
    return Promise.race([sent, timeout]).then(function (value) {
      if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer);
      return value;
    });
  }

  // The armed path. input: { surface?, text, conversation?,
  // requestId?, now? } — surface defaults to "ai-panel". Always
  // resolves (never rejects, never hangs past the cap): a Guard
  // failure must degrade to the stance, not break the site's panel.
  function screen(input) {
    input = input || {};

    // Dormant: pure pass-through. Sends nothing, blocks nothing —
    // the wiring changes no behavior until the owner arms the site.
    if (!armRequested) {
      return Promise.resolve(outcomeOf({
        synthetic: true,
        kind: "screen",
        verdict: "allow",
        class: contract.GAP_CLASS,
        score: null,
        reason: "Guard is off on this site; the message was not screened."
      }, true, input.requestId));
    }

    var request;
    try {
      request = contract.buildScreenRequest({
        siteKey: cfg.siteKey,
        surface: typeof input.surface === "string" ? input.surface : "ai-panel",
        text: input.text,
        conversation: input.conversation,
        requestId: input.requestId,
        now: input.now
      });
    } catch (e) {
      // Locally un-buildable input is a no-verdict, not a pass.
      return Promise.resolve(outcomeOf(stanceScreenOutcome(), true, input.requestId));
    }

    if (!armed) {
      // Arm requested but this environment cannot send: the stance
      // rules, and the outcome says so (synthetic), never a fake allow.
      return Promise.resolve(outcomeOf(stanceScreenOutcome(), true, request.requestId));
    }

    return postScreen(request).then(function (raw) {
      if (!raw) {
        return outcomeOf(stanceScreenOutcome(), true, request.requestId);
      }
      try {
        return outcomeOf(contract.parseVerdict(raw), false, request.requestId);
      } catch (e) {
        // A malformed verdict is NO VERDICT (contract §5) — never
        // silently upgraded to an allow.
        return outcomeOf(stanceScreenOutcome(), true, request.requestId);
      }
    });
  }

  window.HelmianGuard = {
    version: VERSION,
    contractVersion: contract ? contract.CONTRACT_VERSION : null,
    armed: armed,
    armRequested: armRequested,
    stance: stance,
    screenEndpoint: screenEndpoint,

    // LOCAL ONLY — constructs a guard/1.0 screen request in memory
    // (site key taken from this site's config). Performs no send.
    // Returns null when the contract file was not loaded.
    buildScreenRequest: contract ? function (input) {
      var merged = {};
      input = input || {};
      for (var k in input) {
        if (Object.prototype.hasOwnProperty.call(input, k)) merged[k] = input[k];
      }
      merged.siteKey = cfg.siteKey;
      return contract.buildScreenRequest(merged);
    } : null,

    // LOCAL ONLY — validates/normalizes a verdict object against
    // the contract. Throws on anything malformed; a throw means
    // NO VERDICT (callers apply the failure stance, never allow).
    parseVerdict: contract ? contract.parseVerdict : null,

    // THE ARMED PATH (above) — screens visitor text through the
    // site's own /api/guard/screen route when armed; resolves a
    // stance outcome without sending when it cannot. Null when the
    // contract file was not loaded.
    screen: contract ? screen : null
  };
})();
