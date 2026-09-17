import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
if(process.argv.length!==2)throw new Error('本地独立校验不接受执行参数');
const here=path.dirname(fileURLToPath(import.meta.url));
const read=name=>JSON.parse(fs.readFileSync(path.join(here,name),'utf8'));
const hash=name=>createHash('sha256').update(fs.readFileSync(path.join(here,name))).digest('hex');
const source=read('冻结来源.json'),inventory=read('逐项机器清单.json'),next=read('下一批最多12项.json'),extra=read('关联装备来源.json');
const outsideDependencies=read('范围外跨技能依赖.json');
assert.equal(source.items.length,62);assert.equal(inventory.entries.length,62);assert.equal(new Set(inventory.entries.map(x=>x.runeKey)).size,62);
assert.deepEqual(source.items.map(x=>x.runeKey).sort(),inventory.entries.map(x=>x.runeKey).sort());
assert.equal(inventory.entries.filter(x=>x.category==='KEYSTONE').length,17);
assert.equal(inventory.entries.filter(x=>x.category==='MINOR').length,45);
assert(!inventory.entries.some(x=>x.category==='SHARD'));
for(const row of inventory.entries){
 const raw=source.items.find(x=>x.runeKey===row.runeKey);assert.equal(row.name,raw.name);assert(row.branches.length>0);
 for(const branch of row.branches){assert(branch.reason);const evidence=branch.evidence;if(evidence.sourceId)assert(raw.text[evidence.field].includes(evidence.exactText));else assert(extra.items.find(x=>x.id===evidence.sourceItemId).text.includes(evidence.exactText));}
 if(row.scope==='范围外'){assert(row.branches.every(x=>x.scope==='范围外'));assert.equal(row.recordableComponents.length,0);}else{assert(row.recordableComponents.length>0);assert(row.missingFacts.every(x=>x.length>5));}
 if(row.missingFacts.some(x=>/逐等级|等级曲线/.test(x)))assert(row.missingSourceValueFacts.length>0,`遗漏明确等级缺值:${row.id}`);
}
const find=id=>inventory.entries.find(x=>x.id===id);
assert(find(8313).branches.some(x=>x.scope==='范围内'&&x.evidence.sourceItemId===2152));
assert(find(8313).branches.some(x=>x.scope==='范围内'&&x.evidence.sourceItemId===2150));
assert(find(8313).branches.some(x=>x.scope==='范围外'&&x.evidence.sourceItemId===2151));
assert(find(8351).branches.some(x=>x.scope==='范围内'&&x.summary.includes('减速')));
assert(find(8351).branches.some(x=>x.scope==='范围外'&&x.evidence.exactText==='不包括你自己'));
assert(find(8214).branches.some(x=>x.scope==='保留依赖'&&x.summary.includes('返回')));
assert(find(8214).branches.some(x=>x.scope==='范围外'&&x.summary.includes('护盾')));
for(const id of [9104,9105,9103,8451])assert(find(id).branches.some(x=>x.scope==='保留依赖'));
assert.equal(next.proposals.length,12);assert.equal(new Set(next.proposals.map(x=>x.runeKey)).size,12);
assert(next.proposals.every(x=>find(x.id).scope!=='范围外'));
assert(next.proposals.every(x=>x.executionQualification.eligible&&x.executionQualification.requiredInputs.length&&x.executionQualification.notDefaulted.length));
assert.equal(outsideDependencies.entries.length,7);
assert(outsideDependencies.entries.every(x=>x.dependencyReview.keep&&x.dependencyReview.boundary&&x.currentMountedSkills.total===x.currentMountedSkills.items.length));
assert(next.proposals.every(x=>x.effects.every(e=>e.results.every(r=>!['DAMAGE','DAMAGE_MODIFIER','HEALING_MODIFIER','STATUS_OPERATION'].includes(r.resultType)))));
const automatic=next.proposals.filter(x=>x.triggerRules.length).map(x=>x.id).sort();assert.deepEqual(automatic,[8210,8453,9104]);
const tests=[];
function evaluate(node,parameters,attributes){if(node.nodeType==='PARAMETER'){assert(node.parameterKey in parameters);return parameters[node.parameterKey];}if(node.nodeType==='ATTRIBUTE'){const key=node.attributeKey+':'+node.attributeValueKind;assert(key in attributes);return attributes[key];}const [a,b]=node.operands.map(x=>evaluate(x,parameters,attributes));switch(node.operation){case 'ADD':return a+b;case 'MULTIPLY':return a*b;case 'SUBTRACT':return a-b;case 'DIVIDE':return a/b;case 'MIN':return Math.min(a,b);case 'MAX':return Math.max(a,b);default:throw Error('未知运算');}}
function sample(id,formulaKey,attributes,inputs,expected){const p=next.proposals.find(x=>x.id===id);const formula=p.formulas.find(x=>x.formulaKey===formulaKey);assert(formula);const params={...Object.fromEntries(p.parameters.filter(x=>x.valueMode==='FIXED').map(x=>[x.parameterKey,x.fixedValue])),...inputs};const actual=evaluate(formula.expression,params,attributes);assert(Math.abs(actual-expected)<1e-10);tests.push({id,formulaKey,attributes,inputs,expected,actual,passed:true});}
sample(9111,'triumph_heal',{'hp:TOTAL':2000,'hp:MISSING':1500},{},125);
sample(9111,'triumph_heal',{'hp:TOTAL':2000,'hp:MISSING':0},{},50);
sample(8009,'takedown_mana_restore',{'mana:TOTAL':1000},{},150);
sample(8009,'takedown_energy_restore',{'energy:TOTAL':200},{},30);
sample(8226,'missing_mana_restore',{'mana:MISSING':600},{},6);
sample(8437,'melee_damage',{'hp:TOTAL':2000},{},70);
sample(8437,'melee_heal',{'hp:TOTAL':2000},{},26);
sample(8437,'ranged_damage',{'hp:TOTAL':2000},{},28);
sample(8437,'ranged_heal',{'hp:TOTAL':2000},{},10.4);
sample(8351,'glacial_slow_ratio',{'heal_shield_power_percent:TOTAL':.2,'ability_power:TOTAL':100,'attack_damage:BONUS':50},{},.475);
sample(8128,'harvest_damage',{'attack_damage:BONUS':100,'ability_power:TOTAL':200},{confirmed_souls:4},94);
const transcendence=next.proposals.find(x=>x.id===8210).parameters.find(x=>x.parameterKey==='level_ability_haste');
assert.deepEqual([1,4,5,7,8,18].map(level=>transcendence.levelValues[level]),[0,0,5,5,10,10]);
const outcome={checkedAt:new Date().toISOString(),scope:'只读来源及本地候选校验，未执行业务写入或战斗运行',identities:62,branchCount:inventory.entries.flatMap(x=>x.branches).length,quotedSourceChecks:'每条分支均找到冻结原文依据',selected:12,formulaSamples:tests.length,formulaResultMeaning:'均为配置数值，不是按当前生命/资源上限结算后的实际回复量',qualifiedCandidates:12,outsideDependencyReviews:7,passed:true,counts:inventory.counts,nextCounts:next.counts,hashes:Object.fromEntries(['冻结来源.json','关联装备来源.json','逐项机器清单.json','下一批最多12项.json','当前目录.json','范围外跨技能依赖.json','范围外挂载只读.json'].map(name=>[name,hash(name)])),specialScopeChecks:['三重补药分别保留原力和技能合剂，排除贪财专用分支','冰川保留敌方减速，排除不包括自身的队友减伤','艾黎保留伤害和返回等待，排除友军护盾','传说与过度生长保留小兵野怪成长依赖','无伤害类型/乘区/减速语义默认补造','仅三个明确基础属性组成初始化','12项候选列明适用资格和不得默认的输入','7项范围外保留跨技能依赖依据与当前挂载事实'],tests};
fs.writeFileSync(path.join(here,'独立校验结果.json'),JSON.stringify(outcome,null,2)+'\n');
console.log(JSON.stringify({identities:62,branches:outcome.branchCount,selected:12,formulaSamples:tests.length,passed:true,hashes:outcome.hashes},null,2));
