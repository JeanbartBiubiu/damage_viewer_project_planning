import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {dirname,resolve} from 'node:path';
const here=new URL('./',import.meta.url),read=async f=>JSON.parse(await readFile(new URL(f,here),'utf8'));
const [plan,source,before,version,textSource]=await Promise.all(['完整候选.json','根绑定与数值证据.json','写前现值.json','候选版本.json','补充文本证据.json'].map(read));
const sha=b=>createHash('sha256').update(b).digest('hex');
const failures=[],checks=[],cases=[],sourceCases=[],curves=[];
function check(name,ok,details=null){checks.push(name);if(!ok)failures.push({name,details});}
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-5,Math.abs(b)*2e-6);
const stable=o=>JSON.stringify(o&&typeof o==='object'?Array.isArray(o)?o.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(o).sort().map(k=>[k,JSON.parse(stable(o[k]))])):o);
const spells=new Map(source.heroes.flatMap(h=>h.spells.map(s=>[s.skillKey,s])));
const rootDir=dirname(source.sourceIndex);
for(const hero of source.heroes){
 const compressed=await readFile(resolve(rootDir,hero.client.path)),raw=gunzipSync(compressed),obj=JSON.parse(raw);
 const official=await readFile(resolve(rootDir,hero.official.path));
 check(hero.id+'客户端压缩SHA',sha(compressed)===hero.client.compressedSha256);
 check(hero.id+'客户端原文SHA',sha(raw)===hero.client.sha256);
 check(hero.id+'官方SHA',sha(official)===hero.official.sha256);
 if(hero.id==='Akali')check('阿卡丽官方能量资源',/能量|Energy/.test(JSON.parse(official).data.Akali.partype));
 for(const s of hero.spells){check(s.skillKey+'当前根完整对象',stable(obj[s.binding])===stable(s.object));check(s.skillKey+'角色根关联证据',Boolean(s.binding));}
}
check('当前中文原文SHA',sha(gunzipSync(await readFile(textSource.path)))===textSource.sha256);
check('候选文件SHA',sha(await readFile(new URL('完整候选.json',here)))===version.fileSha256);
const expected=before.skillKeys;
check('精确20槽且无重复',Object.keys(plan.skills).length===20&&stable(Object.keys(plan.skills))===stable(expected));
check('写前全部172GET成功',before.requests.length===172&&before.requests.every(r=>r.status===200)&&before.errors.length===0);
const catalog={};for(const [name,r]of Object.entries(before.catalogs))catalog[name]=r.data.items??r.data;
const parameterFields=['parameterKey','name','valueType','valueMode','fixedValue','levelValues','description','sortOrder'];
let preserved=0,newCount=0;
const ops={ADD:(a,b)=>a+b,SUBTRACT:(a,b)=>a-b,MULTIPLY:(a,b)=>a*b,DIVIDE:(a,b)=>a/b,MIN:Math.min,MAX:Math.max};
function param(skill,key,ctx){const p=skill.write.parameters.find(p=>p.parameterKey===key);if(!p)throw Error('参数缺失 '+skill.skillKey+'/'+key);if(p.valueMode==='FIXED')return p.fixedValue;if(p.valueMode==='SKILL_LEVEL')return p.levelValues[ctx.rank];if(p.valueMode==='RUNTIME_INPUT'){if(!Object.hasOwn(ctx.inputs,key))throw Error('未提供实际输入 '+key);return ctx.inputs[key];}throw Error('未授权参数模式 '+p.valueMode);}
function evaluate(skill,n,ctx){if(n.nodeType==='PARAMETER')return param(skill,n.parameterKey,ctx);if(n.nodeType==='ATTRIBUTE'){const k=n.attributeOwner+'.'+n.attributeKey+'.'+n.attributeValueKind;if(!Object.hasOwn(ctx.attrs,k))throw Error('缺属性 '+k);return ctx.attrs[k];}if(n.nodeType==='OPERATION'&&ops[n.operation])return ops[n.operation](...n.operands.map(c=>evaluate(skill,c,ctx)));throw Error('非法节点 '+JSON.stringify(n));}
const inputs={empowered_attack_damage_level_value:100,ring_move_speed_ratio_level_value_2:.4,confirmed_ability_resource_0_value:1500,actual_prior_cast_stacks:2,confirmed_flux_damage_amp_ratio:.5,move_speed_bonus_efficiency_ratio_level_value:.2,qualified_move_speed_bonus:50,base_damage_level_value:80,confirmed_kill_mana_refund:40};
const attrs={'SOURCE.ability_power.TOTAL':100,'SOURCE.attack_damage.TOTAL':200,'SOURCE.attack_damage.BONUS':50,'SOURCE.attack_damage.BASE':150,'SOURCE.mana.TOTAL':2000,'SOURCE.mana.BONUS':1000,'SOURCE.mana.MISSING':800,'SOURCE.hp.BONUS':500};
const context={rank:1,inputs,attrs};
function trial(skillKey,formulaKey,expected,overrides={}){const s=plan.skills[skillKey],c={rank:overrides.rank??1,inputs:{...inputs,...overrides.inputs},attrs:{...attrs,...overrides.attrs}};const f=s.write.formulas.find(f=>f.formulaKey===formulaKey);const actual=evaluate(s,f.expression,c);const ok=close(actual,expected);cases.push({skillKey,formulaKey,input:c,expected,actual,passed:ok});check('独立算例 '+skillKey+'/'+formulaKey+'#'+cases.length,ok,{expected,actual});}
function walk(n,fn,path=''){if(!n||typeof n!=='object')return;fn(n,path);for(const[k,v]of Object.entries(n))if(v&&typeof v==='object')if(Array.isArray(v))v.forEach((x,i)=>walk(x,fn,path+'.'+k+'['+i+']'));else walk(v,fn,path+'.'+k);}
function rawCalc(skill,key,ctx,seen=[]){if(seen.includes(key))throw Error('原树循环');const c=spells.get(skill.skillKey).object.mSpell.mSpellCalculations[key],path='mSpellCalculations.'+key;let n=c.__type==='GameCalculationModified'?rawCalc(skill,c.mModifiedGameCalculation,ctx,[...seen,key]):c.mFormulaParts.reduce((v,p,i)=>v+rawNode(skill,p,ctx,path+'.mFormulaParts['+i+']'),0);if(c.mMultiplier)n*=rawNode(skill,c.mMultiplier,ctx,path+'.mMultiplier');return n;}
function rawNode(skill,n,ctx,path){
 const spell=spells.get(skill.skillKey).object.mSpell;
 const datum=name=>{const d=spell.DataValues.find(v=>v.name===name);if(!d?.values)throw Error('缺原数据 '+name);return d.values[ctx.rank];};
 const stat=()=>{const st=n.mStat??0,kind=n.mStatFormula??0;if(st===0&&kind===0)return ctx.attrs['SOURCE.ability_power.TOTAL'];if(st===2&&[0,1,2].includes(kind))return ctx.attrs['SOURCE.attack_damage.'+['TOTAL','BASE','BONUS'][kind]];if(st===12&&kind===2)return ctx.attrs['SOURCE.hp.BONUS'];throw Error('未证原属性 '+st+'/'+kind);};
 if(['ByCharLevelInterpolationCalculationPart','ByCharLevelBreakpointsCalculationPart','ByCharLevelFormulaCalculationPart','{4ce08984}'].includes(n.__type)){const p=skill.proofs.find(p=>p.source===path&&p.parameterKey&&p.sourcePending);if(!p)throw Error('曲线未保持输入 '+path);return ctx.inputs[p.parameterKey];}
 switch(n.__type){case 'NamedDataValueCalculationPart':return datum(n.mDataValue);case 'NumberCalculationPart':if(!Object.hasOwn(n,'mNumber'))throw Error('原常数缺省');return n.mNumber;case 'StatByNamedDataValueCalculationPart':return stat()*datum(n.mDataValue);case 'StatByCoefficientCalculationPart':return stat()*n.mCoefficient;case 'StatBySubPartCalculationPart':return stat()*rawNode(skill,n.mSubpart,ctx,path+'.mSubpart');case 'AbilityResourceByCoefficientCalculationPart':return (/^ryze_[qwe]$/.test(skill.skillKey)&&n.mStatFormula===2?ctx.attrs['SOURCE.mana.BONUS']:ctx.inputs.confirmed_ability_resource_0_value)*n.mCoefficient;case 'SumOfSubPartsCalculationPart':return n.mSubparts.reduce((s,p,i)=>s+rawNode(skill,p,ctx,path+'.mSubparts['+i+']'),0);case 'ProductOfSubPartsCalculationPart':return rawNode(skill,n.mPart1,ctx,path+'.mPart1')*rawNode(skill,n.mPart2,ctx,path+'.mPart2');default:throw Error('原节点未核 '+n.__type);}
}
for(const skill of Object.values(plan.skills)){
 const old=before.skills[skill.skillKey],src=spells.get(skill.skillKey).object.mSpell;
 for(const p of old.components.parameters.details){const wanted=skill.write.parameters.find(x=>x.parameterKey===p.key);check(skill.skillKey+'/'+p.key+'原对象全部请求字段复用',Boolean(wanted)&&parameterFields.every(k=>stable(wanted[k])===stable(p.detail.data[k])));preserved++;}
 for(const kind of before.kinds.filter(k=>k.name!=='parameters'))check(skill.skillKey+'/'+kind.name+'无旧组成',old.components[kind.name].items.length===0);
 newCount+=skill.write.parameters.length-old.components.parameters.details.length+skill.write.formulas.length+skill.write.effects.length;
 for(const p of skill.write.parameters){check(skill.skillKey+'/'+p.parameterKey+'无未知默认',p.valueMode!=='RUNTIME_INPUT'||p.fixedValue===null&&p.levelValues===null);check(skill.skillKey+'/'+p.parameterKey+'未展开角色等级',p.valueMode!=='CHARACTER_LEVEL');}
 for(const proof of skill.proofs.filter(p=>p.parameterKey&&p.source?.startsWith('DataValues.')&&Array.isArray(p.values))){const values=src.DataValues.find(d=>d.name===proof.source.slice(11))?.values;check(skill.skillKey+'/'+proof.parameterKey+'逐级原值单位',Boolean(values)&&proof.values.every((v,i)=>close(param(skill,proof.parameterKey,{rank:i+1,inputs,attrs}),values[i+1]*(proof.scale??1))));}
 for(const datum of src.DataValues??[])check(skill.skillKey+'/'+datum.name+'原字段已分类',skill.proofs.some(p=>p.source==='DataValues.'+datum.name));
 for(const f of skill.write.formulas){walk(f.expression,n=>{if(n.nodeType)check(skill.skillKey+'/'+f.formulaKey+'合法公式节点',['PARAMETER','ATTRIBUTE','OPERATION'].includes(n.nodeType));if(n.nodeType==='ATTRIBUTE')check(skill.skillKey+'/'+f.formulaKey+'真实属性目录',catalog.attributes.some(a=>a.attributeKey===n.attributeKey));});const proof=skill.proofs.find(p=>p.formulaKey===f.formulaKey&&p.source?.startsWith('mSpellCalculations.'));if(proof){const key=proof.source.slice(19);for(const rank of [...new Set([1,skill.maxLevel])])for(const ap of [100,237]){const ctx={rank,inputs,attrs:{...attrs,'SOURCE.ability_power.TOTAL':ap,'SOURCE.attack_damage.TOTAL':ap===100?200:317,'SOURCE.attack_damage.BONUS':ap===100?50:31,'SOURCE.mana.BONUS':ap===100?1000:373,'SOURCE.mana.TOTAL':ap===100?2000:9100}};const actual=evaluate(skill,f.expression,ctx),expectedValue=rawCalc(skill,key,ctx),passed=close(actual,expectedValue);sourceCases.push({skillKey:skill.skillKey,formulaKey:f.formulaKey,sourceKey:key,rank,attrs:ctx.attrs,inputs,actual,sourceValue:expectedValue,passed});check(skill.skillKey+'/'+key+'独立原树 '+rank+'/'+ap,passed);}}
 }
 for(const p of skill.proofs.filter(p=>p.sourcePending&&p.raw&&['ByCharLevelInterpolationCalculationPart','ByCharLevelBreakpointsCalculationPart','ByCharLevelFormulaCalculationPart','{4ce08984}'].includes(p.raw.__type))){const actual=skill.write.parameters.find(v=>v.parameterKey===p.parameterKey);check(skill.skillKey+'/'+p.parameterKey+'未知曲线为输入',actual?.valueMode==='RUNTIME_INPUT'&&actual.fixedValue===null&&actual.levelValues===null);curves.push({skillKey:skill.skillKey,parameterKey:p.parameterKey,source:p.source,raw:p.raw});}
 for(const effect of skill.write.effects)for(const r of effect.results){check(skill.skillKey+'/'+effect.effectKey+'不造伤害或治疗资格',!['DAMAGE','DIRECT_HEAL'].includes(r.resultType));if(r.detail.attributeKey)check(skill.skillKey+'/'+effect.effectKey+'效果属性存在',catalog.attributes.some(a=>a.attributeKey===r.detail.attributeKey));if(r.detail.modifierZoneKey)check(skill.skillKey+'/'+effect.effectKey+'效果修正区存在',catalog['modifier-zones'].some(a=>a.modifierZoneKey===r.detail.modifierZoneKey));if(r.detail.absorbedDamageTypeKey)check(skill.skillKey+'/'+effect.effectKey+'盾伤害类别存在',catalog['damage-types'].some(a=>a.damageTypeKey===r.detail.absorbedDamageTypeKey));}
 check(skill.skillKey+'无空动作或默认触发',skill.write.processes.length===0&&skill.write.internalStates.length===0&&skill.write.triggerRules.length===0);
}
const manual=[['akali_p','empowered_attack_damage',185],['akali_p','ring_move_speed_ratio',.4],['akali_q','damage',235],['akali_e','first_damage',114],['akali_e','second_damage',266],['akali_r','first_damage',165],['akali_r','second_min_damage',100],['akali_r','second_max_damage',300],['kassadin_q','damage',135],['kassadin_q','magic_shield_amount',110],['kassadin_w','active_damage',130],['kassadin_w','passive_damage',35],['kassadin_w','normal_mana_restore',32],['kassadin_w','champion_mana_restore',160],['kassadin_e','damage',140],['kassadin_r','base_damage_amount',150],['kassadin_r','per_stack_damage',57],['kassadin_r','actual_damage',264],['kassadin_r','actual_mana_cost',160],['ryze_p','mana_gain_percentage_points',10],['ryze_p','maximum_mana_bonus_ratio',.1],['ryze_q','damage',150],['ryze_q','flux_damage',225],['ryze_w','damage',150],['ryze_e','damage',130],['ryze_r','flux_damage_multiplier',1.5],['cassiopeia_p','move_speed_bonus_efficiency_ratio',.2],['cassiopeia_p','additional_move_speed_bonus',10],['cassiopeia_q','poison_total_damage',140],['cassiopeia_w','damage_per_second',30],['cassiopeia_e','base_damage',90],['cassiopeia_e','poison_bonus_damage',75],['cassiopeia_e','poison_total_damage',165],['cassiopeia_e','poison_heal',10],['cassiopeia_e','small_unit_poison_heal',2.5],['cassiopeia_e','kill_mana_refund',40],['cassiopeia_r','damage',200]];
for(const t of manual)trial(...t);
for(let n=0;n<=4;n++){trial('kassadin_r','actual_mana_cost',40*2**n,{inputs:{actual_prior_cast_stacks:n}});trial('kassadin_r','actual_damage',150+57*n,{inputs:{actual_prior_cast_stacks:n}});}
trial('akali_q','damage',300,{attrs:{'SOURCE.attack_damage.TOTAL':300}});
trial('akali_q','damage',235,{attrs:{'SOURCE.attack_damage.BONUS':150}});
trial('akali_r','first_damage',165,{attrs:{'SOURCE.attack_damage.TOTAL':300}});
trial('akali_r','first_damage',215,{attrs:{'SOURCE.attack_damage.BONUS':150}});
trial('ryze_q','damage',150,{attrs:{'SOURCE.mana.TOTAL':9000}});
trial('ryze_q','damage',138,{attrs:{'SOURCE.mana.BONUS':400}});
trial('kassadin_r','base_damage_amount',150,{attrs:{'SOURCE.mana.TOTAL':9000}});
trial('kassadin_r','base_damage_amount',160,{inputs:{confirmed_ability_resource_0_value:2000}});
trial('ryze_p','maximum_mana_bonus_ratio',.3,{attrs:{'SOURCE.ability_power.TOTAL':300}});
trial('cassiopeia_e','poison_heal',30,{attrs:{'SOURCE.ability_power.TOTAL':300}});
check('全部37公式具独立手算',manual.length===Object.values(plan.skills).reduce((a,s)=>a+s.write.formulas.length,0));
check('四个未知等级项没有插值',curves.length===4);
check('原28公共参数保护',preserved===28);
for(const key of ['akali_q','akali_e'])check(key+'真实成本是能量',plan.skills[key].write.effects.find(e=>e.effectKey==='energy_cost')?.results[0].detail.attributeKey==='energy'&&!plan.skills[key].write.effects.some(e=>e.results.some(r=>r.detail.attributeKey==='mana')));
check('阿卡丽R零成本不建资源效果',plan.skills.akali_r.write.effects.length===0);
check('卡萨丁R费用绑定动态公式',plan.skills.kassadin_r.write.effects[0].results[0].valueRule.value.formulaKey==='actual_mana_cost');
check('瑞兹双符文使用比例属性',plan.skills.ryze_q.write.effects.find(e=>e.effectKey==='two_rune_move_speed').results[0].detail.attributeKey==='move_speed_percent');
check('魔法护盾1.5秒',param(plan.skills.kassadin_q,'shield_duration_ms',context)===1500);
let missingInputRejected=false;try{evaluate(plan.skills.kassadin_r,plan.skills.kassadin_r.write.formulas.find(f=>f.formulaKey==='actual_damage').expression,{...context,inputs:{}});}catch{missingInputRejected=true;}check('独立求值器拒绝未提供实际输入',missingInputRejected);
const report={at:new Date().toISOString(),candidateSha256:version.fileSha256,planSha256:version.planSha256,status:failures.length?'REVISE':'READY_FOR_PARENT_REVIEW',scope:'独立读取原始压缩资料与最终候选；未导入候选生成辅助函数；没有API写入或战斗运行证明。',checks:checks.length,failures,preservedPublicParameters:preserved,newComponents:newCount,sourceCases,manualCases:cases,unknownCurves:curves,notes:['等级实际值是外供示例，不是客户端曲线证明。','卡萨丁R费用有限域只接受整数0至4；管理参数当前只存INTEGER及说明，动作输入尚未接线，不能声称已存在运行时边界校验。','短摘要中的阿卡丽Q额外AD、卡萨丁E充能、蛇女E按伤害自疗与当前直接绑定长文本/原树存在差异，候选采用当前明确数值链并保留原文供主审。']};
await writeFile(new URL('独立源值与算例.json',here),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,checks:report.checks,failures:failures.length,sourceCases:sourceCases.length,manualCases:cases.length,unknownCurves:curves.length,preserved,newComponents:newCount}));if(failures.length){console.log(JSON.stringify(failures,null,2));process.exitCode=1;}
