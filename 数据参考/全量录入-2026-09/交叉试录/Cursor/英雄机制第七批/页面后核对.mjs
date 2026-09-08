import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const bytes=fs.readFileSync(path.join(dir,'完整候选.json'));
const candidate=JSON.parse(bytes);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'b3908f6740ea02c32828e52044b78f4c6ed080fea7d7a3e6188641fcf3766b35');
const selected={
  "olaf_w": {
    "parameters": [
      "shield_duration_ms",
      "attack_speed_duration_ms"
    ],
    "effects": [
      "cast_shield",
      "attack_speed"
    ]
  },
  "olaf_e": {
    "parameters": [
      "health_cost_ratio"
    ],
    "formulas": [
      "damage",
      "health_cost"
    ],
    "effects": [
      "health_cost"
    ]
  },
  "nocturne_w": {
    "parameters": [
      "passive_attack_speed_ratio",
      "spell_shield_duration_ms",
      "empowered_attack_speed_duration_ms"
    ],
    "effects": [
      "spell_shield",
      "consume_spell_shield",
      "on_block_additional_attack_speed"
    ],
    "triggerRules": [
      "consume_and_empower_on_block"
    ]
  },
  "vi_q": {
    "parameters": [
      "cooldown_ms",
      "cancel_cooldown_ms"
    ],
    "processes": [
      "cast"
    ]
  },
  "vayne_w": {
    "parameters": [
      "target_maximum_health_ratio",
      "minimum_true_damage",
      "same_target_window_ms"
    ],
    "formulas": [
      "silver_bolts_damage"
    ]
  }
};
const keyFields={parameters:'parameterKey',formulas:'formulaKey',effects:'effectKey',processes:'processKey',triggerRules:'ruleKey'};
function compare(actual,expected,pointer=''){
  if(Array.isArray(expected)){assert.ok(Array.isArray(actual),pointer);assert.equal(actual.length,expected.length,pointer);expected.forEach((x,i)=>compare(actual[i],x,`${pointer}/${i}`));}
  else if(expected&&typeof expected==='object'){assert.ok(actual&&typeof actual==='object',pointer);for(const[k,v]of Object.entries(expected))compare(actual[k],v,`${pointer}/${k}`);}
  else assert.deepEqual(actual,expected,pointer);
}
const checks=[];
for(const[skillKey,groups]of Object.entries(selected))for(const[type,keys]of Object.entries(groups))for(const key of keys){
  const expected=candidate.skills[skillKey].write[type].find(x=>x[keyFields[type]]===key);assert.ok(expected,`${skillKey}/${type==='triggerRules'?'trigger-rules':type}/${key}`);
  const route=`/skills/${skillKey}/${type==='triggerRules'?'trigger-rules':type}/${key}`;
  const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,200,route);const actual=await response.json();compare(actual,expected,route);checks.push({route,actual,matched:true});
}
assert.equal(checks.length,22);
const report={at:new Date().toISOString(),url:'http://127.0.0.1:5173/#/skills',subjects:5,independentGetCount:22,checks,passed:true,browserChecks:[
  "奥拉夫W实际效果分别引用shield_duration_ms与attack_speed_duration_ms；参数表分别2500和5000毫秒，攻速说明明确护盾耗尽不提前结束攻速。",
  "奥拉夫E参数列表生命消耗相对本次伤害比例为0.4，不采用旧30%；页面后核对实际伤害、消耗公式及效果。",
  "魔腾W规则事件为法术护盾成功阻挡，来源明确本技能黑暗庇护法术护盾；有序动作先consume_spell_shield后on_block_additional_attack_speed。查看后取消未提交。",
  "蔚Q过程说明明确开始蓄力只消费法力，普通冷却未配置；仅1步骤、1法力效果挂接，未将开始蓄力当成冷却起点。",
  "薇恩W页面等级比例0.04/0.055/0.07/0.085/0.1，最低真实伤害40/55/70/85/100，同目标窗口3500毫秒。"
],runtime:'未执行；页面与表达式核算不等于战斗验收'};
fs.writeFileSync(path.join(dir,'页面验收.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({subjects:5,independentGetCount:22,passed:true}));
