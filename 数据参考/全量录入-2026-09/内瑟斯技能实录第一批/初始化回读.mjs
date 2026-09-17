import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const endpoint = '/skills/nasus_p/trigger-rules';
async function request(url, method = 'GET', body) {
  const r = await fetch(base + url, {method, headers: {Authorization:'Bearer local-entry', 'Content-Type':'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(30000)});
  return {status:r.status, data:await r.json()};
}
const saved = await request(endpoint+'/initialize_lifesteal');
assert.equal(saved.status,200);
const rule = saved.data;
assert.deepEqual(rule.eventSource,{eventType:'SOURCE_INITIALIZED',detail:{}});
assert.deepEqual(rule.conditionGroups,[]);
assert.equal(rule.actions.length,1);
assert.equal(rule.actions[0].targetContext,'EVENT_SOURCE');
assert.equal(rule.actions[0].actionType,'EXECUTE_EFFECT');
assert.deepEqual(rule.actions[0].detail,{effectKey:'soul_eater_lifesteal'});
assert.deepEqual(rule.actions[0].runtimeInputBindings,[]);
const effect = await request('/skills/nasus_p/effects/soul_eater_lifesteal');
assert.equal(effect.status,200);
assert.equal(effect.data.lifecycle.instanceScope,'SOURCE');
assert.equal(effect.data.lifecycle.durationValue,null);
assert.equal(effect.data.results[0].lifecycleBehavior.valueReadMode,'MOMENT_EVALUATION');
assert.deepEqual(effect.data.results[0].valueRule.value,{kind:'PARAMETER',parameterKey:'life_steal_ratio'});
const beforeOld = await request('/skills/annie_q/trigger-rules');
assert.equal(beforeOld.status,200);
const out = {checkedAt:new Date().toISOString(), rule:rule, effect:effect.data, rejections:[], passed:true,
  counts:{triggerRules:1}, runtimeValidation:'未执行',
  browser:{url:'http://127.0.0.1:5173/#/skills',skillKey:'nasus_p',method:'真实页面新增、关闭父窗口重开编辑并核对',
    checked:['初始化事件及触发一次说明','明细无额外输入','事件来源对象自身','soul_eater_lifesteal效果引用'],
    recovery:'首次保存因旧数据库CHECK返回500；独立GET404确认未落地；原子扩充约束后原草稿重试成功。'}};
if(process.argv.includes('--verify-rejections')) {
  for(const [label,detail] of [['extra',{unexpected:true}],['null',null],['array',[]],['number',1],['text','bad']]) {
    const key = 'validation_init_'+label;
    assert.equal((await request(endpoint+'/'+key)).status,404,'校验标识已有数据，停止');
    const body = {ruleKey:key,name:'初始化非法明细校验',description:null,sortOrder:0,eventSource:{eventType:'SOURCE_INITIALIZED',detail},
      conditionGroups:[],actions:rule.actions,perTargetCooldown:null,maxTriggersPerProcess:null};
    const rejected = await request(endpoint,'POST',body);
    assert.equal(rejected.status,400,label+'必须拒绝');
    assert.equal((await request(endpoint+'/'+key)).status,404,label+'不能留下业务行');
    out.rejections.push({case:label,status:rejected.status,absentAfter:true});
  }
}
assert.deepEqual((await request(endpoint+'/initialize_lifesteal')).data,rule);
assert.deepEqual((await request('/skills/annie_q/trigger-rules')).data,beforeOld.data);
out.existingSkillHitRulesUnchanged=true;
fs.writeFileSync(path.join(here,process.argv.includes('--verify-rejections')?'初始化拒绝校验.json':'初始化回读.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({passed:out.passed,rule:rule.ruleKey,rejections:out.rejections.length,existingRulesUnchanged:true}));
