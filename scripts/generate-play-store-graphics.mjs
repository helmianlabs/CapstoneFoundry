import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.resolve('docs/store/google-play-bundle');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function generateGraphics() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // 1. High-Res App Icon (512x512 PNG)
  const iconHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { margin: 0; padding: 0; background: #050508; width: 512px; height: 512px; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
        .icon-box { width: 512px; height: 512px; position: relative; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at center, #0f2b38 0%, #050508 75%); }
        .ring { position: absolute; border-radius: 50%; border: 2px solid rgba(0, 212, 255, 0.4); box-shadow: 0 0 35px rgba(0, 212, 255, 0.3); }
        .ring-1 { width: 380px; height: 380px; }
        .ring-2 { width: 440px; height: 440px; border-style: dashed; border-color: rgba(0, 212, 255, 0.2); }
        .logo-text { font-size: 130px; font-weight: 900; letter-spacing: -4px; color: #ffffff; text-shadow: 0 0 30px rgba(0, 212, 255, 0.8); z-index: 2; }
        .logo-text span { color: #00d4ff; }
        .badge { position: absolute; bottom: 50px; font-size: 20px; font-weight: 700; letter-spacing: 6px; text-transform: uppercase; color: #94a3b8; }
      </style>
    </head>
    <body>
      <div class="icon-box">
        <div class="ring ring-2"></div>
        <div class="ring ring-1"></div>
        <div class="logo-text">C<span>F</span></div>
        <div class="badge">FOUNDRY</div>
      </div>
    </body>
    </html>
  `;

  const page = await browser.newPage();
  await page.setViewport({ width: 512, height: 512 });
  await page.setContent(iconHtml);
  const iconPath = path.join(OUT_DIR, 'app-icon-512x512.png');
  await page.screenshot({ path: iconPath, type: 'png' });
  console.log('✓ Generated:', iconPath);

  // 2. Feature Graphic (1024x500 PNG)
  const avatarBase64 = fs.readFileSync('public/mark-avatar.jpg').toString('base64');
  const featureHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { margin: 0; padding: 0; background: #050508; width: 1024px; height: 500px; display: flex; align-items: center; justify-content: space-between; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; box-sizing: border-box; padding: 0 60px; }
        .bg-glow { position: absolute; top: -100px; right: -100px; width: 600px; height: 600px; background: radial-gradient(circle, rgba(0, 212, 255, 0.15) 0%, transparent 70%); pointer-events: none; }
        .content { z-index: 2; max-width: 580px; }
        .pill { display: inline-flex; align-items: center; gap: 8px; background: rgba(0, 212, 255, 0.1); border: 1px solid rgba(0, 212, 255, 0.4); padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; color: #00d4ff; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px; }
        h1 { font-size: 46px; font-weight: 900; line-height: 1.1; color: #ffffff; margin: 0 0 16px 0; letter-spacing: -1px; }
        h1 span { color: #00d4ff; text-shadow: 0 0 25px rgba(0, 212, 255, 0.5); }
        p { font-size: 18px; color: #94a3b8; line-height: 1.4; margin: 0 0 24px 0; }
        .tags { display: flex; gap: 12px; }
        .tag { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); padding: 6px 12px; border-radius: 6px; font-size: 13px; color: #cbd5e1; font-weight: 600; }
        .avatar-wrap { position: relative; z-index: 2; width: 260px; height: 260px; border-radius: 50%; padding: 8px; background: linear-gradient(135deg, #00d4ff 0%, #0369a1 100%); box-shadow: 0 0 50px rgba(0, 212, 255, 0.35); }
        .avatar-img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .live-dot { position: absolute; bottom: 20px; right: 20px; width: 22px; height: 22px; background: #10b981; border: 4px solid #050508; border-radius: 50%; box-shadow: 0 0 12px #10b981; }
      </style>
    </head>
    <body>
      <div class="bg-glow"></div>
      <div class="content">
        <div class="pill">Autonomous Executive AI</div>
        <h1>Capstone <span>Foundry</span></h1>
        <p>Conversational voice pair programming with persistent memory and Helmion Hands desktop execution.</p>
        <div class="tags">
          <div class="tag">⚡ Sub-300ms Voice</div>
          <div class="tag">🧠 PostgreSQL Memory</div>
          <div class="tag">🛡️ Helmian Guard</div>
        </div>
      </div>
      <div class="avatar-wrap">
        <img class="avatar-img" src="data:image/jpeg;base64,${avatarBase64}" />
        <div class="live-dot"></div>
      </div>
    </body>
    </html>
  `;

  await page.setViewport({ width: 1024, height: 500 });
  await page.setContent(featureHtml);
  const featurePath = path.join(OUT_DIR, 'feature-graphic-1024x500.png');
  await page.screenshot({ path: featurePath, type: 'png' });
  console.log('✓ Generated:', featurePath);

  await browser.close();
  console.log('🎉 Store graphics ready for Google Play upload!');
}

generateGraphics().catch(e => console.error(e));
