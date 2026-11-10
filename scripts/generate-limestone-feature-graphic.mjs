import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.resolve('docs/store/google-play-bundle');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function generateLimestoneBanner() {
  const logoBase64 = fs.readFileSync('public/brand/capstone-limestone-master.png').toString('base64');

  const bannerHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          width: 1024px;
          height: 500px;
          background: #06090e;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 55px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          overflow: hidden;
          position: relative;
        }
        .bg-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(0, 212, 255, 0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0, 212, 255, 0.04) 1px, transparent 1px);
          background-size: 32px 32px;
          pointer-events: none;
        }
        .glow-cyan {
          position: absolute;
          top: -80px;
          right: 320px;
          width: 450px;
          height: 450px;
          background: radial-gradient(circle, rgba(0, 212, 255, 0.12) 0%, transparent 70%);
          pointer-events: none;
        }
        .glow-limestone {
          position: absolute;
          bottom: -100px;
          left: 60px;
          width: 480px;
          height: 480px;
          background: radial-gradient(circle, rgba(230, 225, 215, 0.08) 0%, transparent 70%);
          pointer-events: none;
        }
        .left-content {
          z-index: 2;
          max-width: 540px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(0, 212, 255, 0.08);
          border: 1px solid rgba(0, 212, 255, 0.35);
          padding: 6px 14px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #00d4ff;
          width: fit-content;
        }
        .title {
          font-family: Georgia, "Times New Roman", serif;
          font-size: 46px;
          font-weight: 700;
          letter-spacing: 1.5px;
          color: #f1f5f9;
          line-height: 1.1;
        }
        .title span {
          color: #00d4ff;
          text-shadow: 0 0 20px rgba(0, 212, 255, 0.4);
        }
        .tagline {
          font-size: 22px;
          font-weight: 500;
          color: #e2e8f0;
          line-height: 1.35;
          letter-spacing: 0.2px;
        }
        .subtext {
          font-size: 15px;
          color: #94a3b8;
          line-height: 1.45;
        }
        .pills {
          display: flex;
          gap: 10px;
          margin-top: 6px;
        }
        .pill {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          color: #cbd5e1;
        }
        .right-logo {
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .logo-frame {
          width: 320px;
          height: 320px;
          border-radius: 28px;
          overflow: hidden;
          background: #090e17;
          border: 2px solid rgba(230, 225, 215, 0.25);
          box-shadow:
            0 0 45px rgba(0, 212, 255, 0.2),
            0 20px 40px rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .logo-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      </style>
    </head>
    <body>
      <div class="bg-grid"></div>
      <div class="glow-cyan"></div>
      <div class="glow-limestone"></div>

      <div class="left-content">
        <div class="badge">Autonomous Executive AI</div>
        <div class="title">CAPSTONE <span>FOUNDRY</span></div>
        <div class="tagline">What will you discover next?</div>
        <div class="subtext">From your wild thoughts, to the real world. Sub-second voice pair programming with persistent memory and Helmion Hands desktop execution.</div>
        <div class="pills">
          <div class="pill">⚡ Sub-Second Voice</div>
          <div class="pill">🧠 Dedicated Memory</div>
          <div class="pill">🛠 Hands Execution</div>
        </div>
      </div>

      <div class="right-logo">
        <div class="logo-frame">
          <img class="logo-img" src="data:image/png;base64,${logoBase64}" alt="Capstone Limestone Logo" />
        </div>
      </div>
    </body>
    </html>
  `;

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 500, deviceScaleFactor: 1 });
  await page.setContent(bannerHtml);
  
  const rawPath = path.join(OUT_DIR, 'feature-graphic-raw.png');
  await page.screenshot({ path: rawPath, type: 'png' });
  await browser.close();

  // Convert with ffmpeg to guarantee exact rgb24 (no alpha channel) and optimum compression
  const finalPath = path.join(OUT_DIR, 'feature-graphic-1024x500.png');
  execSync(`ffmpeg -y -v error -i "${rawPath}" -pix_fmt rgb24 "${finalPath}"`);
  if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);

  const stat = fs.statSync(finalPath);
  console.log(`✓ Generated 1024x500 Feature Graphic: ${finalPath} (${stat.size} bytes)`);

  const probe = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt -of json "${finalPath}"`).toString();
  console.log('ffprobe stream info:', probe.trim());
}

generateLimestoneBanner().catch(console.error);
