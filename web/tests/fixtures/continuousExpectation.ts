import { isDeepStrictEqual } from 'node:util';
import type { DamageTypeFormula } from '../../src/types/damageTypeFormula';
import type { Binding, Expression } from '../../src/types/formulaContract.generated';
import type { NumericValue } from '../../src/types/numericValue';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';

/** 有限共享普攻样本：先核对作者共同结构，再按明确关系手算；防御沿用3A独立对照。 */
export function continuousExpectation(snapshot: SimulationSnapshot, explicit: { source: Record<string, number>; target: Record<string, number> }) {
  const config = snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === snapshot.selection.basicAttackSkillKey);
  if (!config) throw new Error(`冻结作者树缺少所选普攻配置：${snapshot.selection.basicAttackSkillKey}`);
  if (config.skill.skillKey !== 'shared_basic_attack' || config.formulas.length !== 3) {
    throw new Error('独立期望仅适用于已核定的共享普攻三式，不能推测未知作者配置');
  }
  const attrs = { source: { ...explicit.source, ...snapshot.source.selectedLevelValues }, target: { ...explicit.target, ...snapshot.target.selectedLevelValues } };
  const finite = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('独立期望计算缺少明确数值');
    return value;
  };
  const parameter = (key: string) => {
    const rows = config.parameters.filter(item => item.parameterKey === key);
    const row = rows[0];
    if (rows.length !== 1 || !row || row.skillKey !== config.skill.skillKey || row.gameId !== snapshot.gameId || row.valueMode !== 'FIXED') {
      throw new Error('独立期望只读取真实所属技能的固定参数目录：' + key);
    }
    return finite(row.fixedValue);
  };
  function assertFormula(key: string, bindings: Binding[], expected: (reads: Expression[]) => Expression) {
    const rows = config!.formulas.filter(row => row.formulaKey === key);
    const row = rows[0];
    if (rows.length !== 1 || !row || row.skillKey !== config!.skill.skillKey || row.gameId !== snapshot.gameId) {
      throw new Error('独立期望缺少真实共同普攻公式：' + key);
    }
    const formula = row.expression;
    if (!Array.isArray(formula.inputs) || !Array.isArray(formula.stages)
      || formula.inputs.length !== bindings.length || formula.stages.length !== 1 || formula.outputStageKey !== formula.stages[0]!.key
      || new Set(formula.inputs.map(input => input.key)).size !== formula.inputs.length) {
      throw new Error('独立期望不适用于该共同普攻输入或结果结构：' + key);
    }
    const reads: Expression[] = bindings.map(binding => {
      const matches = formula.inputs.filter(input => isDeepStrictEqual(input.binding, binding));
      if (matches.length !== 1) throw new Error('独立期望不适用于该共同普攻绑定：' + key);
      return { op: 'read', inputKey: matches[0]!.key };
    });
    if (!isDeepStrictEqual(formula.stages[0]!.expression, expected(reads))) {
      throw new Error('独立期望不适用于该共同普攻运算关系：' + key);
    }
  }
  const sourceTotal = (attributeKey: string): Binding => ({ kind: 'attribute', object: 'source', attributeKey, valueKind: 'TOTAL', view: 'current_frame' });
  const ownParameter = (parameterKey: string): Binding => ({ kind: 'parameter', skillKey: config.skill.skillKey, parameterKey });
  assertFormula('attack_damage', [sourceTotal('attack_damage')], ([damage]) => damage!);
  assertFormula('attack_interval_ms', [ownParameter('milliseconds_per_second'), sourceTotal('attack_speed')], ([milliseconds, speed]) => ({ op: 'div', args: [milliseconds!, speed!] }));
  assertFormula('critical_multiplier', [ownParameter('base_critical_multiplier'), sourceTotal('critical_strike_damage_bonus_percent')], ([base, bonus]) => ({ op: 'add', args: [base!, bonus!] }));
  // 三个数值是核对上面关系后手算的有限样本期望，不解释作者共同运算树。
  const authoredValues = new Map([
    ['attack_damage', finite(attrs.source.attack_damage)],
    ['attack_interval_ms', finite(parameter('milliseconds_per_second') / finite(attrs.source.attack_speed))],
    ['critical_multiplier', finite(parameter('base_critical_multiplier') + finite(attrs.source.critical_strike_damage_bonus_percent))]
  ]);
  function defenseOutput(formula: DamageTypeFormula): number {
    const stages = new Map<string, number>(), visiting = new Set<string>();
    function stage(key: string): number {
      const cached = stages.get(key);
      if (cached !== undefined) return cached;
      if (visiting.has(key)) throw new Error('独立期望遇到循环');
      const result = formula.stages.find(row => row.key === key);
      if (!result) throw new Error('独立期望缺少具名结果');
      visiting.add(key);
      const value = expression(result.expression);
      visiting.delete(key); stages.set(key, value); return value;
    }
    function expression(node: Expression): number {
      if (node.op === 'const') return finite(Number(node.value));
      if (node.op === 'ref') return stage(node.stageKey);
      if (node.op === 'read') {
        const binding = formula.inputs.find(input => input.key === node.inputKey)?.binding;
        if (!binding || binding.kind !== 'attribute' || (binding.object !== 'source' && binding.object !== 'target')
          || binding.view !== 'current_frame') throw new Error('独立期望遇到未支持的绑定');
        if (binding.attributeKey === 'hp') throw new Error('真实配置含动态生命公式，当前独立静态期望不适用');
        const value = finite(attrs[binding.object][binding.attributeKey]);
        if (binding.valueKind === 'BASE' || binding.valueKind === 'TOTAL') return value;
        if (binding.valueKind === 'BONUS') return 0;
        throw new Error('独立期望遇到未支持的属性口径');
      }
      const left = expression(node.args[0]), right = node.args[1] ? expression(node.args[1]) : 0;
      if (node.op === 'add') return finite(left + right);
      if (node.op === 'sub') return finite(left - right);
      if (node.op === 'mul') return finite(left * right);
      if (node.op === 'div') return finite(left / right);
      if (node.op === 'min') return Math.min(left, right);
      if (node.op === 'max') return Math.max(left, right);
      throw new Error('独立静态样本期望不适用于该运算');
    }
    return stage(formula.outputStageKey);
  }
  const numeric = (value: NumericValue): number => value.kind === 'FIXED' ? finite(value.value)
    : value.kind === 'PARAMETER' ? parameter(value.parameterKey) : finite(authoredValues.get(value.formulaKey));
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
        resultAmounts.push({ operationRef: `skills.${config.skill.skillKey}.effects.${effect.effectKey}.results.${result.resultKey}`,
          amount: Math.max(0, raw * defenseOutput(formula)) });
      }
    }
  }
  const damagePerAttack = resultAmounts.reduce((amount, row) => amount + row.amount, 0);
  if (!(damagePerAttack > 0)) throw new Error('真实击杀验收需要有限正单刀期望');
  const count = Math.ceil(attrs.target.hp! / damagePerAttack);
  return { interval, rawInterval, count, damagePerAttack, damageTotal: count * damagePerAttack, killedAtMs: (count - 1) * interval, resultAmounts };
}
