// 只读候选；本目录生成等价核算证据，不调用业务接口。
import {readFile,writeFile} from 'node:fs/promises';
import {loadPlan,independentArithmetic,here,approvedCorrection} from './录入工具.mjs';
if(process.argv.length!==2)throw Error('不接受写入参数');
const read=async name=>JSON.parse(await readFile(new URL(name,here),'utf8'));
const front=await read('前十技能候选.json'),back=await read('后十技能候选.json'),patch=await read(approvedCorrection.file);
const original={meta:{gameId:'lol'},skills:{...front.skills,...back.skills}},loaded=await loadPlan();
const before=await independentArithmetic(original,new URL('接口纠错核算/原式/',here));
const after=await independentArithmetic(loaded.plan,new URL('接口纠错核算/展开后/',here));
const matches=before.arithmetic.map((b,i)=>({name:b.name,skillKey:b.skillKey,before:b.actual,after:after.arithmetic[i]?.actual,match:b.match&&after.arithmetic[i]?.match&&Math.abs(b.actual-after.arithmetic[i].actual)<1e-9}));
function evaluate(skill,node,{rank,attributes,runtime},stack=[]){
 if(node.kind==='FORMULA'){if(stack.includes(node.formulaKey))throw Error('公式循环');return evaluate(skill,skill.write.formulas.find(f=>f.formulaKey===node.formulaKey).expression,{rank,attributes,runtime},[...stack,node.formulaKey]);}
 if(node.nodeType==='PARAMETER'){const p=skill.write.parameters.find(p=>p.parameterKey===node.parameterKey);const n=p.valueMode==='FIXED'?p.fixedValue:p.valueMode==='RUNTIME_INPUT'?runtime[p.parameterKey]:p.levelValues[String(rank)];if(!Number.isFinite(n))throw Error('缺输入 '+p.parameterKey);return n;}
 if(node.nodeType==='ATTRIBUTE'){const n=attributes[[node.attributeOwner,node.attributeKey,node.attributeValueKind].join('.')];if(!Number.isFinite(n))throw Error('缺属性');return n;}
 if(node.nodeType==='OPERATION'){const [a,b]=node.operands.map(v=>evaluate(skill,v,{rank,attributes,runtime},stack));if(node.operation==='ADD')return a+b;if(node.operation==='MULTIPLY')return a*b;}
 throw Error('本次独立核算不接受其他节点');
}
const scenarios=[
 {totalAD:100,bonusAD:0,criticalChance:0,extraCritical:0,inputAD:0,targetMaxHP:2000,targetCurrentHP:2000},
 {totalAD:200,bonusAD:100,criticalChance:.25,extraCritical:.4,inputAD:200,targetMaxHP:2000,targetCurrentHP:1500},
 {totalAD:300,bonusAD:100,criticalChance:.25,extraCritical:.4,inputAD:200,targetMaxHP:5000,targetCurrentHP:1000},
 {totalAD:200,bonusAD:50,criticalChance:1,extraCritical:.5,inputAD:100,targetMaxHP:1000,targetCurrentHP:999},
 {totalAD:350,bonusAD:250,criticalChance:.5,extraCritical:0,inputAD:400,targetMaxHP:3000,targetCurrentHP:100},
 {totalAD:200,bonusAD:100,criticalChance:.25,extraCritical:.4,inputAD:200,targetMaxHP:5000,targetCurrentHP:1000}
];
const differences=[];
for(const entry of patch.entries)for(const rank of [1,2,3])for(const values of scenarios){
 const attributes={'SOURCE.attack_damage.TOTAL':values.totalAD,'SOURCE.attack_damage.BONUS':values.bonusAD,'SOURCE.critical_strike_chance.TOTAL':values.criticalChance,'SOURCE.critical_strike_damage_bonus_percent.TOTAL':values.extraCritical,'TARGET.hp.TOTAL':values.targetMaxHP,'TARGET.hp.CURRENT':values.targetCurrentHP,'TARGET.hp.MISSING':values.targetMaxHP-values.targetCurrentHP};
 const input={rank,attributes,runtime:{current_attack_damage_value:values.inputAD}},skill=original.skills[entry.skillKey];
 const a=evaluate(skill,entry.before.expression,input),b=evaluate(skill,entry.body.expression,input);
 const expected=entry.skillKey==='caitlyn_r'?([300,475,650][rank-1]+values.bonusAD)*(1+values.criticalChance*.3*(1+values.extraCritical)):([64,128,192][rank-1]+.25*values.inputAD)*4;
 differences.push({skillKey:entry.skillKey,formulaKey:entry.id,rank,input:values,before:a,after:b,independentExpected:expected,match:Math.abs(a-b)<1e-9&&Math.abs(b-expected)<1e-9});
}
const failures=[...before.failures,...after.failures,...matches.filter(v=>!v.match),...differences.filter(v=>!v.match)];
const report={at:new Date().toISOString(),correction:approvedCorrection,finalRequestSha256:loaded.planSha256,boundary:'仅原式/等价展开和独立数学对照；生命变化不为烬R补写未知连续增幅，测试的始终是最大端点。实际保存后仍需独立GET再核算。',originalCases:matches,variationCases:differences,beforeInvariants:before.invariants.length,afterInvariants:after.invariants.length,failures};
await writeFile(new URL('接口纠错独立核算.json',here),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({originalCases:matches.length,variationCases:differences.length,invariants:after.invariants.length,failures:failures.length,finalRequestSha256:loaded.planSha256}));
if(failures.length)process.exitCode=1;
