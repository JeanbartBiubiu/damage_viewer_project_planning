import fs from 'node:fs';
import assert from 'node:assert/strict';
const load=file=>JSON.parse(fs.readFileSync(new URL(file,import.meta.url),'utf8'));
const rod=load('./录入候选.json').objects.find(x=>x.equipmentKey==='item_6657');
const apply=process.argv.includes('--apply-initialization');
assert.ok(process.argv.slice(2).every(x=>x==='--apply-initialization'));
const base='http://127.0.0.1:8080/api/admin/games/lol/skills/item_6657_passive';
const project=(a,e)=>e&&typeof e==='object'?Array.isArray(e)?a?.map((v,i)=>project(v,e[i])):Object.fromEntries(Object.keys(e).map(k=>[k,project(a?.[k],e[k])])):a;
async function request(route,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer local-entry','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});return {status:r.status,data:await r.json()};}
const report={at:new Date().toISOString(),processMethod:'真实页面新增并关闭重开',ruleMethod:apply?'接口补缺后独立GET':'独立GET',checks:[],arithmetic:[]};
for(const [route,expected] of [['/effects/timeless_growth',rod.effects[0]],['/processes/timeless_growth_process',rod.processes[0]],['/trigger-rules/initialize_timeless_growth',rod.triggerRules[0]]]){
  let result=await request(route);
  if(result.status===404&&route.startsWith('/trigger-rules/')&&apply){const created=await request('/trigger-rules',expected);assert.equal(created.status,201);result=await request(route);}
  assert.equal(result.status,200,route);assert.deepEqual(project(result.data,expected),expected,route);report.checks.push({route,expected,actual:result.data,matches:true});
}
const param=key=>rod.parameters.find(x=>x.parameterKey===key).fixedValue;
const max=param('timeless_growth_max_stacks'),interval=param('timeless_growth_interval_ms');
for(const [time,expectedStacks] of [[0,0],[59999,0],[60000,1],[540000,9],[600000,10],[660000,10],[1200000,10]]){
  const stacks=Math.min(Math.floor(time/interval),max);assert.equal(stacks,expectedStacks);
  report.arithmetic.push({timeMs:time,stacks,hp:stacks*param('timeless_hp_per_stack'),mana:stacks*param('timeless_mana_per_stack'),abilityPower:stacks*param('timeless_ap_per_stack')});
}
assert.deepEqual(report.arithmetic.at(-1),{timeMs:1200000,stacks:10,hp:100,mana:300,abilityPower:30});
report.passed=true;report.boundary='按已保存过程次数与叠层配置推导边界，并非实际战斗运行。';
fs.writeFileSync(new URL('./页面过程独立回读.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,checks:report.checks.length,arithmetic:report.arithmetic.length}));
