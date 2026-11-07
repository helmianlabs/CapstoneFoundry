import fs from 'fs';

const path = 'E:/CapstoneFoundry/server/handlers/memory.js';
let content = fs.readFileSync(path, 'utf8');

// 1. upsertExtractedFact
content = content.replace(
  `  const insCols = ['user_id', 'scope', 'kind', 'subject', 'content', 'embedding', 'confidence', 'importance', 'source_session'];`,
  `  const category = classifyMemoryCategory(subject, content);\n  const insCols = ['user_id', 'scope', 'kind', 'subject', 'content', 'embedding', 'confidence', 'importance', 'source_session', 'category'];`
);
content = content.replace(
  `  insParams.push(sourceSession); insVals.push(\`$\${insParams.length}\`);`,
  `  insParams.push(sourceSession); insVals.push(\`$\${insParams.length}\`);\n  insParams.push(category); insVals.push(\`$\${insParams.length}\`);`
);

// 2. saveMemoryCandidates
// In no-vector insert:
content = content.replace(
  `      const nvParams = [user_id, c.scope, c.kind, c.subject, c.content,
        c.confidence, c.importance, c.valid_until, c.source_session];`,
  `      const cat = c.category || classifyMemoryCategory(c.subject, c.content);
      const nvParams = [user_id, c.scope, c.kind, c.subject, c.content,
        c.confidence, c.importance, c.valid_until, c.source_session, cat];`
);
content = content.replace(
  `            confidence, importance, valid_until, source_session, source_span\${nvTenantCol})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,\${nvSpanVal}\${nvTenantVal})\`,`,
  `            confidence, importance, valid_until, source_session, category, source_span\${nvTenantCol})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,\${nvSpanVal}\${nvTenantVal})\`,`,
);

// In supersede insert:
content = content.replace(
  `          const ssParams = [user_id, c.scope, c.kind, c.subject, c.content, vlit,
            c.confidence, c.importance, c.valid_until, old.id, c.source_session];`,
  `          const cat = c.category || classifyMemoryCategory(c.subject, c.content);
          const ssParams = [user_id, c.scope, c.kind, c.subject, c.content, vlit,
            c.confidence, c.importance, c.valid_until, old.id, c.source_session, cat];`
);
content = content.replace(
  `                confidence, importance, valid_until, supersedes,
                source_session, source_span\${ssTenantCol})
             VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$8,$9,$10,$11,\${ssSpanVal}\${ssTenantVal})\`,`,
  `                confidence, importance, valid_until, supersedes,
                source_session, category, source_span\${ssTenantCol})
             VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$8,$9,$10,$11,$12,\${ssSpanVal}\${ssTenantVal})\`,`,
);

// In fresh insert:
content = content.replace(
  `    const fiParams = [user_id, c.scope, c.kind, c.subject, c.content, vlit,
      c.confidence, c.importance, c.valid_until, c.source_session];`,
  `    const cat = c.category || classifyMemoryCategory(c.subject, c.content);
    const fiParams = [user_id, c.scope, c.kind, c.subject, c.content, vlit,
      c.confidence, c.importance, c.valid_until, c.source_session, cat];`
);
content = content.replace(
  `          confidence, importance, valid_until, source_session, source_span\${fiTenantCol})
       VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$8,$9,$10,\${fiSpanVal}\${fiTenantVal})\`,`,
  `          confidence, importance, valid_until, source_session, category, source_span\${fiTenantCol})
       VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$8,$9,$10,$11,\${fiSpanVal}\${fiTenantVal})\`,`,
);

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully patched saveMemoryCandidates and upsertExtractedFact with category!');
