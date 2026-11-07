import fs from 'fs';

let content = fs.readFileSync('E:/CapstoneFoundry/public/landing.html', 'utf8');

// 1. Fix the avatar element to be a guaranteed <img> tag
content = content.replace(
  '<canvas id="compAvatarCanvas" width="96" height="96"></canvas>',
  '<img id="compAvatarImg" src="/mark-avatar.jpg" alt="Mark" style="width:100%; height:100%; object-fit:cover; display:block;" />'
);

// 2. Add visual pulse CSS for Mark speaking
const cssToAdd = `
    .comp-avatar-mini.speaking {
      border-color: #00ff88 !important;
      box-shadow: 0 0 15px #00ff88, 0 0 25px rgba(0, 255, 136, 0.4) !important;
      transform: scale(1.08);
      transition: all 0.2s ease;
    }
`;
content = content.replace('.comp-avatar-mini {', cssToAdd + '\n    .comp-avatar-mini {');

// 3. Fix the function call and add alias
const oldPlayBtnCall = `    const playBtn = document.getElementById('compPlayBtn');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        const sc = scenarios[activeScenario];
        if (sc) playDialogue(sc);
      });
    }`;

const newPlayBtnCall = `    const playBtn = document.getElementById('compPlayBtn');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        const sc = scenarios[activeScenario];
        if (sc) playStudioDialogue(sc);
      });
    }`;

content = content.replace(oldPlayBtnCall, newPlayBtnCall);

// 4. Update playStudioDialogue to toggle the .speaking class on the avatar
const oldMarkOnPlay = `        audioMark.onplay = () => {
          if (avatarEngine) avatarEngine.startLipSync(32);
        };
        audioMark.onended = () => {
          if (statusText) statusText.textContent = 'Live Interactive Demo';
          if (avatarEngine) avatarEngine.stopLipSync();
        };
        audioMark.onerror = () => {
          if (statusText) statusText.textContent = 'Live Interactive Demo';
          if (avatarEngine) avatarEngine.stopLipSync();
        };`;

const newMarkOnPlay = `        const avatarBox = document.querySelector('.comp-avatar-mini');
        audioMark.onplay = () => {
          if (avatarBox) avatarBox.classList.add('speaking');
          if (avatarEngine) avatarEngine.startLipSync(32);
        };
        audioMark.onended = () => {
          if (avatarBox) avatarBox.classList.remove('speaking');
          if (statusText) statusText.textContent = 'Live Interactive Demo';
          if (avatarEngine) avatarEngine.stopLipSync();
        };
        audioMark.onerror = () => {
          if (avatarBox) avatarBox.classList.remove('speaking');
          if (statusText) statusText.textContent = 'Live Interactive Demo';
          if (avatarEngine) avatarEngine.stopLipSync();
        };`;

content = content.replace(oldMarkOnPlay, newMarkOnPlay);

// Add global fallback alias
content = content.replace(
  'function playStudioDialogue(data) {',
  'const playDialogue = function(d) { playStudioDialogue(d); };\n    function playStudioDialogue(data) {'
);

fs.writeFileSync('E:/CapstoneFoundry/public/landing.html', content, 'utf8');
console.log('Successfully fixed companion avatar img and audio play calls!');
