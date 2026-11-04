// public/onboarding.js — ThinkinBuddy accounts front end (sign-in,
// first-run onboarding, Account & Safety settings).
//
// PLAIN ES module, no build step. Loaded by index.html as
// <script type="module" src="/onboarding.js"></script> (public/ files are
// served at the site root — same pattern as /manifest.json and /icon.svg).
// All DOM it drives lives in index.html: the #accountOverlay container
// (this module fills it) and the Settings -> "Account & Safety" pane.
//
// ─── Two modes, and the app must never break in either ─────────────────
// LEGACY (single-user, self-hosted): the server has no SESSION_SECRET, so
// /api/profile answers 503 { error: 'accounts_not_configured' }. The
// overlay NEVER appears, the Account & Safety tab hides itself, and the
// app behaves exactly as it always has (localStorage user, own keys).
// ACCOUNTS (hosted): /api/profile without a valid token answers 401.
// With no stored token the auth overlay shows; after sign-in, a profile
// with no display_name yet gets the onboarding steps. Any network error
// during the probe also degrades to legacy behaviour — sign-in UI must
// never wedge the buddy itself.
//
// ─── Server contract (bite 5a, server/handlers/auth.js + profile.js) ──
// POST /api/auth/signup  -> 201 { token, tenantId } | 409 email_taken |
//                           400 invalid_email / weak_password
// POST /api/auth/login   -> 200 { token, tenantId } | 401 invalid_credentials
// GET  /api/profile      -> { tenantId, display_name, age_band, about_me,
//                             safety_mode, pin_set, plan, entitlement_status }
// PUT  /api/profile      -> whitelisted fields; safety_mode:false with a
//                           PIN set needs { pin } too, else
//                           403 parent_pin_required / invalid_parent_pin;
//                           safety_mode:true with NO PIN set needs { pin }
//                           in the same request (hashed as part of the
//                           write), else 403 parent_pin_required.
//                           { profile_id } targets one of the tenant's
//                           own profiles instead of the active one.
// GET  /api/profile/profiles -> { tenantId, profiles: [...] } (bite 9)
// POST /api/profile/profiles -> create a profile (household limit 4:
//                           400 profile_limit_reached; a safety-on
//                           create follows the same PIN rule as PUT)
// POST /api/profile/active { profile_id, pin? } -> make a profile the
//                           active one; switching AWAY from a protected
//                           profile to an unprotected one with a PIN
//                           set needs the PIN (403 as above); with no
//                           PIN set it proceeds and the response
//                           carries warning: 'no_parent_pin_set'
// POST /api/profile/pin        { pin } -> set/replace the parent PIN
// POST /api/profile/pin/verify { pin } -> { ok: boolean }
// POST /api/auth/delete-account { password } -> 200 { deleted: true } |
//                           401 invalid_credentials (session + current
//                           password both required; erases the tenant)
// Every accounts endpoint answers 503 accounts_not_configured in legacy
// mode. Auth header: Authorization: Bearer <token>.
//
// Age band VALUES are lib/profile.js AGE_BANDS, exactly:
// ['child', '6-8', '9-12', '13-17', 'adult'] — labels are friendlier.

const TOKEN_KEY = 'tb_token';
const TENANT_KEY = 'tb_tenant';

const AGE_BAND_OPTIONS = [
  { value: 'child', label: 'Under 6' },
  { value: '6-8', label: '6–8' },
  { value: '9-12', label: '9–12' },
  { value: '13-17', label: '13–17' },
  { value: 'adult', label: 'Adult' },
];
// Bands where safety mode defaults ON in onboarding (mirrors the
// kid-core semantics server-side: child / 6-8 / 9-12 are minors).
const MINOR_BANDS = ['child', '6-8', '9-12'];
const PIN_COPY = 'This PIN keeps safety settings locked. Only a parent should know it.';

// Small shared inline styles for elements the .onboarding CSS in
// index.html does not cover (select/textarea/error lines).
const FIELD_STYLE = 'background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.3);color:#e0f0ff;padding:14px 18px;font-family:\'Courier New\',monospace;font-size:1rem;width:280px;max-width:90vw;border-radius:4px;outline:none;text-align:center;letter-spacing:0.05em;';
const ERR_STYLE = 'color:#ff8a8a;font-size:0.8rem;min-height:1.2em;margin:12px 0 0;max-width:380px;line-height:1.5;';
const LINK_BTN_STYLE = 'background:transparent;border:none;color:#7dd3fc;text-decoration:underline;letter-spacing:0.05em;text-transform:none;font-size:0.8rem;margin-top:14px;cursor:pointer;';
const LEGAL_STYLE = 'color:#9fb6c9;font-size:0.75rem;margin:16px 0 0;max-width:380px;line-height:1.5;';
const LEGAL_LINK_STYLE = 'color:#7dd3fc;';

// ─── Session storage + fetch ────────────────────────────────────────────

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getTenantId() {
  try { return localStorage.getItem(TENANT_KEY); } catch { return null; }
}

function storeSession(token, tenantId) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (tenantId) localStorage.setItem(TENANT_KEY, tenantId);
  } catch { /* storage unavailable — session just won't persist */ }
}

function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TENANT_KEY);
  } catch { /* ignore */ }
}

/**
 * fetch() for this app's /api routes with the session token attached.
 * Same signature as fetch(); a plain-object body is JSON-encoded.
 * Exported so other front-end modules can ride the same session.
 */
export async function tbFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let body = opts.body;
  if (body && typeof body === 'object') {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  return fetch(path, { ...opts, headers, body });
}

/** tbFetch + JSON body parsing; never throws on a non-JSON response. */
async function api(path, opts = {}) {
  const res = await tbFetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function isAccountsOff(result) {
  return result.status === 503 && result.data?.error === 'accounts_not_configured';
}

// ─── Billing hook (never allowed to break sign-in) ─────────────────────

async function wireBilling(tenantId) {
  if (!tenantId) return;
  try {
    if (!window.Capacitor?.Plugins?.Purchases) return; // plain web: no plugin
    const { configureBilling } = await import('./billing.js');
    await configureBilling(tenantId);
  } catch { /* billing is optional at sign-in time; swallow everything */ }
}

// ─── Alarm sync hook (never allowed to break sign-in) ──────────────
// Same pattern as wireBilling: the phone-powers module (public/alarms.js)
// schedules server-saved alarms on THIS device. Started after sign-in,
// at boot for an existing session, and in legacy mode (legacy alarms are
// the original single-user flow). Repeat calls just re-sync.

async function wireAlarms() {
  try {
    const { startAlarmSync } = await import('./alarms.js');
    await startAlarmSync();
  } catch { /* alarms are optional at sign-in time; swallow everything */ }
}

// ─── Requests door hook (never allowed to break the pane) ──────────
// Same guarded dynamic-import pattern as wireBilling/wireAlarms: the
// door's logic lives in public/requests.js (validation, the calls,
// the list rendering); this binds it to the pane's markup in
// index.html. Every call rides tbFetch, so the account session
// attaches exactly like the pane's other calls — the module itself
// invents no identity and sends no tenant field. The door displays
// request statuses; nothing here can move one (statuses are the
// operator's side only, spec §1.2).

async function wireRequestsDoor() {
  const submitBtn = document.getElementById('requestSubmit');
  if (!submitBtn) return;
  let mod;
  try { mod = await import('./requests.js'); } catch { return; }

  let kind = 'provider';
  let rows = [];
  const providerBox = document.getElementById('requestProviderFields');
  const curriculumBox = document.getElementById('requestCurriculumFields');
  const listEl = document.getElementById('requestList');

  const paintKind = () => {
    if (providerBox) providerBox.style.display = kind === 'provider' ? '' : 'none';
    if (curriculumBox) curriculumBox.style.display = kind === 'curriculum' ? '' : 'none';
  };
  document.getElementById('requestKindProvider')?.addEventListener('click', () => {
    kind = 'provider'; setLine('requestLine', ''); paintKind();
  });
  document.getElementById('requestKindCurriculum')?.addEventListener('click', () => {
    kind = 'curriculum'; setLine('requestLine', ''); paintKind();
  });

  const paintList = () => { if (listEl) listEl.innerHTML = mod.requestListHtml(rows); };
  const loadList = async () => {
    const res = await mod.fetchOwnRequests({ fetchFn: tbFetch });
    if (res.ok) { rows = res.requests; paintList(); }
  };
  requestsListLoader = loadList;

  const value = (id) => document.getElementById(id)?.value ?? '';
  submitBtn.addEventListener('click', async () => {
    setLine('requestLine', '');
    const fields = kind === 'provider'
      ? {
          provider_name: value('requestProviderName'),
          capability: value('requestCapability'),
          use_case: value('requestUseCase'),
        }
      : {
          role: value('requestRole'),
          subject: value('requestSubject'),
          level: value('requestLevel'),
          goal: value('requestGoal'),
          source_links_text: value('requestSourceLinks'),
        };
    submitBtn.disabled = true;
    try {
      const res = await mod.submitRequest(kind, fields, { fetchFn: tbFetch });
      // A refusal (client-side or the server's) shows plainly and the
      // form keeps its text — nothing is silently swallowed.
      if (!res.ok) { setLine('requestLine', res.error); return; }
      // The new request joins the visible list at the top, carrying
      // the server's own 'Received' label — no page reload.
      rows = [res.request, ...rows];
      paintList();
      for (const id of kind === 'provider'
        ? ['requestProviderName', 'requestUseCase']
        : ['requestSubject', 'requestGoal', 'requestSourceLinks']) {
        const el = document.getElementById(id);
        if (el) el.value = '';
      }
      setLine('requestLine', mod.REQUEST_NOTED_TEXT);
    } finally {
      submitBtn.disabled = false;
    }
  });
  paintKind();
}

// ─── Profile-changed signal (bite 5) ─────────────────────────────────
// prime-agent derives the voice prompt's safety layers from the
// profile AT PRIME TIME, so any prompt primed before a profile/PIN
// write is a stale safety decision. After every SUCCESSFUL profile or
// PIN write in this module, publish the change: index.html listens
// for 'tb-profile-changed', withholds its cached session prompt, and
// re-primes before the next call can start. A FAILED write publishes
// nothing — the previous profile state (and the prime built from it)
// is untouched, so there is no half-state to clean up.
function publishProfileChanged() {
  try { window.dispatchEvent(new CustomEvent('tb-profile-changed')); } catch { /* no listener — the next page load primes fresh anyway */ }
}

// ─── Overlay (auth + onboarding steps) ──────────────────────────────────

const overlayEl = () => document.getElementById('accountOverlay');

function showOverlay(html) {
  const el = overlayEl();
  if (!el) return;
  el.innerHTML = html;
  el.classList.remove('hidden');
}

function hideOverlay() {
  const el = overlayEl();
  if (!el) return;
  el.classList.add('hidden');
  el.innerHTML = '';
}

function authErrorText(data) {
  switch (data?.error) {
    case 'invalid_credentials': return "Email or password didn't match.";
    case 'email_taken': return 'That email already has an account — log in instead.';
    case 'invalid_email': return "That email doesn't look right.";
    case 'weak_password': return 'Password needs at least 10 characters.';
    default: return 'Something went wrong — please try again.';
  }
}

function showAuth() {
  let mode = 'login'; // | 'signup'
  showOverlay(`
    <h1>CAPSTONE FOUNDRY</h1>
    <p id="acctAuthIntro">Welcome back. Log in to your buddy account.</p>
    <input type="email" id="acctEmail" placeholder="Email" autocomplete="email" />
    <input type="password" id="acctPassword" placeholder="Password" autocomplete="current-password" style="margin-top:12px;" />
    <p id="acctAuthError" style="${ERR_STYLE}"></p>
    <button id="acctAuthSubmit">Log in</button>
    <button type="button" id="acctAuthToggle" style="${LINK_BTN_STYLE}">New here? Create an account</button>
    <p style="${LEGAL_STYLE}">By continuing, you agree to the <a href="https://capstonefoundry.helmian.cloud/terms" target="_blank" rel="noopener" style="${LEGAL_LINK_STYLE}">Terms of Use</a> and the <a href="https://capstonefoundry.helmian.cloud/privacy" target="_blank" rel="noopener" style="${LEGAL_LINK_STYLE}">Privacy Policy</a>.</p>
  `);
  const emailEl = document.getElementById('acctEmail');
  const passwordEl = document.getElementById('acctPassword');
  const errorEl = document.getElementById('acctAuthError');
  const submitEl = document.getElementById('acctAuthSubmit');
  const toggleEl = document.getElementById('acctAuthToggle');
  const introEl = document.getElementById('acctAuthIntro');

  const paint = () => {
    submitEl.textContent = mode === 'signup' ? 'Create account' : 'Log in';
    toggleEl.textContent = mode === 'signup' ? 'Already have an account? Log in' : 'New here? Create an account';
    introEl.textContent = mode === 'signup'
      ? 'Create your account — then we set up your buddy together.'
      : 'Welcome back. Log in to your buddy account.';
    passwordEl.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    errorEl.textContent = '';
  };
  toggleEl.addEventListener('click', () => {
    mode = mode === 'signup' ? 'login' : 'signup';
    paint();
  });

  submitEl.addEventListener('click', async () => {
    const email = emailEl.value.trim();
    const password = passwordEl.value;
    if (!email || !password) {
      errorEl.textContent = 'Enter your email and password.';
      return;
    }
    submitEl.disabled = true;
    errorEl.textContent = '';
    try {
      const path = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const result = await api(path, { method: 'POST', body: { email, password } });
      if (isAccountsOff(result)) { enterLegacyMode(); return; }
      if ((result.status === 200 || result.status === 201) && result.data?.token) {
        storeSession(result.data.token, result.data.tenantId);
        await wireBilling(result.data.tenantId);
        await wireAlarms();
        let prof = null;
        try { prof = await api('/api/profile'); } catch { prof = null; }
        if (prof && isAccountsOff(prof)) { enterLegacyMode(); return; }
        profileCache = prof?.data || null;
        refreshAccountPane();
        // Onboarding is complete only with BOTH a display name and an
        // age band (bite 5): a band-less profile is exactly the
        // incomplete state the server's safe default guards, so it
        // finishes onboarding here rather than sailing through as an
        // unnamed-band (read: adult) profile.
        if (!prof?.data?.display_name || !prof?.data?.age_band) showOnboarding();
        else hideOverlay();
        return;
      }
      errorEl.textContent = authErrorText(result.data);
    } catch {
      errorEl.textContent = 'Could not reach the server — please try again.';
    } finally {
      submitEl.disabled = false;
    }
  });
}

function showOnboarding() {
  // No preselected band (bite 5): the age band drives the server's
  // safety decision, so it must be an explicit choice — the first
  // option is a value-less placeholder and step 2 refuses to advance
  // until a real band is picked. There is no silent 'adult' default
  // to fall through on.
  const bandOptions = '<option value="" selected>Choose…</option>' + AGE_BAND_OPTIONS
    .map(o => `<option value="${o.value}">${o.label}</option>`)
    .join('');
  showOverlay(`
    <h1>CAPSTONE FOUNDRY</h1>
    <p>Let's set up your buddy — four quick steps.</p>
    <div class="acct-step" data-step="1">
      <p>What should your buddy call you?</p>
      <input type="text" id="acctName" placeholder="Your name" autocomplete="name" />
      <p class="acct-err" style="${ERR_STYLE}"></p>
      <button data-next="1">Continue</button>
    </div>
    <div class="acct-step" data-step="2" style="display:none;">
      <p>Who is this buddy for?</p>
      <select id="acctBand" style="${FIELD_STYLE}">${bandOptions}</select>
      <p class="acct-err" style="${ERR_STYLE}"></p>
      <button data-next="2">Continue</button>
    </div>
    <div class="acct-step" data-step="3" style="display:none;">
      <p>What should your buddy know about you?</p>
      <textarea id="acctAbout" rows="4" placeholder="Interests, goals, how you like to learn…" style="${FIELD_STYLE}text-align:left;"></textarea>
      <p class="acct-err" style="${ERR_STYLE}"></p>
      <button data-next="3">Continue</button>
      <button type="button" id="acctAboutSkip" style="${LINK_BTN_STYLE}">Skip this step</button>
    </div>
    <div class="acct-step" data-step="4" style="display:none;">
      <p>Safety mode adds extra guardrails for younger users.</p>
      <label style="display:flex;align-items:center;gap:10px;justify-content:center;color:#e0f0ff;font-size:0.95rem;">
        <input type="checkbox" id="acctSafety" style="width:auto;padding:0;" /> Safety mode
      </label>
      <div id="acctPinBlock" style="display:none;margin-top:16px;">
        <p style="margin-bottom:12px;">${PIN_COPY}</p>
        <input type="password" id="acctPin" inputmode="numeric" autocomplete="off" placeholder="Parent PIN (4–6 digits)" />
        <input type="password" id="acctPinAgain" inputmode="numeric" autocomplete="off" placeholder="Parent PIN again" style="margin-top:12px;" />
      </div>
      <p class="acct-err" style="${ERR_STYLE}"></p>
      <button id="acctSave">Save &amp; start</button>
    </div>
  `);

  const steps = [...document.querySelectorAll('#accountOverlay .acct-step')];
  const gotoStep = (n) => {
    steps.forEach(s => { s.style.display = s.dataset.step === String(n) ? '' : 'none'; });
    if (n === 4) syncSafetyDefault();
  };
  const errOf = (n) => steps[n - 1].querySelector('.acct-err');

  const nameEl = document.getElementById('acctName');
  const bandEl = document.getElementById('acctBand');
  const safetyEl = document.getElementById('acctSafety');
  const pinBlock = document.getElementById('acctPinBlock');
  let safetyTouched = false;

  const syncSafetyDefault = () => {
    if (!safetyTouched) safetyEl.checked = MINOR_BANDS.includes(bandEl.value);
    pinBlock.style.display = safetyEl.checked ? '' : 'none';
  };
  safetyEl.addEventListener('change', () => {
    safetyTouched = true;
    pinBlock.style.display = safetyEl.checked ? '' : 'none';
  });

  steps[0].querySelector('[data-next="1"]').addEventListener('click', () => {
    if (!nameEl.value.trim()) { errOf(1).textContent = 'Your buddy needs a name to call you.'; return; }
    gotoStep(2);
  });
  steps[1].querySelector('[data-next="2"]').addEventListener('click', () => {
    if (!bandEl.value) { errOf(2).textContent = 'Pick who this buddy is for to continue.'; return; }
    gotoStep(3);
  });
  steps[2].querySelector('[data-next="3"]').addEventListener('click', () => gotoStep(4));
  document.getElementById('acctAboutSkip').addEventListener('click', () => {
    document.getElementById('acctAbout').value = '';
    gotoStep(4);
  });

  document.getElementById('acctSave').addEventListener('click', async (ev) => {
    const err = errOf(4);
    err.textContent = '';
    const pin = document.getElementById('acctPin').value.trim();
    const pinAgain = document.getElementById('acctPinAgain').value.trim();
    // Bite 8: safety checked means a valid PIN + matching confirmation
    // are REQUIRED before Save can complete — safety mode is a lock,
    // and there is no successful onboarding that arms it without one.
    // (The server enforces the same rule on the profile write itself,
    // so this is the friendly face of a rule no client can bypass.)
    if (safetyEl.checked) {
      if (!/^\d{4,6}$/.test(pin)) { err.textContent = 'The parent PIN must be 4–6 digits.'; return; }
      if (pin !== pinAgain) { err.textContent = "The two PINs didn't match."; return; }
    }
    ev.target.disabled = true;
    try {
      // The PIN is set BEFORE the profile save: a failed PIN call
      // leaves onboarding open with the error line and nothing saved,
      // so the saved profile can never sit there armed-but-unlocked
      // (the old order saved first and warned afterwards).
      if (safetyEl.checked) {
        const pinRes = await api('/api/profile/pin', { method: 'POST', body: { pin } });
        if (isAccountsOff(pinRes)) { enterLegacyMode(); return; }
        if (pinRes.status !== 200) {
          err.textContent = 'Could not set the parent PIN — please try again.';
          return;
        }
        if (profileCache) profileCache.pin_set = true;
        publishProfileChanged();
      }
      const saved = await api('/api/profile', {
        method: 'PUT',
        body: {
          display_name: nameEl.value.trim(),
          age_band: bandEl.value,
          about_me: document.getElementById('acctAbout').value.trim() || null,
          safety_mode: safetyEl.checked,
        },
      });
      if (isAccountsOff(saved)) { enterLegacyMode(); return; }
      if (saved.status !== 200) { err.textContent = 'Could not save — please try again.'; return; }
      profileCache = saved.data;
      publishProfileChanged();
      refreshAccountPane();
      hideOverlay();
    } catch {
      err.textContent = 'Could not reach the server — please try again.';
    } finally {
      ev.target.disabled = false;
    }
  });
}

// ─── Settings -> Account & Safety pane ──────────────────────────────────

let profileCache = null;
let accountsMode = false; // true once the server proves it has accounts
let requestsListLoader = null; // set by wireRequestsDoor() once the door is bound
let profilesCache = null; // the household's profile list, server order (bite 9b)

/**
 * The ACTIVE profile's id as this module currently knows it: the
 * list's is_active row once the list has loaded, else the profile
 * GET /api/profile returned (which IS the active profile). Null
 * before any profile state exists (legacy mode / signed out).
 */
function activeProfileId() {
  const fromList = profilesCache?.find((p) => p.is_active === true);
  if (fromList?.profile_id) return fromList.profile_id;
  return profileCache?.profile_id ?? null;
}

// index.html's prime request and the widget's dynamic variables
// read the active profile through this window global: onboarding.js
// is an ES module and index.html's app script is not, so the two
// share no scope — the getter is the bridge, the same direction
// the tb-profile-changed event travels. The id NAMES the profile a
// session runs under; it never selects one (the server resolves
// safety from its own active pointer), so it cannot widen posture.
window.tbActiveProfileId = () => activeProfileId();

function bandLabel(value) {
  const found = AGE_BAND_OPTIONS.find((o) => o.value === value);
  return found ? found.label : 'No age band yet';
}

/**
 * Render the household list into the pane: one row per profile with
 * its name, band, and the "In use" / "First profile" / "Safety on"
 * markers, plus the switch and edit buttons the pane wiring hears
 * through one delegated listener. Built with DOM calls and
 * textContent only — profile names are user text and never become
 * markup.
 */
function renderProfilesList() {
  const listEl = document.getElementById('accountProfilesList');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!profilesCache) return;
  if (profilesCache.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'test-line';
    empty.textContent = 'No profiles yet.';
    listEl.appendChild(empty);
    return;
  }
  for (const p of profilesCache) {
    const row = document.createElement('div');
    row.className = 'test-line';
    const bits = [p.display_name || 'Unnamed profile', bandLabel(p.age_band)];
    if (p.is_active) bits.push('In use');
    if (p.is_primary) bits.push('First profile');
    if (p.safety_mode) bits.push('Safety on');
    const label = document.createElement('span');
    label.textContent = bits.join(' · ');
    row.appendChild(label);
    if (!p.is_active) {
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'secondary';
      useBtn.textContent = 'Use this profile';
      useBtn.dataset.action = 'switch';
      useBtn.dataset.profileId = p.profile_id;
      row.appendChild(document.createTextNode(' '));
      row.appendChild(useBtn);
    }
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary';
    editBtn.textContent = 'Edit';
    editBtn.dataset.action = 'edit';
    editBtn.dataset.profileId = p.profile_id;
    row.appendChild(document.createTextNode(' '));
    row.appendChild(editBtn);
    listEl.appendChild(row);
  }
}

/** Reload the household list from the server and re-render it. */
async function loadProfiles() {
  const res = await api('/api/profile/profiles').catch(() => null);
  if (!res) return;
  if (isAccountsOff(res)) { enterLegacyMode(); return; }
  if (res.status !== 200 || !Array.isArray(res.data?.profiles)) return;
  profilesCache = res.data.profiles;
  renderProfilesList();
}

function hideAccountPane() {
  const pane = document.getElementById('accountPane');
  if (pane) pane.style.display = 'none';
  const tab = document.querySelector('.tabs button[data-tab="account"]');
  if (tab) tab.style.display = 'none';
}

function enterLegacyMode() {
  accountsMode = false;
  hideOverlay();
  hideAccountPane();
  wireAlarms();
}

async function refreshAccountPane(force = false) {
  if (!accountsMode) return;
  const planLine = document.getElementById('accountPlanLine');
  const safetyToggle = document.getElementById('accountSafetyToggle');
  const pinStatus = document.getElementById('accountPinStatus');
  const currentPinRow = document.getElementById('accountCurrentPinRow');
  if (!planLine) return;

  if (force) profileCache = null;
  if (!profileCache) {
    const prof = await api('/api/profile').catch(() => null);
    if (!prof || isAccountsOff(prof)) { if (prof) enterLegacyMode(); return; }
    if (prof.status === 200) profileCache = prof.data;
  }
  if (!profileCache) {
    planLine.textContent = 'Plan: sign in to see your plan.';
    if (safetyToggle) safetyToggle.disabled = true;
    return;
  }
  const plan = profileCache.plan || 'free';
  planLine.textContent = profileCache.entitlement_status && profileCache.entitlement_status !== 'active'
    ? `Plan: ${plan} (${profileCache.entitlement_status})`
    : `Plan: ${plan}`;
  if (safetyToggle) {
    safetyToggle.disabled = false;
    safetyToggle.checked = profileCache.safety_mode === true;
  }
  if (pinStatus) pinStatus.textContent = profileCache.pin_set ? 'A parent PIN is set.' : 'No parent PIN set.';
  if (currentPinRow) currentPinRow.style.display = profileCache.pin_set ? '' : 'none';
  // The household profile list rides the same refresh (bite 9b), so
  // the list, its "In use" marker, and the active id the prime
  // carries (window.tbActiveProfileId) never drift from the server.
  // Best-effort like everything else in this pane: it loads after
  // the profile itself and can never break the pane's own render.
  loadProfiles().catch(() => {});
  // The requests door's list rides the pane's refresh (sign-in, tab
  // open, PIN save) — best-effort, it can never break the pane.
  if (requestsListLoader) requestsListLoader().catch(() => {});
}

function setLine(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

function wireAccountPane() {
  const safetyToggle = document.getElementById('accountSafetyToggle');
  const pinRow = document.getElementById('accountSafetyPinRow');
  const pinInput = document.getElementById('accountSafetyPin');
  const pinConfirm = document.getElementById('accountSafetyPinConfirm');
  const createRow = document.getElementById('accountSafetyCreateRow');
  const createPinInput = document.getElementById('accountSafetyNewPin');
  const createPinAgainInput = document.getElementById('accountSafetyNewPinAgain');
  const createConfirm = document.getElementById('accountSafetyCreateConfirm');
  if (!safetyToggle) return;

  // Bite 8: the safety-on write itself, shared by the toggle (PIN
  // already set) and the create-a-PIN flow below (PIN just created).
  async function turnSafetyOn() {
    const res = await api('/api/profile', { method: 'PUT', body: { safety_mode: true } }).catch(() => null);
    if (res && res.status === 200) {
      profileCache = res.data;
      publishProfileChanged();
      safetyToggle.checked = true;
      setLine('accountStatusLine', 'Safety mode is on.');
      return true;
    }
    safetyToggle.checked = false;
    setLine('accountStatusLine', 'Could not turn safety mode on — try again.');
    return false;
  }

  safetyToggle.addEventListener('change', async () => {
    setLine('accountStatusLine', '');
    if (safetyToggle.checked) {
      // Bite 8: with a PIN set, safety turns straight on. With NO
      // PIN set, arming safety now would leave it unlockable by
      // anyone holding the phone — so the toggle does not take
      // effect; it opens the create-a-PIN row instead, and safety
      // turns on only once a PIN exists (see createConfirm below).
      if (profileCache?.pin_set) {
        await turnSafetyOn();
      } else {
        safetyToggle.checked = false;
        if (createRow) createRow.style.display = '';
        createPinInput?.focus();
        setLine('accountStatusLine', 'Safety mode needs a parent PIN to lock it — create one and safety turns on.');
      }
      return;
    }
    // Turning OFF: with a PIN set, the parent proves it inline first.
    if (profileCache?.pin_set) {
      safetyToggle.checked = true; // stays on until the PIN checks out
      if (pinRow) pinRow.style.display = '';
      pinInput?.focus();
      setLine('accountStatusLine', 'Enter the parent PIN to turn safety mode off.');
      return;
    }
    await turnSafetyOff(null);
  });

  pinConfirm?.addEventListener('click', async () => {
    await turnSafetyOff(pinInput?.value.trim() || '');
    if (pinInput) pinInput.value = '';
  });

  // Bite 8: the create-a-PIN flow the safety toggle opens when no
  // PIN is set. PIN + confirmation first; only a successfully
  // created PIN lets the safety-on write run. The PIN write alone
  // changes nothing the prime resolves (the resolver reads
  // safety_mode / age_band, never pin_set), so it publishes nothing
  // itself — the safety-on write it unlocks publishes from its own
  // success branch inside turnSafetyOn.
  createConfirm?.addEventListener('click', async () => {
    const newPin = createPinInput?.value.trim() || '';
    const newPinAgain = createPinAgainInput?.value.trim() || '';
    if (!/^\d{4,6}$/.test(newPin)) { setLine('accountStatusLine', 'The parent PIN must be 4–6 digits.'); return; }
    if (newPin !== newPinAgain) { setLine('accountStatusLine', "The two PINs didn't match."); return; }
    const pinRes = await api('/api/profile/pin', { method: 'POST', body: { pin: newPin } }).catch(() => null);
    if (pinRes && isAccountsOff(pinRes)) { enterLegacyMode(); return; }
    if (!pinRes || pinRes.status !== 200) {
      setLine('accountStatusLine', 'Could not save the PIN — safety mode is still off.');
      return;
    }
    if (profileCache) profileCache.pin_set = true;
    if (createPinInput) createPinInput.value = '';
    if (createPinAgainInput) createPinAgainInput.value = '';
    if (createRow) createRow.style.display = 'none';
    if (await turnSafetyOn()) refreshAccountPane();
  });

  async function turnSafetyOff(pin) {
    const body = { safety_mode: false };
    if (pin) body.pin = pin;
    const res = await api('/api/profile', { method: 'PUT', body }).catch(() => null);
    if (res && isAccountsOff(res)) { enterLegacyMode(); return; }
    if (res && res.status === 200) {
      profileCache = res.data;
      publishProfileChanged();
      safetyToggle.checked = false;
      if (pinRow) pinRow.style.display = 'none';
      setLine('accountStatusLine', res.data.warning === 'no_parent_pin_set'
        ? 'Safety mode is off. Note: no parent PIN is set, so anyone with this phone can change safety settings.'
        : 'Safety mode is off.');
      refreshAccountPane();
      return;
    }
    if (res && res.status === 403) {
      safetyToggle.checked = true;
      setLine('accountStatusLine', res.data?.error === 'parent_pin_required'
        ? 'A parent PIN is required to turn safety mode off.'
        : "That PIN didn't match — safety mode is still on.");
      return;
    }
    safetyToggle.checked = true;
    setLine('accountStatusLine', 'Could not turn safety mode off — try again.');
  }

  document.getElementById('accountPinSave')?.addEventListener('click', async () => {
    setLine('accountPinLine', '');
    const newPin = document.getElementById('accountNewPin')?.value.trim() || '';
    const newPinAgain = document.getElementById('accountNewPinConfirm')?.value.trim() || '';
    if (!/^\d{4,6}$/.test(newPin)) { setLine('accountPinLine', 'The PIN must be 4–6 digits.'); return; }
    if (newPin !== newPinAgain) { setLine('accountPinLine', "The two PINs didn't match."); return; }
    try {
      if (profileCache?.pin_set) {
        const current = document.getElementById('accountCurrentPin')?.value.trim() || '';
        const verify = await api('/api/profile/pin/verify', { method: 'POST', body: { pin: current } });
        if (isAccountsOff(verify)) { enterLegacyMode(); return; }
        if (!verify.data?.ok) { setLine('accountPinLine', "Current PIN didn't match — PIN unchanged."); return; }
      }
      const res = await api('/api/profile/pin', { method: 'POST', body: { pin: newPin } });
      if (isAccountsOff(res)) { enterLegacyMode(); return; }
      if (res.status !== 200) { setLine('accountPinLine', 'Could not save the PIN — try again.'); return; }
      if (profileCache) profileCache.pin_set = true;
      publishProfileChanged();
      for (const id of ['accountCurrentPin', 'accountNewPin', 'accountNewPinConfirm']) {
        const el = document.getElementById(id);
        if (el) el.value = '';
      }
      setLine('accountPinLine', 'Parent PIN saved.');
      refreshAccountPane();
    } catch {
      setLine('accountPinLine', 'Could not reach the server — try again.');
    }
  });

  document.getElementById('accountLogout')?.addEventListener('click', () => {
    clearSession();
    location.reload();
  });

  // ─── Delete my account (Apple 5.1.1(v) / Play deletion rule) ──────
  // Two deliberate speed bumps before the call: the confirm row stays
  // hidden until "Delete my account" is tapped, and the final button
  // does nothing until the parent types DELETE *and* enters the
  // account password (the server checks the password too — this is a
  // second lock, not the only one). The warning copy in index.html
  // says plainly that memories are erased AND that deleting does not
  // cancel a store subscription.
  const deleteConfirmRow = document.getElementById('accountDeleteConfirm');
  document.getElementById('accountDeleteOpen')?.addEventListener('click', () => {
    setLine('accountDeleteLine', '');
    if (deleteConfirmRow) deleteConfirmRow.style.display = '';
    document.getElementById('accountDeletePassword')?.focus();
  });
  document.getElementById('accountDeleteCancel')?.addEventListener('click', () => {
    if (deleteConfirmRow) deleteConfirmRow.style.display = 'none';
    for (const id of ['accountDeletePassword', 'accountDeleteType']) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    }
    setLine('accountDeleteLine', '');
  });
  document.getElementById('accountDeleteConfirmBtn')?.addEventListener('click', async () => {
    setLine('accountDeleteLine', '');
    const typed = document.getElementById('accountDeleteType')?.value.trim() || '';
    if (typed !== 'DELETE') {
      setLine('accountDeleteLine', 'Type DELETE (all capitals) to confirm — nothing has been deleted.');
      return;
    }
    const password = document.getElementById('accountDeletePassword')?.value || '';
    if (!password) {
      setLine('accountDeleteLine', 'Enter your account password to confirm — nothing has been deleted.');
      return;
    }
    const res = await api('/api/auth/delete-account', { method: 'POST', body: { password } }).catch(() => null);
    if (res && isAccountsOff(res)) { enterLegacyMode(); return; }
    if (res && res.status === 200 && res.data?.deleted) {
      clearSession();
      location.reload();
      return;
    }
    if (res && res.status === 401) {
      setLine('accountDeleteLine', "That password didn't match — nothing was deleted.");
      return;
    }
    setLine('accountDeleteLine', 'Could not delete your account — try again. Nothing was deleted.');
  });

  // ─── Profiles: switch, create, edit (bite 9b) ──────────────────
  // The client half of bite 9's foundation: the pane lists the
  // household (renderProfilesList, fed by loadProfiles on every
  // pane refresh), switches the server's active pointer, creates
  // profiles up to the household limit, and edits any profile's
  // name / band / about / safety. Every successful write publishes
  // tb-profile-changed (bite 5's contract) — a switch most of all,
  // because the prime must re-resolve under the newly active
  // profile before the next call.
  const switchPinRow = document.getElementById('accountSwitchPinRow');
  const switchPinInput = document.getElementById('accountSwitchPin');
  let pendingSwitchId = null;

  async function switchActiveProfile(profileId, pin) {
    const body = { profile_id: profileId };
    if (pin) body.pin = pin;
    const res = await api('/api/profile/active', { method: 'POST', body }).catch(() => null);
    if (res && isAccountsOff(res)) { enterLegacyMode(); return; }
    if (res && res.status === 200) {
      pendingSwitchId = null;
      if (switchPinRow) switchPinRow.style.display = 'none';
      if (switchPinInput) switchPinInput.value = '';
      profileCache = null; // re-read: the active profile just changed
      publishProfileChanged();
      await refreshAccountPane(true);
      setLine('accountProfilesLine', res.data?.warning === 'no_parent_pin_set'
        ? 'Switched. Note: no parent PIN is set, so anyone with this phone can switch profiles or change safety settings.'
        : 'Switched — your buddy now runs under this profile.');
      return;
    }
    if (res && res.status === 403 && res.data?.error === 'parent_pin_required') {
      // Protected -> unprotected under an armed account lock: the
      // parent proves it inline, then Confirm retries with the PIN.
      pendingSwitchId = profileId;
      if (switchPinRow) switchPinRow.style.display = '';
      switchPinInput?.focus();
      setLine('accountProfilesLine', 'Enter the parent PIN to switch away from a protected profile.');
      return;
    }
    if (res && res.status === 403 && res.data?.error === 'invalid_parent_pin') {
      setLine('accountProfilesLine', "That PIN didn't match — no switch happened.");
      return;
    }
    setLine('accountProfilesLine', 'Could not switch profiles — try again.');
  }

  document.getElementById('accountProfilesList')?.addEventListener('click', (ev) => {
    const btn = ev.target?.closest?.('button[data-profile-id]');
    if (!btn) return;
    if (btn.dataset.action === 'switch') {
      setLine('accountProfilesLine', '');
      switchActiveProfile(btn.dataset.profileId, null);
    } else if (btn.dataset.action === 'edit') {
      openProfileEditor(btn.dataset.profileId);
    }
  });

  document.getElementById('accountSwitchPinConfirm')?.addEventListener('click', async () => {
    if (!pendingSwitchId) return;
    const pin = switchPinInput?.value.trim() || '';
    if (!pin) { setLine('accountProfilesLine', 'Enter the parent PIN to switch.'); return; }
    await switchActiveProfile(pendingSwitchId, pin);
    if (switchPinInput) switchPinInput.value = '';
  });
  document.getElementById('accountSwitchPinCancel')?.addEventListener('click', () => {
    pendingSwitchId = null;
    if (switchPinRow) switchPinRow.style.display = 'none';
    if (switchPinInput) switchPinInput.value = '';
    setLine('accountProfilesLine', '');
  });

  // Create: name + explicit band (no preselected band — bite 5's
  // rule) + optional safety. Safety on with no account PIN yet
  // carries the new PIN in the create request itself (bite 8).
  const newSafetyEl = document.getElementById('accountProfileNewSafety');
  const newPinRow = document.getElementById('accountProfileNewPinRow');
  const syncNewPinRow = () => {
    if (newPinRow) newPinRow.style.display = newSafetyEl?.checked && !profileCache?.pin_set ? '' : 'none';
  };
  newSafetyEl?.addEventListener('change', syncNewPinRow);

  document.getElementById('accountProfileCreateBtn')?.addEventListener('click', async () => {
    setLine('accountProfileCreateLine', '');
    syncNewPinRow();
    const name = document.getElementById('accountProfileNewName')?.value.trim() || '';
    const band = document.getElementById('accountProfileNewBand')?.value || '';
    const safety = newSafetyEl?.checked === true;
    if (!name) { setLine('accountProfileCreateLine', 'A profile needs a name.'); return; }
    if (!band) { setLine('accountProfileCreateLine', 'Pick who this profile is for.'); return; }
    const body = { display_name: name, age_band: band, safety_mode: safety };
    if (safety && !profileCache?.pin_set) {
      const pin = document.getElementById('accountProfileNewPin')?.value.trim() || '';
      const pinAgain = document.getElementById('accountProfileNewPinAgain')?.value.trim() || '';
      if (!/^\d{4,6}$/.test(pin)) { setLine('accountProfileCreateLine', 'The parent PIN must be 4–6 digits.'); return; }
      if (pin !== pinAgain) { setLine('accountProfileCreateLine', "The two PINs didn't match."); return; }
      body.pin = pin;
    }
    const res = await api('/api/profile/profiles', { method: 'POST', body }).catch(() => null);
    if (res && isAccountsOff(res)) { enterLegacyMode(); return; }
    if (res && res.status === 200) {
      // A profile write succeeded (and if it carried a PIN, the
      // account lock was just armed): publish, clear the form, and
      // let the pane re-read the household from the server.
      profileCache = null;
      publishProfileChanged();
      for (const id of ['accountProfileNewName', 'accountProfileNewPin', 'accountProfileNewPinAgain']) {
        const el = document.getElementById(id);
        if (el) el.value = '';
      }
      const bandEl = document.getElementById('accountProfileNewBand');
      if (bandEl) bandEl.value = '';
      if (newSafetyEl) newSafetyEl.checked = false;
      syncNewPinRow();
      await refreshAccountPane(true);
      setLine('accountProfileCreateLine', 'Profile created.');
      return;
    }
    if (res && res.status === 400 && res.data?.error === 'profile_limit_reached') {
      setLine('accountProfileCreateLine', 'This account already has the most profiles it can hold (4).');
      return;
    }
    if (res && res.status === 403 && res.data?.error === 'parent_pin_required') {
      if (newPinRow) newPinRow.style.display = '';
      setLine('accountProfileCreateLine', 'Safety mode needs a parent PIN to lock it — create one and the profile is created.');
      return;
    }
    if (res && res.status === 400 && res.data?.error === 'invalid_age_band') {
      setLine('accountProfileCreateLine', 'Pick who this profile is for.');
      return;
    }
    setLine('accountProfileCreateLine', 'Could not create the profile — try again.');
  });

  // Edit: any profile in the household, targeted by profile_id.
  // The safety halves are mirrored before the write — arming
  // safety on a PIN-less account reveals the create-a-PIN fields,
  // disarming it under an armed lock reveals the current-PIN
  // field — and the server's refusals reveal the same row, so a
  // stale cache can never strand the parent.
  const editBox = document.getElementById('accountProfileEdit');
  const editSafetyEl = document.getElementById('accountProfileEditSafety');
  const editPinRow = document.getElementById('accountProfileEditPinRow');
  const editPinAgainWrap = document.getElementById('accountProfileEditPinAgainWrap');
  const editPinLabel = document.getElementById('accountProfileEditPinLabel');
  let editProfileId = null;

  function openProfileEditor(profileId) {
    const target = profilesCache?.find((p) => p.profile_id === profileId);
    if (!target) return;
    editProfileId = profileId;
    setLine('accountProfileEditLine', '');
    const nameEl = document.getElementById('accountProfileEditName');
    const bandEl = document.getElementById('accountProfileEditBand');
    const aboutEl = document.getElementById('accountProfileEditAbout');
    if (nameEl) nameEl.value = target.display_name || '';
    if (bandEl) bandEl.value = target.age_band || '';
    if (aboutEl) aboutEl.value = target.about_me || '';
    if (editSafetyEl) editSafetyEl.checked = target.safety_mode === true;
    const pinEl = document.getElementById('accountProfileEditPin');
    const pinAgainEl = document.getElementById('accountProfileEditPinAgain');
    if (pinEl) pinEl.value = '';
    if (pinAgainEl) pinAgainEl.value = '';
    if (editPinRow) editPinRow.style.display = 'none';
    if (editBox) editBox.style.display = '';
  }

  // mode 'create': safety is being armed and the account has no
  // PIN yet — the save must carry a NEW PIN + its confirmation.
  // mode 'current': safety is being disarmed under an armed lock —
  // the save must carry the CURRENT PIN.
  function revealEditPinRow(mode) {
    if (editPinLabel) editPinLabel.textContent = mode === 'create'
      ? 'Parent PIN — create one to turn safety on'
      : 'Parent PIN — required to turn safety off';
    if (editPinAgainWrap) editPinAgainWrap.style.display = mode === 'create' ? '' : 'none';
    if (editPinRow) editPinRow.style.display = '';
    document.getElementById('accountProfileEditPin')?.focus();
  }

  document.getElementById('accountProfileEditSave')?.addEventListener('click', async () => {
    const target = profilesCache?.find((p) => p.profile_id === editProfileId) || null;
    if (!target) { setLine('accountProfileEditLine', 'Pick a profile to edit first.'); return; }
    setLine('accountProfileEditLine', '');
    const name = document.getElementById('accountProfileEditName')?.value.trim() || '';
    const band = document.getElementById('accountProfileEditBand')?.value || '';
    const about = document.getElementById('accountProfileEditAbout')?.value.trim() || '';
    const safety = editSafetyEl?.checked === true;
    if (!name) { setLine('accountProfileEditLine', 'A profile needs a name.'); return; }
    if (!band) { setLine('accountProfileEditLine', 'Pick who this profile is for.'); return; }
    const body = {
      profile_id: editProfileId,
      display_name: name,
      age_band: band,
      about_me: about || null,
      safety_mode: safety,
    };
    const pinEl = document.getElementById('accountProfileEditPin');
    const pin = pinEl?.value.trim() || '';
    if (safety && !target.safety_mode && !profileCache?.pin_set) {
      if (!pin) {
        revealEditPinRow('create');
        setLine('accountProfileEditLine', 'Safety mode needs a parent PIN to lock it — create one and the profile saves.');
        return;
      }
      const pinAgain = document.getElementById('accountProfileEditPinAgain')?.value.trim() || '';
      if (!/^\d{4,6}$/.test(pin)) { setLine('accountProfileEditLine', 'The parent PIN must be 4–6 digits.'); return; }
      if (pin !== pinAgain) { setLine('accountProfileEditLine', "The two PINs didn't match."); return; }
      body.pin = pin;
    } else if (!safety && target.safety_mode && profileCache?.pin_set) {
      if (!pin) {
        revealEditPinRow('current');
        setLine('accountProfileEditLine', 'Enter the parent PIN to turn safety mode off.');
        return;
      }
      body.pin = pin;
    }
    const res = await api('/api/profile', { method: 'PUT', body }).catch(() => null);
    if (res && isAccountsOff(res)) { enterLegacyMode(); return; }
    if (res && res.status === 200) {
      const wasActive = target.is_active === true;
      if (pinEl) pinEl.value = '';
      const pinAgainEl = document.getElementById('accountProfileEditPinAgain');
      if (pinAgainEl) pinAgainEl.value = '';
      if (editBox) editBox.style.display = 'none';
      editProfileId = null;
      if (wasActive) profileCache = null; // the pane re-reads the active profile
      publishProfileChanged();
      await refreshAccountPane(true);
      setLine('accountProfilesLine', res.data?.warning === 'no_parent_pin_set'
        ? 'Profile saved. Note: no parent PIN is set, so anyone with this phone can change safety settings.'
        : 'Profile saved.');
      return;
    }
    if (res && res.status === 403 && res.data?.error === 'parent_pin_required') {
      revealEditPinRow(safety ? 'create' : 'current');
      setLine('accountProfileEditLine', safety
        ? 'Safety mode needs a parent PIN to lock it — create one and the profile saves.'
        : 'A parent PIN is required to turn safety mode off.');
      return;
    }
    if (res && res.status === 403 && res.data?.error === 'invalid_parent_pin') {
      setLine('accountProfileEditLine', "That PIN didn't match — nothing was saved.");
      return;
    }
    if (res && res.status === 404) {
      if (editBox) editBox.style.display = 'none';
      editProfileId = null;
      await loadProfiles();
      setLine('accountProfilesLine', 'That profile is no longer there — the list has been refreshed.');
      return;
    }
    setLine('accountProfileEditLine', 'Could not save the profile — try again.');
  });

  document.getElementById('accountProfileEditCancel')?.addEventListener('click', () => {
    editProfileId = null;
    if (editBox) editBox.style.display = 'none';
    setLine('accountProfileEditLine', '');
  });

  // The requests door (spec §1.3): bound by the guarded hook above;
  // its list refreshes with the pane's own refresh (see
  // refreshAccountPane), so it follows the pane's rhythm exactly.
  wireRequestsDoor().catch(() => {});

  // Refresh the pane whenever the parent opens the Account tab.
  document.querySelector('.tabs button[data-tab="account"]')
    ?.addEventListener('click', () => { refreshAccountPane(true); });
}

// ─── Boot ───────────────────────────────────────────────────────────────

async function init() {
  wireAccountPane();
  let prof;
  try {
    prof = await api('/api/profile');
  } catch {
    // Server unreachable — never let sign-in UI wedge the app.
    enterLegacyMode();
    return;
  }
  if (isAccountsOff(prof)) { enterLegacyMode(); return; }
  if (prof.status === 401) {
    accountsMode = true;
    if (getToken()) clearSession(); // stale/forged token — start clean
    showAuth();
    return;
  }
  if (prof.status === 200) {
    accountsMode = true;
    profileCache = prof.data;
    await wireBilling(getTenantId() || prof.data?.tenantId);
    await wireAlarms();
    refreshAccountPane();
    // Same completeness rule as the sign-in path (bite 5): no age
    // band means onboarding is not finished, whatever the name says.
    if (!prof.data?.display_name || !prof.data?.age_band) showOnboarding();
    return;
  }
  // Anything else: degrade quietly to legacy behaviour.
  enterLegacyMode();
}

init();
