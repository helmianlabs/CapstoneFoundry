import fs from 'fs';

const sql1 = fs.readFileSync('E:/CapstoneFoundry/sql/store/001_tenants.sql', 'utf8');
const sql2 = fs.readFileSync('E:/CapstoneFoundry/sql/store/002_tenant_columns.sql', 'utf8');

console.log("SQL 1 matches with DELETE:");
sql1.split('\n').forEach((l, i) => {
  if (/delete/i.test(l)) console.log(`  Line ${i+1}: ${l}`);
});

console.log("SQL 2 matches with DROP:");
sql2.split('\n').forEach((l, i) => {
  if (/drop/i.test(l)) console.log(`  Line ${i+1}: ${l}`);
});
