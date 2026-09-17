import {plan,evidence,clean,val,fval,fixed,pn,attr,op,add,mul,behavior,life,begin,parameter,data,literal,coefficient,formula,result,effect,damage,manaEffect,castProcess,hit,pending,exclude,attributeEffect,curve} from './候选.mjs';
export {plan,evidence,clean,val,fval,fixed,pn,attr,op,add,mul,behavior,life,begin,parameter,data,literal,coefficient,formula,result,effect,damage,manaEffect,castProcess,hit,pending,exclude,attributeEffect,curve,common,runtime,activeBuff,rule,champion,cooldown};
plan.meta.scope='阿狸、德莱厄斯、黛安娜、维迦20技能；仅本批内部组成。复用既有公共参数，不覆盖。纯经济、经验、视野和多对象路径排除；混合保留1V1部分。';
function common(x,{cast=false,officialZeroMana=false}={}){
 const d=x.s.official,n=x.c.maxLevel,cd=x.p.cooldownTime?.slice(1,n+1),mv=x.p.manaValues?.values?.slice(0,n),old=x.p.mana?.slice(0,n),mana=mv??old;
 if(cd?.length!==n||!cd.every((v,i)=>Math.abs(v-d.cooldown[i])<1e-4))throw Error('冷却冲突 '+x.c.skillKey);
 if(x.c.skillKey!=='veigar_w')literal(x,'cooldown_ms','基础冷却时间（毫秒）',d.cooldown.map(v=>Math.round(v*1000)),'官方16.17.1与当前根对象cooldownTime索引1起一致。','official.cooldown + cooldownTime');
 if(mana?.length===n&&mana.every((v,i)=>Math.abs(v-d.cost[i])<1e-4)){
  literal(x,'mana_cost','法力消耗',d.cost,`官方cost与当前${mv?'manaValues.values':'mana'}索引0起一致；明确0消耗保留。`,'official.cost + '+(mv?'manaValues.values':'mana'));manaEffect(x);
  if(mv&&old?.some((v,i)=>Math.abs(v-mv[i])>1e-4))x.c.proofs.push({source:'mana旧字段处置',old,current:mv,disposition:'当前manaValues与官方一致；旧字段不录'});
 }else if(officialZeroMana&&d.cost.every(v=>v===0)){literal(x,'mana_cost','法力消耗',0,'官方明确0；主对象没有法力消耗字段。','official.cost');}
 else throw Error('法力消耗未核对 '+x.c.skillKey);
 if(cast){if(!(x.p.spellCastTime>0)||x.p.mUseAutoattackCastTimeData||(x.p.mCastTime!=null&&Math.abs(x.p.mCastTime-x.p.spellCastTime)>1e-4))throw Error('施法不唯一 '+x.c.skillKey);literal(x,'cast_time_ms','施法时间（毫秒）',Math.round(x.p.spellCastTime*1000),'当前spellCastTime与已有mCastTime一致；不代替命中。','spellCastTime');}
}
function runtime(x,key,name,description){x.c.write.parameters.push({parameterKey:key,name,valueType:'INTEGER',valueMode:'RUNTIME_INPUT',fixedValue:null,levelValues:null,description,sortOrder:(x.c.write.parameters.length+1)*10});}
function activeBuff(x,effectKeys,{delay=false}={}){const stepKey=delay?'cast_time':'activate';x.c.write.processes.push({processKey:'cast',name:'施放'+x.c.name,activationType:'ACTIVE',description:'法力和冷却始于主动施放；效果只作用自身，不将过程结束当作敌人命中。',sortOrder:10,cooldown:{durationValue:val('cooldown_ms'),startMoment:{momentType:'PROCESS_START',stepKey:null}},steps:[{stepKey,name:delay?'施法延迟':'启用自身效果',description:null,sortOrder:10,stepType:delay?'DELAY':'IMMEDIATE',detail:delay?{delayValue:val('cast_time_ms')}:{}}],effectBindings:[...(x.c.write.effects.some(e=>e.effectKey==='mana_cost')?[{bindingKey:'mana_cost',effectKey:'mana_cost',moment:{momentType:'PROCESS_START',stepKey:null},sortOrder:10}]:[]),...effectKeys.map((effectKey,i)=>({bindingKey:effectKey,effectKey,moment:{momentType:delay?'STEP_COMPLETE':'STEP_EXECUTION',stepKey},sortOrder:20+i*10}))],stateOperations:[]});}
function rule(x,key,name,eventSource,effectKeys,conditions=[]){x.c.write.triggerRules.push({ruleKey:key,name,description:'只接收指定真实事件；不自行生成命中或补造事件。',sortOrder:(x.c.write.triggerRules.length+1)*10,eventSource,conditionGroups:conditions.length?[{groupKey:'required',name:'必要条件',sortOrder:10,conditions}]:[],actions:effectKeys.map((effectKey,i)=>({actionKey:effectKey,name:'执行'+effectKey,actionType:'EXECUTE_EFFECT',sortOrder:(i+1)*10,targetContext:'CURRENT_TARGET',detail:{effectKey},runtimeInputBindings:[],resultModifiers:[]})),perTargetCooldown:null,maxTriggersPerProcess:null});}
const champion={conditionKey:'champion',conditionType:'TARGET_CATEGORY_CHECK',sortOrder:10,detail:{categories:['CHAMPION']}};
function cooldown(x,key,name,keys,operation,value=null){effect(x,key,name,[result('cooldown',name,'COOLDOWN_CHANGE','SOURCE',value,{affectedSkillScope:{mode:'SKILLS',skillKeys:keys,skillCategoryKeys:[]},operation})]);}
function adAp(x,{base='BaseDamage',ad='ADRatio',ap='APRatio',adKind='BONUS',calc='TotalDamage',coefficientAD=null,coefficientAP=null}={}){
 data(x,base,'base_damage','基础伤害');
 if(coefficientAD!=null)literal(x,'ad_ratio','攻击力倍率',coefficientAD,'完整'+calc+'中明确攻击力系数。','mSpellCalculations.'+calc);else data(x,ad,'ad_ratio','攻击力倍率');
 if(coefficientAP!=null)literal(x,'ap_ratio','法术强度倍率',coefficientAP,'完整'+calc+'中默认法强系数。','mSpellCalculations.'+calc);else data(x,ap,'ap_ratio','法术强度倍率');
 return add(pn('base_damage'),mul(pn('ad_ratio'),attr('attack_damage','SOURCE',adKind)),mul(pn('ap_ratio'),attr('ability_power')));
}
function critAmp(x,source){data(x,source,'crit_scaling','暴击属性折算系数');const h=evidence.heroes.find(h=>h.id===x.c.source.hero);if(h.baseCriticalMultiplier!==2)throw Error('基础暴伤变更');literal(x,'one','倍率单位值',1,'当前完整暴击计算树有1与−1常数；角色根暴击倍率2减1为1。','mSpellCalculations + root.critDamageMultiplier');return add(pn('one'),mul(mul(attr('critical_strike_chance'),pn('crit_scaling')),add(pn('one'),attr('critical_strike_damage_bonus_percent'))));}
