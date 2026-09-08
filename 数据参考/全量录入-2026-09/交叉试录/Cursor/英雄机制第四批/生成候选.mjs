import {writeFile} from 'node:fs/promises';
import {plan} from './组成.mjs';
const forbidden=plan.skills.veigar_e.write.effects.some(e=>e.effectKey==='event_horizon_stun')||plan.skills.veigar_e.write.triggerRules.some(r=>r.ruleKey==='actual_cage_contact');
if(forbidden)throw Error('维迦E两项未保存待修候选不得混入当前写入集合');
await writeFile(new URL('./录入候选.json',import.meta.url),JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify({skills:Object.keys(plan.skills).length,counts:Object.fromEntries(Object.keys(plan.skills.veigar_e.write).map(k=>[k,Object.values(plan.skills).reduce((n,s)=>n+s.write[k].length,0)])),reused:Object.values(plan.skills).reduce((n,s)=>n+s.reusedParameters.length,0)}));
