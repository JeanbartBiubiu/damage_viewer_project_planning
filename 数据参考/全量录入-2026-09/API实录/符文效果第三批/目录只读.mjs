import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
if(process.argv.includes('--apply'))throw Error('本任务仅允许GET');
const here=path.dirname(fileURLToPath(import.meta.url));
const token=process.env.RUNE3_API_TOKEN;
if(!token)throw Error('缺少本地只读认证环境变量');
const ids=[8105,8106,8304,8352,8347,8410,8014,8017,8429,8444,8451,8234];
const routes=['/attributes','/modifier-zones','/skill-categories',...ids.map(id=>`/skills/rune_${id}_passive`),'/equipment/item_2422/attributes','/equipment-skill-relations?equipmentKey=item_2422'];
const records=[];
for(const route of routes){
 const response=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
 const text=await response.text();let data;try{data=JSON.parse(text)}catch{data={parseError:true,byteLength:text.length}};
 records.push({route,status:response.status,data});
 if(response.status!==200&&response.status!==404)throw Error('GET异常 '+route+' '+response.status);
}
fs.writeFileSync(path.join(here,'当前目录只读.json'),JSON.stringify({at:new Date().toISOString(),method:'GET_ONLY',records},null,2)+'\n');
console.log(JSON.stringify({requests:records.length,statuses:records.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),writes:0}));
