// public/avatar-ui.js — UI Controller for Holographic Avatar Studio
import { HolographicAvatarEngine } from './avatar-engine.js';

let orbEngine = null;
let studioEngine = null;
let currentAvatar = null;
let pendingPhotoDataUrl = null;

function getAuthToken() {
  try {
    return localStorage.getItem('thinkinbuddy_session_token') || localStorage.getItem('token') || '';
  } catch {
    return '';
  }
}

async function apiRequest(path, options = {}) {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  return res.json();
}

export async function initAvatarSystem() {
  const orbCanvas = document.getElementById('avatarCanvas');
  const orbIcon = document.getElementById('orbIcon') || (document.getElementById('orb') && document.getElementById('orb').querySelector('.orb-icon'));
  const studioCanvas = document.getElementById('avatarStudioCanvas');
  const avatarModal = document.getElementById('avatarModal');
  const avatarStudioBtn = document.getElementById('avatarStudioBtn');
  const avatarModalClose = document.getElementById('avatarModalClose');
  const avatarFileInput = document.getElementById('avatarFileInput');
  const avatarUploadBtn = document.getElementById('avatarUploadBtn');
  const avatarCameraBtn = document.getElementById('avatarCameraBtn');
  const avatarConsentCheck = document.getElementById('avatarConsentCheck');
  const avatarSaveBtn = document.getElementById('avatarSaveBtn');
  const avatarRevokeBtn = document.getElementById('avatarRevokeBtn');
  const avatarNameInput = document.getElementById('avatarNameInput');
  const avatarStatusMsg = document.getElementById('avatarStatusMsg');
  const avatarPlaceholder = document.getElementById('avatarPlaceholder');

  if (orbCanvas) {
    orbEngine = new HolographicAvatarEngine(orbCanvas);
    window.__cfAvatarEngine = orbEngine;
  }

  if (studioCanvas) {
    studioEngine = new HolographicAvatarEngine(studioCanvas);
  }

  // Load existing active avatar from Neon DB
  try {
    const res = await apiRequest('/api/avatar');
    if (res.ok && Array.isArray(res.avatars) && res.avatars.length > 0) {
      const active = res.avatars.find((a) => a.is_active) || res.avatars[0];
      if (active && active.photo_url) {
        currentAvatar = active;
        if (orbEngine && orbCanvas) {
          await orbEngine.loadPhoto(active.photo_url);
          orbCanvas.style.display = 'block';
          if (orbIcon) orbIcon.style.display = 'none';
        }
      }
    }
  } catch (err) {
    console.warn('[avatar-ui] Initial avatar fetch failed:', err);
  }

  // Modal open / close
  if (avatarStudioBtn) {
    avatarStudioBtn.addEventListener('click', () => {
      // close menu
      const menu = document.getElementById('appMenuDropdown');
      if (menu) menu.classList.add('hidden');

      if (avatarModal) avatarModal.classList.remove('hidden');
      if (currentAvatar) {
        if (avatarNameInput) avatarNameInput.value = currentAvatar.name;
        if (studioEngine && currentAvatar.photo_url) {
          studioEngine.loadPhoto(currentAvatar.photo_url);
          if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
        }
        if (avatarRevokeBtn) avatarRevokeBtn.style.display = 'inline-block';
      }
    });
  }

  if (avatarModalClose) {
    avatarModalClose.addEventListener('click', () => {
      if (avatarModal) avatarModal.classList.add('hidden');
    });
  }

  // Photo upload handler
  if (avatarUploadBtn) {
    avatarUploadBtn.addEventListener('click', async () => {
      if (window.Capacitor?.Plugins?.Camera) {
        try {
          const image = await window.Capacitor.Plugins.Camera.getPhoto({
            quality: 85,
            allowEditing: false,
            source: 'PHOTOS',
            resultType: 'dataUrl',
          });
          if (image?.dataUrl) {
            pendingPhotoDataUrl = image.dataUrl;
            if (studioEngine) {
              await studioEngine.loadPhoto(pendingPhotoDataUrl);
              if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
            }
            checkCanSave();
            return;
          }
        } catch (err) {
          console.warn('[avatar-ui] Photos picker canceled or failed:', err);
        }
      }
      if (avatarFileInput) avatarFileInput.click();
    });
    if (avatarFileInput) {
      avatarFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
          pendingPhotoDataUrl = evt.target.result;
          if (studioEngine) {
            await studioEngine.loadPhoto(pendingPhotoDataUrl);
            if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
          }
          checkCanSave();
        };
        reader.readAsDataURL(file);
      });
    }
  }

  // Native camera handler
  if (avatarCameraBtn) {
    avatarCameraBtn.addEventListener('click', async () => {
      if (window.Capacitor?.Plugins?.Camera) {
        try {
          const image = await window.Capacitor.Plugins.Camera.getPhoto({
            quality: 85,
            allowEditing: false,
            source: 'CAMERA',
            resultType: 'dataUrl',
          });
          if (image?.dataUrl) {
            pendingPhotoDataUrl = image.dataUrl;
            if (studioEngine) {
              await studioEngine.loadPhoto(pendingPhotoDataUrl);
              if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
            }
            checkCanSave();
          }
        } catch (err) {
          console.warn('[avatar-ui] Camera canceled or failed:', err);
        }
      } else {
        if (avatarFileInput) avatarFileInput.click();
      }
    });
  }

  function checkCanSave() {
    const hasPhoto = Boolean(pendingPhotoDataUrl || (currentAvatar && currentAvatar.photo_url));
    const hasConsent = avatarConsentCheck ? avatarConsentCheck.checked : false;
    const hasName = avatarNameInput && avatarNameInput.value.trim().length > 0;
    if (avatarSaveBtn) {
      avatarSaveBtn.disabled = !(hasPhoto && hasConsent && hasName);
    }
  }

  if (avatarConsentCheck) {
    avatarConsentCheck.addEventListener('change', checkCanSave);
  }
  if (avatarNameInput) {
    avatarNameInput.addEventListener('input', checkCanSave);
  }

  // Save / Activate Avatar
  if (avatarSaveBtn) {
    avatarSaveBtn.addEventListener('click', async () => {
      avatarSaveBtn.disabled = true;
      if (avatarStatusMsg) avatarStatusMsg.textContent = 'Saving avatar & recording statutory consent...';

      const photoUrl = pendingPhotoDataUrl || currentAvatar?.photo_url;
      const name = avatarNameInput ? avatarNameInput.value.trim() : 'Avatar';
      const statement = 'I verify and authorize digital replica likeness consent under California AB 2602 / NO FAKES Act.';

      try {
        const res = await apiRequest('/api/avatar/create', {
          method: 'POST',
          body: JSON.stringify({
            name,
            photo_url: photoUrl,
            consent_type: 'self',
            statement,
          }),
        });

        if (res.ok && res.avatar) {
          currentAvatar = res.avatar;
          pendingPhotoDataUrl = null;
          if (orbEngine && orbCanvas) {
            await orbEngine.loadPhoto(res.avatar.photo_url);
            orbCanvas.style.display = 'block';
            if (orbIcon) orbIcon.style.display = 'none';
          }
          if (avatarStatusMsg) avatarStatusMsg.textContent = 'Avatar active! You will now see your avatar in the Voice Orb.';
          setTimeout(() => {
            if (avatarModal) avatarModal.classList.add('hidden');
            if (avatarStatusMsg) avatarStatusMsg.textContent = '';
          }, 1500);
        } else {
          if (avatarStatusMsg) avatarStatusMsg.textContent = 'Error: ' + (res.error || 'Failed to save');
          avatarSaveBtn.disabled = false;
        }
      } catch (err) {
        if (avatarStatusMsg) avatarStatusMsg.textContent = 'Network error: ' + err.message;
        avatarSaveBtn.disabled = false;
      }
    });
  }

  // Revoke Likeness
  if (avatarRevokeBtn) {
    avatarRevokeBtn.addEventListener('click', async () => {
      if (!currentAvatar) return;
      if (!confirm('Are you sure you want to revoke and permanently delete this digital likeness?')) return;

      try {
        await apiRequest('/api/avatar/revoke', {
          method: 'POST',
          body: JSON.stringify({ avatar_id: currentAvatar.id }),
        });
        currentAvatar = null;
        pendingPhotoDataUrl = null;
        if (orbCanvas) orbCanvas.style.display = 'none';
        if (orbIcon) orbIcon.style.display = 'inline-block';
        if (studioEngine) studioEngine.stop();
        if (avatarPlaceholder) avatarPlaceholder.style.display = 'flex';
        avatarRevokeBtn.style.display = 'none';
        if (avatarModal) avatarModal.classList.add('hidden');
      } catch (err) {
        alert('Revocation error: ' + err.message);
      }
    });
  }
}

// Auto-boot on load
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAvatarSystem);
  } else {
    initAvatarSystem();
  }
}
