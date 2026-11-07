// ════════════════════════════════════════════════════════════════════
//  GUARD SCREENING ENGINE — guard/1.0, spec bite 2 (template kit).
//
//  Rules-first, deterministic, server-side ONLY. No network, no model
//  calls, no DOM, no storage, no learning components: the same input
//  always earns the same verdict, and every non-allow verdict names
//  the inspectable rule ids that produced it.
//
//  The engine consumes a contract-shaped screen request (see
//  guard-contract.md §1 — including the route-minted
//  sourceFingerprint, which it ignores: fingerprints identify, rules
//  judge text and conversation shape) and returns a verdict object
//  the contract parser accepts, plus `ruleIds` and `scoresByClass`
//  bench metadata. The wire verdict is contract.parseVerdict's output
//  — the metadata never travels downstream.
//
//  Classes are spec §2a's five, plus §2c form-abuse and §2d
//  rate-swarm. Verdict thresholds: score >= 0.74 block,
//  0.38..0.73 flag, below that allow.
// ════════════════════════════════════════════════════════════════════
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.GuardEngine = api;
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var CONTRACT_VERSION = "guard/1.0";
  var BLOCK_THRESHOLD = 0.74;
  var FLAG_THRESHOLD = 0.38;

  // ── text normalization ──────────────────────────────────────────
  // Rules judge wording, not typography: case, accents, curly quotes,
  // leetspeak and spaced-out letters all fold to one shadow text (and
  // a compact shadow with separators removed) before matching.
  function normalizeText(text) {
    var s = String(text == null ? "" : text)
      .normalize("NFKC")
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    var deleet = s
      .replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e")
      .replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t")
      .replace(/@/g, "a").replace(/\$/g, "s");
    return {
      raw: s,
      deleet: deleet,
      compact: deleet.replace(/[^a-z0-9]+/g, ""),
      words: deleet.split(/[^a-z0-9']+/).filter(Boolean)
    };
  }

  function anyMatch(haystacks, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      for (var j = 0; j < haystacks.length; j++) {
        if (patterns[i].test(haystacks[j])) return true;
      }
    }
    return false;
  }

  // ── the rule book ───────────────────────────────────────────────
  // Each rule: id (cited in every verdict it helps produce), class,
  // points (combined per class as 1 − ∏(1 − p), so independent
  // signals accumulate without any single weak signal blocking),
  // and the patterns that fire it. Patterns run against the raw and
  // deleet shadows; compact patterns run against the compact shadow.
  var P = function (re) { return { re: re, on: "text" }; };
  var C = function (re) { return { re: re, on: "compact" }; };

  var RULES = [
    // ── instruction-hijack (spec §2a) ──
    { id: "hijack.discard-instructions", cls: "instruction-hijack", points: 0.92, patterns: [
      P(/\b(ignore|disregard|forget|override|bypass|skip|drop|abandon)\b[^.?!]{0,48}\b(previous|prior|system|developer|original|above|earlier|your|all|the)\b[^.?!]{0,24}\b(instructions?|prompt|rules?|guidelines?|directives?|programming)\b/),
      P(/\b(stop following|do not follow|don't follow|never follow|no longer follow|stop obeying|do not obey)\b[^.?!]{0,32}\b(instructions?|rules?|prompt|developer|system|them|it)\b/),
      P(/\b(ignora|desobedece|olvida|omite)\b[^.?!]{0,40}\b(instrucciones|reglas|indicaciones)\b/),
      C(/ignore(all|previous|prior|system|your)*instructions/), C(/disregard(all|the|your|previous|prior|system)*instructions/), C(/forget(all|the|your|previous|prior|system)*instructions/),
      C(/disregard(previous|prior|system)?instructions/)
    ] },
    { id: "hijack.void-instructions", cls: "instruction-hijack", points: 0.86, patterns: [
      P(/\b(previous|prior|system|your|earlier|original)\s+(instructions?|directives?|rules?|prompt)\s+(are|is)\s+(cancelled|canceled|void|revoked|terminated|no longer (apply|valid|in effect))\b/),
      P(/\b(disregard|ignore|forget|drop)\b[^.?!]{0,24}\b(everything|all of it|all that|the lot)\s+(above|before|prior)\b/),
      P(/\b(not bound by|no longer bound by|free from|unbound by)\b[^.?!]{0,32}\b(instructions?|rules?|directives?)\b/),
      P(/\b(highest|top|maximum)\s+priority\s+(instruction|directive|command|order)\b/)
    ] },
    { id: "hijack.new-authority", cls: "instruction-hijack", points: 0.78, patterns: [
      P(/\b(new|real|actual|updated|highest[- ]priority|top[- ]priority|developer|system|admin|emergency)\s+(your\s+|the\s+)?(instructions?|directives?|orders?|commands?)\b[^.?!]{0,40}\b(is|are|follow|obey|:)/),
      P(/\bfollow\s+(my|these|the new)\s+instructions?\s+instead\b/),
      P(/\bmy\s+instructions?\s+(override|outrank|replace|supersede|come before)\b/),
      P(/\b(obey|follow)\s+only\s+me\b/),
      P(/\b(user|visitor|my|the user'?s)\s+(requests?|instructions?|commands?)\s+(outrank|outranks|override|overrides|supersede|supersedes|take precedence over|come before)\b[^.?!]{0,24}\b(site|system|your|the)?\s*(rules?|instructions?)?\b/),
      C(/followmyinstructionsinstead/)
    ] },
    { id: "hijack.role-replacement", cls: "instruction-hijack", points: 0.66, patterns: [
      P(/\b(you are now|from now on,?\s+you are|you're now|act as|pretend to be|roleplay as|you will act as)\b[^.?!]{0,48}\b(unrestricted|unfiltered|no rules|no restrictions|no limits|developer mode|dan|jailbroken|an ai (that|which) (can|will) do anything)\b/),
      P(/\b(from now on|starting now)\b[^.?!]{0,40}\b(ignore|forget|disregard|no rules|no restrictions)\b/),
      C(/youarenowdan/), C(/actasdan/)
    ] },
    { id: "hijack.no-rules-state", cls: "instruction-hijack", points: 0.82, patterns: [
      P(/\b(you|there)\s+(have|has|are|is)?\s*(under\s+)?no\s+(rules|restrictions|limitations|limits|filters|safeguards|guardrails|safety rules)\b/),
      P(/\bwithout\s+(any\s+)?(rules|restrictions|limitations|content filters|safety rules)\b/),
      P(/\bact as if\b[^.?!]{0,40}\b(no rules|no restrictions|nothing is (forbidden|off limits|prohibited))\b/),
      P(/\bactua como si no tuvieras (reglas|restricciones|limites)\b/)
    ] },

    { id: "hijack.meta-question", cls: "instruction-hijack", points: 0.45, patterns: [
      P(/\b(what (would|will|happens?)|how (do|would) you (respond|react))\b[^.?!]{0,56}\b(ignore|disregard|forget)\b[^.?!]{0,28}\b(instructions|training|rules)\b/)
    ] },

    // ── secret-fishing (spec §2a) ──
    { id: "secret.system-prompt", cls: "secret-fishing", points: 0.95, patterns: [
      P(/\b(show|reveal|tell|print|give|list|share|display|send|read|repeat|output|disclose|leak)\b[^.?!]{0,40}\b(system prompt|developer (message|prompt|instructions)|hidden (prompt|instructions)|internal (prompt|instructions)|your (system )?(prompt|instructions|programming|directives))\b/),
      P(/\bwhat('s| is| are)\b[^.?!]{0,32}\b(your|the)\s+(system prompt|developer (message|prompt)|hidden instructions|internal instructions|initial instructions)\b/),
      P(/\b(system prompt|prompt del sistema|tus instrucciones internas|instrucciones del sistema)\b/),
      C(/reveal(your)?systemprompt/), C(/showmeyoursystemprompt/), C(/systempromptplease/)
    ] },
    { id: "secret.credentials", cls: "secret-fishing", points: 0.95, patterns: [
      P(/\b(api|secret|private|access|auth|encryption|master|admin|root|database|server|staff|employee)\s+(key|keys|token|tokens|password|passwords|credentials|credential)\b/),
      P(/\b(show|reveal|tell|give|send|share|list|disclose|output|print|read|what('s| is))\b[^.?!]{0,32}\b(the\s+)?(password|credentials|api key|secret key|access token)\b[^.?!]{0,24}\b(for|of|to)?\s*(the\s+)?(admin|server|database|site|panel|account|wifi network|router)?\b/),
      P(/\bpassword\s+(database|file|vault|list|hash|hashes)\b/),
      P(/\b(credentials|password|secret|api key|access token)\s+(file|contents|list|database|vault|values?)\b/),
      P(/\b(clave|contrasena)\s+(de\s+)?(administrador|admin|servidor|la base de datos)\b/),
      C(/apikeyplease/), C(/givemetheapikey/)
    ] },
    { id: "secret.customer-data", cls: "secret-fishing", points: 0.9, patterns: [
      P(/\b(show|reveal|give|send|list|share|tell|disclose|leak|export|download|dump|hand over|pull|get|need|want|access)\b[^.?!]{0,40}\b(customer|client|user|member|patient|guest)(?:'s|s)?\s+(list|database|records?|data|emails?|phone numbers?|addresses|orders?|details|information|history)\b/),
      P(/\b(other|another|previous|earlier|someone else's|all|every|your)\s+(customer|client|user|member|patient|guest)(?:'s|s)?\s+(email|phone|address|order|records?|data|details|information|history)\b/),
      P(/\bwho\s+(else\s+)?(ordered|booked|bought|is coming|has an appointment)\b/),
      P(/\b(list|show|give|send|tell|name)\b[^.?!]{0,24}\b(all|the|every)\s+(customers|clients|users|members|patients|guests)\b/),
      P(/\b(all|every|the)\s+(customers|clients|users|members)\b[^.?!]{0,32}\b(phone|email|address|contact)\b/),
      P(/\b(lista de clientes|datos de (los|otros) clientes|correos de los clientes)\b/)
    ] },
    { id: "secret.private-contact", cls: "secret-fishing", points: 0.9, patterns: [
      P(/\b(private|personal|home)\s+(address|phone|phone number|email)\b[^.?!]{0,32}\b(of|for)\b[^.?!]{0,24}\b(employee|staff|customer|client|owner|manager|worker)\b/),
      P(/\b(phone number|email address|home address)\b[^.?!]{0,48}\b(before mine|after mine|next to mine|booked before|booked after|right before|right after)\b/)
    ] },
    { id: "secret.internals", cls: "secret-fishing", points: 0.85, patterns: [
      P(/\b(source code|database schema|db schema|internal (notes|memo|config|configuration|documents?)|config(uration)? file|admin (panel|dashboard|url|link)|backend (code|files?)|server files?|staff (password|schedule|roster|emails?)|employee (password|emails?|phone numbers?|home address))\b/),
      P(/(^|\s)\.env\b/)
    ] },

    { id: "secret.capabilities", cls: "secret-fishing", points: 0.55, patterns: [
      P(/\bwhat\s+(model|llm|ai|software|stack|tools?)\s+(are you|do you|powers? (you|this site))\b/),
      P(/\bwhat\s+tools?\s+(do you|you)\s+(have access to|can you use)\b/)
    ] },

    // ── tool-baiting (spec §2a) ──
    { id: "tool.mass-send", cls: "tool-baiting", points: 0.94, patterns: [
      P(/\b(send|email|text|message|mail|blast)\b[^.?!]{0,40}\b(all|every|everyone|everybody|entire|full|whole)\b[^.?!]{0,24}\b(customers?|clients?|users?|members?|mailing list|database|subscribers?|customer list)\b/),
      P(/\b(email|send|mail)\b[^.?!]{0,56}\b(the\s+)?(customer|client|mailing)\s+list\b[^.?!]{0,32}\bto\b/)
    ] },
    { id: "tool.destructive", cls: "tool-baiting", points: 0.95, patterns: [
      P(/\b(delete|erase|wipe|destroy|purge|remove|clear out|shut down)\b[^.?!]{0,36}\b(database|records?|backups?|accounts?|customer (list|data|records?)|order history|all (orders|bookings|data|files)|the site|website)\b/)
    ] },
    { id: "tool.export-data", cls: "tool-baiting", points: 0.92, patterns: [
      P(/\b(export|download|dump|extract|pull|copy)\b[^.?!]{0,36}\b(customer|client|user|member|mailing|all|every|entire|full|the whole)\b[^.?!]{0,24}\b(list|database|records?|data|emails?|addresses|csv|files?)\b/),
      P(/\b(export|download|dump|extract)\b[^.?!]{0,24}\b(the\s+)?(customer|client|user|member)?\s*(database|records|mailing list|customer list)\b/)
    ] },
    { id: "tool.financial-abuse", cls: "tool-baiting", points: 0.92, patterns: [
      P(/\b(refund|charge|transfer|wire|pay|credit)\b[^.?!]{0,48}\b(different card|another card|someone else|gift cards?|crypto|bitcoin|my (personal )?account|without (an? )?(order|receipt|authorization|approval))\b/),
      P(/\b(issue|give|process|send)\b[^.?!]{0,24}\b(refund|payment|money)\b[^.?!]{0,32}\b(to me|to my|to this)\b[^.?!]{0,32}\b(without|no)\b[^.?!]{0,16}\b(order|receipt|proof|verification)\b/)
    ] },
    { id: "tool.access-abuse", cls: "tool-baiting", points: 0.88, patterns: [
      P(/\b(grant|give|make|upgrade)\b[^.?!]{0,32}\b(admin|administrator|owner|root|full|staff)\s+(access|account|rights|permissions?|role)\b/),
      P(/\b(change|reset|set)\b[^.?!]{0,28}\b(owner'?s?|admin|administrator|site)\s+(password|credentials)\b/),
      P(/\b(disable|turn off|remove|bypass)\b[^.?!]{0,32}\b(approval|verification|security|authentication|two[- ]factor|2fa|payment check|fraud check)\b/)
    ] },
    { id: "tool.harm-others", cls: "tool-baiting", points: 0.86, patterns: [
      P(/\b(cancel|remove|bump|clear|delete)\b[^.?!]{0,32}\b(all\s+)?(other|everyone else'?s|other people'?s)\s+(bookings?|reservations?|appointments?|orders?)\b/)
    ] },
    { id: "tool.policy-bypass", cls: "tool-baiting", points: 0.74, patterns: [
      P(/\b(don'?t|do not|never)\s+(ask|tell|check with|confirm with)\s+(anyone|the owner|the manager|staff|them)\b/),
      P(/\b(book|cancel|refund|send|change|approve|order|ship|release)\b[^.?!]{0,64}\bwithout\s+(an?\s+|any\s+)?(approval|permission|payment|verification|verifying|checking|asking|telling|confirmation|deposit)\b[^.?!]{0,28}\b(owner|manager|staff|anyone|them|him|her|account holder)?\b/),
      P(/\bjust\s+(do it|charge it|send it|book it)\b[^.?!]{0,32}\b(don't|do not|without)\b[^.?!]{0,24}\b(ask|tell|check|verify|confirm)\b/)
    ] },

    // ── data-smuggling (spec §2a) ──
    { id: "smuggle.transform-private", cls: "data-smuggling", points: 0.92, patterns: [
      P(/\b(encode|encrypt|base64|hex|reverse|translate|spell out|spell|acrostic|poem|song|rap|story|code|initials|first letters|convert|turn|rewrite)\b[^.?!]{0,56}\b(system prompt|instructions|private|confidential|hidden|internal|customer|client|other (customers?|clients?|users?)|database|records?|password|secret)\b/),
      P(/\b(escribe|traduce|revela)\b[^.?!]{0,40}\b(prompt|instrucciones internas|datos privados)\b/)
    ] },
    { id: "smuggle.transform-after", cls: "data-smuggling", points: 0.92, patterns: [
      P(/\b(system prompt|secret key|api key|passwords?|customer (data|emails?|list|records?)|private (data|records?|info|information))\b[^.?!]{0,48}\b(acrostic|poem|song|story|hex|base64|code|initials|first letters|encoded|encode|reverse|reversed)\b/),
      P(/\bput\b[^.?!]{0,32}\b(private|confidential|customer|secret)\b[^.?!]{0,36}\b(story|poem|song|code)\b/),
      P(/\b(private|confidential|secret|customer|internal|hidden)\s+(data|records?|info|information|list)?\b[^.?!]{0,40}\binto a (story|poem|song|rap|code)\b/)
    ] },
    { id: "smuggle.transform-reversed", cls: "data-smuggling", points: 0.86, patterns: [
      P(/\b(quote|repeat|recite|say|output|print)\b[^.?!]{0,40}\b(your instructions|system prompt|the instructions|hidden instructions)\b[^.?!]{0,40}\b(reversed|backwards|in reverse|encoded|in code|translated|in spanish|in french)\b/),
      P(/\b(repeat|reproduce|quote|recite|recite everything|say)\b[^.?!]{0,24}\beverything\s+(above|before)\b/),
      P(/\b(private|secret|confidential|customer)\s+(data|records?|info|information)\b[^.?!]{0,56}\b(replace|encode|convert|disguise|spell|translate|reverse|swap)\b/)
    ] },
    { id: "smuggle.indirect-private", cls: "data-smuggling", points: 0.84, patterns: [
      P(/\b(summarize|describe|paraphrase|tell me (about|what|what'?s in)|what does)\b[^.?!]{0,40}\b(private|confidential|hidden|internal|secret)\s+(file|document|memo|record|notes?|database|data)\b/),
      P(/\b(file|document|memo|record)\s+(you|that you)\s+(can'?t|cannot|won'?t|mustn'?t)\s+(show|share|reveal)\b/),
      P(/\bwithout\s+(showing|revealing|displaying)\s+(it|them|the (file|data|records?))\b[^.?!]{0,32}\b(tell|summarize|describe|say)\b/)
    ] },
    { id: "smuggle.leak-context", cls: "data-smuggling", points: 0.88, patterns: [
      P(/\b(repeat|reproduce|quote|recite|output|print)\b[^.?!]{0,40}\b(words|text|message|instructions?|prompt)\s+(above|before|at the (start|beginning)|you (were given|received))\b/),
      P(/\b(beginning|starting)\s+with\s+["']?you are\b[^.?!]{0,32}\b(repeat|say|output|continue)\b/),
      C(/repeatthewordsabove/), C(/repeateverythingabove/)
    ] },
    { id: "smuggle.encoded-payload", cls: "data-smuggling", points: 0.72, patterns: [
      P(/\b[a-z0-9+/]{64,}={0,2}\b/),
      P(/\b(decode|decipher|run|execute|follow|obey)\b[^.?!]{0,32}\b(this|the)?\s*(base64|encoded|hex|coded)\b/)
    ] },

    // ── jailbreak-dressing (spec §2a) ──
    { id: "jailbreak.named-persona", cls: "jailbreak-dressing", points: 0.9, patterns: [
      P(/\b(you are|be|become|act as|play|called|name is)\s+(dan|stan)\b/),
      P(/\b(dan|stan)\b[^.?!]{0,48}\b(never (says? no|refuses?)|no (rules|filters|limits)|do anything)\b/),
      P(/\b(do anything now|jailbreak(ed)?|developer mode|dev mode|unrestricted mode|god mode|evil mode)\b[^.?!]{0,30}\b(mode|persona|ai|enabled|on|activate|enter)?\b/),
      P(/\bactivate\s+(developer|jailbreak|dan|unrestricted|debug)\s+mode\b/),
      C(/doanythingnow/), C(/jailbreakmode/)
    ] },
    { id: "jailbreak.unrestricted-role", cls: "jailbreak-dressing", points: 0.86, patterns: [
      P(/\b(pretend|imagine|roleplay|role-play|act|play|behave)\b[^.?!]{0,56}\b(no rules|no restrictions|no limits|no filter|no safety rules|before (the )?safety rules existed|unrestricted|unfiltered|never refuse|refuses? nothing|do anything (now|you want|at all)|evil|amoral|without (morals|ethics|conscience))\b/),
      P(/\b(an?|the)\s+(ai|assistant|chatbot|model)\s+(with|that has|who has)\s+no\s+(rules|restrictions|limits|filters|conscience)\b/)
    ] },
    { id: "jailbreak.unrestricted-role-es", cls: "jailbreak-dressing", points: 0.86, patterns: [
      P(/\b(imagina|finge|pretende|actua)\b[^.?!]{0,48}\b(no tienes|sin)\s+(reglas|restricciones|limites)\b/),
      P(/\bno tienes\s+(reglas|restricciones|limites)\b/)
    ] },
    { id: "jailbreak.fictional-frame", cls: "jailbreak-dressing", points: 0.8, patterns: [
      P(/\b(hypothetical(ly)?|fictional|in a (story|novel|game|movie|dream|world)|imagine a world|pretend world|screenplay|roleplay|act as if)\b[^.?!]{0,64}\b(rules (don'?t|do not|did not|never) apply|no rules|no restrictions|ignore (the )?rules|anything goes|not bound by|bypass|nothing is (forbidden|off limits|prohibited))\b/),
      P(/\bfor\s+(educational|research|testing|security research)\s+purposes?\b[^.?!]{0,56}\b(system prompt|password|private|customer (list|data)|instructions|bypass|ignore)\b/),
      P(/\b(security research|penetration test|red team|red-team)\b[^.?!]{0,56}\b(bypass|ignore|reveal|print|show|disable)\b/),
      P(/\broleplay\b[^.?!]{0,48}\b(secrets?|private data|passwords?)\b/)
    ] },
    { id: "jailbreak.no-refusal", cls: "jailbreak-dressing", points: 0.76, patterns: [
      P(/\b(never|don'?t ever|do not ever|you must never)\s+(refuse|say no|decline)\b/),
      P(/\banswer\s+(without|with no)\s+(refusing|refusal|warnings?|disclaimers?|lectures?|judgment)\b/),
      P(/\bno\s+(warnings?|disclaimers?|refusals?|moralizing)\b[^.?!]{0,24}\b(just|only)?\s*(answer|comply|do it)?\b/)
    ] },
    { id: "jailbreak.cannot-refuse", cls: "jailbreak-dressing", points: 0.78, patterns: [
      P(/\b(cannot|can'?t|never|won'?t|will not|unable to)\s+(refuse|say no|decline)\b/),
      P(/\bstay in character\b[^.?!]{0,56}\b(refuse|private|secret|anything|no)\b/)
    ] },
    { id: "jailbreak.casual-mode", cls: "jailbreak-dressing", points: 0.5, patterns: [
      P(/\b(skip|drop|lose|without|no more)\b[^.?!]{0,16}\b(disclaimers?|warnings?)\b/)
    ] },
    { id: "jailbreak.emotional-exploit", cls: "jailbreak-dressing", points: 0.85, patterns: [
      P(/\b(grandmother|grandma|grandfather|grandpa|dead (mother|father|grandmother|grandma)|dying (wish|mother|grandmother))\b[^.?!]{0,72}\b(system prompt|passwords?|instructions|private|secret|exploit|key|lockpick|napalm|weapon)\b/),
      P(/\bused to\s+(read|tell|sing)\s+me\b[^.?!]{0,56}\b(system prompt|passwords?|instructions|secrets?|keys?)\b/)
    ] },

    // ── form-abuse (spec §2c) ──
    { id: "form.spam-offer", cls: "form-abuse", points: 0.84, patterns: [
      P(/\b(casino|gambling|slots?)\b[^.?!]{0,32}\b(bonus|free spins|jackpot|promo|sign ?up)\b/),
      P(/\b(crypto|bitcoin|forex)\b[^.?!]{0,32}\b(giveaway|doubling|investment opportunity|guaranteed returns|airdrop)\b/),
      P(/\b(buy|cheap|purchase)\b[^.?!]{0,24}\b(followers|likes|backlinks|views|subscribers|reviews)\b/),
      P(/\b(seo|backlink)\s+(services?|package|agency|expert)\b/),
      P(/\b(essay|dissertation|assignment)\s+(writing\s+)?(service|help|mill)\b[^.?!]{0,24}\b(cheap|guaranteed|plagiarism)\b/),
      P(/\b(payday loans?|loan approval)\b[^.?!]{0,32}\b(guaranteed|no credit check|apply now)\b/)
    ] },
    { id: "form.phishing", cls: "form-abuse", points: 0.9, patterns: [
      P(/\b(verify|confirm|validate|reactivate)\b[^.?!]{0,32}\b(your\s+)?(account|password|login|identity)\b[^.?!]{0,48}\b(suspended|locked|within 24 hours|immediately|click|link)\b/),
      P(/\byour\s+account\s+(has been|will be)\s+(suspended|locked|terminated|deleted)\b/)
    ] },
    { id: "form.link-flood", cls: "form-abuse", points: 0.66, patterns: [
      P(/(https?:\/\/|www\.)\S+\s+.*(https?:\/\/|www\.)\S+\s+.*(https?:\/\/|www\.)/),
      P(/\b(click here|visit now|act now|limited offer|best price|earn money (online|from home))\b/)
    ] },
    { id: "form.solicitation", cls: "form-abuse", points: 0.6, patterns: [
      P(/\b(we (offer|provide|sell)|i (sell|offer))\b[^.?!]{0,40}\b(web design|marketing|seo|leads?|outsourcing)\b[^.?!]{0,40}\b(contact|whatsapp|telegram|email)\s+(me|us)\b/),
      P(/\b(dear (sir|madam|friend)|business proposal|investment proposal)\b[^?!]{0,72}\b(million|usd|fund|partner)\b/)
    ] },

    { id: "form.solicitation-contact", cls: "form-abuse", points: 0.78, patterns: [
      P(/\b(contact|message|dm|write)\s+(me|us)\b[^.?!]{0,24}\b(telegram|whatsapp)\b/),
      P(/\b(telegram|whatsapp)\b[^.?!]{0,32}\b(rates?|price|prices|cheap|offer|sell|services?)\b/)
    ] },
    { id: "form.link-ask", cls: "form-abuse", points: 0.45, patterns: [
      P(/\b(put|post|add|drop|place|include)\b[^.?!]{0,24}\b(two|2|three|3|multiple|several)\s+links?\b/)
    ] },

    // ── rate-swarm (spec §2d) ──
    { id: "rate.explicit-automation", cls: "rate-swarm", points: 0.88, patterns: [
      P(/\b(use|using|run|write|build|deploy)\b[^.?!]{0,32}\b(bot|script|crawler|scraper|spider|automated tool)\b[^.?!]{0,48}\b(scrapes?|crawls?|hits?|quer(?:y|ies)|asks?|requests?|collects?|checks?|polls?|monitors?)\b/),
      P(/\b(scrapes?|crawls?|harvests?|collects?)\b[^.?!]{0,36}\b(all|every|entire|whole)\b[^.?!]{0,24}\b(pages?|prices?|listings?|data|site|website|customers?|emails?)\b/),
      P(/\bmy\s+(bot|crawler|scraper)\b/),
      P(/\bmy\s+script\b[^.?!]{0,48}\b(scrape|scrapes|scraping|poll|hit|query|request|check|checks|site|page|prices?)\b/)
    ] },
    { id: "rate.high-frequency", cls: "rate-swarm", points: 0.86, patterns: [
      P(/\b(every|each)\s+(second|1\s*second|few seconds|millisecond)\b/),
      P(/\b(\d{3,}|thousands? of|a thousand|ten thousand|100\+|1000)\s*(requests?|times|messages|queries|hits|calls)\b/),
      P(/\b(flood|hammer|spam|bombard|overwhelm|ddos|drown)\b[^.?!]{0,32}\b(site|page|panel|chat|form|endpoint|server)\b/),
      P(/\b(parallel|simultaneous|concurrent)\s+(agents?|bots?|requests?|sessions?)\b/)
    ] },
    { id: "rate.evasion", cls: "rate-swarm", points: 0.74, patterns: [
      P(/\b(rotate|rotating|switch|change)\b[^.?!]{0,24}\b(ips?|ip addresses|proxies|accounts|identities)\b[^.?!]{0,40}\b(limit|block|ban|detect|avoid|evade|bypass)\b/),
      P(/\b(evade|avoid|bypass|get around|beat)\b[^.?!]{0,24}\b(rate limits?|throttling|bot detection|captcha|blocks?)\b/)
    ] },
    { id: "rate.endless-output", cls: "rate-swarm", points: 0.78, patterns: [
      P(/\b(keep (answering|generating|talking|going) forever|never stop (answering|generating|replying)|endless (answers|output|responses)|repeat (that|this|it) (forever|\d{3,} times))\b/),
      P(/\bgenerate\s+(the\s+)?(longest|maximum|max)\s+(possible\s+)?(answer|response|output|text)\b[^.?!]{0,24}\b(repeat|again|times)?\b/)
    ] }
  ];

  var REASONS = {
    "instruction-hijack": "The visitor tried to replace the assistant's instructions with their own.",
    "secret-fishing": "The visitor asked for private information, credentials, or site secrets.",
    "tool-baiting": "The visitor tried to steer the assistant into an action it should not take.",
    "data-smuggling": "The visitor tried to get private content out in a disguised or indirect form.",
    "jailbreak-dressing": "The visitor dressed a rule-breaking ask in a jailbreak or role-play setup.",
    "form-abuse": "The message matches spam, phishing, or form-abuse patterns.",
    "rate-swarm": "The conversation shows automated, repeated, or swarm-like pressure.",
    "none": "No screening concerns were found in this message."
  };

  // Class arbitration when several classes score: disguise beats the
  // underlying ask (a dressed-up secret grab IS jailbreak-dressing),
  // transformation beats plain fishing, repetition beats content.
  var PRIORITY = [
    "data-smuggling", "jailbreak-dressing", "instruction-hijack",
    "secret-fishing", "tool-baiting", "rate-swarm", "form-abuse"
  ];

  function combine(points) {
    var miss = 1;
    for (var i = 0; i < points.length; i++) miss *= (1 - points[i]);
    return Math.min(0.98, 1 - miss);
  }

  function structuralSignals(norm, visitorTurns, surface) {
    var fired = [];
    var allText = norm.raw;
    var urls = (allText.match(/https?:\/\/|www\./g) || []).length;
    if (urls >= 3) {
      fired.push({ id: "form.link-flood", cls: "form-abuse", points: 0.66 });
    } else if (urls === 2 && surface === "form") {
      fired.push({ id: "form.link-flood", cls: "form-abuse", points: 0.45 });
    }
    // Repetition: the same visitor turn, normalized, again and again.
    var counts = {};
    var maxRepeat = 0;
    visitorTurns.forEach(function (t) {
      var key = normalizeText(t).compact;
      if (key.length >= 12) {
        counts[key] = (counts[key] || 0) + 1;
        if (counts[key] > maxRepeat) maxRepeat = counts[key];
      }
    });
    if (maxRepeat >= 6) {
      fired.push({ id: "rate.repetition", cls: "rate-swarm", points: 0.84 });
    } else if (maxRepeat >= 4) {
      fired.push({ id: "rate.repetition", cls: "rate-swarm", points: 0.62 });
    } else if (maxRepeat === 3) {
      fired.push({ id: "rate.repetition", cls: "rate-swarm", points: 0.55 });
    }
    // Keyboard mash: many words carrying long consonant clusters.
    if ((surface === "form" || surface === "sign-in") && norm.words.length >= 3) {
      var clusters = norm.words.filter(function (w) {
        return w.length >= 4 && /[bcdfghjklmnpqrstvwxz]{4,}/.test(w);
      }).length;
      if (clusters >= 3 && clusters / norm.words.length >= 0.4) {
        fired.push({ id: "form.gibberish", cls: "form-abuse", points: 0.8 });
      }
    }
    // Gibberish / keyboard mash on form-like surfaces.
    var words = norm.words;
    if ((surface === "form" || surface === "sign-in") && words.length >= 4) {
      var vowelish = words.filter(function (w) { return /[aeiouy]/.test(w); }).length;
      if (vowelish / words.length < 0.35) {
        fired.push({ id: "form.gibberish", cls: "form-abuse", points: 0.52 });
      }
    }
    // Spaced base64 chunks with an instruction to decode/follow them.
    if (/(?:[a-z0-9+/]{5,}\s+){3,}[a-z0-9+/]{4,}={1,2}/.test(norm.raw) &&
        /\b(decode|decipher|follow|obey|execute|run)\b/.test(norm.raw)) {
      fired.push({ id: "smuggle.encoded-payload", cls: "data-smuggling", points: 0.6 });
    }
    // Many encoded-looking tokens ending in padding, with an
    // instruction to decode or follow them.
    var b64Tokens = norm.raw.split(/[^a-z0-9+/]+/).filter(function (w) {
      return w.length >= 6;
    }).length;
    if (b64Tokens >= 5 && /=/.test(norm.raw) &&
        /\b(decode|decipher|follow|obey|execute|run)\b/.test(norm.raw)) {
      fired.push({ id: "smuggle.encoded-payload", cls: "data-smuggling", points: 0.62 });
    }
    // One very long encoded-looking token.
    if (/\b[a-z0-9+/]{64,}={0,2}\b/.test(norm.raw)) {
      fired.push({ id: "smuggle.encoded-payload", cls: "data-smuggling", points: 0.55 });
    }
    return fired;
  }

  function screen(request) {
    if (!request || request.kind !== "screen" || !request.input) {
      throw new Error("guard engine: a contract screen request is required");
    }
    var visitorTurns = [request.input.text];
    (request.input.conversation || []).forEach(function (turn) {
      if (turn && turn.role === "visitor" && typeof turn.text === "string") {
        visitorTurns.push(turn.text);
      }
    });
    var joined = visitorTurns.join("\n");
    var norm = normalizeText(joined);
    var haystacks = [norm.raw, norm.deleet];
    var compactHay = [norm.compact];

    var fired = [];
    RULES.forEach(function (rule) {
      var hit = rule.patterns.some(function (p) {
        return p.on === "compact"
          ? p.re.test(compactHay[0])
          : anyMatch(haystacks, [p.re]);
      });
      if (hit) fired.push({ id: rule.id, cls: rule.cls, points: rule.points });
    });
    fired = fired.concat(structuralSignals(norm, visitorTurns, request.surface));

    var byClass = {};
    fired.forEach(function (f) {
      (byClass[f.cls] = byClass[f.cls] || []).push(f.points);
    });
    var scores = {};
    Object.keys(byClass).forEach(function (cls) {
      scores[cls] = Math.round(combine(byClass[cls]) * 1000) / 1000;
    });

    var bestClass = "none";
    var bestScore = 0;
    PRIORITY.forEach(function (cls) {
      var sc = scores[cls] || 0;
      if (sc > bestScore) { bestClass = cls; bestScore = sc; }
    });
    // Disguise arbitration: when a dressing rule fired, the dressed
    // class owns the verdict unless the plain ask vastly outscores
    // it; same for transformation over plain fishing.
    var firedIds = {};
    fired.forEach(function (f) { firedIds[f.id] = true; });
    var dressed = fired.some(function (f) {
      return f.cls === "jailbreak-dressing" && f.id !== "jailbreak.casual-mode";
    });
    var transformed = fired.some(function (f) { return f.cls === "data-smuggling"; });
    if (dressed && (scores["jailbreak-dressing"] || 0) >= FLAG_THRESHOLD &&
        (scores["jailbreak-dressing"] || 0) >= bestScore - 0.28) {
      bestClass = "jailbreak-dressing";
      bestScore = scores["jailbreak-dressing"];
    } else if (transformed && (scores["data-smuggling"] || 0) >= FLAG_THRESHOLD &&
        (scores["data-smuggling"] || 0) >= bestScore - 0.14) {
      bestClass = "data-smuggling";
      bestScore = scores["data-smuggling"];
    }

    var verdict = bestScore >= BLOCK_THRESHOLD ? "block"
      : bestScore >= FLAG_THRESHOLD ? "flag" : "allow";
    if (verdict === "allow") { bestClass = "none"; }

    var ruleIds = fired
      .filter(function (f) { return verdict !== "allow" && f.cls === bestClass; })
      .map(function (f) { return f.id; });
    if (verdict !== "allow" && ruleIds.length === 0) {
      ruleIds = fired.map(function (f) { return f.id; });
    }

    return {
      contract: CONTRACT_VERSION,
      kind: "screen",
      requestId: request.requestId,
      verdict: verdict,
      class: bestClass,
      score: verdict === "allow" ? Math.round(bestScore * 1000) / 1000 : bestScore,
      reason: REASONS[bestClass],
      ruleIds: ruleIds,
      scoresByClass: scores
    };
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    BLOCK_THRESHOLD: BLOCK_THRESHOLD,
    FLAG_THRESHOLD: FLAG_THRESHOLD,
    RULES: RULES.map(function (r) {
      return { id: r.id, cls: r.cls, points: r.points };
    }),
    screen: screen,
    evaluate: screen,
    normalizeText: normalizeText
  };
});
