import puppeteer from 'puppeteer-core';
import path from 'path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  const url = 'file:///' + path.resolve('E:/CapstoneFoundry/dist/index.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle0' });

  // Wait 1 sec for canvas constellation to start drawing
  await new Promise(r => setTimeout(r, 1000));

  const handsEl = await page.$('#hands');
  if (handsEl) {
    await handsEl.screenshot({ path: 'C:/Users/troyh/.gemini/antigravity/brain/dd25d172-95ce-4c89-b9bd-82be4bd0fd86/hands-section-preview.png' });
    console.log('Saved hands-section-preview.png');
  }

  const pricingEl = await page.$('#pricing');
  if (pricingEl) {
    await pricingEl.screenshot({ path: 'C:/Users/troyh/.gemini/antigravity/brain/dd25d172-95ce-4c89-b9bd-82be4bd0fd86/pricing-section-preview.png' });
    console.log('Saved pricing-section-preview.png');
  }

  // Full viewport screenshot
  await page.screenshot({ path: 'C:/Users/troyh/.gemini/antigravity/brain/dd25d172-95ce-4c89-b9bd-82be4bd0fd86/full-page-preview.png', fullPage: false });
  console.log('Saved full-page-preview.png');

  await browser.close();
}
capture().catch(console.error);
