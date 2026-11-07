import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sourceImage = 'C:/Users/troyh/.gemini/antigravity/brain/dd25d172-95ce-4c89-b9bd-82be4bd0fd86/.user_uploaded/media_1794092384225_8fd2e598.jpg';

async function generateAllIcons() {
  const imgBuffer = fs.readFileSync(sourceImage);
  const base64Data = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  async function exportIcon(targetSize, destPath, options = {}) {
    await page.setViewport({ width: targetSize, height: targetSize, deviceScaleFactor: 1 });
    const borderRadius = options.rounded ? '50%' : '0';
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body, html { width: ${targetSize}px; height: ${targetSize}px; overflow: hidden; background: #0b0f19; }
          .icon-wrap { width: 100%; height: 100%; border-radius: ${borderRadius}; overflow: hidden; }
          img { width: 100%; height: 100%; object-fit: cover; display: block; }
        </style>
      </head>
      <body>
        <div class="icon-wrap">
          <img src="${base64Data}" />
        </div>
      </body>
      </html>
    `, { waitUntil: 'networkidle0' });

    // Wait to ensure image is rendered
    await page.waitForSelector('img');

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    await page.screenshot({ path: destPath, omitBackground: false });
    const stat = fs.statSync(destPath);
    console.log(`Generated: ${destPath} (${targetSize}x${targetSize}, ${stat.size} bytes)`);
  }

  // 1. Master Brand Asset
  await exportIcon(1024, 'E:/CapstoneFoundry/public/brand/capstone-limestone-master.png');
  await exportIcon(1024, 'E:/CapstoneFoundry/docs/store/ios-bundle/AppIcon-1024.png');
  await exportIcon(1024, 'E:/CapstoneFoundry/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');

  // 2. Google Play Store 512x512
  await exportIcon(512, 'E:/CapstoneFoundry/docs/store/google-play-bundle/app-icon-512x512.png');
  await exportIcon(512, 'C:/Users/troyh/.gemini/antigravity/brain/dd25d172-95ce-4c89-b9bd-82be4bd0fd86/limestone-c-icon.png');

  // 3. Web PWA Icons & Favicon
  await exportIcon(512, 'E:/CapstoneFoundry/public/icon-512.png');
  await exportIcon(512, 'E:/CapstoneFoundry/dist/icon-512.png');
  await exportIcon(192, 'E:/CapstoneFoundry/public/icon-192.png');
  await exportIcon(192, 'E:/CapstoneFoundry/dist/icon-192.png');
  await exportIcon(180, 'E:/CapstoneFoundry/public/apple-touch-icon.png');
  await exportIcon(180, 'E:/CapstoneFoundry/dist/apple-touch-icon.png');
  await exportIcon(48, 'E:/CapstoneFoundry/public/favicon.png');
  await exportIcon(48, 'E:/CapstoneFoundry/dist/favicon.png');

  // 4. Android Launcher Mipmaps (both legacy and adaptive foregrounds)
  const mipmaps = [
    { dir: 'mipmap-mdpi', size: 48, fgSize: 108 },
    { dir: 'mipmap-hdpi', size: 72, fgSize: 162 },
    { dir: 'mipmap-xhdpi', size: 96, fgSize: 216 },
    { dir: 'mipmap-xxhdpi', size: 144, fgSize: 324 },
    { dir: 'mipmap-xxxhdpi', size: 192, fgSize: 432 }
  ];

  for (const m of mipmaps) {
    const squarePath = `E:/CapstoneFoundry/android/app/src/main/res/${m.dir}/ic_launcher.png`;
    const roundPath = `E:/CapstoneFoundry/android/app/src/main/res/${m.dir}/ic_launcher_round.png`;
    const fgPath = `E:/CapstoneFoundry/android/app/src/main/res/${m.dir}/ic_launcher_foreground.png`;
    await exportIcon(m.size, squarePath);
    await exportIcon(m.size, roundPath, { rounded: true });
    await exportIcon(m.fgSize, fgPath);
  }

  await browser.close();
  console.log('ALL ICONS PROPERLY GENERATED FROM REAL LIMESTONE ARTWORK!');
}

generateAllIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
