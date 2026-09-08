// 仅GET；不会创建、覆盖或删除任何业务对象，也不覆盖原始写前快照。
import {readFile,writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
const plan=JSON.parse(await readFile(new URL('./完整候选.json',import.meta.url),'utf8'));
const report={at:new Date().toISOString(),boundary:'当前目录、主体及28公共参数只读核对；不表示候选已保存。',catalogs:{},subjects:[],publicParameters:[],missingReferences:[],failures:[]};
async function get(route){const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry',Accept:'application/json'},signal:AbortSignal.timeout(10000)});const data=await r.json();return {route,status:r.status,data};}
for(const key of ['attributes','modifier-zones','statuses','damage-types']){const result=await get('/'+key);report.catalogs[key]=result;if(result.status!==200)report.failures.push({catalog:key,status:result.status});}
const catalogSet=(name,key)=>{const d=report.catalogs[name].data,items=Array.isArray(d)?d:d?.items;if(!Array.isArray(items))throw Error('目录响应结构不符 '+name);if(d.total!=null&&d.total!==items.length)throw Error('目录分页未完整 '+name);return new Set(items.map(x=>x[key]));};
const attrs=catalogSet('attributes','attributeKey'),zones=catalogSet('modifier-zones','modifierZoneKey'),damageTypes=catalogSet('damage-types','damageTypeKey');
for(const s of Object.values(plan.skills)){
 const r=await get('/skills/'+s.skillKey);const subjectMatch=r.status===200&&r.data.skillKey===s.skillKey&&r.data.maxLevel===s.maxLevel;report.subjects.push({skill:s.skillKey,...r,match:subjectMatch});if(!subjectMatch)report.failures.push({skill:s.skillKey,subjectMismatch:true});
 for(const key of s.reusedParameters){const r=await get('/skills/'+s.skillKey+'/parameters/'+key),expected=s.write.parameters.find(p=>p.parameterKey===key),business=Object.fromEntries(Object.entries(r.data).filter(([k])=>!['gameId','skillKey','createdAt','updatedAt'].includes(k))),match=r.status===200&&isDeepStrictEqual(expected,business);report.publicParameters.push({skill:s.skillKey,parameter:key,...r,match});if(!match)report.failures.push({skill:s.skillKey,parameter:key,publicMismatch:true});}
 function walk(n){if(!n||typeof n!=='object')return;for(const [key,value] of Object.entries(n)){if(key==='attributeKey'&&value&&!attrs.has(value))report.missingReferences.push({skill:s.skillKey,key,value});if(key==='modifierZoneKey'&&value&&!zones.has(value))report.missingReferences.push({skill:s.skillKey,key,value});if(key==='damageTypeKey'&&value&&!damageTypes.has(value))report.missingReferences.push({skill:s.skillKey,key,value});if(value&&typeof value==='object')walk(value);}}
 walk(s.write);
}
report.failures.push(...report.missingReferences);
await writeFile(new URL('./候选只读前检.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({subjects:report.subjects.length,publicParameters:report.publicParameters.length,failures:report.failures}));if(report.failures.length)process.exitCode=1;
