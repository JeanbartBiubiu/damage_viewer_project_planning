import { validateStoredSkillFormula } from '../services/skillFormulaContract';
import { FORMULA_SCHEMA, type Expression } from '../types/formulaContract.generated';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffectValueRule } from '../types/skillEffect';
import type { SkillTriggerAction, SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { GenericFormulaExpr } from '../types/genericEngine';
import { compileParameter, constExpr, createNumericCompileState, NumericAdaptationError } from './numericAdapter';

const fail = (path: string, message: string): never => { throw new NumericAdaptationError(path, message); };
const key = (value: unknown, path: string) => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) fail(path, '本笔金额绑定需要明确稳定标识');
};

/** 只授权完整逐笔拥有者伤害监听的单一即时自身治疗，不向其它动作提供事件参数。 */
export function settledDamageHealBinding(action: SkillTriggerAction, rule: SkillTriggerRuleDetail,
  configuration: SkillConfiguration, path: string): string {
  if (rule.eventSource.eventType !== 'DAMAGE_DEALT' || rule.actions.length !== 1
    || rule.oncePerUse !== null || rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null
    || action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET'
    || action.resultModifiers.length || action.runtimeInputBindings.length !== 1) {
    return fail(path, '本笔金额只接真实DAMAGE_DEALT的无节流单动作自身治疗');
  }
  const binding = action.runtimeInputBindings[0]!;
  if (Object.keys(binding).some(field => !['bindingKey', 'parameterKey', 'sourceType', 'detail'].includes(field))
    || binding.sourceType !== 'EVENT_VALUE' || binding.detail.eventValueKey !== 'POST_DEFENSE_DAMAGE'
    || Object.keys(binding.detail).length !== 1) return fail(path, '本笔金额只接完整唯一POST_DEFENSE_DAMAGE事件绑定');
  key(binding.bindingKey, `${path}.runtimeInputBindings[0].bindingKey`);
  key(binding.parameterKey, `${path}.runtimeInputBindings[0].parameterKey`);
  const parameters = configuration.parameters.filter(row => row.parameterKey === binding.parameterKey);
  const parameter = parameters[0];
  if (parameters.length !== 1 || parameter?.gameId !== configuration.skill.gameId || parameter.skillKey !== configuration.skill.skillKey
    || parameter.valueMode !== 'RUNTIME_INPUT' || parameter.valueType !== 'DECIMAL'
    || parameter.fixedValue !== null || parameter.levelValues !== null) return fail(path, '本笔金额必须绑定本技能无默认十进制计算时参数');
  const effects = configuration.effects.filter(row => row.effectKey === action.detail.effectKey);
  const effect = effects[0]; const result = effect?.results[0];
  if (effects.length !== 1 || effect?.lifecycle !== null || effect.results.length !== 1 || !result
    || result.resultType !== 'DIRECT_HEAL' || result.target !== 'SOURCE' || Object.keys(result.detail).length
    || result.lifecycleBehavior !== null || result.spellShieldBlockScope !== null || !result.valueRule) {
    return fail(path, '本笔金额只能用于完整即时自身单一DIRECT_HEAL，不接受资源、混合结果或持续效果');
  }
  return binding.parameterKey;
}

type Term = { expression: GenericFormulaExpr; events: number; scale: number; clampBodyIndex?: number };

/** 保留完整作者公式；在动作范围内有界展开，实际操作不执行无事件供值的原命名公式。 */
export function lowerSettledDamageHealValueRule(rule: SkillEffectValueRule, configuration: SkillConfiguration,
  skillLevel: number, characterLevel: number, parameterKey: string, valueRulePath: string) {
  const root = `skills.${configuration.skill.skillKey}`;
  const numeric = createNumericCompileState({ gameId: configuration.skill.gameId, skillKey: configuration.skill.skillKey,
    skillLevel, characterLevel, parameters: configuration.parameters, formulas: configuration.formulas,
    bindParameters: false, allowAttributeReads: false, formulaNamespace: `${configuration.skill.skillKey}/settled_heal`,
    runtimeInputMessage: '其它计算时输入不属于本笔金额动作作用域' });
  const finite = (value: number, path: string) => {
    if (!Number.isFinite(value) || value < 0) return fail(path, '本笔金额静态系数必须完整、有限且非负');
    return value;
  };
  let nodes = 0;
  const mappings: Array<{ privatePath: string; authorPath: string }> = [];
  const account = (privatePath: string, authorPath: string, depth: number, map = true) => {
    if (++nodes > Math.min(FORMULA_SCHEMA['x-limits'].maxNodes, FORMULA_SCHEMA['x-limits'].maxInstructions)
      || depth > FORMULA_SCHEMA['x-limits'].maxDepth) fail(authorPath, '本笔金额公式展开超出共同公式预算');
    if (map) mappings.push({ privatePath, authorPath });
  };
  const parameter = (key: string, path: string): Term => {
    if (key === parameterKey) {
      const rows = configuration.parameters.filter(row => row.parameterKey === key); const row = rows[0];
      if (rows.length !== 1 || row?.valueMode !== 'RUNTIME_INPUT' || row.valueType !== 'DECIMAL' || row.fixedValue !== null || row.levelValues !== null
        || row.skillKey !== configuration.skill.skillKey || row.gameId !== configuration.skill.gameId) fail(path, '本笔金额参数缺少完整无默认声明');
      return { expression: { op: 'read', path: 'event.damage.mitigatedAmount' }, events: 1, scale: 1 };
    }
    const expression = compileParameter(key, path, numeric, fail);
    if (expression.op !== 'const' || typeof expression.value !== 'number') return fail(path, '本笔金额系数只接明确静态参数');
    return { expression, events: 0, scale: finite(expression.value, path) };
  };
  const lower = (value: SkillEffectValueRule['value']): Term => {
    if (value.kind === 'PARAMETER') { account('expression', `${root}.parameters.${value.parameterKey}`, 1); return parameter(value.parameterKey, root); }
    if (value.kind !== 'FORMULA') return fail(root, '本笔金额绑定必须被金额的参数或具名公式实际消费');
    const formulas = configuration.formulas.filter(row => row.formulaKey === value.formulaKey);
    const formula = formulas[0];
    if (formulas.length !== 1 || !formula || formula.gameId !== configuration.skill.gameId || formula.skillKey !== configuration.skill.skillKey) return fail(root, '本笔金额公式缺失、重复或归属错误');
    const formulaPath = `${root}.formulas.${formula.formulaKey}.expression`;
    const issue = validateStoredSkillFormula(formula.expression, configuration.skill.skillKey);
    if (issue) fail(formulaPath + issue.path, issue.code);
    const inputs = new Map(formula.expression.inputs.map((input, i) => [input.key, { ...input, path: `${formulaPath}.inputs[${i}].binding` }]));
    // 连未选或未消费声明也不能夹带属性、其它上下文或未供值参数。
    for (const input of inputs.values()) {
      if (input.binding.kind !== 'parameter') fail(input.path, '本笔金额公式不授权属性、状态、资源或其它上下文');
      else parameter(input.binding.parameterKey, input.path);
    }
    const stages = new Map(formula.expression.stages.map((stage, i) => [stage.key, { ...stage, path: `${formulaPath}.stages[${i}].expression` }]));
    const expand = (expression: Expression, privatePath: string, authorPath: string, depth: number, clamp: boolean, map: boolean): Term => {
      account(privatePath, authorPath, depth, map);
      if (expression.op === 'const') { const value = finite(Number(expression.value), authorPath); return { expression: constExpr(value), events: 0, scale: value }; }
      if (expression.op === 'read') {
        const input = inputs.get(expression.inputKey)!;
        if (input.binding.kind !== 'parameter') return fail(input.path, '本笔金额只授权本动作事件参数与静态系数');
        if (map) mappings.push({ privatePath, authorPath: input.path });
        return parameter(input.binding.parameterKey, input.path);
      }
      if (expression.op === 'ref') {
        const stage = stages.get(expression.stageKey)!;
        return expand(stage.expression, privatePath, stage.path, depth + 1, clamp, map);
      }
      if (!('args' in expression) || !['mul', 'div', 'max'].includes(expression.op)) return fail(authorPath, '本笔金额只接事件乘非负静态系数的乘除链及最终max0');
      const args = expression.args.map((child, i) => expand(child, `${privatePath}.args[${i}]`, `${authorPath}.args[${i}]`, depth + 1, false, map));
      const [left, right] = args as [Term, Term];
      if (expression.op === 'max') {
        if (!clamp || !(left.events === 0 && left.scale === 0 || right.events === 0 && right.scale === 0)) return fail(authorPath, '本笔金额只允许最终与明确0取max');
        const bodyIndex = left.events === 0 && left.scale === 0 ? 1 : 0;
        return { ...args[bodyIndex]!, expression: { op: 'max', args: args.map(arg => arg.expression) }, clampBodyIndex: bodyIndex };
      }
      if (left.events + right.events > 1 || expression.op === 'div' && (right.events !== 0 || right.scale <= 0)) return fail(authorPath, '本笔事件必须恰一次且不能作除数，静态除数必须为正');
      const scale = finite(expression.op === 'mul' ? left.scale * right.scale : left.scale / right.scale, authorPath);
      return { expression: { op: expression.op, args: args.map(arg => arg.expression) }, events: left.events + right.events, scale };
    };
    const output = stages.get(formula.expression.outputStageKey)!;
    const result = expand(output.expression, 'expression', output.path, 1, true, true);
    // 原共同公式完整保留，输出之外的阶段同样受依赖与语法检查；这些节点不伪装成实际操作映射。
    for (const stage of stages.values()) if (stage !== output) expand(stage.expression, '', stage.path, 1, true, false);
    return result;
  };
  const term = lower(rule.value);
  if (term.events !== 1) fail(root, '本动作事件金额绑定必须被最终金额恰好消费一次');
  finite(rule.fixedMultiplier, valueRulePath + '.fixedMultiplier');
  if (rule.fixedMinValue !== null && rule.fixedMinValue !== 0 || rule.fixedMaxValue !== null) fail(root, '本笔金额只允许最终下界0，不支持其它上下界');
  finite(term.scale * rule.fixedMultiplier, root);
  let expression = term.expression;
  let zero = constExpr(0);
  const outerMappings: typeof mappings = [];
  const zeroMappings: typeof mappings = [];
  if (term.clampBodyIndex !== undefined) {
    const bodyPrefix = `expression.args[${term.clampBodyIndex}]`;
    const zeroPrefix = `expression.args[${1 - term.clampBodyIndex}]`;
    expression = term.expression.args![term.clampBodyIndex]!;
    zero = term.expression.args![1 - term.clampBodyIndex]!;
    const bodyMappings: typeof mappings = [];
    for (const mapping of mappings) {
      if (mapping.privatePath === bodyPrefix || mapping.privatePath.startsWith(bodyPrefix + '.')) bodyMappings.push({ ...mapping,
        privatePath: 'expression' + mapping.privatePath.slice(bodyPrefix.length) });
      else if (mapping.privatePath === zeroPrefix || mapping.privatePath.startsWith(zeroPrefix + '.')) zeroMappings.push({ ...mapping,
        privatePath: 'expression.args[1]' + mapping.privatePath.slice(zeroPrefix.length) });
      else outerMappings.push({ ...mapping, privatePath: 'expression' });
    }
    mappings.splice(0, mappings.length, ...bodyMappings);
  }
  const wrap = (value: number, authorPath: string) => {
    for (const mapping of mappings) mapping.privatePath = mapping.privatePath.replace(/^expression/, 'expression.args[0]');
    mappings.push({ privatePath: 'expression.args[1]', authorPath });
    expression = { op: 'mul', args: [expression, constExpr(value)] };
  };
  if (rule.fixedMultiplier !== 1) wrap(rule.fixedMultiplier, valueRulePath + '.fixedMultiplier');
  if (rule.fixedMinValue === 0 || term.clampBodyIndex !== undefined) {
    for (const mapping of mappings) mapping.privatePath = mapping.privatePath.replace(/^expression/, 'expression.args[0]');
    expression = { op: 'max', args: [expression, zero] };
    mappings.push(...outerMappings, ...zeroMappings);
    if (rule.fixedMinValue === 0) mappings.push({ privatePath: 'expression.args[1]', authorPath: valueRulePath + '.fixedMinValue' });
  }
  let expandedNodes = 0;
  const budget = (node: GenericFormulaExpr, depth: number) => {
    if (++expandedNodes > Math.min(FORMULA_SCHEMA['x-limits'].maxNodes, FORMULA_SCHEMA['x-limits'].maxInstructions)
      || depth > FORMULA_SCHEMA['x-limits'].maxDepth) fail(root, '本笔金额包含结果倍率和上下界后的完整展开超出共同公式预算');
    node.args?.forEach(child => budget(child, depth + 1));
  };
  budget(expression, 1);
  return { expression, mappings, author: { formulaKey: rule.value.kind === 'FORMULA' ? rule.value.formulaKey : null, parameterKey } };
}
