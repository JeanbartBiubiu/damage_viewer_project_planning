import type { FormulaExpressionNode } from '../../src/types/skillFormula';
import type { DamageTypeFormulaNode } from '../../src/types/damageTypeFormula';
import type { NumericValue } from '../../src/types/numericValue';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';

/** 验收侧直接读取冻结作者树，独立计算静态首批样本；不调用宿主翻译或引擎公式。 */
export function continuousExpectation(snapshot: SimulationSnapshot, explicit: { source: Record<string, number>; target: Record<string, number> }) {
  const config = snapshot.skillConfigurations[0]!;
  const attrs = { source: { ...explicit.source, ...snapshot.source.selectedLevelValues }, target: { ...explicit.target, ...snapshot.target.selectedLevelValues } };
  const finite = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('独立期望计算缺少明确数值');
    return value;
  };
  const parameter = (key: string) => {
    const row = config.parameters.find(item => item.parameterKey === key)!;
    if (!row || row.valueMode === 'RUNTIME_INPUT') throw new Error('独立期望计算不补未绑定参数');
    return finite(row.valueMode === 'FIXED' ? row.fixedValue : row.levelValues?.[String(
      row.valueMode === 'SKILL_LEVEL' ? snapshot.selection.basicAttackLevel : snapshot.selection.sourceLevel)]);
  };
  function evaluate(node: FormulaExpressionNode | DamageTypeFormulaNode, stages: Record<string, number> = {}): number {
    if (node.nodeType === 'FIXED') return finite(node.value);
    if (node.nodeType === 'PARAMETER') return parameter(node.parameterKey);
    if (node.nodeType === 'STAGE_RESULT') return finite(stages[node.stageKey]);
    if (node.nodeType === 'ATTRIBUTE') {
      const value = finite(attrs[node.attributeOwner === 'SOURCE' ? 'source' : 'target'][node.attributeKey]);
      if (node.attributeValueKind === 'BASE' || node.attributeValueKind === 'TOTAL') return value;
      if (node.attributeValueKind === 'BONUS') return 0;
      // 实服务验收遇到生命依赖需要独立逐次期望，不能仍用静态单刀乘刀数。
      if (node.attributeKey === 'hp') throw new Error('真实配置含动态生命公式，当前独立静态期望不适用');
      if (node.attributeValueKind === 'CURRENT') return value;
      if (node.attributeValueKind === 'MISSING' || node.attributeValueKind === 'MISSING_RATIO') return 0;
      if (node.attributeValueKind === 'CURRENT_RATIO') return 1;
      throw new Error('未知属性口径');
    }
    const [left, right] = node.operands.map(child => evaluate(child, stages)) as [number, number];
    const operations = { ADD: () => left + right, SUBTRACT: () => left - right, MULTIPLY: () => left * right,
      DIVIDE: () => left / right, MIN: () => Math.min(left, right), MAX: () => Math.max(left, right) };
    return finite(operations[node.operation]());
  }
  const numeric = (value: NumericValue): number => value.kind === 'FIXED' ? finite(value.value)
    : value.kind === 'PARAMETER' ? parameter(value.parameterKey)
      : evaluate(config.formulas.find(row => row.formulaKey === value.formulaKey)!.expression);
  const rawInterval = numeric(config.processes[0]!.cooldown!.durationValue);
  if (rawInterval <= 0) throw new Error('原冷却必须为正');
  const interval = Math.max(1, Math.round(rawInterval));
  const resultAmounts: { operationRef: string; amount: number }[] = [];
  for (const rule of config.triggerRules.filter(row => row.eventSource.eventType === 'BASIC_ATTACK_HIT')) {
    for (const action of [...rule.actions].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (action.actionType !== 'EXECUTE_EFFECT') throw new Error('独立期望只接受实际执行效果');
      const effect = config.effects.find(row => row.effectKey === action.detail.effectKey)!;
      for (const result of [...effect.results].sort((a, b) => a.sortOrder - b.sortOrder)) {
        if (result.resultType !== 'DAMAGE') continue;
        const valueRule = result.valueRule!;
        let raw = numeric(valueRule.value) * valueRule.fixedMultiplier;
        if (valueRule.fixedMinValue !== null) raw = Math.max(raw, valueRule.fixedMinValue);
        if (valueRule.fixedMaxValue !== null) raw = Math.min(raw, valueRule.fixedMaxValue);
        const critical = result.detail.critical;
        if (critical.mode !== 'DISALLOWED') {
          const chance = critical.mode === 'FORCED' ? 1 : finite(attrs.source.critical_strike_chance);
          raw *= 1 + chance * (numeric(critical.multiplierValue!) - 1);
        }
        const formula = snapshot.catalogs.damageTypes.find(row => row.type.damageTypeKey === result.detail.damageTypeKey)!.formula.formula;
        const stages: Record<string, number> = {};
        for (const [key, resultKey] of [
          ['resistanceBeforePenetration', 'RESISTANCE_BEFORE_PENETRATION'], ['penetrationPercent', 'PENETRATION_PERCENT'],
          ['penetrationFlat', 'PENETRATION_FLAT'], ['effectiveResistance', 'EFFECTIVE_RESISTANCE'], ['resistanceFactor', 'RESISTANCE_FACTOR']
        ] as const) stages[resultKey] = evaluate(formula[key], stages);
        resultAmounts.push({ operationRef: `skills.${config.skill.skillKey}.effects.${effect.effectKey}.results.${result.resultKey}`,
          amount: Math.max(0, raw * stages.RESISTANCE_FACTOR!) });
      }
    }
  }
  const damagePerAttack = resultAmounts.reduce((amount, row) => amount + row.amount, 0);
  if (!(damagePerAttack > 0)) throw new Error('真实击杀验收需要有限正单刀期望');
  const count = Math.ceil(attrs.target.hp! / damagePerAttack);
  return { interval, rawInterval, count, damagePerAttack, damageTotal: count * damagePerAttack, killedAtMs: (count - 1) * interval, resultAmounts };
}
