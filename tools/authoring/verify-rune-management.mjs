import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8080/api/admin/games/lol';
const prefix='verify_rune_20260909';
const a=prefix+'_a',b=prefix+'_b',s=prefix+'_shard',p=prefix+'_path',q=prefix+'_shards',bad=prefix+'_bad',skill=prefix+'_skill';
const fixtureDescription='符文管理真实接口临时验收，由本脚本创建并清理。';
const owned=new Map();
const history=[];
const checks=[];
const output=path.resolve('output/rune-management');fs.mkdirSync(output,{recursive:true});
const run=new Date().toISOString().replaceAll(':','-');
const file=path.join(output,'http-'+run+'.json');
const apply=process.argv.includes('--run-fixtures');
assert.ok(process.argv.slice(2).every(x=>x==='--run-fixtures'));
const targetRoutes=[`/runes/${a}`,`/runes/${b}`,`/runes/${s}`,`/rune-paths/${p}`,`/rune-paths/${q}`,`/rune-paths/${bad}`,`/skills/${skill}`];
function persist(status) {fs.writeFileSync(file,JSON.stringify({run,status,apply,checks,history,owned:[...owned.keys()]},null,2)+'\n');}
async function request(route,method='GET',body) {
  assert.ok(route.startsWith('/'));assert.ok(method==='GET'||apply,'默认只读');
  if(method!=='GET') assert.ok(targetRoutes.includes(route)||['/runes','/rune-paths','/skills','/rune-skill-relations',`/rune-skill-relations/${a}/${skill}`].includes(route),'超出临时验收范围');
  const response=await fetch(base+route,{method,headers:{Authorization:'Bearer local-entry',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const text=await response.text();const data=text?JSON.parse(text):null;
  const item={route,method,status:response.status,...(body?{body}:{}),data};history.push(item);persist('running');return item;
}
function match(actual,expected) {for(const[k,v]of Object.entries(expected))assert.deepEqual(actual[k],v,k);}
async function get(route,expected) {const result=await request(route);assert.equal(result.status,200,route);if(expected)match(result.data,expected);return result.data;}
async function create(collection,key,body) {
  const route=`${collection}/${key}`;assert.equal((await request(route)).status,404);
  let result,error;try{result=await request(collection,'POST',body);}catch(cause){error=cause;}
  const actual=await request(route);
  if(actual.status===200) {match(actual.data,body);owned.set(route,body);persist('running');}
  assert.equal(actual.status,200,route);if(error)checks.push({name:'不明POST经独立GET确认',route,passed:true});else assert.equal(result.status,201,route);
  return actual.data;
}
async function denied(route,method,body,status,code,unchanged) {
  const r=await request(route,method,body);assert.equal(r.status,status,route);assert.equal(r.data.error.code,code,route);
  if(unchanged)assert.deepEqual(await get(route),unchanged);
  checks.push({name:code,route,passed:true});
}
async function removeOwned(route) {
  const expected=owned.get(route);if(!expected)return;
  const current=await get(route);assert.equal(current.name,expected.name);assert.equal(current.description,fixtureDescription);
  assert.equal((await request(route,'DELETE')).status,204,route);assert.equal((await request(route)).status,404,route);owned.delete(route);persist('running');
}
let failure;
try {
  for(const route of targetRoutes)assert.equal((await request(route)).status,404,`${route}已有数据，不接管或清理`);
  if(apply) {
    for(const[key,name,category]of [[a,'临时核对基石甲','KEYSTONE'],[b,'临时核对基石乙','KEYSTONE'],[s,'临时核对属性碎片','SHARD']])
      await create('/runes',key,{runeKey:key,name:name+'20260909',description:fixtureDescription,category});
    const pathBody={pathKey:p,name:'临时核对符文系20260909',description:fixtureDescription,kind:'RUNE_PATH',sortOrder:99,slots:[{name:'基石',category:'KEYSTONE',runeKeys:[a,b]}]};
    await create('/rune-paths',p,pathBody);
    const {pathKey:_,...reordered}=pathBody;reordered.slots=[{name:'基石',category:'KEYSTONE',runeKeys:[b,a]}];
    assert.equal((await request(`/rune-paths/${p}`,'PUT',reordered)).status,200);
    const savedPath=await get(`/rune-paths/${p}`,reordered);checks.push({name:'替换布局排除自身旧位置并保持顺序',passed:true});
    await denied('/rune-paths','POST',{...pathBody,pathKey:bad,name:'临时重复位置20260909'},400,'400.INVALID_RUNE_PATH_REQUEST');
    assert.equal((await request(`/rune-paths/${bad}`)).status,404);
    await denied('/rune-paths','POST',{...pathBody,pathKey:bad,name:'临时碎片重复20260909',kind:'SHARD_GROUP',slots:[{name:'重复',category:'SHARD',runeKeys:[s,s]}]},400,'400.INVALID_RUNE_PATH_REQUEST');
    assert.equal((await request(`/rune-paths/${bad}`)).status,404);
    await create('/rune-paths',q,{pathKey:q,name:'临时核对碎片组20260909',description:fixtureDescription,kind:'SHARD_GROUP',sortOrder:99,slots:[{name:'进攻',category:'SHARD',runeKeys:[s]},{name:'灵活',category:'SHARD',runeKeys:[s]}]});
    checks.push({name:'同一碎片跨行复用通过',passed:true});
    const runeA=await get(`/runes/${a}`);
    await denied(`/runes/${a}`,'PUT',{name:runeA.name,description:fixtureDescription,category:'MINOR'},409,'409.RUNE_IN_USE',runeA);
    await denied(`/runes/${a}`,'DELETE',undefined,409,'409.RUNE_IN_USE',runeA);
    await denied(`/rune-paths/${p}`,'PUT',{...reordered,kind:'SHARD_GROUP',slots:[]},409,'409.RUNE_PATH_IN_USE',savedPath);
    const skillBody={skillKey:skill,name:'临时符文挂载核对20260909',description:fixtureDescription,maxLevel:1,skillCategoryKeys:[],status:'ENABLED',sortOrder:99};
    await create('/skills',skill,skillBody);
    const relation={runeKey:a,skillKey:skill,sortOrder:10};
    assert.equal((await request('/rune-skill-relations','POST',relation)).status,201);
    const forward=await get(`/rune-skill-relations?runeKey=${a}`);assert.equal(forward.total,1);match(forward.items[0],relation);
    const {skillKey:__,...disabled}=skillBody;disabled.status='DISABLED';
    assert.equal((await request(`/skills/${skill}`,'PUT',disabled)).status,200);await get(`/skills/${skill}`,disabled);
    await denied('/rune-skill-relations','POST',{runeKey:b,skillKey:skill,sortOrder:10},409,'409.REFERENCE_DISABLED');
    assert.equal((await get(`/rune-skill-relations?runeKey=${b}`)).total,0);
    assert.equal((await request(`/rune-skill-relations/${a}/${skill}`,'PUT',{sortOrder:20})).status,200);
    const reverse=await get(`/rune-skill-relations?skillKey=${skill}`);assert.equal(reverse.total,1);match(reverse.items[0],{...relation,sortOrder:20,skillStatus:'DISABLED'});
    checks.push({name:'停用后既有挂载可调序和双向查看，新挂载拒绝',passed:true});
    await denied(`/skills/${skill}`,'DELETE',undefined,409,'409.SKILL_IN_USE');
    await removeOwned(`/rune-paths/${p}`);await get(`/runes/${a}`);
    await removeOwned(`/runes/${a}`);await get(`/skills/${skill}`);
    assert.equal((await get(`/rune-skill-relations?skillKey=${skill}`)).total,0);
    checks.push({name:'删除布局保留符文，删除符文仅清挂载并保留技能',passed:true});
  }
} catch(error) {failure=error;}
finally {
  if(apply)for(const route of [`/rune-paths/${p}`,`/rune-paths/${q}`,`/runes/${a}`,`/runes/${b}`,`/runes/${s}`,`/skills/${skill}`])
    try{await removeOwned(route);}catch(error){failure??=error;}
  persist(failure?'failed':'passed');
}
if(failure)throw failure;
console.log(JSON.stringify({passed:true,apply,checks:checks.length,httpCalls:history.length,remainingFixtures:owned.size,report:file}));
