import fs from 'fs';

let html = fs.readFileSync('E:/CapstoneFoundry/public/landing.html', 'utf8');

// 1. ANONYMIZE: Remove pc-troy and any Troy references
html = html.replaceAll('pc-troy', 'workstation-secure');
html = html.replaceAll('pc-Troy', 'workstation-secure');
html = html.replaceAll('Troy', 'Executive');

// 2. Fix the default dialog text in HTML so it is never the old telemetry text
const oldDialogHtml = `<div class="dialog-msg interviewer" id="msgInterviewer">
          <span class="dialog-speaker interviewer">Executive / Founder:</span>
          <span class="dialog-text" id="txtInterviewer">"Hey Mark, can you check our server telemetry and run the morning health audit?"</span>
        </div>
        <div class="dialog-msg mark" id="msgMark">
          <span class="dialog-speaker mark">Mark (Executive Pair Programmer):</span>
          <span class="dialog-text" id="txtMark">"Spoke connected to workstation-secure. Telemetry is green — 49,388 memories indexed, latency is 280 milliseconds, and Helmian Guard is active."</span>
        </div>`;

const newDialogHtml = `<div class="dialog-msg interviewer" id="msgInterviewer">
          <span class="dialog-speaker interviewer">Founder:</span>
          <span class="dialog-text" id="txtInterviewer">"Mark, I want to launch a mobile equipment detailing business next week. What do I actually need to do first?"</span>
        </div>
        <div class="dialog-msg mark" id="msgMark">
          <span class="dialog-speaker mark">Mark (Executive AI):</span>
          <span class="dialog-text" id="txtMark">"Don't buy expensive equipment yet. Call five commercial fleet managers, pitch weekly maintenance, and lock down two contracts. Once cash is in hand, we buy the trailer."</span>
        </div>`;

if (html.includes(oldDialogHtml)) {
  html = html.replace(oldDialogHtml, newDialogHtml);
} else {
  // Try regex replace if spacing differed
  html = html.replace(
    /<div class="dialog-msg interviewer" id="msgInterviewer">[\s\S]*?<\/div>\s*<div class="dialog-msg mark" id="msgMark">[\s\S]*?<\/div>/,
    newDialogHtml
  );
}

// 3. Inject preloaded DOM audio tags directly into the page
const domAudioTags = `
    <!-- Preloaded Studio ElevenLabs Audio (Sarah & Brian) -->
    <audio id="audioF1" src="/audio/demo/demo1_founder.mp3" preload="auto"></audio>
    <audio id="audioM1" src="/audio/demo/demo1_mark.mp3" preload="auto"></audio>
    <audio id="audioF2" src="/audio/demo/demo2_founder.mp3" preload="auto"></audio>
    <audio id="audioM2" src="/audio/demo/demo2_mark.mp3" preload="auto"></audio>
    <audio id="audioF3" src="/audio/demo/demo3_founder.mp3" preload="auto"></audio>
    <audio id="audioM3" src="/audio/demo/demo3_mark.mp3" preload="auto"></audio>
`;

if (!html.includes('id="audioF1"')) {
  html = html.replace('<aside id="mark-companion"', domAudioTags + '\n  <aside id="mark-companion"');
}

// 4. Bulletproof the audio playing logic using the preloaded DOM elements
const scriptSection = `
  <script type="module">
    // Direct DOM Audio Scenario Controller
    const scenarios = {
      1: {
        fId: 'audioF1',
        mId: 'audioM1',
        targetId: 'features',
        q: '"Mark, I want to launch a mobile equipment detailing business next week. What do I actually need to do first?"',
        a: '"Don\'t buy expensive equipment yet. Call five commercial fleet managers, pitch weekly maintenance, and lock down two contracts. Once cash is in hand, we buy the trailer."'
      },
      2: {
        fId: 'audioF2',
        mId: 'audioM2',
        targetId: 'hands',
        q: '"Mark, pull our unpaid invoices from last month and draft follow-up reminders."',
        a: '"Done. Found four overdue accounts totaling twelve thousand four hundred dollars. Drafted the follow-ups with invoice attachments; check your queue for approval."'
      },
      3: {
        fId: 'audioF3',
        mId: 'audioM3',
        targetId: 'feat-memory',
        q: '"Mark, what did we agree on with the supplier pricing when we talked two weeks ago?"',
        a: '"We agreed on a fifteen percent volume discount if we hit five hundred units a month, with thirty-day payment terms locked in through December."'
      }
    };

    let activeScenario = 1;
    let currentlyPlaying = null;

    function stopAllAudio() {
      ['audioF1', 'audioM1', 'audioF2', 'audioM2', 'audioF3', 'audioM3'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.pause();
          el.currentTime = 0;
        }
      });
      const avatarBox = document.querySelector('.comp-avatar-mini');
      if (avatarBox) avatarBox.classList.remove('speaking');
      const statusText = document.getElementById('compStatusText');
      if (statusText) statusText.textContent = 'Live Interactive Demo';
      const playBtn = document.getElementById('compPlayBtn');
      if (playBtn) playBtn.innerHTML = '▶ Play Studio Voice Dialogue';
      currentlyPlaying = null;
    }

    function playScenarioAudio(id) {
      stopAllAudio();
      const sc = scenarios[id];
      if (!sc) return;

      const fEl = document.getElementById(sc.fId);
      const mEl = document.getElementById(sc.mId);
      const statusText = document.getElementById('compStatusText');
      const playBtn = document.getElementById('compPlayBtn');
      const avatarBox = document.querySelector('.comp-avatar-mini');

      if (!fEl || !mEl) {
        console.error('Audio elements missing');
        return;
      }

      currentlyPlaying = fEl;
      if (statusText) statusText.textContent = 'Speaking: Founder';
      if (playBtn) playBtn.innerHTML = '🔊 Founder Speaking...';

      fEl.onended = () => {
        currentlyPlaying = mEl;
        if (statusText) statusText.textContent = 'Mark Speaking...';
        if (playBtn) playBtn.innerHTML = '🎙️ Mark Speaking...';
        if (avatarBox) avatarBox.classList.add('speaking');

        mEl.onended = () => {
          stopAllAudio();
        };
        mEl.onerror = () => {
          stopAllAudio();
        };

        const mPromise = mEl.play();
        if (mPromise !== undefined) {
          mPromise.catch(e => {
            console.error('Mark audio play error:', e);
            stopAllAudio();
          });
        }
      };

      fEl.onerror = () => {
        console.error('Founder audio error');
        stopAllAudio();
      };

      const fPromise = fEl.play();
      if (fPromise !== undefined) {
        fPromise.catch(e => {
          console.error('Founder audio play error:', e);
          stopAllAudio();
        });
      }
    }

    function setScenario(id, autoPlay = true) {
      activeScenario = id;
      const sc = scenarios[id];
      if (!sc) return;

      // Update pills UI
      [1, 2, 3].forEach(n => {
        const btn = document.getElementById('pill' + n);
        if (btn) btn.classList.toggle('active', n === id);
      });

      // Update dialog text
      const txtQ = document.getElementById('txtInterviewer');
      const txtA = document.getElementById('txtMark');
      if (txtQ) txtQ.textContent = sc.q;
      if (txtA) txtA.textContent = sc.a;

      // Hands Navigation: Smooth scroll to target and pulse highlight
      if (sc.targetId) {
        const targetEl = document.getElementById(sc.targetId);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetEl.classList.remove('mark-highlight');
          void targetEl.offsetWidth;
          targetEl.classList.add('mark-highlight');
          setTimeout(() => targetEl.classList.remove('mark-highlight'), 3600);
        }
      }

      if (autoPlay) {
        playScenarioAudio(id);
      }
    }

    // Attach pill click events
    [1, 2, 3].forEach(id => {
      const btn = document.getElementById('pill' + id);
      if (btn) {
        btn.onclick = (e) => {
          e.preventDefault();
          setScenario(id, true);
        };
      }
    });

    // Attach play button
    const playBtn = document.getElementById('compPlayBtn');
    if (playBtn) {
      playBtn.onclick = (e) => {
        e.preventDefault();
        if (currentlyPlaying) {
          stopAllAudio();
        } else {
          playScenarioAudio(activeScenario);
        }
      };
    }

    // Minimize / Expand
    const compPanel = document.getElementById('mark-companion');
    const compToggle = document.getElementById('compToggleHeader');
    const compMinBtn = document.getElementById('compMinBtn');
    function toggleMin(e) {
      if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' && e.target !== compMinBtn) return;
      compPanel.classList.toggle('minimized');
      compMinBtn.textContent = compPanel.classList.contains('minimized') ? '▲' : '▼';
    }
    if (compToggle) compToggle.onclick = toggleMin;
    if (compMinBtn) compMinBtn.onclick = (e) => { e.stopPropagation(); toggleMin(e); };

    // Helmian Guard Input Shield
    const chatForm = document.getElementById('compChatForm');
    const chatInput = document.getElementById('compInput');
    if (chatForm && chatInput) {
      chatForm.onsubmit = async (e) => {
        e.preventDefault();
        const query = chatInput.value.trim();
        if (!query) return;

        chatInput.value = '';
        const txtQ = document.getElementById('txtInterviewer');
        const txtA = document.getElementById('txtMark');
        const statusText = document.getElementById('compStatusText');

        if (txtQ) txtQ.textContent = '"' + query + '"';
        if (statusText) statusText.textContent = 'Guard Screening...';

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

        const reply = "I received your command. In full session mode, this query dispatches directly to your desktop spoke with PostgreSQL memory retrieval.";
        if (txtA) txtA.textContent = '"' + reply + '"';
        if (statusText) statusText.textContent = 'Live Interactive Demo';
      };
    }
  </script>
`;

// Replace the old companion script
const oldScriptRegex = /<script type="module">[\s\S]*?<\/script>/;
html = html.replace(oldScriptRegex, scriptSection);

fs.writeFileSync('E:/CapstoneFoundry/public/landing.html', html, 'utf8');
console.log('Successfully rebuilt landing.html: pc-troy removed, DOM audio preloaded, synchronous click handlers wired!');
