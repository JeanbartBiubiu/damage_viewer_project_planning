import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const base='http://127.0.0.1:8080/api/admin/games/lol';
const here=new URL('./',import.meta.url);
const token=process.env.HERO17_API_TOKEN;
if(!token)throw new Error('缺少环境提供的开发认证值');
const heroes=['vladimir','swain','rumble','aurelionsol'];
const skills=heroes.flatMap(hero=>['p','q','w','e','r'].map(slot=>hero+'_'+slot));
const selection=JSON.parse(await fs.readFile(new URL('../../../../../.agents/artifacts/hero17-selection/下一批只读去重.json',import.meta.url),'utf8'));
const rows=result=>Array.isArray(result?.data)?result.data:Array.isArray(result?.data?.items)?result.data.items:null;
const selectedParameterRows=[];
for(const req of selection.requests??[]){
  const m=String(req.route??'').match(/^\/skills\/([^/]+)\/parameters$/);
  if(m&&Array.isArray(req.data))for(const row of req.data)selectedParameterRows.push({skillKey:m[1],parameterKey:row.parameterKey,fromSelection:row});
}
const unique=[...new Map(selectedParameterRows.map(x=>[x.skillKey+'/'+x.parameterKey,x])).values()];
const requests=[];
async function get(route){
  const started=Date.now();
  try{
    const res=await fetch(base+route,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
    const body=await res.text();let data=null;try{data=body?JSON.parse(body):null}catch{}
    const row={route,method:'GET',status:res.status,elapsedMs:Date.now()-started,data};
    requests.push(row);return row;
  }catch(error){const row={route,method:'GET',status:null,elapsedMs:Date.now()-started,error:error.name};requests.push(row);return row;}
}
const out={at:new Date().toISOString(),mode:'只读GET；补读已有公共参数详情并保护角色、关系、技能代表图及引用字典；不发业务写入',base,heroes,skills,selectionSourceSha256:crypto.createHash('sha256').update(await fs.readFile(new URL('../../../../../.agents/artifacts/hero17-selection/下一批只读去重.json',import.meta.url))).digest('hex'),parameters:{},characters:{},relations:{},images:{},catalogs:{},requests,failures:[]};
for(const item of unique){const row=await get('/skills/'+item.skillKey+'/parameters/'+encodeURIComponent(item.parameterKey));out.parameters[item.skillKey+'/'+item.parameterKey]={selected:item.fromSelection,detail:row};if(row.status!==200)out.failures.push({route:row.route,status:row.status,kind:'parameter'});}
for(const hero of heroes){
 const characterKey='champion_'+hero;
 const c=await get('/characters/'+characterKey);out.characters[characterKey]=c;if(c.status!==200)out.failures.push({route:c.route,status:c.status,kind:'character'});
 const rel=await get('/character-skill-relations?characterKey='+encodeURIComponent(characterKey));out.relations[characterKey]=rel;if(rel.status!==200)out.failures.push({route:rel.route,status:rel.status,kind:'relation'});
}
for(const skill of skills){const row=await get('/skills/'+skill+'/representative-image');out.images[skill]=row;if(row.status!==200&&row.status!==404)out.failures.push({route:row.route,status:row.status,kind:'image'});}
for(const catalog of ['attributes','modifier-zones','damage-types']){
 const row=await get('/'+catalog);out.catalogs[catalog]=row;if(row.status!==200)out.failures.push({route:row.route,status:row.status,kind:'catalog'});
}
out.requests=requests;
out.summary={publicParameterDetails:Object.keys(out.parameters).length,characters:Object.keys(out.characters).length,relations:Object.keys(out.relations).length,images:Object.keys(out.images).length,catalogs:Object.keys(out.catalogs).length,requests:requests.length,statusCounts:requests.reduce((m,r)=>(m[String(r.status)]=(m[String(r.status)]??0)+1,m),{}),failures:out.failures.length,apiWrites:0};
const bytes=JSON.stringify(out,null,2)+'\n';
await fs.writeFile(new URL('./只读保护与公共参数.json',here),bytes,{flag:'wx'});
console.log(JSON.stringify(out.summary));
if(out.failures.length)process.exitCode=1;

