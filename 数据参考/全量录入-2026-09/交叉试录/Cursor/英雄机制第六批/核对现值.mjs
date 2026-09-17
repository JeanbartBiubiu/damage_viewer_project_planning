import {writeFile,access} from 'node:fs/promises';
if(await access(new URL('./写前现值.json',import.meta.url)).then(()=>true,()=>false))throw Error('写前快照已存在，拒绝覆盖原始证据；当前核对请运行独立回读.mjs');
const keys=['garen','jax','mordekaiser','renekton'].flatMap(h=>['p','q','w','e','r'].map(s=>h+'_'+s));
const kinds=[['parameters','parameterKey'],['formulas','formulaKey'],['effects','effectKey'],['processes','processKey'],['internal-states','stateKey'],['trigger-rules','ruleKey']];
const out={at:new Date().toISOString(),mode:'仅GET；保留写前原值',skills:{}};
async function get(route){const r=await fetch('http://127.0.0.1:8080/api/admin/games/lol'+route,{headers:{Authorization:'Bearer local-entry'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(route+' '+r.status);return r.json();}
for(const key of keys){const skill=await get('/skills/'+key);const x={skill,components:{}};for(const[kind,id]of kinds){const list=await get('/skills/'+key+'/'+kind);x.components[kind]=[];for(const item of list)x.components[kind].push(await get('/skills/'+key+'/'+kind+'/'+item[id]));}out.skills[key]=x;}
await writeFile(new URL('./写前现值.json',import.meta.url),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(Object.entries(out.skills).map(([skillKey,x])=>({skillKey,counts:Object.fromEntries(Object.entries(x.components).map(([k,a])=>[k,a.length])),}))));
