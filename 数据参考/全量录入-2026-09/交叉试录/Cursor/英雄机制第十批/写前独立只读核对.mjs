// 仅 GET；保护原冻结证据；不包含写接口或凭据。
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
const here=new URL('./',import.meta.url),outDir=new URL('../../../../../.agents/artifacts/hero10-takeover/',here);
const baseline=JSON.parse(fs.readFileSync(new URL('写前现值.json',here))),bytes=fs.readFileSync(new URL('完整候选.json',here)),plan=JSON.parse(bytes);
const hash=x=>createHash('sha256').update(x).digest('hex');
if(hash(bytes)!=='c08257b3fbd500d448b87d250e2a23c51d416a212e3d0398f29f9ce12b709cae')throw Error('候选散列变化；拒绝继续');
if(!process.env.HERO10_API_TOKEN)throw Error('需通过进程环境提供开发认证占位值');
const base='http://127.0.0.1:8080/api/admin/games/lol',run=new Date().toISOString().replace(/[:.]/g,'-'),requests=[],failures=[],checks=[],decisions=[];
const kinds=[['parameters','parameters','parameterKey'],['formulas','formulas','formulaKey'],['effects','effects','effectKey'],['processes','processes','processKey'],['internalStates','internal-states','stateKey'],['triggerRules','trigger-rules','ruleKey']];
const fresh={at:new Date().toISOString(),apiWrites:0,skills:{},catalogs:{},requests};
function check(name,pass,detail=null){const value={name,pass,detail};checks.push(value);if(!pass)failures.push(value);}
async function get(route){
 const start=Date.now();let result;
 try{const r=await fetch(base+route,{method:'GET',headers:{Authorization:'Bearer '+process.env.HERO10_API_TOKEN,Accept:'application/json'},signal:AbortSignal.timeout(30000)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=null;}result={route,status:r.status,data};}
 catch(e){result={route,status:null,data:null,error:e.name+': '+e.message};}
 requests.push({route,status:result.status,elapsedMs:Date.now()-start});check('GET '+route,result.status===200,result.status);return result;
}
const rows=r=>r?.status===200?(Array.isArray(r.data)?r.data:r.data?.items??[]):[];
const sortBy=(items,key)=>items.toSorted((a,b)=>String(a[key]).localeCompare(String(b[key])));
const body=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['gameId','skillKey','createdAt','updatedAt'].includes(key)));
for(const [name,key] of [['attributes','attributeKey'],['modifier-zones','modifierZoneKey'],['statuses','statusKey'],['damage-types','damageTypeKey']]){
 const response=await get('/'+name);fresh.catalogs[name]=response;const old=rows(baseline.catalogs[name]),now=rows(response);
 check('原目录对象逐字段保护 '+name,old.every(a=>now.some(b=>b[key]===a[key]&&equal(a,b))),{before:old.length,now:now.length,added:now.filter(b=>!old.some(a=>a[key]===b[key])).map(x=>x[key])});
}
for(const [skillKey,candidate]of Object.entries(plan.skills)){
 const prior=baseline.skills[skillKey],subject=await get('/skills/'+skillKey),item={subject,components:{}};fresh.skills[skillKey]=item;
 check('主体完整保护 '+skillKey,equal(prior.subject.data,subject.data));
 for(const[name,api,key]of kinds){
  const route='/skills/'+skillKey+'/'+api,list=await get(route),items=rows(list),details=[];item.components[name]={list,items,details};
  check('组成列表逐字段保护 '+skillKey+'/'+name,equal(sortBy(prior.components[name].items,key),sortBy(items,key)));
  check('组成稳定键唯一 '+skillKey+'/'+name,new Set(items.map(x=>x[key])).size===items.length);
  for(const x of items){const detail=await get(route+'/'+encodeURIComponent(x[key]));details.push({key:x[key],item:x,detail});const old=prior.components[name].details.find(y=>y.key===x[key]);check('组成详情完整保护 '+skillKey+'/'+name+'/'+x[key],!!old&&equal(old.detail.data,detail.data));}
  for(const request of candidate.write[name]){const actual=details.find(x=>x.key===request[key]);const state=actual?(equal(body(actual.detail.data),request)?'同值复用':'异值暂停'):'待新增';decisions.push({skillKey,kind:name,key:request[key],state});check('候选无异值 '+skillKey+'/'+name+'/'+request[key],state!=='异值暂停');}
 }
}
const counts=Object.fromEntries(kinds.map(([name])=>[name,{total:decisions.filter(x=>x.kind===name).length,reuse:decisions.filter(x=>x.kind===name&&x.state==='同值复用').length,missing:decisions.filter(x=>x.kind===name&&x.state==='待新增').length,conflicts:decisions.filter(x=>x.kind===name&&x.state==='异值暂停').length}]));
const snapshot=JSON.stringify(fresh,null,2)+'\n';fs.mkdirSync(outDir,{recursive:true});const snapshotName='只读现值-'+run+'.json';fs.writeFileSync(new URL(snapshotName,outDir),snapshot,{flag:'wx'});
const report={at:new Date().toISOString(),pass:!failures.length,apiWrites:0,candidateFileSha256:hash(bytes),candidatePlanSha256:hash(JSON.stringify(plan)),originalSnapshotSha256:hash(fs.readFileSync(new URL('写前现值.json',here))),snapshot:{file:'.agents/artifacts/hero10-takeover/'+snapshotName,sha256:hash(snapshot)},requests:requests.length,statusCounts:requests.reduce((m,x)=>(m[x.status]=(m[x.status]??0)+1,m),{}),counts,checks,decisions,failures,boundary:'只读接口验证；未创建组成、修改主体、关联、图片或执行战斗。'};
fs.writeFileSync(new URL('写前独立只读核对-'+run+'.json',here),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({pass:report.pass,apiWrites:0,requests:report.requests,statusCounts:report.statusCounts,counts,checks:checks.length,failures,snapshot:report.snapshot}));if(failures.length)process.exitCode=1;
