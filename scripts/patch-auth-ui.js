import fs from 'fs';

let code = fs.readFileSync('public/onboarding.js', 'utf8');

const target1 = "default: return 'Something went wrong — please try again.';";
const repl1 = "default: return 'Sign-in failed. Please retry.';";
if (!code.includes(target1)) throw new Error('target1 not found');
code = code.replace(target1, repl1);

const target2 = '<input type="password" id="acctPassword" placeholder="Password" autocomplete="current-password" style="margin-top:12px;" />';
const repl2 = `<div style="position:relative;width:280px;max-width:90vw;margin:12px auto 0;">
      <input type="password" id="acctPassword" placeholder="Password" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding-right:44px;margin-top:0;" />
      <button type="button" id="acctPasswordToggle" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#7dd3fc;font-size:1.2rem;cursor:pointer;padding:6px;display:flex;align-items:center;justify-content:center;z-index:2;line-height:1;" title="Show/hide password" aria-label="Toggle password visibility">👁️</button>
    </div>`;
if (!code.includes(target2)) throw new Error('target2 not found');
code = code.replace(target2, repl2);

const target3 = "const introEl = document.getElementById('acctAuthIntro');";
const repl3 = `const introEl = document.getElementById('acctAuthIntro');
  const pwToggleEl = document.getElementById('acctPasswordToggle');
  if (pwToggleEl && passwordEl) {
    pwToggleEl.addEventListener('click', (e) => {
      e.preventDefault();
      const isPass = passwordEl.type === 'password';
      passwordEl.type = isPass ? 'text' : 'password';
      pwToggleEl.textContent = isPass ? '🙈' : '👁️';
    });
  }`;
if (!code.includes(target3)) throw new Error('target3 not found');
code = code.replace(target3, repl3);

fs.writeFileSync('public/onboarding.js', code, 'utf8');
console.log('SUCCESSFULLY PATCHED onboarding.js');
