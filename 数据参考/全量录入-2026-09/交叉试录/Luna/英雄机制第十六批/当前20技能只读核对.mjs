// 只读冻结本批20个技能及六类组成；不创建、修改或删除业务数据。
import {access,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const here=new URL('./',import.meta.url);
const probeOnly=process.argv.includes('--probe-only');
const base='http://127.0.0.1:8080/api/admin/games/lol';
const token=process.env.HERO16_API_TOKEN;
if(!token)throw Error('缺少环境提供的开发认证值');
const heroes=[
  {id:'Malzahar',key:'malzahar'},
  {id:'Anivia',key:'anivia'},
  {id:'Lissandra',key:'lissandra'},
  {id:'Karthus',key:'karthus'}
];
const skillKeys=heroes.flatMap(h=>['p','q','w','e','r'].map(slot=>h.key+'_'+slot));
const kinds=[
  ['parameters','parameters','parameterKey'],
  ['formulas','formulas','formulaKey'],
  ['effects','effects','effectKey'],
  ['processes','processes','processKey'],
  ['internalStates','internal-states','stateKey'],
  ['triggerRules','trigger-rules','ruleKey']
];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const errors=[],requests=[];
async function get(route){
  try{
    const response=await fetch(base+route,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
    const text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{}
    const result={route,status:response.status,data};requests.push({route,status:response.status});return result;
  }catch(error){
    const result={route,status:null,data:null,error:String(error)};requests.push({route,status:null});return result;
  }
}
function rows(result){
  if(result.status!==200)return null;
  if(Array.isArray(result.data))return result.data;
  if(Array.isArray(result.data?.items))return result.data.items;
  return null;
}
function recordError(route,status,reason){errors.push({route,status,reason});}

const out={
  at:new Date().toISOString(),
  mode:'全部请求为GET；保留当前20技能及六类组成原值；不写业务接口',
  base,heroes:heroes.map(h=>h.id),skillKeys,
  kinds:kinds.map(([name,api,id])=>({name,api,id})),skills:{},catalogs:{},duplicateKeys:[],requests:[],errors:[]
};
for(const name of ['attributes','modifier-zones','statuses','damage-types']){
  const result=await get('/'+name);out.catalogs[name]=result;
  if(result.status!==200)recordError(result.route,result.status,'目录GET失败');
}
for(const skillKey of skillKeys){
  const subject=await get('/skills/'+skillKey);const snapshot={subject,components:{}};
  if(subject.status!==200)recordError(subject.route,subject.status,'技能GET失败');
  for(const [name,api,id] of kinds){
    const list=await get('/skills/'+skillKey+'/'+api),items=rows(list),details=[];
    snapshot.components[name]={list,items:items??[],details};
    if(!items){recordError(list.route,list.status,'组成列表GET失败或响应不是数组');continue;}
    const seen=new Set();
    for(const item of items){
      const key=item?.[id];
      if(typeof key!=='string'||seen.has(key)){
        out.duplicateKeys.push({skillKey,kind:name,key});
        if(seen.has(key))recordError(list.route,list.status,'组成稳定键重复');
      }
      seen.add(key);
    }
    for(const item of items){
      const key=item?.[id];
      if(typeof key!=='string'){details.push({item,status:null,data:null});continue;}
      const detail=await get('/skills/'+skillKey+'/'+api+'/'+encodeURIComponent(key));
      details.push({key,item,detail});
      if(detail.status!==200)recordError(detail.route,detail.status,'组成详情GET失败');
    }
  }
  out.skills[skillKey]=snapshot;
}
out.requests=requests;out.errors=errors;
const allItems=Object.values(out.skills).flatMap(s=>Object.values(s.components).flatMap(v=>v.items));
const allDetails=Object.values(out.skills).flatMap(s=>Object.values(s.components).flatMap(v=>v.details));
out.summary={
  skillCount:Object.keys(out.skills).length,expectedSkillCount:20,
  compositionCount:allItems.length,detailCount:allDetails.length,
  duplicateCount:out.duplicateKeys.length,errorCount:errors.length,requestCount:requests.length
};
const report={
  at:out.at,mode:out.mode,summary:out.summary,duplicates:out.duplicateKeys,errors,
  statusCounts:requests.reduce((m,r)=>{const k=String(r.status);m[k]=(m[k]??0)+1;return m;},{}),snapshotSha256:null
};
const artifactDir=new URL('../../../../../.agents/artifacts/hero16-candidate/',import.meta.url);
if(errors.length){
  await mkdir(artifactDir,{recursive:true});
  const name=probeOnly?'实时8080预检.json':'当前20技能GET失败.json';
  await writeFile(new URL(name,artifactDir),JSON.stringify({...report,probeOnly},null,2)+'\n');
  console.log(JSON.stringify({success:false,...out.summary,statusCounts:report.statusCounts}));
  process.exitCode=1;
}else{
  const snapshotBytes=JSON.stringify(out,null,2)+'\n';
  report.snapshotSha256=hash(Buffer.from(snapshotBytes));
  if(probeOnly){
    const target=new URL('./写前现值.json',here),previousBytes=await readFile(target).catch(()=>null);
    report.probeOnly=true;report.previousSnapshotSha256=previousBytes?hash(previousBytes):null;
    const canonical=value=>{const copy=JSON.parse(JSON.stringify(value));delete copy.at;return copy;};
    report.canonicalSnapshotSha256=hash(Buffer.from(JSON.stringify(canonical(out),null,2)+'\n'));
    if(previousBytes){try{report.previousCanonicalSnapshotSha256=hash(Buffer.from(JSON.stringify(canonical(JSON.parse(previousBytes)),null,2)+'\n'));report.sameAsPreviousSnapshot=report.canonicalSnapshotSha256===report.previousCanonicalSnapshotSha256;}catch{report.previousCanonicalSnapshotSha256=null;report.sameAsPreviousSnapshot=null;}}
    await mkdir(artifactDir,{recursive:true});
    await writeFile(new URL('实时8080预检.json',artifactDir),JSON.stringify(report,null,2)+'\n');
  }else{
    const target=new URL('./写前现值.json',here);
    if(await access(target).then(()=>true,()=>false))throw Error('写前现值.json已存在，拒绝覆盖原始GET证据');
    await writeFile(target,snapshotBytes,{flag:'wx'});
    await writeFile(new URL('./当前20技能组成核对.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  }
  console.log(JSON.stringify({success:true,...out.summary,snapshotSha256:report.snapshotSha256,statusCounts:report.statusCounts}));
}
