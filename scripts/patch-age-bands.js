import fs from 'fs';

let code = fs.readFileSync('public/onboarding.js', 'utf8').replace(/\r\n/g, '\n');

const targetBands = `const AGE_BAND_OPTIONS = [
  { value: 'child', label: 'Under 6' },
  { value: '6-8', label: '6–8' },
  { value: '9-12', label: '9–12' },
  { value: '13-17', label: '13–17' },
  { value: 'adult', label: 'Adult' },
];
// Bands where safety mode defaults ON in onboarding (mirrors the
// kid-core semantics server-side: child / 6-8 / 9-12 are minors).
const MINOR_BANDS = ['child', '6-8', '9-12'];`;

const newBands = `// Historical labels preserved for existing profiles and backwards compatibility
const ALL_BAND_LABELS = [
  { value: 'child', label: 'Under 6' },
  { value: '6-8', label: '6–8' },
  { value: '9-12', label: '9–12' },
  { value: '13-17', label: '13–17' },
  { value: 'adult', label: 'Adult' },
];

// Capstone Foundry operates for 13+ only. Onboarding dropdown offers 13-17 and Adult only.
const AGE_BAND_OPTIONS = [
  { value: '13-17', label: '13–17' },
  { value: 'adult', label: 'Adult' },
];
// Under 13 is completely removed. Safety defaults off for adults.
const MINOR_BANDS = [];`;

if (!code.includes(targetBands)) {
  throw new Error('targetBands not found in onboarding.js');
}
code = code.replace(targetBands, newBands);

const targetBandLabel = "const found = AGE_BAND_OPTIONS.find((o) => o.value === value);";
const newBandLabel = "const found = AGE_BAND_OPTIONS.find((o) => o.value === value) || ALL_BAND_LABELS.find((o) => o.value === value);";

if (!code.includes(targetBandLabel)) {
  throw new Error('targetBandLabel not found in onboarding.js');
}
code = code.replace(targetBandLabel, newBandLabel);

fs.writeFileSync('public/onboarding.js', code, 'utf8');
console.log('SUCCESSFULLY FILTERED AGE BANDS TO 13+ ONLY');
