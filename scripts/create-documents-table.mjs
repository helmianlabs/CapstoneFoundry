import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memory_documents (
      id BIGSERIAL PRIMARY KEY,
      tenant_id UUID,
      user_id TEXT,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      content TEXT NOT NULL,
      blob_url TEXT,
      gdoc_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_memory_documents_tenant ON memory_documents(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_memory_documents_created ON memory_documents(created_at DESC);
  `);
  console.log('memory_documents table created successfully in Neon!');
} finally {
  await pool.end();
}
