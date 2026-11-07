import fs from 'fs';

const landingHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Capstone Foundry — Autonomous Executive AI Pair Programmer</title>
  <meta name="description" content="Capstone Foundry pairs executive conversational voice with persistent PostgreSQL memory, client-side digital avatars, and Helmion Hands desktop execution.">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="canonical" href="https://www.capstonefoundry.cloud/">

  <!-- OpenGraph / Social SEO -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://www.capstonefoundry.cloud/">
  <meta property="og:title" content="Capstone Foundry — Autonomous Executive AI Pair Programmer">
  <meta property="og:description" content="Executive voice interaction with persistent PostgreSQL memory, client-side digital avatars, and Helmion Hands desktop execution.">
  <meta property="og:image" content="https://www.capstonefoundry.cloud/icon.svg">

  <!-- Twitter SEO -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="https://www.capstonefoundry.cloud/">
  <meta name="twitter:title" content="Capstone Foundry — Autonomous Executive AI Pair Programmer">
  <meta name="twitter:description" content="Executive voice interaction with persistent PostgreSQL memory, client-side digital avatars, and Helmion Hands desktop execution.">
  <meta name="twitter:image" content="https://www.capstonefoundry.cloud/icon.svg">

  <!-- Structured Data JSON-LD for Google & AI Search Engines -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Capstone Foundry",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Web, Android, Windows",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    },
    "description": "Autonomous Executive AI Pair Programmer with real-time conversational voice, persistent PostgreSQL memory, and Helmion Hands desktop execution.",
    "url": "https://www.capstonefoundry.cloud"
  }
  </script>

  <!-- Helmian Guard: Real-time Prompt Injection Shield -->
  <script src="/guard-config.js"></script>
  <script src="/guard-contract.js"></script>
  <script src="/guard-embed.js"></script>

  <style>
    :root {
      --bg: #07090e;
      --card-bg: rgba(13, 17, 27, 0.75);
      --card-border: rgba(0, 212, 255, 0.25);
      --accent: #00d4ff;
      --accent-glow: rgba(0, 212, 255, 0.4);
      --purple: #8b5cf6;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --green: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    body { background: var(--bg); color: var(--text); overflow-x: hidden; line-height: 1.6; }
    
    /* Background Glows */
    .glow-orb {
      position: absolute; width: 600px; height: 600px; border-radius: 50%;
      background: radial-gradient(circle, var(--accent-glow) 0%, rgba(0,0,0,0) 70%);
      top: -200px; left: 50%; transform: translateX(-50%); pointer-events: none; z-index: 0;
    }
    .glow-orb-2 {
      position: absolute; width: 500px; height: 500px; border-radius: 50%;
      background: radial-gradient(circle, rgba(139, 92, 246, 0.25) 0%, rgba(0,0,0,0) 70%);
      top: 600px; right: -100px; pointer-events: none; z-index: 0;
    }

    /* Container */
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px 120px; position: relative; z-index: 1; }

    /* Nav */
    nav { height: 80px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .logo { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 1.25rem; color: #fff; text-decoration: none; }
    .logo-badge { background: linear-gradient(135deg, var(--accent), var(--purple)); width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 900; color: #000; }
    .nav-links { display: flex; gap: 28px; align-items: center; }
    .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.95rem; transition: color 0.2s; }
    .nav-links a:hover { color: var(--accent); }
    .btn-nav { background: rgba(0, 212, 255, 0.12); border: 1px solid var(--accent); color: var(--accent); padding: 8px 18px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 0.9rem; transition: all 0.2s; }
    .btn-nav:hover { background: var(--accent); color: #000; box-shadow: 0 0 15px var(--accent-glow); }

    /* Hero */
    .hero { padding: 90px 0 60px; text-align: center; }
    .hero-pill { display: inline-flex; align-items: center; gap: 8px; background: rgba(0, 212, 255, 0.08); border: 1px solid rgba(0, 212, 255, 0.3); padding: 6px 16px; border-radius: 999px; font-size: 0.85rem; color: var(--accent); margin-bottom: 24px; }
    .hero-pill .dot { width: 8px; height: 8px; background: var(--green); border-radius: 50%; box-shadow: 0 0 8px var(--green); }
    .hero h1 { font-size: 3.5rem; font-weight: 800; line-height: 1.15; margin-bottom: 20px; letter-spacing: -0.02em; }
    .hero h1 span { background: linear-gradient(135deg, #fff 30%, var(--accent) 70%, var(--purple) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero p { font-size: 1.25rem; color: var(--text-muted); max-width: 780px; margin: 0 auto 36px; }
    
    .hero-cta { display: flex; gap: 16px; justify-content: center; align-items: center; flex-wrap: wrap; margin-bottom: 48px; }
    .btn-primary { background: linear-gradient(135deg, var(--accent), #0099ff); color: #000; font-weight: 700; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-size: 1.05rem; box-shadow: 0 0 25px var(--accent-glow); transition: all 0.2s; }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 0 35px var(--accent-glow); }
    .btn-secondary { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-weight: 600; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-size: 1.05rem; transition: all 0.2s; }
    .btn-secondary:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.3); }

    /* Live Telemetry Card */
    .telemetry-card {
      background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px;
      padding: 24px; max-width: 900px; margin: 0 auto; backdrop-filter: blur(12px);
      display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; text-align: left;
      transition: all 0.4s ease;
    }
    .tele-item { border-left: 2px solid var(--accent); padding-left: 14px; }
    .tele-label { font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em; margin-bottom: 4px; }
    .tele-val { font-size: 1.05rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 6px; }
    .badge-green { color: var(--green); }

    /* Features Grid */
    .features { padding: 90px 0; }
    .section-title { text-align: center; margin-bottom: 54px; }
    .section-title h2 { font-size: 2.4rem; font-weight: 800; margin-bottom: 12px; }
    .section-title p { color: var(--text-muted); font-size: 1.1rem; }
    
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 28px; }
    .card { background: var(--card-bg); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 32px; backdrop-filter: blur(10px); transition: all 0.3s; }
    .card:hover { border-color: var(--accent); transform: translateY(-4px); box-shadow: 0 8px 30px rgba(0, 212, 255, 0.15); }
    .card-icon { width: 48px; height: 48px; border-radius: 12px; background: rgba(0, 212, 255, 0.1); border: 1px solid var(--accent); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-bottom: 20px; }
    .card h3 { font-size: 1.35rem; font-weight: 700; margin-bottom: 12px; }
    .card p { color: var(--text-muted); font-size: 0.95rem; line-height: 1.6; }

    /* Pricing Table */
    .pricing { padding: 80px 0; background: rgba(0,0,0,0.3); border-top: 1px solid rgba(255,255,255,0.06); }
    .pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
    .price-card { background: var(--card-bg); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 28px 24px; text-align: center; position: relative; }
    .price-card.featured { border-color: var(--accent); box-shadow: 0 0 25px rgba(0,212,255,0.2); }
    .featured-badge { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: var(--accent); color: #000; font-size: 0.75rem; font-weight: 800; padding: 2px 12px; border-radius: 999px; text-transform: uppercase; }
    .price-title { font-size: 1.15rem; font-weight: 700; margin-bottom: 8px; }
    .price-val { font-size: 2.2rem; font-weight: 800; margin-bottom: 4px; color: #fff; }
    .price-val span { font-size: 0.9rem; color: var(--text-muted); font-weight: 400; }
    .price-features { list-style: none; margin: 20px 0 24px; text-align: left; font-size: 0.88rem; color: var(--text-muted); }
    .price-features li { margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
    .price-features li::before { content: "✓"; color: var(--accent); font-weight: 700; }

    /* Footer */
    footer { padding: 40px 0; border-top: 1px solid rgba(255,255,255,0.06); text-align: center; color: var(--text-muted); font-size: 0.85rem; }
    footer a { color: var(--accent); text-decoration: none; }

    /* Hands Highlight Pulse Animation (Cora-style site navigation) */
    @keyframes mark-highlight-pulse {
      0% { box-shadow: 0 0 0 0 rgba(0, 212, 255, 0.7); border-color: #00d4ff; }
      50% { box-shadow: 0 0 0 16px rgba(0, 212, 255, 0); border-color: #00ff88; }
      100% { box-shadow: 0 0 0 0 rgba(0, 212, 255, 0); }
    }
    .mark-highlight {
      outline: 2px solid #00d4ff !important;
      animation: mark-highlight-pulse 1.2s ease-in-out 3 !important;
    }

    /* ── DOCKED FLOATING COMPANION WIDGET (Taller, Narrower, Bottom-Right) ── */
    #mark-companion {
      position: fixed;
      right: 1.5rem;
      bottom: 1.5rem;
      width: min(340px, calc(100vw - 2rem));
      max-height: min(650px, calc(100vh - 2.5rem));
      display: flex;
      flex-direction: column;
      background: rgba(8, 12, 20, 0.94);
      border: 1px solid rgba(0, 212, 255, 0.4);
      border-radius: 18px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.75), 0 0 30px rgba(0, 212, 255, 0.15);
      backdrop-filter: blur(16px);
      overflow: hidden;
      z-index: 9999;
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
    }
    #mark-companion.minimized {
      transform: translateY(calc(100% - 54px));
    }
    .comp-header {
      background: linear-gradient(135deg, rgba(0, 212, 255, 0.15), rgba(139, 92, 246, 0.1));
      border-bottom: 1px solid rgba(0, 212, 255, 0.2);
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
    }
    .comp-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .comp-avatar-mini {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1.5px solid #00d4ff;
      background: #020712;
      overflow: hidden;
      position: relative;
    }
    .comp-avatar-mini canvas {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .comp-status-dot {
      width: 7px;
      height: 7px;
      background: #00ff88;
      border-radius: 50%;
      box-shadow: 0 0 8px #00ff88;
    }
    .comp-name {
      font-size: 0.9rem;
      font-weight: 700;
      color: #fff;
    }
    .comp-tag {
      font-size: 0.72rem;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .comp-min-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 1.1rem;
      padding: 4px;
      line-height: 1;
    }
    .comp-min-btn:hover { color: #fff; }

    /* Companion Body */
    .comp-body {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
      flex: 1;
    }

    /* Live Dialog Box */
    .comp-dialog-box {
      background: rgba(3, 7, 18, 0.85);
      border: 1px solid rgba(0, 212, 255, 0.2);
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 0.86rem;
      line-height: 1.5;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 110px;
    }
    .dialog-msg {
      padding: 8px 10px;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .dialog-msg.interviewer {
      background: rgba(255, 255, 255, 0.05);
      border-left: 2px solid #8b5cf6;
    }
    .dialog-msg.mark {
      background: rgba(0, 212, 255, 0.08);
      border-left: 2px solid #00d4ff;
    }
    .dialog-speaker {
      font-size: 0.7rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .dialog-speaker.interviewer { color: #c4b5fd; }
    .dialog-speaker.mark { color: #00d4ff; }
    .dialog-text {
      color: #f1f5f9;
      font-size: 0.84rem;
    }

    /* Guard Badge */
    .comp-guard-banner {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.72rem;
      color: #10b981;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.25);
      padding: 4px 8px;
      border-radius: 6px;
    }

    /* Suggestion Pills */
    .comp-pills-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }
    .comp-pills {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .comp-pill-btn {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #e2e8f0;
      padding: 7px 10px;
      border-radius: 8px;
      font-size: 0.8rem;
      text-align: left;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: all 0.2s ease;
    }
    .comp-pill-btn:hover {
      background: rgba(0, 212, 255, 0.12);
      border-color: #00d4ff;
      color: #fff;
    }
    .comp-pill-btn.active {
      background: rgba(0, 212, 255, 0.18);
      border-color: #00d4ff;
      color: #00d4ff;
    }

    /* Input & Controls */
    .comp-footer {
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: rgba(3, 7, 18, 0.4);
    }
    .comp-input-row {
      display: flex;
      gap: 6px;
    }
    .comp-input {
      flex: 1;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      color: #fff;
      font-size: 0.82rem;
      padding: 7px 10px;
      outline: none;
    }
    .comp-input:focus { border-color: #00d4ff; }
    .comp-send-btn {
      background: #00d4ff;
      border: none;
      border-radius: 8px;
      color: #030712;
      font-weight: 700;
      font-size: 0.82rem;
      padding: 0 12px;
      cursor: pointer;
    }
    .comp-action-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .comp-voice-btn {
      background: rgba(0, 212, 255, 0.15);
      border: 1px solid #00d4ff;
      color: #00d4ff;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 600;
      padding: 5px 10px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .comp-voice-btn:hover { background: #00d4ff; color: #000; }
    .comp-live-link {
      font-size: 0.78rem;
      color: #10b981;
      text-decoration: none;
      font-weight: 600;
    }
    .comp-live-link:hover { text-decoration: underline; }

    @media (max-width: 768px) {
      .hero h1 { font-size: 2.4rem; }
      nav .nav-links { display: none; }
      #mark-companion { right: 0.75rem; bottom: 0.75rem; width: calc(100vw - 1.5rem); max-height: 60vh; }
    }
  </style>
</head>
<body>
  <!-- Mobile & Session Sticky Back Bar -->
  <div style="position:sticky;top:0;left:0;right:0;background:rgba(7,9,14,0.96);backdrop-filter:blur(12px);border-bottom:1px solid rgba(0,212,255,0.25);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;z-index:999;">
    <button onclick="handleBackToApp()" type="button" style="display:inline-flex;align-items:center;gap:8px;background:rgba(0,212,255,0.2);border:1px solid #00d4ff;color:#00d4ff;padding:8px 16px;border-radius:8px;font-weight:700;font-size:0.9rem;cursor:pointer;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      Back to Session
    </button>
    <span style="font-size:0.85rem;color:#00d4ff;font-weight:600;letter-spacing:0.04em;">CAPSTONE FOUNDRY</span>
  </div>

  <div class="glow-orb"></div>
  <div class="glow-orb-2"></div>

  <div class="container">
    <!-- Navbar -->
    <nav>
      <a href="/" class="logo">
        <div class="logo-badge">CF</div>
        Capstone Foundry
      </a>
      <div class="nav-links">
        <a href="#features">Capabilities</a>
        <a href="#hands">Helmion Hands</a>
        <a href="#security">Security</a>
        <a href="#pricing">Tiers</a>
        <button id="cfBackBtn" class="btn-nav" type="button" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:rgba(0,212,255,0.2);border-color:#00d4ff;color:#00d4ff;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg> Back to Session</button>
      </div>
      <button onclick="handleBackToApp()" class="btn-nav" type="button" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:rgba(0,212,255,0.2);border-color:#00d4ff;color:#00d4ff;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg> Back to Session</button>
    </nav>

    <!-- Hero Section -->
    <section class="hero">
      <div class="hero-pill">
        <span class="dot"></span>
        Production Live on Vercel • Helmion Spoke Connected
      </div>
      <h1>
        Build Fast. Remember Everything.<br>
        <span>Executive Voice AI with Hands.</span>
      </h1>
      <p>
        Capstone Foundry pairs low-latency conversational voice with persistent PostgreSQL memory categorization and real-world desktop execution via Helmion Hands.
      </p>

      <div class="hero-cta">
        <a href="/" class="btn-primary">Launch Live Voice Session</a>
        <a href="/mark-android.apk" class="btn-secondary">Download Android APK</a>
      </div>

      <!-- Live Telemetry Card -->
      <div class="telemetry-card" id="telemetry">
        <div class="tele-item">
          <div class="tele-label">Active Spoke</div>
          <div class="tele-val"><span class="badge-green">●</span> pc-troy (Online)</div>
        </div>
        <div class="tele-item">
          <div class="tele-label">PostgreSQL Memory</div>
          <div class="tele-val">49,388 Records</div>
        </div>
        <div class="tele-item">
          <div class="tele-label">Voice Latency</div>
          <div class="tele-val">~280ms (Direct AudioContext)</div>
        </div>
        <div class="tele-item">
          <div class="tele-label">Safety Shield</div>
          <div class="tele-val"><span class="badge-green">●</span> Helmian Guard Active</div>
        </div>
      </div>
    </section>

    <!-- Capabilities / Features Grid -->
    <section class="features" id="features">
      <div class="section-title">
        <h2>Executive Autonomous Capabilities</h2>
        <p>Built for operators who need work done, not endless text responses.</p>
      </div>

      <div class="grid">
        <div class="card" id="feat-hands">
          <div class="card-icon">⚡</div>
          <h3>Helmion Hands Execution</h3>
          <p>Mark does not just write code; he executes it. From terminal operations and build scripts to git deployments and cloud provisioning, execution runs directly on your authorized desktop spoke.</p>
        </div>

        <div class="card" id="feat-memory">
          <div class="card-icon">🧠</div>
          <h3>Persistent PostgreSQL Memory</h3>
          <p>Never re-explain your architecture. Conversations, technical decisions, schemas, and credentials are automatically classified and filed into PostgreSQL with full semantic indexing.</p>
        </div>

        <div class="card" id="feat-avatar">
          <div class="card-icon">🎭</div>
          <h3>Client-Side Avatar Lip Sync</h3>
          <p>60fps digital likeness engine rendering directly on HTML5 Canvas. Zero cloud GPU costs, complete privacy, and instant responsiveness across both desktop and mobile.</p>
        </div>

        <div class="card" id="feat-guard">
          <div class="card-icon">🛡️</div>
          <h3>Helmian Guard Protection</h3>
          <p>Enterprise prompt injection defense. Every incoming message and tool execution is screened against malicious overrides and unauthorized access before hitting the LLM.</p>
        </div>

        <div class="card" id="feat-relay">
          <div class="card-icon">📱</div>
          <h3>Phone ↔ PC Relay Architecture</h3>
          <p>Give commands from your Samsung Galaxy while walking outside. Mark relays instructions securely to your home or office workstation through an encrypted bidirectional WebSocket.</p>
        </div>

        <div class="card" id="feat-voice">
          <div class="card-icon">🎙️</div>
          <h3>Natural Executive Tone</h3>
          <p>Engineered for high-bandwidth engineering debates. Mark speaks with authoritative, direct answers without fluff, excessive apologies, or filler words.</p>
        </div>
      </div>
    </section>

    <!-- Hands & Security Section -->
    <section class="features" id="hands" style="padding-top: 0;">
      <div class="section-title">
        <h2>Hands Desktop Execution</h2>
        <p>How Capstone Foundry interacts with the real world.</p>
      </div>
      <div class="card" style="max-width: 900px; margin: 0 auto; text-align: left;">
        <h3 style="color: var(--accent); margin-bottom: 16px;">The Helmion Protocol Bridge</h3>
        <p style="margin-bottom: 14px;">
          When you speak a command to Mark, the request is parsed into structured intent. If execution is required (such as building a project, checking git status, running tests, or inspecting databases), the command is dispatched to your connected local machine running <code>Helmion.exe</code>.
        </p>
        <p style="color: var(--text-muted); font-size: 0.95rem;">
          • Fully isolated sandbox with human-in-the-loop permission grants.<br>
          • Automated watchdog auto-recovery on dropped network connections.<br>
          • Native Android speakerphone routing with continuous AudioContext watchdog.
        </p>
      </div>
    </section>

    <!-- Pricing Section -->
    <section class="pricing" id="pricing">
      <div class="section-title">
        <h2>Simple, Transparent Tiers</h2>
        <p>Start free, upgrade as your autonomous workload expands.</p>
      </div>

      <div class="pricing-grid">
        <div class="price-card">
          <div class="price-title">Free</div>
          <div class="price-val">$0<span>/mo</span></div>
          <ul class="price-features">
            <li>Core conversational voice</li>
            <li>50 basic memory recalls</li>
            <li>Interactive browser avatar</li>
          </ul>
        </div>

        <div class="price-card">
          <div class="price-title">Buddy Starter</div>
          <div class="price-val">$2.99<span>/mo</span></div>
          <ul class="price-features">
            <li>Extended voice minutes</li>
            <li>Basic memory categorization</li>
            <li>Curriculum exercises</li>
          </ul>
        </div>

        <div class="price-card">
          <div class="price-title">Executive</div>
          <div class="price-val">$9.99<span>/mo</span></div>
          <ul class="price-features">
            <li>Unlimited PostgreSQL memory</li>
            <li>Custom photo & video likeness</li>
            <li>Document exports (PDF/MD)</li>
          </ul>
        </div>

        <div class="price-card featured">
          <div class="featured-badge">Top Tier</div>
          <div class="price-title">Helmian Hands</div>
          <div class="price-val">$29.99<span>/mo</span></div>
          <ul class="price-features">
            <li><strong>Hands into Desktop:</strong> Helmion.exe</li>
            <li>Phone ↔ PC relay execution</li>
            <li>Autonomous terminal runner</li>
            <li>Custom voice & avatar release</li>
          </ul>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer>
      <p>&copy; 2026 Capstone Foundry &bull; Built with Helmion Autonomous Systems &bull; <a href="#" onclick="handleBackToApp(); return false;">Back to Session</a></p>
    </footer>
  </div>

  <!-- ── DOCKED FLOATING COMPANION (Taller, Narrower, Bottom-Right) ── -->
  <aside id="mark-companion" aria-label="Mark Executive Pair Programmer Demo">
    <!-- Header -->
    <div class="comp-header" id="compToggleHeader" title="Click to minimize/expand">
      <div class="comp-title">
        <div class="comp-avatar-mini">
          <canvas id="compAvatarCanvas" width="96" height="96"></canvas>
        </div>
        <div>
          <div class="comp-name">Mark <span class="comp-tag">Executive AI</span></div>
          <div style="display:flex; align-items:center; gap:5px; font-size:0.7rem; color:#94a3b8;">
            <span class="comp-status-dot"></span>
            <span id="compStatusText">Live Interactive Demo</span>
          </div>
        </div>
      </div>
      <button class="comp-min-btn" id="compMinBtn" type="button" aria-label="Minimize">▼</button>
    </div>

    <!-- Body -->
    <div class="comp-body">
      <!-- Guard Shield Notice -->
      <div class="comp-guard-banner">
        <span>🛡️</span>
        <span>Protected by <strong>Helmian Guard</strong> embed</span>
      </div>

      <!-- Dialogue History -->
      <div class="comp-dialog-box" id="compDialogBox">
        <div class="dialog-msg interviewer" id="msgInterviewer">
          <span class="dialog-speaker interviewer">Executive / Founder:</span>
          <span class="dialog-text" id="txtInterviewer">"Hey Mark, can you check our server telemetry and run the morning health audit?"</span>
        </div>
        <div class="dialog-msg mark" id="msgMark">
          <span class="dialog-speaker mark">Mark (Executive Pair Programmer):</span>
          <span class="dialog-text" id="txtMark">"Spoke connected to pc-troy. Telemetry is green — 49,388 memories indexed, latency is 280 milliseconds, and Helmian Guard is active."</span>
        </div>
      </div>

      <!-- Suggested Interactive Scenarios -->
      <div class="comp-pills-label">Suggested Demonstrations</div>
      <div class="comp-pills">
        <button class="comp-pill-btn active" id="pill1" type="button" data-scenario="1">
          <span>⚡ 1. Hands: Audit Telemetry</span>
          <span>&rarr;</span>
        </button>
        <button class="comp-pill-btn" id="pill2" type="button" data-scenario="2">
          <span>🧠 2. Memory: Past Sessions</span>
          <span>&rarr;</span>
        </button>
        <button class="comp-pill-btn" id="pill3" type="button" data-scenario="3">
          <span>🛡️ 3. Safety: Guard Injection Defense</span>
          <span>&rarr;</span>
        </button>
      </div>
    </div>

    <!-- Footer / Input Form -->
    <div class="comp-footer">
      <form class="comp-input-row" id="compChatForm">
        <input class="comp-input" id="compInput" type="text" autocomplete="off" placeholder="Ask Mark or test injection..." aria-label="Question for Mark" />
        <button class="comp-send-btn" type="submit">Ask</button>
      </form>
      <div class="comp-action-row">
        <button class="comp-voice-btn" id="compPlayBtn" type="button">
          ▶ Play Dialogue Audio
        </button>
        <a href="/" class="comp-live-link">Open Full App &rarr;</a>
      </div>
    </div>
  </aside>

  <!-- Companion Logic with Real-time Lip-Sync & Helmian Guard -->
  <script type="module">
    import { HolographicAvatarEngine } from '/avatar-engine.js';

    // 1. Initialize Avatar Engine inside the docked companion
    const canvas = document.getElementById('compAvatarCanvas');
    let avatarEngine = null;
    if (canvas) {
      avatarEngine = new HolographicAvatarEngine(canvas);
      // Executive digital avatar SVG
      const avatarSvg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><defs><linearGradient id='bg' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='%230f2b38'/><stop offset='100%' stop-color='%23061219'/></linearGradient><linearGradient id='skin' x1='0%' y1='0%' x2='0%' y2='100%'><stop offset='0%' stop-color='%23d9ad8b'/><stop offset='100%' stop-color='%23b88968'/></linearGradient></defs><rect width='96' height='96' fill='url(%23bg)'/><circle cx='48' cy='42' r='20' fill='url(%23skin)'/><path d='M28,36 Q48,20 68,36 Q48,28 28,36 Z' fill='%231e293b'/><circle cx='41' cy='40' r='2' fill='%230f172a'/><circle cx='55' cy='40' r='2' fill='%230f172a'/><path d='M42,52 Q48,56 54,52' stroke='%2378350f' stroke-width='1.5' fill='none'/><path d='M24,82 Q48,64 72,82 L78,96 L18,96 Z' fill='%230284c7'/></svg>";
      avatarEngine.loadPhoto(avatarSvg);
    }

    // 2. Multi-Voice Pre-configured Scenarios with Hands Site Navigation
    const scenarios = {
      1: {
        targetId: 'telemetry',
        q: '"Hey Mark, can you check our server telemetry and run the health audit?"',
        a: '"Spoke connected to pc-troy. Telemetry is verified — 49,388 memories indexed, voice latency is 280ms, and Helmian Guard is active."',
        qPitch: 1.15,
        aPitch: 0.88
      },
      2: {
        targetId: 'feat-memory',
        q: '"How do you prevent context loss across multiple engineering sprints?"',
        a: '"Every architectural decision, credential hash, and git branch is written to PostgreSQL with strict tenant boundaries. When you reconnect tomorrow, my context is already primed."',
        qPitch: 1.15,
        aPitch: 0.88
      },
      3: {
        targetId: 'feat-guard',
        q: '"What happens if an adversarial prompt tries to hijack your desktop commands?"',
        a: '"Helmian Guard screens every packet before the model sees it. Injections are blocked at the edge with zero system access, exactly as designed."',
        qPitch: 1.15,
        aPitch: 0.88
      }
    };

    let activeScenario = 1;

    function applyScenario(id, autoPlay = true) {
      activeScenario = id;
      const data = scenarios[id];
      if (!data) return;

      // Update pills UI
      [1, 2, 3].forEach(n => {
        const btn = document.getElementById('pill' + n);
        if (btn) btn.classList.toggle('active', n === id);
      });

      // Update Dialog
      const txtQ = document.getElementById('txtInterviewer');
      const txtA = document.getElementById('txtMark');
      if (txtQ) txtQ.textContent = data.q;
      if (txtA) txtA.textContent = data.a;

      // Hands Navigation: Smooth scroll to target and pulse highlight
      if (data.targetId) {
        const targetEl = document.getElementById(data.targetId);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetEl.classList.remove('mark-highlight');
          void targetEl.offsetWidth; // trigger reflow
          targetEl.classList.add('mark-highlight');
          setTimeout(() => targetEl.classList.remove('mark-highlight'), 3600);
        }
      }

      if (autoPlay) {
        playDialogue(data);
      }
    }

    // Two-Voice Speech Synthesis Player
    function playDialogue(data) {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();

      const voices = window.speechSynthesis.getVoices();
      const enVoices = voices.filter(v => v.lang.startsWith('en'));
      const voiceInterviewer = enVoices.find(v => v.name.includes('Female') || v.name.includes('Google') || v.name.includes('Natural')) || enVoices[0];
      const voiceMark = enVoices.find(v => v.name.includes('Male') || v.name.includes('David') || v.name.includes('Mark') || v.name.includes('Guy')) || enVoices[1] || enVoices[0];

      // Step 1: Speak Question (Interviewer)
      const uQ = new SpeechSynthesisUtterance(data.q.replace(/["']/g, ''));
      if (voiceInterviewer) uQ.voice = voiceInterviewer;
      uQ.pitch = data.qPitch || 1.1;
      uQ.rate = 1.05;

      const statusText = document.getElementById('compStatusText');
      if (statusText) statusText.textContent = 'Speaking: Founder';

      uQ.onend = () => {
        // Step 2: Speak Answer (Mark) with Lip-Sync
        setTimeout(() => {
          const uA = new SpeechSynthesisUtterance(data.a.replace(/["']/g, ''));
          if (voiceMark) uA.voice = voiceMark;
          uA.pitch = data.aPitch || 0.88;
          uA.rate = 0.98;

          uA.onstart = () => {
            if (statusText) statusText.textContent = 'Mark Speaking...';
            if (avatarEngine) avatarEngine.startLipSync(30);
          };

          uA.onend = () => {
            if (statusText) statusText.textContent = 'Live Interactive Demo';
            if (avatarEngine) avatarEngine.stopLipSync();
          };

          uA.onerror = () => {
            if (statusText) statusText.textContent = 'Live Interactive Demo';
            if (avatarEngine) avatarEngine.stopLipSync();
          };

          window.speechSynthesis.speak(uA);
        }, 350);
      };

      window.speechSynthesis.speak(uQ);
    }

    // Wire Scenario Pills
    [1, 2, 3].forEach(id => {
      const btn = document.getElementById('pill' + id);
      if (btn) {
        btn.addEventListener('click', () => applyScenario(id, true));
      }
    });

    // Wire Play Button
    const playBtn = document.getElementById('compPlayBtn');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        const sc = scenarios[activeScenario];
        if (sc) playDialogue(sc);
      });
    }

    // Wire Minimize / Expand
    const compPanel = document.getElementById('mark-companion');
    const compToggle = document.getElementById('compToggleHeader');
    const compMinBtn = document.getElementById('compMinBtn');
    function toggleMin(e) {
      if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' && e.target !== compMinBtn) return;
      compPanel.classList.toggle('minimized');
      compMinBtn.textContent = compPanel.classList.contains('minimized') ? '▲' : '▼';
    }
    if (compToggle) compToggle.addEventListener('click', toggleMin);
    if (compMinBtn) compMinBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMin(e); });

    // 3. Helmian Guard Prompt Injection Shield for Custom Input
    const chatForm = document.getElementById('compChatForm');
    const chatInput = document.getElementById('compInput');
    if (chatForm && chatInput) {
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = chatInput.value.trim();
        if (!query) return;

        chatInput.value = '';
        const txtQ = document.getElementById('txtInterviewer');
        const txtA = document.getElementById('txtMark');
        const statusText = document.getElementById('compStatusText');

        if (txtQ) txtQ.textContent = '"' + query + '"';
        if (statusText) statusText.textContent = 'Guard Screening...';

        // Screen query with Helmian Guard if available
        let proceed = true;
        let blockReason = '';
        if (window.HelmianGuard && typeof window.HelmianGuard.screen === 'function') {
          try {
            const verdict = await window.HelmianGuard.screen({ surface: 'chat', text: query });
            if (verdict && verdict.proceed === false) {
              proceed = false;
              blockReason = verdict.note || 'Input flagged as adversarial prompt injection.';
            }
          } catch (err) {
            console.warn('Helmian Guard screen pass:', err);
          }
        }

        if (!proceed) {
          if (txtA) txtA.textContent = '🛡️ [Blocked by Helmian Guard]: ' + blockReason;
          if (statusText) statusText.textContent = 'Shield Blocked';
          return;
        }

        // Clean conversational mock reply
        const reply = "I received your command. In full session mode, this query dispatches directly to pc-troy with PostgreSQL memory retrieval.";
        if (txtA) txtA.textContent = '"' + reply + '"';

        playDialogue({
          q: query,
          a: reply,
          qPitch: 1.1,
          aPitch: 0.88
        });
      });
    }
  </script>

  <script>
    function handleBackToApp() {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'close-artifact-viewer' }, '*');
      } else if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = '/';
      }
    }
    const bBtn = document.getElementById('cfBackBtn');
    if (bBtn) bBtn.addEventListener('click', handleBackToApp);
  </script>
</body>
</html>
`;

fs.writeFileSync('E:/CapstoneFoundry/public/landing.html', landingHtml, 'utf8');
console.log('Successfully written updated landing.html with Docked Companion & Helmian Guard & SEO');
