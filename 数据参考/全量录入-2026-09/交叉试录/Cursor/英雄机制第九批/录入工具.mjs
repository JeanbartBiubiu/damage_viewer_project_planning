import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
// 主负责人批准的第九批唯一冻结集合；POST只允许这三类缺失组成。
export const approvedParts=[{file:'完整候选.json',sha256:'d4856e5e8914e8a02c8d02a264c1e84acc84171d8733f434db345ef69b28bc0e'}];
export const approvedObjectSha256='b1a85cc47aaf05370d09d92d646a746d4b9bf75d103310657daf36687e5e9fd9';
export const kinds=[['parameters','parameterKey','parameters'],['formulas','formulaKey','formulas'],['effects','effectKey','effects'],['processes','processKey','processes'],['internalStates','stateKey','internal-states'],['triggerRules','ruleKey','trigger-rules']];
export const here=new URL('./',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const identityFields=new Set(['gameId','skillKey','createdAt','updatedAt']);
const arrayKeys={results:'resultKey',steps:'stepKey',effectBindings:'bindingKey',stateOperations:'operationKey',conditionGroups:'groupKey',conditions:'conditionKey',actions:'actionKey'};
const protectedOriginal=JSON.parse(await readFile(new URL('写前现值.json',here),'utf8'));
export async function loadPlan(){
 const bytes=await readFile(new URL(approvedParts[0].file,here));if(sha(bytes)!==approvedParts[0].sha256)throw Error('冻结候选文件摘要变化');
 const plan=JSON.parse(bytes);if(sha(JSON.stringify(plan))!==approvedObjectSha256)throw Error('冻结计划对象摘要变化');
 const expected=['masteryi','trundle','pantheon','talon'].flatMap(h=>['p','q','w','e','r'].map(s=>h+'_'+s));if(!isDeepStrictEqual(Object.keys(plan.skills),expected))throw Error('本批20槽不符');
 for(const s of Object.values(plan.skills))for(const[kind,id]of kinds){const a=s.write[kind];if(!Array.isArray(a)||new Set(a.map(x=>x[id])).size!==a.length)throw Error('组成键不符');}
 assertExpressionNodes(plan);return {plan,planSha256:sha(bytes),bytes};
}
export function assertExpressionNodes(plan){for(const s of Object.values(plan.skills))for(const f of s.write.formulas){function visit(n){if(!n||!['OPERATION','PARAMETER','ATTRIBUTE'].includes(n.nodeType)||'kind'in n)throw Error('公式表达式不能使用普通数值引用 '+s.skillKey+'/'+f.formulaKey);if(n.nodeType==='OPERATION'){if(!Array.isArray(n.operands)||n.operands.length!==2)throw Error('运算节点需要两个操作数');n.operands.forEach(visit);}}visit(f.expression);}}
export const approvedPlanSha256=(await loadPlan()).planSha256;
export async function assertPlanUnchanged(expected){const current=await loadPlan();if(current.planSha256!==expected)throw Error('当前候选已改变，停止本次执行，需重新全量预检');}
export async function verifySources(plan){
 const evidence=JSON.parse(await readFile(new URL('根绑定与数值证据.json',here),'utf8')),supplement=JSON.parse(await readFile(new URL('补充文本证据.json',here),'utf8')),base='C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/技能公共参数实录',checks=[];
 for(const h of evidence.heroes.filter(h=>h.spells.some(s=>plan.skills[s.skillKey]))){const raw=gunzipSync(await readFile(path.join(base,h.client.path))),officialRaw=await readFile(path.resolve(base,h.official.path));for(const[kind,bytes,expected]of [['client',raw,h.client.sha256],['official',officialRaw,h.official.sha256]]){const actual=sha(bytes);if(actual!==expected)throw Error('冻结摘要不同 '+h.id+'/'+kind);checks.push({hero:h.id,kind,sha256:actual});}const client=JSON.parse(raw),official=JSON.parse(officialRaw).data[h.id],root=client[h.rootPath];for(const s of h.spells){const slot=s.slot.toUpperCase(),i=['Q','W','E','R'].indexOf(slot),binding=slot==='P'?root.mCharacterPassiveSpell:root.spells[i],rawOfficial=slot==='P'?official.passive:official.spells[i];if(binding!==s.binding||!isDeepStrictEqual(client[binding],s.object)||!isDeepStrictEqual(rawOfficial,s.official))throw Error('当前根绑定冻结内容不同 '+s.skillKey);const p=plan.skills[s.skillKey];if(!p||p.source.spellPath!==binding||p.source.clientSha256!==h.client.sha256||p.source.officialSha256!==h.official.sha256)throw Error('候选来源不符 '+s.skillKey);}}
 const locRaw=gunzipSync(await readFile(supplement.path));if(sha(locRaw)!==supplement.sha256)throw Error('当前绑定文本摘要不同');const loc=JSON.parse(locRaw),entries=loc.entries??loc;for(const [skill,record]of Object.entries(supplement.skills)){if(!plan.skills[skill])continue;if(!isDeepStrictEqual(plan.skills[skill].source.currentBoundText,record))throw Error('候选当前文本不同 '+skill);for(const v of Object.values(record.keys))if(v.key!==null&&entries[v.key]!==v.text)throw Error('当前绑定文本内容不同 '+skill);}checks.push({kind:'当前绑定文本',sha256:sha(locRaw)});return checks;
}
export async function request(route,{method='GET',body}={}){
 if(method!=='GET'&&!process.argv.includes('--apply'))throw Error('默认只读');if(!['GET','POST'].includes(method)||!route.startsWith('/'))throw Error('不允许的接口操作');
 if(method==='POST'){if(!approvedPlanSha256)throw Error('完整集合尚未获根任务写入授权');await assertPlanUnchanged(approvedPlanSha256);if(!/^\/skills\/(masteryi|pantheon|talon)_[pqwer]\/(parameters|formulas|effects)$/.test(route))throw Error('不在批准的三英雄三类组成创建范围');const match=route.match(/^\/skills\/([^/]+)\/([^/]+)$/),entry=kinds.find(x=>x[2]===match[2]),approved=(await loadPlan()).plan.skills[match[1]].write[entry[0]].find(x=>x[entry[1]]===body?.[entry[1]]);if(!approved||!isDeepStrictEqual(approved,body))throw Error('POST请求不等于已批准精确对象');if(protectedOriginal.skills[match[1]].components[entry[0]].details.some(x=>x.key===body[entry[1]]))throw Error('禁止创建任何原已存在组成');}
 if(!process.env.HERO9_API_TOKEN)throw Error('缺少进程鉴权配置');
 const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{method,headers:{Authorization:'Bearer '+process.env.HERO9_API_TOKEN,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
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
export async function protectBaseline(plan,{requestFn=request}={}){
 const file=new URL('实录保护基线.json',here);try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(process.argv.includes('--apply'))throw Error('必须先完成默认只读计划保存主体关系与图片基线');
 const baseline={at:new Date().toISOString(),candidateParts:approvedParts,relations:[],images:[],boundary:'只读捕获；仅保护主体关联与代表图，不写任何关系和图片。'};
 for(const hero of ['masteryi','trundle','pantheon','talon']){const route='/character-skill-relations?characterKey=champion_'+hero,r=await requestFn(route);if(!r.ok||!Array.isArray(r.data?.items??r.data))throw Error('角色关联基线失败 '+route);baseline.relations.push({route,...r});}
 for(const skillKey of Object.keys(plan.skills)){const route='/skills/'+skillKey+'/representative-image',r=await requestFn(route);if(!r.ok)throw Error('代表图基线失败 '+route);baseline.images.push({route,...r});}
 await writeFile(file,JSON.stringify(baseline,null,2)+'\n',{flag:'wx'});return baseline;
}
export async function fullSnapshot(plan,{requestFn=request}={}){
 const out={startedAt:new Date().toISOString(),subjects:[],lists:[],readbacks:[],missing:[],conflicts:[],skills:{},totals:Object.fromEntries(kinds.map(([k])=>[k,0]))};
 const baseline=await protectBaseline(plan,{requestFn}),original=JSON.parse(await readFile(new URL('写前现值.json',here),'utf8'));out.images=[];out.relations=[];
 for(const old of baseline.relations){const current=await requestFn(old.route);out.relations.push({route:old.route,...current});if(!current.ok||!isDeepStrictEqual(current.data,old.data))out.conflicts.push({route:old.route,relationshipChanged:true});}
 for(const old of baseline.images){const current=await requestFn(old.route);out.images.push({route:old.route,...current});if(!current.ok||!isDeepStrictEqual(current.data,old.data))out.conflicts.push({route:old.route,imageChanged:true});}
 for(const s of Object.values(plan.skills)){
  const subject=await requestFn('/skills/'+s.skillKey);out.subjects.push({skillKey:s.skillKey,...subject});if(!subject.ok||subject.data?.skillKey!==s.skillKey||subject.data?.gameId!=='lol'||subject.data?.maxLevel!==s.maxLevel)out.conflicts.push({skillKey:s.skillKey,subjectMismatch:true});
  if(!isDeepStrictEqual(subject.data,original.skills[s.skillKey].subject.data))out.conflicts.push({skillKey:s.skillKey,subjectMetadataChanged:true});
  out.skills[s.skillKey]={};
  for(const[kind,idField,apiKind]of kinds){const base='/skills/'+s.skillKey+'/'+apiKind,list=await requestFn(base);if(!list.ok||!Array.isArray(list.data))throw Error('组成列表读取失败 '+base+' HTTP '+list.status);const ids=list.data.map(v=>v[idField]);if(ids.some(v=>typeof v!=='string')||new Set(ids).size!==ids.length)throw Error('组成列表键不合法 '+base);out.lists.push({skillKey:s.skillKey,kind,status:list.status,items:list.data});out.skills[s.skillKey][kind]=[];out.totals[kind]+=ids.length;
   for(const id of ids){const r=await requestFn(base+'/'+encodeURIComponent(id));if(!r.ok)throw Error('组成详情读取失败 '+base+'/'+id);const expected=s.write[kind].find(v=>v[idField]===id),protectedEntry=original.skills[s.skillKey].components[kind].details.find(x=>x.key===id)?.detail.data;let mismatch=expected?compareComponent(s.skillKey,idField,id,expected,r.data):{unexpectedExisting:true};if(protectedEntry){const numericFields=['valueType','valueMode','fixedValue','levelValues'];if(kind==='parameters'&&expected&&!numericFields.every(k=>isDeepStrictEqual(expected[k],protectedEntry[k])))mismatch={protectedParameterNumericDifference:true};else mismatch=isDeepStrictEqual(protectedEntry,r.data)?null:{protectedOriginalChanged:true};}out.skills[s.skillKey][kind].push(r.data);out.readbacks.push({skillKey:s.skillKey,kind,id,status:r.status,match:!mismatch,diff:mismatch,actual:r.data});if(mismatch)out.conflicts.push({skillKey:s.skillKey,kind,id,diff:mismatch});}
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
 for(const x of snapshot.missing){if(failedSkills.includes(x.skillKey)){await emit({skillKey:x.skillKey,kind:x.kind,id:x.id,action:'当前技能先前异常，跳过后续依赖'});continue;}await assertFrozen();const before=await requestFn(x.route);if(before.status!==404){const mismatch=before.ok?compareComponent(x.skillKey,x.idField,x.id,x.body,before.data):{status:before.status};if(mismatch){await emit({skillKey:x.skillKey,kind:x.kind,id:x.id,action:'暂停当前技能：写前同键变化，保持现值',diff:mismatch,actual:before.data});failedSkills.push(x.skillKey);continue;}await emit({skillKey:x.skillKey,kind:x.kind,id:x.id,action:'并发同值，跳过',actual:before.data});continue;}
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
export async function independentArithmetic(plan,outputDir,{saved=false}={}){
 await mkdir(outputDir,{recursive:true});const input=new URL('核算输入.json',outputDir),output=new URL('独立核算.json',outputDir);await writeFile(input,JSON.stringify(plan,null,2)+'\n');
 await promisify(execFile)(process.execPath,[fileURLToPath(new URL('完整独立核算.mjs',here))],{env:{...process.env,HERO9_CANDIDATE_PATH:fileURLToPath(input),HERO9_CHECK_OUTPUT_PATH:fileURLToPath(output)},windowsHide:true});
 const report=JSON.parse(await readFile(output,'utf8'));return {boundary:saved?'采用本次独立GET实际参数和表达式；未证明战斗运行':'候选静态算术',reports:[report],arithmetic:report.formulaRuns.flatMap(x=>x.runs.map(v=>({...v,skillKey:x.skillKey}))),invariants:report.checks,failures:report.errors};
}
export async function verifySaved(plan,snapshot,outputDir){if(snapshot.missing.length||snapshot.conflicts.length)return {arithmetic:[],invariants:[],fields:0,skippedReason:'存在缺项或冲突，不以候选替代实库核算。',failures:[...snapshot.conflicts,...snapshot.missing.map(x=>({skillKey:x.skillKey,kind:x.kind,id:x.id,missing:true}))]};const copied=structuredClone(plan);let fields=0;function count(v){if(v&&typeof v==='object')return Object.values(v).reduce((n,x)=>n+count(x),0);return 1;}for(const s of Object.values(copied.skills))for(const[kind]of kinds){s.write[kind]=snapshot.skills[s.skillKey][kind].map(business);fields+=s.write[kind].reduce((n,x)=>n+count(x),0);}assertExpressionNodes(copied);return {...await independentArithmetic(copied,outputDir,{saved:true}),fields};}
