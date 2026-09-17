import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),read=f=>JSON.parse(fs.readFileSync(path.join(here,f)));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const candidate=read('可审查候选.json'),request=read('可审查请求.json'),frozen=read('冻结来源.json');
assert.equal(request.candidateSha256,sha(fs.readFileSync(path.join(here,'可审查候选.json'))));
const byId=new Map(candidate.proposals.map(p=>[p.id,p]));
const records=[],constraints=[],sourceChecks=[];
const check=(label,value)=>{assert.ok(value,label);constraints.push({label,passed:true});};
for(const p of candidate.proposals){
 const keys=new Set(p.parameters.map(x=>x.parameterKey));check(p.id+' 唯一参数',keys.size===p.parameters.length);
 for(const param of p.parameters){check(p.id+'/'+param.parameterKey+' 精确参数字段',Object.keys(param).sort().join(',')===['parameterKey','name','valueType','valueMode','fixedValue','levelValues','description','sortOrder'].sort().join(','));if(param.valueMode==='RUNTIME_INPUT'){check(p.id+'/'+param.parameterKey+' 输入无默认',param.fixedValue===null&&param.levelValues===null);}}
 const source=frozen.entries.find(s=>s.current.id===p.id).current;
 for(const evidence of p.parameterEvidence.filter(e=>e.sourcePath)){
  const field=evidence.sourcePath.split('/').at(-1),raw=source.object.mScript.mSpellScriptData.mEffectAmount[field],param=p.parameters.find(x=>x.parameterKey===evidence.parameterKey);
  assert.equal(raw,evidence.sourceRawValue);assert.ok(Math.abs(raw*evidence.scale-param.fixedValue)<Math.max(1e-6,Math.abs(param.fixedValue)*1e-7));
  sourceChecks.push({id:p.id,parameterKey:param.parameterKey,sourcePath:evidence.sourcePath,raw,scale:evidence.scale,stored:param.fixedValue,passed:true});
 }
 function node(n){check(p.id+' 公式合法节点', ['PARAMETER','ATTRIBUTE','OPERATION'].includes(n.nodeType));if(n.nodeType==='PARAMETER')check(p.id+' 公式参数存在',keys.has(n.parameterKey));else if(n.nodeType==='OPERATION'){check(p.id+' 合法双目运算',['ADD','SUBTRACT','MULTIPLY','DIVIDE','MIN','MAX'].includes(n.operation)&&n.operands?.length===2);n.operands.forEach(node);}else check(p.id+' 明确属性读数',['SOURCE','TARGET'].includes(n.attributeOwner)&&['TOTAL','CURRENT','MISSING','BONUS','BASE'].includes(n.attributeValueKind));}
 p.formulas.forEach(f=>node(f.expression));check(p.id+' 无默认触发或过程',p.triggerRules.length===0&&p.processes.length===0&&p.internalStates.length===0);
 for(const e of p.effects){check(p.id+' 独立固定属性效果',e.results.every(r=>r.resultType==='ATTRIBUTE_CHANGE'&&r.target==='SOURCE'&&r.detail.modifierZoneKey==='attribute_flat_add'));check(p.id+' 不执行未知运行输入',e.results.every(r=>p.parameters.find(k=>k.parameterKey===r.valueRule.value.parameterKey)?.valueMode==='FIXED'));}
}
function evaluate(id,key,inputs={},attributes={}){
 const p=byId.get(id),params=new Map(p.parameters.map(q=>[q.parameterKey,q])),f=p.formulas.find(f=>f.formulaKey===key);assert.ok(f);
 function calc(n){
  if(n.nodeType==='PARAMETER'){const q=params.get(n.parameterKey);if(q.valueMode==='FIXED')return q.fixedValue;if(!Object.hasOwn(inputs,n.parameterKey))throw Error('缺少明确输入 '+n.parameterKey);if(q.valueType==='INTEGER')assert.ok(Number.isInteger(inputs[n.parameterKey]));return inputs[n.parameterKey];}
  if(n.nodeType==='ATTRIBUTE'){const k=`${n.attributeOwner}.${n.attributeKey}.${n.attributeValueKind}`;if(!Object.hasOwn(attributes,k))throw Error('缺少属性 '+k);return attributes[k];}
  const[a,b]=n.operands.map(calc);switch(n.operation){case'ADD':return a+b;case'SUBTRACT':return a-b;case'MULTIPLY':return a*b;case'DIVIDE':return a/b;case'MIN':return Math.min(a,b);case'MAX':return Math.max(a,b);default:throw Error('未知运算');}
 }return calc(f.expression);
}
function sample(id,key,inputs,attributes,expected,reason){const actual=evaluate(id,key,inputs,attributes);assert.ok(Math.abs(actual-expected)<1e-9,`${id}/${key} ${actual} != ${expected}`);records.push({id,formulaKey:key,inputs,attributes,expected,actual,reason,passed:true});}
// 独立预期直接写自当前说明及原始字段，不调用候选生成器或复制其表达式。
for(const [stacks,expected]of [[0,0],[1,8],[4,32]])sample(8105,'out_of_combat_move_speed',{confirmed_bounty_stacks:stacks},{},expected,'当前说明8×已确认层数；0是本算例显式输入而非默认。');
for(const [stacks,expected]of [[0,6],[1,11],[4,26]])sample(8106,'ultimate_haste',{confirmed_bounty_stacks:stacks},{},expected,'当前说明6+5×层数，只是终极急速点数。');
for(const [total,instant,remaining]of [[150,60,90],[120,48,72],[0,0,0]]){
 sample(8352,'instant_potion_heal_budget',{confirmed_potion_total_heal:total},{},instant,'假定已核实的药水总额度，40%提前。');sample(8352,'remaining_potion_heal_budget',{confirmed_potion_total_heal:total},{},remaining,'剩余60%，不是原100%再加40%。');check('药剂额度守恒 '+total,instant+remaining===total);
}
for(const [id,threshold]of [[8014,400],[8017,600]]){
 sample(id,'target_health_threshold',{}, {'TARGET.hp.TOTAL':1000},threshold,'门槛使用目标最大生命，比较由另行核实的合法时点执行。');
 sample(id,'extra_damage_amount',{confirmed_eligible_damage:1000},{},80,'已确认适用伤害的8%；未假定哪个伤害阶段。');
}
sample(8429,'armor_tooltip_amount',{confirmed_armor_basis:100},{},11,'提示原树常数8与明确输入100的3%相加；不是声明其真实取值次序。');
sample(8429,'magic_resistance_tooltip_amount',{confirmed_magic_resistance_basis:50},{},9.5,'提示原树常数8与明确输入50的3%相加。');
sample(8429,'armor_tooltip_amount',{confirmed_armor_basis:0},{},8,'零是显式算例输入。');
sample(8444,'healing_total_budget',{}, {'SOURCE.hp.MISSING':400},16,'缺400时十秒总额度16；不代表任何单跳值。');
sample(8444,'healing_total_budget',{}, {'SOURCE.hp.MISSING':0},0,'满血时没有已损额度；没有额外固定治疗。');
for(const [tiers,hp]of [[0,0],[1,3],[15,45],[16,48]])sample(8451,'permanent_flat_health',{confirmed_completed_tiers:tiers},{},hp,'已确认完成档数×3，没有推断最大档数。');
sample(8451,'threshold_percent_health',{confirmed_max_health_basis:2000},{},70,'只有已满足门槛且基数明确的独立3.5%数值。');
for(const [bonus,extra]of [[0,0],[50,3.5],[100,7]])sample(8234,'amplified_movement_bonus_increment',{confirmed_eligible_movement_bonus:bonus},{},extra,'增强的是已确认合法移动加成，非整个角色移动速度。');
const boundaries=[];
for(const [id,values,expected]of [[8014,[399,400,401],[true,false,false]],[8017,[599,600,601],[false,false,true]]]){
 const threshold=id===8014?400:600;const actual=values.map(v=>id===8014?v<threshold:v>threshold);assert.deepEqual(actual,expected);boundaries.push({id,maxHp:1000,currentHp:values,expectedEligibility:expected,note:'独立检查严格边界；候选未生成条件或自动伤害规则。'});
}
const tiers=[[7,0,0],[8,1,3],[15,1,3],[119,14,42],[120,15,45]];
for(const [units,completed,hp]of tiers){assert.equal(Math.floor(units/8),completed);assert.equal(completed*3,hp);boundaries.push({id:8451,units,completedTiers:completed,flatHp:hp,ratioEligible:units>=120,note:'仅核对来源每8个完成一档的含义；现行公式不支持FLOOR，生成时必须提供已确认整数档数。'});}
for(const [id,key]of [[8105,'out_of_combat_move_speed'],[8106,'ultimate_haste'],[8352,'instant_potion_heal_budget'],[8014,'extra_damage_amount'],[8429,'armor_tooltip_amount'],[8451,'permanent_flat_health'],[8234,'amplified_movement_bonus_increment']]){assert.throws(()=>evaluate(id,key));constraints.push({label:`${id}/${key} 缺输入不能默认0`,passed:true});}
assert.throws(()=>evaluate(8451,'permanent_flat_health',{confirmed_completed_tiers:1.875}));
const count=request.requests.reduce((a,r)=>(a[r.kind]=(a[r.kind]||0)+1,a),{});assert.deepEqual(count,{skill:12,parameter:37,formula:14,effect:3,relation:12});
check('12身份唯一',new Set(candidate.proposals.map(x=>x.runeKey)).size===12);
check('所有请求无新符文或图片',request.requests.every(r=>r.route.startsWith('/skills')||r.route==='/rune-skill-relations'));
check('没有FORMULA作为表达式子节点',!JSON.stringify(candidate.proposals.map(p=>p.formulas)).includes('"kind":"FORMULA"'));
check('没有伤害结果/伪造治疗/技能范围',candidate.proposals.flatMap(p=>p.effects).flatMap(e=>e.results).every(r=>r.resultType==='ATTRIBUTE_CHANGE'));
const combinations=[
 {id:8304,existingEquipmentFlat:25,independentExtra:10,expectedCombined:35,rejected:45,note:'真实只读确认item_2422只有25且没有装备技能关系；不能先改直接属性成35再叠本效果10。'},
 {id:8429,inputArmor:100,flat:8,ratio:.03,flatThenRatio:111.24,ratioThenFlat:111,status:'组合顺序待证，两结果不同，不任选其一；保存的固定组成和提示公式不等于完整调节。'},
 {id:8234,baseMoveSpeed:325,eligibleBonus:50,extraFromSevenPercent:3.5,incorrectWholeTotalIncrease:26.25,status:'1%部分及完整移速顺序未合并；不能把375全部当7%基数。'},
];
const out={at:new Date().toISOString(),kind:'候选静态及独立数学检查，不是API保存或战斗运行',sourceChecks,constraints,formulaCases:records,boundaries,combinations,summary:{selectedRunes:12,sourceParametersVerified:sourceChecks.length,formulaCount:14,formulaCases:records.length,constraints:constraints.length,boundaryCases:boundaries.length,requests:78,businessWrites:0},requestSha256:sha(fs.readFileSync(path.join(here,'可审查请求.json')))};
fs.writeFileSync(path.join(here,'独立核对结果.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out.summary));
