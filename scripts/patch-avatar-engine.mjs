import fs from 'fs';

const enginePath = 'E:/CapstoneFoundry/public/avatar-engine.js';
let engine = fs.readFileSync(enginePath, 'utf8');

// 1. Upgrade attachCanvas for Retina / High-DPI support
const oldAttach = `  attachCanvas(canvas) {
    if (!canvas) return;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width || 240;
    this.height = canvas.height || 240;
    if (this.isLoaded && !this.rafId) {
      this.start();
    }
  }`;

const newAttach = `  attachCanvas(canvas) {
    if (!canvas) return;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const displayW = canvas.clientWidth || parseInt(canvas.style.width, 10) || 240;
    const displayH = canvas.clientHeight || parseInt(canvas.style.height, 10) || 240;
    if (displayW > 0 && displayH > 0 && (canvas.width !== Math.round(displayW * dpr))) {
      canvas.width = Math.round(displayW * dpr);
      canvas.height = Math.round(displayH * dpr);
    }
    this.width = canvas.width || 240;
    this.height = canvas.height || 240;
    if (this.isLoaded && !this.rafId) {
      this.start();
    }
  }`;

if (engine.includes('attachCanvas(canvas) {')) {
  engine = engine.replace(oldAttach, newAttach);
  console.log('Upgraded attachCanvas with Retina / High-DPI resolution scaling');
}

// 2. Add Web Audio analyser support
if (!engine.includes('attachAudioElement(audioEl)')) {
  const insertTarget = `  setSpeaking(speaking) {
    this.isSpeaking = Boolean(speaking);
    if (!this.isSpeaking) {
      this.targetMouthOpen = 0;
    }
  }`;

  const audioEnhancement = `  setSpeaking(speaking) {
    this.isSpeaking = Boolean(speaking);
    if (!this.isSpeaking) {
      this.targetMouthOpen = 0;
    }
  }

  attachAudioElement(audioEl) {
    if (!audioEl || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) this.audioCtx = new AudioCtx();
      if (!this.analyser) {
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 128;
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      }
      if (!this.audioSourceNode && audioEl.tagName) {
        this.audioSourceNode = this.audioCtx.createMediaElementSource(audioEl);
        this.audioSourceNode.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
      }
    } catch (e) {
      // Audio element may already be connected or blocked by user gesture; fallback to volume/time
    }
  }`;

  engine = engine.replace(insertTarget, audioEnhancement);
  console.log('Added attachAudioElement Web Audio analyser support');
}

fs.writeFileSync(enginePath, engine, 'utf8');
