import fs from 'node:fs';
import assert from 'node:assert/strict';
const plan=JSON.parse(fs.readFileSync(new URL('./希维尔E页面试录.json',import.meta.url),'utf8'));
const base='http://127.0.0.1:8080/api/admin/games/lol/skills/sivir_e';
const apply=process.argv.includes('--apply-process');
assert.ok(process.argv.slice(2).every(x=>x==='--apply-process'));
const headers={Authorization:'Bearer local-entry','Content-Type':'application/json'};
async function request(route,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});return {status:r.status,data:await r.json()};}
const project=(a,e)=>e&&typeof e==='object'?Array.isArray(e)?a?.map((v,i)=>project(v,e[i])):Object.fromEntries(Object.keys(e).map(k=>[k,project(a?.[k],e[k])])):a;
const report={at:new Date().toISOString(),mode:apply?'只补施放过程，其余只读':'全部只读',records:[],missing:[],runtimeValidation:'未执行'};
for(const [property,route,key] of [['effects','effects','effectKey'],['processes','processes','processKey'],['triggerRules','trigger-rules','ruleKey']]){
 for(const expected of plan.parentOwns[property]){
  const endpoint='/'+route+'/'+expected[key];
  let actual=await request(endpoint);
  if(actual.status===404&&apply&&property==='processes'){
   const shield=await request('/effects/spell_shield');assert.equal(shield.status,200);assert.deepEqual(project(shield.data,plan.parentOwns.effects[0]),plan.parentOwns.effects[0]);
   const created=await request('/processes',expected);assert.equal(created.status,201);
   actual=await request(endpoint);
  }
  if(actual.status===404){report.missing.push(endpoint);continue;}
  assert.equal(actual.status,200);assert.deepEqual(project(actual.data,expected),expected,endpoint);
  report.records.push({endpoint,actual:actual.data,matches:true});
 }
}
report.passed=report.missing.length===0;
fs.writeFileSync(new URL('./希维尔E页面回读.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,verified:report.records.length,missing:report.missing}));
