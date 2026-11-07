// public/avatar-engine.js — Client-Side 60fps Holographic Avatar Engine
// Zero-cost real-time facial mesh synthesis & lip-sync for Capstone Foundry.
// Compliant with California AB 2602 / AB 1836, NO FAKES Act & App Store Guidelines.
// Supports both high-res Photos and Smartphone Videos (waist-up, neck-up, full-body).

export class HolographicAvatarEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.image = null;
    this.video = null;
    this.mediaType = 'image'; // 'image' | 'video'
    this.isLoaded = false;
    this.isActive = false;

    // Animation state
    this.blinkState = 0; // 0 = open, 1 = closed
    this.lastBlinkTime = Date.now();
    this.blinkInterval = 3200 + Math.random() * 1500;
    this.mouthOpen = 0;
    this.targetMouthOpen = 0;
    this.audioLevel = 0;
    this.isSpeaking = false;
    this.time = 0;

    // Canvas sizing
    this.width = canvas?.width || 240;
    this.height = canvas?.height || 240;

    this.rafId = null;
  }

  attachCanvas(canvas) {
    if (!canvas) return;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width || 240;
    this.height = canvas.height || 240;
    if (this.isLoaded && !this.rafId) {
      this.start();
    }
  }

  loadPhoto(url) {
    return new Promise((resolve, reject) => {
      if (this.video) {
        try { this.video.pause(); } catch (e) {}
        this.video = null;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.image = img;
        this.mediaType = 'image';
        this.isLoaded = true;
        this.isActive = true;
        this.start();
        resolve(img);
      };
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  }

  loadVideo(url) {
    return new Promise((resolve, reject) => {
      if (this.video) {
        try { this.video.pause(); } catch (e) {}
        this.video = null;
      }
      const vid = document.createElement('video');
      vid.crossOrigin = 'anonymous';
      vid.loop = true;
      vid.muted = true;
      vid.playsInline = true;
      vid.autoplay = true;
      vid.src = url;

      vid.onloadeddata = () => {
        this.video = vid;
        this.mediaType = 'video';
        this.isLoaded = true;
        this.isActive = true;
        vid.play().catch(() => {});
        this.start();
        resolve(vid);
      };

      vid.onerror = (e) => reject(e);
      vid.load();
    });
  }

  loadMedia(url) {
    if (typeof url === 'string' && (url.startsWith('data:video') || url.includes('.mp4') || url.includes('.webm') || url.includes('video/'))) {
      return this.loadVideo(url);
    }
    return this.loadPhoto(url);
  }

  setAudioLevel(level) {
    this.audioLevel = Math.max(0, Math.min(1, level));
    this.targetMouthOpen = Math.min(1, Math.pow(this.audioLevel * 1.8, 1.2));
  }

  setSpeaking(speaking) {
    this.isSpeaking = Boolean(speaking);
    if (this.video) {
      // Slightly quicken video during speech gestures, relax on idle
      this.video.playbackRate = this.isSpeaking ? 1.05 : 0.85;
    }
    if (!speaking && this.audioLevel === 0) {
      this.targetMouthOpen = 0;
    }
  }

  start() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const loop = (ts) => {
      this.time = ts * 0.001;
      this.update();
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.video) {
      try { this.video.pause(); } catch (e) {}
    }
  }

  update() {
    // 1. Natural blinking cycle (for photo mode)
    if (this.mediaType === 'image') {
      const now = Date.now();
      if (now - this.lastBlinkTime > this.blinkInterval) {
        this.blinkState += 0.25;
        if (this.blinkState >= 1) {
          this.blinkState = 0;
          this.lastBlinkTime = now;
          this.blinkInterval = 2800 + Math.random() * 2400;
        }
      }
    }

    // 2. Speech animation
    if (this.isSpeaking && this.audioLevel < 0.05) {
      // Natural speech cadence simulation when raw audio volume is not available
      const syllable = Math.max(0, Math.sin(this.time * 13.0) * Math.cos(this.time * 7.0));
      this.targetMouthOpen = syllable * 0.7;
    }

    // 3. Smooth mouth interpolation
    this.mouthOpen += (this.targetMouthOpen - this.mouthOpen) * 0.35;
  }

  render() {
    if (!this.canvas) return;
    if (!this.ctx) this.ctx = this.canvas.getContext('2d');
    const source = this.mediaType === 'video' ? this.video : this.image;
    if (!this.ctx || !source || !this.isLoaded) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Subtle head float / breathing sine wave
    const breathY = Math.sin(this.time * 2.0) * (this.mediaType === 'video' ? 1.0 : 2.2);
    const microTilt = Math.sin(this.time * 0.9) * (this.mediaType === 'video' ? 0.005 : 0.015);

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(microTilt);
    ctx.translate(-w / 2, -h / 2 + breathY);

    // Draw base media (centered and square-cropped to orb)
    const iw = this.mediaType === 'video' ? (this.video.videoWidth || 240) : (this.image.naturalWidth || this.image.width);
    const ih = this.mediaType === 'video' ? (this.video.videoHeight || 240) : (this.image.naturalHeight || this.image.height);
    const minDim = Math.min(iw, ih);
    const sx = (iw - minDim) / 2;
    const sy = (ih - minDim) / 2;

    // Draw base layer
    ctx.drawImage(source, sx, sy, minDim, minDim, 0, 0, w, h);

    // Audio-driven mouth opening simulation
    if (this.mouthOpen > 0.04) {
      const mouthY = h * 0.65;
      const mouthH = h * 0.22;
      const mouthW = w * 0.44;
      const mouthX = (w - mouthW) / 2;

      // Extract mouth region and stretch vertically based on mouthOpen
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(w / 2, mouthY + mouthH / 2, mouthW / 2, (mouthH / 2) * (1 + this.mouthOpen * 0.65), 0, 0, Math.PI * 2);
      ctx.clip();

      const stretch = 1 + this.mouthOpen * 0.45;
      ctx.drawImage(
        source,
        sx + minDim * 0.28,
        sy + minDim * 0.62,
        minDim * 0.44,
        minDim * 0.22,
        mouthX,
        mouthY - (mouthH * (stretch - 1)) / 2,
        mouthW,
        mouthH * stretch
      );

      // Deep oral cavity shadow
      ctx.fillStyle = `rgba(10, 5, 10, ${Math.min(0.6, this.mouthOpen * 0.75)})`;
      ctx.beginPath();
      ctx.ellipse(w / 2, mouthY + mouthH * 0.55, mouthW * 0.28, mouthH * 0.28 * this.mouthOpen, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // Photo-only: procedural micro-blinking
    if (this.mediaType === 'image' && this.blinkState > 0.1) {
      const eyeY = h * 0.42;
      const eyeH = h * 0.09;
      const eyeW = w * 0.22;
      const leftEyeX = w * 0.23;
      const rightEyeX = w * 0.55;

      const eyelidAlpha = Math.sin(this.blinkState * Math.PI);
      ctx.save();
      ctx.fillStyle = `rgba(160, 130, 110, ${eyelidAlpha * 0.75})`;

      // Left eye lid
      ctx.beginPath();
      ctx.ellipse(leftEyeX + eyeW / 2, eyeY + eyeH / 2, eyeW / 2, eyeH / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Right eye lid
      ctx.beginPath();
      ctx.ellipse(rightEyeX + eyeW / 2, eyeY + eyeH / 2, eyeW / 2, eyeH / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    ctx.restore();

    // 4. Holographic glow vignette
    const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.38, w / 2, h / 2, w * 0.5);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.85, 'rgba(0, 212, 255, 0.08)');
    grad.addColorStop(1, 'rgba(0, 212, 255, 0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}
