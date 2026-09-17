import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const bytes=fs.readFileSync(path.join(dir,'完整候选.json'));
const candidate=JSON.parse(bytes);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'a593bd1f49c1ab6f424bd76b7ad4dbef1e0e7154f00d0347dc90c7c1e39126ac');
const selected={
  mordekaiser_w:{parameters:['actual_remaining_shield','remaining_shield_heal_ratio'],formulas:['recast_heal'],effects:['recast_heal']},
  renekton_q:{parameters:['normal_heal_cap','empowered_heal_cap','empowered_heal_multiplier'],formulas:['normal_champion_heal','empowered_champion_heal']},
  jax_r:{parameters:['active_bonus_ap_ratio'],formulas:['active_damage']},
  garen_p:{parameters:['regen_ratio_per_5s'],formulas:['regen_per_5s']},
  renekton_r:{parameters:['duration_ms'],effects:['dominance_health'],processes:['cast']},
};
const keyFields={parameters:'parameterKey',formulas:'formulaKey',effects:'effectKey',processes:'processKey'};
function compare(actual,expected,pointer=''){
  if(Array.isArray(expected)){assert.ok(Array.isArray(actual),pointer);assert.equal(actual.length,expected.length,pointer);expected.forEach((x,i)=>compare(actual[i],x,`${pointer}/${i}`));}
  else if(expected&&typeof expected==='object'){assert.ok(actual&&typeof actual==='object',pointer);for(const[k,v]of Object.entries(expected))compare(actual[k],v,`${pointer}/${k}`);}
  else assert.deepEqual(actual,expected,pointer);
}
const checks=[];
for(const[skillKey,groups]of Object.entries(selected))for(const[type,keys]of Object.entries(groups))for(const key of keys){
  const expected=candidate.skills[skillKey].write[type].find(x=>x[keyFields[type]]===key);assert.ok(expected,`${skillKey}/${type}/${key}`);
  const route=`/skills/${skillKey}/${type}/${key}`;
  const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,200);const actual=await response.json();compare(actual,expected,route);checks.push({route,actual,matched:true});
}
assert.equal(checks.length,16);
const report={at:new Date().toISOString(),url:'http://127.0.0.1:5173/#/skills',subjects:5,independentGetCount:16,checks,passed:true,browserChecks:[
  '莫德凯撒W参数列表显示实际剩余护盾为计算时传入，治疗公式读取actual_remaining_shield乘当前技能级别的remaining_shield_heal_ratio，没有使用初始盾替代。',
  '雷克顿Q分别保留通常与强化治疗上限；查看强化公式为MIN(强化上限,(英雄基础治疗+额外攻击力系数×来源额外攻击力)×强化倍率)，没有先截断通常治疗再乘3。',
  '贾克斯R主动伤害公式属性选择法术强度/加成值，表达式确认主动基础伤害加额外法强系数乘来源额外法强。',
  '盖伦P参数名称为每5秒最大生命回复比例，1级0.015、18级0.101，保留原数据口径。',
  '雷克顿R效果说明与duration_ms参数为15秒；结果为来源生命属性增加、属性固定加算、持续生效，仅一个结果，没有另送等额直接治疗。'
],runtime:'未执行；页面查看与保存表达式算术不等于战斗验证'};
fs.writeFileSync(path.join(dir,'页面验收.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({subjects:5,independentGetCount:16,passed:true}));
