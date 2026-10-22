import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffect, SkillEffectDamageResult, SkillEffectResourceChangeResult } from '../types/skillEffect';
import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillProcess } from '../types/skillProcess';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import { NumericAdaptationError } from './numericAdapter';

type Counter = Extract<SkillInternalState, { stateType: 'COUNTER' }>;
export type TargetMarkAuthoringContract = {
  state: Counter;
  cast: SkillProcess;
  onUsed: SkillTriggerRuleDetail;
  rootRule: SkillTriggerRuleDetail;
  rootEffect: SkillEffect;
  applicationRule: SkillTriggerRuleDetail;
  applicationProcess: SkillProcess;
  attack: { rule: SkillTriggerRuleDetail; process: SkillProcess; effect: SkillEffect; damage: SkillEffectDamageResult };
  skill: { rules: SkillTriggerRuleDetail[]; process: SkillProcess; effect: SkillEffect;
    damage: SkillEffectDamageResult; restore: SkillEffectResourceChangeResult | null };
  costEffects: SkillEffect[];
};
const META = ['name', 'description', 'sortOrder', 'createdAt', 'updatedAt'];
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: unknown, keys: readonly string[], path: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '需要完整目标标记作者对象');
  const extra = Object.keys(value).find(key => !keys.includes(key));
  if (extra) fail(`${path}.${extra}`, '目标标记图不接受未支持字段');
}
function rows<T>(value: T[], key: keyof T, path: string): T[] {
  if (!Array.isArray(value)) fail(path, '需要完整作者数组');
  const seen = new Set<unknown>();
  for (const row of value) {
    const id = row?.[key];
    if (typeof id !== 'string' || !KEY.test(id) || seen.has(id)) fail(path, '作者标识须合法且唯一');
    seen.add(id);
  }
  return value;
}
function one<T>(values: T[], path: string): T {
  if (values.length !== 1) fail(path, '目标标记图必须唯一完整绑定');
  return values[0]!;
}
const fixed = (value: unknown, expected: number) => !!value && typeof value === 'object'
  && Object.keys(value).length === 2 && (value as { kind?: string }).kind === 'FIXED'
  && (value as { value?: number }).value === expected;
function numeric(value: unknown, path: string) {
  if (!value || typeof value !== 'object') fail(path, '需要明确数值来源');
  const kind = (value as { kind?: string }).kind;
  exact(value, kind === 'FIXED' ? ['kind', 'value'] : kind === 'PARAMETER' ? ['kind', 'parameterKey'] : ['kind', 'formulaKey'], path);
  if (!['FIXED', 'PARAMETER', 'FORMULA'].includes(kind ?? '')) fail(path, '未知数值来源');
  if (kind === 'FIXED' && !Number.isFinite((value as { value: number }).value)) fail(path, '固定数值必须有限');
  if (kind !== 'FIXED' && !KEY.test((value as Record<string, string>)[kind === 'PARAMETER' ? 'parameterKey' : 'formulaKey'] ?? '')) fail(path, '数值引用缺少合法标识');
}
function moment(value: unknown, kind: string, step: string | null, path: string) {
  exact(value, ['momentType', 'stepKey', 'failureReason'], path);
  const row = value as { momentType?: string; stepKey?: string | null; failureReason?: string | null };
  if (row.momentType !== kind || row.stepKey !== step || row.failureReason != null) fail(path, '目标标记过程时点不匹配');
}
function start(rule: SkillTriggerRuleDetail, process: SkillProcess) {
  const action = one(rule.actions, `skills.${rule.ruleKey}.actions`);
  if (action.actionType !== 'START_PROCESS' || action.detail.processKey !== process.processKey
    || action.targetContext !== 'CURRENT_TARGET' || action.runtimeInputBindings.length || action.resultModifiers.length) {
    fail(`triggerRules.${rule.ruleKey}`, '目标标记过程必须由唯一无绑定的当前目标动作启动');
  }
}
function plainRule(rule: SkillTriggerRuleDetail, path: string) {
  exact(rule, ['ruleKey', 'eventSource', 'conditionGroups', 'actions', 'perTargetCooldown', 'maxTriggersPerProcess', 'oncePerUse', ...META], path);
  if (rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null || rule.oncePerUse !== null) fail(path, '目标标记图不接受触发额度或节流');
  exact(rule.eventSource, ['eventType', 'detail'], `${path}.eventSource`);
  rows(rule.actions, 'actionKey', `${path}.actions`);
  for (const action of rule.actions) {
    exact(action, ['actionKey', 'name', 'sortOrder', 'actionType', 'detail', 'targetContext', 'runtimeInputBindings', 'resultModifiers'], path);
    if (!Array.isArray(action.runtimeInputBindings) || action.runtimeInputBindings.length || !Array.isArray(action.resultModifiers) || action.resultModifiers.length) fail(path, '标记图禁止隐藏输入或结果修正');
    exact(action.detail, [action.actionType === 'START_PROCESS' ? 'processKey' : 'effectKey'], `${path}.actions.${action.actionKey}.detail`);
  }
  rows(rule.conditionGroups, 'groupKey', `${path}.conditionGroups`);
  for (const group of rule.conditionGroups) {
    exact(group, ['groupKey', 'name', 'sortOrder', 'conditions'], path);
    rows(group.conditions, 'conditionKey', `${path}.conditions`);
    for (const condition of group.conditions) exact(condition, ['conditionKey', 'conditionType', 'sortOrder', 'detail'], path);
  }
}
function conditions(rule: SkillTriggerRuleDetail) {
  if (rule.conditionGroups.length !== 1) fail(`triggerRules.${rule.ruleKey}.conditionGroups`, '目标标记条件只允许一个明确合取组');
  return rule.conditionGroups[0]!.conditions;
}
function blocked(condition: ReturnType<typeof conditions>[number]) {
  if (condition.conditionType !== 'EVENT_VALUE_COMPARE') return false;
  exact(condition.detail, ['eventValueKey', 'comparator', 'comparisonValue'], 'targetMark.blocked');
  return condition.detail.eventValueKey === 'SKILL_HIT_SPELL_SHIELD_BLOCKED'
    && condition.detail.comparator === 'EQ' && fixed(condition.detail.comparisonValue, 0);
}
function activeMark(condition: ReturnType<typeof conditions>[number], skillKey: string, stateKey: string) {
  if (condition.conditionType !== 'INTERNAL_STATE_CHECK') return false;
  const d = condition.detail;
  exact(d, ['stateSkillKey', 'stateKey', 'valueKind', 'optionKey', 'expectedBoolean', 'comparator', 'comparisonValue'], 'targetMark.condition');
  return d.stateSkillKey === skillKey && d.stateKey === stateKey && d.valueKind === 'VALUE'
    && d.optionKey === null && d.expectedBoolean === null && d.comparator === 'EQ' && fixed(d.comparisonValue, 1);
}
function skillEvent(rule: SkillTriggerRuleDetail, skillKey: string) {
  if (rule.eventSource.eventType !== 'SKILL_HIT') return false;
  exact(rule.eventSource.detail, ['sourceSkillKey'], `triggerRules.${rule.ruleKey}.eventSource.detail`);
  return rule.eventSource.detail.sourceSkillKey === skillKey;
}
function passive(process: SkillProcess, stateKey: string, skillKey: string, value: number) {
  const path = `skills.${skillKey}.processes.${process.processKey}`;
  if (process.activationType !== 'PASSIVE' || process.cooldown !== null || process.steps.length !== 1
    || process.steps[0]!.stepType !== 'IMMEDIATE' || process.steps[0]!.occupiesAction !== false) fail(path, '标记辅助过程必须即时、无冷却且不占用行动');
  exact(process.steps[0]!.detail, [], `${path}.steps.detail`);
  const operation = one(process.stateOperations, `${path}.stateOperations`);
  if (operation.stateSkillKey !== skillKey || operation.stateKey !== stateKey || operation.operation !== 'SET'
    || !fixed(operation.value, value) || operation.optionKey !== null) fail(path, '标记过程只能对本技能目标计数执行明确SET');
  moment(operation.moment, 'PROCESS_START', null, `${path}.stateOperations.moment`);
  for (const binding of process.effectBindings) moment(binding.moment, 'STEP_EXECUTION', process.steps[0]!.stepKey, `${path}.effectBindings.moment`);
}
function damage(effect: SkillEffect): SkillEffectDamageResult {
  const result = one(effect.results.filter(row => row.resultType === 'DAMAGE'), `effects.${effect.effectKey}.results`);
  if (result.resultType !== 'DAMAGE' || effect.lifecycle !== null || result.lifecycleBehavior !== null
    || result.target !== 'TARGET' || result.spellShieldBlockScope !== 'DAMAGE_INSTANCE'
    || result.detail.deliveryKind !== 'SKILL' || result.detail.originKind !== 'DIRECT'
    || result.detail.vampQualification !== 'RESOLVED' || result.detail.critical.mode !== 'DISALLOWED'
    || result.detail.critical.multiplierValue !== null || 'attackDamageRole' in result.detail) {
    fail(`effects.${effect.effectKey}`, '标记附伤只允许即时、独立可阻挡、已核定的不暴击普通技能直接伤害');
  }
  return result;
}

/** 只识别完整有限目标标记图；旧EARLY_REMOVE或其它作者图交原入口拒绝/处理。 */
export function targetMarkAuthoringContract(configuration: SkillConfiguration): TargetMarkAuthoringContract | null {
  const seed = configuration.processes.some(process => process.activationType === 'PASSIVE'
    && process.stateOperations.some(operation => operation.operation === 'SET' && fixed(operation.value, 0))
    && process.effectBindings.some(binding => configuration.effects.some(effect => effect.effectKey === binding.effectKey
      && effect.results.some(result => result.resultType === 'DAMAGE' && result.spellShieldBlockScope === 'DAMAGE_INSTANCE'))));
  if (!seed) return null;
  const skillKey = configuration.skill.skillKey, root = `skills.${skillKey}`;
  for (const [values, key, label] of [[configuration.internalStates, 'stateKey', 'internalStates'], [configuration.processes, 'processKey', 'processes'],
    [configuration.effects, 'effectKey', 'effects'], [configuration.triggerRules, 'ruleKey', 'triggerRules']] as const) rows(values as Array<Record<string, unknown>>, key, `${root}.${label}`);
  const state = one(configuration.internalStates, `${root}.internalStates`);
  if (state.stateType !== 'COUNTER' || state.scope !== 'TARGET' || state.gameId !== configuration.skill.gameId || state.skillKey !== skillKey
    || !fixed(state.detail.initialValue, 0) || state.detail.durationValue == null) fail(root, '标记必须为本技能初0、有期TARGET计数');
  exact(state, ['gameId', 'skillKey', 'stateKey', 'stateType', 'scope', 'detail', ...META], `${root}.internalStates`);
  exact(state.detail, ['initialValue', 'maxValue', 'durationValue'], `${root}.internalStates.${state.stateKey}.detail`);
  numeric(state.detail.maxValue, root); numeric(state.detail.durationValue, root);
  for (const process of configuration.processes) {
    exact(process, ['gameId', 'skillKey', 'processKey', 'activationType', 'cooldown', 'steps', 'effectBindings', 'stateOperations', ...META], `${root}.processes`);
    if (process.gameId !== configuration.skill.gameId || process.skillKey !== skillKey) fail(root, '过程必须属于当前技能');
    rows(process.steps, 'stepKey', root); rows(process.effectBindings, 'bindingKey', root); rows(process.stateOperations, 'operationKey', root);
    for (const step of process.steps) exact(step, ['stepKey', 'name', 'description', 'sortOrder', 'stepType', 'detail', 'occupiesAction'], root);
    for (const binding of process.effectBindings) exact(binding, ['bindingKey', 'effectKey', 'moment', 'sortOrder'], root);
    for (const operation of process.stateOperations) exact(operation, ['operationKey', 'name', 'stateSkillKey', 'stateKey', 'operation', 'value', 'optionKey', 'moment', 'sortOrder'], root);
  }
  for (const effect of configuration.effects) {
    exact(effect, ['gameId', 'skillKey', 'effectKey', 'lifecycle', 'results', ...META], root);
    if (effect.gameId !== configuration.skill.gameId || effect.skillKey !== skillKey || effect.lifecycle !== null) fail(root, '标记图效果须为本技能即时结果');
    rows(effect.results, 'resultKey', root);
    if (!effect.results.length) fail(root, '标记图效果必须有完整结果');
    for (const result of effect.results) {
      exact(result, ['resultKey', 'name', 'description', 'sortOrder', 'resultType', 'target', 'lifecycleBehavior', 'spellShieldBlockScope', 'valueRule', 'detail'], root);
      if (result.lifecycleBehavior !== null || !result.valueRule) fail(root, '标记图不支持持续/提前移除结果');
      exact(result.valueRule, ['value', 'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue'], root);
      numeric(result.valueRule.value, root);
      if (!Number.isFinite(result.valueRule.fixedMultiplier) || result.valueRule.fixedMultiplier < 0
        || result.valueRule.fixedMinValue !== null && !Number.isFinite(result.valueRule.fixedMinValue)
        || result.valueRule.fixedMaxValue !== null && !Number.isFinite(result.valueRule.fixedMaxValue)
        || result.valueRule.fixedMinValue !== null && result.valueRule.fixedMaxValue !== null
          && result.valueRule.fixedMinValue > result.valueRule.fixedMaxValue) fail(root, '数值修正规则须完整有限且有序');
      if (result.resultType === 'DAMAGE') {
        exact(result.detail, ['damageTypeKey', 'deliveryKind', 'originKind', 'critical', 'vampQualification', 'vampOverrides'], root);
        exact(result.detail.critical, ['mode', 'multiplierValue'], root);
      } else if (result.resultType === 'RESOURCE_CHANGE') exact(result.detail, ['attributeKey', 'operation'], root);
      else fail(root, '标记图不得夹带其它结果');
    }
  }
  for (const rule of configuration.triggerRules) plainRule(rule, `${root}.triggerRules.${rule.ruleKey}`);
  const cast = one(configuration.processes.filter(process => process.activationType === 'ACTIVE'), `${root}.processes`);
  if (cast.steps.length !== 1 || cast.steps[0]!.stepType !== 'DELAY' || cast.steps[0]!.occupiesAction !== true
    || cast.stateOperations.length || !cast.cooldown) fail(root, '挂标主动过程须为唯一有明确占用和冷却的延时过程');
  exact(cast.steps[0]!.detail, ['delayValue'], root);
  exact(cast.cooldown, ['durationValue', 'startMoment'], root);
  numeric(cast.cooldown.durationValue, root); numeric(cast.steps[0]!.detail.delayValue, root);
  moment(cast.cooldown.startMoment, 'PROCESS_START', null, root);
  const onUsed = one(configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_USED'), `${root}.onUsed`);
  if (onUsed.eventSource.eventType !== 'SKILL_USED' || onUsed.eventSource.detail.sourceSkillKey !== skillKey
    || onUsed.eventSource.detail.useKind !== 'ACTIVE' || onUsed.eventSource.detail.castPhase !== 'INITIAL'
    || onUsed.conditionGroups.length) fail(root, '挂标须由本技能真实首次主动使用启动');
  exact(onUsed.eventSource.detail, ['sourceSkillKey', 'useKind', 'castPhase'], root); start(onUsed, cast);
  const ownHits = configuration.triggerRules.filter(rule => skillEvent(rule, skillKey));
  const rootRule = one(ownHits.filter(rule => rule.actions.length === 1 && rule.actions[0]!.actionType === 'EXECUTE_EFFECT'), `${root}.rootHit`);
  const rootAction = rootRule.actions[0]!;
  if (rootAction.actionType !== 'EXECUTE_EFFECT' || rootAction.targetContext !== 'CURRENT_TARGET') fail(root, '零应用根须真实当前目标执行效果');
  const rootEffect = one(configuration.effects.filter(effect => effect.effectKey === (rootAction.detail as { effectKey: string }).effectKey), root);
  const zero = one(rootEffect.results, root);
  if (zero.resultType !== 'DAMAGE' || zero.target !== 'TARGET' || zero.spellShieldBlockScope !== 'SKILL'
    || zero.detail.deliveryKind !== 'SKILL' || zero.detail.originKind !== 'DIRECT' || zero.detail.vampQualification !== 'RESOLVED'
    || zero.detail.critical.mode !== 'DISALLOWED' || zero.detail.critical.multiplierValue !== null || !fixed(zero.valueRule.value, 0)
    || zero.valueRule.fixedMultiplier !== 1 || zero.valueRule.fixedMinValue !== 0 || zero.valueRule.fixedMaxValue !== null) fail(root, '挂标根只能保留完整零应用伤害与SKILL阻挡事实');
  const applicationRule = one(ownHits.filter(rule => rule !== rootRule), `${root}.applicationRule`);
  const applicationAction = one(applicationRule.actions, root);
  if (applicationAction.actionType !== 'START_PROCESS') fail(root, '挂标必须由即时过程写入');
  const applicationProcess = one(configuration.processes.filter(process => process.processKey === (applicationAction.detail as { processKey: string }).processKey), root);
  passive(applicationProcess, state.stateKey, skillKey, 1); start(applicationRule, applicationProcess);
  if (applicationProcess.effectBindings.length) fail(root, '挂标过程不得同时消费附伤');
  const applicationConditions = conditions(applicationRule);
  if (applicationConditions.filter(blocked).length !== 1) fail(root, '挂标须明确未被法盾阻挡');
  const rootConditions = rootRule.conditionGroups.length ? conditions(rootRule) : [];
  for (const condition of rootConditions) {
    if (condition.conditionType !== 'TARGET_CATEGORY_CHECK') fail(root, '零应用根只接受明确目标类别条件');
    exact(condition.detail, ['categories'], root);
    if (!condition.detail.categories.length || new Set(condition.detail.categories).size !== condition.detail.categories.length) fail(root, '目标类别须明确唯一');
  }
  const comparable = (values: typeof rootConditions) => values.map(condition => ({ conditionType: condition.conditionType, detail: condition.detail }));
  if (JSON.stringify(comparable(applicationConditions.filter(condition => !blocked(condition)))) !== JSON.stringify(comparable(rootConditions))) fail(root, '挂标与真实零应用根的目标资格必须相同');
  const attackRule = one(configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'BASIC_ATTACK_HIT'), `${root}.attackRule`);
  exact(attackRule.eventSource.detail, [], root);
  const skillRules = configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_HIT' && !skillEvent(rule, skillKey));
  if (!skillRules.length || new Set(skillRules.map(rule => (rule.eventSource.detail as { sourceSkillKey: string }).sourceSkillKey)).size !== skillRules.length) fail(root, '技能消费须来自唯一明确兄弟技能事件');
  const consume = (rule: SkillTriggerRuleDetail, isAttack: boolean) => {
    const list = conditions(rule);
    if (list.length !== (isAttack ? 1 : 2) || list.filter(condition => activeMark(condition, skillKey, state.stateKey)).length !== 1
      || !isAttack && list.filter(blocked).length !== 1) fail(root, '消费须读本技能目标印记1，技能消费还须未被法盾阻挡');
    const action = one(rule.actions, root);
    if (action.actionType !== 'START_PROCESS') fail(root, '消费必须由完整即时过程表达');
    const process = one(configuration.processes.filter(process => process.processKey === (action.detail as { processKey: string }).processKey), root);
    start(rule, process); passive(process, state.stateKey, skillKey, 0);
    const binding = one(process.effectBindings, root);
    const effect = one(configuration.effects.filter(effect => effect.effectKey === binding.effectKey), root);
    return { rule, process, effect, damage: damage(effect) };
  };
  const attack = consume(attackRule, true), skill = consume(skillRules[0]!, false);
  if (attack.effect.results.length !== 1 || attack.process === skill.process || attack.effect === skill.effect) fail(root, '普攻与技能消费负载须独立，普攻不得回蓝');
  for (const rule of skillRules) {
    if (rule.eventSource.eventType !== 'SKILL_HIT' || !KEY.test(rule.eventSource.detail.sourceSkillKey ?? '') || rule.eventSource.detail.sourceSkillKey === skillKey) fail(root, '技能消费事件须显式兄弟来源');
    const other = consume(rule, false);
    if (other.process !== skill.process || other.effect !== skill.effect) fail(root, '技能消费规则须指向同一完整结算过程');
  }
  const restores = skill.effect.results.filter(result => result.resultType === 'RESOURCE_CHANGE');
  const restore = restores[0] ?? null;
  if (restores.length > 1 || skill.effect.results.length !== 1 + restores.length || restore && (restore.target !== 'SOURCE'
    || restore.detail.operation !== 'RESTORE' || restore.detail.attributeKey === 'hp' || restore.spellShieldBlockScope !== null)) fail(root, '技能消费只允许附伤及可选自身非生命静态恢复');
  const usedProcesses = new Set([cast, applicationProcess, attack.process, skill.process]);
  if (usedProcesses.size !== 4 || configuration.processes.some(process => !usedProcesses.has(process))) fail(root, '额外过程或状态写入者不属于完整标记图');
  const costEffects: SkillEffect[] = [];
  for (const binding of cast.effectBindings) {
    moment(binding.moment, 'PROCESS_START', null, root);
    const effect = one(configuration.effects.filter(effect => effect.effectKey === binding.effectKey), root);
    if (effect.results.some(result => result.resultType !== 'RESOURCE_CHANGE' || result.target !== 'SOURCE'
      || result.detail.operation !== 'CONSUME' || result.spellShieldBlockScope !== null)) fail(root, '主动过程只保留真实费用声明');
    costEffects.push(effect);
  }
  const usedEffects = new Set([rootEffect, attack.effect, skill.effect, ...costEffects]);
  if (configuration.effects.some(effect => !usedEffects.has(effect))) fail(root, '额外效果不能被目标标记图静默忽略');
  const usedRules = new Set([onUsed, rootRule, applicationRule, attackRule, ...skillRules]);
  if (ownHits.length !== 2 || configuration.triggerRules.some(rule => !usedRules.has(rule))) fail(root, '额外规则不能借用或绕过标记图');
  return { state, cast, onUsed, rootRule, rootEffect, applicationRule, applicationProcess, attack,
    skill: { rules: skillRules, process: skill.process, effect: skill.effect, damage: skill.damage, restore }, costEffects };
}

/** 供根接线把挂标/消费整个自然图从主动候选中分流，零应用根仍由实际主动执行。 */
export function isTargetMarkPostHitRule(configuration: SkillConfiguration, rule: SkillTriggerRuleDetail): boolean {
  const contract = targetMarkAuthoringContract(configuration);
  if (!contract) return false;
  const actual = configuration.triggerRules.find(candidate => candidate.ruleKey === rule.ruleKey);
  if (!actual || actual !== rule && JSON.stringify(actual) !== JSON.stringify(rule)) return false;
  return actual === contract.applicationRule || actual === contract.attack.rule || contract.skill.rules.includes(actual);
}
