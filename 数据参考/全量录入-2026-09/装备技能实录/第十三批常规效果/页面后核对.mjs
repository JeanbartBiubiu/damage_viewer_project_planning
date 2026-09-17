import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const here=new URL('./',import.meta.url);
if(process.argv.length>2)throw Error('本入口只读核对固定代表项');
const bytes=fs.readFileSync(new URL('完整候选.json',here));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'b849c156a9732b94bfc183e91719ecccc0a11d0400bd41ae8195fe4351045878');
const candidate=JSON.parse(bytes),checks=[];
function compare(actual,expected,label){
  if(expected&&typeof expected==='object'&&!Array.isArray(expected)){
    for(const [key,value] of Object.entries(expected))compare(actual?.[key],value,`${label}/${key}`);
  }else assert.deepEqual(actual,expected,label);
}
async function get(route){
  const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,route);return await response.json();
}
for(const object of candidate.objects.filter(x=>['item_4629_passive','item_3082_passive'].includes(x.skillKey))){
  const tasks=[...object.apiPayload.parameters.map(x=>({path:`parameters/${x.parameterKey}`,expected:x})),
    ...object.apiPayload.formulas.map(x=>({path:`formulas/${x.formulaKey}`,expected:x})),
    ...object.apiPayload.effects.map(x=>({path:`effects/${x.effectKey}`,expected:x})),
    {path:'representative-image',expected:{image:{imageKey:object.equipmentKey,enabled:true}}}];
  for(const task of tasks){const route=`/skills/${object.skillKey}/${task.path}`,actual=await get(route);compare(actual,task.expected,route);checks.push({route,actual,match:true});}
}
const randuin=candidate.objects.filter(x=>x.equipmentKey==='item_3143');
for(const object of randuin){const route=`/skills/${object.skillKey}`,actual=await get(route);compare(actual,object.apiPayload.skill,route);checks.push({route,actual,match:true});}
const relationRoute='/equipment-skill-relations?equipmentKey=item_3143',relations=await get(relationRoute),items=Array.isArray(relations)?relations:relations.items;
assert.equal(items.length,2);assert.equal(new Set(items.map(x=>x.skillKey)).size,2);
for(const object of randuin)compare(items.find(x=>x.skillKey===object.skillKey),object.apiPayload.relation,object.skillKey);
checks.push({route:relationRoute,actual:relations,match:true});
assert.equal(checks.length,12);
fs.writeFileSync(new URL('页面验收.json',here),JSON.stringify({at:new Date().toISOString(),passed:true,independentGetCount:checks.length,
  urls:['http://127.0.0.1:5173/#/skills','http://127.0.0.1:5173/#/equipment'],
  method:'主负责人实际浏览器查看三个代表对象，等待详情加载后核对；没有页面写入，另做固定12项独立GET。',
  samples:[{skillKey:'item_4629_passive',observation:'咒舞持续时间引用4000毫秒参数，来源实例单层、刷新全部、整体到期；结果为自身移动速度增加、属性固定加算、持续生效、施加时留存，引用20点参数。合法伤害触发另待配。'},
    {skillKey:'item_3082_passive',observation:'攻击格挡上限伤害参数明确为小数、计算时传入，说明伤害基数阶段未定且不能缺省0；公式页面显示取较小值(固定格挡量,上限比例×输入)，对应MIN(15,0.2D)。'},
    {equipmentKey:'item_3143',observation:'关联技能页面加载完成后有复原力被动、谦卑主动两行，稳定键各异，启用，排序分别10与20。'}],
  experience:'技能图标及装备关联刚打开曾短暂显示未上传或暂无；加载完成后图标和两项关联均出现，未把占位内容当作持久缺项。',
  checks,runtimeValidation:'未执行'},null,2)+'\n');
console.log(JSON.stringify({independentGet:checks.length,passed:true}));
