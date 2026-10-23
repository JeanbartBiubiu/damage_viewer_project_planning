import type { GenericFormulaExpr, ModifierDefinition } from '../types/genericEngine';
import type { NumericValue } from '../types/numericValue';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffectResult } from '../types/skillEffect';
import type { SimulationSkillSource, SimulationSnapshot } from '../types/simulationSnapshot';
import { compileNumericValue, constExpr, createNumericCompileState, NumericAdaptationError, tryFoldConstant, wrapValueRuleExpression } from './numericAdapter';
import { permanentAttributeConversion, type SimulationAttributeDerivation } from './simulationAttributeConversion';
import { skillFormulaReachableInputs } from '../services/skillFormulaContract';
import { dynamicPermanentAttribute } from './dynamicPermanentAttributeAdapter';
import { registerShieldAttributeDependency } from './shieldAttributeDependency';
import { cappedPhysicalReduction } from './cappedPhysicalReduction';

export type PermanentResultContext = {
  snapshot: SimulationSnapshot;
  configuration: SkillConfiguration;
  source: SimulationSkillSource;
  side: 'source' | 'target';
  formulaNamespace: string;
  onNumericConsumed?: PermanentNumericConsumer;
  sceneParameterValues?: Readonly<Record<string, number>>;
  permanentHealthInitialization?: boolean;
};
export type PermanentNumericConsumer = (value: NumericValue, authorPath: string, expression: GenericFormulaExpr) => void;

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: object, fields: readonly string[], path: string) {
  const unknown = Object.keys(value).find(key => !fields.includes(key));
  if (unknown) fail(`${path}.${unknown}`, '未接入的常驻字段不能被静默忽略');
}

function staticState(context: PermanentResultContext, bindSceneValues = false) {
  const { snapshot, configuration, source, side, formulaNamespace } = context;
  return createNumericCompileState({ gameId: snapshot.gameId, skillKey: source.skillKey, skillLevel: source.skillLevel!,
    characterLevel: snapshot.selection[`${side}Level`], parameters: configuration.parameters, formulas: configuration.formulas,
    formulaNamespace, bindParameters: false, allowAttributeReads: false,
    runtimeInputMessage: '常驻需要明确的等级或静态参数，不猜计算时输入',
    ...(bindSceneValues ? { sceneParameterValues: context.sceneParameterValues } : {}) });
}

export function validatePermanentEffect(effect: SkillConfiguration['effects'][number], path: string, context: PermanentResultContext) {
  const life = effect.lifecycle;
  if (!life || life.instanceScope !== 'SOURCE' || life.expiryMode !== 'EXPLICIT_ONLY' || life.durationValue !== null
    || life.periodicIntervalValue !== null || life.firstPeriodicExecution !== null || life.endWhenShieldEndsResultKey != null
    || life.reapplicationStackMode !== 'KEEP' || life.reapplicationDurationMode !== null || effect.results.length === 0) {
    fail(`${path}.lifecycle`, '常驻需要来源范围、永久单层、无周期的完整效果');
  }
  exact(life, ['durationValue', 'maxStacksValue', 'applicationStacksValue', 'instanceScope', 'reapplicationStackMode',
    'reapplicationDurationMode', 'expiryMode', 'periodicIntervalValue', 'firstPeriodicExecution', 'endWhenShieldEndsResultKey'], `${path}.lifecycle`);
  const numeric = staticState(context);
  for (const field of ['maxStacksValue', 'applicationStacksValue'] as const) {
    const authorPath = `${path}.lifecycle.${field}`;
    const expression = compileNumericValue(life[field], authorPath, numeric, fail);
    if (tryFoldConstant(expression) !== 1) {
      fail(authorPath, '常驻层数须由原生核定恒1');
    }
    context.onNumericConsumed?.(life[field], authorPath, expression);
  }
}

export function permanentModifier(context: PermanentResultContext, result: SkillEffectResult, path: string): ModifierDefinition | SimulationAttributeDerivation {
  const { snapshot, configuration, source, side } = context;
  const capped = cappedPhysicalReduction(context, result, path);
  if (capped) return capped;
  if (result.resultType === 'ATTRIBUTE_CHANGE' && Object.prototype.hasOwnProperty.call(result.detail, 'requiredShield')) {
    exact(result.detail, ['attributeKey', 'operation', 'modifierZoneKey', 'requiredShield'], `${path}.detail`);
    const { requiredShield: _dependency, ...detail } = result.detail;
    const modifier = permanentModifier(context, { ...result, detail }, path);
    if ('combatantKey' in modifier) fail(path, '依赖盾只接静态属性，不接属性转换');
    registerShieldAttributeDependency(context, result, path, modifier);
    return modifier;
  }
  if (result.resultType !== 'ATTRIBUTE_CHANGE' && result.resultType !== 'HEALING_MODIFIER'
    && result.resultType !== 'SHIELD_RECEIVED_MODIFIER' || result.valueRule === null) {
    fail(path, '该完整常驻结果尚未接入，不能只执行其它结果');
  }
  const opponentAttribute = source.origin.kind === 'EQUIPMENT' && result.resultType === 'ATTRIBUTE_CHANGE' && result.target === 'TARGET';
  exact(result.detail, result.resultType === 'ATTRIBUTE_CHANGE' ? ['attributeKey', 'operation', 'modifierZoneKey']
    : result.resultType === 'HEALING_MODIFIER' ? ['direction', 'healingKind', 'operation', 'modifierZoneKey']
      : ['operation', 'modifierZoneKey'], `${path}.detail`);
  const behavior = result.lifecycleBehavior;
  if (result.target !== 'SOURCE' && !opponentAttribute || result.spellShieldBlockScope !== null || !behavior
    || behavior.moment !== 'PERSISTENT' || behavior.valueReadMode === null
    || !['APPLICATION_SNAPSHOT', 'MOMENT_EVALUATION'].includes(behavior.valueReadMode)
    || source.origin.kind === 'EQUIPMENT' && behavior.valueReadMode !== 'APPLICATION_SNAPSHOT' && result.resultType !== 'ATTRIBUTE_CHANGE'
    || opponentAttribute && behavior.valueReadMode !== 'APPLICATION_SNAPSHOT'
    || behavior.stackValueMode !== 'SHARED' || ![null, 'REPLACE'].includes(behavior.reapplicationValueMode)
    || behavior.periodicExecutionMode !== null) {
    fail(path, '只接入完整永久自身常驻或装备静态对手属性光环');
  }
  if (result.resultType === 'ATTRIBUTE_CHANGE' && result.detail.attributeKey === 'hp'
    && (!context.permanentHealthInitialization || source.origin.kind !== 'CHARACTER' || result.detail.operation !== 'INCREASE'
      || behavior.valueReadMode !== 'APPLICATION_SNAPSHOT')) fail(path, '永久生命只允许真实角色无条件初始化的静态施加快照平加');
  const dynamicAddition = dynamicPermanentAttribute(context, result, path);
  if (dynamicAddition) return dynamicAddition;
  const authoredValue = result.valueRule.value;
  const amountFormula = authoredValue.kind === 'FORMULA'
    ? configuration.formulas.find(row => row.formulaKey === authoredValue.formulaKey) : undefined;
  const hasAttributeDependency = amountFormula && skillFormulaReachableInputs(amountFormula.expression)
    .some(input => input.binding.kind === 'attribute');
  // 只有实际读取属性的实时乘算进入派生；固定值和原生核定静态公式保持普通修正。
  const conversion = result.resultType === 'ATTRIBUTE_CHANGE' && result.target === 'SOURCE'
    && (result.detail.operation === 'SET' || behavior.valueReadMode === 'MOMENT_EVALUATION' && hasAttributeDependency)
    ? permanentAttributeConversion(snapshot, configuration, source, side, result, path) : undefined;
  if (conversion) return conversion;
  if (context.sceneParameterValues && Object.keys(context.sceneParameterValues).length && behavior.valueReadMode !== 'APPLICATION_SNAPSHOT') {
    fail(path, '场景初始化参数只允许明确的施加快照结果');
  }
  const numeric = staticState(context, true);
  const authorPath = `${path}.valueRule.value`;
  const expression = compileNumericValue(result.valueRule.value, authorPath, numeric, fail);
  const value = tryFoldConstant(wrapValueRuleExpression(expression, result.valueRule));
  if (value === null || !Number.isFinite(value)) fail(`${path}.valueRule`, '常驻数值必须可由明确等级和配置求为有限常量');
  context.onNumericConsumed?.(result.valueRule.value, authorPath, expression);
  const zones = snapshot.catalogs.modifierZones.filter(row => row.modifierZoneKey === result.detail.modifierZoneKey);
  const zone = zones[0];
  if (zones.length !== 1 || !zone || zone.gameId !== snapshot.gameId || zone.status !== 'ENABLED') {
    fail(`${path}.detail.modifierZoneKey`, '缺少唯一真实启用修正区域');
  }
  if (result.resultType === 'ATTRIBUTE_CHANGE') {
    const attributeKey = result.detail.attributeKey;
    const attributes = snapshot.catalogs.attributes.filter(row => row.attributeKey === attributeKey);
    if (attributes.length !== 1 || attributes[0]!.gameId !== snapshot.gameId || attributes[0]!.status !== 'ENABLED') {
      fail(`${path}.detail.attributeKey`, '缺少唯一真实启用属性目录');
    }
    if (attributeKey === 'hp') {
      if (!context.permanentHealthInitialization || source.origin.kind !== 'CHARACTER' || result.target !== 'SOURCE'
        || behavior.valueReadMode !== 'APPLICATION_SNAPSHOT' || result.detail.operation !== 'INCREASE'
        || zone.domain !== 'ATTRIBUTE' || zone.calculationMode !== 'FLAT_ADD' || zone.applicationStage !== 'ATTRIBUTE_FLAT' || value < 0) {
        fail(path, '永久生命仅接真实角色无条件来源初始化的自身静态非负生命平加');
      }
      return { modifierKey: result.resultKey, kind: 'resource_max', target: 'self.attr.hp', valuePolicy: 'add',
        value: constExpr(value), currentValuePolicy: 'preserve_initial_current' };
    }
    if (zone.domain !== 'ATTRIBUTE' || !['INCREASE', 'DECREASE'].includes(result.detail.operation)) fail(path, '属性修正声明不完整');
    const decrease = result.detail.operation === 'DECREASE';
    if (String(zone.calculationMode) === 'RATIO_COMPLEMENT_MULTIPLY') {
      if (opponentAttribute || zone.applicationStage !== 'ATTRIBUTE_PERCENT' || decrease || value < 0 || value > 1) fail(path, '剩余比例连乘只接入自身属性百分比增加，比例须在0与1之间');
      return { modifierKey: result.resultKey, kind: 'attribute', target: `self.attr.${attributeKey}`, stage: 'total',
        valuePolicy: 'complement_multiply', value: constExpr(value), bucket: zone.modifierZoneKey };
    }
    if (zone.calculationMode === 'RATIO_MULTIPLY') {
      if (zone.applicationStage !== 'ATTRIBUTE_PERCENT' || value < 0 || decrease && value > 1) {
        fail(path, '静态比例乘算必须为属性百分比阶段、非负比例，减少不超过1');
      }
      return { modifierKey: result.resultKey, kind: 'attribute', target: `${opponentAttribute ? 'opponent' : 'self'}.attr.${attributeKey}`,
        stage: 'total', valuePolicy: 'multiply', value: constExpr(decrease ? 1 - value : 1 + value), bucket: zone.modifierZoneKey };
    }
    if (opponentAttribute) fail(path, '对手属性光环必须明确声明RATIO_MULTIPLY及ATTRIBUTE_PERCENT，不能把比例加算解释为总值乘算');
    const policy = zone.calculationMode === 'FLAT_ADD' && zone.applicationStage === 'ATTRIBUTE_FLAT' ? 'add'
      : zone.calculationMode === 'RATIO_ADD' && zone.applicationStage === 'ATTRIBUTE_PERCENT' ? 'add_percent' : undefined;
    if (!policy) fail(path, '自身常驻属性需要明确的加算、比例加算或静态比例乘算');
    return { modifierKey: result.resultKey, kind: 'attribute', target: `self.attr.${attributeKey}`,
      valuePolicy: policy, value: constExpr(decrease ? -value : value), bucket: zone.modifierZoneKey };
  }
  if (value < 0) fail(`${path}.valueRule`, '常驻增幅比例必须为非负值');
  if (result.resultType === 'HEALING_MODIFIER' && result.detail.direction === 'RECEIVED' && result.detail.healingKind === 'ANY'
    && result.detail.operation === 'INCREASE' && zone.domain === 'HEALING' && zone.calculationMode === 'RATIO_ADD'
    && zone.applicationStage === 'HEALING_RESULT') {
    return { modifierKey: result.resultKey, kind: 'pipeline', command: 'heal', healDirection: 'RECEIVED', healCategory: 'ANY',
      healGroupKey: zone.modifierZoneKey, healGroupCalculationMode: 'ratio_add', valuePolicy: 'add_percent', value: constExpr(value) };
  }
  if (result.resultType === 'SHIELD_RECEIVED_MODIFIER' && result.detail.operation === 'INCREASE'
    && zone.domain === 'SHIELD' && zone.calculationMode === 'RATIO_ADD' && zone.applicationStage === 'SHIELD_RESULT') {
    return { modifierKey: result.resultKey, kind: 'pipeline', command: 'shield', channel: 'normal_shield', stage: 'received',
      bucket: zone.modifierZoneKey, valuePolicy: 'add_percent', value: constExpr(value) };
  }
  return fail(path, '该完整常驻结果尚未接入，不能只执行其它结果');
}
