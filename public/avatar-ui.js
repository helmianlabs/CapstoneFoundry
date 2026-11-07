// public/avatar-ui.js — UI Controller for Holographic Avatar Studio
// Zero-cost real-time facial mesh synthesis & lip-sync for Capstone Foundry.
// Compliant with California AB 2602 / AB 1836, NO FAKES Act & App Store Guidelines.
// Supports both Photos and Videos (neck-up, waist-up, full-body).

import { HolographicAvatarEngine } from './avatar-engine.js';

let orbEngine = null;
let studioEngine = null;
let currentAvatar = null;
let pendingMediaDataUrl = null;

function getAuthToken() {
  try {
    return (
      localStorage.getItem('tb_token') ||
      localStorage.getItem('thinkinbuddy_session_token') ||
      localStorage.getItem('token') ||
      ''
    );
  } catch {
    return '';
  }
}

function getTenantId() {
  try {
    return (
      localStorage.getItem('tb_tenant') ||
      localStorage.getItem('thinkinbuddy_user_id') ||
      ''
    );
  } catch {
    return '';
  }
}

async function apiRequest(path, options = {}) {
  const token = getAuthToken();
  const tenantId = getTenantId();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Server response error: ${text.slice(0, 100)}`);
  }
}


// Client-side media optimizer to prevent HTTP 413 Payload Too Large
async function optimizeMediaFile(file) {
  if (file.type && file.type.startsWith('image/')) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 720;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => {
        const r = new FileReader();
        r.onload = (e) => resolve(e.target.result);
        r.readAsDataURL(file);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  if (file.type && file.type.startsWith('video/')) {
    if (file.size <= 2.5 * 1024 * 1024) {
      return new Promise((resolve) => {
        const r = new FileReader();
        r.onload = (e) => resolve(e.target.result);
        r.readAsDataURL(file);
      });
    }

    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(file);
      video.muted = true;
      video.playsInline = true;

      video.onloadedmetadata = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 320;
        const ctx = canvas.getContext('2d');
        const minDim = Math.min(video.videoWidth, video.videoHeight);
        const sx = (video.videoWidth - minDim) / 2;
        const sy = (video.videoHeight - minDim) / 2;

        try {
          const stream = canvas.captureStream(24);
          const mime = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp8'))
            ? 'video/webm;codecs=vp8'
            : 'video/webm';
          const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 450000 });
          const chunks = [];
          recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: mime });
            const reader = new FileReader();
            reader.onload = (evt) => resolve(evt.target.result);
            reader.readAsDataURL(blob);
            URL.revokeObjectURL(video.src);
          };

          video.play();
          recorder.start();

          const maxDuration = Math.min(video.duration || 10, 12);
          const drawLoop = () => {
            if (video.paused || video.ended || video.currentTime >= maxDuration) {
              if (recorder.state === 'recording') recorder.stop();
              video.pause();
              return;
            }
            ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, 320, 320);
            requestAnimationFrame(drawLoop);
          };
          drawLoop();
        } catch (e) {
          console.warn('[avatar-ui] Video transcode fallback:', e);
          const r = new FileReader();
          r.onload = (evt) => resolve(evt.target.result);
          r.readAsDataURL(file);
        }
      };

      video.onerror = () => {
        const r = new FileReader();
        r.onload = (evt) => resolve(evt.target.result);
        r.readAsDataURL(file);
      };
    });
  }

  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target.result);
    r.readAsDataURL(file);
  });
}

export async function initAvatarSystem() {
  const orb = document.getElementById('orb');
  let orbCanvas = document.getElementById('avatarCanvas');
  if (orb && !orbCanvas) {
    orbCanvas = document.createElement('canvas');
    orbCanvas.id = 'avatarCanvas';
    orbCanvas.width = 240;
    orbCanvas.height = 240;
    orbCanvas.style.cssText = 'display:none; position:absolute; inset:0; width:100%; height:100%; border-radius:50%; object-fit:cover; z-index:1; pointer-events:none;';
    orb.insertBefore(orbCanvas, orb.firstChild);
  }
  const orbIcon = document.getElementById('orbIcon') || (orb && orb.querySelector('.orb-icon'));
  const studioCanvas = document.getElementById('avatarStudioCanvas');
  const avatarModal = document.getElementById('avatarModal');
  const avatarStudioBtn = document.getElementById('avatarStudioBtn');
  const avatarModalClose = document.getElementById('avatarModalClose');
  const avatarFileInput = document.getElementById('avatarFileInput');
  const avatarVideoInput = document.getElementById('avatarVideoInput');
  const avatarUploadBtn = document.getElementById('avatarUploadBtn');
  const avatarCameraBtn = document.getElementById('avatarCameraBtn');
  const avatarVideoBtn = document.getElementById('avatarVideoBtn');
  const avatarConsentCheck = document.getElementById('avatarConsentCheck');
  const avatarSaveBtn = document.getElementById('avatarSaveBtn');
  const avatarRevokeBtn = document.getElementById('avatarRevokeBtn');
  const avatarNameInput = document.getElementById('avatarNameInput');
  const avatarStatusMsg = document.getElementById('avatarStatusMsg');
  const avatarPlaceholder = document.getElementById('avatarPlaceholder');

  if (orbCanvas) {
    if (!orbEngine) {
      orbEngine = new HolographicAvatarEngine(orbCanvas);
      window.__cfAvatarEngine = orbEngine;
    } else {
      orbEngine.attachCanvas(orbCanvas);
    }
  }

  if (studioCanvas && !studioEngine) {
    studioEngine = new HolographicAvatarEngine(studioCanvas);
  }

  // Expose global controller
  window.__cfAvatarUi = {
    initAvatarSystem,
    getActiveAvatar: () => currentAvatar,
  };

  // Load existing active avatar from Neon DB
  try {
    const res = await apiRequest('/api/avatar');
    if (res.ok && Array.isArray(res.avatars) && res.avatars.length > 0) {
      const active = res.avatars.find((a) => a.is_active) || res.avatars[0];
      if (active && active.photo_url) {
        currentAvatar = active;
        if (orbEngine && orbCanvas) {
          await orbEngine.loadMedia(active.photo_url);
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
      const menu = document.getElementById('appMenuDropdown');
      if (menu) menu.classList.add('hidden');

      if (avatarModal) avatarModal.classList.remove('hidden');
      if (currentAvatar) {
        if (avatarNameInput) avatarNameInput.value = currentAvatar.name;
        if (studioEngine && currentAvatar.photo_url) {
          studioEngine.loadMedia(currentAvatar.photo_url);
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

  function handleLoadedMedia(dataUrl) {
    pendingMediaDataUrl = dataUrl;
    if (studioEngine) {
      studioEngine.loadMedia(pendingMediaDataUrl).then(() => {
        if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
      }).catch((e) => console.error('Media load error:', e));
    }
    checkCanSave();
  }

  // Choose Photo or Video file handler
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
            handleLoadedMedia(image.dataUrl);
            return;
          }
        } catch (err) {
          console.warn('[avatar-ui] Photos picker canceled or failed:', err);
        }
      }
      if (avatarFileInput) avatarFileInput.click();
    });
  }

  if (avatarFileInput) {
    avatarFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (avatarStatusMsg) avatarStatusMsg.textContent = 'Optimizing media for avatar orb...';
      const dataUrl = await optimizeMediaFile(file);
      if (avatarStatusMsg) avatarStatusMsg.textContent = '';
      handleLoadedMedia(dataUrl);
    });
  }

  // Native camera photo handler
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
            handleLoadedMedia(image.dataUrl);
            return;
          }
        } catch (err) {
          console.warn('[avatar-ui] Camera photo canceled or failed:', err);
        }
      }
      if (avatarFileInput) avatarFileInput.click();
    });
  }

  // Native video recording handler
  if (avatarVideoBtn) {
    avatarVideoBtn.addEventListener('click', () => {
      if (avatarVideoInput) {
        avatarVideoInput.click();
      } else if (avatarFileInput) {
        avatarFileInput.click();
      }
    });
  }

  if (avatarVideoInput) {
    avatarVideoInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (avatarStatusMsg) avatarStatusMsg.textContent = 'Compressing video for 60fps avatar...';
      const dataUrl = await optimizeMediaFile(file);
      if (avatarStatusMsg) avatarStatusMsg.textContent = '';
      handleLoadedMedia(dataUrl);
    });
  }

  function checkCanSave() {
    const hasMedia = Boolean(pendingMediaDataUrl || (currentAvatar && currentAvatar.photo_url));
    const hasConsent = avatarConsentCheck ? avatarConsentCheck.checked : false;
    const hasName = avatarNameInput && avatarNameInput.value.trim().length > 0;
    if (avatarSaveBtn) {
      avatarSaveBtn.disabled = !(hasMedia && hasConsent && hasName);
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

      const mediaUrl = pendingMediaDataUrl || currentAvatar?.photo_url;
      const name = avatarNameInput ? avatarNameInput.value.trim() : 'Avatar';
      const statement = 'I verify and authorize digital replica likeness consent under California AB 2602 / NO FAKES Act.';
      const tenantId = getTenantId();

      try {
        const payload = {
          tenant_id: tenantId,
          name,
          photo_url: mediaUrl,
          subject_name: name,
          consent_statement: statement,
        };

        const res = await apiRequest('/api/avatar/create', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        if (res.ok && res.avatar) {
          currentAvatar = res.avatar;
          pendingMediaDataUrl = null;

          // Activate in live Voice Orb
          await apiRequest('/api/avatar/activate', {
            method: 'POST',
            body: JSON.stringify({ avatar_id: res.avatar.id }),
          });

          if (orbEngine && orbCanvas) {
            await orbEngine.loadMedia(res.avatar.photo_url);
            orbCanvas.style.display = 'block';
            if (orbIcon) orbIcon.style.display = 'none';
          }

          if (avatarStatusMsg) {
            avatarStatusMsg.textContent = '✓ Digital Avatar activated successfully!';
            avatarStatusMsg.style.color = '#00ff88';
          }
          if (avatarRevokeBtn) avatarRevokeBtn.style.display = 'inline-block';

          setTimeout(() => {
            if (avatarModal) avatarModal.classList.add('hidden');
            if (avatarStatusMsg) avatarStatusMsg.textContent = '';
          }, 1200);
        } else {
          throw new Error(res.error || 'Failed to create avatar profile');
        }
      } catch (err) {
        console.error('[avatar-ui] Activation error:', err);
        if (avatarStatusMsg) {
          avatarStatusMsg.textContent = `Error: ${err.message}`;
          avatarStatusMsg.style.color = '#ff4466';
        }
        avatarSaveBtn.disabled = false;
      }
    });
  }

  // Revoke Avatar
  if (avatarRevokeBtn) {
    avatarRevokeBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to revoke this digital avatar license and remove your likeness?')) return;
      avatarRevokeBtn.disabled = true;
      if (avatarStatusMsg) avatarStatusMsg.textContent = 'Revoking license & deleting biometric likeness...';

      try {
        const avatarId = currentAvatar?.id;
        const res = await apiRequest('/api/avatar/revoke', {
          method: 'POST',
          body: JSON.stringify({ avatar_id: avatarId }),
        });

        if (res.ok) {
          currentAvatar = null;
          pendingMediaDataUrl = null;
          if (orbEngine) orbEngine.stop();
          if (orbCanvas) orbCanvas.style.display = 'none';
          if (orbIcon) orbIcon.style.display = 'inline-block';
          if (studioEngine) studioEngine.stop();
          if (avatarPlaceholder) avatarPlaceholder.style.display = 'flex';
          if (avatarNameInput) avatarNameInput.value = '';
          if (avatarConsentCheck) avatarConsentCheck.checked = false;
          avatarRevokeBtn.style.display = 'none';

          if (avatarStatusMsg) {
            avatarStatusMsg.textContent = '✓ Likeness revoked. Data permanently deleted.';
            avatarStatusMsg.style.color = '#00d4ff';
          }

          setTimeout(() => {
            if (avatarModal) avatarModal.classList.add('hidden');
            if (avatarStatusMsg) avatarStatusMsg.textContent = '';
          }, 1200);
        } else {
          throw new Error(res.error || 'Failed to revoke avatar');
        }
      } catch (err) {
        console.error('[avatar-ui] Revoke error:', err);
        if (avatarStatusMsg) {
          avatarStatusMsg.textContent = `Error: ${err.message}`;
          avatarStatusMsg.style.color = '#ff4466';
        }
        avatarRevokeBtn.disabled = false;
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAvatarSystem);
} else {
  initAvatarSystem();
}
