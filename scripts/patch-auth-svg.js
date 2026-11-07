import fs from 'fs';

let code = fs.readFileSync('public/onboarding.js', 'utf8');

const targetButton = `<button type="button" id="acctPasswordToggle" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#7dd3fc;font-size:1.2rem;cursor:pointer;padding:6px;display:flex;align-items:center;justify-content:center;z-index:2;line-height:1;" title="Show/hide password" aria-label="Toggle password visibility">👁️</button>`;

const newButton = `<button type="button" id="acctPasswordToggle" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:6px;display:flex;align-items:center;justify-content:center;z-index:2;line-height:0;" title="Show/hide password" aria-label="Toggle password visibility">
        <svg id="eyeIconOpen" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.8;display:block;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <svg id="eyeIconClosed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.8;display:none;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
      </button>`;

if (!code.includes(targetButton)) {
  throw new Error('targetButton not found in onboarding.js');
}
code = code.replace(targetButton, newButton);

const targetHandler = `  if (pwToggleEl && passwordEl) {
    pwToggleEl.addEventListener('click', (e) => {
      e.preventDefault();
      const isPass = passwordEl.type === 'password';
      passwordEl.type = isPass ? 'text' : 'password';
      pwToggleEl.textContent = isPass ? '🙈' : '👁️';
    });
  }`;

const newHandler = `  if (pwToggleEl && passwordEl) {
    pwToggleEl.addEventListener('click', (e) => {
      e.preventDefault();
      const isPass = passwordEl.type === 'password';
      passwordEl.type = isPass ? 'text' : 'password';
      const openSvg = document.getElementById('eyeIconOpen');
      const closedSvg = document.getElementById('eyeIconClosed');
      if (openSvg && closedSvg) {
        openSvg.style.display = isPass ? 'none' : 'block';
        closedSvg.style.display = isPass ? 'block' : 'none';
      }
    });
  }`;

if (!code.includes(targetHandler)) {
  throw new Error('targetHandler not found in onboarding.js');
}
code = code.replace(targetHandler, newHandler);

fs.writeFileSync('public/onboarding.js', code, 'utf8');
console.log('SUCCESSFULLY REPLACED EMOJI WITH THEMED SVG EYE ICON');
