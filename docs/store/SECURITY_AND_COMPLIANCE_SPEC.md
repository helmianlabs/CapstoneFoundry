# Security, AI Swarm Defense & App Store Compliance Specification

**Document Version:** 1.0.0  
**Effective Date:** November 6, 2026  
**Operator:** DairyForge LLC  
**Product:** Capstone Foundry / ThinkinBuddy  
**Bundle ID:** `com.capstonefoundry.app`  
**Production URL:** `https://thinkbuddy-sandy.vercel.app`

---

## 1. Executive Summary & Legal Framework

Capstone Foundry is an autonomous multimodal AI companion engineered for lifelong learning, creative generation, voice-native interaction, and project execution. Built for users of all ages—including families, students, and children—the system enforces a defense-in-depth security posture designed to prevent:

1. **Adversarial Prompt Injections & Jailbreaks:** Neutralizes attempts to bypass safety guardrails or subvert agent personas.
2. **AI Bot Swarms & DDoS Flooding:** Throttles automated bot swarms, scraping tools, and denial-of-service floods using sliding-window rate limiters and bot signature detection.
3. **Predatory Child Grooming & Exploitation:** Proactively intercepts attempts by malicious bots or actors to harvest children's personal information, isolate them from parents, or bypass household rules.
4. **Regulatory Non-Compliance:** Fully complies with **COPPA** (Children's Online Privacy Protection Act), **Apple App Store Review Guidelines** (Guidelines 1.2, 1.4, 5.1), and the **Google Play Families & Generative AI Policies**.

---

## 2. Multi-Layered Defense Architecture

```
                       INCOMING REQUEST (Mobile / Web / Voice)
                                       │
                                       ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ LAYER 1: NETWORK & AI SWARM DEFENSE (lib/swarmDefense.js)               │
  │ • Burst Throttling: Max 15 req / 5 sec (Stops bot swarm floods)        │
  │ • Sustained Throttling: Max 60 req / 60 sec per IP / Tenant            │
  │ • Bot Signature Filter: Blocks automated scrapers (curl, python, etc.) │
  │ • HTTP 429 + Retry-After Header enforcement                            │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ LAYER 2: IDENTITY & ACCESS GATEWAY (lib/security.js, lib/tenant.js)    │
  │ • Browser CORS Allowlist: Blocks cross-origin browser spoofing         │
  │ • Server-to-Server Webhook Secret: 256-bit constant-time secret check  │
  │ • Tenant Isolation: Cryptographic session token (scrypt)               │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ LAYER 3: ADVERSARIAL INJECTION & CHILD SHIELD (lib/injectionDefense.js)│
  │ • Prompt Injection Filter: Blocks "Ignore instructions", "DAN", etc.  │
  │ • System Prompt Exfiltration Shield: Refuses secret disclosure         │
  │ • Predatory Grooming Interceptor: Blocks child isolation & secrets     │
  │ • PII Scrubbing: Redacts phone numbers, SSNs, cards, physical addresses│
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ LAYER 4: CONTENT MODERATION (lib/moderation.js, OpenAI Moderation API) │
  │ • Real-time Multimodal Input/Output Screening                          │
  │ • FAIL-CLOSED Policy: Unscreened requests refused for minors           │
  │ • Zero-Tolerance: Sexual, violent, hate, self-harm, or illicit content │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ LAYER 5: IMMUTABLE SYSTEM GUARDRAILS (lib/personality.js)              │
  │ • BASE_GUARDRAILS: Non-negotiable, permanently appended               │
  │ • KID_SAFETY_CORE: Automated for minors (< 13) & PIN-protected mode    │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Apple App Store Review Guidelines Compliance Matrix

### Guideline 1.2 — User-Generated Content & Generative AI
* **Real-Time Input & Output Moderation:** All generated media, chats, and speech prompts are screened through OpenAI Moderation API (`omni-moderation-latest`).
* **Fail-Closed Policy for Minors:** Whenever `safetyMode` is active or a minor age band is detected, any moderation timeout, API hiccup, or missing key results in an immediate **refusal**, never a permissive pass.
* **In-App Reporting Mechanism:** Built directly into the lightbox viewer (`galleryLbReportEl`) via `/api/safety-report`. Users can flag any objectionable content with one tap.
* **Account Deletion & Content Wipe:** Users can delete their account at any time (`api/auth/delete-account`). Deletion executes a cryptographically authenticated `DELETE CASCADE` across all tenant memory, creations, profiles, and filings in Neon PostgreSQL.

### Guideline 1.4 — Physical Harm & Child Protection
* **Immutable Child Safety Core:** When a minor age band is selected, the `KID_SAFETY_CORE` prompt block is hardcoded into the LLM context. It explicitly forbids:
  - Romantic or sexual dialogue.
  - Personal information collection (names, addresses, schools, passwords).
  - Unsupervised offline meetings or commercial transactions.
  - Discussion of self-harm, weapons, violence, or dangerous activities.
* **Parental Lock:** Disabling Safety Mode requires a 4-digit Parent PIN, stored as a salted cryptographic hash (`scryptSync`) with timing-safe comparison (`timingSafeEqual`). A child cannot alter safety settings.

### Guideline 5.1 — Privacy, Data Use & COPPA
* **Zero Third-Party Advertising:** The application contains zero ad SDKs, zero tracking pixels, and zero analytics frameworks that harvest behavioral data.
* **Data Minimization:** No GPS location tracking, no contact book access, no microphone background recording.
* **No Sale of Data:** Personal information and conversation transcripts are never sold or shared with data brokers.

---

## 4. Google Play Store Policy Compliance Matrix

### Google Play Families Policy (Target Audience and Content)
* **COPPA Safe Harbor Compliance:**
  - Children under 13 are classified into minor safety profiles (`isMinorAgeBand`).
  - No behavioral targeting, no persistent device fingerprinting.
  - Automated regex scrubbers (`sanitizeChildPII`) strip phone numbers, physical addresses, and financial numbers from conversation context.
* **Neutral Age Screening:** The app uses an unbiased age-band selector during onboarding (`foundational`, `intermediate`, `teen`, `adult`). Minor tiers default to strict safety locks.

### Google Play Generative AI Policy
* **Adversarial Jailbreak Immunity:** Tested and verified against common jailbreak taxonomies (e.g., Do-Anything-Now / DAN, instruction inversion, hypothetical evasion, cognitive reframing).
* **System Prompt Protection:** The agent's base system prompt is isolated from caller inspection; prompt exfiltration attacks return neutral refusal strings.
* **Automated Bot Swarm Throttling:** Rapid script floods attempting to weaponize generative endpoints against kids or server infrastructure are met with HTTP 429 Too Many Requests.

---

## 5. Technical Verification & Test Coverage

The following test suites verify and guarantee our safety and anti-abuse mechanisms in continuous integration:

| Test Suite | File | Coverage |
| :--- | :--- | :--- |
| **Swarm & Injection Defense** | `test/swarm-injection-defense.test.mjs` | Prompt injection, jailbreak attempts, predatory grooming patterns, PII regex scrubbers, burst rate limits (15/5s), sustained limits (60/60s), bot user-agents. |
| **Child Safety Decision Matrix** | `test/safety.test.mjs` | Minor age-band classification, fail-closed moderation, immutable guardrail appending, parent PIN scrypt hashing. |
| **Profile Safety Handlers** | `test/profile-safety-handlers.test.mjs` | End-to-end handler enforcement of child safety across image, video, and chat endpoints. |
| **Store Readiness Sweep** | `test/store-prep.test.mjs` | Account deletion verification, legal reporting hooks, and cross-platform Capacitor compliance. |

---

## 6. Incident Response & Safety Contact

DairyForge LLC maintains a 24-hour review process for flagged media and safety alerts:
* **Legal Contact:** DairyForge LLC, 303 E 6th St, Shoshone, ID 83352
* **Safety & Support Email:** `support@capstonefoundry.helmian.cloud`
* **Abuse Reporting Endpoint:** `POST https://thinkbuddy-sandy.vercel.app/api/safety-report`
