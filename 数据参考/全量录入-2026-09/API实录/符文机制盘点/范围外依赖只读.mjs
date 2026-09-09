import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if(process.argv.length!==2)throw new Error('仅允许GET依赖核对');
const here=path.dirname(fileURLToPath(import.meta.url));
const inventory=JSON.parse(fs.readFileSync(path.join(here,'逐项机器清单.json'),'utf8'));
const records=[];
for(const entry of inventory.entries.filter(x=>x.scope==='范围外')){
 const route=`/rune-skill-relations?runeKey=${entry.runeKey}`;
 let success=false;
 for(let attempt=1;attempt<=3;attempt++){
  try{const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{method:'GET',headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(15000)});const data=await response.json();records.push({runeKey:entry.runeKey,name:entry.name,route,attempt,status:response.status,data});if(response.ok){success=true;break;}if(response.status<500)break;}catch(error){records.push({runeKey:entry.runeKey,route,attempt,status:null,error:error.message});}
 }
 if(!success){fs.writeFileSync(path.join(here,'范围外挂载只读.json'),JSON.stringify({checkedAt:new Date().toISOString(),mode:'GET_ONLY',records,complete:false},null,2)+'\n');throw Error(`尚未成功读取:${route}；不可推断为空`);}
}
fs.writeFileSync(path.join(here,'范围外挂载只读.json'),JSON.stringify({checkedAt:new Date().toISOString(),mode:'GET_ONLY',records,complete:true,boundary:'只说明当前符文挂载事实，不证明客户端玩法没有其他间接依赖；没有删除任何身份或机制。'},null,2)+'\n');
console.log(JSON.stringify(records.map(x=>({runeKey:x.runeKey,status:x.status,total:x.data?.total})),null,2));
