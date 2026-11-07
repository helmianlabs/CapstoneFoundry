import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'https://capstonefoundry.cloud';

const VIEWPORTS = [
  // Apple App Store Viewports
  {
    name: 'iphone_6_5',
    platform: 'ios',
    width: 1284,
    height: 2778,
    scaleFactor: 1,
    desc: '6.5-inch Super Retina (iPhone 11-16 Pro Max)'
  },
  {
    name: 'iphone_5_5',
    platform: 'ios',
    width: 1242,
    height: 2208,
    scaleFactor: 1,
    desc: '5.5-inch Retina (iPhone 8 Plus)'
  },
  {
    name: 'ipad_12_9',
    platform: 'ios',
    width: 2048,
    height: 2732,
    scaleFactor: 1,
    desc: '12.9-inch iPad Pro'
  },
  // Google Play Store Viewports
  {
    name: 'android_phone',
    platform: 'android',
    width: 1080,
    height: 2400,
    scaleFactor: 1,
    desc: 'Flagship Phone (Galaxy S24 / Pixel)'
  },
  {
    name: 'android_tablet_10',
    platform: 'android',
    width: 1600,
    height: 2560,
    scaleFactor: 1,
    desc: '10-inch Tablet (Galaxy Tab)'
  }
];

async function capture() {
  console.log('🚀 Starting Capstone Foundry Store Screenshot Capture...');
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--hide-scrollbars',
      '--enable-features=NetworkService,NetworkServiceInProcess'
    ]
  });

  const iosDir = path.resolve('docs/store/screenshots/ios');
  const androidDir = path.resolve('docs/store/screenshots/android');
  fs.mkdirSync(iosDir, { recursive: true });
  fs.mkdirSync(androidDir, { recursive: true });

  for (const vp of VIEWPORTS) {
    console.log(`\n📸 Capturing ${vp.desc} (${vp.width}x${vp.height})...`);
    const page = await browser.newPage();
    
    await page.setViewport({
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.scaleFactor,
      isMobile: vp.platform === 'ios' || vp.name === 'android_phone',
      hasTouch: true
    });

    const targetDir = vp.platform === 'ios' ? iosDir : androidDir;

    // Shot 1: The Voice App & Digital Avatar
    try {
      await page.goto(`${BASE_URL}/app`, { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000)); // wait for avatar canvas to draw
      
      const file1 = path.join(targetDir, `${vp.name}_01_voice_avatar.png`);
      await page.screenshot({ path: file1, type: 'png' });
      console.log(`  ✓ Saved: ${path.basename(file1)}`);
    } catch (e) {
      console.error(`  ✗ Error capturing app view for ${vp.name}:`, e.message);
    }

    // Shot 2: Landing Page & Architectural Foundation
    try {
      await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise(r => setTimeout(r, 1500));
      
      const file2 = path.join(targetDir, `${vp.name}_02_executive_landing.png`);
      await page.screenshot({ path: file2, type: 'png' });
      console.log(`  ✓ Saved: ${path.basename(file2)}`);
    } catch (e) {
      console.error(`  ✗ Error capturing landing view for ${vp.name}:`, e.message);
    }

    await page.close();
  }

  await browser.close();
  console.log('\n🎉 All store screenshot assets captured successfully!');
}

capture().catch(err => {
  console.error('Fatal screenshot capture error:', err);
  process.exit(1);
});
