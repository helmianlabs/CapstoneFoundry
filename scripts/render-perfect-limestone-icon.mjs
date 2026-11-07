import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PLAY_DIR = path.resolve('docs/store/google-play-bundle');
const PUBLIC_DIR = path.resolve('public');

async function renderLimestone() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 512, height: 512 });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0; padding: 0;
          width: 512px; height: 512px;
          background: #080c14;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          font-family: "Georgia", "Times New Roman", serif;
        }
        .container {
          position: relative;
          width: 512px; height: 512px;
          background: radial-gradient(circle at 50% 45%, #111a2e 0%, #05080e 80%);
          display: flex; align-items: center; justify-content: center;
        }
        .svg-icon {
          width: 480px; height: 480px;
          filter: drop-shadow(0 20px 35px rgba(0,0,0,0.9)) drop-shadow(0 0 25px rgba(0, 212, 255, 0.15));
        }
      </style>
    </head>
    <body>
      <div class="container">
        <svg class="svg-icon" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <!-- Realistic Limestone Grain Texture -->
            <filter id="stone-texture" x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="4" result="noise" />
              <feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0.22 0" in="noise" result="tintedNoise" />
              <feComposite operator="in" in2="SourceGraphic" />
              <feBlend mode="multiply" in="SourceGraphic" />
            </filter>

            <!-- Natural Travertine / Limestone Gradients -->
            <linearGradient id="limestone-face" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#fffdfa" />
              <stop offset="25%" stop-color="#f4eee1" />
              <stop offset="60%" stop-color="#ded4bf" />
              <stop offset="90%" stop-color="#c4b69d" />
              <stop offset="100%" stop-color="#a89a80" />
            </linearGradient>

            <linearGradient id="chisel-highlight" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9" />
              <stop offset="100%" stop-color="#dfd5be" stop-opacity="0.2" />
            </linearGradient>

            <linearGradient id="chisel-shadow" x1="100%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stop-color="#3d3528" />
              <stop offset="100%" stop-color="#706450" />
            </linearGradient>

            <radialGradient id="ambient-cyan" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="rgba(0, 212, 255, 0.12)" />
              <stop offset="100%" stop-color="rgba(0, 212, 255, 0)" />
            </radialGradient>
          </defs>

          <!-- Ambient Glow -->
          <circle cx="256" cy="256" r="230" fill="url(#ambient-cyan)" />

          <!-- Outer Fine Geometric Compass Ring (High Tech Blueprint Anchor) -->
          <circle cx="256" cy="256" r="215" fill="none" stroke="rgba(0, 212, 255, 0.2)" stroke-width="1.5" stroke-dasharray="3 6" />
          <circle cx="256" cy="256" r="225" fill="none" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1" />

          <!-- ================= LIMESTONE 'C' ================= -->
          <!-- Drop Shadow Base Layer -->
          <path d="M 370 155
                   C 335 100, 256 85, 195 110
                   C 115 145, 80 230, 95 315
                   C 115 395, 195 440, 280 435
                   C 340 430, 380 395, 395 350
                   L 325 325
                   C 310 355, 280 375, 245 375
                   C 185 375, 150 330, 150 256
                   C 150 182, 190 145, 250 145
                   C 290 145, 320 165, 335 195
                   Z"
                fill="#020408" transform="translate(4, 12)" opacity="0.6" />

          <!-- Chiseled Bevel Shadow Layer -->
          <path d="M 370 155
                   C 335 100, 256 85, 195 110
                   C 115 145, 80 230, 95 315
                   C 115 395, 195 440, 280 435
                   C 340 430, 380 395, 395 350
                   L 325 325
                   C 310 355, 280 375, 245 375
                   C 185 375, 150 330, 150 256
                   C 150 182, 190 145, 250 145
                   C 290 145, 320 165, 335 195
                   Z"
                fill="url(#chisel-shadow)" />

          <!-- Main Limestone Face with Fine Stone Grain -->
          <path d="M 364 158
                   C 331 106, 255 92, 197 115
                   C 120 148, 87 230, 101 311
                   C 120 388, 197 431, 278 426
                   C 335 422, 372 389, 386 346
                   L 322 323
                   C 308 351, 280 369, 246 369
                   C 189 369, 156 326, 156 256
                   C 156 186, 194 151, 252 151
                   C 289 151, 318 169, 331 197
                   Z"
                fill="url(#limestone-face)"
                filter="url(#stone-texture)" />

          <!-- Sharp Chiseled Ridge Lines (Stonecraft Highlights) -->
          <path d="M 364 158 C 331 106, 255 92, 197 115 C 120 148, 87 230, 101 311 C 120 388, 197 431, 278 426"
                fill="none" stroke="url(#chisel-highlight)" stroke-width="3.5" stroke-linecap="round" />
          <path d="M 331 197 C 318 169, 289 151, 252 151 C 194 151, 156 186, 156 256 C 156 326, 189 369, 246 369 C 280 369, 308 351, 322 323"
                fill="none" stroke="#ffffff" stroke-width="2" opacity="0.6" />

          <!-- Terminal Chisel Facets on the C Tips -->
          <polygon points="364,158 331,197 348,206 378,170" fill="#ede4d1" opacity="0.9" />
          <polygon points="386,346 322,323 315,338 375,362" fill="#756752" opacity="0.7" />

          <!-- ================= NAME INSIDE THE C ================= -->
          <!-- Inset Shadow Plate for Carved Text -->
          <g transform="translate(252, 240)">
            <!-- Deep Inset Shadow -->
            <text x="0" y="0"
                  font-family="'Georgia', 'Times New Roman', serif"
                  font-size="28"
                  font-weight="900"
                  letter-spacing="5"
                  text-anchor="middle"
                  fill="#1c160e"
                  opacity="0.8"
                  transform="translate(1, 2)">CAPSTONE</text>

            <!-- Main Chiseled Limestone Inscription -->
            <text x="0" y="0"
                  font-family="'Georgia', 'Times New Roman', serif"
                  font-size="28"
                  font-weight="900"
                  letter-spacing="5"
                  text-anchor="middle"
                  fill="#f7f3ea">CAPSTONE</text>

            <!-- Chiseled White Top Bevel -->
            <text x="0" y="0"
                  font-family="'Georgia', 'Times New Roman', serif"
                  font-size="28"
                  font-weight="900"
                  letter-spacing="5"
                  text-anchor="middle"
                  fill="none"
                  stroke="#ffffff"
                  stroke-width="0.8"
                  opacity="0.9">CAPSTONE</text>
          </g>

          <!-- "FOUNDRY" Cyan Tech Accent Inscribed Below -->
          <g transform="translate(252, 274)">
            <text x="0" y="0"
                  font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                  font-size="12"
                  font-weight="800"
                  letter-spacing="9"
                  text-anchor="middle"
                  fill="#00d4ff"
                  filter="drop-shadow(0 0 8px rgba(0,212,255,0.85))">FOUNDRY</text>
          </g>

          <!-- Technical Caliper Accent Lines (Precision Engineering Touch) -->
          <line x1="180" y1="210" x2="324" y2="210" stroke="rgba(0, 212, 255, 0.4)" stroke-width="1" stroke-dasharray="2 4" />
          <line x1="180" y1="298" x2="324" y2="298" stroke="rgba(0, 212, 255, 0.4)" stroke-width="1" stroke-dasharray="2 4" />
        </svg>
      </div>
    </body>
    </html>
  `;

  await page.setContent(html);

  // 1. Google Play 512x512 Icon
  const playIcon = path.join(PLAY_DIR, 'app-icon-512x512.png');
  await page.screenshot({ path: playIcon, type: 'png' });
  console.log('✓ Saved Perfect Limestone Play Icon:', playIcon);

  // 2. Public Web Favicon & PWA Icon
  const publicIcon = path.join(PUBLIC_DIR, 'icon-512.png');
  await page.screenshot({ path: publicIcon, type: 'png' });
  console.log('✓ Saved Public Web Icon:', publicIcon);

  // Copy to Android Mipmaps
  const mipmapDirs = [
    'android/app/src/main/res/mipmap-mdpi',
    'android/app/src/main/res/mipmap-hdpi',
    'android/app/src/main/res/mipmap-xhdpi',
    'android/app/src/main/res/mipmap-xxhdpi',
    'android/app/src/main/res/mipmap-xxxhdpi'
  ];

  for (const mDir of mipmapDirs) {
    const fullDir = path.resolve(mDir);
    if (fs.existsSync(fullDir)) {
      fs.copyFileSync(publicIcon, path.join(fullDir, 'ic_launcher.png'));
      fs.copyFileSync(publicIcon, path.join(fullDir, 'ic_launcher_round.png'));
    }
  }

  await browser.close();
  console.log('🎉 Done rendering perfect limestone C icon!');
}

renderLimestone().catch(e => {
  console.error(e);
  process.exit(1);
});
