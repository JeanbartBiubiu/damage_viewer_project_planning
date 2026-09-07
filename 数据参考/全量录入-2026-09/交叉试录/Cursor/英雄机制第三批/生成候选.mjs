import {writeFile} from 'node:fs/promises';
import {plan} from './英雄候选.mjs';
const x=plan.skills.sivir_e;
await writeFile(new URL('./录入候选.json',import.meta.url),JSON.stringify(plan,null,2)+'\n');
await writeFile(new URL('./希维尔E页面试录.json',import.meta.url),JSON.stringify({skillKey:'sivir_e',parentOwns:{effects:x.write.effects.filter(e=>e.effectKey==='spell_shield'),processes:x.write.processes,triggerRules:x.write.triggerRules},prerequisites:{parameters:x.write.parameters,formulas:x.write.formulas,effects:x.write.effects.filter(e=>e.effectKey==='block_heal')},note:'API接手代理只建前置参数/公式/治疗效果；主负责人页面建法术护盾、施放过程、成功格挡规则。双方不交叉写。'},null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(plan.skills).map(([k,s])=>[k,Object.fromEntries(Object.entries(s.write).map(([kind,a])=>[kind,a.length]))]))));
