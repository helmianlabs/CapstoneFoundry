import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sourceImage = 'C:/Users/troyh/.gemini/antigravity/brain/dd25d172-95ce-4c89-b9bd-82be4bd0fd86/.user_uploaded/media_1794092384225_8fd2e598.jpg';

async function generateIcons() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const fileUrl = 'file:///' + sourceImage.replace(/\\/g, '/');

  // Helper to render and capture at exact size
  async function exportIcon(targetSize, destPath) {
    await page.setViewport({ width: targetSize, height: targetSize, deviceScaleFactor: 1 });
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body, html { width: ${targetSize}px; height: ${targetSize}px; overflow: hidden; background: transparent; }
          img { width: 100%; height: 100%; object-fit: cover; display: block; }
        </style>
      </head>
      <body>
        <img src="${fileUrl}" />
      </body>
      </html>
    `, { waitUntil: 'load' });

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    await page.screenshot({ path: destPath, omitBackground: false });
    console.log(`Generated: ${destPath} (${targetSize}x${targetSize})`);
  }

  // 1. Master Brand Asset
  await exportIcon(1024, 'E:/CapstoneFoundry/public/brand/capstone-limestone-master.png');
  await exportIcon(1024, 'E:/CapstoneFoundry/docs/store/ios-bundle/AppIcon-1024.png');

  // 2. Google Play Store 512x512
  await exportIcon(512, 'E:/CapstoneFoundry/docs/store/google-play-bundle/app-icon-512x512.png');
  await exportIcon(512, 'C:/Users/troyh/.gemini/antigravity/brain/dd25d172-95ce-4c89-b9bd-82be4bd0fd86/limestone-c-icon.png');

  // 3. Web PWA Icons
  await exportIcon(512, 'E:/CapstoneFoundry/public/icon-512.png');
  await exportIcon(512, 'E:/CapstoneFoundry/dist/icon-512.png');
  await exportIcon(192, 'E:/CapstoneFoundry/public/icon-192.png');
  await exportIcon(192, 'E:/CapstoneFoundry/dist/icon-192.png');

  // 4. Android Launcher Mipmaps
  const mipmaps = [
    { dir: 'mipmap-mdpi', size: 48 },
    { dir: 'mipmap-hdpi', size: 72 },
    { dir: 'mipmap-xhdpi', size: 96 },
    { dir: 'mipmap-xxhdpi', size: 144 },
    { dir: 'mipmap-xxxhdpi', size: 192 }
  ];

  for (const m of mipmaps) {
    const squarePath = `E:/CapstoneFoundry/android/app/src/main/res/${m.dir}/ic_launcher.png`;
    const roundPath = `E:/CapstoneFoundry/android/app/src/main/res/${m.dir}/ic_launcher_round.png`;
    await exportIcon(m.size, squarePath);
    await exportIcon(m.size, roundPath);
  }

  await browser.close();
  console.log('Successfully synchronized official limestone C icon across all store, web, and android targets!');
}

generateIcons().catch(console.error);
