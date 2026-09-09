import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),source='C:/project/damage_web_dev/.agents/artifacts/rune-cap-audit',out=path.join(here,'独立审查');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const names=['只读采集.mjs','来源与静态筛选.json','实际五项回读.json','封顶分析与最小方案.mjs','本地断言修订记录.json','三公式最小可审查方案.json','封顶审计结论.json','README.md'];
fs.mkdirSync(out,{recursive:true});const copies=[];
for(const name of names){const bytes=fs.readFileSync(path.join(source,name)),to=path.join(out,name);if(fs.existsSync(to))assert.deepEqual(fs.readFileSync(to),bytes);else fs.writeFileSync(to,bytes,{flag:'wx'});assert.deepEqual(fs.readFileSync(to),bytes);copies.push({name,bytes:bytes.length,sha256:sha(bytes)});}
const planBytes=fs.readFileSync(path.join(out,'三公式最小可审查方案.json'));assert.equal(sha(planBytes),'9eedde869856eaf7fd119d4b1ad192fa4cba7509ddc6b9a8571ac7c261ee89d9');
fs.writeFileSync(path.join(here,'可审查请求.json'),planBytes,{flag:'wx'});
const approval={at:new Date().toISOString(),verdict:'READY',requestSha256:sha(planBytes),authority:'主负责人明确批准：只把actual_stacks叶替换MIN(actual_stacks,max_stacks)并补说明，名称顺序其他表达式及资格不变；保护后只执行3PUT。',changes:3,archivedFiles:copies,businessWrites:0};
fs.writeFileSync(path.join(here,'主审批准.json'),JSON.stringify(approval,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({copied:copies.length,requestSha256:sha(planBytes),verdict:approval.verdict}));
