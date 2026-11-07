import fs from 'fs';

let content = fs.readFileSync('E:/CapstoneFoundry/public/landing.html', 'utf8');

// Replace the mock SVG with the real photo in public/landing.html
const oldAvatarInit = `// Executive digital avatar SVG
      const avatarSvg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><defs><linearGradient id='bg' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='%230f2b38'/><stop offset='100%' stop-color='%23061219'/></linearGradient><linearGradient id='skin' x1='0%' y1='0%' x2='0%' y2='100%'><stop offset='0%' stop-color='%23d9ad8b'/><stop offset='100%' stop-color='%23b88968'/></linearGradient></defs><rect width='96' height='96' fill='url(%23bg)'/><circle cx='48' cy='42' r='20' fill='url(%23skin)'/><path d='M28,36 Q48,20 68,36 Q48,28 28,36 Z' fill='%231e293b'/><circle cx='41' cy='40' r='2' fill='%230f172a'/><circle cx='55' cy='40' r='2' fill='%230f172a'/><path d='M42,52 Q48,56 54,52' stroke='%2378350f' stroke-width='1.5' fill='none'/><path d='M24,82 Q48,64 72,82 L78,96 L18,96 Z' fill='%230284c7'/></svg>";
      avatarEngine.loadPhoto(avatarSvg);`;

const newAvatarInit = `// Real high-definition photo for Mark
      avatarEngine.loadPhoto('/mark-avatar.jpg');`;

if (content.includes(oldAvatarInit)) {
  content = content.replace(oldAvatarInit, newAvatarInit);
}

// Replace scenarios and audio player with ElevenLabs studio audio player
const oldAudioSection = `    // 2. Multi-Voice Pre-configured Scenarios with Hands Site Navigation
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
    }`;

const newAudioSection = `    // 2. Real ElevenLabs Studio Audio for Mark & Founder
    const scenarios = {
      1: {
        targetId: 'features',
        q: '"Mark, I want to launch a mobile equipment detailing business next week. What do I actually need to do first?"',
        a: '"Don\'t buy expensive equipment yet. Call five commercial fleet managers, pitch weekly maintenance, and lock down two contracts. Once cash is in hand, we buy the trailer."',
        founderAudio: '/audio/demo/demo1_founder.mp3',
        markAudio: '/audio/demo/demo1_mark.mp3'
      },
      2: {
        targetId: 'hands',
        q: '"Mark, pull our unpaid invoices from last month and draft follow-up reminders."',
        a: '"Done. Found four overdue accounts totaling twelve thousand four hundred dollars. Drafted the follow-ups with invoice attachments; check your queue for approval."',
        founderAudio: '/audio/demo/demo2_founder.mp3',
        markAudio: '/audio/demo/demo2_mark.mp3'
      },
      3: {
        targetId: 'feat-memory',
        q: '"Mark, what did we agree on with the supplier pricing when we talked two weeks ago?"',
        a: '"We agreed on a fifteen percent volume discount if we hit five hundred units a month, with thirty-day payment terms locked in through December."',
        founderAudio: '/audio/demo/demo3_founder.mp3',
        markAudio: '/audio/demo/demo3_mark.mp3'
      }
    };

    let activeScenario = 1;
    let currentAudio = null;

    function applyScenario(id, autoPlay = true) {
      activeScenario = id;
      const data = scenarios[id];
      if (!data) return;

      // Update pills UI
      [1, 2, 3].forEach(n => {
        const btn = document.getElementById('pill' + n);
        if (btn) btn.classList.toggle('active', n === id);
      });

      // Update Dialog text
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
        playStudioDialogue(data);
      }
    }

    // Studio ElevenLabs Audio Player (Real Voices, Zero Robotic TTS)
    function playStudioDialogue(data) {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
      if (avatarEngine) avatarEngine.stopLipSync();

      const statusText = document.getElementById('compStatusText');
      if (statusText) statusText.textContent = 'Speaking: Founder';

      // Step 1: Founder Audio
      const audioFounder = new Audio(data.founderAudio);
      currentAudio = audioFounder;

      audioFounder.onended = () => {
        if (statusText) statusText.textContent = 'Mark Speaking...';
        // Step 2: Mark (Brian ElevenLabs) Audio
        const audioMark = new Audio(data.markAudio);
        currentAudio = audioMark;

        audioMark.onplay = () => {
          if (avatarEngine) avatarEngine.startLipSync(32);
        };
        audioMark.onended = () => {
          if (statusText) statusText.textContent = 'Live Interactive Demo';
          if (avatarEngine) avatarEngine.stopLipSync();
        };
        audioMark.onerror = () => {
          if (statusText) statusText.textContent = 'Live Interactive Demo';
          if (avatarEngine) avatarEngine.stopLipSync();
        };
        audioMark.play().catch(e => console.warn('Autoplay blocked:', e));
      };

      audioFounder.play().catch(e => console.warn('Autoplay blocked:', e));
    }`;

content = content.replace(oldAudioSection, newAudioSection);

// Update button names and labels
content = content.replace('⚡ 1. Hands: Audit Telemetry', '1. Starting a Business (No Degree)');
content = content.replace('🧠 2. Memory: Past Sessions', '2. Hands: Invoices & Approvals');
content = content.replace('🛡️ 3. Safety: Guard Injection Defense', '3. Memory: Supplier Pricing Recall');
content = content.replace('▶ Play Dialogue Audio', '▶ Play Studio Voice Dialogue');

fs.writeFileSync('E:/CapstoneFoundry/public/landing.html', content, 'utf8');
console.log('landing.html updated with real ElevenLabs studio audio and HD photo!');
