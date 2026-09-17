import fs from 'node:fs/promises';
import path from 'node:path';
const dir=process.argv[2];
const base='http://127.0.0.1:8080/api/admin/games/lol';
const skills=['item_3032_passive','item_3050_passive','item_3071_passive','item_3803_passive','item_6653_passive','item_8010_passive'];
async function get(route){const r=await fetch(base+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(30000)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text};return {status:r.status,data};}
async function listAndDetails(skill,kind,idField){const list=await get(`/skills/${skill}/${kind}`); const rows=list.data?.items??(Array.isArray(list.data)?list.data:[]); const details=[]; for(const row of rows){const id=row[idField]; details.push({id, response:await get(`/skills/${skill}/${kind}/${encodeURIComponent(id)}`)});} return {list,details};}
const out={generatedAt:new Date().toISOString(),mode:'本次纠错执行前重新GET',apiBase:base.replace('http://127.0.0.1:8080',''),skills:{},modifierZones:{list:await get('/modifier-zones'),targetDetails:{}}};
for(const key of ['item_3071_armor_reduction','item_8010_magic_resistance_reduction'])out.modifierZones.targetDetails[key]=await get(`/modifier-zones/${key}`);
for(const skill of skills){const s={subject:await get(`/skills/${skill}`),parameters:await listAndDetails(skill,'parameters','parameterKey'),formulas:await listAndDetails(skill,'formulas','formulaKey'),effects:await listAndDetails(skill,'effects','effectKey'),triggerRules:await listAndDetails(skill,'trigger-rules','ruleKey')};out.skills[skill]=s;}
await fs.writeFile(path.join(dir,'纠错本次预检.json'),JSON.stringify(out,null,2)+'\n','utf8');
const summary={generatedAt:out.generatedAt,zoneListStatus:out.modifierZones.list.status,zones:out.modifierZones.list.data?.items?.map(x=>x.modifierZoneKey)??[],targetZoneStatuses:Object.fromEntries(Object.entries(out.modifierZones.targetDetails).map(([k,v])=>[k,v.status])),skills:Object.fromEntries(Object.entries(out.skills).map(([k,s])=>[k,{subject:s.subject.status,parameters:s.parameters.list.status+':'+s.parameters.details.length,formulas:s.formulas.list.status+':'+s.formulas.details.length,effects:s.effects.list.status+':'+s.effects.details.length,triggerRules:s.triggerRules.list.status+':'+s.triggerRules.details.length}]))};console.log(JSON.stringify(summary,null,2));
