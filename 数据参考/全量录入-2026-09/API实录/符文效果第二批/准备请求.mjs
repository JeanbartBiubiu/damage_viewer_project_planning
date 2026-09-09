import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
if(process.argv.length!==2)throw Error('只生成本地请求');
const here=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve(here,'../符文机制盘点/下一批最多12项.json');
const sha=b=>createHash('sha256').update(b).digest('hex'),raw=fs.readFileSync(source);
if(sha(raw)!=='a22d0f1cf63b51cc47fc128f532c596e608719c25710b41a0756cd637479b9f4')throw Error('冻结候选已变化');
if(fs.existsSync(path.join(here,'可审查请求.json')))throw Error('已冻结请求，拒绝覆盖');
const src=JSON.parse(raw),requests=[];
for(const p of src.proposals){
 const s='/skills/'+p.skillKey;
 if(p.id===8437){for(const f of p.formulas)f.name=({melee_damage:'近战不灭伤害',ranged_damage:'远程不灭伤害',melee_heal:'近战不灭治疗',ranged_heal:'远程不灭治疗'})[f.formulaKey];for(const e of p.effects){e.name=e.effectKey==='melee_heal'?'近战不灭治疗':'远程不灭治疗';e.results[0].name=e.name;}}
 const add=(kind,route,readRoute,body)=>requests.push({id:p.id,skillKey:p.skillKey,kind,route,readRoute,body});
 add('skill','/skills',s,p.skillBody);
 for(const [kind,array,child,key] of [['parameter',p.parameters,'parameters','parameterKey'],['formula',p.formulas,'formulas','formulaKey'],['effect',p.effects,'effects','effectKey'],['rule',p.triggerRules,'trigger-rules','ruleKey']])for(const body of array)add(kind,s+'/'+child,s+'/'+child+'/'+body[key],body);
 add('relation','/rune-skill-relations',`/rune-skill-relations?runeKey=${p.runeKey}&skillKey=${p.skillKey}`,p.relationBody);
}
if(requests.length!==99)throw Error('请求数变化');
const result={sourceCandidateSha256:sha(raw),scope:src.proposals.map(({id,runeKey,skillKey,name,scope,remainingFacts,notIncluded,executionQualification})=>({id,runeKey,skillKey,name,scope,remainingFacts,notIncluded,executionQualification})),changesFromCandidate:['不灭4公式与2效果的显示名称改为中文；稳定键、表达式、业务数值未变化'],requests};
const out=JSON.stringify(result,null,2)+'\n';fs.writeFileSync(path.join(here,'可审查请求.json'),out);fs.writeFileSync(path.join(here,'.gitattributes'),'* -text whitespace=cr-at-eol\n');console.log(JSON.stringify({requests:requests.length,sha256:sha(out)}));
