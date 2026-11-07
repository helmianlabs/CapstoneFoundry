import puppeteer from 'puppeteer-core';
import path from 'path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function captureComplete() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  const url = 'file:///' + path.resolve('E:/CapstoneFoundry/dist/index.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle0' });

  await page.evaluate(() => window.runHandsDemo());
  await new Promise(r => setTimeout(r, 8500));

  const handsEl = await page.$('#hands');
  if (handsEl) {
    await handsEl.screenshot({ path: 'C:/Users/troyh/.gemini/antigravity/brain/dd25d172-95ce-4c89-b9bd-82be4bd0fd86/hands-complete-stream.png' });
    console.log('Saved hands-complete-stream.png');
  }
  await browser.close();
}
captureComplete().catch(console.error);
