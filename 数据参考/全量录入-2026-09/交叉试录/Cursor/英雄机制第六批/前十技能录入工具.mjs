import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {verify} from './候选独立核算.mjs';
export const kinds=[['parameters','parameterKey','parameters'],['formulas','formulaKey','formulas'],['effects','effectKey','effects'],['processes','processKey','processes'],['internalStates','stateKey','internal-states'],['triggerRules','ruleKey','trigger-rules']];
export const here=new URL('./',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const identityFields=new Set(['gameId','skillKey','createdAt','updatedAt']);
const arrayKeys={results:'resultKey',steps:'stepKey',effectBindings:'bindingKey',stateOperations:'operationKey',conditionGroups:'groupKey',conditions:'conditionKey',actions:'actionKey'};
export async function loadPlan(){const bytes=await readFile(new URL('前十技能候选.json',here));if(sha(bytes)!=='b9032a146bd279d4b41d73aa501cc34b6ef8ed34951de19d058bcd8aeac91222')throw Error('未通过审查的候选摘要');const plan=JSON.parse(bytes);const expected=['garen','jax'].flatMap(h=>['p','q','w','e','r'].map(s=>h+'_'+s));if(plan.meta.gameId!=='lol'||!isDeepStrictEqual(Object.keys(plan.skills).sort(),expected.sort()))throw Error('候选必须为已授权盖伦与贾克斯10技能');for(const s of Object.values(plan.skills))for(const[kind,id]of kinds){const items=s.write[kind];if(!Array.isArray(items)||items.some(v=>typeof v[id]!=='string')||new Set(items.map(v=>v[id])).size!==items.length)throw Error('候选组成键不合法 '+s.skillKey+'/'+kind);}return {plan,planSha256:sha(bytes),bytes};}
export async function assertPlanUnchanged(expected){if(sha(await readFile(new URL('前十技能候选.json',here)))!==expected)throw Error('当前候选已改变，停止本次执行，需重新全量预检');}
export async function verifySources(plan){
 const evidence=JSON.parse(await readFile(new URL('根绑定与数值证据.json',here),'utf8')),supplement=JSON.parse(await readFile(new URL('补充文本证据.json',here),'utf8')),base='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录',checks=[];
 for(const h of evidence.heroes.filter(h=>h.spells.some(s=>plan.skills[s.skillKey]))){const raw=gunzipSync(await readFile(path.join(base,h.client.path))),officialRaw=await readFile(path.resolve(base,h.official.path));for(const[kind,bytes,expected]of [['client',raw,h.client.sha256],['official',officialRaw,h.official.sha256]]){const actual=sha(bytes);if(actual!==expected)throw Error('冻结摘要不同 '+h.id+'/'+kind);checks.push({hero:h.id,kind,sha256:actual});}const client=JSON.parse(raw),official=JSON.parse(officialRaw).data[h.id],root=client[h.rootPath];for(const s of h.spells){const slot=s.slot.toUpperCase(),i=['Q','W','E','R'].indexOf(slot),binding=slot==='P'?root.mCharacterPassiveSpell:root.spells[i],rawOfficial=slot==='P'?official.passive:official.spells[i];if(binding!==s.binding||!isDeepStrictEqual(client[binding],s.object)||!isDeepStrictEqual(rawOfficial,s.official))throw Error('当前根绑定冻结内容不同 '+s.skillKey);const p=plan.skills[s.skillKey];if(!p||p.source.spellPath!==binding||p.source.clientSha256!==h.client.sha256||p.source.officialSha256!==h.official.sha256)throw Error('候选来源不符 '+s.skillKey);}}
 const locRaw=gunzipSync(await readFile(supplement.path));if(sha(locRaw)!==supplement.sha256)throw Error('当前绑定文本摘要不同');const loc=JSON.parse(locRaw),entries=loc.entries??loc;for(const [skill,record]of Object.entries(supplement.skills)){if(!plan.skills[skill])continue;if(!isDeepStrictEqual(plan.skills[skill].source.currentBoundText,record))throw Error('候选当前文本不同 '+skill);for(const v of Object.values(record.keys))if(v.key!==null&&entries[v.key]!==v.text)throw Error('当前绑定文本内容不同 '+skill);}checks.push({kind:'当前绑定文本',sha256:sha(locRaw)});return checks;
}
export async function request(route,{method='GET',body}={}){
 if(method!=='GET'&&!process.argv.includes('--apply'))throw Error('默认只读');if(!['GET','POST'].includes(method)||!route.startsWith('/'))throw Error('不允许的接口操作');
 if(method==='POST'&&!/^\/skills\/(jax)_[pqwer]\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/.test(route))throw Error('不在本次授权贾克斯五技能创建范围');
 const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{method,headers:{Authorization:'Bearer local-entry',Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const raw=await response.text();let data=null;try{data=raw?JSON.parse(raw):null;}catch{throw Error('接口不是JSON '+route+' HTTP '+response.status);}return {ok:response.ok,status:response.status,data};
}
function normalize(n,key='',root=false){if(Array.isArray(n)){const values=n.map(v=>normalize(v));const id=arrayKeys[key];if(id&&values.every(v=>v&&typeof v[id]==='string'))values.sort((a,b)=>(a.sortOrder??0)-(b.sortOrder??0)||a[id].localeCompare(b[id]));return values;}if(n&&typeof n==='object'){const result=Object.fromEntries(Object.entries(n).filter(([k])=>!root||!identityFields.has(k)).map(([k,v])=>[k,normalize(v,k)]));if(['SKILL_HIT','SKILL_USED'].includes(result.eventType)&&result.detail&&!('useKind'in result.detail))result.detail.useKind=null;return result;}return n;}
export function business(n){return normalize(n,'',true);}
export function diff(expected,actual,p=''){
 if(expected===actual)return null;if(expected===null||actual===null||typeof expected!=='object'||typeof actual!=='object')return {path:p,expected,actual};
 if(Array.isArray(expected)||Array.isArray(actual)){if(!Array.isArray(expected)||!Array.isArray(actual)||expected.length!==actual.length)return {path:p,expected,actual};for(let i=0;i<expected.length;i++){const d=diff(expected[i],actual[i],p+'['+i+']');if(d)return d;}return null;}
 const keys=[...new Set([...Object.keys(expected),...Object.keys(actual)])].sort();for(const k of keys){if(!(k in expected)||!(k in actual))return {path:p?`${p}.${k}`:k,expectedPresent:k in expected,actualPresent:k in actual};const d=diff(expected[k],actual[k],p?`${p}.${k}`:k);if(d)return d;}return null;
}
export function compareComponent(skill,idField,id,expected,actual){if(actual?.[idField]!==id||actual?.gameId!=null&&actual.gameId!=='lol'||actual?.skillKey!=null&&actual.skillKey!==skill)return {identityMismatch:true};return diff(business(expected),business(actual));}
export async function fullSnapshot(plan,{requestFn=request}={}){
 const out={startedAt:new Date().toISOString(),subjects:[],lists:[],readbacks:[],missing:[],conflicts:[],skills:{},totals:Object.fromEntries(kinds.map(([k])=>[k,0]))};
 const baseline=JSON.parse(await readFile(new URL('前十技能只读前检.json',here),'utf8')),original=JSON.parse(await readFile(new URL('写前现值.json',here),'utf8'));out.images=[];out.relations=[];
 for(const old of baseline.relations){const current=await requestFn(old.route);out.relations.push({route:old.route,...current});if(!current.ok||!isDeepStrictEqual(current.data,old.data))out.conflicts.push({route:old.route,relationshipChanged:true});}
 for(const old of baseline.images){const current=await requestFn(old.route);out.images.push({route:old.route,...current});if(!current.ok||!isDeepStrictEqual(current.data,old.data))out.conflicts.push({route:old.route,imageChanged:true});}
 for(const s of Object.values(plan.skills)){
  const subject=await requestFn('/skills/'+s.skillKey);out.subjects.push({skillKey:s.skillKey,...subject});if(!subject.ok||subject.data?.skillKey!==s.skillKey||subject.data?.gameId!=='lol'||subject.data?.maxLevel!==s.maxLevel)out.conflicts.push({skillKey:s.skillKey,subjectMismatch:true});
  if(!isDeepStrictEqual(subject.data,original.skills[s.skillKey].skill))out.conflicts.push({skillKey:s.skillKey,subjectMetadataChanged:true});
  out.skills[s.skillKey]={};
  for(const[kind,idField,apiKind]of kinds){const base='/skills/'+s.skillKey+'/'+apiKind,list=await requestFn(base);if(!list.ok||!Array.isArray(list.data))throw Error('组成列表读取失败 '+base+' HTTP '+list.status);const ids=list.data.map(v=>v[idField]);if(ids.some(v=>typeof v!=='string')||new Set(ids).size!==ids.length)throw Error('组成列表键不合法 '+base);out.lists.push({skillKey:s.skillKey,kind,status:list.status,items:list.data});out.skills[s.skillKey][kind]=[];out.totals[kind]+=ids.length;
   for(const id of ids){const r=await requestFn(base+'/'+encodeURIComponent(id));if(!r.ok)throw Error('组成详情读取失败 '+base+'/'+id);const expected=s.write[kind].find(v=>v[idField]===id),mismatch=expected?compareComponent(s.skillKey,idField,id,expected,r.data):{unexpectedExisting:true};out.skills[s.skillKey][kind].push(r.data);out.readbacks.push({skillKey:s.skillKey,kind,id,status:r.status,match:!mismatch,diff:mismatch,actual:r.data});if(mismatch)out.conflicts.push({skillKey:s.skillKey,kind,id,diff:mismatch});}
   for(const body of s.write[kind])if(!ids.includes(body[idField]))out.missing.push({skillKey:s.skillKey,kind,idField,id:body[idField],base,route:base+'/'+encodeURIComponent(body[idField]),body});
  }
 }
 out.finishedAt=new Date().toISOString();return out;
}
export async function checkCatalogs(plan,{requestFn=request}={}){
 const catalogs={},failures=[];for(const[name,id]of [['attributes','attributeKey'],['modifier-zones','modifierZoneKey'],['damage-types','damageTypeKey'],['statuses','statusKey']]){const r=await requestFn('/'+name),items=Array.isArray(r.data)?r.data:r.data?.items;if(!r.ok||!Array.isArray(items)||r.data.total!=null&&r.data.total!==items.length)throw Error('目录未完整 '+name);catalogs[name]={status:r.status,items,id};}
 for(const s of Object.values(plan.skills)){function walk(n){if(!n||typeof n!=='object')return;for(const [k,v]of Object.entries(n)){const found=Object.values(catalogs).find(c=>c.id===k);if(found&&v!==null&&typeof v==='string'&&!found.items.some(i=>i[k]===v&&i.status==='ENABLED'))failures.push({skill:s.skillKey,key:k,value:v});if(v&&typeof v==='object')walk(v);}}walk(s.write);}return {catalogs,failures};
}
export async function createMissing(plan,snapshot,{requestFn=request,assertFrozen=async()=>{},journal=async()=>{}}={}){
 if(snapshot.conflicts.length)throw Error('完整预检存在冲突，禁止创建');const events=[],failedSkills=[];
 const emit=async event=>{const record={at:new Date().toISOString(),...event};events.push(record);await journal(record);};
 for(const x of snapshot.missing){if(failedSkills.includes(x.skillKey)){await emit({skillKey:x.skillKey,kind:x.kind,id:x.id,action:'当前技能先前异常，跳过后续依赖'});continue;}await assertFrozen();const before=await requestFn(x.route);if(before.status!==404){const mismatch=before.ok?compareComponent(x.skillKey,x.idField,x.id,x.body,before.data):{status:before.status};if(mismatch){await emit({skillKey:x.skillKey,kind:x.kind,id:x.id,action:'停止：写前同键变化',diff:mismatch});throw Error('写前同键发生变化，保持现值 '+x.route);}await emit({skillKey:x.skillKey,kind:x.kind,id:x.id,action:'并发同值，跳过',actual:before.data});continue;}
  await assertFrozen();await emit({skillKey:x.skillKey,kind:x.kind,id:x.id,action:'准备创建',body:x.body});
  let saved=null,postError=null;try{saved=await requestFn(x.base,{method:'POST',body:x.body});}catch(e){postError=String(e);}
  // 无论POST成功、报错或超时，都独立GET确认落地；不自动重放POST。
  let got=null,getError=null;try{got=await requestFn(x.route);}catch(e){getError=String(e);}
  const mismatch=got?.ok?compareComponent(x.skillKey,x.idField,x.id,x.body,got.data):{status:got?.status??null,error:getError};
  await emit({skillKey:x.skillKey,kind:x.kind,id:x.id,action:saved?.ok?'创建后独立回读':'创建响应异常后查询落地',postStatus:saved?.status??null,postError,postResponse:saved?.data??null,readbackStatus:got?.status??null,readbackError:getError,match:!mismatch,diff:mismatch,actual:got?.data??null});
  if(mismatch)failedSkills.push(x.skillKey);
 }
 return {events,failedSkills};
}
export function verifySaved(plan,snapshot){const copied=structuredClone(plan);for(const s of Object.values(copied.skills))for(const[kind]of kinds)s.write[kind]=snapshot.skills[s.skillKey][kind];if(snapshot.missing.length||snapshot.conflicts.length)return {arithmetic:[],invariants:[],skippedReason:'存在缺项或冲突，不以候选表达式代替尚未保存的数据核算。',failures:[...snapshot.conflicts,...snapshot.missing.map(x=>({skillKey:x.skillKey,kind:x.kind,id:x.id,missing:true}))]};const checks=verify(copied);return {...checks,failures:[...checks.arithmetic,...checks.invariants].filter(x=>!x.match)};}
