# Capstone Foundry rename — inventory and punch list

The product name is **Capstone Foundry**. **Mark** stays the persona.
This file records what a repo-wide search found for ThinkinBuddy, Thinking
Buddy, ThinkBuddy, thinkinbuddy, thinkbuddy, Jarvis, and jarvis, what this
change updated, and what must wait.

Searched 2026-11-06. **Jarvis / jarvis: no hits.** **Thinking Buddy:** only
the historical spec `docs/persistent-memory-spec-2026-05-27.md`.

## Already correct (left untouched)

| Surface | Current value |
|---|---|
| npm package | `capstonefoundry` |
| Capacitor `appId` | `com.capstonefoundry.app` |
| Android `applicationId` / `namespace` | `com.capstonefoundry.app` |
| Android `app_name` / `title_activity_main` | Capstone Foundry |
| iOS `PRODUCT_BUNDLE_IDENTIFIER` | `com.capstonefoundry.app` |
| iOS `CFBundleDisplayName` | Capstone Foundry |
| iOS microphone string | Capstone Foundry |
| PWA `public/manifest.json` name | Capstone Foundry |
| `index.html` title, consent, share, lock-screen album | Capstone Foundry |
| `desktop.html` title | Capstone Foundry — Desktop |
| README, PITCH, store listing copy | Capstone Foundry |
| ElevenLabs agent display name | already Capstone Foundry (not changed here; no API call) |

The iOS Xcode target is still named `App` (`PRODUCT_NAME = $(TARGET_NAME)`).
That is the Capacitor scheme name the iOS workflow builds. It is not the
name on the home screen. Do not rename the target to chase the product name.

## Changed in this pass (safe)

User-facing or operator-facing product strings, comments, and docs.
No URL, storage key, blob prefix, database name, bundle id, webhook
resource name, or CORS origin was edited.

- Fallback buddy label and console error in `script.js` (the localStorage
  key is unchanged).
- `create-agent.js` display name, prompt opener, and first message.
  The script was not run. It creates a new agent if someone runs it;
  it no longer would name that agent ThinkinBuddy. The persona in the
  opener is Mark.
- `scripts/setup-postcall-webhook-and-rename.mjs` display-name target.
  The script was not run. It PATCHes the live agent if someone runs it.
  An older copy wrote `ThinkinBuddy`, which would have undone the live
  name. The webhook lookup name `thinkinbuddy-conversation-log` and the
  URL `https://thinkbuddy-sandy.vercel.app/api/conversation-webhook` stay.
- License "Licensed Work" is Capstone Foundry, with "(formerly ThinkinBuddy)"
  kept so the grant still names the work it always covered. Change Date
  and the rest of the BSL terms are unchanged.
- `.env.example` header.
- File-header comments and SQL comments that described the product.
- Curriculum honesty line in `docs/knowledge-base/` ("Capstone Foundry is
  tutoring, not an accredited school"). The hosted ElevenLabs Knowledge
  Base is a separate copy. See the punch list.
- Current operator sheets: `docs/store/PROVIDER_TEST_CONNECTIONS.md`,
  `docs/store/REQUESTS_DESK.md`, `docs/TOOL_AUTH_ROLLOUT.md` prose,
  `docs/elevenlabs-template/agent-config.md` title.
- iOS workflow comment, artifact names, archive path, and the local
  filename the runner writes the provisioning profile to. Bundle id is
  unchanged. Those names exist only inside the GitHub Actions job.
- Repo-relative paths in `scribe/` that still said `thinkinbuddy/api/mcp.js`.
  The handler is `server/handlers/mcp.js` (`pushToDocs`). The Vercel
  project name `thinkbuddy` in that doc is unchanged.
- Historical docs gained a one-line banner. Their old names and URLs
  stay, because they record what was true on that day.

## Must keep (compatibility)

Changing these breaks signed-in browsers, stored media, webhooks, or the
native shell.

### Production URL — do not cut over in a rename PR

- Capacitor `server.url` (and the generated copies under `ios/` and
  `android/`): `https://thinkbuddy-sandy.vercel.app`
- `lib/mailer.js` `DEFAULT_BASE_URL` (password-reset links)
- `lib/llm.js` User-Agent contact URL
- `server/handlers/relay-proxy.js` default relay URL
- `scripts/update-agent-config.mjs` default app base
- Post-call webhook URL in `scripts/setup-postcall-webhook-and-rename.mjs`

`README_CAPACITOR.md` and `docs/store/STORE_LISTING.md` name that host
on purpose. The listing's public marketing URLs are already
`https://capstonefoundry.helmian.cloud`.

### Old host still on the allowlist

`https://thinkinbuddy.vercel.app` remains in `lib/security.js`
`DEFAULT_ALLOWED_ORIGINS`, next to `thinkbuddy-sandy`. Removing it
closes the door on any browser still opened there. OAuth redirect
docs in `docs/ACTIONABLE_SETUP.md` and the comment in
`server/handlers/actionable-oauth-callback.js` still name that host
because that is the registered redirect. Probes in
`docs/TOOL_AUTH_ROLLOUT.md` are a dated record of a live curl.

Reported separately: `thinkinbuddy.vercel.app` has been answering
402. This repo does not change DNS, Vercel project settings, or that
deployment.

### Browser storage and in-page names

Existing installs already wrote these keys. A rename without a
dual-read drops the signed-in user, history, voice choice, and mode.

- `thinkinbuddy_user_id`, `thinkinbuddy_user_name`, `thinkinbuddy_buddy_name`
- `thinkinbuddy_mode_v1`, `thinkinbuddy_direct_voice_v1`
- `thinkbuddy_user_v1`, `thinkbuddy_history_v1`, `thinkbuddy_bgaudio_v1`
- `thinkbuddy_keys_v1`, `thinkbuddy_brain_v1`, `thinkbuddy_brain_model_v1`
- `thinkbuddy_el_voice_v1`
- Custom events `thinkinbuddy:call-connected`, `thinkinbuddy:turn`,
  `thinkinbuddy:call-ended`
- `window.thinkinBuddyApiFetch`, `window.thinkinBuddyMode`,
  `window.thinkinBuddyAudio`
- In-page function `sendToThinkinBuddy` (tests slice the source on this
  name; it is not shown in the UI)

### Stored data prefixes and ids

- Blob prefixes `thinkinbuddy/images/`, `thinkinbuddy/videos/`, and the
  one-off script prefix `thinkinbuddy/memory/troy/`. Existing objects
  live under those keys. Tests assert the prefixes.
- Neon database name `thinkinbuddy_memory` in the maintenance scripts.
  The connection string is built by swapping the database name. A
  string replace here points the scripts at a database that does not
  exist.
- Research-log kind `thinkinbuddy-research-session-metadata`
  (`server/handlers/research-log.js`). That string is stored data.
- Webhook resource name `thinkinbuddy-conversation-log`. The lookup
  uses it to avoid creating a second webhook.
- Machine paths under `C:/Users/troyh/n8n_Pod_Uploader_thinkinbuddy/`
  and `~/workspace/thinkinbuddy-launch/` in scripts and comments.
  Those are Troy's disks, not product copy.

### Historical records

Left as written, with a banner where the file could be mistaken for
current branding:

- `docs/persistent-memory-spec-2026-05-27.md`
- `docs/ELEVENLABS_MIGRATE_MAPPING.md`
- `docs/ELEVENLABS_MIGRATE_TROY_CHECKLIST.md`
- `docs/SANDY_ENV_CHECKLIST.md` (Vercel project `thinkbuddy`, Neon
  project `thinkinbuddy`)
- `docs/ACTIONABLE_SETUP.md` (redirect URLs)
- `docs/store/STATUS.md` (dated bite log, including the old bundle id
  `com.helmianlabs.thinkinbuddy` that was true at that commit)
- Troy's quoted request, kept verbatim: "set ThinkinBuddy up just like
  Spotify." (`lib/pocket-mode.js`, `index.html`)

Test inputs that pass `buddyName: 'ThinkinBuddy'` are a user-chosen
buddy name in a fixture, not the product title. They were left alone.

## Punch list — not done, and why

Do these in the order below. None of them belong in a string-replace PR.

1. **Keep serving `https://thinkbuddy-sandy.vercel.app`.**
   Capacitor shells in the wild load that URL. A new host has to serve
   the same app before any shell is pointed at it, and the old host
   has to stay up until those shells are updated.

2. **Pick the app hostname and prove DNS plus the certificate.**
   Marketing already uses `capstonefoundry.helmian.cloud`. That is not
   the Capacitor server URL. Decide whether the app moves there or to
   another name. Do not rename the Vercel project until the custom
   domain is the URL the shell loads. Renaming the Vercel project
   `thinkbuddy` changes the default `*.vercel.app` host.

3. **CORS before clients.** Add the new origin to `ALLOWED_ORIGINS`
   and to `DEFAULT_ALLOWED_ORIGINS` in `lib/security.js`. Ship that
   before any page on the new origin calls the API. Leave both old
   origins in the list until nothing uses them.

4. **ElevenLabs tools.** Live tool URLs and the post-call webhook are
   hardcoded at ElevenLabs to `https://thinkbuddy-sandy.vercel.app`
   (see `docs/ELEVENLABS_MIGRATE_MAPPING.md` and
   `scripts/update-agent-config.mjs`). Update those in the ElevenLabs
   dashboard, or by deliberately running the update script with the
   new base URL, in the same change that the server starts answering
   there. Do not delete the old agent. The display name is already
   Capstone Foundry; this punch item is the tool hosts, not the name.
   Re-check the hosted Knowledge Base honesty line. The repo copies
   now say Capstone Foundry. The copy attached to the agent does not
   change until someone uploads it.

5. **OAuth redirects.** Google, Todoist, and Notion redirects
   documented in `docs/ACTIONABLE_SETUP.md` use
   `https://thinkinbuddy.vercel.app`. Add the new redirect at each
   provider, then change the env vars. Do not delete the old redirect
   until those providers have accepted the new one.

6. **Native shell cutover, as a store release.** Change
   `capacitor.config.ts` `server.url`, run `npx cap sync`, and ship a
   new Android/iOS binary. Old installs keep the previous URL until
   the user updates. `applicationId` / bundle id stay
   `com.capstonefoundry.app`.

7. **Vercel project rename (`thinkbuddy`) — follow-up, not this PR.**
   Do it only after step 2. Confirm the team
   (`dairyforge1-6376s-projects` in the env checklist) and that
   production Git is `helmianlabs/CapstoneFoundry`. A project rename
   is reversible only with care, and it is the thing most likely to
   take the Capacitor URL offline.

8. **Neon project name `thinkinbuddy` — follow-up, not this PR.**
   Confirm whether a project rename changes the connection host
   before doing it. The database name `thinkinbuddy_memory` is a
   separate migration: create or rename with Neon, point
   `DATABASE_URL_MEMORY` at it, then update the scripts that swap
   `/neondb` for `/thinkinbuddy_memory`. Do not edit those scripts
   first.

9. **Blob prefix move.** Copy objects from `thinkinbuddy/images/` and
   `thinkinbuddy/videos/` to a new prefix, teach the readers to check
   both, then stop writing the old prefix. A search-replace strands
   every image and video already saved.

10. **localStorage dual-read.** A later release can read the old key
    and write a new one. Dropping the old key in the same release
    signs everyone out and clears history on that device.

11. **`thinkinbuddy.vercel.app` 402.** Separate from naming. Find out
    whether that deployment is paused, unpaid, or intentionally
    retired. Do not delete it until OAuth redirects and any leftover
    clients have moved. Do not delete old GitHub repos or old
    ElevenLabs agents as part of the name cleanup.

12. **Play Console / App Store listing, if a draft was typed there
    by hand.** The repo's `docs/store/STORE_LISTING.md` already says
    Capstone Foundry and is still a draft. This pass cannot see the
    Play Console or App Store Connect record. If a listing was saved
    there under ThinkinBuddy, that text is outside the repo.

13. **Do not run** `create-agent.js` or
    `scripts/setup-postcall-webhook-and-rename.mjs` to "finish" the
    rename. The first creates another agent. The second PATCHes the
    live agent and can rotate webhook wiring. The display name is
    already correct on the live agent.
