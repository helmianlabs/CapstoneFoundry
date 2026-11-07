import fs from 'fs';

const sql1 = fs.readFileSync('E:/CapstoneFoundry/sql/store/001_tenants.sql', 'utf8');
const sql2 = fs.readFileSync('E:/CapstoneFoundry/sql/store/002_tenant_columns.sql', 'utf8');

console.log("SQL 1 has DROP?:", /drop/i.test(sql1));
console.log("SQL 2 has DROP?:", /drop/i.test(sql2));
console.log("SQL 1 has DELETE?:", /delete/i.test(sql1));
console.log("SQL 2 has DELETE?:", /delete/i.test(sql2));
