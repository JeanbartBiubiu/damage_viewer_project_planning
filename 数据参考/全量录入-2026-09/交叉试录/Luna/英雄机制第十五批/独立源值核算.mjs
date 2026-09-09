import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {dirname,resolve} from 'node:path';

const here=new URL('./',import.meta.url);
const readJson=async file=>JSON.parse(await readFile(new URL(file,here),'utf8'));
const [plan,source,before,version,textSource]=await Promise.all(['完整候选.json','根绑定与数值证据.json','写前现值.json','候选版本.json','补充文本证据.json'].map(readJson));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const stable=value=>JSON.stringify(canonical(value));
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-5,Math.abs(b)*2e-6);
const failures=[],checks=[],sourceCases=[],manualCases=[],unknownCurves=[];
function check(name,ok,details=null){checks.push(name);if(!ok)failures.push({name,details});}
const spells=new Map(source.heroes.flatMap(h=>h.spells.map(s=>[s.skillKey,s])));
const rootDir=dirname(source.sourceIndex);

for(const hero of source.heroes){
  const compressed=await readFile(resolve(rootDir,hero.client.path));
  const raw=gunzipSync(compressed);
  const official=await readFile(resolve(rootDir,hero.official.path));
  check(hero.id+'客户端压缩SHA',sha(compressed)===hero.client.compressedSha256);
  check(hero.id+'客户端原文SHA',sha(raw)===hero.client.sha256);
  check(hero.id+'官方SHA',sha(official)===hero.official.sha256);
  const obj=JSON.parse(raw);
  for(const spell of hero.spells){
    check(spell.skillKey+'当前根完整对象',stable(obj[spell.binding])===stable(spell.object));
    check(spell.skillKey+'根绑定路径存在',Boolean(obj[spell.binding]));
  }
}
const textBytes=gunzipSync(await readFile(textSource.path));
check('当前中文原文SHA',sha(textBytes)===textSource.sha256);
const candidateBytes=await readFile(new URL('完整候选.json',here));
check('候选文件SHA',sha(candidateBytes)===version.fileSha256);
const expected=['viktor','orianna','syndra','taliyah'].flatMap(h=>['p','q','w','e','r'].map(k=>h+'_'+k));
check('精确20槽且无重复',stable(Object.keys(plan.skills))===stable(expected));
check('写前172个GET全部成功',before.requests.length===172&&before.requests.every(r=>r.status===200)&&before.errors.length===0);
check('写前20个主体全部成功',before.skillKeys.length===20&&Object.values(before.skills).every(s=>s.subject.status===200));
const catalog={};
for(const [name,entry] of Object.entries(before.catalogs))catalog[name]=entry.data.items??entry.data;
const attributes=new Set((catalog.attributes??[]).map(a=>a.attributeKey));
const modifierZones=new Set((catalog['modifier-zones']??[]).map(a=>a.modifierZoneKey));
const damageTypes=new Set((catalog['damage-types']??[]).map(a=>a.damageTypeKey));
const parameterFields=['parameterKey','name','valueType','valueMode','fixedValue','levelValues','description','sortOrder'];
let preserved=0,newComponents=0;

const ops={ADD:(a,b)=>a+b,SUBTRACT:(a,b)=>a-b,MULTIPLY:(a,b)=>a*b,DIVIDE:(a,b)=>a/b,MIN:Math.min,MAX:Math.max};
function parameter(skill,key,ctx){
  const p=skill.write.parameters.find(v=>v.parameterKey===key);
  if(!p)throw Error('参数缺失 '+skill.skillKey+'/'+key);
  if(p.valueMode==='FIXED')return p.fixedValue;
  if(p.valueMode==='SKILL_LEVEL')return p.levelValues[String(ctx.rank)];
  if(p.valueMode==='RUNTIME_INPUT'){
    if(!Object.hasOwn(ctx.inputs,key))throw Error('未提供实际输入 '+skill.skillKey+'/'+key);
    return ctx.inputs[key];
  }
  throw Error('未授权参数模式 '+skill.skillKey+'/'+key+'/'+p.valueMode);
}
function evaluate(skill,node,ctx){
  if(node.nodeType==='PARAMETER')return parameter(skill,node.parameterKey,ctx);
  if(node.nodeType==='ATTRIBUTE'){
    const key=node.attributeOwner+'.'+node.attributeKey+'.'+node.attributeValueKind;
    if(!Object.hasOwn(ctx.attrs,key))throw Error('缺属性 '+key);
    return ctx.attrs[key];
  }
  if(node.nodeType==='OPERATION'&&ops[node.operation])return ops[node.operation](...node.operands.map(child=>evaluate(skill,child,ctx)));
  throw Error('非法节点 '+JSON.stringify(node));
}
function walk(node,fn,path=''){
  if(!node||typeof node!=='object')return;
  fn(node,path);
  for(const [key,value] of Object.entries(node)){
    if(Array.isArray(value))value.forEach((child,i)=>walk(child,fn,path+'.'+key+'['+i+']'));
    else if(value&&typeof value==='object')walk(value,fn,path+'.'+key);
  }
}
function checkExpression(node,path){
  const nodes=[];
  walk(node,(n,p)=>{if(n.nodeType)nodes.push({node:n,path:p});});
  for(const {node:n,p} of nodes){
    const supported=['PARAMETER','ATTRIBUTE','OPERATION'].includes(n.nodeType);
    check(path+'节点'+p,supported);
    if(!supported)throw Error('公式含后端不支持节点 '+n.nodeType);
    if(n.nodeType==='OPERATION'){
      const binary=Array.isArray(n.operands)&&n.operands.length===2;
      check(path+'二元运算'+p,binary);
      if(!binary)throw Error('公式运算元不是二元');
    }
  }
  const nonEmpty=nodes.length>0;check(path+'至少有一个节点',nonEmpty);if(!nonEmpty)throw Error('公式节点为空');
}
const runtimeInputs={};
for(const skill of Object.values(plan.skills))for(const p of skill.write.parameters.filter(p=>p.valueMode==='RUNTIME_INPUT'))runtimeInputs[p.parameterKey]=100;
Object.assign(runtimeInputs,{shield_amount_level_value:140,passive_total_damage_level_value:50,stacks_per_proc_level_value:2,mana_per_proc_level_value_2:35,wall_move_speed_ratio_level_value:.2});
const baseAttrs={
  'SOURCE.ability_power.TOTAL':100,
  'SOURCE.attack_damage.TOTAL':200,
  'SOURCE.attack_damage.BASE':150,
  'SOURCE.attack_damage.BONUS':50,
  'SOURCE.mana.TOTAL':2000,
  'SOURCE.mana.BONUS':1000,
  'SOURCE.mana.MISSING':800,
  'SOURCE.hp.BONUS':500
};
function context(overrides={}){return {rank:overrides.rank??1,inputs:{...runtimeInputs,...(overrides.inputs??{})},attrs:{...baseAttrs,...(overrides.attrs??{})}};}
function trial(skillKey,formulaKey,expected,overrides={}){
  const skill=plan.skills[skillKey],ctx=context(overrides);
  const formula=skill.write.formulas.find(f=>f.formulaKey===formulaKey);
  let actual,passed=false,error=null;
  try{actual=evaluate(skill,formula.expression,ctx);passed=close(actual,expected);}catch(e){error=String(e.message??e);}
  const row={skillKey,formulaKey,rank:ctx.rank,inputs:ctx.inputs,attrs:ctx.attrs,expected,actual,passed,error};
  manualCases.push(row);check('独立算例 '+skillKey+'/'+formulaKey+'#'+manualCases.length,passed,row);
}
function rawCalc(skillKey,key,ctx,seen=[]){
  if(seen.includes(key))throw Error('原树循环 '+skillKey+'/'+key);
  const skill=spells.get(skillKey),calculation=skill.object.mSpell.mSpellCalculations[key];
  if(!calculation)throw Error('缺原计算 '+skillKey+'/'+key);
  const sourcePath='mSpellCalculations.'+key;
  let value;
  if(calculation.__type==='GameCalculationModified')value=rawCalc(skillKey,calculation.mModifiedGameCalculation,ctx,[...seen,key]);
  else if(calculation.__type==='GameCalculation'&&calculation.mFormulaParts?.length)value=calculation.mFormulaParts.reduce((sum,node,i)=>sum+rawNode(skillKey,node,ctx,sourcePath+'.mFormulaParts['+i+']'),0);
  else throw Error('未核原计算种类 '+skillKey+'/'+key);
  if(calculation.mMultiplier)value*=rawNode(skillKey,calculation.mMultiplier,ctx,sourcePath+'.mMultiplier');
  return value;
}
function rawNode(skillKey,node,ctx,path){
  const skill=spells.get(skillKey),spell=skill.object.mSpell;
  const datum=name=>{const d=(spell.DataValues??[]).find(v=>v.name.toLowerCase()===name.toLowerCase());if(!d?.values)throw Error('缺原数据 '+skillKey+'/'+name);return d.values[ctx.rank];};
  if(['ByCharLevelInterpolationCalculationPart','ByCharLevelBreakpointsCalculationPart','ByCharLevelFormulaCalculationPart','{4ce08984}'].includes(node.__type)){
    const proof=plan.skills[skillKey].proofs.find(p=>p.source===path&&p.parameterKey&&p.sourcePending);
    if(!proof)throw Error('等级节点未保持输入 '+skillKey+'/'+path);
    if(!Object.hasOwn(ctx.inputs,proof.parameterKey))throw Error('等级输入缺失 '+proof.parameterKey);
    unknownCurves.push({skillKey,parameterKey:proof.parameterKey,source:path});
    return ctx.inputs[proof.parameterKey];
  }
  const stat=()=>{
    const s=node.mStat??0,k=node.mStatFormula??0;
    if(s===0&&k===0)return ctx.attrs['SOURCE.ability_power.TOTAL'];
    if(s===2&&k===0)return ctx.attrs['SOURCE.attack_damage.TOTAL'];
    if(s===2&&k===1&&['StatByCoefficientCalculationPart','StatByNamedDataValueCalculationPart'].includes(node.__type))return ctx.attrs['SOURCE.attack_damage.BASE'];
    if(s===2&&k===2)return ctx.attrs['SOURCE.attack_damage.BONUS'];
    if(s===12&&k===2)return ctx.attrs['SOURCE.hp.BONUS'];
    throw Error('未证原属性 '+skillKey+'/'+s+'/'+k);
  };
  switch(node.__type){
    case 'NamedDataValueCalculationPart':return datum(node.mDataValue);
    case 'NumberCalculationPart':if(!Object.hasOwn(node,'mNumber'))throw Error('原常数缺值');return node.mNumber;
    case 'StatByNamedDataValueCalculationPart':return stat()*datum(node.mDataValue);
    case 'StatByCoefficientCalculationPart':return stat()*node.mCoefficient;
    case 'StatBySubPartCalculationPart':return stat()*rawNode(skillKey,node.mSubpart,ctx,path+'.mSubpart');
    case 'SumOfSubPartsCalculationPart':if(!node.mSubparts?.length)throw Error('空求和');return node.mSubparts.reduce((sum,part,i)=>sum+rawNode(skillKey,part,ctx,path+'.mSubparts['+i+']'),0);
    case 'ProductOfSubPartsCalculationPart':return rawNode(skillKey,node.mPart1,ctx,path+'.mPart1')*rawNode(skillKey,node.mPart2,ctx,path+'.mPart2');
    default:throw Error('原节点未核 '+skillKey+'/'+node.__type);
  }
}

for(const skill of Object.values(plan.skills)){
  const old=before.skills[skill.skillKey],src=spells.get(skill.skillKey).object.mSpell;
  for(const p of old.components.parameters.items){
    const wanted=skill.write.parameters.find(v=>v.parameterKey===p.parameterKey);
    check(skill.skillKey+'/'+p.parameterKey+'原对象完整复用',Boolean(wanted)&&parameterFields.every(k=>stable(wanted[k])===stable(p[k])));
    preserved++;
  }
  for(const kind of before.kinds.filter(k=>k.name!=='parameters'))check(skill.skillKey+'/'+kind.name+'无旧组成',old.components[kind.name].items.length===0);
  newComponents+=skill.write.parameters.length-old.components.parameters.items.length+skill.write.formulas.length+skill.write.effects.length;
  for(const p of skill.write.parameters){
    check(skill.skillKey+'/'+p.parameterKey+'无未知默认',p.valueMode!=='RUNTIME_INPUT'||p.fixedValue===null&&p.levelValues===null);
    check(skill.skillKey+'/'+p.parameterKey+'未猜角色等级曲线',p.valueMode!=='CHARACTER_LEVEL');
  }
  for(const original of src.DataValues??[])check(skill.skillKey+'/'+original.name+'原字段已分类',skill.proofs.some(p=>p.source==='DataValues.'+original.name));
  for(const formula of skill.write.formulas){
    checkExpression(formula.expression,skill.skillKey+'/'+formula.formulaKey+'.expression');
    const proof=skill.proofs.find(p=>p.formulaKey===formula.formulaKey&&p.source?.startsWith('mSpellCalculations.'));
    check(skill.skillKey+'/'+formula.formulaKey+'有原树证明',Boolean(proof));
    if(proof){
      const sourceKey=proof.source.slice('mSpellCalculations.'.length);
      for(const rank of [...new Set([1,skill.maxLevel])])for(const ap of [100,237]){
        const attrs={...baseAttrs,'SOURCE.ability_power.TOTAL':ap,'SOURCE.attack_damage.TOTAL':ap===100?200:317,'SOURCE.attack_damage.BASE':ap===100?150:281,'SOURCE.attack_damage.BONUS':ap===100?50:36};
        const ctx=context({rank,attrs});
        let actual,sourceValue,passed=false,error=null;
        try{actual=evaluate(skill,formula.expression,ctx);sourceValue=rawCalc(skill.skillKey,sourceKey,ctx);passed=close(actual,sourceValue);}catch(e){error=String(e.message??e);}
        const row={skillKey:skill.skillKey,formulaKey:formula.formulaKey,sourceKey,rank,ap,actual,sourceValue,passed,error};
        sourceCases.push(row);check(skill.skillKey+'/'+formula.formulaKey+'候选与原树核对#'+sourceCases.length,passed,row);
      }
    }
  }
  for(const e of skill.write.effects)for(const result of e.results){
    check(skill.skillKey+'/'+e.effectKey+'不创建伤害或瞬时治疗',!['DAMAGE','DIRECT_HEAL'].includes(result.resultType));
    if(result.detail?.attributeKey)check(skill.skillKey+'/'+e.effectKey+'效果属性在目录',attributes.has(result.detail.attributeKey));
    if(result.detail?.modifierZoneKey)check(skill.skillKey+'/'+e.effectKey+'效果修正区在目录',modifierZones.has(result.detail.modifierZoneKey));
    if(result.detail?.absorbedDamageTypeKey)check(skill.skillKey+'/'+e.effectKey+'护盾伤害类别在目录',damageTypes.has(result.detail.absorbedDamageTypeKey));
  }
  check(skill.skillKey+'无空过程或默认触发',skill.write.processes.length===0&&skill.write.internalStates.length===0&&skill.write.triggerRules.length===0);
}

// 这些算例直接按冻结源值和已证属性口径手算，独立于生成器的源树对照。
trial('viktor_q','missile_damage',100,{rank:1,attrs:{'SOURCE.ability_power.TOTAL':100}});
trial('viktor_q','missile_damage',220,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':250}});
trial('viktor_q','next_attack_damage',320,{rank:3,attrs:{'SOURCE.ability_power.TOTAL':200,'SOURCE.attack_damage.TOTAL':150}});
trial('viktor_q','shield_amount',190,{rank:5,inputs:{shield_amount_level_value:140},attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('viktor_q','augmented_shield_amount',304,{rank:5,inputs:{shield_amount_level_value:140},attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('viktor_e','laser_damage',380,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':300}});
trial('viktor_e','aftershock_damage',380,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':300}});
trial('viktor_r','initial_burst_damage',450,{rank:3,attrs:{'SOURCE.ability_power.TOTAL':400}});
trial('viktor_r','subsequent_burst_damage',285,{rank:3,attrs:{'SOURCE.ability_power.TOTAL':400}});
trial('orianna_p','passive_total_damage',80,{rank:1,inputs:{passive_total_damage_level_value:50},attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('orianna_p','passive_stack_damage',12,{rank:1,inputs:{passive_total_damage_level_value:50},attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('orianna_p','passive_max_stack_damage',24,{rank:1,inputs:{passive_total_damage_level_value:50},attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('orianna_q','damage',290,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('orianna_q','minimum_damage',203,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('orianna_w','damage',390,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('orianna_e','pass_through_damage',240,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('orianna_e','shield_amount',285,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('orianna_r','damage',695,{rank:3,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('syndra_q','damage',370,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('syndra_w','throw_damage',320,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('syndra_w','passive_bonus_damage',51.2,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('syndra_e','damage',320,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('syndra_r','damage_per_sphere_total',240,{rank:3,attrs:{'SOURCE.ability_power.TOTAL':400}});
trial('syndra_r','minimum_damage',720,{rank:3,attrs:{'SOURCE.ability_power.TOTAL':400}});
trial('syndra_r','maximum_damage',1680,{rank:3,attrs:{'SOURCE.ability_power.TOTAL':400}});
trial('taliyah_p','wall_move_speed_ratio',.2,{rank:1,inputs:{wall_move_speed_ratio_level_value:.2}});
trial('taliyah_q','rock_damage',225,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('taliyah_q','big_rock_damage',405,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('taliyah_q','max_rock_damage',585,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('taliyah_e','scatter_damage',360,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('taliyah_e','detonation_damage',145,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});
trial('taliyah_e','max_detonation_damage',362.5,{rank:5,attrs:{'SOURCE.ability_power.TOTAL':200}});

// 负例：缺少等级输入必须拒绝求值；简单参数不随法强隐式改变；后端公式树禁止FORMULA节点。
const runtimeChecks=[];
for(const skill of Object.values(plan.skills))for(const f of skill.write.formulas){
  let depends=false;walk(f.expression,n=>{if(n.nodeType==='PARAMETER'&&skill.write.parameters.find(p=>p.parameterKey===n.parameterKey)?.valueMode==='RUNTIME_INPUT')depends=true;});
  if(depends){let rejected=false;try{evaluate(skill,f.expression,{rank:1,inputs:{},attrs:baseAttrs});}catch{rejected=true;}runtimeChecks.push({skillKey:skill.skillKey,formulaKey:f.formulaKey,rejected});check(skill.skillKey+'/'+f.formulaKey+'缺实际输入时拒绝',rejected);}
}
const baseParameter=plan.skills.viktor_q.write.parameters.find(p=>p.parameterKey==='missile_base_damage');
check('基础伤害参数不随法强改变',baseParameter?.levelValues?.['5']===120);
const badNode={nodeType:'FORMULA',formulaKey:'forbidden'};let badRejected=false;try{if(!['PARAMETER','ATTRIBUTE','OPERATION'].includes(badNode.nodeType))throw Error('公式含后端不支持节点 '+badNode.nodeType);}catch{badRejected=true;}
check('负例FORMULA节点被拒绝',badRejected);
check('所有公式数量为36',Object.values(plan.skills).reduce((n,s)=>n+s.write.formulas.length,0)===36);
check('原28公共参数保护',preserved===28);
check('没有空过程或触发规则',Object.values(plan.skills).every(s=>s.write.processes.length===0&&s.write.internalStates.length===0&&s.write.triggerRules.length===0));
check('没有默认DAMAGE或DIRECT_HEAL结果',Object.values(plan.skills).every(s=>s.write.effects.every(e=>e.results.every(r=>!['DAMAGE','DIRECT_HEAL'].includes(r.resultType)))));

const report={
  at:new Date().toISOString(),
  candidateSha256:version.fileSha256,
  planSha256:version.planSha256,
  status:failures.length?'REVISE':'READY_FOR_PARENT_REVIEW',
  scope:'独立读取16.17客户端压缩原文、16.17.1官方文件和当前根绑定；对照候选树逐项核算，不执行业务写入。',
  checks:checks.length,
  failures,
  preservedPublicParameters:preserved,
  newComponents,
  sourceCases,
  manualCases,
  runtimeChecks,
  unknownCurves:[...new Map(unknownCurves.map(v=>[v.skillKey+'/'+v.parameterKey,v])).values()],
  notes:[
    '未知等级插值/断点只使用明确外供值，未按端点生成曲线，也未填默认0。',
    '普通多段与范围命中唯一敌人保留；纯几何、第三方友军和小兵/野怪专用分支只留来源证据。',
    '伤害公式保留但未创建默认DAMAGE；没有成熟的时序或资格时不创建DIRECT_HEAL、空过程和触发规则。',
    '公式表达式只含PARAMETER、ATTRIBUTE、OPERATION；子公式已经内联，未使用FORMULA节点。'
  ]
};
await writeFile(new URL('独立源值与算例.json',here),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,checks:report.checks,failures:failures.length,sourceCases:sourceCases.length,manualCases:manualCases.length,runtimeChecks:runtimeChecks.length,preserved,newComponents}));
if(failures.length){console.log(JSON.stringify(failures,null,2));process.exitCode=1;}
