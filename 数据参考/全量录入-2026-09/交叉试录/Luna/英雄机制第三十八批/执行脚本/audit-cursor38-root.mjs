import fs from 'node:fs';
let s=fs.readFileSync('C:/project/damage_web_dev/.agents/artifacts/audit-cursor41.mjs','utf8').replaceAll('hero41','hero38').replaceAll("'/主负责人执行审计.json'","'/主负责人补充执行审计.json'").replaceAll("'/Cursor来源复核结论.md'","'/主负责人提取来源复核结论.md'");
await import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));
