import { simulationActiveSample } from './simulationActiveSkill';
import type { SkillEffect, SkillEffectResult } from '../../src/types/skillEffect';
import type { SkillTriggerRuleDetail } from '../../src/types/skillTriggerRule';
import type {SkillProcess,SkillProcessMoment} from '../../src/types/skillProcess';
import type {SkillConfiguration} from '../../src/types/skillConfiguration';
import { fixedValue } from '../../src/types/numericValue';
import { syncSimulationSkillSources } from './simulationSkillSources';

/** 合成两段链：首段真正未被阻挡才产生独立资格，尾段不能发布空命中。 */
export function skillHitChainSample() {
  const snapshot = simulationActiveSample(), config = snapshot.skillConfigurations[1]!, cast = config.processes[0]!;
  const key = config.skill.skillKey, meta = { createdAt: '', updatedAt: '' };
  snapshot.selection.basicAttackSkillKey = snapshot.skillConfigurations[0]!.skill.skillKey;
  snapshot.selection.basicAttackLevel = 1;
  cast.cooldown!.durationValue = fixedValue(4000);
  cast.steps = [
    { stepKey: 'cast_delay', name: '施法', sortOrder: 0, occupiesAction: true, stepType: 'DELAY', detail: { delayValue: fixedValue(350) }, description: null },
    { stepKey: 'first', name: '首段', sortOrder: 1, occupiesAction: false, stepType: 'IMMEDIATE', detail: {}, description: null },
    { stepKey: 'wait', name: '等待', sortOrder: 2, occupiesAction: false, stepType: 'DELAY', detail: { delayValue: fixedValue(3000) }, description: null },
    { stepKey: 'tail', name: '尾段', sortOrder: 3, occupiesAction: false, stepType: 'IMMEDIATE', detail: {}, description: null }
  ];
  const moment = (momentType: 'PROCESS_START'|'PROCESS_COMPLETE'|'PROCESS_FAILURE'|'STEP_EXECUTION', stepKey: string|null = null):SkillProcessMoment => {
    if(momentType==='STEP_EXECUTION'){if(stepKey===null)throw new Error('步骤时点需真实步骤');return {momentType,stepKey,failureReason:null};}
    return {momentType,stepKey:null,failureReason:null};
  };
  config.internalStates = [{ gameId: snapshot.gameId, skillKey: key, stateKey: 'link_eligible', stateType: 'COUNTER', scope: 'SKILL',
    detail: { initialValue: fixedValue(0), maxValue: fixedValue(1), durationValue: null }, name: '链资格', description:null,sortOrder:0,...meta }];
  cast.stateOperations = (['PROCESS_START','PROCESS_COMPLETE','PROCESS_FAILURE'] as const).map((type,i)=>({operationKey:`clear_${i}`,name:'清零',sortOrder:i,
    stateSkillKey:key,stateKey:'link_eligible',operation:'SET',value:fixedValue(0),optionKey:null,moment:moment(type)}));
  const base = structuredClone(config.effects[0]!), damage = base.results[0]!;
  damage.spellShieldBlockScope = 'SKILL';
  const life = (instanceScope: 'SOURCE'|'SOURCE_TARGET', duration: number) => ({ instanceScope,
    maxStacksValue:fixedValue(1),applicationStacksValue:fixedValue(1),durationValue:fixedValue(duration),periodicIntervalValue:null,
    firstPeriodicExecution:null,reapplicationStackMode:'KEEP' as const,reapplicationDurationMode:'REFRESH_ALL' as const,expiryMode:'ALL_AT_ONCE' as const,endWhenShieldEndsResultKey:null });
  const behavior = {moment:'PERSISTENT' as const,valueReadMode:'APPLICATION_SNAPSHOT' as const,stackValueMode:'SHARED' as const,reapplicationValueMode:'REPLACE' as const,periodicExecutionMode:null};
  const status = (effectKey:string,statusKey:string,duration:number,scope:'RESULT'|null,strength:number|null):SkillEffect => ({...base,effectKey,lifecycle:life('SOURCE_TARGET',duration),
    results:[{...damage,resultKey:'control',resultType:'STATUS_OPERATION',detail:{statusKey,operation:'APPLY'},valueRule:strength===null?null:{value:fixedValue(strength),fixedMultiplier:1,fixedMinValue:null,fixedMaxValue:null},spellShieldBlockScope:scope,lifecycleBehavior:behavior} as SkillEffectResult]});
  const slow = status('link_slow','slow',3000,'RESULT',.2), stun = status('tail_stun','stun',1500,null,null);
  const tailDamage = structuredClone(base); tailDamage.effectKey='tail_damage'; tailDamage.results[0]!.spellShieldBlockScope=null;
  const speed:SkillEffect={...base,effectKey:'self_speed',lifecycle:life('SOURCE',3000),results:[{...damage,resultKey:'speed',resultType:'ATTRIBUTE_CHANGE',target:'SOURCE',
    valueRule:{value:fixedValue(.2),fixedMultiplier:1,fixedMinValue:null,fixedMaxValue:null},detail:{attributeKey:'move_speed',operation:'INCREASE',modifierZoneKey:'speed_percent'},lifecycleBehavior:behavior,spellShieldBlockScope:null}]};
  config.effects=[base,slow,tailDamage,stun,speed];
  const post:SkillProcess = {...structuredClone(cast),processKey:'qualify_link',activationType:'PASSIVE' as const,cooldown:null,
    steps:[{stepKey:'qualify',name:'即时资格',sortOrder:0,occupiesAction:false,stepType:'IMMEDIATE' as const,detail:{},description:null}],
    stateOperations:[{operationKey:'set_link',name:'置有效',sortOrder:0,stateSkillKey:key,stateKey:'link_eligible',operation:'SET' as const,value:fixedValue(1),optionKey:null,moment:moment('STEP_EXECUTION','qualify')}],
    effectBindings:[{bindingKey:'speed',effectKey:speed.effectKey,moment:moment('STEP_EXECUTION','qualify'),sortOrder:1}]};
  config.processes=[cast,post];
  const original=config.triggerRules[1]!, initial=config.triggerRules[0]!;
  const rule=(ruleKey:string,step:string,effectKey:string,sortOrder:number):SkillTriggerRuleDetail=>({...structuredClone(original),ruleKey,sortOrder,
    eventSource:{eventType:'SKILL_HIT',detail:{sourceSkillKey:key,processMoment:{processKey:cast.processKey,moment:{momentType:'STEP_EXECUTION',stepKey:step},requiresPriorStepKey:step==='tail'?'first':null}}},
    actions:[{...structuredClone(original.actions[0]!),actionType:'EXECUTE_EFFECT',detail:{effectKey},targetContext:'CURRENT_TARGET',runtimeInputBindings:[],resultModifiers:[]}]});
  const event=(conditionKey:string,eventValueKey:'SKILL_HIT_FIRST_CONTACT'|'SKILL_HIT_SPELL_SHIELD_BLOCKED',value:number)=>({conditionKey,conditionType:'EVENT_VALUE_COMPARE' as const,sortOrder:eventValueKey==='SKILL_HIT_FIRST_CONTACT'?0:1,detail:{eventValueKey,comparator:'EQ' as const,comparisonValue:fixedValue(value)}});
  const head=rule('first_damage','first',base.effectKey,1), slowRule=rule('slow','first',slow.effectKey,2), tail=rule('tail_damage','tail',tailDamage.effectKey,3), stunRule=rule('tail_stun','tail',stun.effectKey,4);
  slowRule.conditionGroups=[{groupKey:'unblocked',name:'未挡',sortOrder:0,conditions:[event('not_blocked','SKILL_HIT_SPELL_SHIELD_BLOCKED',0)]}];
  for(const row of [tail,stunRule])row.conditionGroups=[{groupKey:'valid',name:'有效链',sortOrder:0,conditions:[{conditionKey:'own_link',conditionType:'INTERNAL_STATE_CHECK',sortOrder:0,
    detail:{stateSkillKey:key,stateKey:'link_eligible',valueKind:'VALUE',optionKey:null,expectedBoolean:null,comparator:'EQ',comparisonValue:fixedValue(1)}}]}];
  const after=rule('after_first','first',base.effectKey,5);
  after.conditionGroups=[{groupKey:'qualified',name:'首接触未挡',sortOrder:0,conditions:[event('first','SKILL_HIT_FIRST_CONTACT',1),event('not_blocked','SKILL_HIT_SPELL_SHIELD_BLOCKED',0)]}];
  after.actions=[{...after.actions[0]!,actionType:'START_PROCESS',detail:{processKey:post.processKey},targetContext:'CURRENT_TARGET',runtimeInputBindings:[],resultModifiers:[]}];
  config.triggerRules=[initial,head,slowRule,tail,stunRule,after];
  for(const statusKey of ['slow','stun'])snapshot.catalogs.statuses.push({gameId:snapshot.gameId,statusKey,name:statusKey,statusKind:statusKey==='slow'?'MOVEMENT_SLOW':'STUN',status:'ENABLED',description:null,sortOrder:0,...meta});
  snapshot.catalogs.modifierZones.push({gameId:snapshot.gameId,modifierZoneKey:'speed_percent',name:'比例属性',domain:'ATTRIBUTE',applicationStage:'ATTRIBUTE_PERCENT',calculationMode:'RATIO_ADD',description:null,status:'ENABLED',sortOrder:0,...meta} as never);
  snapshot.catalogs.attributes.push({...snapshot.catalogs.attributes[0]!,attributeKey:'move_speed'});
  Object.assign(snapshot.source.selectedLevelValues,{hp:1000,attack_damage:10,attack_speed:1,armor:0,move_speed:335,critical_strike_chance:0,critical_strike_damage_bonus_percent:0,armor_pen_percent:0,armor_pen_flat:0,life_steal_percent:0});
  Object.assign(snapshot.target.selectedLevelValues,{hp:1000,armor:0});
  for(const side of ['source','target'] as const)snapshot[side].attributes.levelValues['1']={...snapshot[side].selectedLevelValues};
  const witnessKey='chain_witness', witnessEffect={...structuredClone(base),skillKey:witnessKey,effectKey:'witness_damage'};
  witnessEffect.results[0]!.spellShieldBlockScope=null; witnessEffect.results[0]!.valueRule!.value=fixedValue(5);
  const witness:SkillConfiguration={...structuredClone(config),skill:{...config.skill,skillKey:witnessKey,name:'真实接触哨兵'},parameters:[],formulas:[],internalStates:[],processes:[],effects:[witnessEffect],
    triggerRules:[{...structuredClone(original),ruleKey:'on_real_chain_hit',eventSource:{eventType:'SKILL_HIT' as const,detail:{sourceSkillKey:key}},
      actions:[{...structuredClone(original.actions[0]!),actionType:'EXECUTE_EFFECT' as const,detail:{effectKey:witnessEffect.effectKey},targetContext:'CURRENT_TARGET',runtimeInputBindings:[],resultModifiers:[]}]}]};
  snapshot.skillConfigurations.push(witness);
  snapshot.source.attachedSkills.push({...snapshot.source.attachedSkills[0]!,skillKey:witnessKey,skillName:witness.skill.name});
  snapshot.selection.sourceSkillSettings.push({origin:snapshot.selection.plannedSkills[0]!.origin,skillKey:witnessKey,enabled:true,skillLevel:1});
  syncSimulationSkillSources(snapshot);
  // 后台实际清单含主动首尾及自然后置；此辅助函数原本仅模拟旧自然事件集合。
  snapshot.source.skillSources.find(row=>row.skillKey===key)!.enabledRuleKeys=config.triggerRules.map(row=>row.ruleKey).sort();
  const witnessSource=snapshot.source.skillSources.find(row=>row.skillKey===witnessKey)!;
  witnessSource.enabledRuleKeys=['on_real_chain_hit'];witnessSource.inactiveReason=null;
  return {snapshot,config,cast,post,after,head,tail,speed,slow,stun,witness};
}
