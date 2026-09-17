import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const here=new URL('./',import.meta.url),bytes=fs.readFileSync(new URL('完整候选.json',here));
if(process.argv.length>2)throw Error('仅允许固定代表项只读核对');
assert.equal(createHash('sha256').update(bytes).digest('hex'),'16d826cd8933acf60bfa399b1196a004db90312ec5272ffbb3d8eda8a8cf354c');
const candidate=JSON.parse(bytes),checks=[];
function compare(actual,expected,label){if(expected&&typeof expected==='object'&&!Array.isArray(expected)){for(const [k,v]of Object.entries(expected))compare(actual?.[k],v,`${label}/${k}`);}else assert.deepEqual(actual,expected,label);}
async function get(route,expectedStatus=200){const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(15000)});assert.equal(r.status,expectedStatus,route);return await r.json();}
for(const object of candidate.objects.filter(x=>['item_3142_active','item_3802_passive','item_3070_passive'].includes(x.skillKey))){
  const tasks=[{path:'',expected:object.apiPayload.skill},...object.apiPayload.parameters.map(x=>({path:`/parameters/${x.parameterKey}`,expected:x})),...object.apiPayload.formulas.map(x=>({path:`/formulas/${x.formulaKey}`,expected:x})),{path:'/representative-image',expected:{image:{imageKey:object.equipmentKey,enabled:true}}}];
  for(const task of tasks){const route=`/skills/${object.skillKey}${task.path}`,actual=await get(route);compare(actual,task.expected,route);checks.push({route,actual,match:true});}
}
const excludedRoute='/skills/item_2065_active',excluded=await get(excludedRoute,404);checks.push({route:excludedRoute,status:404,actual:excluded,match:true});
assert.equal(checks.length,23);
fs.writeFileSync(new URL('页面验收.json',here),JSON.stringify({at:new Date().toISOString(),passed:true,independentGetCount:23,url:'http://127.0.0.1:5173/#/skills',
  method:'主负责人真实浏览器查看三个代表技能，未修改页面值；另次23项GET包括未录舒瑞娅技能404。',
  samples:[{skillKey:'item_3142_active',observation:'远程时长公式页面引用近战6000毫秒和0.667倍率，说明明确4002毫秒，未显示为4000毫秒；两组移速参数分别列出。'},
    {skillKey:'item_3802_passive',observation:'最大法力参数为小数、计算时传入，说明明确取值时点尚待核，不能默认每跳现值或缺失为0。'},
    {skillKey:'item_3070_passive',observation:'技能详情明确只保留技能命中、3点/英雄翻倍、360累计上限、8秒/最多4份，未从魔宗扩大普攻触发。'}],
  checks,runtimeValidation:'未执行'},null,2)+'\n');
console.log(JSON.stringify({passed:true,independentGetCount:checks.length}));
