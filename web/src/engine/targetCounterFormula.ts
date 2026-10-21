import { validateStoredSkillFormula } from '../services/skillFormulaContract';
import { FORMULA_SCHEMA, type Expression } from '../types/formulaContract.generated';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffectValueRule } from '../types/skillEffect';
import type { GenericFormulaExpr } from '../types/genericEngine';
import { compileAttributeValue, compileParameter, constExpr, createNumericCompileState, NumericAdaptationError } from './numericAdapter';

/** 保留作者完整公式，不求值；只把已证明的动作级目标计数绑定展开到私有数值树。 */
export function lowerTargetCounterValueRule(rule: SkillEffectValueRule, configuration: SkillConfiguration, skillLevel: number,
  characterLevel: number, parameterKey: string, stateKey: string) {
  const root = `skills.${configuration.skill.skillKey}`;
  const fail = (path: string, message: string): never => { throw new NumericAdaptationError(path, message); };
  const numeric = createNumericCompileState({ gameId: configuration.skill.gameId, skillKey: configuration.skill.skillKey,
    skillLevel, characterLevel, parameters: configuration.parameters, formulas: configuration.formulas,
    bindParameters: false, allowAttributeReads: true, formulaNamespace: `${configuration.skill.skillKey}/target_counter`,
    runtimeInputMessage: '目标计数之外的计算时输入没有本动作供值' });
  let nodes = 0;
  const mappings: Array<{ privatePath: string; authorPath: string }> = [];
  const account = (privatePath: string, authorPath: string, depth: number) => {
    if (++nodes > Math.min(FORMULA_SCHEMA['x-limits'].maxNodes, FORMULA_SCHEMA['x-limits'].maxInstructions)
      || depth > FORMULA_SCHEMA['x-limits'].maxDepth) fail(authorPath, '目标计数公式展开超出共同公式预算');
    mappings.push({ privatePath, authorPath });
  };
  const parameter = (key: string, path: string): GenericFormulaExpr => {
    const p = configuration.parameters.find(row => row.parameterKey === key);
    if (key === parameterKey) {
      if (p?.valueMode !== 'RUNTIME_INPUT' || p.valueType !== 'INTEGER' || p.fixedValue !== null || p.levelValues !== null) fail(path, '目标计数绑定必须来自无默认整数参数');
      return { op: 'read', path: `provider.target_state.${stateKey}` };
    }
    return compileParameter(key, path, numeric, fail);
  };
  const lower = (value: SkillEffectValueRule['value'], privatePath: string, depth: number): GenericFormulaExpr => {
    if (value.kind === 'FIXED') { account(privatePath, root, depth); return constExpr(value.value); }
    if (value.kind === 'PARAMETER') { account(privatePath, `${root}.parameters.${value.parameterKey}`, depth); return parameter(value.parameterKey, root); }
    const formula = configuration.formulas.find(row => row.formulaKey === value.formulaKey);
    if (!formula) return fail(root, '目标计数结果引用缺失公式');
    const path = `${root}.formulas.${formula.formulaKey}.expression`;
    const issue = validateStoredSkillFormula(formula.expression, configuration.skill.skillKey);
    if (issue) fail(path + issue.path, issue.code);
    const inputs = new Map(formula.expression.inputs.map((input, i) => [input.key, { ...input, path: `${path}.inputs[${i}].binding` }]));
    const stages = new Map(formula.expression.stages.map((stage, i) => [stage.key, { ...stage, path: `${path}.stages[${i}].expression` }]));
    const expand = (expression: Expression, privatePath: string, authorPath: string, depth: number): GenericFormulaExpr => {
      account(privatePath, authorPath, depth);
      if (expression.op === 'const') return constExpr(Number(expression.value));
      if (expression.op === 'ref') { const stage = stages.get(expression.stageKey)!; return expand(stage.expression, privatePath, stage.path, depth + 1); }
      if (expression.op === 'read') {
        const input = inputs.get(expression.inputKey)!;
        if (input.binding.kind === 'parameter') return parameter(input.binding.parameterKey, input.path);
        if (input.binding.kind !== 'attribute' || input.binding.view !== 'current_frame') return fail(input.path, '目标计数金额不授权其它事件或实例上下文');
        return compileAttributeValue({ attributeOwner: input.binding.object === 'source' ? 'SOURCE' : 'TARGET', attributeKey: input.binding.attributeKey,
          attributeValueKind: input.binding.valueKind }, input.path, numeric, fail);
      }
      if (!['add', 'mul', 'sub', 'div', 'min', 'max'].includes(expression.op) || !('args' in expression)) return fail(authorPath, '目标计数只接有界数值四则与上下界');
      return { op: expression.op, args: expression.args.map((child, i) => expand(child, `${privatePath}.args[${i}]`, `${authorPath}.args[${i}]`, depth + 1)) };
    };
    const output = stages.get(formula.expression.outputStageKey)!;
    return expand(output.expression, privatePath, output.path, depth);
  };
  let expression = lower(rule.value, 'expression', 1);
  if (rule.fixedMultiplier !== 1) expression = { op: 'mul', args: [expression, constExpr(rule.fixedMultiplier)] };
  if (rule.fixedMinValue !== null) expression = { op: 'max', args: [expression, constExpr(rule.fixedMinValue)] };
  if (rule.fixedMaxValue !== null) expression = { op: 'min', args: [expression, constExpr(rule.fixedMaxValue)] };
  return { expression, mappings, requiredAttributes: [...numeric.requiredAttributes],
    author: { configuration: structuredClone(configuration), rule: structuredClone(rule), parameterKey, stateKey } };
}
