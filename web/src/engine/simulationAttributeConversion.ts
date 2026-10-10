import { declaredFormulaForApprovedReads } from './approvedFormulaValues';
import { skillFormulaReachableInputs } from '../services/skillFormulaContract';
import type { GenericFormulaExpr, GenericRules } from '../types/genericEngine';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffectResult } from '../types/skillEffect';
import type { SimulationSkillSource, SimulationSnapshot } from '../types/simulationSnapshot';
import { compileNumericValue, constExpr, createNumericCompileState, NumericAdaptationError, tryFoldConstant, wrapValueRuleExpression } from './numericAdapter';

export type SimulationAttributeDerivation = NonNullable<GenericRules['attributeDerivations']>[number];
function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

export function permanentAttributeConversion(snapshot: SimulationSnapshot, configuration: SkillConfiguration,
  source: SimulationSkillSource, side: 'source' | 'target', result: SkillEffectResult, path: string): SimulationAttributeDerivation | undefined {
  if (result.resultType !== 'ATTRIBUTE_CHANGE') return undefined;
  const { attributeKey, operation, modifierZoneKey } = result.detail;
  const zones = snapshot.catalogs.modifierZones.filter(zone => zone.modifierZoneKey === modifierZoneKey);
  const zone = zones[0];
  const overwrite = operation === 'SET';
  const multiplier = zone?.calculationMode === 'RATIO_MULTIPLY';
  if (!overwrite && !multiplier) return undefined;
  if (!result.valueRule || result.target !== 'SOURCE'
    || result.lifecycleBehavior?.valueReadMode !== (overwrite ? 'APPLICATION_SNAPSHOT' : 'MOMENT_EVALUATION')) {
    fail(path, '覆盖输出使用施加快照，动态乘算必须是自身常驻的实时求值声明');
  }
  if (overwrite ? modifierZoneKey !== null
    : operation !== 'INCREASE' || zones.length !== 1 || zone!.gameId !== snapshot.gameId
      || zone!.status !== 'ENABLED' || zone!.domain !== 'ATTRIBUTE' || zone!.applicationStage !== 'ATTRIBUTE_PERCENT') {
    fail(path, '只开放非生命属性覆盖及真实乘区的自身动态比例转换');
  }
  const attributes = snapshot.catalogs.attributes.filter(row => row.attributeKey === attributeKey && row.status === 'ENABLED');
  if (attributeKey === 'hp' || attributes.length !== 1) fail(path, '输出需要唯一启用的非生命属性目录');
  const numeric = createNumericCompileState({ gameId: snapshot.gameId, skillKey: source.skillKey, skillLevel: source.skillLevel!,
    characterLevel: snapshot.selection[`${side}Level`], parameters: configuration.parameters, formulas: configuration.formulas,
    formulaNamespace: `${side}/${source.skillKey}/conversion`, bindParameters: false, allowAttributeReads: true,
    runtimeInputMessage: '转换所需计算时参数必须有真实供值' });
  const magnitude = wrapValueRuleExpression(compileNumericValue(result.valueRule.value, `${path}.valueRule.value`, numeric, fail), result.valueRule);
  const folded = tryFoldConstant(magnitude);
  if (overwrite && folded === null) fail(path, '施加快照的输出必须可由明确等级与静态配置求值');
  if (folded !== null && (!Number.isFinite(folded) || !overwrite && folded < 0)) fail(path, '输出必须有限，动态转换比例不能为负');
  const rebind = (expression: GenericFormulaExpr): GenericFormulaExpr => ({ ...expression,
    ...(expression.path ? { path: expression.path.replace(/^(source|target)\./, (_whole, owner: string) => `${owner === 'source' ? side : side === 'source' ? 'target' : 'source'}.`) } : {}),
    ...(expression.args ? { args: expression.args.map(rebind) } : {}) });
  const selected = folded === null ? magnitude : constExpr(folded);
  const value = rebind(overwrite ? selected : { op: 'add', args: [constExpr(1), selected] });
  return { combatantKey: side, skillKey: source.skillKey, attributeKey, value, valueType: attributes[0]!.valueType, valuePolicy: multiplier ? 'multiply' : 'set' };
}

export function validateSimulationAttributeDerivations(derivations: SimulationAttributeDerivation[]) {
  if (derivations.length > 4) fail('rules.attributeDerivations', '实际派生输出不能超过4项');
  const outputs = new Set<string>();
  for (const [index, row] of derivations.entries()) {
    const key = `${row.combatantKey}.${row.attributeKey}`;
    if (row.attributeKey === 'hp' || !['set', 'multiply'].includes(row.valuePolicy) || !['INTEGER', 'DECIMAL'].includes(row.valueType) || outputs.has(key)) {
      fail(`rules.attributeDerivations[${index}]`, '每拥有方非生命属性只允许一个明确类型与策略的派生输出');
    }
    outputs.add(key);
  }
  const visit = (value: GenericFormulaExpr, path: string, owner: 'source' | 'target') => {
    if (value.op === 'ref' && value.ref) {
      const formula = declaredFormulaForApprovedReads(value.ref);
      if (!formula) fail(path, '派生公式缺少完整读取依赖');
      for (const input of skillFormulaReachableInputs(formula!.expression)) if (input.binding.kind === 'attribute') {
        const side = input.binding.object === 'source' ? owner : owner === 'source' ? 'target' : 'source';
        if (input.binding.valueKind !== 'BASE' && outputs.has(`${side}.${input.binding.attributeKey}`)) fail(path, '派生不得回读自身或其它派生总值');
      }
    }
    if (value.op === 'read') {
      const match = /^(source|target)\.attr\.([a-z][a-z0-9_]*)\.(\w+)$/.exec(value.path ?? '');
      if (!match || match[3] !== 'base' && outputs.has(`${match[1]}.${match[2]}`)) fail(path, '派生不得回读自身或其它派生总值');
    }
    value.args?.forEach((child, index) => visit(child, `${path}.args[${index}]`, owner));
  };
  derivations.forEach((row, index) => visit(row.value, `rules.attributeDerivations[${index}].value`, row.combatantKey));
}
