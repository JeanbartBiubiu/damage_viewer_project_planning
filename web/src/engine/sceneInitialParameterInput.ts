import type { SimulationSkillOrigin, SimulationSkillSource, SimulationSnapshot } from '../types/simulationSnapshot';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { NumericValue } from '../types/numericValue';
import { skillFormulaReachableInputs } from '../services/skillFormulaContract';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { naturalRuleKeys, plannedSkillRuleKeys, sourceIsPlanned, validateSimulationSkillSourceManifest } from './simulationSkillSourceDescription';
import { selectSimulationSkillSourceClosure } from './simulationSkillSourceClosure';
import { validateStateInitialBinding } from './stateInitialParameterBinding';
import { NumericAdaptationError } from './numericAdapter';

type Side = 'source' | 'target';
type Binding = { ruleKey?: string; actionKey?: string; bindingKey: string; effectKey?: string;
  stateKey?: string; field?: 'initialValue' | 'initialRemainingValue' };
export type SceneInitialParameterRequirement = {
  side: Side; origin: SimulationSkillOrigin; skillKey: string; parameterKey: string;
  skillName: string; parameterName: string; valueType: 'INTEGER' | 'DECIMAL';
  minValue: number; maxValue: number; declarationIdentity: string; bindings: Binding[];
};
export type SceneInitialParameterInput = Pick<SceneInitialParameterRequirement,
  'side' | 'origin' | 'skillKey' | 'parameterKey' | 'declarationIdentity'> & { value: number };

export class SceneInitialParameterRequired extends NumericAdaptationError {
  constructor(readonly requirements: SceneInitialParameterRequirement[]) {
    super('sceneParameterInputs', '请明确填写本场初始化参数，0也需要自行填写');
    this.name = 'SceneInitialParameterRequired';
  }
}
function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: unknown, keys: readonly string[], path: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail(path, '场景初值声明形状不完整');
}
function consumes(configuration: SkillConfiguration, value: NumericValue | undefined | null, key: string): boolean {
  if (!value) return false;
  if (value.kind === 'PARAMETER') return value.parameterKey === key;
  if (value.kind !== 'FORMULA') return false;
  const rows = configuration.formulas.filter(row => row.formulaKey === value.formulaKey);
  if (rows.length !== 1) fail('sceneParameterInputs', '初始化公式缺失或重复');
  return skillFormulaReachableInputs(rows[0]!.expression).some(input => input.binding.kind === 'parameter' && input.binding.parameterKey === key);
}
const ownerKey = (side: Side, origin: SimulationSkillOrigin, skillKey: string, parameterKey: string) =>
  JSON.stringify([side, simulationSkillSourceIdentity(origin, skillKey), parameterKey]);

/** 只收集真实启用来源的显式声明；缺值时不代填边界值运行预检。 */
export function sceneInitialParameterRequirements(snapshot: SimulationSnapshot): SceneInitialParameterRequirement[] {
  if (!snapshot.skillConfigurations.some(configuration => configuration.triggerRules.some(rule =>
    rule.actions.some(action => action.runtimeInputBindings.some(binding => binding.sourceType === 'SCENE_INITIAL_PARAMETER')))
    || configuration.internalStates.some(row => (row.stateType === 'COUNTER' || row.stateType === 'AMMO')
      && (row.detail.initialValueBinding !== undefined || row.stateType === 'AMMO' && row.detail.initialRemainingMsBinding !== undefined)))) return [];
  validateSimulationSkillSourceManifest(snapshot);
  const requirements = new Map<string, SceneInitialParameterRequirement>();
  for (const side of ['source', 'target'] as const) for (const source of snapshot[side].skillSources) {
    if (!source.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel === 0 || source.skillLevel === null) continue;
    const rows = snapshot.skillConfigurations.filter(row => row.skill.skillKey === source.skillKey);
    if (rows.length !== 1) fail('sceneParameterInputs', '初始化来源缺少完整配置');
    const complete = rows[0]!;
    const planned = sourceIsPlanned(snapshot, side, source);
    const plan = planned ? snapshot.selection.plannedSkills.find(row => simulationSkillSourceIdentity(row.origin, row.skillKey)
      === simulationSkillSourceIdentity(source.origin, source.skillKey)) : undefined;
    const roots = [...new Set([...naturalRuleKeys(snapshot, complete, side), ...(plan ? plannedSkillRuleKeys(complete, plan.phaseKinds) : [])])];
    if (!roots.length || source.inactiveReason === 'ACTIVE_DEFERRED' || source.inactiveReason === 'NO_AUTONOMOUS_ATTACK') continue;
    const configuration = selectSimulationSkillSourceClosure(complete, roots).configuration;
    const add = (binding: import('../types/skillTriggerRule').SkillTriggerSceneInitialParameterBinding, location: Binding, path: string,
      integerOnly = false) => {
      exact(binding, ['bindingKey', 'parameterKey', 'sourceType', 'detail'], path);
      exact(binding.detail, ['minValue', 'maxValue'], `${path}.detail`);
      const { minValue, maxValue } = binding.detail;
      if (typeof minValue !== 'number' || typeof maxValue !== 'number' || !Number.isFinite(minValue) || !Number.isFinite(maxValue)
        || minValue > maxValue) fail(path, '场景初值必须声明有限且有序的上下界');
      const parameters = configuration.parameters.filter(row => row.parameterKey === binding.parameterKey);
      const parameter = parameters[0];
      if (parameters.length !== 1 || !parameter || parameter.gameId !== snapshot.gameId || parameter.skillKey !== source.skillKey
        || parameter.valueMode !== 'RUNTIME_INPUT' || parameter.fixedValue !== null || parameter.levelValues !== null
        || !['INTEGER', 'DECIMAL'].includes(parameter.valueType) || integerOnly && parameter.valueType !== 'INTEGER') fail(path, '初值必须绑定本技能无默认的计算时数值参数');
      if (parameter.valueType === 'INTEGER' && (!Number.isSafeInteger(minValue) || !Number.isSafeInteger(maxValue))) fail(path, '整数初值边界必须为安全整数');
      const key = ownerKey(side, source.origin, source.skillKey, parameter.parameterKey);
      let requirement = requirements.get(key);
      if (requirement && (requirement.minValue !== minValue || requirement.maxValue !== maxValue)) fail(path, '同一来源参数的初始化边界不一致');
      if (!requirement) {
        requirement = { side, origin: structuredClone(source.origin), skillKey: source.skillKey, parameterKey: parameter.parameterKey,
          skillName: configuration.skill.name, parameterName: parameter.name, valueType: parameter.valueType,
          minValue, maxValue, declarationIdentity: '', bindings: [] };
        requirements.set(key, requirement);
      }
      if (requirement.bindings.some(row => JSON.stringify(row) === JSON.stringify(location)
        || location.actionKey !== undefined && row.ruleKey === location.ruleKey && row.actionKey === location.actionKey)) fail(path, '初始化参数在同动作中重复绑定');
      requirement.bindings.push(location);
      requirement.declarationIdentity = JSON.stringify([snapshot.gameId, key, configuration.baseDigest, source.skillLevel,
        snapshot.selection[`${side}Level`], parameter.valueType, minValue, maxValue, requirement.bindings]);
    };
    for (const row of configuration.internalStates) if (row.stateType === 'COUNTER' || row.stateType === 'AMMO') {
      for (const field of ['initialValue', ...(row.stateType === 'AMMO' ? ['initialRemainingValue'] as const : [])] as const) {
        const path = `skills.${source.skillKey}.internalStates.${row.stateKey}.detail.${field}`;
        const binding = validateStateInitialBinding(row, field, configuration.parameters, snapshot.gameId, source.skillKey, path);
        if (binding) {
          if (side === 'source' && source.skillKey === snapshot.selection.basicAttackSkillKey) fail(path, '所选普通攻击继续使用既有机制初值路径，不接入此场景状态声明');
          add(binding, { bindingKey: binding.bindingKey, stateKey: row.stateKey, field }, path, true);
        }
      }
    }
    for (const rule of configuration.triggerRules) for (const action of rule.actions) for (const binding of action.runtimeInputBindings) {
      if (binding.sourceType !== 'SCENE_INITIAL_PARAMETER') continue;
      const path = `skills.${source.skillKey}.triggerRules.${rule.ruleKey}.actions.${action.actionKey}.runtimeInputBindings.${binding.bindingKey}`;
      if (source.origin.kind === 'EQUIPMENT' || side === 'source' && source.skillKey === snapshot.selection.basicAttackSkillKey) {
        fail(path, '本轮显式初值只接入角色或构筑的自然初始化，不接入装备或所选普攻主体');
      }
      if (rule.eventSource.eventType !== 'SOURCE_INITIALIZED' || Object.keys(rule.eventSource.detail).length
        || rule.conditionGroups.length || rule.oncePerUse !== null || rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null
        || action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'EVENT_SOURCE' || action.resultModifiers.length) {
        fail(path, '场景初值仅授权无条件自身初始化动作的结果数值');
      }
      if (!source.enabledRuleKeys.includes(rule.ruleKey)) fail(path, '初始化声明没有进入本场真实来源闭包');
      exact(binding, ['bindingKey', 'parameterKey', 'sourceType', 'detail'], path);
      exact(binding.detail, ['minValue', 'maxValue'], `${path}.detail`);
      const { minValue, maxValue } = binding.detail;
      if (typeof minValue !== 'number' || typeof maxValue !== 'number' || !Number.isFinite(minValue) || !Number.isFinite(maxValue)
        || minValue > maxValue) fail(path, '场景初值必须声明有限且有序的上下界');
      const parameters = configuration.parameters.filter(row => row.parameterKey === binding.parameterKey);
      const parameter = parameters[0];
      if (parameters.length !== 1 || !parameter || parameter.gameId !== snapshot.gameId || parameter.skillKey !== source.skillKey
        || parameter.valueMode !== 'RUNTIME_INPUT' || parameter.fixedValue !== null || parameter.levelValues !== null
        || !['INTEGER', 'DECIMAL'].includes(parameter.valueType)) fail(path, '初值必须绑定本技能无默认的计算时数值参数');
      if (parameter.valueType === 'INTEGER' && (!Number.isSafeInteger(minValue) || !Number.isSafeInteger(maxValue))) fail(path, '整数初值边界必须为安全整数');
      if (action.actionType !== 'EXECUTE_EFFECT') fail(path, '场景初值动作未接入');
      const effects = configuration.effects.filter(row => row.effectKey === action.detail.effectKey);
      const effect = effects[0];
      if (effects.length !== 1 || !effect || !effect.results.some(result => consumes(configuration, result.valueRule?.value, parameter.parameterKey))) {
        fail(path, '初始化参数没有被本动作实际效果结果消费');
      }
      if (effect.lifecycle && [effect.lifecycle.durationValue, effect.lifecycle.maxStacksValue, effect.lifecycle.applicationStacksValue,
        effect.lifecycle.periodicIntervalValue].some(value => consumes(configuration, value, parameter.parameterKey))) fail(path, '初始化参数不能借给生命周期');
      const key = ownerKey(side, source.origin, source.skillKey, parameter.parameterKey);
      let requirement = requirements.get(key);
      if (requirement && (requirement.minValue !== minValue || requirement.maxValue !== maxValue)) fail(path, '同一来源参数的初始化边界不一致');
      if (!requirement) {
        requirement = { side, origin: structuredClone(source.origin), skillKey: source.skillKey, parameterKey: parameter.parameterKey,
          skillName: configuration.skill.name, parameterName: parameter.name, valueType: parameter.valueType,
          minValue, maxValue, declarationIdentity: '', bindings: [] };
        requirements.set(key, requirement);
      }
      if (requirement.bindings.some(row => row.ruleKey === rule.ruleKey && row.actionKey === action.actionKey)) fail(path, '初始化参数在同动作中重复绑定');
      requirement.bindings.push({ ruleKey: rule.ruleKey, actionKey: action.actionKey, bindingKey: binding.bindingKey, effectKey: effect.effectKey });
      requirement.declarationIdentity = JSON.stringify([snapshot.gameId, key, configuration.baseDigest, source.skillLevel,
        snapshot.selection[`${side}Level`], parameter.valueType, minValue, maxValue, requirement.bindings]);
    }
  }
  return [...requirements.values()].sort((left, right) => left.declarationIdentity < right.declarationIdentity ? -1 : left.declarationIdentity > right.declarationIdentity ? 1 : 0);
}

/** 校验完整声明身份后规范排序；直接API调用也不能添加未声明的输入。 */
export function normalizeSceneInitialParameterInputs(snapshot: SimulationSnapshot,
  inputs: readonly SceneInitialParameterInput[] = []): SceneInitialParameterInput[] {
  const required = sceneInitialParameterRequirements(snapshot);
  if (!Array.isArray(inputs)) fail('sceneParameterInputs', '初始化输入必须是数组');
  const byKey = new Map<string, SceneInitialParameterInput>();
  for (const [index, input] of inputs.entries()) {
    const path = `sceneParameterInputs[${index}]`;
    exact(input, ['side', 'origin', 'skillKey', 'parameterKey', 'declarationIdentity', 'value'], path);
    const requirement = required.find(row => row.declarationIdentity === input.declarationIdentity);
    if (!requirement || input.side !== requirement.side || input.skillKey !== requirement.skillKey || input.parameterKey !== requirement.parameterKey) fail(path, '初始化输入归属或声明身份已变化');
    exact(input.origin, Object.keys(requirement.origin), `${path}.origin`);
    if (simulationSkillSourceIdentity(input.origin, input.skillKey) !== simulationSkillSourceIdentity(requirement.origin, requirement.skillKey)) fail(path, '初始化输入来源不匹配');
    if (byKey.has(requirement.declarationIdentity)) fail(path, '初始化输入重复');
    const value = input.value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < requirement.minValue || value > requirement.maxValue
      || requirement.valueType === 'INTEGER' && !Number.isSafeInteger(value)) fail(path, '初始化输入不满足声明的数值类型或范围');
    byKey.set(requirement.declarationIdentity, structuredClone(input));
  }
  if (byKey.size !== required.length) throw new SceneInitialParameterRequired(required);
  return required.map(row => byKey.get(row.declarationIdentity)!);
}

export function sceneInitialValuesForSource(requirements: readonly SceneInitialParameterRequirement[], inputs: readonly SceneInitialParameterInput[],
  side: Side, source: SimulationSkillSource, action?: { ruleKey: string; actionKey: string; effectKey: string }): Record<string, number> {
  const values: Record<string, number> = {};
  const identity = simulationSkillSourceIdentity(source.origin, source.skillKey);
  for (const requirement of requirements) {
    if (requirement.side !== side || simulationSkillSourceIdentity(requirement.origin, requirement.skillKey) !== identity
      || action && !requirement.bindings.some(row => row.ruleKey === action.ruleKey && row.actionKey === action.actionKey && row.effectKey === action.effectKey)) continue;
    const input = inputs.find(row => row.declarationIdentity === requirement.declarationIdentity);
    if (!input) throw new SceneInitialParameterRequired([...requirements]);
    values[requirement.parameterKey] = input.value;
  }
  return values;
}
