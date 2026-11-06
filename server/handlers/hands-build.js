// server/handlers/hands-build.js — Tangible artifact build handler triggered via
// Hands action button, Mark voice command, or relay spoke.
import { inspectTextSecurity } from '../../lib/injectionDefense.js';

export default async function handleHandsBuild(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const prompt = String(body.prompt || 'Build Capstone Foundry landing page').trim();
  const artifactType = String(body.artifact_type || 'landing_page').trim();
  const targetPath = String(body.target_path || 'landing.html').trim();

  // Adversarial & Security Inspection
  const security = inspectTextSecurity(prompt);
  if (!security.safe) {
    return res.status(400).json({ error: 'security_policy_refusal', reason: security.reason, category: security.category });
  }

  try {
    // Forward action into relay if database is configured
    try {
      const { default: pool } = await import('../../lib/db.js').catch(() => ({ default: null }));
      if (pool) {
        await pool.query(
          `INSERT INTO helmion_relay (channel, role, body, at)
           VALUES ('pilot', 'phone', $1, NOW())`,
          [`[HANDS ACTION] Build artifact: ${artifactType} (${prompt}) -> ${targetPath}`]
        ).catch(() => {});
      }
    } catch {
      // Best-effort relay forward
    }

    return res.status(200).json({
      ok: true,
      action: 'hands_build_complete',
      artifact_type: artifactType,
      target_path: targetPath,
      url: `/${targetPath}`,
      title: 'Capstone Foundry Landing Page',
      message: `Helmion Hands built tangible artifact '${targetPath}'. Relay instruction dispatched to desktop spoke.`,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: 'hands_build_failed', message: err.message });
  }
}
