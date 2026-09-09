import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const here=new URL('./',import.meta.url);
export const candidateFileSha256='c08257b3fbd500d448b87d250e2a23c51d416a212e3d0398f29f9ce12b709cae';
export const candidateObjectSha256='55ba724ff495fc172debca3bbe3bb3257bd66b624dc135450a1debda3c8b8a6d';
// 主负责人在独立语义复核后明确放行本批213个缺失组成；仍须显式 --apply。
export const writeAuthorization='c08257b3fbd500d448b87d250e2a23c51d416a212e3d0398f29f9ce12b709cae';
export const kinds=[['parameters','parameterKey','parameters'],['formulas','formulaKey','formulas'],['effects','effectKey','effects'],['processes','processKey','processes'],['internalStates','stateKey','internal-states'],['triggerRules','ruleKey','trigger-rules']];
export const heroKeys=['graves','jinx','varus','kogmaw'];
const hash=x=>createHash('sha256').update(x).digest('hex');
const identityFields=new Set(['gameId','skillKey','createdAt','updatedAt']);
const keyedArrays={results:'resultKey',steps:'stepKey',effectBindings:'bindingKey',stateOperations:'operationKey',conditionGroups:'groupKey',conditions:'conditionKey',actions:'actionKey'};
const originalBytes=await readFile(new URL('写前现值.json',here));
if(hash(originalBytes)!=='c34a9ffb21b345e4f576c2183019fa391e19cb0ee3f1f8af44a0c24fc862163b')throw Error('原写前现值散列变化');
export const original=JSON.parse(originalBytes);

export async function loadPlan(){
 const bytes=await readFile(new URL('完整候选.json',here));if(hash(bytes)!==candidateFileSha256)throw Error('冻结候选文件散列变化');
 const plan=JSON.parse(bytes);if(hash(JSON.stringify(plan))!==candidateObjectSha256)throw Error('冻结候选对象散列变化');
 if(!equal(Object.keys(plan.skills),heroKeys.flatMap(h=>['p','q','w','e','r'].map(s=>h+'_'+s))))throw Error('必须精确覆盖本批20槽');
 for(const s of Object.values(plan.skills))for(const[kind,id]of kinds){const a=s.write[kind];if(!Array.isArray(a)||a.some(x=>typeof x[id]!=='string')||new Set(a.map(x=>x[id])).size!==a.length)throw Error('组成键不合法');}
 return {plan,bytes};
}
export async function appendDurable(file,value){const f=await open(file,'a');try{await f.writeFile(JSON.stringify(value)+'\n');await f.sync();}finally{await f.close();}}
export function business(value,key='',root=true){
 if(Array.isArray(value)){const a=value.map(x=>business(x,'',false)),id=keyedArrays[key];return id&&a.every(x=>typeof x?.[id]==='string')?a.toSorted((x,y)=>(x.sortOrder??0)-(y.sortOrder??0)||x[id].localeCompare(y[id])):a;}
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!root||!identityFields.has(k)).map(([k,v])=>[k,business(v,k,false)]));
 return value;
}
export function diff(expected,actual,path=''){
 if(equal(expected,actual))return null;if(expected===null||actual===null||typeof expected!=='object'||typeof actual!=='object')return {path,expected,actual};
 if(Array.isArray(expected)||Array.isArray(actual)){if(!Array.isArray(expected)||!Array.isArray(actual)||expected.length!==actual.length)return {path,expected,actual};for(let i=0;i<expected.length;i++){const d=diff(expected[i],actual[i],path+'['+i+']');if(d)return d;}return null;}
 for(const k of [...new Set([...Object.keys(expected),...Object.keys(actual)])].sort()){if(!(k in expected)||!(k in actual))return {path:path+'.'+k,expectedPresent:k in expected,actualPresent:k in actual};const d=diff(expected[k],actual[k],path+'.'+k);if(d)return d;}return null;
}
export function compareComponent(skill,kind,id,expected,actual){const idField=kinds.find(x=>x[0]===kind)[1];if(actual?.[idField]!==id||actual?.skillKey!==skill||actual?.gameId!=='lol')return {identityMismatch:true};return diff(business(expected),business(actual));}
export function compareListSummary(item,detail){for(const[key,value]of Object.entries(item)){const actual=key==='resultCount'?detail.results?.length:key==='lifecycleEnabled'?detail.lifecycle!==null&&detail.lifecycle!==undefined:detail[key];if(!equal(value,actual))return {key,expected:value,actual};}return null;}
export const rows=response=>Array.isArray(response.data)?response.data:response.data?.items;
function sameCollection(a,b){if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every(x=>b.some(y=>equal(x,y)));if(a&&b&&Array.isArray(a.items)&&Array.isArray(b.items))return equal({...a,items:null},{...b,items:null})&&sameCollection(a.items,b.items);return equal(a,b);}

export async function createRequester(runDir,{apply=false}={}){
 if(apply&&(writeAuthorization!==candidateFileSha256||!process.argv.includes('--apply')))throw Error('尚未得到本批实际写入放行');
 if(!process.env.HERO10_API_TOKEN)throw Error('缺少进程环境中的开发认证占位值');
 const calls=[];let seq=0;
 const request=async(route,{method='GET',body}={})=>{
  if(!['GET','POST'].includes(method)||!route.startsWith('/')||route.includes('://')||route.includes('..'))throw Error('不允许的接口操作');
  if(method==='POST'){
   if(!apply||writeAuthorization!==candidateFileSha256)throw Error('当前只读；无写入授权');
   const match=route.match(/^\/skills\/((?:graves|jinx|varus|kogmaw)_[pqwer])\/(parameters|formulas|effects)$/);if(!match)throw Error('超出本批三类组成范围');
   const {plan}=await loadPlan(),kind=kinds.find(x=>x[2]===match[2]),id=body?.[kind[1]],allowed=plan.skills[match[1]].write[kind[0]].find(x=>x[kind[1]]===id);
   if(!allowed||!equal(allowed,body))throw Error('请求不等于冻结精确对象');if(original.skills[match[1]].components[kind[0]].details.some(x=>x.key===id))throw Error('禁止写入原有组成');
   // 每个精确请求只能尝试一次。进程中断、超时或错误后必须先只读对账，禁止自动重放。
   const intents=new URL('写前意图/',here);await mkdir(intents,{recursive:true});const file=new URL(hash(candidateFileSha256+'\n'+route+'\n'+id)+'.json',intents);
   const intent=await open(file,'wx');try{await intent.writeFile(JSON.stringify({at:new Date().toISOString(),candidateFileSha256,route,method,body},null,2)+'\n');await intent.sync();}finally{await intent.close();}
  }
  const id=++seq,start=Date.now(),prepared={at:new Date().toISOString(),phase:'请求前',id,route,method,...(body?{body}:{} )};
  await appendDurable(new URL('HTTP流水.jsonl',runDir),prepared);let result;
  try{const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{method,headers:{Authorization:'Bearer '+process.env.HERO10_API_TOKEN,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const raw=await r.text();let data=null,parseError=false;try{data=raw?JSON.parse(raw):null;}catch{parseError=true;}result={ok:r.ok&&!parseError,status:r.status,data,...(parseError?{parseError:true,responseBytes:Buffer.byteLength(raw),responseSha256:hash(raw)}:{})};}
  catch(e){result={ok:false,status:null,data:null,error:e.name+': '+e.message};}
  const completed={at:new Date().toISOString(),phase:'请求后',id,route,method,elapsedMs:Date.now()-start,...result};await appendDurable(new URL('HTTP流水.jsonl',runDir),completed);calls.push(completed);return result;
 };
 return {request,calls};
}

export async function protectBaseline(plan,request,{apply=false}={}){
 const file=new URL('实录保护基线.json',here);try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.candidateFileSha256!==candidateFileSha256)throw Error('保护基线不属于当前候选');return saved;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(apply)throw Error('必须先完成只读保护基线');
 const baseline={at:new Date().toISOString(),candidateFileSha256,relations:[],images:[],apiWrites:0};
 for(const hero of heroKeys){const route='/character-skill-relations?characterKey=champion_'+hero,response=await request(route);if(!response.ok||!Array.isArray(rows(response)))throw Error('角色关联读取失败 '+hero);baseline.relations.push({route,...response});}
 for(const skillKey of Object.keys(plan.skills)){const route='/skills/'+skillKey+'/representative-image',response=await request(route);if(!response.ok)throw Error('代表图读取失败 '+skillKey);baseline.images.push({route,...response});}
 await writeFile(file,JSON.stringify(baseline,null,2)+'\n',{flag:'wx'});return baseline;
}
export async function checkCatalogs(plan,request){
 const catalogs={},failures=[];
 for(const[name,id]of [['attributes','attributeKey'],['modifier-zones','modifierZoneKey'],['damage-types','damageTypeKey'],['statuses','statusKey']]){const r=await request('/'+name),items=rows(r);if(!r.ok||!Array.isArray(items)||r.data?.total!=null&&r.data.total!==items.length)throw Error('目录未完整 '+name);catalogs[name]={items,id};const old=rows(original.catalogs[name]);for(const item of old){const actual=items.find(x=>x[id]===item[id]);if(!equal(item,actual))failures.push({catalog:name,id:item[id],originalChanged:true});}}
 for(const s of Object.values(plan.skills)){function walk(n){if(!n||typeof n!=='object')return;for(const[k,v]of Object.entries(n)){const catalog=Object.values(catalogs).find(x=>x.id===k);if(catalog&&typeof v==='string'&&!catalog.items.some(x=>x[k]===v&&x.status==='ENABLED'))failures.push({skillKey:s.skillKey,key:k,value:v});if(v&&typeof v==='object')walk(v);}}walk(s.write);}
 return {catalogs,failures};
}
export async function fullSnapshot(plan,request,{apply=false}={}){
 const out={startedAt:new Date().toISOString(),subjects:[],lists:[],readbacks:[],images:[],relations:[],missing:[],conflicts:[],skills:{},totals:Object.fromEntries(kinds.map(([kind])=>[kind,0]))},baseline=await protectBaseline(plan,request,{apply});
 for(const type of ['relations','images'])for(const old of baseline[type]){const current=await request(old.route);out[type].push({route:old.route,...current});if(!current.ok||!sameCollection(old.data,current.data))out.conflicts.push({route:old.route,protectedType:type,diff:diff(old.data,current.data)});}
 for(const s of Object.values(plan.skills)){
  const subject=await request('/skills/'+s.skillKey);out.subjects.push({skillKey:s.skillKey,...subject});if(!subject.ok||!equal(subject.data,original.skills[s.skillKey].subject.data))out.conflicts.push({skillKey:s.skillKey,subjectChanged:true});out.skills[s.skillKey]={};
  for(const[kind,idField,apiKind]of kinds){
   const base='/skills/'+s.skillKey+'/'+apiKind,list=await request(base),items=rows(list);if(!list.ok||!Array.isArray(items))throw Error('组成列表读取失败 '+base+' '+list.status);const ids=items.map(x=>x[idField]);if(ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw Error('组成列表稳定键非法 '+base);
   out.lists.push({skillKey:s.skillKey,kind,status:list.status,items});out.skills[s.skillKey][kind]=[];out.totals[kind]+=ids.length;
   for(const id of ids){const r=await request(base+'/'+encodeURIComponent(id));if(!r.ok)throw Error('组成详情读取失败 '+base+'/'+id+' '+r.status);const expected=s.write[kind].find(x=>x[idField]===id),protectedEntry=original.skills[s.skillKey].components[kind].details.find(x=>x.key===id)?.detail.data;
    let mismatch=expected?compareComponent(s.skillKey,kind,id,expected,r.data):{unexpectedExisting:true};if(protectedEntry&&!equal(protectedEntry,r.data))mismatch={protectedOriginalChanged:true,diff:diff(protectedEntry,r.data)};
    const summaryMismatch=compareListSummary(items.find(x=>x[idField]===id),r.data);if(summaryMismatch)out.conflicts.push({skillKey:s.skillKey,kind,id,listDetailMismatch:true,diff:summaryMismatch});
    out.skills[s.skillKey][kind].push(r.data);out.readbacks.push({skillKey:s.skillKey,kind,id,status:r.status,match:!mismatch,diff:mismatch,actual:r.data});if(mismatch)out.conflicts.push({skillKey:s.skillKey,kind,id,diff:mismatch});
   }
   for(const body of s.write[kind])if(!ids.includes(body[idField])){if(original.skills[s.skillKey].components[kind].details.some(x=>x.key===body[idField]))out.conflicts.push({skillKey:s.skillKey,kind,id:body[idField],protectedOriginalMissing:true});else out.missing.push({skillKey:s.skillKey,kind,idField,id:body[idField],base,route:base+'/'+encodeURIComponent(body[idField]),body});}
  }
 }
 out.finishedAt=new Date().toISOString();return out;
}
export async function independentArithmetic(plan,outputDir,{saved=false}={}){
 await mkdir(outputDir,{recursive:true});const input=new URL('核算输入.json',outputDir),output=new URL('独立核算.json',outputDir);await writeFile(input,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
 await promisify(execFile)(process.execPath,[fileURLToPath(new URL('接口实值独立核算.mjs',here))],{env:{...process.env,HERO10_ACTUAL_PLAN_PATH:fileURLToPath(input),HERO10_ACTUAL_CHECK_PATH:fileURLToPath(output)},windowsHide:true,maxBuffer:1024*1024});
 const r=JSON.parse(await readFile(output,'utf8'));return {inputSha256:hash(await readFile(input)),saved,boundary:saved?'逐项核对后，替换成实际GET所得六类组成求值；不以候选冒充实际数据':'候选静态来源及数学检查',checks:r.checks,sourceCases:r.sourceCases,cases:r.cases,failures:r.failures,pass:r.pass};
}
export async function verifySaved(plan,snapshot,dir){
 if(snapshot.missing.length||snapshot.conflicts.length)return {pass:false,fields:0,failures:[...snapshot.conflicts,...snapshot.missing.map(x=>({skillKey:x.skillKey,kind:x.kind,id:x.id,missing:true}))],boundary:'存在缺项或冲突，不以候选替代实际核算'};
 const actual=structuredClone(plan);let fields=0;const count=v=>v&&typeof v==='object'?Object.values(v).reduce((n,x)=>n+count(x),0):1;
 for(const s of Object.values(actual.skills))for(const[kind]of kinds){s.write[kind]=snapshot.skills[s.skillKey][kind].map(x=>business(x));fields+=s.write[kind].reduce((n,x)=>n+count(x),0);}
 return {...await independentArithmetic(actual,dir,{saved:true}),fields};
}
export async function createMissing(plan,snapshot,request,{journal}={}){
 if(writeAuthorization!==candidateFileSha256||!process.argv.includes('--apply'))throw Error('尚未放行实际写入');if(snapshot.conflicts.length)throw Error('预检有异值，禁止写入');
 if(snapshot.missing.length>213||snapshot.missing.some(x=>!['parameters','formulas','effects'].includes(x.kind)))throw Error('超出本批213组成范围');
 const events=[],failedSkills=[];const emit=async e=>{const record={at:new Date().toISOString(),...e};events.push(record);await journal(record);};
 for(const x of snapshot.missing){
  if(failedSkills.includes(x.skillKey)){await emit({skillKey:x.skillKey,kind:x.kind,id:x.id,action:'当前技能异常后跳过依赖'});continue;}
  await loadPlan();const before=await request(x.route);if(before.status!==404){const mismatch=before.ok?compareComponent(x.skillKey,x.kind,x.id,x.body,before.data):{status:before.status,error:before.error};await emit({skillKey:x.skillKey,kind:x.kind,id:x.id,action:mismatch?'写前异值或未知，暂停当前技能':'写前同值复用',diff:mismatch,actual:before.data});if(mismatch)failedSkills.push(x.skillKey);continue;}
  await emit({skillKey:x.skillKey,kind:x.kind,id:x.id,action:'准备创建',body:x.body});let posted=null,error=null;try{posted=await request(x.base,{method:'POST',body:x.body});}catch(e){error=e.name+': '+e.message;}
  // 即使请求超时、5xx或提交结果未知，也先GET；绝不在此重发POST。
  const after=await request(x.route),mismatch=after.ok?compareComponent(x.skillKey,x.kind,x.id,x.body,after.data):{status:after.status,error:after.error};
  await emit({skillKey:x.skillKey,kind:x.kind,id:x.id,action:posted?.ok?'创建后回读':'异常响应后查询落地',postStatus:posted?.status??null,postError:error??posted?.error??null,postResponse:posted?.data??null,readbackStatus:after.status,match:!mismatch,diff:mismatch,actual:after.data});if(mismatch)failedSkills.push(x.skillKey);
 }
 return {events,failedSkills};
}
