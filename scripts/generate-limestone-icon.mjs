import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PLAY_DIR = path.resolve('docs/store/google-play-bundle');
const PUBLIC_DIR = path.resolve('public');
fs.mkdirSync(PLAY_DIR, { recursive: true });

async function generateLimestoneIcon() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 2 });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0; padding: 0;
          width: 512px; height: 512px;
          background: #06090e;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Cinzel", "Trajan Pro", "Georgia", serif;
        }
        .container {
          position: relative;
          width: 512px; height: 512px;
          background: radial-gradient(circle at 50% 45%, #101826 0%, #06090e 75%);
          display: flex; align-items: center; justify-content: center;
        }
        .outer-glow {
          position: absolute;
          width: 440px; height: 440px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(0, 212, 255, 0.08) 0%, transparent 70%);
        }
        .svg-icon {
          width: 460px; height: 460px;
          filter: drop-shadow(0 18px 30px rgba(0,0,0,0.85)) drop-shadow(0 0 25px rgba(0, 212, 255, 0.2));
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="outer-glow"></div>
        <svg class="svg-icon" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <!-- Limestone Texture Filters -->
            <filter id="limestone-grain" x="0%" y="0%" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" result="noise" />
              <feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0.18 0" in="noise" result="coloredNoise" />
              <feComposite operator="in" in2="SourceGraphic" />
              <feBlend mode="multiply" in="SourceGraphic" />
            </filter>

            <!-- Limestone Gradients -->
            <linearGradient id="stone-bevel-light" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#ffffff" />
              <stop offset="25%" stop-color="#f5efe6" />
              <stop offset="60%" stop-color="#ded5c4" />
              <stop offset="100%" stop-color="#b8ad9c" />
            </linearGradient>

            <linearGradient id="stone-bevel-dark" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#b3a594" />
              <stop offset="50%" stop-color="#7d7060" />
              <stop offset="100%" stop-color="#4a4237" />
            </linearGradient>

            <linearGradient id="stone-face" x1="30%" y1="20%" x2="70%" y2="80%">
              <stop offset="0%" stop-color="#fdfbf7" />
              <stop offset="40%" stop-color="#eae2d3" />
              <stop offset="85%" stop-color="#cfc4b2" />
              <stop offset="100%" stop-color="#b0a390" />
            </linearGradient>

            <linearGradient id="inner-gold-glow" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#00d4ff" />
              <stop offset="100%" stop-color="#0284c7" />
            </linearGradient>
          </defs>

          <!-- Outer Architectural Bevel of the Limestone C -->
          <path d="M 370 120 
                   C 330 70, 240 60, 180 95 
                   C 100 145, 80 250, 95 330 
                   C 115 420, 220 460, 310 445 
                   C 355 435, 385 410, 400 375
                   L 345 345
                   C 335 365, 315 385, 280 390
                   C 215 400, 155 365, 145 295
                   C 135 225, 160 145, 235 125
                   C 285 110, 325 130, 345 155
                   Z" 
                fill="url(#stone-bevel-dark)" />

          <!-- Main Chiseled Limestone Body of C -->
          <path d="M 365 125 
                   C 328 75, 242 66, 185 98 
                   C 107 146, 88 248, 102 326 
                   C 121 414, 223 452, 308 438 
                   C 350 428, 378 404, 392 372
                   L 340 342
                   C 331 361, 312 379, 280 384
                   C 218 393, 161 360, 151 292
                   C 142 225, 165 149, 236 130
                   C 284 116, 322 134, 341 158
                   Z" 
                fill="url(#stone-face)" 
                stroke="url(#stone-bevel-light)" 
                stroke-width="3"
                filter="url(#limestone-grain)" />

          <!-- Chiseled Edge Highlights -->
          <path d="M 365 125 C 328 75, 242 66, 185 98 C 107 146, 88 248, 102 326" 
                stroke="#ffffff" stroke-width="2.5" fill="none" opacity="0.8" />
          <path d="M 340 342 C 331 361, 312 379, 280 384 C 218 393, 161 360, 151 292" 
                stroke="#ffffff" stroke-width="1.8" fill="none" opacity="0.6" />

          <!-- Name Engraved INSIDE the C -->
          <!-- 1. "CAPSTONE" Sculpted Core -->
          <g transform="translate(230, 246)">
            <text x="0" y="0" 
                  font-family="'Georgia', 'Times New Roman', serif" 
                  font-size="34" 
                  font-weight="900" 
                  letter-spacing="5" 
                  text-anchor="middle" 
                  fill="#1e293b" 
                  opacity="0.3" 
                  transform="translate(1, 2)">CAPSTONE</text>
            <text x="0" y="0" 
                  font-family="'Georgia', 'Times New Roman', serif" 
                  font-size="34" 
                  font-weight="900" 
                  letter-spacing="5" 
                  text-anchor="middle" 
                  fill="url(#stone-face)"
                  stroke="#ffffff"
                  stroke-width="0.8">CAPSTONE</text>
          </g>

          <!-- 2. "FOUNDRY" Engraved Sub-Core -->
          <g transform="translate(230, 276)">
            <text x="0" y="0" 
                  font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" 
                  font-size="14" 
                  font-weight="800" 
                  letter-spacing="9" 
                  text-anchor="middle" 
                  fill="#00d4ff" 
                  filter="drop-shadow(0 0 6px rgba(0,212,255,0.7))">FOUNDRY</text>
          </g>

          <!-- Subtle Cyan Chisel Inscription Accents -->
          <line x1="160" y1="216" x2="300" y2="216" stroke="rgba(0, 212, 255, 0.4)" stroke-width="1.5" stroke-dasharray="4 4" />
          <line x1="160" y1="298" x2="300" y2="298" stroke="rgba(0, 212, 255, 0.4)" stroke-width="1.5" stroke-dasharray="4 4" />
        </svg>
      </div>
    </body>
    </html>
  `;

  await page.setContent(html);

  // 1. Google Play 512x512 Icon
  const playIcon = path.join(PLAY_DIR, 'app-icon-512x512.png');
  await page.screenshot({ path: playIcon, type: 'png' });
  console.log('✓ Saved Limestone Play Icon:', playIcon);

  // 2. Public / Web Favicon & App Icon
  const publicIcon = path.join(PUBLIC_DIR, 'icon-512.png');
  await page.screenshot({ path: publicIcon, type: 'png' });
  console.log('✓ Saved Public Web Icon:', publicIcon);

  // 3. Android Mipmap Icons
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
      const launcherPath = path.join(fullDir, 'ic_launcher.png');
      const roundPath = path.join(fullDir, 'ic_launcher_round.png');
      fs.copyFileSync(publicIcon, launcherPath);
      if (fs.existsSync(roundPath)) fs.copyFileSync(publicIcon, roundPath);
      console.log('✓ Updated Android launcher in:', mDir);
    }
  }

  await browser.close();
  console.log('🎉 Limestone C icon generated and synchronized everywhere!');
}

generateLimestoneIcon().catch(err => {
  console.error('Error generating limestone icon:', err);
  process.exit(1);
});
