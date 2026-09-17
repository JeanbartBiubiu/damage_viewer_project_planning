import {writeFile} from 'node:fs/promises';
import {plan} from './英雄候选.mjs';
const x=plan.skills.sivir_e;
await writeFile(new URL('./录入候选.json',import.meta.url),JSON.stringify(plan,null,2)+'\n');
await writeFile(new URL('./希维尔E页面试录.json',import.meta.url),JSON.stringify({skillKey:'sivir_e',parentOwns:{effects:x.write.effects.filter(e=>e.effectKey==='spell_shield'),processes:x.write.processes,triggerRules:x.write.triggerRules},prerequisites:{parameters:x.write.parameters,formulas:x.write.formulas,effects:x.write.effects.filter(e=>e.effectKey==='block_heal')},note:'当前block_heal同时包含治疗与显式护盾消费，必须先建立spell_shield才可保存block_heal。恢复顺序为参数/公式→主负责人护盾→block_heal→过程与成功规则。历史页面证据另存，不以当前候选改写旧验收。'},null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(plan.skills).map(([k,s])=>[k,Object.fromEntries(Object.entries(s.write).map(([kind,a])=>[kind,a.length]))]))));
