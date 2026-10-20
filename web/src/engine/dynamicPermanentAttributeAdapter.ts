import type { ModifierDefinition } from '../types/genericEngine';
import type { SkillEffectResult } from '../types/skillEffect';
import type { PermanentResultContext } from './simulationPermanentResults';
import { compileNumericValue, createNumericCompileState, NumericAdaptationError, wrapValueRuleExpression } from './numericAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

/** 永久拥有者生命驱动的加算保持普通修正，不占用派生输出。 */
export function dynamicPermanentAttribute(context: PermanentResultContext, result: SkillEffectResult, path: string): ModifierDefinition | undefined {
  if (result.resultType !== 'ATTRIBUTE_CHANGE' || result.lifecycleBehavior?.valueReadMode !== 'MOMENT_EVALUATION'
    || result.valueRule?.value.kind !== 'FORMULA') return undefined;
  const { snapshot, configuration, source, side } = context;
  const zones = snapshot.catalogs.modifierZones.filter(row => row.modifierZoneKey === result.detail.modifierZoneKey);
  if (zones[0]?.calculationMode !== 'FLAT_ADD') return undefined;
  const zone = zones[0];
  const output = snapshot.catalogs.attributes.filter(row => row.attributeKey === result.detail.attributeKey);
  if (source.origin.kind === 'EQUIPMENT' || result.target !== 'SOURCE' || result.detail.operation !== 'INCREASE'
    || result.detail.attributeKey === 'hp' || zones.length !== 1 || zone.gameId !== snapshot.gameId || zone.status !== 'ENABLED'
    || zone.domain !== 'ATTRIBUTE' || zone.applicationStage !== 'ATTRIBUTE_FLAT'
    || output.length !== 1 || output[0]!.status !== 'ENABLED' || output[0]!.gameId !== snapshot.gameId || output[0]!.valueType !== 'DECIMAL') {
    fail(path, '生命驱动常驻只接受自身非生命小数属性的明确平加');
  }
  if (context.sceneParameterValues && Object.keys(context.sceneParameterValues).length) fail(path, '生命驱动常驻不接受场景初始化参数');
  const formulaKey = result.valueRule.value.formulaKey;
  const rows = configuration.formulas.filter(row => row.formulaKey === formulaKey);
  if (rows.length !== 1) fail(path, '生命驱动常驻缺少唯一完整共同公式');
  let healthRead = false;
  for (const input of rows[0]!.expression.inputs) {
    const binding = input.binding;
    if (binding.kind === 'attribute') {
      if (binding.object !== 'source' || binding.attributeKey !== 'hp' || binding.view !== 'current_frame'
        || !['CURRENT', 'MAX', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO'].includes(binding.valueKind)) fail(path, '生命驱动常驻仅能读取拥有者当前生命和上限');
      healthRead = true;
    } else if (binding.kind === 'parameter') {
      const parameters = configuration.parameters.filter(row => row.parameterKey === binding.parameterKey && row.skillKey === source.skillKey);
      if (binding.skillKey !== source.skillKey || parameters.length !== 1 || parameters[0]!.valueMode === 'RUNTIME_INPUT') fail(path, '生命驱动常驻只接受本技能明确等级或固定参数');
    } else fail(path, '生命驱动常驻不读取时间、状态或事件上下文');
  }
  if (!healthRead) return undefined;
  const numeric = createNumericCompileState({ gameId: snapshot.gameId, skillKey: source.skillKey, skillLevel: source.skillLevel!,
    characterLevel: snapshot.selection[`${side}Level`], parameters: configuration.parameters, formulas: configuration.formulas,
    formulaNamespace: context.formulaNamespace, bindParameters: false, allowAttributeReads: true,
    runtimeInputMessage: '生命驱动常驻不接受计算时输入' });
  const expression = compileNumericValue(result.valueRule.value, `${path}.valueRule.value`, numeric, fail);
  context.onNumericConsumed?.(result.valueRule.value, `${path}.valueRule.value`, expression);
  return { modifierKey: result.resultKey, kind: 'attribute', target: `self.attr.${result.detail.attributeKey}`,
    bucket: zone.modifierZoneKey, valuePolicy: 'add', value: wrapValueRuleExpression(expression, result.valueRule) };
}
