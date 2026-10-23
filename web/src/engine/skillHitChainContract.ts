import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { GenericFormulaExpr } from '../types/genericEngine';
import { NumericAdaptationError } from './numericAdapter';
import { selectSimulationSkillSourceClosure } from './simulationSkillSourceClosure';

type Rule = SkillTriggerRuleDetail;
const META = ['name', 'description', 'sortOrder', 'createdAt', 'updatedAt'];
function fail(path: string, message: string): never { throw new NumericAdaptationError(path, `首段资格链：${message}`); }
function exact(value: unknown, fields: readonly string[], path: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '需要完整对象');
  if (Object.keys(value).some(key => !fields.includes(key))) fail(path, '不能忽略额外字段');
}
function one<T>(values: T[], path: string): T { if (values.length !== 1) fail(path, '需要唯一实际引用'); return values[0]!; }
function fixed(value: unknown, expected: number) {
  return !!value && typeof value === 'object' && Object.keys(value).length === 2
    && (value as { kind?: string }).kind === 'FIXED' && (value as { value?: number }).value === expected;
}
function moment(value: { momentType: string; stepKey: string|null; failureReason?: string|null }, kind: string, step: string|null, path: string) {
  exact(value, ['momentType', 'stepKey', 'failureReason'], path);
  if (value.momentType !== kind || value.stepKey !== step || value.failureReason != null) fail(path, '过程时点不匹配');
}
function conditions(rule: Rule, path: string) {
  const group = one(rule.conditionGroups, path); exact(group, ['groupKey', 'conditions', ...META], path);
  if (!group.conditions.length) fail(path, '缺少完整条件');
  return group.conditions;
}
function eventCondition(rule: Rule, key: string, expected: number) {
  return conditions(rule, rule.ruleKey).some(row => row.conditionType === 'EVENT_VALUE_COMPARE'
    && row.detail.eventValueKey === key && row.detail.comparator === 'EQ' && fixed(row.detail.comparisonValue, expected)
    && Object.keys(row.detail).every(field => ['eventValueKey', 'comparator', 'comparisonValue'].includes(field)));
}

/** 只识别真实两段自身资格图；不把任意命中START_PROCESS放进旧候选白名单。 */
export function skillHitChainContract(configuration: SkillConfiguration) {
  const root = `skills.${configuration.skill.skillKey}`, skillKey = configuration.skill.skillKey;
  const possible = configuration.triggerRules.filter(row => row.eventSource.eventType === 'SKILL_HIT'
    && Object.prototype.hasOwnProperty.call(row.eventSource.detail, 'processMoment')
    && row.actions.some(action => action.actionType === 'START_PROCESS'));
  if (!possible.length) return null;
  const postRule = one(possible, `${root}.triggerRules`);
  if (postRule.oncePerUse !== null || postRule.perTargetCooldown !== null || postRule.maxTriggersPerProcess !== null
    || conditions(postRule, root).length !== 2 || !eventCondition(postRule, 'SKILL_HIT_FIRST_CONTACT', 1)
    || !eventCondition(postRule, 'SKILL_HIT_SPELL_SHIELD_BLOCKED', 0)) fail(root, '后置规则必须仅以真实首接触且未阻挡为条件，不申请额外配额');
  const postAction = one(postRule.actions, `${root}.triggerRules.${postRule.ruleKey}.actions`);
  if (postAction.actionType !== 'START_PROCESS' || postAction.targetContext !== 'CURRENT_TARGET'
    || postAction.runtimeInputBindings.length || postAction.resultModifiers.length) fail(root, '后置只接完整无绑定的当前对手即时过程');
  exact(postAction.detail, ['processKey'], root);
  const postProcess = one(configuration.processes.filter(row => row.processKey === postAction.detail.processKey), root);
  const postStep = one(postProcess.steps, root);
  if (postProcess.activationType !== 'PASSIVE' || postProcess.cooldown !== null || postStep.stepType !== 'IMMEDIATE'
    || postStep.occupiesAction !== false) fail(root, '后置必须是无冷却不占用的单即时被动过程');
  exact(postStep.detail, [], root);
  const write = one(postProcess.stateOperations, root);
  if (write.stateSkillKey !== skillKey || write.operation !== 'SET' || write.optionKey !== null || !fixed(write.value, 1)) fail(root, '后置只能设置本技能唯一资格为1');
  moment(write.moment, 'STEP_EXECUTION', postStep.stepKey, root);
  const state = one(configuration.internalStates, `${root}.internalStates`);
  if (state.stateKey !== write.stateKey || state.skillKey !== skillKey || state.gameId !== configuration.skill.gameId
    || state.stateType !== 'COUNTER' || state.scope !== 'SKILL' || !fixed(state.detail.initialValue, 0)
    || !fixed(state.detail.maxValue, 1) || state.detail.durationValue != null) fail(root, '资格须为同技能无期初0上限1普通计数');
  exact(state.detail, ['initialValue', 'maxValue', 'durationValue'], root);
  const initial = one(configuration.triggerRules.filter(row => row.eventSource.eventType === 'SKILL_USED'), root);
  if (initial.eventSource.eventType !== 'SKILL_USED' || initial.eventSource.detail.sourceSkillKey !== skillKey
    || initial.eventSource.detail.castPhase !== 'INITIAL' || initial.eventSource.detail.useKind !== 'ACTIVE'
    || initial.conditionGroups.length || initial.oncePerUse !== null || initial.perTargetCooldown !== null || initial.maxTriggersPerProcess !== null) fail(root, '须唯一无条件真实INITIAL');
  const initialAction = one(initial.actions, root);
  if (initialAction.actionType !== 'START_PROCESS' || initialAction.targetContext !== 'CURRENT_TARGET'
    || initialAction.runtimeInputBindings.length || initialAction.resultModifiers.length) fail(root, '首次只启动实际同目标过程');
  const process = one(configuration.processes.filter(row => row.processKey === initialAction.detail.processKey), root);
  if (configuration.processes.length !== 2 || process === postProcess || process.activationType !== 'ACTIVE'
    || process.skillKey !== skillKey || postProcess.skillKey !== skillKey || process.gameId !== configuration.skill.gameId
    || postProcess.gameId !== configuration.skill.gameId || process.steps.length !== 4) fail(root, '完整图只能含唯一主动及后置过程');
  const steps = [...process.steps].sort((a,b)=>a.sortOrder-b.sortOrder);
  if (new Set(steps.map(row=>row.stepKey)).size !== 4 || new Set(steps.map(row=>row.sortOrder)).size !== 4
    || steps.some((row,i)=>row.stepType !== (i%2===0?'DELAY':'IMMEDIATE') || row.occupiesAction !== (i===0))) fail(root, '须施法等待、首段、链等待、尾段的完整四步图');
  for (const [i, step] of steps.entries()) exact(step.detail, i%2===0?['delayValue']:[], root);
  const head = steps[1]!, tail = steps[3]!;
  if (process.stateOperations.length !== 3) fail(root, '开始、完成及失败都须明确清零');
  for (const kind of ['PROCESS_START', 'PROCESS_COMPLETE', 'PROCESS_FAILURE']) {
    const operation = one(process.stateOperations.filter(row=>row.moment.momentType===kind), root);
    if (operation.stateKey !== state.stateKey || operation.stateSkillKey !== skillKey || operation.operation !== 'SET'
      || operation.optionKey !== null || !fixed(operation.value,0)) fail(root, '清零不能借用其它字段或值');
    moment(operation.moment, kind, null, root);
  }
  const hitRules = configuration.triggerRules.filter(row=>row.eventSource.eventType==='SKILL_HIT' && row !== postRule);
  if (hitRules.length !== 4 || configuration.triggerRules.length !== 6) fail(root, '首伤减速及尾伤晕眩必须完整且没有额外规则');
  for (const rule of [postRule,...hitRules]) {
    const source = rule.eventSource;
    if (source.eventType !== 'SKILL_HIT' || source.detail.sourceSkillKey !== skillKey || !source.detail.processMoment) fail(root, '必须引用同一实际技能阶段');
    exact(source.detail,['sourceSkillKey','processMoment'],root);
    const phase = source.detail.processMoment;
    exact(phase,['processKey','moment','requiresPriorStepKey'],root);
    const step = rule===postRule?head.stepKey:phase.moment.stepKey;
    if (phase.processKey !== process.processKey || ![head.stepKey,tail.stepKey].includes(step ?? '')
      || phase.requiresPriorStepKey !== (step===tail.stepKey?head.stepKey:null)) fail(root, '首尾引用或前置关系错误');
    moment(phase.moment,'STEP_EXECUTION',step,root);
  }
  const headRules=hitRules.filter(row=>row.eventSource.eventType==='SKILL_HIT' && row.eventSource.detail.processMoment!.moment.stepKey===head.stepKey);
  const tailRules=hitRules.filter(row=>!headRules.includes(row));
  if(headRules.length!==2 || tailRules.length!==2)fail(root,'首尾必须各有两个必要结果规则');
  for(const rule of tailRules){
    const check=one(conditions(rule,root),root);
    if(check.conditionType!=='INTERNAL_STATE_CHECK' || check.detail.stateSkillKey!==skillKey || check.detail.stateKey!==state.stateKey
      || check.detail.valueKind!=='VALUE' || check.detail.optionKey!==null || check.detail.expectedBoolean!==null
      || check.detail.comparator!=='EQ' || !fixed(check.detail.comparisonValue,1))fail(root,'每个尾结果必须共用单一自身计数EQ1');
  }
  const getEffect=(rule:Rule)=>{
    if(rule.oncePerUse!==null || rule.perTargetCooldown!==null || rule.maxTriggersPerProcess!==null)fail(root,'阶段结果不能附加配额');
    const action=one(rule.actions,root);
    if(action.actionType!=='EXECUTE_EFFECT' || action.targetContext!=='CURRENT_TARGET' || action.runtimeInputBindings.length || action.resultModifiers.length)fail(root,'命中阶段仅执行完整当前对手效果');
    return one(configuration.effects.filter(row=>row.effectKey===action.detail.effectKey),root);
  };
  const headEffects=headRules.map(getEffect),tailEffects=tailRules.map(getEffect);
  const checkPair=(effects:typeof headEffects, first:boolean)=>{
    if(effects.some(effect=>effect.results.length!==1))fail(root,'每个必要效果必须只有一个完整结果');
    const damage=one(effects.filter(effect=>effect.results[0]!.resultType==='DAMAGE'),root);
    const control=one(effects.filter(effect=>effect.results[0]!.resultType==='STATUS_OPERATION'),root);
    if(damage.lifecycle!==null || damage.results[0]!.target!=='TARGET' || damage.results[0]!.spellShieldBlockScope!==(first?'SKILL':null)
      || control.lifecycle?.instanceScope!=='SOURCE_TARGET' || control.results[0]!.target!=='TARGET'
      || control.results[0]!.spellShieldBlockScope!==(first?'RESULT':null))fail(root,'首段同次判盾与尾段无盾粒度必须完整保持');
    return {damage,control};
  };
  const firstPair=checkPair(headEffects,true),tailPair=checkPair(tailEffects,false);
  const firstDamageRule=headRules[headEffects.indexOf(firstPair.damage)]!,slowRule=headRules[headEffects.indexOf(firstPair.control)]!;
  if(firstDamageRule.conditionGroups.length || conditions(slowRule,root).length!==1 || !eventCondition(slowRule,'SKILL_HIT_SPELL_SHIELD_BLOCKED',0))fail(root,'首伤无条件，减速必须核同次未阻挡');
  const binding=one(postProcess.effectBindings,root), speed=one(configuration.effects.filter(row=>row.effectKey===binding.effectKey),root);
  moment(binding.moment,'STEP_EXECUTION',postStep.stepKey,root);
  if(binding.sortOrder===write.sortOrder || speed.results.length!==1 || speed.lifecycle?.instanceScope!=='SOURCE'
    || speed.lifecycle.expiryMode!=='ALL_AT_ONCE' || speed.lifecycle.reapplicationStackMode!=='KEEP'
    || speed.lifecycle.reapplicationDurationMode!=='REFRESH_ALL' || !fixed(speed.lifecycle.maxStacksValue,1)
    || !fixed(speed.lifecycle.applicationStacksValue,1) || speed.lifecycle.periodicIntervalValue!==null
    || speed.lifecycle.firstPeriodicExecution!==null || speed.lifecycle.endWhenShieldEndsResultKey!=null || speed.lifecycle.durationValue==null)fail(root,'自身加速须完整有限单层来源效果');
  const speedResult=speed.results[0]!;
  if(speedResult.resultType!=='ATTRIBUTE_CHANGE' || speedResult.target!=='SOURCE' || speedResult.detail.operation!=='INCREASE'
    || speedResult.detail.attributeKey!=='move_speed' || speedResult.spellShieldBlockScope!==null
    || speedResult.lifecycleBehavior?.moment!=='PERSISTENT' || speedResult.lifecycleBehavior.valueReadMode!=='APPLICATION_SNAPSHOT'
    || speedResult.lifecycleBehavior.stackValueMode!=='SHARED' || speedResult.lifecycleBehavior.reapplicationValueMode!=='REPLACE'
    || speedResult.lifecycleBehavior.periodicExecutionMode!==null)fail(root,'后置只能提供有限自身移速比例属性');
  const costEffects=process.effectBindings.map(binding=>{
    moment(binding.moment,'PROCESS_START',null,root);
    const effect=one(configuration.effects.filter(row=>row.effectKey===binding.effectKey),root);
    if(effect.lifecycle!==null || effect.results.some(row=>row.resultType!=='RESOURCE_CHANGE' || row.target!=='SOURCE' || row.detail.operation!=='CONSUME'))fail(root,'主动额外效果只能是明确普通费用');
    return effect;
  });
  const usedEffects=new Set([...headEffects,...tailEffects,speed,...costEffects]);
  if(configuration.effects.some(row=>!usedEffects.has(row)))fail(root,'额外效果不能忽略');
  return {state,process,postRule,postProcess,head,tail,headRules,tailRules,speed,firstPair,tailPair};
}

export type SkillHitChainContract = NonNullable<ReturnType<typeof skillHitChainContract>>;
export function isSkillHitChainPostRule(configuration: SkillConfiguration, rule: Rule): boolean {
  return skillHitChainContract(configuration)?.postRule.ruleKey===rule.ruleKey;
}
export function skillHitChainPredicate():GenericFormulaExpr{
  return {op:'min',args:[{op:'eq',args:[{op:'read',path:'event.skill_hit.firstContact'},{op:'const',value:1}]},
    {op:'eq',args:[{op:'read',path:'event.skill_hit.blocked'},{op:'const',value:0}]}]};
}
/** 仅完整图已核定后，内部副本消去processMoment，避免把ACTIVE过程带入自然静态执行闭包。 */
export function skillHitChainNaturalConfiguration(configuration:SkillConfiguration,rootKeys:readonly string[]){
  const contract=skillHitChainContract(configuration);
  if(!contract || rootKeys.length!==1 || rootKeys[0]!==contract.postRule.ruleKey)fail(`skills.${configuration.skill.skillKey}`,'自然根必须恰为已核首段后置规则');
  const normalized={...configuration,triggerRules:configuration.triggerRules.map(rule=>rule===contract.postRule
    ? {...rule,eventSource:{eventType:'SKILL_HIT' as const,detail:{sourceSkillKey:configuration.skill.skillKey}}}:rule)};
  return selectSimulationSkillSourceClosure(normalized,rootKeys).configuration;
}
