// 所有网络请求固定GET；原始写前证据不覆盖。
import {readFile,writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {business as canonicalBusiness} from './前十技能录入工具.mjs';
const full=process.argv.includes('--full');if(process.argv.slice(2).some(v=>v!=='--full'))throw Error('入口只读，不接受写参数');
const plan=JSON.parse(await readFile(new URL(full?'./完整候选.json':'./前十技能候选.json',import.meta.url),'utf8')),before=JSON.parse(await readFile(new URL('./写前现值.json',import.meta.url),'utf8'));
const out={at:new Date().toISOString(),mode:'全部请求为GET，原始写前快照不改',catalogs:{},subjects:[],relations:[],images:[],collections:[],details:[],missing:[],conflicts:[],references:[]};
const business=canonicalBusiness;
async function get(route){const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry',Accept:'application/json'},signal:AbortSignal.timeout(15000)});return {route,status:r.status,data:await r.json()};}
const rows=r=>{if(r.status!==200)throw Error(r.route+' '+r.status);const a=Array.isArray(r.data)?r.data:r.data.items;if(!Array.isArray(a)||r.data.total!=null&&r.data.total!==a.length)throw Error('未读完整 '+r.route);return a;};
for(const name of ['attributes','modifier-zones','statuses','damage-types'])out.catalogs[name]=await get('/'+name);
const cat={attributeKey:new Set(rows(out.catalogs.attributes).map(v=>v.attributeKey)),modifierZoneKey:new Set(rows(out.catalogs['modifier-zones']).map(v=>v.modifierZoneKey)),damageTypeKey:new Set(rows(out.catalogs['damage-types']).map(v=>v.damageTypeKey)),statusKey:new Set(rows(out.catalogs.statuses).map(v=>v.statusKey))};
const kinds=[['parameters','parameterKey','parameters'],['formulas','formulaKey','formulas'],['effects','effectKey','effects'],['processes','processKey','processes'],['internalStates','stateKey','internal-states'],['triggerRules','ruleKey','trigger-rules']];
for(const hero of new Set(Object.keys(plan.skills).map(k=>k.split('_')[0]))){const r=await get('/character-skill-relations?characterKey=champion_'+hero),expected=['p','q','w','e','r'].map(s=>hero+'_'+s),actual=rows(r).map(v=>v.skillKey),match=expected.every(k=>actual.includes(k));out.relations.push({...r,match});if(!match)out.conflicts.push({hero,relationMismatch:true});}
for(const s of Object.values(plan.skills)){
 const r=await get('/skills/'+s.skillKey),match=r.status===200&&isDeepStrictEqual(r.data,before.skills[s.skillKey].skill);out.subjects.push({...r,match});if(!match)out.conflicts.push({skill:s.skillKey,subjectChanged:true});
 const image=await get('/skills/'+s.skillKey+'/representative-image');out.images.push(image);if(image.status!==200||!image.data.image?.enabled)out.conflicts.push({skill:s.skillKey,imageNotAvailable:true});
 for(const[kind,id,api]of kinds){const collection=await get('/skills/'+s.skillKey+'/'+api),items=rows(collection);out.collections.push(collection);const keys=items.map(v=>v[id]);if(new Set(keys).size!==keys.length)out.conflicts.push({skill:s.skillKey,kind,duplicate:true});for(const item of items){const detail=await get('/skills/'+s.skillKey+'/'+api+'/'+item[id]),expected=s.write[kind].find(v=>v[id]===item[id]),match=detail.status===200&&expected&&isDeepStrictEqual(business(detail.data),business(expected));out.details.push({...detail,match:Boolean(match)});if(!match)out.conflicts.push({skill:s.skillKey,kind,key:item[id],unexpectedOrDifferent:true});}for(const expected of s.write[kind])if(!keys.includes(expected[id]))out.missing.push({skill:s.skillKey,kind,key:expected[id]});}
 function walk(n){if(!n||typeof n!=='object')return;for(const[k,v]of Object.entries(n)){if(cat[k]&&v!=null&&!cat[k].has(v))out.references.push({skill:s.skillKey,key:k,value:v});if(v&&typeof v==='object')walk(v);}}walk(s.write);
}
out.conflicts.push(...out.references);out.success=out.conflicts.length===0;await writeFile(new URL(full?'./完整候选只读前检.json':'./前十技能只读前检.json',import.meta.url),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({success:out.success,subjects:out.subjects.length,collections:out.collections.length,existingDetails:out.details.length,missing:out.missing.length,conflicts:out.conflicts}));if(!out.success)process.exitCode=1;
