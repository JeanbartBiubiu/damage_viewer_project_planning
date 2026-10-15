import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAutomaticSkillsInput, syncAutomaticInitialSnapshot } from './automatic-skills-input.mjs';
import { moduleRoot, instantiateGenericHost, compileCanonicalSession, runCanonicalSession, releaseCanonicalSession } from './generic-abi-host.mjs';

const artifact = resolve(moduleRoot, process.argv[2] ?? 'target/automatic-skills/tinygo_engine_v2.wasm');
const { exports } = await instantiateGenericHost(artifact);
const cases = [];
const starts = (done, key) => done.automaticSkillRecords.filter(row => row.kind === 'STARTED' && row.ruleKey === key).map(row => row.timeMs);
const run = input => {
  const compiled = compileCanonicalSession(exports, input);
  try { return runCanonicalSession(exports,input,compiled.sessionId,compiled.rulesHash); }
  finally { releaseCanonicalSession(exports,compiled.sessionId,compiled.rulesHash); }
};
for (const count of [2, 3, 4, 16]) {
  const input = createAutomaticSkillsInput(count);
  const done = run(input);
  assert.equal(done.automaticSkillSummary.startedCount, count * 3);
  assert.equal(done.automaticSkillSummary.completedCount, count * 3);
  assert.equal(done.summary.sourceDamageDealt, count * 30);
  assert.equal(done.automaticSkillSummary.qualifications.length, count - 1);
  for (const edge of done.automaticSkillSummary.qualifications) {
    assert.equal(edge.grantedCount,edge.consumedCount + edge.remainingCount);
    assert.equal(edge.consumedCount,3); assert.equal(edge.remainingCount,0);
  }
  cases.push(`${count}项链首次与三轮循环、伤害和资格守恒`);
}

{
  const input = createAutomaticSkillsInput(3), session = compileCanonicalSession(exports,input);
  const baseline = runCanonicalSession(exports,input,session.sessionId,session.rulesHash);
  for (let i=0;i<20;i++) assert.deepEqual(runCanonicalSession(exports,input,session.sessionId,session.rulesHash),baseline);
  for (const [mode,budget] of [['detailed',0],['summary',1000]]) {
    input.runRequest.outputMode=mode;input.runRequest.recordBudget.maxAutomaticSkillRecords=budget;
    const done=runCanonicalSession(exports,input,session.sessionId,session.rulesHash);
    assert.deepEqual(done.automaticSkillSummary,baseline.automaticSkillSummary);assert.deepEqual(done.summary,baseline.summary);
    assert.equal(done.automaticSkillRecords.length,0);
    assert.equal(done.automaticSkillRecording[mode==='summary'?'omittedCount':'droppedCount'],done.automaticSkillRecording.totalCount);
  }
  input.runRequest.outputMode='detailed';input.runRequest.recordBudget.maxAutomaticSkillRecords=1000;
  input.runRequest.driverPlan.automaticSkills.rules[0].waitForCooldowns=['missing'];
  assert.throws(()=>runCanonicalSession(exports,input,session.sessionId,session.rulesHash),/rules\[0\]\.waitForCooldowns\[0\]/);
  input.runRequest.driverPlan.automaticSkills.rules[0].waitForCooldowns=['rule1'];
  assert.deepEqual(runCanonicalSession(exports,input,session.sessionId,session.rulesHash),baseline);
  releaseCanonicalSession(exports,session.sessionId,session.rulesHash);
  assert.deepEqual(run(input),baseline);
  cases.push('同会话20次、记录预算0与汇总、错误恢复、释放重编无状态继承');
}

for (const remaining of [200,1500,0]) {
  const input=createAutomaticSkillsInput(2), c=input.compileRequest;
  c.sharedProviders[0].processes[0].cooldown.durationMs={op:'const',value:100};
  c.combatants[0].providers.push({providerRef:'changer',definitionRef:'cooldown_changer'});
  c.sharedProviders.push({providerKey:'cooldown_changer',kind:'equipment',stableId:'changer',listeners:[{
    listenerKey:'change',eventMatcher:{all:['event/skill_hit','ability/rule1']},operations:[{
      operation:'cooldown_change',target:'self',abilityRef:'source.provider[mount_rule1].ability[initial]',
      valuePolicy:'set_remaining',amount:{op:'const',value:remaining},
    }],
  }]});
  input.runRequest.stopPolicy.durationMs=1800;
  syncAutomaticInitialSnapshot(input);
  const done=run(input);
  const expected = remaining===1500 ? 1502 : remaining===0 ? 100 : 202;
  assert.equal(starts(done,'rule0')[1],expected);
  cases.push(`关联冷却在真实被动事件中改为${remaining}毫秒，候选统一改期且旧事件不执行`);
}

{
  const input=createAutomaticSkillsInput(3), c=input.compileRequest;
  c.combatants[0].providers.push({providerRef:'passive',definitionRef:'passive_cd'});
  c.sharedProviders.push({providerKey:'passive_cd',kind:'equipment',stableId:'passive_cd',initialStateSchema:{
    internal_cd:{stateKind:'cooldown',defaultValue:0,maxValue:1,durationMs:150,refreshPolicy:'start_on_first_write'},accepted:0,
  },listeners:[{listenerKey:'accepted_hits',eventMatcher:{all:['event/skill_hit']},condition:{op:'eq',args:[{op:'read',path:'provider.state.internal_cd'},{op:'const',value:0}]},operations:[
    {operation:'state_change',target:'self',ref:'accepted',types:['state_scope/provider'],valuePolicy:'add',amount:{op:'const',value:1}},
    {operation:'state_change',target:'self',ref:'internal_cd',types:['state_scope/provider'],valuePolicy:'override',amount:{op:'const',value:1}},
  ]}]});
  syncAutomaticInitialSnapshot(input);
  const done=run(input), state=done.finalSnapshot.combatants.find(actor=>actor.key==='source').providerState.passive;
  assert.equal(state.state.accepted,3);assert.equal(state.state.internal_cd,0);
  assert.equal(done.automaticSkillSummary.startedCount,9);
  cases.push('纯主动关闭背景普攻，真实被动内部冷却到期仅恢复就绪、不补旧命中');
}
console.log(JSON.stringify({result:'pass',artifact,bytes:readFileSync(artifact).length,sha256:createHash('sha256').update(readFileSync(artifact)).digest('hex'),cases,
  boundary:'独立作者输入经最终Wasm编译、运行和释放；实际页面及真实作者另行验收'},null,2));
