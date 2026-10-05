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
    fail(path, '固定攻速使用施加快照，攻击力转换必须是自身常驻的实时求值声明');
  }
  if (overwrite ? attributeKey !== 'attack_speed' || modifierZoneKey !== null
    : attributeKey !== 'attack_damage' || operation !== 'INCREASE' || zones.length !== 1 || zone!.gameId !== snapshot.gameId
      || zone!.status !== 'ENABLED' || zone!.domain !== 'ATTRIBUTE' || zone!.applicationStage !== 'ATTRIBUTE_PERCENT') {
    fail(path, '首批仅开放无乘区的攻速覆盖及真实乘区的攻击力比例转换');
  }
  const numeric = createNumericCompileState({ gameId: snapshot.gameId, skillKey: source.skillKey, skillLevel: source.skillLevel!,
    characterLevel: snapshot.selection[`${side}Level`], parameters: configuration.parameters, formulas: configuration.formulas,
    formulaNamespace: `${side}/${source.skillKey}/conversion`, bindParameters: false, allowAttributeReads: true,
    runtimeInputMessage: '转换所需计算时参数必须有真实供值' });
  const magnitude = wrapValueRuleExpression(compileNumericValue(result.valueRule.value, `${path}.valueRule.value`, numeric, fail), result.valueRule);
  const folded = tryFoldConstant(magnitude);
  if (overwrite && folded === null) fail(path, '施加快照的固定攻速必须可由明确等级与静态配置求值');
  if (folded !== null && (overwrite ? folded <= 0 : folded < 0)) fail(path, '攻速覆盖必须为正值，攻击力转换比例不能为负');
  const rebind = (expression: GenericFormulaExpr): GenericFormulaExpr => ({ ...expression,
    ...(expression.path ? { path: expression.path.replace(/^(source|target)\./, (_whole, owner: string) => `${owner === 'source' ? side : side === 'source' ? 'target' : 'source'}.`) } : {}),
    ...(expression.args ? { args: expression.args.map(rebind) } : {}) });
  const value = rebind(overwrite ? magnitude : { op: 'add', args: [constExpr(1), magnitude] });
  return { combatantKey: side, attributeKey, value, ...(multiplier ? { valuePolicy: 'multiply' as const } : {}) };
}

export function validateSimulationAttributeDerivations(derivations: SimulationAttributeDerivation[]) {
  const outputs = new Set<string>();
  for (const [index, row] of derivations.entries()) {
    const key = `${row.combatantKey}.${row.attributeKey}`;
    if (!['attack_speed', 'attack_damage'].includes(row.attributeKey) || outputs.has(key)) {
      fail(`rules.attributeDerivations[${index}]`, '每侧攻速和攻击力各只能有一个派生输出');
    }
    outputs.add(key);
  }
  const visit = (value: GenericFormulaExpr, path: string) => {
    if (value.op === 'read') {
      const match = /^(source|target)\.attr\.([a-z][a-z0-9_]*)\.(\w+)$/.exec(value.path ?? '');
      if (!match || match[3] !== 'base' && outputs.has(`${match[1]}.${match[2]}`)) fail(path, '派生不得回读自身或其它派生总值');
    }
    value.args?.forEach((child, index) => visit(child, `${path}.args[${index}]`));
  };
  derivations.forEach((row, index) => visit(row.value, `rules.attributeDerivations[${index}].value`));
}
