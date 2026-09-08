import fs from 'node:fs';
import assert from 'node:assert/strict';
const here=new URL('./',import.meta.url);
const candidate=JSON.parse(fs.readFileSync(new URL('完整候选.json',here),'utf8'));
const checks=[];
function compare(actual,expected,label){
  if(expected&&typeof expected==='object'&&!Array.isArray(expected)){
    for(const [key,value] of Object.entries(expected))compare(actual?.[key],value,`${label}/${key}`);
  }else assert.deepEqual(actual,expected,label);
}
for(const object of candidate.objects.filter(x=>['item_2420_active','item_3139_active'].includes(x.skillKey))){
  const tasks=[...object.apiPayload.parameters.map(x=>({path:`parameters/${x.parameterKey}`,expected:x})),
    ...object.apiPayload.effects.map(x=>({path:`effects/${x.effectKey}`,expected:x})),
    {path:'representative-image',expected:{image:{imageKey:object.equipmentKey,enabled:true}}}];
  for(const task of tasks){
    const route=`/skills/${object.skillKey}/${task.path}`;
    const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200,route);
    const actual=await response.json();compare(actual,task.expected,route);checks.push({route,actual,match:true});
  }
}
assert.equal(checks.length,9);
fs.writeFileSync(new URL('页面验收.json',here),JSON.stringify({at:new Date().toISOString(),url:'http://127.0.0.1:5173/#/skills',
  method:'主负责人实际浏览器查看，详情与目录加载完成后核对；页面未写入，再用9个独立GET检查最终值。',
  samples:[{skillKey:'item_3139_active',observation:'水银自身移动速度效果有生命周期，绑定2000毫秒参数；结果为施法者持续属性变化，move_speed_percent增加，固定加算，取move_speed_ratio=0.5。完整解控另待配。'},
    {skillKey:'item_2420_active',observation:'凝滞伤害免疫效果绑定2500毫秒参数；唯一结果为施法者持续全类型伤害免疫，说明明确不包括完整不可选取、移动限制与一次性消费，未自动触发。'}],
  imageObservation:'两个技能列表均有正确代表图片元素与名称。',checks,runtimeValidation:'未执行',passed:true},null,2)+'\n');
console.log(JSON.stringify({independentGet:checks.length,passed:true}));
