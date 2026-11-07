import fs from 'fs';

const htmlPath = 'E:/CapstoneFoundry/index.html';
let html = fs.readFileSync(htmlPath, 'utf8');

// 1. Update Head Favicon & Meta Images
const oldHeadFavicon = `<link rel="icon" type="image/svg+xml" href="/icon.svg">`;
const newHeadFavicon = `<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
  <link rel="icon" type="image/png" sizes="48x48" href="/favicon.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <meta property="og:image" content="https://www.capstonefoundry.cloud/brand/capstone-limestone-master.png">
  <meta name="twitter:image" content="https://www.capstonefoundry.cloud/brand/capstone-limestone-master.png">`;

if (html.includes(oldHeadFavicon)) {
  html = html.replace(oldHeadFavicon, newHeadFavicon);
}

// 2. Update Navbar Logo to use Limestone Master Artwork
const oldNavbarLogo = `<div class="logo-badge">CF</div>`;
const newNavbarLogo = `<img src="/icon-192.png" alt="Capstone Foundry Logo" style="width: 34px; height: 34px; border-radius: 8px; object-fit: cover; box-shadow: 0 0 12px rgba(255, 180, 50, 0.45); border: 1px solid rgba(255, 200, 100, 0.3);" />`;

if (html.includes(oldNavbarLogo)) {
  html = html.replace(oldNavbarLogo, newNavbarLogo);
}

// 3. Patch Companion CSS to use Discrete Floating Action Button (FAB) pattern that NEVER obstructs
const oldCompCssRegex = /\/\* ── DOCKED FLOATING COMPANION WIDGET[\s\S]*?(?=\/\* ── HELMION HANDS LIVE WORKBENCH)/;

const newCompCss = `/* ── DISCRETE FLOATING COMPANION (NON-OBSTRUCTIVE FAB + MODAL DRAWER) ── */
    #mark-fab-trigger {
      position: fixed;
      right: 1.5rem;
      bottom: 1.5rem;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0f172a, #020617);
      border: 2px solid #00d4ff;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7), 0 0 16px rgba(0, 212, 255, 0.4);
      cursor: pointer;
      z-index: 9998;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    #mark-fab-trigger:hover {
      transform: scale(1.1);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.85), 0 0 24px rgba(0, 212, 255, 0.7);
    }
    #mark-fab-trigger img {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      object-fit: cover;
    }
    #mark-fab-trigger .fab-pulse {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #00ff88;
      border: 2px solid #020617;
      animation: pulse-green 2s infinite;
    }
    @keyframes pulse-green {
      0% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0.7); }
      70% { box-shadow: 0 0 0 8px rgba(0, 255, 136, 0); }
      100% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0); }
    }

    #mark-companion {
      position: fixed;
      right: 1.5rem;
      bottom: 5.5rem;
      width: min(340px, calc(100vw - 2rem));
      max-height: min(600px, calc(100vh - 7rem));
      display: flex;
      flex-direction: column;
      background: rgba(8, 12, 20, 0.96);
      border: 1px solid rgba(0, 212, 255, 0.4);
      border-radius: 18px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.85), 0 0 35px rgba(0, 212, 255, 0.2);
      backdrop-filter: blur(20px);
      overflow: hidden;
      z-index: 9999;
      opacity: 0;
      transform: translateY(20px) scale(0.95);
      pointer-events: none;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    #mark-companion.active {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    .comp-header {
      background: linear-gradient(135deg, rgba(0, 212, 255, 0.15), rgba(139, 92, 246, 0.1));
      border-bottom: 1px solid rgba(0, 212, 255, 0.2);
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      user-select: none;
    }
    .comp-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .comp-avatar-mini {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 1.5px solid #00d4ff;
      overflow: hidden;
      flex-shrink: 0;
    }
    .comp-avatar-mini.speaking {
      border-color: #00ff88 !important;
      box-shadow: 0 0 10px rgba(0, 255, 136, 0.6);
    }
    .comp-name {
      font-size: 0.85rem;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .comp-tag {
      font-size: 0.65rem;
      background: rgba(0, 212, 255, 0.2);
      color: #00d4ff;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }
    .comp-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #00ff88;
      box-shadow: 0 0 6px #00ff88;
    }
    .comp-close-btn {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 1.1rem;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .comp-close-btn:hover { color: #fff; background: rgba(239, 68, 68, 0.3); border-color: rgba(239, 68, 68, 0.5); }

    /* Companion Body */
    .comp-body {
      padding: 12px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .comp-bubble {
      padding: 10px 12px;
      border-radius: 12px;
      font-size: 0.8rem;
      line-height: 1.45;
      animation: fadeIn 0.2s ease;
    }
    .comp-bubble-founder {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #cbd5e1;
      align-self: flex-end;
      border-bottom-right-radius: 2px;
    }
    .comp-bubble-mark {
      background: rgba(0, 212, 255, 0.07);
      border: 1px solid rgba(0, 212, 255, 0.25);
      color: #e2e8f0;
      align-self: flex-start;
      border-bottom-left-radius: 2px;
    }
    .comp-bubble-label {
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .comp-bubble-founder .comp-bubble-label { color: #94a3b8; }
    .comp-bubble-mark .comp-bubble-label { color: #00d4ff; }
    
    .comp-scenarios {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
    }
    .comp-scenarios-title {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      font-weight: 700;
      margin-bottom: 2px;
    }
    .comp-scenario-chip {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 0.75rem;
      color: #94a3b8;
      cursor: pointer;
      transition: all 0.2s ease;
      text-align: left;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .comp-scenario-chip:hover {
      background: rgba(0, 212, 255, 0.1);
      border-color: rgba(0, 212, 255, 0.3);
      color: #00d4ff;
    }
    .comp-scenario-chip.active {
      background: rgba(0, 212, 255, 0.15);
      border-color: #00d4ff;
      color: #fff;
    }

    /* Companion Footer */
    .comp-footer {
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      padding: 10px 12px;
      background: rgba(0, 0, 0, 0.2);
    }
    .comp-input-row {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;
    }
    .comp-input {
      flex: 1;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 0.75rem;
      color: #fff;
      outline: none;
      font-family: inherit;
    }
    .comp-input:focus {
      border-color: #00d4ff;
      background: rgba(0, 212, 255, 0.04);
    }
    .comp-btn-send {
      background: #00d4ff;
      color: #000;
      border: none;
      border-radius: 8px;
      padding: 0 12px;
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .comp-btn-send:hover {
      box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
    }
    .comp-audio-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.7rem;
      color: #64748b;
    }
    .comp-btn-play-all {
      background: rgba(0, 212, 255, 0.1);
      border: 1px solid rgba(0, 212, 255, 0.3);
      color: #00d4ff;
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 0.7rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .comp-btn-play-all:hover {
      background: #00d4ff;
      color: #000;
    }
    .comp-live-link {
      color: #64748b;
      text-decoration: none;
      font-size: 0.7rem;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .comp-live-link:hover { color: #00d4ff; text-decoration: underline; }

    @media (max-width: 768px) {
      .hero h1 { font-size: 2.4rem; }
      nav .nav-links { display: none; }
      #mark-companion { right: 0.75rem; bottom: 4.5rem; width: calc(100vw - 1.5rem); max-height: 65vh; }
    }
  
    `;

html = html.replace(oldCompCssRegex, newCompCss);

// 4. Update the Companion HTML structure to include the FAB and Close Button
const oldCompanionMarkupRegex = /<aside id="mark-companion"[\s\S]*?<\/aside>/;

const newCompanionMarkup = `<!-- Floating Action Button (Zero Content Obstruction) -->
  <div id="mark-fab-trigger" title="Ask Mark (Executive AI)" aria-label="Open Mark Companion">
    <img src="/mark-avatar.jpg" alt="Mark AI" />
    <span class="fab-pulse"></span>
  </div>

  <aside id="mark-companion" aria-label="Mark Executive Pair Programmer Demo">
    <!-- Header -->
    <div class="comp-header">
      <div class="comp-title">
        <div class="comp-avatar-mini">
          <img id="compAvatarImg" src="/mark-avatar.jpg" alt="Mark" style="width:100%; height:100%; object-fit:cover; display:block;" />
        </div>
        <div>
          <div class="comp-name">Mark <span class="comp-tag">Executive AI</span></div>
          <div style="display:flex; align-items:center; gap:5px; font-size:0.7rem; color:#94a3b8;">
            <span class="comp-status-dot"></span>
            <span id="compStatusText">Live Interactive Demo</span>
          </div>
        </div>
      </div>
      <button class="comp-close-btn" id="compCloseBtn" type="button" aria-label="Close Companion">&times;</button>
    </div>

    <!-- Body -->
    <div class="comp-body">
      <!-- Guard Shield Notice -->
      <div style="display:flex; align-items:center; gap:6px; font-size:0.65rem; color:#00ff88; background:rgba(0,255,136,0.06); padding:4px 8px; border-radius:6px; border:1px solid rgba(0,255,136,0.15);">
        <span>&#128737;</span> Protected by <strong>Helmian Guard</strong> embed
      </div>

      <!-- Dialogue History -->
      <div class="comp-bubble comp-bubble-founder">
        <div class="comp-bubble-label">FOUNDER:</div>
        <div id="compFounderText">&ldquo;Mark, I want to launch a mobile equipment detailing business next week. What do I actually need to do first?&rdquo;</div>
      </div>

      <div class="comp-bubble comp-bubble-mark">
        <div class="comp-bubble-label">MARK (EXECUTIVE AI):</div>
        <div id="compMarkText">&ldquo;Don't buy expensive equipment yet. Call five commercial fleet managers, pitch weekly maintenance, and lock down two contracts. Once cash is in hand, we buy the trailer.&rdquo;</div>
      </div>

      <!-- Scenarios Selector -->
      <div class="comp-scenarios">
        <div class="comp-scenarios-title">Suggested Demonstrations</div>
        <button class="comp-scenario-chip active" data-scenario="1">
          <span>1. Starting a Business (No Degree)</span>
          <span>&rarr;</span>
        </button>
        <button class="comp-scenario-chip" data-scenario="2">
          <span>2. Hands: Invoices &amp; Approvals</span>
          <span>&rarr;</span>
        </button>
        <button class="comp-scenario-chip" data-scenario="3">
          <span>3. Memory: Supplier Pricing Recall</span>
          <span>&rarr;</span>
        </button>
      </div>
    </div>

    <!-- Footer Controls -->
    <div class="comp-footer">
      <form id="compChatForm" class="comp-input-row">
        <input type="text" id="compInput" class="comp-input" placeholder="Ask Mark or test injection..." autocomplete="off" />
        <button type="submit" class="comp-btn-send">Ask</button>
      </form>
      <div class="comp-audio-controls">
        <button id="compBtnPlayScenario" class="comp-btn-play-all">&#9654; Play Studio Voice</button>
        <a href="#features" class="comp-live-link">Explore Features &rarr;</a>
      </div>
    </div>
  </aside>`;

html = html.replace(oldCompanionMarkupRegex, newCompanionMarkup);

// 5. Update JS handlers for FAB and Close button
const oldJsRegex = /\/\/ Minimize \/ Expand[\s\S]*?if \(compMinBtn\)[\s\S]*?;/;
const newJs = `// FAB Trigger and Modal Logic
    const fabTrigger = document.getElementById('mark-fab-trigger');
    const compPanel = document.getElementById('mark-companion');
    const compCloseBtn = document.getElementById('compCloseBtn');

    if (fabTrigger && compPanel) {
      fabTrigger.onclick = () => {
        compPanel.classList.toggle('active');
      };
    }
    if (compCloseBtn && compPanel) {
      compCloseBtn.onclick = () => {
        compPanel.classList.remove('active');
      };
    }`;

html = html.replace(oldJsRegex, newJs);

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Successfully updated index.html with Limestone logo and discrete FAB companion!');
