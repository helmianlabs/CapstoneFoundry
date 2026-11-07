# Store listing — Capstone Foundry (Store Compliance & Verification Document)

This document maps store listing copy, privacy declarations, and regulatory compliance directly to the codebase for the Apple App Store and Google Play Console.

---

## Identity & Endpoints

| Field | Production Value | Source of Truth |
|---|---|---|
| **App Name** | Capstone Foundry | `capacitor.config.ts`, `AndroidManifest.xml`, `Info.plist` |
| **Package Name / Bundle ID** | `com.capstonefoundry.app` | `capacitor.config.ts` (`appId`), `android/app/build.gradle` |
| **Primary Domain (Web)** | `https://capstonefoundry.cloud` | Production Vercel DNS + SSL |
| **Web App Route** | `https://capstonefoundry.cloud/app` | `capacitor.config.ts` (`server.url`), `vercel.json` |
| **Support URL** | `https://capstonefoundry.cloud/support` | `public/support.html`, `index.html` footer |
| **Privacy Policy URL** | `https://capstonefoundry.cloud/privacy` | `public/privacy.html`, `index.html` footer |
| **Terms of Service URL** | `https://capstonefoundry.cloud/terms` | `public/terms.html`, `index.html` footer |

---

## Listing Copy

**App Name:** Capstone Foundry

**Subtitle (Apple App Store, ≤30 characters):**
`Executive AI Pair Programmer` (29 chars)

**Short Description (Google Play, ≤80 characters):**
`From your wild thoughts, to the real world.` (42 chars — Troy's approved slogan)

**Keywords (Apple App Store, ≤100 characters):**
`executive ai,pair programming,voice ai,hands,autonomous agent,memory,code review,helmian guard`

**Full Description:**

> Capstone Foundry is an autonomous executive AI pair programmer and thinking partner designed for founders, engineers, and builders. Powered by Mark, a sub-second voice AI companion with persistent memory and hands execution, Capstone Foundry turns high-level intent into running production systems.
>
> **Sub-Second Voice Pair Programming:**
> Speak naturally. Mark listens, plans, codes, and executes in real time with ultra-low latency, studio-grade voices, and complete context awareness.
>
> **Persistent Executive Memory:**
> Never repeat yourself. Mark securely indexes past architecture decisions, tech stacks, supplier rates, and session history in an isolated, encrypted database dedicated to your tenant.
>
> **Autonomous Hands Execution:**
> Mark doesn't just suggest code — he acts. From executing test suites, drafting release notes, and managing invoices to checking server telemetry, Mark executes tasks across your workflow with explicit permission gates.
>
> **Digital Avatar & Spatial Presence:**
> Personalize your executive companion with real-time facial mesh synthesis, lip-sync, and video animation. Built in full compliance with digital likeness protections (California AB 2602 / NO FAKES Act) with affirmative consent and instant revocation.
>
> **Enterprise-Grade Helmian Guard:**
> Every instruction, prompt, and tool call is shielded by Helmian Guard. Real-time prompt injection defense, sandboxed execution, and audit logging protect your intellectual property at every layer.
>
> **Private & Uncompromised:**
> Your code, audio, and likeness belong to you. We do not sell your data, use your voice for public model training, or compromise on security. Full in-app account deletion wipes all memory and assets instantly.

---

## Store Permission Audit

### Android (`android/app/src/main/AndroidManifest.xml`)
- `android.permission.RECORD_AUDIO`: Voice session input with Mark.
- `android.permission.MODIFY_AUDIO_SETTINGS`: Low-latency audio routing.
- `android.permission.CAMERA`: Digital avatar photo and short video loop capture.
- `<uses-feature android:name="android.hardware.camera" android:required="false" />`: Ensures devices without back cameras can install the app.
- `android.permission.READ_MEDIA_IMAGES` & `READ_MEDIA_VIDEO`: Gallery picker for avatar customization.
- `android.permission.POST_NOTIFICATIONS` & `SCHEDULE_EXACT_ALARM`: Hands reminders, health checks, and scheduled alerts.

### iOS (`ios/App/App/Info.plist`)
- `NSMicrophoneUsageDescription`: "Capstone Foundry requires microphone access for real-time executive voice pair programming with Mark."
- `NSCameraUsageDescription`: "Capstone Foundry uses your camera to capture photos or short video loops for your custom digital avatar."
- `NSPhotoLibraryUsageDescription`: "Capstone Foundry accesses your photo library so you can select photos or videos to personalize your digital avatar."
- `NSPhotoLibraryAddUsageDescription`: "Capstone Foundry saves generated avatar renders and project exports to your photo library."

---

## Google Play & Apple Store Compliance Matrix

| Requirement | Store Rule | Implementation Status | Code Citation |
|---|---|---|---|
| **In-App Account Deletion** | Apple Guideline 5.1.1(v) / Play Policy | Complete | `public/app.html:1329`, `public/onboarding.js:1024`, `api/auth/delete-account.js` |
| **Digital Likeness / Avatars** | California AB 2602, NO FAKES Act, Store Deepfake Rules | Complete (Affirmative consent required before upload, instant revocation, zero third-party training) | `public/avatar-ui.js:408-440`, `server/handlers/avatar.js`, `public/privacy.html` |
| **AI Content Moderation** | Apple Guideline 1.2 / Play Generative AI Policy | Complete (Helmian Guard real-time filter, prompt injection shield, support reporting channel) | `public/guard-engine.js`, `public/support.html`, `server/handlers/guard.js` |
| **Purpose Strings** | Apple Guideline 5.1.1 | Complete (Microphone, Camera, Photo Library strings declared) | `ios/App/App/Info.plist` |
| **Camera Hardware Feature** | Google Play Device Compatibility | Complete (`android.hardware.camera` set to `required="false"`) | `android/app/src/main/AndroidManifest.xml` |
| **Target SDK Version** | Google Play Target API 34+ | Complete (Target SDK 36 configured) | `android/variables.gradle` |
| **Terms & Privacy Links** | Apple EULA Guideline 3.1.2 / Play Privacy Policy | Complete (Available on landing root, login screen, in-app settings, and store docs) | `https://capstonefoundry.cloud/privacy`, `/terms`, `/support` |
