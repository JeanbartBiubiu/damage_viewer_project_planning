import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {dirname,resolve} from 'node:path';
const here=new URL('./',import.meta.url),read=async f=>JSON.parse(await readFile(new URL(f,here),'utf8'));
let [plan,source,before,version,textSource]=await Promise.all(['最终候选.json','根绑定与数值证据.json','写前现值.json','最终候选锁.json','补充文本证据.json'].map(read));
if(!process.env.HERO14_ACTUAL_PLAN||!process.env.HERO14_ACTUAL_RESULT)throw Error('必须使用当前GET实际输入和独立结果文件');
plan=JSON.parse(await readFile(process.env.HERO14_ACTUAL_PLAN,'utf8'));
version={fileSha256:version.candidateSha256,planSha256:version.planSha256};
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
 if(hero.id==='Kennen')check('凯南官方能量资源',/能量|Energy/.test(JSON.parse(official).data.Kennen.partype));
 for(const s of hero.spells){check(s.skillKey+'当前根完整对象',stable(obj[s.binding])===stable(s.object));check(s.skillKey+'角色根关联证据',Boolean(s.binding));}
}
check('当前中文原文SHA',sha(gunzipSync(await readFile(textSource.path)))===textSource.sha256);
check('候选文件SHA',sha(await readFile(new URL('最终候选.json',here)))===version.fileSha256);
const expected=before.skillKeys;
check('精确20槽且无重复',Object.keys(plan.skills).length===20&&stable(Object.keys(plan.skills))===stable(expected));
check('写前全部168GET成功',before.requests.length===168&&before.requests.every(r=>r.status===200)&&before.errors.length===0);
const catalog={};for(const [name,r]of Object.entries(before.catalogs))catalog[name]=r.data.items??r.data;
const parameterFields=['parameterKey','name','valueType','valueMode','fixedValue','levelValues','description','sortOrder'];
let preserved=0,newCount=0;
const ops={ADD:(a,b)=>a+b,SUBTRACT:(a,b)=>a-b,MULTIPLY:(a,b)=>a*b,DIVIDE:(a,b)=>a/b,MIN:Math.min,MAX:Math.max};
function param(skill,key,ctx){const p=skill.write.parameters.find(p=>p.parameterKey===key);if(!p)throw Error('参数缺失 '+skill.skillKey+'/'+key);if(p.valueMode==='FIXED')return p.fixedValue;if(p.valueMode==='SKILL_LEVEL')return p.levelValues[ctx.rank];if(p.valueMode==='RUNTIME_INPUT'){if(!Object.hasOwn(ctx.inputs,key))throw Error('未提供实际输入 '+key);return ctx.inputs[key];}throw Error('未授权参数模式 '+p.valueMode);}
function evaluate(skill,n,ctx){if(n.nodeType==='PARAMETER')return param(skill,n.parameterKey,ctx);if(n.nodeType==='ATTRIBUTE'){const k=n.attributeOwner+'.'+n.attributeKey+'.'+n.attributeValueKind;if(!Object.hasOwn(ctx.attrs,k))throw Error('缺属性 '+k);return ctx.attrs[k];}if(n.nodeType==='OPERATION'&&ops[n.operation])return ops[n.operation](...n.operands.map(c=>evaluate(skill,c,ctx)));throw Error('非法节点 '+JSON.stringify(n));}
const inputs={};for(const skill of Object.values(plan.skills))for(const p of skill.write.parameters.filter(p=>p.valueMode==='RUNTIME_INPUT'))inputs[p.parameterKey]=100;Object.assign(inputs,{source_stat_9_2_value:.4,cooldown_reduction_seconds_level_value_2:4,confirmed_critical_extension_count:2,actual_mana_spent:100,actual_self_slow_ratio:.8,confirmed_distance_stun_ms:3000,actual_recasts:100,confirmed_recharge_ms:18000});
const attrs={'SOURCE.ability_power.TOTAL':100,'SOURCE.attack_damage.TOTAL':200,'SOURCE.attack_damage.BONUS':50,'SOURCE.attack_damage.BASE':150,'SOURCE.mana.TOTAL':2000,'SOURCE.mana.BONUS':1000,'SOURCE.mana.MISSING':800,'SOURCE.hp.BONUS':500};
const context={rank:1,inputs,attrs};
function trial(skillKey,formulaKey,expected,overrides={}){const s=plan.skills[skillKey],c={rank:overrides.rank??1,inputs:{...inputs,...overrides.inputs},attrs:{...attrs,...overrides.attrs}};const f=s.write.formulas.find(f=>f.formulaKey===formulaKey);const actual=evaluate(s,f.expression,c);const ok=close(actual,expected);cases.push({skillKey,formulaKey,input:c,expected,actual,passed:ok});check('独立算例 '+skillKey+'/'+formulaKey+'#'+cases.length,ok,{expected,actual});}
function walk(n,fn,path=''){if(!n||typeof n!=='object')return;fn(n,path);for(const[k,v]of Object.entries(n))if(v&&typeof v==='object')if(Array.isArray(v))v.forEach((x,i)=>walk(x,fn,path+'.'+k+'['+i+']'));else walk(v,fn,path+'.'+k);}
function rawCalc(skill,key,ctx,seen=[]){if(seen.includes(key))throw Error('原树循环');const c=spells.get(skill.skillKey).object.mSpell.mSpellCalculations[key],path='mSpellCalculations.'+key;let n=c.__type==='GameCalculationModified'?rawCalc(skill,c.mModifiedGameCalculation,ctx,[...seen,key]):c.mFormulaParts.reduce((v,p,i)=>v+rawNode(skill,p,ctx,path+'.mFormulaParts['+i+']'),0);if(c.mMultiplier)n*=rawNode(skill,c.mMultiplier,ctx,path+'.mMultiplier');return n;}
function rawNode(skill,n,ctx,path){
 const spell=spells.get(skill.skillKey).object.mSpell;
 const datum=name=>{const d=spell.DataValues.find(v=>v.name.toLowerCase()===name.toLowerCase());if(!d?.values)throw Error('缺原数据 '+name);return d.values[ctx.rank];};
 const stat=()=>{const st=n.mStat??0,kind=n.mStatFormula??0;if(st===0&&kind===0)return ctx.attrs['SOURCE.ability_power.TOTAL'];if(st===2&&[0,1,2].includes(kind))return ctx.attrs['SOURCE.attack_damage.'+['TOTAL','BASE','BONUS'][kind]];if(st===12&&kind===2)return ctx.attrs['SOURCE.hp.BONUS'];if(st===9&&kind===2)return ctx.inputs.source_stat_9_2_value;throw Error('未证原属性 '+st+'/'+kind);};
 if(['ByCharLevelInterpolationCalculationPart','ByCharLevelBreakpointsCalculationPart','ByCharLevelFormulaCalculationPart','{4ce08984}'].includes(n.__type)){const p=skill.proofs.find(p=>p.source===path&&p.parameterKey&&p.sourcePending);if(!p)throw Error('曲线未保持输入 '+path);return ctx.inputs[p.parameterKey];}
 switch(n.__type){case 'EffectValueCalculationPart':if(skill.skillKey!=='velkoz_r'||n.mEffectIndex!==1)throw Error('未独立核效果索引');return spell.mEffectAmount[0].value[ctx.rank];case 'NamedDataValueCalculationPart':return datum(n.mDataValue);case 'NumberCalculationPart':if(!Object.hasOwn(n,'mNumber'))throw Error('原常数缺省');return n.mNumber;case 'StatByNamedDataValueCalculationPart':return stat()*datum(n.mDataValue);case 'StatByCoefficientCalculationPart':return stat()*n.mCoefficient;case 'StatBySubPartCalculationPart':return stat()*rawNode(skill,n.mSubpart,ctx,path+'.mSubpart');case 'AbilityResourceByCoefficientCalculationPart':throw Error('本批没有授权资源枚举扩展');case 'SumOfSubPartsCalculationPart':return n.mSubparts.reduce((s,p,i)=>s+rawNode(skill,p,ctx,path+'.mSubparts['+i+']'),0);case 'ProductOfSubPartsCalculationPart':return rawNode(skill,n.mPart1,ctx,path+'.mPart1')*rawNode(skill,n.mPart2,ctx,path+'.mPart2');default:throw Error('原节点未核 '+n.__type);}
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
// 手算来自当前逐技能原值、独立输入与单位，未导入候选生成器。
const manual=[
 ['kennen_q','damage',150],['kennen_w','passive_damage',110],['kennen_w','active_damage',150],['kennen_w','critical_passive_damage',171.6],['kennen_e','damage',160],['kennen_e','capped_after_duration_ms',6000],['kennen_r','base_tick_damage',65],
 ['velkoz_p','true_damage',160],['velkoz_q','damage',170],['velkoz_w','initial_damage',50],['velkoz_w','secondary_damage',70],['velkoz_e','damage',100],['velkoz_r','total_damage',575],
 ['ziggs_p','damage',150],['ziggs_p','cooldown_reduction_seconds',4],['ziggs_p','cooldown_reduction_ms',4000],['ziggs_q','damage',140],['ziggs_w','damage',120],['ziggs_e','first_mine_damage',55],['ziggs_e','subsequent_mine_damage',22],['ziggs_r','center_damage',400],['ziggs_r','outer_damage',260],
 ['xerath_p','non_champion_mana_restore',100],['xerath_p','champion_mana_restore',200],['xerath_q','damage',160],['xerath_q','unreleased_mana_refund',50],['xerath_q','capped_self_slow_ratio',.5],['xerath_w','normal_damage',115],['xerath_w','center_damage',191.705],['xerath_e','damage',115],['xerath_e','bounded_stun_ms',2250],['xerath_r','base_shot_damage',215],['xerath_r','extra_champion_hit_damage',25],['xerath_r','capped_recasts',4]
];
for(const t of manual)trial(...t);
trial('kennen_w','passive_damage',110,{attrs:{'SOURCE.attack_damage.TOTAL':999}});
trial('kennen_w','passive_damage',150,{attrs:{'SOURCE.attack_damage.BONUS':100}});
trial('kennen_w','critical_passive_damage',154,{inputs:{source_stat_9_2_value:0}});
trial('kennen_e','capped_after_duration_ms',4000,{inputs:{confirmed_critical_extension_count:0}});
trial('kennen_e','capped_after_duration_ms',8000,{inputs:{confirmed_critical_extension_count:20}});
trial('kennen_e','capped_after_duration_ms',4000,{inputs:{confirmed_critical_extension_count:-2}});
trial('ziggs_q','damage',360,{rank:5});
trial('ziggs_e','first_mine_damage',235,{rank:5});
trial('ziggs_e','subsequent_mine_damage',94,{rank:5});
trial('xerath_w','center_damage',425.085,{rank:5});
trial('xerath_q','unreleased_mana_refund',16,{inputs:{actual_mana_spent:32}});
trial('xerath_q','capped_self_slow_ratio',.2,{inputs:{actual_self_slow_ratio:.2}});
trial('xerath_q','capped_self_slow_ratio',0,{inputs:{actual_self_slow_ratio:-.1}});
trial('xerath_e','bounded_stun_ms',750,{inputs:{confirmed_distance_stun_ms:300}});
trial('xerath_e','bounded_stun_ms',1500,{inputs:{confirmed_distance_stun_ms:1500}});
trial('xerath_r','capped_recasts',6,{rank:3});
trial('xerath_r','capped_recasts',0,{inputs:{actual_recasts:-1}});
trial('velkoz_r','total_damage',1050,{rank:3});
const totalFormulas=Object.values(plan.skills).reduce((n,s)=>n+s.write.formulas.length,0);
check('每个公式均有独立手算',new Set(manual.map(v=>v[0]+'/'+v[1])).size===totalFormulas&&totalFormulas===34);
check('四个未知角色等级节点保持输入',curves.length===4);
check('原24公共参数保护',preserved===24);
for(const key of ['kennen_q','kennen_w','kennen_e'])check(key+'确为能量效果',plan.skills[key].write.effects.find(e=>e.effectKey==='energy_cost')?.results[0].detail.attributeKey==='energy'&&!plan.skills[key].write.effects.some(e=>e.results.some(r=>r.detail.attributeKey==='mana')));
check('凯南R零成本不建资源',!plan.skills.kennen_r.write.effects.some(e=>e.results.some(r=>r.resultType==='RESOURCE_CHANGE')));
check('凯南E攻速比例目录',plan.skills.kennen_e.write.effects.find(e=>e.effectKey==='after_attack_speed').results[0].detail.attributeKey==='bonus_attack_speed_percent');
check('凯南E仅确证初始4秒，不能刷新完整总时长',stable(plan.skills.kennen_e.write.effects.find(e=>e.effectKey==='after_attack_speed').lifecycle.durationValue)===stable({kind:'PARAMETER',parameterKey:'after_duration_ms'})&&param(plan.skills.kennen_e,'after_duration_ms',context)===4000);
check('泽拉斯非英雄补蓝保留',plan.skills.xerath_p.write.effects.some(e=>e.effectKey==='non_champion_restore'));
check('维克兹R持续总量2500毫秒',param(plan.skills.velkoz_r,'damage_duration_ms',context)===2500);
const missingInputChecks=[];
for(const skill of Object.values(plan.skills))for(const f of skill.write.formulas){let depends=false;walk(f.expression,n=>{if(n.nodeType==='PARAMETER'&&skill.write.parameters.find(p=>p.parameterKey===n.parameterKey)?.valueMode==='RUNTIME_INPUT')depends=true;});if(depends){let rejected=false;try{evaluate(skill,f.expression,{...context,inputs:{}});}catch{rejected=true;}check(skill.skillKey+'/'+f.formulaKey+'缺输入拒绝求值',rejected);missingInputChecks.push({skillKey:skill.skillKey,formulaKey:f.formulaKey,rejected});}}
const report={at:new Date().toISOString(),candidateSha256:version.fileSha256,planSha256:version.planSha256,status:failures.length?'REVISE':'READY_FOR_PARENT_REVIEW',scope:'读取本次实际API参数与公式再求值；与冻结原文独立求值交叉，不导入生成器。无业务写入，不声称战斗运行。',checks:checks.length,failures,preservedPublicParameters:preserved,newComponents:newCount,sourceCases,manualCases:cases,unknownCurves:curves,missingInputChecks,notes:['算例中的等级实际值由调用方明确提供，只验证数学，不证明客户端曲线。','当前原根数据和老effect数组冲突保留并采用直接具名绑定，未默默换来源。','有效暴击次数、实际支出和当前控制量无默认；管理参数说明不是运行时边界校验。','168组成与字典GET之外另有28主体/关系/代表图GET，均无业务写入。']};
await writeFile(process.env.HERO14_ACTUAL_RESULT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,checks:report.checks,failures:failures.length,sourceCases:sourceCases.length,manualCases:cases.length,unknownCurves:curves.length,preserved,newComponents:newCount}));if(failures.length){console.log(JSON.stringify(failures,null,2));process.exitCode=1;}
