import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { NumericValue } from '../types/numericValue';
import type { SkillTriggerAction, SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import { damageTypeFormulaAllowedBindings } from '../types/damageTypeFormula';
import { validateFormulaDefinition } from '../services/formulaContract';
import { sameFormulaPayload, validateStoredSkillFormula } from '../services/skillFormulaContract';
import { NumericAdaptationError } from './numericAdapter';
import { lowerRawDamageTargetValueRule, rawDamageTargetBinding } from './rawDamageTarget';

const metadata = ['createdAt', 'updatedAt'];
const named = ['name', 'description', 'sortOrder'];
function fail(path: string, message: string): never { throw new NumericAdaptationError(path, `标记原额图：${message}`); }
function exact(value: unknown, fields: readonly string[], path: string, optional: readonly string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || fields.some(key => !Object.prototype.hasOwnProperty.call(value, key))
    || Object.keys(value).some(key => !fields.includes(key) && !optional.includes(key))) fail(path, '缺少完整字段或混入额外字段');
}
function one<T>(values: readonly T[], path: string): T {
  if (values.length !== 1) fail(path, '必须是唯一实际定义');
  return values[0]!;
}
function key(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) fail(path, '需要明确稳定标识');
  return value;
}
function fixed(value: unknown, expected: number): boolean {
  return !!value && typeof value === 'object' && Object.keys(value).length === 2
    && (value as { kind?: unknown }).kind === 'FIXED' && (value as { value?: unknown }).value === expected;
}
function rawBindings(action: SkillTriggerAction): boolean {
  return Array.isArray(action.runtimeInputBindings) && action.runtimeInputBindings.some(binding => binding?.detail
    && 'eventValueKey' in binding.detail && binding.detail.eventValueKey === 'RAW_DAMAGE');
}

/** 从完整作者定义证明有限标记四规则图；不授予实际驱动、挂载或PRIMARY提交顺序。 */
export function validateMarkedRawDamageContract(snapshot: SimulationSnapshot, configuration: SkillConfiguration, path: string) {
  const rawRules = configuration.triggerRules.filter(rule => Array.isArray(rule.actions) && rule.actions.some(rawBindings));
  if (!rawRules.length) return undefined;
  const magicRule = one(rawRules, `${path}.triggerRules`), skillKey = key(configuration.skill.skillKey, path);
  if (configuration.skill.gameId !== snapshot.gameId || configuration.skill.status !== 'ENABLED') fail(path, '拥有者技能必须属于当前游戏且全局启用');
  const full = one(snapshot.skillConfigurations.filter(row => row.skill.skillKey === skillKey), path);
  if (!sameFormulaPayload(full, configuration)) fail(path, '必须消费snapshot中完整原定义，不能传入口裁剪图');
  for (const [rows, field] of [[configuration.parameters, 'parameterKey'], [configuration.formulas, 'formulaKey'],
    [configuration.effects, 'effectKey'], [configuration.internalStates, 'stateKey'], [configuration.processes, 'processKey'],
    [configuration.triggerRules, 'ruleKey']] as const) {
    const keys = rows.map(row => key((row as unknown as Record<string, unknown>)[field], path));
    if (new Set(keys).size !== keys.length) fail(path, '作者定义标识重复');
  }
  for (const parameter of configuration.parameters) {
    if (parameter.gameId !== snapshot.gameId || parameter.skillKey !== skillKey) fail(path, '参数归属不完整');
  }
  for (const formula of configuration.formulas) {
    if (formula.gameId !== snapshot.gameId || formula.skillKey !== skillKey || validateStoredSkillFormula(formula.expression, skillKey)) fail(path, '保留公式定义不完整或归属错误');
    for (const input of formula.expression.inputs) if (input.binding.kind === 'parameter') {
      const inputParameterKey = input.binding.parameterKey;
      one(configuration.parameters.filter(row => row.parameterKey === inputParameterKey), path);
    }
  }
  const staticValue = (value: NumericValue, where: string) => {
    let number: number | null;
    if (value.kind === 'FIXED') { exact(value, ['kind', 'value'], where); number = value.value; }
    else if (value.kind === 'PARAMETER') {
      exact(value, ['kind', 'parameterKey'], where);
      const parameter = one(configuration.parameters.filter(row => row.parameterKey === value.parameterKey), where);
      if (parameter.valueMode !== 'FIXED' || parameter.levelValues !== null) fail(where, '标记期限只允许明确固定参数');
      number = parameter.fixedValue;
    } else return fail(where, '标记期限不接未核定公式或运行输入');
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) fail(where, '标记期限必须是有限正安全整数毫秒');
    return number;
  };
  const state = one(configuration.internalStates, `${path}.internalStates`);
  exact(state, ['gameId', 'skillKey', 'stateKey', 'stateType', 'scope', 'detail', ...named], path, metadata);
  if (state.gameId !== snapshot.gameId || state.skillKey !== skillKey || state.stateType !== 'COUNTER' || state.scope !== 'TARGET') fail(path, '标记须为同技能普通TARGET计数');
  exact(state.detail, ['initialValue', 'maxValue', 'durationValue'], path);
  if (!fixed(state.detail.initialValue, 0) || !fixed(state.detail.maxValue, 1) || !state.detail.durationValue) fail(path, '标记须初0上限1且无初始绑定或时序扩展');
  const durationMs = staticValue(state.detail.durationValue, `${path}.internalStates.${state.stateKey}.detail.durationValue`);
  const process = one(configuration.processes, `${path}.processes`);
  exact(process, ['gameId', 'skillKey', 'processKey', 'activationType', 'cooldown', 'steps', 'effectBindings', 'stateOperations', ...named], path, metadata);
  const step = one(process.steps, path), stateWrite = one(process.stateOperations, path);
  if (process.gameId !== snapshot.gameId || process.skillKey !== skillKey || process.activationType !== 'PASSIVE'
    || process.cooldown !== null || process.effectBindings.length) fail(path, '标记过程须为本技能无冷却无效果挂接的被动过程');
  exact(step, ['stepKey', 'stepType', 'occupiesAction', 'detail', ...named], path);
  if (step.stepType !== 'IMMEDIATE' || step.occupiesAction !== false) fail(path, '只允许不占行动单即时步骤');
  exact(step.detail, [], path);
  exact(stateWrite, ['operationKey', 'name', 'sortOrder', 'stateSkillKey', 'stateKey', 'operation', 'optionKey', 'moment', 'value'], path);
  exact(stateWrite.moment, ['momentType', 'stepKey'], path, ['failureReason']);
  if (stateWrite.stateSkillKey !== skillKey || stateWrite.stateKey !== state.stateKey || stateWrite.operation !== 'SET' || stateWrite.optionKey !== null
    || !fixed(stateWrite.value, 1) || stateWrite.moment.momentType !== 'STEP_EXECUTION' || stateWrite.moment.stepKey !== step.stepKey
    || stateWrite.moment.failureReason != null) fail(path, '标记只能在真实即时步骤执行时对本目标SET1');
  if (configuration.triggerRules.length !== 4) fail(path, '必须完整保留四规则且不能有额外入口');
  const conditions = (rule: SkillTriggerRuleDetail) => {
    exact(rule, ['ruleKey', 'eventSource', 'conditionGroups', 'actions', 'perTargetCooldown', 'maxTriggersPerProcess', 'oncePerUse', ...named], path, metadata);
    if (rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null || rule.oncePerUse !== null) fail(path, '四入口都不能有额外节流或使用额度');
    const group = one(rule.conditionGroups, path); exact(group, ['groupKey', 'name', 'sortOrder', 'conditions'], path);
    for (const condition of group.conditions) exact(condition, ['conditionKey', 'conditionType', 'detail', 'sortOrder'], path);
    return group.conditions;
  };
  const before = (rule: SkillTriggerRuleDetail, comparator: 'EQ' | 'GTE', value: number) => {
    const condition = one(conditions(rule), path);
    if (condition.conditionType !== 'INTERNAL_STATE_CHECK') fail(path, '必须读取同笔伤前标记');
    const detail = condition.detail;
    exact(detail, ['stateSkillKey', 'stateKey', 'valueKind', 'optionKey', 'expectedBoolean', 'comparator', 'comparisonValue'], path);
    if (detail.stateSkillKey !== skillKey || detail.stateKey !== state.stateKey || detail.valueKind !== 'DAMAGE_BEFORE_VALUE'
      || detail.optionKey !== null || detail.expectedBoolean !== null || detail.comparator !== comparator || !fixed(detail.comparisonValue, value)) fail(path, '不能借活值、其它标记或其它阈值代替伤前资格');
  };
  const start = (rule: SkillTriggerRuleDetail) => {
    const action = one(rule.actions, path);
    exact(action, ['actionKey', 'actionType', 'targetContext', 'runtimeInputBindings', 'resultModifiers', 'detail', 'name', 'sortOrder'], path);
    if (action.actionType !== 'START_PROCESS' || action.targetContext !== 'CURRENT_TARGET'
      || action.runtimeInputBindings.length || action.resultModifiers.length) fail(path, '标记入口只允许启动同目标唯一过程');
    exact(action.detail, ['processKey'], path);
    if (action.detail.processKey !== process.processKey) fail(path, '标记过程引用不一致');
  };
  const damageEvent = (rule: SkillTriggerRuleDetail) => {
    exact(rule.eventSource, ['eventType', 'detail'], path);
    if (rule.eventSource.eventType !== 'DAMAGE_DEALT') fail(path, '必须沿真实伤害拥有者事件');
    exact(rule.eventSource.detail, ['sourceSkillKey', 'damageTypeKey', 'deliveryKind', 'originKind'], path);
    return rule.eventSource.detail;
  };
  before(magicRule, 'EQ', 1);
  const magic = damageEvent(magicRule), magicDamageTypeKey = key(magic.damageTypeKey, path);
  if (magic.sourceSkillKey !== null || magic.deliveryKind !== 'ANY' || magic.originKind !== 'ANY') fail(path, '派生入口必须完整监听拥有者本笔魔伤');
  const rawAction = one(magicRule.actions, path);
  const parameterKey = rawDamageTargetBinding(rawAction, magicRule, configuration, path);
  if (rawAction.actionType !== 'EXECUTE_EFFECT') fail(path, 'RAW只能执行唯一伤害效果');
  const effect = one(configuration.effects, `${path}.effects`), result = one(effect.results, path);
  if (effect.effectKey !== rawAction.detail.effectKey || result.resultType !== 'DAMAGE') fail(path, '派生结果引用不一致');
  const valueRule = result.valueRule;
  if (valueRule.value.kind === 'FORMULA') {
    const formulaKey = valueRule.value.formulaKey;
    const formula = one(configuration.formulas.filter(row => row.formulaKey === formulaKey), path);
    for (const input of formula.expression.inputs) if (input.binding.kind === 'parameter' && input.binding.parameterKey !== parameterKey) {
      const inputParameterKey = input.binding.parameterKey;
      const parameter = one(configuration.parameters.filter(row => row.parameterKey === inputParameterKey), path);
      if (parameter.valueMode !== 'FIXED' || parameter.levelValues !== null) fail(path, '原额静态系数不能随等级或运行输入变化');
    }
  }
  const loweredValue = lowerRawDamageTargetValueRule(valueRule, configuration, 1, 1, parameterKey, `${path}.effects.${effect.effectKey}.results.${result.resultKey}.valueRule`);
  const remaining = configuration.triggerRules.filter(rule => rule !== magicRule);
  const rRule = one(remaining.filter(rule => rule.eventSource.eventType === 'SKILL_HIT'), path);
  const rConditions = conditions(rRule);
  exact(rRule.eventSource, ['eventType', 'detail'], path); exact(rRule.eventSource.detail, ['sourceSkillKey'], path);
  if (rRule.eventSource.eventType !== 'SKILL_HIT') fail(path, '缺少真实技能命中挂标入口');
  const rSkillKey = key(rRule.eventSource.detail.sourceSkillKey, path);
  if (rConditions.length !== 2) fail(path, '技能挂标只能保留敌方及同次未阻挡资格');
  const enemy = one(rConditions.filter(condition => condition.conditionType === 'SKILL_HIT_TARGET_IS_ENEMY'), path);
  exact(enemy.detail, [], path);
  const blocked = one(rConditions.filter(condition => condition.conditionType === 'EVENT_VALUE_COMPARE'), path);
  if (blocked.conditionType !== 'EVENT_VALUE_COMPARE') fail(path, '缺少真实阻挡事实');
  exact(blocked.detail, ['eventValueKey', 'comparator', 'comparisonValue'], path);
  if (blocked.detail.eventValueKey !== 'SKILL_HIT_SPELL_SHIELD_BLOCKED' || blocked.detail.comparator !== 'EQ' || !fixed(blocked.detail.comparisonValue, 0)) fail(path, '技能挂标必须同次blocked=0');
  start(rRule);
  const damageRules = remaining.filter(rule => rule !== rRule);
  const primaryRule = one(damageRules.filter(rule => rule.eventSource.eventType === 'DAMAGE_DEALT' && rule.eventSource.detail.deliveryKind === 'BASIC_ATTACK'), path);
  const wRule = one(damageRules.filter(rule => rule !== primaryRule), path);
  const primary = damageEvent(primaryRule), refresh = damageEvent(wRule);
  const primarySkillKey = key(primary.sourceSkillKey, path), wSkillKey = key(refresh.sourceSkillKey, path);
  const physicalDamageTypeKey = key(primary.damageTypeKey, path), trueDamageTypeKey = key(result.detail.damageTypeKey, path);
  if (primary.deliveryKind !== 'BASIC_ATTACK' || primary.originKind !== 'DIRECT' || refresh.damageTypeKey !== magicDamageTypeKey
    || refresh.deliveryKind !== 'SKILL' || refresh.originKind !== 'ANY') fail(path, '物理主体或魔伤续期筛选不完整');
  before(primaryRule, 'GTE', 0); start(primaryRule); before(wRule, 'EQ', 1); start(wRule);
  if (new Set([skillKey, primarySkillKey, rSkillKey, wSkillKey]).size !== 4) fail(path, '拥有者、普攻及两个外部技能引用不能混同');
  for (const externalKey of [primarySkillKey, rSkillKey, wSkillKey]) {
    const external = one(snapshot.skillConfigurations.filter(row => row.skill.skillKey === externalKey), path);
    if (external.skill.gameId !== snapshot.gameId || external.skill.status !== 'ENABLED') fail(path, '外部技能必须是本快照已有的启用定义');
  }
  if (new Set([physicalDamageTypeKey, magicDamageTypeKey, trueDamageTypeKey]).size !== 3) fail(path, '物理、魔法及派生伤害过滤必须互斥，不能形成递归');
  const catalog = (typeKey: string) => {
    const row = one(snapshot.catalogs.damageTypes.filter(row => row.type.damageTypeKey === typeKey), path);
    if (row.type.gameId !== snapshot.gameId || row.type.status !== 'ENABLED' || row.type.formulaConfigured !== true
      || row.formula.gameId !== snapshot.gameId || row.formula.damageTypeKey !== typeKey
      || validateFormulaDefinition(row.formula.formula, damageTypeFormulaAllowedBindings(snapshot.catalogs.attributes))) fail(path, '伤害类型须有本游戏真实启用目录和完整公式');
    return row;
  };
  catalog(physicalDamageTypeKey); catalog(magicDamageTypeKey);
  const trueFormula = catalog(trueDamageTypeKey).formula.formula;
  const trueStage = one(trueFormula.stages, path);
  if (trueFormula.inputs.length || trueFormula.outputStageKey !== trueStage.key || trueStage.expression.op !== 'const'
    || Number(trueStage.expression.value) !== 1) fail(path, '派生伤害必须引用真实无穿透无抗性的常量1结算公式');
  return { magicRule, primaryRule, rRule, wRule, rawAction, state, process, step, stateWrite, effect, result, parameterKey,
    primarySkillKey, rSkillKey, wSkillKey, magicDamageTypeKey, physicalDamageTypeKey, trueDamageTypeKey, durationMs, loweredValue };
}

export type MarkedRawDamageContract = NonNullable<ReturnType<typeof validateMarkedRawDamageContract>>;
