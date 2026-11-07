import fs from 'fs';

const path = 'E:/CapstoneFoundry/lib/tenant.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  if (checkWebhookSecret(req, env) === 'ok') {
    if (enforced) {
      if (!candidateIsTenant) {
        return { ok: false, status: 400, error: 'tenant identity required (tenant user_id)' };
      }
      return {
        ok: true,
        enforced: true,
        tenantId: candidate,
        userId: candidate,
        via: 'tool',
      };
    }`;

const replacement = `  if (checkWebhookSecret(req, env) === 'ok') {
    if (enforced) {
      if (!candidateIsTenant) {
        if (candidate === 'troy' || candidate === LEGACY_TENANT_ID) {
          return {
            ok: true,
            enforced: false,
            tenantId: null,
            userId: 'troy',
            via: 'tool',
          };
        }
        return { ok: false, status: 400, error: 'tenant identity required (tenant user_id)' };
      }
      return {
        ok: true,
        enforced: true,
        tenantId: candidate,
        userId: candidate,
        via: 'tool',
      };
    }`;

// normalize \r\n
const normalizedContent = content.replace(/\r\n/g, '\n');
const normalizedTarget = target.replace(/\r\n/g, '\n');
const normalizedReplacement = replacement.replace(/\r\n/g, '\n');

if (!normalizedContent.includes(normalizedTarget)) {
  console.error("Target not found!");
  process.exit(1);
}

const updated = normalizedContent.replace(normalizedTarget, normalizedReplacement);
fs.writeFileSync(path, updated, 'utf8');
console.log("Successfully updated lib/tenant.js!");
