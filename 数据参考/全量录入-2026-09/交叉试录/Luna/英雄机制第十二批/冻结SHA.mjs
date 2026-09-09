import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../../../../../');
const artifact=path.join(repo,'.agents','artifacts','hero12-20260909');
const files=[
  'README.md','完整审查说明.md','实际准备体验报告.md','冻结来源.mjs','冻结文本.mjs','当前20技能只读核对.mjs','生成候选.mjs','完整独立核算.mjs','英雄机制.mjs','冻结SHA.mjs',
  '根绑定与数值证据.json','补充文本证据.json','写前现值.json','当前20技能组成核对.json','候选原始.json','完整候选.json','完整独立核算.json',
  '来源冻结/来源与哈希汇总.json','来源冻结/主技能数值展开.json'
];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const records={};
for(const relative of files){const bytes=await readFile(path.join(here,relative));records[relative]={sha256:sha256(bytes),bytes:bytes.length};}
const candidateSummary=JSON.parse(await readFile(path.join(artifact,'候选生成摘要.json'),'utf8'));
const checkSummary=JSON.parse(await readFile(path.join(artifact,'独立核算摘要.json'),'utf8'));
await mkdir(artifact,{recursive:true});
const out={generatedAt:new Date().toISOString(),scope:'第十二批候选冻结文件与只读证据；不含真实凭据',files:records,candidateHashes:{rawPlanSha256:candidateSummary.rawPlanSha256,protectedPlanSha256:candidateSummary.planSha256},independentCheck:{pass:checkSummary.pass,errorCount:checkSummary.errorCount,checkCount:checkSummary.checkCount,formulaCheckCount:checkSummary.formulaCheckCount}};
await writeFile(path.join(artifact,'SHA256SUMS.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({fileCount:files.length,candidateHashes:out.candidateHashes,independentCheck:out.independentCheck}));
