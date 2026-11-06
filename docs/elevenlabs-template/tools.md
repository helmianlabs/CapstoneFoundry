# ElevenLabs Agent — Custom Tools (Webhook Config Template)

Exported from the live agent's Tools tab. Each of these is a "Webhook" type
custom tool in ElevenLabs pointing at a matching `/api/*.js` route in this
repo. **Replace `YOUR-DEPLOYMENT-URL` with your own Vercel deployment**, and
set `WEBHOOK_SECRET` in ElevenLabs' per-tool "Secret" / header config to
match your `.env`'s `WEBHOOK_SECRET`. Image and video routes call
`requireWebhookSecret` first (`lib/security.js`). `save_memory` and
`recall_memory` require the same header through `authorizeMemoryAccess`
(`lib/tenant.js`) and do not treat `userId` as a credential. Search and
browse still follow the `ENFORCE_TOOL_AUTH` rollout.

## Identity binding contract (safety wiring bite 4)

Every identity-bearing tool MUST carry the caller's identity the same way:

- Request-body property: **`userId`** (string)
- **Required:** yes — listed in the tool's `request_body_schema.required`
- Bound to the dynamic variable: **`{{user_id}}`** (the per-session value
  `index.html` sets from the signed-in tenant; the model never supplies it)
- **No safety field is ever required from the model** — no `safetyMode`,
  no `ageBand`. Safety is decided server-side from the tenant profile
  keyed by this `userId`, never from tool-call arguments.

`scripts/update-agent-config.mjs` enforces this contract on the live
agent: it patches every referenced identity-bearing tool that lacks the
binding and its verification pass fails if any target tool is missing,
unbound, or unreferenced. Whether the currently deployed agent's tool
schemas match this contract is **UNVERIFIED** until that script is run
and read back under a separate authorization.

| Tool name | Endpoint | Source | `userId ← {{user_id}}` binding |
|---|---|---|---|
| `save_memory` | `https://YOUR-DEPLOYMENT-URL/api/memory` | `api/memory.js` | **Required** |
| `generate_image` | `https://YOUR-DEPLOYMENT-URL/api/image` | `api/image.js` (OpenAI gpt-image-2) | **Required** |
| `browse_url` | `https://YOUR-DEPLOYMENT-URL/api/browse` | `api/browse.js` | **Required** — handler resolves the tenant from this userId and applies the profile safety decision (joined in safety wiring bite 7) |
| `search_web` | `https://YOUR-DEPLOYMENT-URL/api/search` | `api/search.js` | **Required** — handler resolves the tenant from this userId and applies the profile safety decision (joined in safety wiring bite 7) |
| `save_task_for_clyde` | `https://YOUR-DEPLOYMENT-URL/api/task` | `api/task.js` | **Required** — `userId` selects the tenant only after `X-Webhook-Secret` matches; a bare UUID is not a credential |
| `generate_video_runway` | `https://YOUR-DEPLOYMENT-URL/api/video-runway` | `api/video-runway.js` (Runway gen4_turbo, image→video) | **Required** |
| `generate_video` | `https://YOUR-DEPLOYMENT-URL/api/video` | `api/video.js` (composite — OpenAI gpt-image-2 start frame → Runway gen4_turbo image→video) | **Required** |
| `generate_video_veo` | `https://YOUR-DEPLOYMENT-URL/api/video-runway-veo` | `api/video-runway-veo.js` (Runway-hosted Veo 3 — `veo3` text→video on Runway's key and meter) | **Required** |
| `generate_image_gemini` | `https://YOUR-DEPLOYMENT-URL/api/image-gemini` | `api/image-gemini.js` (Google Gemini image — gemini-3.1-flash-image; replaced the retired Imagen route) | **Required** |
| `generate_video_omni` | `https://YOUR-DEPLOYMENT-URL/api/video-omni` | `api/video-omni.js` (Google Gemini Omni Flash — gemini-omni-1.1-flash via the Interactions API; text→video, model-chosen 3–10s clips at 720p, metered at the 10s documented maximum) | **Required** |
| `generate_video_higgsfield` | `https://YOUR-DEPLOYMENT-URL/api/video-higgsfield` | `api/video-higgsfield.js` (Higgsfield — Kling 2.5 Turbo Pro text→video at 1080p; 5s or 10s clips, metered on the dedicated video_higgsfield rate fitted to that workflow's list price; the route ships this one workflow only) | **Required** |
| `generate_video_heygen` | `https://YOUR-DEPLOYMENT-URL/api/video-heygen` | `api/video-heygen.js` (HeyGen avatar talking-head video — the prompt is the script the avatar says) | **Required** |
| `generate_image_flux` | `https://YOUR-DEPLOYMENT-URL/api/image-flux` | `api/image-flux.js` (Replicate Flux) | **Required** |
| `set_alarm` | `https://YOUR-DEPLOYMENT-URL/api/alarm` | `api/alarm.js` | **Required** |

Plus `recall_memory` (semantic recall over saved facts, `api/recall-memory.js`)
— **Required** `userId ← {{user_id}}` binding — created programmatically by
`scripts/update-agent-config.mjs`, which is the recommended way to
(re)provision this tool set against your own agent via the ElevenLabs API
rather than clicking through the UI for each one.

The composite/Veo/HeyGen media handlers (`/api/video`,
`/api/video-runway-veo`, `/api/video-heygen`) carry rows in the table
above: their handlers consume the same `userId` identity server-side
and store under the resolved tenant, so their tools carry the same
**Required** binding in this template. Two honesty notes: (1)
`scripts/update-agent-config.mjs`'s `IDENTITY_TOOL_DEFINITIONS` DOES
include these three tools (and `generate_image_gemini`,
`generate_video_omni`, `generate_video_higgsfield`) — extended in
bite D2 — so the script enforces their binding, and
`test/agent-tool-identity.test.mjs` pins the definition set to this
table's Required rows so the two cannot drift apart again; (2)
whether the deployed agent's tools match this template —
names and bindings alike — is **UNVERIFIED** until a dashboard
readback under separate authorization.

## Built-in ElevenLabs system tools (toggle in the Agent → Tools tab)

`End conversation` and `Detect language` were enabled on the live agent.
`Skip turn`, `Update state`, `Transfer to agent`, `Transfer to number`,
`Play keypad touch tone`, and `Voicemail detection` are available but were
not enabled — turn on whichever your use case needs.

## Auth model (why two different gates exist)

- **Browser → API** (chat.js, the signed-in memory briefing):
  CORS allowlist via `ALLOWED_ORIGINS`, enforced by
  `applyBrowserCors()` in `lib/security.js`, is not authentication.
  `/api/memory` reads and `/api/recall-memory` from a signed-in client
  require `Authorization: Bearer <session>` for that tenant
  (`authorizeMemoryAccess` in `lib/tenant.js`). A `userId` UUID only
  repeats the session tenant.
- **ElevenLabs → API** (every tool above): no browser Origin header exists
  server-to-server, so these are gated by a shared-secret header
  (`X-Webhook-Secret` matching `WEBHOOK_SECRET`) via `requireWebhookSecret()`
  in the same file. `save_memory` and `recall_memory` require that header
  even when `ENFORCE_TOOL_AUTH` is unset; the body `userId` then selects
  the tenant and does not authorize the call. Image and video routes
  already use the same header. Search and browse still follow the
  `ENFORCE_TOOL_AUTH` rollout in `docs/TOOL_AUTH_ROLLOUT.md`. Both gates
  are closed-by-default — a missing env var locks the gated route out
  rather than silently opening it.
