// Final-sweep tests (bite 8) — one describe per checklist item that
// changed behavior:
//   #3 router function-config map covers every handler-declared config
//   #5 ENFORCE_TOOL_AUTH truthy parsing is shared (lib/security.js)
//   #6 research-log stores redacted metadata only, never raw content
//   #7 media endpoints + memory-admin require + scope to the tenant
//      session in enforced mode; compat behavior unchanged
//   #8 dead providers (Sora / Imagen) are unrouted and deleted
//   D1 dead provider references are gone from the docs/templates
//   D2 dead-reference leftovers outside D1's files are fixed too
//   B3 curriculum verification records exist and carry the four-AI-
//      merge provenance (and the stamp the correction addendum
//      superseded appears in none of them)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isTruthyEnvFlag,
  isToolAuthEnforced,
  requireToolAuth,
} from '../lib/security.js';
import { signSession } from '../lib/tenant.js';
import { buildResearchLogMetadata } from '../server/handlers/research-log.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'sweep-test-session-secret';
const TENANT_A = '11111111-1111-4111-8111-111111111111';

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end(payload) { if (payload) this.body = payload; return this; },
  };
}

function withEnv(patch, fn) {
  const saved = {};
  for (const k of Object.keys(patch)) {
    saved[k] = process.env[k];
    if (patch[k] === undefined) delete process.env[k];
    else process.env[k] = patch[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(patch)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

async function withEnvAsync(patch, fn) {
  const saved = {};
  for (const k of Object.keys(patch)) {
    saved[k] = process.env[k];
    if (patch[k] === undefined) delete process.env[k];
    else process.env[k] = patch[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(patch)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// ─── #3: router function config ──────────────────────────────────────────
describe('router function config (sweep #3)', () => {
  it('the map covers every handler that declares a config, with equal values', async () => {
    const router = await import('../api/[...path].js');
    const handlerDir = join(ROOT, 'server', 'handlers');
    let declared = 0;
    for (const file of readdirSync(handlerDir)) {
      if (!file.endsWith('.js')) continue;
      const src = readFileSync(join(handlerDir, file), 'utf8');
      const route = file.replace(/\.js$/, '');
      // Bare `export const maxDuration` is NOT a config shape Vercel or
      // this sweep recognizes — it must not come back.
      assert.ok(
        !/export\s+const\s+maxDuration\s*=/.test(src),
        `${file} declares a bare maxDuration export; use export const config`,
      );
      const cfg = src.match(/export\s+const\s+config\s*=\s*\{([^}]*)\}/);
      if (!cfg) continue;
      const dur = cfg[1].match(/maxDuration:\s*(\d+)/);
      if (dur) {
        declared++;
        assert.equal(
          router.ROUTE_MAX_DURATIONS[route],
          Number(dur[1]),
          `${file} declares maxDuration ${dur[1]} but the router map has ${router.ROUTE_MAX_DURATIONS[route]}`,
        );
      }
      const size = cfg[1].match(/sizeLimit:\s*'([^']+)'/);
      if (size) {
        assert.equal(
          router.ROUTE_FUNCTION_CONFIG[route]?.api?.bodyParser?.sizeLimit,
          size[1],
          `${file} declares body sizeLimit ${size[1]} missing from the router map`,
        );
      }
    }
    assert.ok(declared >= 5, `expected several maxDuration handlers, found ${declared}`);
  });

  it('the router platform config carries the max duration and largest body limit', async () => {
    const router = await import('../api/[...path].js');
    const durations = Object.values(router.ROUTE_MAX_DURATIONS);
    assert.equal(router.config.maxDuration, Math.max(...durations));
    assert.equal(router.config.maxDuration, 300); // the video routes' ceiling
    assert.equal(router.config.api.bodyParser.sizeLimit, '25mb'); // actionable's
    for (const route of ['video', 'video-runway', 'video-runway-veo']) {
      assert.equal(router.ROUTE_MAX_DURATIONS[route], 300, `${route} must keep its 300s`);
    }
  });
});

// ─── #5: shared truthy parsing for ENFORCE_TOOL_AUTH ─────────────────────
describe('tool-auth flag parsing (sweep #5, audit gap 9)', () => {
  it('accepts the full truthy set, case- and space-insensitively', () => {
    for (const v of ['1', 'true', 'TRUE', 'True', 'yes', 'on', ' true ', ' 1']) {
      assert.equal(isTruthyEnvFlag(v), true, JSON.stringify(v));
    }
  });

  it('rejects everything else, including unset and non-strings', () => {
    for (const v of ['0', 'false', 'no', 'off', '', '2', 'enabled', undefined, null, 1, true]) {
      assert.equal(isTruthyEnvFlag(v), false, JSON.stringify(v));
    }
  });

  it("the documented spelling 'true' now actually enforces (the gap-9 bug)", () => {
    withEnv({ ENFORCE_TOOL_AUTH: 'true', WEBHOOK_SECRET: 'sekret' }, () => {
      assert.equal(isToolAuthEnforced(), true);
      const res = mockRes();
      const allowed = requireToolAuth({ headers: {} }, res);
      assert.equal(allowed, false);
      assert.equal(res.statusCode, 401);
    });
  });

  it("'1' enforces too, and a correct secret passes under either spelling", () => {
    for (const spelling of ['1', 'true']) {
      withEnv({ ENFORCE_TOOL_AUTH: spelling, WEBHOOK_SECRET: 'sekret' }, () => {
        const res = mockRes();
        assert.equal(requireToolAuth({ headers: { 'x-webhook-secret': 'sekret' } }, res), true);
      });
    }
  });

  it('flag off (or absent) leaves tool auth open, as designed', () => {
    for (const patch of [{ ENFORCE_TOOL_AUTH: 'false' }, { ENFORCE_TOOL_AUTH: undefined }]) {
      withEnv({ ...patch, WEBHOOK_SECRET: 'sekret' }, () => {
        assert.equal(isToolAuthEnforced(), false);
        assert.equal(requireToolAuth({ headers: {} }, mockRes()), true);
      });
    }
  });

  it('no other file parses ENFORCE_TOOL_AUTH by hand anymore', () => {
    // Every reader must go through lib/security.js's shared helper.
    // Scan the code dirs for an actual env READ of the flag outside that
    // helper (comments naming the flag are fine; docs and tests are
    // excluded — this file sets it on purpose).
    for (const dir of ['lib', 'server', 'api', 'scripts']) {
      for (const file of readdirSync(join(ROOT, dir), { recursive: true })) {
        const name = String(file);
        if (!/\.(js|mjs|ts)$/.test(name) || name === 'security.js') continue;
        const src = readFileSync(join(ROOT, dir, name), 'utf8');
        assert.ok(
          !/(?:process\.env|env)\??\.?\s*(?:\.\s*ENFORCE_TOOL_AUTH|\[\s*['"]ENFORCE_TOOL_AUTH)/.test(src),
          `${dir}/${name} reads ENFORCE_TOOL_AUTH directly — use isToolAuthEnforced()`,
        );
      }
    }
  });
});

// ─── #6: research-log redaction ──────────────────────────────────────────
describe('research-log redaction (sweep #6, audit gap 11)', () => {
  const SECRET_TEXT = 'my secret diary entry about grandma';
  const conversation = [
    { role: 'user', content: SECRET_TEXT },
    { role: 'assistant', content: 'a reply that must not be stored either' },
    { role: 'user', content: [{ type: 'text', text: 'nested secret text' }] },
  ];

  it('the stored metadata contains NO message content or caller strings', () => {
    const meta = buildResearchLogMetadata(conversation, {
      userId: 'troy-the-person',
      researchTag: 'CONFIDENTIAL-TAG',
      ageRange: '6-8',
      consentDate: '2026-10-23',
    });
    const serialized = JSON.stringify(meta);
    for (const leak of [SECRET_TEXT, 'grandma', 'a reply that must not be stored', 'nested secret text', 'troy-the-person', 'CONFIDENTIAL-TAG', '6-8']) {
      assert.ok(!serialized.includes(leak), `metadata leaks: ${leak}`);
    }
  });

  it('keeps only counts, roles, and lengths — enough for aggregate research', () => {
    const meta = buildResearchLogMetadata(conversation, { userId: 'u1', consentDate: 'x' });
    assert.equal(meta.message_count, 3);
    assert.equal(meta.user_message_count, 2);
    assert.equal(meta.assistant_message_count, 1);
    assert.equal(meta.messages[0].content_length, SECRET_TEXT.length);
    assert.equal(meta.consent_recorded, true);
    assert.match(meta.participant_hash, /^[0-9a-f]{64}$/);
  });

  it('the handler source no longer builds a raw transcript document', () => {
    const src = readFileSync(join(ROOT, 'server', 'handlers', 'research-log.js'), 'utf8');
    assert.ok(!src.includes('## Full Conversation'), 'raw transcript heading is gone');
    assert.ok(!src.includes('text/markdown'), 'no markdown transcript upload');
    assert.ok(src.includes('buildResearchLogMetadata'), 'handler persists via the redactor');
  });
});

// ─── #7 (+#4): tenant scoping in enforced mode ──────────────────────────
describe('media endpoints + memory-admin tenant scoping (sweep #4/#7, audit gap 12)', () => {
  it('media-gallery: enforced mode without a session is a 401', async () => {
    const { default: handler } = await import('../server/handlers/media-gallery.js');
    await withEnvAsync({ SESSION_SECRET: SECRET }, async () => {
      const res = mockRes();
      await handler({ method: 'GET', headers: {}, query: { userId: TENANT_A } }, res);
      assert.equal(res.statusCode, 401);
    });
  });

  it('media-gallery: compat mode is unchanged (userId still required, no 401)', async () => {
    const { default: handler } = await import('../server/handlers/media-gallery.js');
    await withEnvAsync({ SESSION_SECRET: undefined }, async () => {
      const res = mockRes();
      await handler({ method: 'GET', headers: {}, query: {} }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'userId required');
    });
  });

  it('latest-image / latest-video: enforced mode without a session is a 401', async () => {
    const img = (await import('../server/handlers/latest-image.js')).default;
    const vid = (await import('../server/handlers/latest-video.js')).default;
    await withEnvAsync({ SESSION_SECRET: SECRET }, async () => {
      for (const handler of [img, vid]) {
        const res = mockRes();
        await handler({ method: 'GET', headers: {}, query: { userId: 'someone-else' } }, res);
        assert.equal(res.statusCode, 401);
      }
    });
  });

  it('latest-image / latest-video: compat mode is unchanged (no token -> empty 200)', async () => {
    const img = (await import('../server/handlers/latest-image.js')).default;
    const vid = (await import('../server/handlers/latest-video.js')).default;
    await withEnvAsync({ SESSION_SECRET: undefined, BLOB_READ_WRITE_TOKEN: undefined }, async () => {
      for (const handler of [img, vid]) {
        const res = mockRes();
        await handler({ method: 'GET', headers: {}, query: {} }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, { url: null });
      }
    });
  });

  it('memory-admin: enforced mode without a session is a 401 (after the webhook gate)', async () => {
    const { default: handler } = await import('../server/handlers/memory-admin.js');
    await withEnvAsync({ SESSION_SECRET: SECRET, WEBHOOK_SECRET: 'op-secret' }, async () => {
      const res = mockRes();
      await handler({
        method: 'GET',
        headers: { origin: 'https://thinkinbuddy.vercel.app', 'x-webhook-secret': 'op-secret' },
        query: { userId: TENANT_A },
      }, res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error, 'Unauthorized');
    });
  });

  it('memory-admin: the webhook-secret gate still fires first when the secret is wrong', async () => {
    const { default: handler } = await import('../server/handlers/memory-admin.js');
    await withEnvAsync({ SESSION_SECRET: SECRET, WEBHOOK_SECRET: 'op-secret' }, async () => {
      const res = mockRes();
      await handler({
        method: 'GET',
        headers: { origin: 'https://thinkinbuddy.vercel.app', 'x-webhook-secret': 'wrong' },
        query: { userId: TENANT_A },
      }, res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.result, 'Unauthorized');
    });
  });

  it('resolveScopedRequestIdentity: enforced session REPLACES the caller userId', async () => {
    const { resolveScopedRequestIdentity } = await import('../lib/tenant.js');
    await withEnvAsync({ SESSION_SECRET: SECRET }, async () => {
      const token = signSession(TENANT_A, SECRET, 600);
      const req = { headers: { authorization: `Bearer ${token}` } };
      const scoped = resolveScopedRequestIdentity(req, mockRes(), 'some-other-user');
      assert.equal(scoped.ok, true);
      assert.equal(scoped.enforced, true);
      assert.equal(scoped.tenantId, TENANT_A);
      assert.equal(scoped.userId, TENANT_A); // never the caller's value
    });
  });
});

// ─── #8: dead providers stay dead ────────────────────────────────────────
describe('dead providers removed (sweep #8)', () => {
  it('the Sora and Imagen handler files are deleted', () => {
    assert.equal(existsSync(join(ROOT, 'server', 'handlers', 'video-sora.js')), false);
    assert.equal(existsSync(join(ROOT, 'server', 'handlers', 'image-imagen.js')), false);
  });

  it('the router has no route for them', () => {
    const src = readFileSync(join(ROOT, 'api', '[...path].js'), 'utf8');
    assert.ok(!src.includes('video-sora'), 'router must not load video-sora');
    assert.ok(!src.includes('image-imagen'), 'router must not load image-imagen');
  });
});

// ─── D1: dead references killed in docs/templates ────────────────────────
describe('dead provider references in docs/templates (D1)', () => {
  it('the provisioning template names no dead tool or endpoint', () => {
    // tools.md is the provisioning template: any row there is an
    // instruction to create the tool. The dead tools must not appear
    // at all — not even as a "retired" row someone could provision
    // by mistake. (The living generate_image_gemini row's prose
    // mention of "the retired Imagen route" names no tool or
    // endpoint and does not trip this.)
    const src = readFileSync(join(ROOT, 'docs', 'elevenlabs-template', 'tools.md'), 'utf8');
    for (const dead of ['generate_video_sora', 'generate_image_imagen', '/api/video-sora', '/api/image-imagen']) {
      assert.ok(!src.includes(dead), `tools.md still references ${dead}`);
    }
  });

  it('SETUP.md carries no Imagen label for Google AI Studio', () => {
    const src = readFileSync(join(ROOT, 'SETUP.md'), 'utf8');
    assert.ok(!src.includes('Imagen'), 'SETUP.md still labels Google AI Studio as Imagen');
    assert.ok(src.includes('generate_image_gemini'), 'SETUP.md names the living Gemini image route');
  });

  it('the migrate mapping keeps the dead tools only as retired-with-date history', () => {
    // The mapping doc is a dated migration record: the rows stay as
    // history, but every line naming a dead tool must carry its
    // retirement marking on the same line, so no reader can mistake
    // the record for a live provisioning list.
    const src = readFileSync(join(ROOT, 'docs', 'ELEVENLABS_MIGRATE_MAPPING.md'), 'utf8');
    const lines = src.split('\n');
    const imagenLines = lines.filter((l) => l.includes('image-imagen') || l.includes('generate_image_imagen'));
    const soraLines = lines.filter((l) => l.includes('video-sora') || l.includes('generate_video_sora'));
    assert.ok(imagenLines.length >= 1, 'the historical imagen row is still recorded');
    assert.ok(soraLines.length >= 1, 'the historical sora row is still recorded');
    for (const line of [...imagenLines, ...soraLines]) {
      assert.ok(/retired/i.test(line), `dead-tool line is not marked retired: ${line}`);
    }
    assert.ok(src.includes('2026-08-17'), 'imagen retirement date (2026-08-17) recorded');
    assert.ok(src.includes('2026-09-24'), 'sora retirement date (2026-09-24) recorded');
  });
});

// ─── D2: dead-reference leftovers outside D1's files ─────────────────────
describe('dead-reference leftovers (D2)', () => {
  it('no shipped client surface labels anything Imagen', () => {
    // The GOOGLE_API_KEY row in the client's key list sold the deleted
    // Imagen route long after the handler died. index.html is the
    // source; the android/ios/dist copies are generated from it and
    // carry the same label — none of the four may name Imagen again.
    const clients = [
      'index.html',
      join('android', 'app', 'src', 'main', 'assets', 'public', 'index.html'),
      join('ios', 'App', 'App', 'public', 'index.html'),
      join('dist', 'index.html'),
    ];
    for (const rel of clients) {
      const path = join(ROOT, rel);
      assert.ok(existsSync(path), `${rel} exists`);
      const src = readFileSync(path, 'utf8');
      assert.ok(!/imagen/i.test(src), `${rel} still labels something Imagen`);
    }
    const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
    assert.ok(
      src.includes("usedBy: 'Gemini image generation"),
      'the GOOGLE_API_KEY row names the living Gemini image route',
    );
  });

  it('the env checklist and tool-auth rollout keep dead tools only as retired-with-date', () => {
    // Same rule as the migrate mapping (D1): these are dated records,
    // so the dead tools stay as history — but every line naming one
    // must carry its retirement marking on the same line, so neither
    // doc can be read as a current tool list.
    for (const rel of [join('docs', 'SANDY_ENV_CHECKLIST.md'), join('docs', 'TOOL_AUTH_ROLLOUT.md')]) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      const deadLines = src.split('\n').filter((l) => /imagen|sora/i.test(l));
      assert.ok(deadLines.length >= 1, `${rel} still records the dead tools as history`);
      for (const line of deadLines) {
        assert.ok(/retired/i.test(line), `${rel}: dead-tool line is not marked retired: ${line}`);
      }
      assert.ok(src.includes('2026-08-17'), `${rel}: imagen retirement date (2026-08-17) recorded`);
      assert.ok(src.includes('2026-09-24'), `${rel}: sora retirement date (2026-09-24) recorded`);
    }
  });

  it('SETUP.md §5 webhook count matches the template as it now stands', () => {
    // The count is derived from tools.md at test time — the template's
    // table rows plus recall_memory, which the template documents in
    // prose — so a future tool addition that forgets SETUP.md fails
    // here instead of drifting silently again.
    const template = readFileSync(join(ROOT, 'docs', 'elevenlabs-template', 'tools.md'), 'utf8');
    const rows = template.split('\n')
      .filter((l) => /^\| `[^`]+` \| `https:\/\/YOUR-DEPLOYMENT-URL/.test(l)).length;
    const total = rows + (template.includes('`recall_memory`') ? 1 : 0);
    const setup = readFileSync(join(ROOT, 'SETUP.md'), 'utf8');
    assert.ok(
      setup.includes(`the ${total} custom tool webhooks`),
      `SETUP.md must name the true count (${total} = ${rows} template rows + recall_memory)`,
    );
  });
});

// ─── B3: curriculum verification records ───────────────────────────────
describe('curriculum verification records (B3)', () => {
  // The 8 standing curricula, by the exact titles the Knowledge Base
  // export on disk carries (docs/knowledge-base/README.md, 2026-08-06).
  const RECORDS = [
    ['finance', 'Finance Curriculum (Ages 6–Adult)'],
    ['critical-thinking-and-logic', 'Critical Thinking & Logic Curriculum (Ages 6–Adult)'],
    ['coding-ai-and-web-design', 'Coding, AI & Web Design Curriculum (Ages 6–Adult)'],
    ['leadership-business-and-organizational-psychology', 'Leadership, Business & Organizational Psychology Curriculum (Ages 6–Adult)'],
    ['philosophy', 'Philosophy Curriculum (Ages 6–Adult)'],
    ['psychology-and-social-psychology', 'Psychology & Social Psychology Curriculum (Ages 6–Adult)'],
    ['college-prep-and-financial-aid', 'College Prep & Financial Aid Curriculum (Grade 7–Adult)'],
    ['academic-writing-and-english', 'Academic Writing & English Curriculum (Grade 7–Adult)'],
  ];
  const kbDir = join(ROOT, 'docs', 'knowledge-base');
  // Prose wraps across lines; collapse whitespace so phrase pins check
  // the words, not the wrapping.
  const flat = (src) => src.replace(/\s+/g, ' ');

  it('VERIFICATION.md states the record-keeping method', () => {
    const path = join(kbDir, 'VERIFICATION.md');
    assert.ok(existsSync(path), 'docs/knowledge-base/VERIFICATION.md exists');
    const src = flat(readFileSync(path, 'utf8'));
    for (const name of ['Claude AI', 'ChatGPT', 'Grok', 'Gemini']) {
      assert.ok(src.includes(name), `VERIFICATION.md names ${name} in the method of record`);
    }
    assert.ok(src.includes('independently'), 'VERIFICATION.md describes the independent drafts');
    assert.ok(src.includes('merge'), 'VERIFICATION.md describes the merge pass');
    assert.ok(src.includes('BASE_GUARDRAILS'), 'VERIFICATION.md names BASE_GUARDRAILS for the age-fit check');
    assert.ok(src.includes('KID_SAFETY_CORE'), 'VERIFICATION.md names KID_SAFETY_CORE for the age-fit check');
    assert.ok(src.includes('No framework — enrichment'), 'VERIFICATION.md carries the honest no-framework line');
    assert.ok(src.includes('not an accredited school'), 'VERIFICATION.md carries the honesty line');
    assert.ok(!/unverified/i.test(src), 'VERIFICATION.md never applies the superseded stamp');
  });

  it('all 8 records exist, titled as the KB export on disk titles them', () => {
    const readme = readFileSync(join(kbDir, 'README.md'), 'utf8');
    for (const [slug, title] of RECORDS) {
      assert.ok(readme.includes(title), `the KB export carries "${title}"`);
      const path = join(kbDir, 'verification', `${slug}.md`);
      assert.ok(existsSync(path), `verification/${slug}.md exists`);
      const src = flat(readFileSync(path, 'utf8'));
      assert.ok(src.includes(title), `${slug}.md carries its exact KB title`);
    }
  });

  it('every record carries the four-AI-merge provenance, builder Troy', () => {
    for (const [slug] of RECORDS) {
      const src = flat(readFileSync(join(kbDir, 'verification', `${slug}.md`), 'utf8'));
      assert.ok(src.includes('**Builder:** Troy'), `${slug}.md names Troy as builder`);
      for (const name of ['Claude AI', 'ChatGPT', 'Grok', 'Gemini']) {
        assert.ok(src.includes(name), `${slug}.md names ${name} in the build method`);
      }
      assert.ok(src.includes('independently wrote the full curriculum'), `${slug}.md states the independent drafts`);
      assert.ok(src.includes('merged them into the single master text'), `${slug}.md states the merge`);
      assert.ok(src.includes('2026-08-06'), `${slug}.md dates its KB presence to the export on disk`);
      assert.ok(src.includes('`shipped`'), `${slug}.md carries the B1 shipped status`);
    }
  });

  it('the text-dependent fields are deferred to the text pull, never invented', () => {
    for (const [slug] of RECORDS) {
      const src = flat(readFileSync(join(kbDir, 'verification', `${slug}.md`), 'utf8'));
      assert.ok(
        src.includes('Deferred — recorded from the merged text when the text is pulled into the repo.'),
        `${slug}.md defers its text-dependent fields in the standard words`,
      );
      assert.ok(src.includes('BASE_GUARDRAILS') && src.includes('KID_SAFETY_CORE'), `${slug}.md names the age-fit standards`);
      assert.ok(src.includes('No framework — enrichment'), `${slug}.md carries the honest no-framework line for its mapping field`);
      assert.ok(src.includes('not an accredited school'), `${slug}.md carries the honesty line`);
      assert.ok(!/unverified/i.test(src), `${slug}.md never applies the superseded stamp`);
    }
  });
});
