import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=n=>JSON.parse(fs.readFileSync(path.join(here,n))),hash=n=>sha(fs.readFileSync(path.join(here,n)));
const applyFile='apply-20260909073028502.json',verifyFile='verify-20260909073057989.json',mathFile='实值独立核算-20260909073211109.json';
const a=read(applyFile),v=read(verifyFile),m=read(mathFile),approval=read('主审批准.json'),plan=read('可审查请求.json');
assert.equal(hash('可审查请求.json'),'9eedde869856eaf7fd119d4b1ad192fa4cba7509ddc6b9a8571ac7c261ee89d9');
for(const r of [a,v,m])assert.equal(r.summary.passed,true);
assert.equal(a.writes.length,3);assert.ok(a.writes.every(r=>r.method==='PUT'&&r.responseStatus===200&&r.matched&&r.unknownError===null));assert.equal(v.writes.length,0);
assert.equal(a.reads.length,118);assert.equal(v.reads.length,56);assert.equal(m.reads.length,10);
for(const c of plan.changes){const written=a.writes.find(r=>r.route===c.route),verified=v.reads.find(r=>r.route===c.route),math=m.reads.find(r=>r.route===c.route);assert.deepEqual(written.after,verified.actual);assert.deepEqual(math.actual,verified.actual);}
assert.equal(m.math.length,19);assert.ok(m.math.every(r=>r.passed));assert.equal(m.staticQualificationEvidence.caseCount,6);
for(const file of ['流水-20260909073028502.jsonl','流水-20260909073057989.jsonl']){const records=fs.readFileSync(path.join(here,file),'utf8').trim().split(/\r?\n/).map(JSON.parse);assert.ok(!records.some(r=>r.phase==='unknown'));}
for(const copied of approval.archivedFiles)assert.equal(hash('独立审查/'+copied.name),copied.sha256);
assert.equal(read('写入启动锁.json').planSha256,approval.requestSha256);assert.equal(read('三项写入完成锁.json').writes,3);
const result={at:new Date().toISOString(),status:'COMPLETE',requestSha256:approval.requestSha256,writeAttempts:1,successfulPUT:3,failedWrites:0,unknownWrites:0,replayedWrites:0,newObjects:0,deletedObjects:0,
 affected:[{skillKey:'rune_8010_passive',formulas:['adaptive_force_amount'],maxStacks:12},{skillKey:'rune_8008_passive',formulas:['melee_attack_speed_amount','ranged_attack_speed_amount'],maxStacks:6}],
 validation:{applyGET:118,independentGET:56,actualMathGET:10,afterApplyIndependentGET:66,actualCases:19,preservedStaticQualificationCases:6,fullComponentRoutes:44,protectedRoutes:12,allPassed:true},
 protection:'22参数、其余4公式、1独立效果、2技能主体及所有空动作集合保持；2技能/2符文代表图、2原图字节元数据和用途、2符文身份及挂载均保持。3公式仅表达式一处叶替换及批准说明改变；相关更新对象服务器修改时间正常变化。',
 importantBoundaries:['每层适应之力及远程来源仍须明确供值，没有选择未知等级或远程冲突数值。','19案例的缺值及整数/非负输入拒绝是独立求值器验证；不冒充业务战斗执行。','满层治疗/伤害资格仍未接线，保留6个静态资格案例，没有把未满层改成按比例生效。','公式列表仅校验原有摘要字段，完整表达式通过详情与另一次实际GET核验。','启动锁与三项完成锁已存在，禁止重放--apply；后续使用--verify只读。'],
 evidence:['可审查请求.json','主审批准.json','写前保护快照.json',applyFile,verifyFile,mathFile,'独立审查/封顶审计结论.json'].map(file=>({file,sha256:hash(file)}))};
fs.writeFileSync(path.join(here,'最终修正结果.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(path.join(here,'最终验收完成锁.json'),JSON.stringify({at:result.at,status:'COMPLETE',requestSha256:approval.requestSha256,resultSha256:hash('最终修正结果.json'),successfulPUT:3,afterApplyIndependentGET:66},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,successfulPUT:3,independentGET:66,actualCases:19,resultSha256:hash('最终修正结果.json')}));
