# Curriculum Verification — the record-keeping method

**What this document is.** Capstone Foundry's curricula carry a written
verification record: one file per curriculum, kept in
`docs/knowledge-base/verification/` in this repo, next to the map of the
Knowledge Base itself (`docs/knowledge-base/README.md`). This document is
the method those records follow — what a record states, in what words, and
what may never be written in one.

**The governing rule: a record documents what was actually done.** A
verification record is evidence, not ceremony. It states the method that
was really used to build the curriculum, the sources the finished text
really names, and the checks that were really run against the finished
text. A method that was not used is never written down as if it had been;
a check that has not been run yet is recorded as deferred, with the reason,
never backfilled from imagination and never backdated. There is no review
board and no automated approver in this system: the record is the trail,
and its value is exactly its honesty.

---

## The method of record for Troy-built curricula

The curricula Troy builds are built — and thereby checked — by his
cross-AI method:

1. **Four independent drafts.** Claude AI, ChatGPT, Grok, and Gemini each
   independently write the full curriculum for the subject — researched,
   roughly 10,000 words apiece. Four separate models, working from the
   subject independently, do not share one another's errors.
2. **The merge.** All four drafts are fed into Claude AI, which compares
   them, takes the best of each, and merges them into the single master
   text. Disagreements between four independent drafts surface at the
   merge; what survives is what four routes converged on or what the merge
   judged best.
3. **The record.** The finished text ships under the *Sharp Minds Master*
   framework in the ElevenLabs Knowledge Base, and its record in
   `verification/` states this method as its build method (field (a)
   below).

That is the whole of it: the build method **is** the verification for
curricula built this way — four independent drafts plus a comparative
merge — and the record says so in those words. When a future curriculum is
built by a different method (a single drafter, a human author, a different
combination), its record states the method actually used, in the same
field, with the same plainness. The record follows the work; the work is
never dressed up to fit the record.

## What every record states

One record per curriculum, `docs/knowledge-base/verification/<slug>.md`,
with these fields:

- **Curriculum** — the exact Knowledge Base document title it ships as,
  its claimed audience (the age band in the title), and its status in the
  request vocabulary of `lib/requests.js` (`new` / `listed` / `building` /
  `verifying` / `shipped` / `not_planned` — requester labels: Received /
  On the list / Being built / In verification / Added / Not planned).
- **(a) Build method** — the method actually used. For Troy-built
  curricula: the four-AI independent draft + merge, naming the four AIs
  (Claude AI, ChatGPT, Grok, Gemini) and the merging pass (Claude AI),
  and the builder's name.
- **(b) Sources** — the sources named in the merged text itself: named
  works (title, author/publisher, edition/year, or URL), never "the
  internet". Every lesson's factual load must be traceable to an entry in
  this list. Request-supplied trusted-materials links are candidate
  sources, not automatic ones — they join this list only if the merged
  text actually used them.
- **(c) Age-fit** — the check of the finished text against
  `BASE_GUARDRAILS` and `KID_SAFETY_CORE` (`lib/personality.js`) and the
  minor-band semantics of `lib/safety.js`, run for the **youngest band
  the curriculum claims**: reading level honestly matches the band; no
  content the safety core would refuse if a child asked for it directly;
  worked examples and scenarios appropriate to the youngest claimed
  reader. A curriculum claiming ages 6–Adult is held to the age-6
  standard, not the oldest reader's. If the text only works by assuming
  the oldest reader in its band, the band is narrowed or the document is
  split — the record states which happened.
- **(d) Standards mapping** — the real framework the curriculum aligns
  to, with the strands/domains covered, where one exists: Common Core for
  school math/ELA (or the relevant state standards where they diverge
  materially), NGSS for science, the College Board SAT domains for SAT
  material, and for college-level material the standard introductory
  course scope, named by course (alignment is claimed to a scope, never
  to a university). Where no framework applies, the record carries the
  honest line, in so many words: **No framework — enrichment**.
- **(e) The honesty line** — every record carries it, and the product
  lives by it: **Capstone Foundry is tutoring, not an accredited school.** It
  awards no credits, grades, or diplomas. The words *accredited* and
  *certified* are never claimed for the product or any curriculum until a
  body with the right to grant them has done so; until then the claim is
  the work and the paperwork, both of which anyone may ask to see.

## Deferred fields — said plainly, never filled from imagination

A field that cannot be completed yet is written as deferred, with the
reason and the event that completes it. The standing case: **the
curriculum text itself is not in this repo.** The 8 existing curricula
live only in the ElevenLabs Knowledge Base; this repo holds their titles,
sizes, and coverage notes (the 2026-08-06 export in
`docs/knowledge-base/README.md`), not their text. Fields (b), (c), and (d)
are read *from the finished text*, so for those 8 they are recorded as
deferred — "recorded from the merged text when the text is pulled into
the repo" — until the follow-on task the seed records name is done:
pulling each document's text into `docs/knowledge-base/`. The build-method
field (a) is **not** deferred for the 8: the method is a fact about how
they were built, stated by their builder, and it is recorded in full.

## How a curriculum ships (and where the record sits in it)

1. A curriculum request (or a build Troy starts himself) moves through
   the request statuses: `listed` → `building`. The record is opened when
   building starts and field (a) is filled from the work as it happens.
2. `verifying` — the record is completed from the finished text: sources
   transcribed into field (b), the age-fit check run and its outcome
   written into field (c), the mapping written into field (d). A
   curriculum request reaches `shipped` **only** from `verifying` — the
   transition guard in `lib/requests.js` enforces this in code; no
   curriculum ships with its record unopened.
3. The document is created in the ElevenLabs Knowledge Base tab and
   attached to the agent — an account-side step, done by hand, one step
   at a time. There is no API path for it in this codebase.
4. The request moves to `shipped` (**Added**). The record stays in the
   repo as the standing evidence for what is live.

## Re-verification triggers

A record reopens — and the curriculum goes back through the (b)–(d)
fields against its current text — when any of these happens: a named
source is superseded (new edition, dead link, a standard revised); a user
reports an error in the curriculum; or the safety rules it is checked
against (`BASE_GUARDRAILS`, `KID_SAFETY_CORE`) change. The reopened
record keeps its history: what changed, when, and what the re-check
found are appended, not overwritten.
