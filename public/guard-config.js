// ════════════════════════════════════════════════════════════════════
//  GUARD CONFIG — ships with every template site, OFF by default.
//
//  Guard is the site's shield (see TEMPLATE.md, item 11). This file is
//  the site's half of the switch:
//
//    enabled: false  — Guard is dormant. The embed loads, does
//                      nothing, calls nothing, changes nothing.
//    siteKey: ""     — the site's publishable Guard key. Empty until
//                      the owner takes Guard Live and a key is issued.
//                      The SECRET key never appears here — it lives
//                      only in the server env (GUARD_SECRET_KEY),
//                      exactly like the Clerk secret.
//    stance          — what happens when Guard can't produce a
//                      verdict (its route is down, an answer comes
//                      back malformed). DATA, not code (contract
//                      guard/1.0 §5): "chat" rules visitor messages,
//                      "actions" rules agent actions. The shipped
//                      defaults are chat: "open" (the site keeps
//                      working, the gap is noted in the feed) and
//                      actions: "closed" (the action doesn't happen).
//                      Changing a value here is the owner's ruling —
//                      no code changes with it.
//
//  Turning Guard Live (the full procedure is TEMPLATE.md item 11):
//  a real key here + enabled: true + the route's env set on the
//  server (GUARD_SECRET_KEY, GUARD_VERDICT_URL, and GUARD_FEED_URL
//  for the owner feed). The page half arms on enabled + key alone;
//  without the route's env every screen comes back "no verdict" and
//  the stance above decides — honest degradation, never a fake pass.
// ════════════════════════════════════════════════════════════════════
window.GUARD_CONFIG = {
  enabled: true,
  siteKey: "pk_guard_4e32d6611f7b5b00d40383ae",
  screenEndpoint: "/api/guard/screen",
  stance: { chat: "open", actions: "closed" }
};
