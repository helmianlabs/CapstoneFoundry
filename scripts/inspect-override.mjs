import fs from 'fs';

const conv = JSON.parse(fs.readFileSync('E:/CapstoneFoundry/conv_4401_full.json', 'utf8'));
const override = conv.conversation_initiation_client_data?.conversation_config_override;
console.log('OVERRIDE KEYS:', Object.keys(override || {}));
console.log('OVERRIDE AGENT KEYS:', Object.keys(override?.agent || {}));
console.log('OVERRIDE PROMPT:');
console.log(override?.agent?.prompt?.prompt);
