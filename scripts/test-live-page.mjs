import https from 'https';

https.get('https://www.capstonefoundry.cloud/landing.html', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Contains founderAudio:', data.includes('founderAudio'));
    console.log('Contains playStudioDialogue:', data.includes('playStudioDialogue'));
    const matches = data.match(/\/audio\/demo\/[a-zA-Z0-9_\.]+/g);
    console.log('Audio matches in live page:', matches);
  });
});
