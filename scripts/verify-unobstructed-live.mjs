import puppeteer from 'puppeteer-core';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function verifyLive() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log('Navigating to https://www.capstonefoundry.cloud...');
  await page.goto('https://www.capstonefoundry.cloud', { waitUntil: 'networkidle2' });

  // 1. Check Navbar Logo
  const logoSrc = await page.$eval('.logo img', el => el.src).catch(() => null);
  console.log('Navbar logo src:', logoSrc);

  // 2. Check FAB and Companion state
  const fabExists = await page.$eval('#mark-fab-trigger', el => !!el).catch(() => false);
  const compActive = await page.$eval('#mark-companion', el => el.classList.contains('active')).catch(() => false);
  console.log('FAB exists:', fabExists, '| Companion active:', compActive);

  // 3. Scroll to Hands Workbench and take screenshot
  await page.evaluate(() => {
    document.getElementById('hands').scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await new Promise(r => setTimeout(r, 600));

  await page.screenshot({
    path: 'C:/Users/troyh/.gemini/antigravity/brain/dd25d172-95ce-4c89-b9bd-82be4bd0fd86/live-hands-unobstructed.png'
  });
  console.log('Saved: live-hands-unobstructed.png');

  // 4. Scroll to Pricing and take screenshot
  await page.evaluate(() => {
    document.getElementById('pricing').scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await new Promise(r => setTimeout(r, 600));

  await page.screenshot({
    path: 'C:/Users/troyh/.gemini/antigravity/brain/dd25d172-95ce-4c89-b9bd-82be4bd0fd86/live-pricing-unobstructed.png'
  });
  console.log('Saved: live-pricing-unobstructed.png');

  await browser.close();
  console.log('Smoke test completed successfully!');
}

verifyLive().catch(console.error);
