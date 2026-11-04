# Switch-over — 2026-11-04

On Troy's order, the store branch (store/bite1-tenants) was merged to main
(pull request #7, merge commit e1115e7f) and this commit triggers the first
production deployment of the merged tree.

What went live with it:
- The full store build: tenants, billing gates, safety, account deletion.
- Capstone Foundry naming throughout (repo renamed earlier).
- The AI-data consent gate (first-run checkbox naming the processors).
- In-app content reporting (client controls + server handler). Database
  migration sql/store/009_content_reports.sql was run on the hosted Neon
  database the same day and verified (table exists, empty).
- The ElevenLabs agent id swap: the app now points at the new Capstone
  Foundry ElevenLabs account (agent_9101m6kwm1sqe0ctz33pn1q7p07w), whose
  tools were verified byte-identical to the previous agent's, including
  the memory endpoints. The production post-call webhook secret in
  Vercel was updated to the new account's webhook the same day.
- Final privacy policy text and the store listing document.
- The slate app icon set (native folders).

Also fixed the same day: the Vercel project had lost its Git connection;
it was reconnected to helmianlabs/CapstoneFoundry (production branch:
main), which is why pushes had not been deploying.
