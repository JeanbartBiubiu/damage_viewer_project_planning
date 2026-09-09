// 只读保护角色主体、角色技能关系和20个技能代表图，不读取或修改图字节。
import {access,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const here=new URL('./',import.meta.url),base='http://127.0.0.1:8080/api/admin/games/lol';
const token=process.env.HERO16_API_TOKEN;if(!token)throw Error('缺少环境提供的开发认证值');
const plan=JSON.parse(await readFile(new URL('完整候选.json',here),'utf8'));
const candidateBytes=await readFile(new URL('完整候选.json',here));
const report={at:new Date().toISOString(),mode:'只读GET；保护目录主体、角色技能关系和代表图，不读取或修改图字节',candidateSha256:createHash('sha256').update(candidateBytes).digest('hex'),requests:[],failures:[]};
const target=new URL(process.env.HERO16_PROTECTION_FILE??'关联与图片保护快照.json',here);
if(await access(target).then(()=>true,()=>false))throw Error('关联与图片保护快照.json已存在，拒绝覆盖原始保护证据');
const routes=['malzahar','anivia','lissandra','karthus'].flatMap(key=>['/characters/champion_'+key,'/character-skill-relations?characterKey=champion_'+key]);
routes.push(...Object.keys(plan.skills).map(key=>'/skills/'+key+'/representative-image'));
for(const route of routes){
  const start=Date.now();let row;
  try{
    const response=await fetch(base+route,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
    const text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{}
    row={route,method:'GET',status:response.status,elapsedMs:Date.now()-start,data};
    if(!response.ok)report.failures.push({route,status:response.status});
  }catch(error){row={route,method:'GET',status:null,error:error.name};report.failures.push(row);}
  report.requests.push(row);await writeFile(target,JSON.stringify(report,null,2)+'\n');
}
report.completedAt=new Date().toISOString();report.success=report.failures.length===0;
report.summary={requests:report.requests.length,characters:4,characterSkillRelationLists:4,skillImages:20,apiWrites:0};
await writeFile(target,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({success:report.success,...report.summary,failures:report.failures}));
if(!report.success)process.exitCode=1;
