// server/handlers/avatar.js — Digital Avatar Creation & Likeness Release Governance
// Compliant with California AB 2602 / AB 1836, NO FAKES Act, and App Store Guideline 5.1
import { resolveTenant, LEGACY_TENANT_ID, isTenantId } from '../../lib/tenant.js';

let sharedPool = null;
async function getDb() {
  if (!sharedPool) {
    const { default: pg } = await import('pg');
    const cs = process.env.DATABASE_URL_MEMORY || process.env.DATABASE_URL;
    sharedPool = new pg.Pool({ connectionString: cs, max: 4 });
  }
  return sharedPool;
}

export default async function handleAvatar(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-Id');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Resolve tenant gracefully:
  // 1. Session token (tb_token)
  // 2. Body / Header candidate tenantId (tb_tenant)
  // 3. Fallback to LEGACY_TENANT_ID (never fail with 401 Unauthorized)
  const resolved = resolveTenant(req);
  let tenantId = resolved?.tenantId || null;

  if (!tenantId || tenantId === LEGACY_TENANT_ID) {
    const candidate = req.body?.tenantId || req.headers?.['x-tenant-id'];
    if (isTenantId(candidate)) {
      tenantId = candidate;
    } else {
      tenantId = LEGACY_TENANT_ID;
    }
  }

  const pathname = new URL(req.url, 'http://local').pathname;
  const pool = await getDb();

  try {
    // 1. GET /api/avatar — List all avatars for tenant
    if (req.method === 'GET') {
      const result = await pool.query(
        `SELECT a.id, a.name, a.photo_url, a.voice_id, a.is_active, a.created_at,
                c.consent_type, c.statutory_basis, c.signed_at, c.revoked_at
         FROM avatar_profiles a
         LEFT JOIN avatar_consents c ON c.avatar_id = a.id
         WHERE a.tenant_id = $1 AND (c.revoked_at IS NULL)
         ORDER BY a.created_at DESC`,
        [tenantId]
      );
      return res.status(200).json({ ok: true, avatars: result.rows, tenantId });
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      // 3. POST /api/avatar with action: 'activate'
      if (pathname.endsWith('/activate') || body.action === 'activate') {
        const { avatar_id } = body;
        if (!avatar_id) return res.status(400).json({ error: 'avatar_id required' });

        await pool.query(`UPDATE avatar_profiles SET is_active = false WHERE tenant_id = $1`, [tenantId]);
        const updateRes = await pool.query(
          `UPDATE avatar_profiles SET is_active = true WHERE tenant_id = $1 AND id = $2 RETURNING *`,
          [tenantId, avatar_id]
        );

        return res.status(200).json({ ok: true, activeAvatar: updateRes.rows[0] || null });
      }

      // 4. POST /api/avatar with action: 'revoke'
      if (pathname.endsWith('/revoke') || body.action === 'revoke') {
        const { avatar_id } = body;
        if (!avatar_id) return res.status(400).json({ error: 'avatar_id required' });

        await pool.query(
          `UPDATE avatar_consents SET revoked_at = NOW() WHERE tenant_id = $1 AND avatar_id = $2`,
          [tenantId, avatar_id]
        );
        await pool.query(
          `DELETE FROM avatar_profiles WHERE tenant_id = $1 AND id = $2`,
          [tenantId, avatar_id]
        );

        return res.status(200).json({ ok: true, revoked: true });
      }

      // 2. Default POST: Create avatar + log legal consent
      const { name, photo_url, voice_id, consent_type = 'self', statement } = body;
      if (!name || !photo_url) {
        return res.status(400).json({ error: 'Name and photo_url are required' });
      }
      if (!statement || typeof statement !== 'string') {
        return res.status(400).json({ error: 'Legal likeness consent statement is mandatory under CA AB 2602 / NO FAKES Act' });
      }

      const ip = (req.headers && req.headers['x-forwarded-for'])?.split(',')[0]?.trim() || req.socket?.remoteAddress || '127.0.0.1';
      const ua = req.headers?.['user-agent'] || 'Unknown';

      // Insert avatar profile
      const avatarRes = await pool.query(
        `INSERT INTO avatar_profiles (tenant_id, name, photo_url, voice_id, is_active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id, name, photo_url, voice_id, is_active, created_at`,
        [tenantId, name.trim(), photo_url.trim(), voice_id ? voice_id.trim() : null]
      );
      const avatar = avatarRes.rows[0];

      // Deactivate older avatars if this one is active
      await pool.query(
        `UPDATE avatar_profiles SET is_active = false WHERE tenant_id = $1 AND id != $2`,
        [tenantId, avatar.id]
      );

      // Record statutory consent
      const consentRes = await pool.query(
        `INSERT INTO avatar_consents (tenant_id, avatar_id, subject_name, consent_type, statutory_basis, statement, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, 'CA_AB_2602_AB_1836', $5, $6, $7)
         RETURNING id, signed_at`,
        [tenantId, avatar.id, name.trim(), consent_type, statement.trim(), ip, ua]
      );

      return res.status(201).json({
        ok: true,
        avatar,
        consent: consentRes.rows[0],
        tenantId,
      });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('[avatar] Error:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
}
