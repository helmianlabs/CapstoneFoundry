import puppeteer from 'puppeteer-core';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function smokeTest() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const response = await page.goto('https://www.capstonefoundry.cloud', { waitUntil: 'networkidle0' });
  console.log('HTTP Status:', response.status());

  const title = await page.title();
  console.log('Title:', title);

  const handsHeading = await page.$eval('#hands h2', el => el.innerText);
  console.log('Hands Heading:', handsHeading);

  const tagline = await page.$eval('.hands-main-tagline', el => el.innerText);
  console.log('Tagline:', tagline);

  const audioF = await page.$eval('#audioF_hands', el => el.src);
  console.log('Hands Founder Audio:', audioF);

  const audioM = await page.$eval('#audioM_hands', el => el.src);
  console.log('Hands Mark Audio:', audioM);

  await page.screenshot({ path: 'C:/Users/troyh/.gemini/antigravity/brain/dd25d172-95ce-4c89-b9bd-82be4bd0fd86/live-production-smoke-test.png', fullPage: false });
  console.log('Saved live-production-smoke-test.png');

  await browser.close();
}
smokeTest().catch(console.error);
