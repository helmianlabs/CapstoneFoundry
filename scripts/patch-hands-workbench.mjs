import fs from 'fs';
import path from 'path';

const indexPath = 'E:/CapstoneFoundry/index.html';
let html = fs.readFileSync(indexPath, 'utf-8');

// 1. Add Hands CSS before </style>
const handsStyles = `
    /* ── HELMION HANDS LIVE WORKBENCH & 3D CONSTELLATION ── */
    #hands {
      position: relative;
      overflow: hidden;
      padding: 100px 0 120px 0;
      background: radial-gradient(ellipse at 50% 10%, rgba(0, 212, 255, 0.09) 0%, rgba(5, 7, 13, 0.98) 75%);
      border-top: 1px solid rgba(0, 212, 255, 0.18);
      border-bottom: 1px solid rgba(0, 212, 255, 0.18);
    }
    #handsConstellationCanvas {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
      opacity: 0.85;
    }
    .hands-inner-content {
      position: relative;
      z-index: 2;
    }
    .spoke-protocol-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(0, 212, 255, 0.1);
      border: 1px solid rgba(0, 212, 255, 0.4);
      padding: 6px 16px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 800;
      letter-spacing: 2px;
      color: #00d4ff;
      text-transform: uppercase;
      margin-bottom: 18px;
      box-shadow: 0 0 20px rgba(0, 212, 255, 0.2);
    }
    .hands-hero-title {
      font-size: clamp(2rem, 4vw, 3.2rem);
      font-weight: 800;
      line-height: 1.15;
      margin-bottom: 16px;
      letter-spacing: -0.5px;
    }
    .accent-gradient-cyan {
      background: linear-gradient(135deg, #00d4ff 0%, #00ff88 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .motion-tagline-wrap {
      margin: 16px auto 28px auto;
      display: inline-block;
      position: relative;
      padding: 12px 32px;
    }
    .motion-tagline-glow {
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at center, rgba(0, 212, 255, 0.25) 0%, rgba(0,0,0,0) 70%);
      border-radius: 999px;
      animation: tagline-pulse 3s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes tagline-pulse {
      0%, 100% { opacity: 0.5; transform: scale(0.98); }
      50% { opacity: 1; transform: scale(1.04); }
    }
    .hands-main-tagline {
      position: relative;
      font-size: clamp(1.3rem, 2.8vw, 2.1rem);
      font-weight: 800;
      letter-spacing: 1.5px;
      color: #ffffff;
      text-shadow: 0 0 25px rgba(0, 212, 255, 0.8), 0 0 50px rgba(0, 212, 255, 0.4);
      margin: 0;
    }
    .hands-sub-desc {
      color: #94a3b8;
      max-width: 740px;
      margin: 0 auto 36px auto;
      font-size: 1.05rem;
      line-height: 1.6;
    }

    /* Workbench Controls */
    .workbench-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(0, 212, 255, 0.25);
      border-radius: 14px;
      padding: 14px 20px;
      margin-bottom: 24px;
      backdrop-filter: blur(12px);
    }
    .scenario-tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .scenario-tab {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #94a3b8;
      font-size: 0.82rem;
      font-weight: 600;
      padding: 8px 14px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .scenario-tab:hover {
      border-color: #00d4ff;
      color: #fff;
    }
    .scenario-tab.active {
      background: rgba(0, 212, 255, 0.18);
      border-color: #00d4ff;
      color: #00d4ff;
      box-shadow: 0 0 15px rgba(0, 212, 255, 0.3);
    }
    .workbench-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .btn-run-hands {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%);
      color: #050508;
      font-weight: 800;
      font-size: 0.88rem;
      padding: 9px 18px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 0 20px rgba(0, 212, 255, 0.4);
    }
    .btn-run-hands:hover {
      transform: translateY(-1px);
      box-shadow: 0 0 30px rgba(0, 212, 255, 0.7);
    }
    .spoke-status-pill {
      font-size: 0.75rem;
      color: #64748b;
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: monospace;
    }
    .spoke-status-pill strong { color: #00ff88; }

    /* Workbench Split-Screen Grid */
    .hands-workbench-grid {
      display: grid;
      grid-template-columns: 1fr 1.15fr;
      gap: 22px;
      text-align: left;
      margin-bottom: 36px;
    }
    @media (max-width: 992px) {
      .hands-workbench-grid { grid-template-columns: 1fr; }
    }

    /* Left Pane: Terminal HUD */
    .terminal-window {
      background: #090d16;
      border: 1px solid rgba(0, 212, 255, 0.3);
      border-radius: 14px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 45px rgba(0,0,0,0.6), 0 0 30px rgba(0, 212, 255, 0.1);
    }
    .terminal-titlebar {
      background: #0d1322;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .window-controls {
      display: flex;
      gap: 6px;
    }
    .window-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .dot-red { background: #ff5f56; }
    .dot-yellow { background: #ffbd2e; }
    .dot-green { background: #27c93f; }
    .terminal-path {
      font-size: 0.75rem;
      color: #64748b;
      font-family: monospace;
    }
    .terminal-badge {
      font-size: 0.68rem;
      font-weight: 700;
      color: #00d4ff;
      background: rgba(0, 212, 255, 0.12);
      padding: 2px 8px;
      border-radius: 4px;
      letter-spacing: 1px;
    }

    /* Terminal Voice Bar */
    .terminal-voice-bar {
      background: rgba(15, 23, 42, 0.7);
      padding: 12px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .voice-bubble {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 0.85rem;
      line-height: 1.45;
      margin-bottom: 8px;
    }
    .voice-bubble:last-child { margin-bottom: 0; }
    .voice-avatar-thumb {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
      border: 1px solid #00d4ff;
    }
    .voice-bubble.founder-bubble { color: #e2e8f0; }
    .voice-bubble.founder-bubble .speaker-tag { color: #f59e0b; font-weight: 700; font-size: 0.75rem; }
    .voice-bubble.mark-bubble { color: #00d4ff; }
    .voice-bubble.mark-bubble .speaker-tag { color: #00d4ff; font-weight: 700; font-size: 0.75rem; }

    /* Terminal Body */
    .terminal-body {
      padding: 16px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 0.82rem;
      line-height: 1.6;
      color: #cbd5e1;
      height: 380px;
      overflow-y: auto;
      background: #060911;
    }
    .term-line {
      margin-bottom: 6px;
      display: flex;
      gap: 8px;
      opacity: 0;
      animation: line-fade-in 0.25s forwards;
    }
    @keyframes line-fade-in {
      to { opacity: 1; }
    }
    .term-ts { color: #475569; }
    .term-tag-info { color: #00d4ff; font-weight: 700; }
    .term-tag-cmd { color: #f59e0b; font-weight: 700; }
    .term-tag-success { color: #00ff88; font-weight: 700; }
    .term-cmd { color: #ffffff; }

    /* Right Pane: Live App Viewport */
    .viewport-window {
      background: #0f172a;
      border: 1px solid rgba(0, 212, 255, 0.3);
      border-radius: 14px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 45px rgba(0,0,0,0.6), 0 0 35px rgba(0, 212, 255, 0.12);
    }
    .viewport-titlebar {
      background: #0d1322;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .viewport-urlbar {
      flex: 1;
      background: rgba(255,255,255,0.06);
      border-radius: 6px;
      padding: 4px 12px;
      font-size: 0.74rem;
      font-family: monospace;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 6px;
      border: 1px solid rgba(255,255,255,0.05);
    }
    .viewport-urlbar .lock-icon { color: #00ff88; }
    .viewport-body {
      background: #05070f;
      height: 440px;
      overflow-y: auto;
      position: relative;
    }

    /* Live Hauling App Styles inside Viewport */
    .hauling-app {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #fff;
      padding: 20px;
    }
    .hauling-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .hauling-logo {
      font-size: 0.95rem;
      font-weight: 800;
      letter-spacing: 1.5px;
      color: #f59e0b;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .hauling-dispatch-status {
      font-size: 0.72rem;
      color: #00ff88;
      background: rgba(0, 255, 136, 0.1);
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid rgba(0, 255, 136, 0.3);
      font-weight: 600;
    }
    .hauling-hero {
      text-align: left;
      margin-bottom: 18px;
    }
    .hauling-hero h4 {
      font-size: 1.15rem;
      font-weight: 800;
      color: #fff;
      margin: 0 0 4px 0;
    }
    .hauling-hero p {
      font-size: 0.8rem;
      color: #94a3b8;
      margin: 0;
    }

    /* Rate Calculator Card */
    .rate-calculator-card {
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .calc-title {
      font-size: 0.82rem;
      font-weight: 700;
      color: #f59e0b;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .calc-slider-group {
      margin-bottom: 12px;
    }
    .calc-slider-label {
      display: flex;
      justify-content: space-between;
      font-size: 0.76rem;
      color: #cbd5e1;
      margin-bottom: 4px;
    }
    .calc-slider-label strong { color: #00d4ff; }
    .calc-range-input {
      width: 100%;
      accent-color: #f59e0b;
      cursor: pointer;
    }
    .calc-result-box {
      background: rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
    }
    .calc-result-val {
      font-size: 1.25rem;
      font-weight: 800;
      color: #00ff88;
    }
    .calc-result-sub {
      font-size: 0.7rem;
      color: #64748b;
    }
    .btn-dispatch-haul {
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: #000;
      font-weight: 800;
      font-size: 0.8rem;
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .btn-dispatch-haul:hover {
      transform: translateY(-1px);
      box-shadow: 0 0 15px rgba(245, 158, 11, 0.5);
    }

    /* Fleet Badges */
    .hauling-specs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    .spec-pill {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 6px;
      padding: 6px 8px;
      text-align: center;
    }
    .spec-pill-title { font-size: 0.68rem; color: #64748b; }
    .spec-pill-val { font-size: 0.74rem; font-weight: 700; color: #e2e8f0; }

    .spoke-generated-tag {
      font-size: 0.68rem;
      color: #475569;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 8px;
    }

    /* 3-Step Hands Architecture Below */
    .hands-architecture-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 20px;
      max-width: 1000px;
      margin: 0 auto;
      text-align: left;
    }
    .hands-arch-card {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(0, 212, 255, 0.15);
      border-radius: 12px;
      padding: 22px;
      position: relative;
    }
    .arch-step-num {
      position: absolute;
      top: 16px;
      right: 18px;
      font-size: 1.4rem;
      font-weight: 800;
      color: rgba(0, 212, 255, 0.2);
    }
    .hands-arch-card h4 {
      font-size: 1.05rem;
      font-weight: 700;
      color: #fff;
      margin: 0 0 8px 0;
    }
    .hands-arch-card p {
      font-size: 0.88rem;
      color: #94a3b8;
      line-height: 1.5;
      margin: 0;
    }
`;

// Inject handsStyles right before </style>
html = html.replace('</style>', handsStyles + '\n</style>');

// 2. Add Audio elements for Hands
const handsAudioElements = `
    <!-- Hands Audio Preloads (Sarah & Brian) -->
    <audio id="audioF_hands" src="/audio/demo/demo_hands_founder.mp3" preload="auto"></audio>
    <audio id="audioM_hands" src="/audio/demo/demo_hands_mark.mp3" preload="auto"></audio>
`;
html = html.replace('<audio id="audioF1"', handsAudioElements + '\n    <audio id="audioF1"');

// 3. Replace the basic section id="hands" with the full interactive experience
const targetSection = /<!-- Hands & Security Section -->[\s\S]*?<\/section>/;

const newHandsSection = `<!-- Helmion Hands Interactive Live Workbench & 3D Motion Graphics -->
    <section id="hands">
      <canvas id="handsConstellationCanvas"></canvas>
      <div class="container hands-inner-content">
        
        <div class="section-title" style="margin-bottom: 24px;">
          <div class="spoke-protocol-badge">
            <span class="badge-dot"></span> HELMION HANDS PROTOCOL &bull; DESKTOP SPOKE ENGINE
          </div>
          <h2 class="hands-hero-title">
            Autonomous Desktop Execution.<br>
            <span class="accent-gradient-cyan">Voice In, Running Software Out.</span>
          </h2>
          <div class="motion-tagline-wrap">
            <div class="motion-tagline-glow"></div>
            <p class="hands-main-tagline">&ldquo;What are you going to discover next?&rdquo;</p>
          </div>
          <p class="hands-sub-desc">
            Speak a command naturally from your phone or desktop. Watch Mark dispatch instructions to your authenticated local spoke (<code>pc-troy</code>), scaffold files, build assets, and launch an interactive live preview right on your screen.
          </p>
        </div>

        <!-- Workbench Controls -->
        <div class="workbench-controls">
          <div class="scenario-tabs">
            <button class="scenario-tab active" id="tabHauling" onclick="selectHandsScenario('hauling')">
              🚚 Heavy Hauling Landing Page
            </button>
            <button class="scenario-tab" id="tabDispatch" onclick="selectHandsScenario('dispatch')">
              📱 Mobile Dispatch Viewport
            </button>
            <button class="scenario-tab" id="tabInvoices" onclick="selectHandsScenario('invoices')">
              📊 Invoices & Approvals Relay
            </button>
          </div>
          <div class="workbench-actions">
            <button class="btn-run-hands" id="btnRunHands" onclick="runHandsDemo()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <span>Run Live Voice Demo</span>
            </button>
            <div class="spoke-status-pill">
              <span class="badge-dot"></span> SPOKE: <strong>pc-troy</strong> | PORT: <strong>8088</strong>
            </div>
          </div>
        </div>

        <!-- Split-Screen Workbench -->
        <div class="hands-workbench-grid">
          
          <!-- Left: Terminal HUD & Execution Stream -->
          <div class="terminal-window">
            <div class="terminal-titlebar">
              <div class="window-controls">
                <div class="window-dot dot-red"></div>
                <div class="window-dot dot-yellow"></div>
                <div class="window-dot dot-green"></div>
              </div>
              <div class="terminal-path" id="termPathDisplay">spoke@pc-troy: ~/projects/apex-hauling</div>
              <div class="terminal-badge" id="termLiveBadge">● READY</div>
            </div>

            <!-- Voice Dialogue Bar -->
            <div class="terminal-voice-bar">
              <div class="voice-bubble founder-bubble" id="termFounderBubble">
                <span style="font-size: 1.1rem;">🎙️</span>
                <div>
                  <span class="speaker-tag">FOUNDER:</span>
                  <span id="termFounderText">&ldquo;Hey Mark, can you build me a landing page for our equipment hauling service?&rdquo;</span>
                </div>
              </div>
              <div class="voice-bubble mark-bubble" id="termMarkBubble" style="display:none;">
                <img src="/mark-avatar.jpg" alt="Mark" class="voice-avatar-thumb" />
                <div>
                  <span class="speaker-tag">MARK (EXECUTIVE AI):</span>
                  <span id="termMarkText">&ldquo;Spoke connected to pc-troy. Scaffolding responsive layout, wiring the live freight calculator, and launching the preview now.&rdquo;</span>
                </div>
              </div>
            </div>

            <!-- Streaming Terminal Lines -->
            <div class="terminal-body" id="termBody">
              <div class="term-line"><span class="term-ts">[15:33:00]</span> <span class="term-tag-info">[SPOKE INIT]</span> <span class="term-cmd">Connected to Helmion Spoke daemon on 127.0.0.1:8088</span></div>
              <div class="term-line"><span class="term-ts">[15:33:01]</span> <span class="term-tag-info">[AUTH]</span> <span class="term-cmd">Token verified &bull; Spoke hardware: pc-troy (Win11 / Node 22)</span></div>
              <div class="term-line"><span class="term-ts">[15:33:02]</span> <span class="term-tag-success">[STANDBY]</span> <span class="term-cmd">Click &ldquo;Run Live Voice Demo&rdquo; to execute hands workflow.</span></div>
            </div>
          </div>

          <!-- Right: Live Interactive App Viewport -->
          <div class="viewport-window">
            <div class="viewport-titlebar">
              <div class="window-controls">
                <div class="window-dot dot-red"></div>
                <div class="window-dot dot-yellow"></div>
                <div class="window-dot dot-green"></div>
              </div>
              <div class="viewport-urlbar">
                <span class="lock-icon">&#128274;</span>
                <span id="viewportUrl">http://localhost:3000/hauling-service</span>
              </div>
              <div style="font-size: 0.7rem; color: #00ff88; font-weight: 700; letter-spacing: 0.5px;">
                ● LIVE SPOKE OUTPUT
              </div>
            </div>

            <div class="viewport-body" id="viewportContent">
              <!-- Rendered Live Hauling App -->
              <div class="hauling-app" id="haulingAppDemo">
                <div class="hauling-header">
                  <div class="hauling-logo">
                    <span>⚡ APEX HAULING &amp; RIGGING</span>
                  </div>
                  <div class="hauling-dispatch-status">
                    ● 12 Lowboys Available
                  </div>
                </div>

                <div class="hauling-hero">
                  <h4>Heavy Equipment &amp; Over-Dimensional Transport</h4>
                  <p>Permitted lowboys, hydraulic RGNs, and multi-axle freight nationwide.</p>
                </div>

                <!-- Live Rate Calculator -->
                <div class="rate-calculator-card">
                  <div class="calc-title">
                    <span>Instant Freight Rate Calculator</span>
                    <span style="font-size: 0.68rem; color: #00d4ff;">LIVE API</span>
                  </div>
                  <div class="calc-slider-group">
                    <div class="calc-slider-label">
                      <span>Payload Weight:</span>
                      <strong id="weightVal">48,500 lbs (CAT 349 Excavator)</strong>
                    </div>
                    <input type="range" class="calc-range-input" id="weightSlider" min="20000" max="85000" step="500" value="48500" oninput="updateRateCalc()" />
                  </div>
                  <div class="calc-slider-group">
                    <div class="calc-slider-label">
                      <span>Transport Distance:</span>
                      <strong id="distVal">450 miles (Jerome, ID &rarr; Burley, ID)</strong>
                    </div>
                    <input type="range" class="calc-range-input" id="distSlider" min="50" max="1500" step="25" value="450" oninput="updateRateCalc()" />
                  </div>
                  <div class="calc-result-box">
                    <div>
                      <div class="calc-result-val" id="quoteVal">$3,620</div>
                      <div class="calc-result-sub">Includes Oversize Permit &amp; Escort Pilot</div>
                    </div>
                    <button class="btn-dispatch-haul" type="button" onclick="reserveHaul()">
                      Request Dispatch Hold
                    </button>
                  </div>
                </div>

                <!-- Specs -->
                <div class="hauling-specs">
                  <div class="spec-pill">
                    <div class="spec-pill-title">Fleet Spec</div>
                    <div class="spec-pill-val">4-Axle RGN</div>
                  </div>
                  <div class="spec-pill">
                    <div class="spec-pill-title">Max Capacity</div>
                    <div class="spec-pill-val">110,000 lbs</div>
                  </div>
                  <div class="spec-pill">
                    <div class="spec-pill-title">Escort Coverage</div>
                    <div class="spec-pill-val">48 States</div>
                  </div>
                </div>

                <div class="spoke-generated-tag">
                  <span>⚡ Generated &amp; Deployed in 1.4s by Mark Hands Spoke Engine</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 3-Step Architecture Cards -->
        <div class="hands-architecture-grid">
          <div class="hands-arch-card">
            <div class="arch-step-num">01</div>
            <h4>Natural Voice Intent</h4>
            <p>Speak naturally into your Android phone or workstation. No syntax prompts, no prompt engineering. Mark grasps context and formulates real execution plans.</p>
          </div>
          <div class="hands-arch-card">
            <div class="arch-step-num">02</div>
            <h4>Encrypted Spoke Relay</h4>
            <p>Commands dispatch through an authenticated WebSocket to your local workstation running <code>Helmion.exe</code>. Your code, databases, and credentials never touch a public cloud.</p>
          </div>
          <div class="hands-arch-card">
            <div class="arch-step-num">03</div>
            <h4>Tangible Running Software</h4>
            <p>Mark writes files, installs npm packages, runs local compilers, executes tests, and spins up live server viewports right before your eyes.</p>
          </div>
        </div>

      </div>
    </section>`;

html = html.replace(targetSection, newHandsSection);

// 4. Update mark-companion so it starts minimized as a discrete floating badge
html = html.replace('<aside id="mark-companion"', '<aside id="mark-companion" class="minimized"');

// 5. Add Interactive Hands & 3D Constellation JavaScript before </body>
const handsScript = `
  <script>
    /* ── 3D CONSTELLATION MOTION GRAPHICS ENGINE ── */
    (function initHandsConstellation() {
      const canvas = document.getElementById('handsConstellationCanvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      let width, height;
      let particles = [];
      let mouse = { x: null, y: null, maxDist: 130 };

      function resize() {
        const section = document.getElementById('hands');
        if (!section) return;
        width = canvas.width = section.clientWidth;
        height = canvas.height = section.clientHeight;
        createParticles();
      }

      function createParticles() {
        particles = [];
        const count = Math.min(Math.floor((width * height) / 9500), 100);
        for (let i = 0; i < count; i++) {
          particles.push({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.55,
            vy: (Math.random() - 0.5) * 0.55,
            radius: Math.random() * 2 + 1.2,
            baseAlpha: Math.random() * 0.5 + 0.3,
            pulseOffset: Math.random() * Math.PI * 2
          });
        }
      }

      window.addEventListener('resize', resize);
      window.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          mouse.x = e.clientX - rect.left;
          mouse.y = e.clientY - rect.top;
        } else {
          mouse.x = null;
          mouse.y = null;
        }
      });

      let time = 0;
      function animate() {
        time += 0.02;
        ctx.clearRect(0, 0, width, height);

        // Draw connections
        for (let i = 0; i < particles.length; i++) {
          const p1 = particles[i];
          for (let j = i + 1; j < particles.length; j++) {
            const p2 = particles[j];
            const dx = p1.x - p2.x;
            const dy = p1.y - p2.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 115) {
              const alpha = (1 - dist / 115) * 0.28;
              ctx.strokeStyle = \`rgba(0, 212, 255, \${alpha})\`;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.stroke();

              // Energy pulse packet traveling between nodes
              if ((i + j) % 7 === 0) {
                const packetT = (time * 0.8 + (i * 0.2)) % 1;
                const px = p1.x + (p2.x - p1.x) * packetT;
                const py = p1.y + (p2.y - p1.y) * packetT;
                ctx.fillStyle = 'rgba(0, 255, 136, 0.7)';
                ctx.beginPath();
                ctx.arc(px, py, 1.8, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }

          // Mouse proximity pull
          if (mouse.x !== null) {
            const mdx = p1.x - mouse.x;
            const mdy = p1.y - mouse.y;
            const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
            if (mDist < mouse.maxDist) {
              const force = (1 - mDist / mouse.maxDist) * 0.4;
              p1.x -= (mdx / mDist) * force * 1.5;
              p1.y -= (mdy / mDist) * force * 1.5;
            }
          }

          // Move
          p1.x += p1.vx;
          p1.y += p1.vy;
          if (p1.x < 0) p1.x = width;
          if (p1.x > width) p1.x = 0;
          if (p1.y < 0) p1.y = height;
          if (p1.y > height) p1.y = 0;

          // Draw node
          const pulse = Math.sin(time + p1.pulseOffset) * 0.2;
          ctx.fillStyle = \`rgba(0, 212, 255, \${Math.max(0.1, p1.baseAlpha + pulse)})\`;
          ctx.beginPath();
          ctx.arc(p1.x, p1.y, p1.radius, 0, Math.PI * 2);
          ctx.fill();
        }

        requestAnimationFrame(animate);
      }

      resize();
      animate();
    })();

    /* ── HANDS WORKBENCH LOGIC & AUDIO ORCHESTRATION ── */
    let currentHandsScenario = 'hauling';
    let isHandsDemoRunning = false;

    function selectHandsScenario(type) {
      if (isHandsDemoRunning) return;
      currentHandsScenario = type;

      document.querySelectorAll('.scenario-tab').forEach(t => t.classList.remove('active'));
      const activeTab = document.getElementById('tab' + type.charAt(0).toUpperCase() + type.slice(1));
      if (activeTab) activeTab.classList.add('active');

      const termFounder = document.getElementById('termFounderText');
      const termMark = document.getElementById('termMarkText');
      const termPath = document.getElementById('termPathDisplay');
      const viewportUrl = document.getElementById('viewportUrl');

      if (type === 'hauling') {
        termFounder.innerHTML = '&ldquo;Hey Mark, can you build me a landing page for our equipment hauling service?&rdquo;';
        termMark.innerHTML = '&ldquo;Spoke connected to pc-troy. Scaffolding responsive layout, wiring the live freight calculator, and launching the preview now.&rdquo;';
        termPath.textContent = 'spoke@pc-troy: ~/projects/apex-hauling';
        viewportUrl.textContent = 'http://localhost:3000/hauling-service';
        renderHaulingViewport();
      } else if (type === 'dispatch') {
        termFounder.innerHTML = '&ldquo;Hey Mark, mock up a mobile route dispatch screen with real-time GPS coordinates and bay status.&rdquo;';
        termMark.innerHTML = '&ldquo;Opening mobile viewport spec. Generating route telemetry HUD, live GPS card, and load confirmation modal on pc-troy.&rdquo;';
        termPath.textContent = 'spoke@pc-troy: ~/apps/driver-dispatch';
        viewportUrl.textContent = 'http://localhost:3000/mobile-dispatch';
        renderDispatchViewport();
      } else if (type === 'invoices') {
        termFounder.innerHTML = '&ldquo;Hey Mark, pull our unpaid equipment invoices and draft the client approvals.&rdquo;';
        termMark.innerHTML = '&ldquo;Querying PostgreSQL memory. Found four overdue accounts totaling $42,500. Generating PDF invoice packet now.&rdquo;';
        termPath.textContent = 'spoke@pc-troy: ~/finance/invoices';
        viewportUrl.textContent = 'http://localhost:3000/invoice-packet';
        renderInvoicesViewport();
      }
    }

    function runHandsDemo() {
      if (isHandsDemoRunning) return;
      isHandsDemoRunning = true;

      const btn = document.getElementById('btnRunHands');
      const termBody = document.getElementById('termBody');
      const termBadge = document.getElementById('termLiveBadge');
      const founderBubble = document.getElementById('termFounderBubble');
      const markBubble = document.getElementById('termMarkBubble');

      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
      termBadge.textContent = '● EXECUTING SPOKE';
      termBadge.style.color = '#f59e0b';
      termBadge.style.background = 'rgba(245, 158, 11, 0.15)';

      // Clear terminal to fresh execution
      termBody.innerHTML = '';
      markBubble.style.display = 'none';

      const audioF = document.getElementById('audioF_hands');
      const audioM = document.getElementById('audioM_hands');

      function addTermLine(tag, tagClass, text, delay) {
        return new Promise(resolve => {
          setTimeout(() => {
            const line = document.createElement('div');
            line.className = 'term-line';
            const now = new Date().toTimeString().split(' ')[0];
            line.innerHTML = \`<span class="term-ts">[\${now}]</span> <span class="\${tagClass}">\${tag}</span> <span class="term-cmd">\${text}</span>\`;
            termBody.appendChild(line);
            termBody.scrollTop = termBody.scrollHeight;
            resolve();
          }, delay);
        });
      }

      // Step 1: Founder speaks
      if (audioF) {
        audioF.currentTime = 0;
        audioF.play().catch(() => {});
      }

      addTermLine('[VOICE IN]', 'term-tag-info', 'Audio buffer captured via microphone (16 kHz PCM)', 200)
        .then(() => addTermLine('[WHISPER STT]', 'term-tag-info', 'Transcribed: "Hey Mark, can you build me a landing page for our equipment hauling service?"', 1200))
        .then(() => {
          // Step 2: Mark speaks
          setTimeout(() => {
            markBubble.style.display = 'flex';
            if (audioM) {
              audioM.currentTime = 0;
              audioM.play().catch(() => {});
            }
          }, 800);
          return addTermLine('[AGENT INTENT]', 'term-tag-cmd', 'Mapped to tool: spoke_scaffold_app("apex-hauling", template="freight")', 2000);
        })
        .then(() => addTermLine('[RELAY]', 'term-tag-info', 'Dispatched payload across WebSocket to pc-troy:8088', 900))
        .then(() => addTermLine('[HANDS EXEC]', 'term-tag-cmd', 'mkdir -p dist/hauling && cd dist/hauling', 800))
        .then(() => addTermLine('[HANDS EXEC]', 'term-tag-cmd', 'write_file("dist/hauling/index.html") [4.2 KB generated]', 800))
        .then(() => addTermLine('[HANDS EXEC]', 'term-tag-cmd', 'write_file("dist/hauling/styles.css") [7.8 KB styled]', 700))
        .then(() => addTermLine('[HANDS BUILD]', 'term-tag-cmd', 'npx vite build --outDir dist/hauling', 900))
        .then(() => addTermLine('[VITE OUTPUT]', 'term-tag-success', '✓ 14 modules transformed in 184ms. Bundle: 42.1 kB', 900))
        .then(() => addTermLine('[SPOKE RUNNER]', 'term-tag-success', 'Spawned static HTTP preview on http://localhost:3000/hauling-service', 700))
        .then(() => addTermLine('[COMPLETE]', 'term-tag-success', '⚡ Tangible running application mounted in viewport. Ready for interaction.', 600))
        .then(() => {
          termBadge.textContent = '● ACTIVE';
          termBadge.style.color = '#00ff88';
          termBadge.style.background = 'rgba(0, 255, 136, 0.15)';
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
          isHandsDemoRunning = false;
        });
    }

    /* Live Rate Calculator functions */
    function updateRateCalc() {
      const weight = parseInt(document.getElementById('weightSlider').value, 10);
      const dist = parseInt(document.getElementById('distSlider').value, 10);
      const weightVal = document.getElementById('weightVal');
      const distVal = document.getElementById('distVal');
      const quoteVal = document.getElementById('quoteVal');

      let desc = 'Standard Flatbed';
      if (weight > 45000 && weight <= 65000) desc = 'CAT 349 Excavator (RGN)';
      else if (weight > 65000) desc = 'Komatsu D85 Dozer (Heavy Spec)';
      else if (weight < 35000) desc = 'John Deere 644 Loader';

      weightVal.textContent = \`\${weight.toLocaleString()} lbs (\${desc})\`;
      distVal.textContent = \`\${dist} miles\`;

      // Rate: base + weight factor + distance rate
      const base = 750;
      const weightSurcharge = Math.max(0, (weight - 40000) * 0.045);
      const mileage = dist * 4.85;
      const total = Math.round(base + weightSurcharge + mileage);

      quoteVal.textContent = '$' + total.toLocaleString();
    }

    function reserveHaul() {
      const quote = document.getElementById('quoteVal').textContent;
      alert(\`🚛 Dispatch Hold Placed!\\n\\nPayload Quote: \${quote}\\nRoute RT-104 reserved at Bay 3.\\nDispatched via Mark Hands Spoke Relay.\`);
    }

    function renderHaulingViewport() {
      const container = document.getElementById('viewportContent');
      container.innerHTML = \`
        <div class="hauling-app" id="haulingAppDemo">
          <div class="hauling-header">
            <div class="hauling-logo"><span>⚡ APEX HAULING &amp; RIGGING</span></div>
            <div class="hauling-dispatch-status">● 12 Lowboys Available</div>
          </div>
          <div class="hauling-hero">
            <h4>Heavy Equipment &amp; Over-Dimensional Transport</h4>
            <p>Permitted lowboys, hydraulic RGNs, and multi-axle freight nationwide.</p>
          </div>
          <div class="rate-calculator-card">
            <div class="calc-title">
              <span>Instant Freight Rate Calculator</span>
              <span style="font-size: 0.68rem; color: #00d4ff;">LIVE API</span>
            </div>
            <div class="calc-slider-group">
              <div class="calc-slider-label">
                <span>Payload Weight:</span>
                <strong id="weightVal">48,500 lbs (CAT 349 Excavator)</strong>
              </div>
              <input type="range" class="calc-range-input" id="weightSlider" min="20000" max="85000" step="500" value="48500" oninput="updateRateCalc()" />
            </div>
            <div class="calc-slider-group">
              <div class="calc-slider-label">
                <span>Transport Distance:</span>
                <strong id="distVal">450 miles (Jerome, ID &rarr; Burley, ID)</strong>
              </div>
              <input type="range" class="calc-range-input" id="distSlider" min="50" max="1500" step="25" value="450" oninput="updateRateCalc()" />
            </div>
            <div class="calc-result-box">
              <div>
                <div class="calc-result-val" id="quoteVal">$3,620</div>
                <div class="calc-result-sub">Includes Oversize Permit &amp; Escort Pilot</div>
              </div>
              <button class="btn-dispatch-haul" type="button" onclick="reserveHaul()">Request Dispatch Hold</button>
            </div>
          </div>
          <div class="hauling-specs">
            <div class="spec-pill"><div class="spec-pill-title">Fleet Spec</div><div class="spec-pill-val">4-Axle RGN</div></div>
            <div class="spec-pill"><div class="spec-pill-title">Max Capacity</div><div class="spec-pill-val">110,000 lbs</div></div>
            <div class="spec-pill"><div class="spec-pill-title">Escort Coverage</div><div class="spec-pill-val">48 States</div></div>
          </div>
          <div class="spoke-generated-tag"><span>⚡ Generated &amp; Deployed in 1.4s by Mark Hands Spoke Engine</span></div>
        </div>
      \`;
    }

    function renderDispatchViewport() {
      const container = document.getElementById('viewportContent');
      container.innerHTML = \`
        <div style="padding: 20px; font-family: -apple-system, sans-serif; color: #fff;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px;">
            <div>
              <div style="font-size: 0.95rem; font-weight: 800; color: #00d4ff;">FORGE DISPATCH &bull; ROUTE 104</div>
              <div style="font-size: 0.72rem; color: #64748b;">Driver: Troy &bull; Tractor #14</div>
            </div>
            <div style="background: rgba(0,255,136,0.15); border: 1px solid #00ff88; color: #00ff88; font-size: 0.72rem; padding: 3px 10px; border-radius: 999px; font-weight: 700;">
              EN ROUTE
            </div>
          </div>
          <div style="background: rgba(15,23,42,0.9); border: 1px solid rgba(0,212,255,0.3); border-radius: 10px; padding: 14px; margin-bottom: 14px;">
            <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 4px;">ACTIVE COMMODITY</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: #fff;">48,500 lbs Raw Grade-A Milk</div>
            <div style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 0.78rem;">
              <span>Origin: <strong>Jerome, ID (Bay 3)</strong></span>
              <span>Dest: <strong>Twin Falls, ID</strong></span>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;">
            <div style="background: rgba(255,255,255,0.04); border-radius: 8px; padding: 10px; text-align: center;">
              <div style="font-size: 0.68rem; color: #64748b;">DISPATCH RATE</div>
              <div style="font-size: 1.1rem; font-weight: 800; color: #00ff88;">$850.00</div>
            </div>
            <div style="background: rgba(255,255,255,0.04); border-radius: 8px; padding: 10px; text-align: center;">
              <div style="font-size: 0.68rem; color: #64748b;">TEMP SENSOR</div>
              <div style="font-size: 1.1rem; font-weight: 800; color: #00d4ff;">36.4&deg;F (Normal)</div>
            </div>
          </div>
          <div style="text-align: center; font-size: 0.7rem; color: #475569;">
            <span>⚡ Scaffolded on pc-troy via Helmion Hands in 1.18s</span>
          </div>
        </div>
      \`;
    }

    function renderInvoicesViewport() {
      const container = document.getElementById('viewportContent');
      container.innerHTML = \`
        <div style="padding: 20px; font-family: -apple-system, sans-serif; color: #fff;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px;">
            <div style="font-size: 0.95rem; font-weight: 800; color: #f59e0b;">ACCOUNTS RECEIVABLE RECONCILE</div>
            <div style="font-size: 0.72rem; color: #00ff88; font-weight: 700;">4 ACCOUNTS FLAGGED</div>
          </div>
          <div style="background: rgba(15,23,42,0.9); border: 1px solid rgba(245,158,11,0.3); border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 0.85rem;">Western Ag Transport LLC</div>
              <div style="font-size: 0.72rem; color: #64748b;">Inv #4182 &bull; 18 days overdue</div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 800; color: #f59e0b; font-size: 0.95rem;">$14,200.00</div>
              <button style="background: rgba(0,212,255,0.15); border: 1px solid #00d4ff; color: #00d4ff; font-size: 0.68rem; padding: 2px 8px; border-radius: 4px; cursor: pointer; margin-top: 4px;" onclick="alert('Sent approval packet!')">Send Packet</button>
            </div>
          </div>
          <div style="background: rgba(15,23,42,0.9); border: 1px solid rgba(245,158,11,0.3); border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 0.85rem;">Snake River Dairy Haulers</div>
              <div style="font-size: 0.72rem; color: #64748b;">Inv #4190 &bull; 12 days overdue</div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 800; color: #f59e0b; font-size: 0.95rem;">$28,300.00</div>
              <button style="background: rgba(0,212,255,0.15); border: 1px solid #00d4ff; color: #00d4ff; font-size: 0.68rem; padding: 2px 8px; border-radius: 4px; cursor: pointer;" onclick="alert('Sent approval packet!')">Send Packet</button>
            </div>
          </div>
          <div style="text-align: center; font-size: 0.7rem; color: #475569; margin-top: 14px;">
            <span>⚡ Reconciled from PostgreSQL Memory in 0.84s</span>
          </div>
        </div>
      \`;
    }

    window.selectHandsScenario = selectHandsScenario;
    window.runHandsDemo = runHandsDemo;
    window.updateRateCalc = updateRateCalc;
    window.reserveHaul = reserveHaul;
  </script>
`;

html = html.replace('</body>', handsScript + '\n</body>');

fs.writeFileSync(indexPath, html, 'utf-8');
console.log('Successfully upgraded index.html with Hands Workbench & 3D Constellation inside <style>!');
