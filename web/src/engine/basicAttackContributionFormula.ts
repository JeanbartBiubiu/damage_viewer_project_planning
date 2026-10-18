import { validateFormulaDefinition } from '../services/formulaContract';
import { skillFormulaAllowedBindings, validateStoredSkillFormula } from '../services/skillFormulaContract';
import { FORMULA_SCHEMA, type Binding, type Expression } from '../types/formulaContract.generated';
import type { GenericFormulaExpr } from '../types/genericEngine';
import { isNumericValue, type NumericValue } from '../types/numericValue';
import type { SkillEffectValueRule } from '../types/skillEffect';
import type { SkillFormula } from '../types/skillFormula';
import type { SkillParameter } from '../types/skillParameter';
import { compileAttributeValue, compileParameter, createNumericCompileState, finiteNumber, NumericAdaptationError } from './numericAdapter';

export type BasicAttackContributionFormulaPurpose = 'amount' | 'criticalMultiplier' | 'vampEfficiency';
export type BasicAttackContributionFormulaAuthor = {
  gameId: string;
  skillKey: string;
  skillLevel: number;
  characterLevel: number;
  parameters: readonly SkillParameter[];
  formulas: readonly SkillFormula[];
  attributes: readonly { attributeKey: string; status?: string }[];
};
export type BasicAttackContributionFormulaMapping = {
  privatePath: string;
  authorPath: string;
  kind: 'expression' | 'stageReference' | 'binding' | 'parameter' | 'valueRule';
};
export type LoweredBasicAttackContributionFormula = {
  expression: GenericFormulaExpr;
  requiredAttributes: Record<'source' | 'target', string[]>;
  source: {
    purpose: BasicAttackContributionFormulaPurpose;
    authorPath: string;
    author: BasicAttackContributionFormulaAuthor;
    value: NumericValue;
    valueRule: SkillEffectValueRule | null;
    formula: SkillFormula | null;
    selectedParameters: Array<{ definition: SkillParameter; value: number }>;
  };
  mappings: BasicAttackContributionFormulaMapping[];
  usage: { nodes: number; depth: number };
};

// 原定义仍按共同契约校验；展开后的私有树也不得放大现有节点、指令或深度上限。
export const BASIC_ATTACK_CONTRIBUTION_FORMULA_LIMITS = {
  maxNodes: Math.min(FORMULA_SCHEMA['x-limits'].maxNodes, FORMULA_SCHEMA['x-limits'].maxInstructions),
  maxDepth: FORMULA_SCHEMA['x-limits'].maxDepth
} as const;

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: unknown, keys: readonly string[], path: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '需要完整对象');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, '未授权字段不能忽略');
}
function array(value: unknown, path: string): void {
  if (!Array.isArray(value)) fail(path, '需要完整目录数组');
}
const parameterKeys = ['gameId', 'skillKey', 'parameterKey', 'name', 'description', 'sortOrder', 'createdAt', 'updatedAt',
  'valueType', 'valueMode', 'fixedValue', 'levelValues'];
const formulaKeys = ['gameId', 'skillKey', 'formulaKey', 'name', 'description', 'sortOrder', 'createdAt', 'updatedAt', 'expression'];

/** 只替换已授权的静态参数、当前属性与阶段引用；不求值、折叠或改变运算括号。 */
export function lowerBasicAttackContributionValue(value: NumericValue, author: BasicAttackContributionFormulaAuthor,
  authorPath: string, purpose: BasicAttackContributionFormulaPurpose): LoweredBasicAttackContributionFormula {
  return lower(value, author, authorPath, purpose, null);
}

/** 与既有数值规则同序的纯结构包装，避免 wrapValueRuleExpression 的常量折叠。 */
export function lowerBasicAttackContributionValueRule(rule: SkillEffectValueRule, author: BasicAttackContributionFormulaAuthor,
  authorPath: string, purpose: BasicAttackContributionFormulaPurpose): LoweredBasicAttackContributionFormula {
  exact(rule, ['value', 'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue'], authorPath);
  finiteNumber(rule.fixedMultiplier, `${authorPath}.fixedMultiplier`, fail);
  for (const key of ['fixedMinValue', 'fixedMaxValue'] as const) if (rule[key] !== null) finiteNumber(rule[key], `${authorPath}.${key}`, fail);
  if (rule.fixedMinValue !== null && rule.fixedMaxValue !== null && rule.fixedMinValue > rule.fixedMaxValue) fail(authorPath, '数值下界不能高于上界');
  return lower(rule.value, author, `${authorPath}.value`, purpose, { rule, path: authorPath });
}

function lower(value: NumericValue, author: BasicAttackContributionFormulaAuthor, authorPath: string,
  purpose: BasicAttackContributionFormulaPurpose, wrapped: { rule: SkillEffectValueRule; path: string } | null): LoweredBasicAttackContributionFormula {
  exact(author, ['gameId', 'skillKey', 'skillLevel', 'characterLevel', 'parameters', 'formulas', 'attributes'], authorPath);
  if (!['amount', 'criticalMultiplier', 'vampEfficiency'].includes(purpose)) fail(authorPath, '未授权数值用途');
  if (!authorPath || typeof authorPath !== 'string') fail('authorPath', '需要完整作者路径');
  if (typeof author.gameId !== 'string' || typeof author.skillKey !== 'string'
    || !/^[a-z][a-z0-9_]{0,63}$/.test(author.gameId) || !/^[a-z][a-z0-9_]{0,63}$/.test(author.skillKey)) fail(authorPath, '作者身份不合法');
  if (![author.skillLevel, author.characterLevel].every(n => Number.isSafeInteger(n) && n > 0)) fail(authorPath, '本次等级必须明确且有效');
  array(author.parameters, `${authorPath}.parameters`); array(author.formulas, `${authorPath}.formulas`); array(author.attributes, `${authorPath}.attributes`);
  for (const [key, rows] of [['parameters', author.parameters], ['formulas', author.formulas], ['attributes', author.attributes]] as const) {
    rows.forEach((row, i) => { if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`${authorPath}.${key}[${i}]`, '目录项必须为完整对象'); });
  }
  if (!isNumericValue(value)) fail(authorPath, '数值引用形状不合法');
  const state = createNumericCompileState({ ...author, bindParameters: false, allowAttributeReads: true,
    formulaNamespace: `contribution/${author.skillKey}`, runtimeInputMessage: '普攻组成不授权计算时输入' });
  const selected = new Map<string, { definition: SkillParameter; value: number }>();
  const required: Record<'source' | 'target', Set<string>> = { source: new Set(), target: new Set() };
  const mappings: BasicAttackContributionFormulaMapping[] = [];
  let nodes = 0, maximumDepth = 0;
  const account = (depth: number, path: string) => {
    if (nodes >= BASIC_ATTACK_CONTRIBUTION_FORMULA_LIMITS.maxNodes || depth > BASIC_ATTACK_CONTRIBUTION_FORMULA_LIMITS.maxDepth) fail(path, 'FORMULA_LIMIT：私有表达式展开超限');
    nodes++; maximumDepth = Math.max(maximumDepth, depth);
  };
  const map = (privatePath: string, path: string, kind: BasicAttackContributionFormulaMapping['kind']) => mappings.push({ privatePath, authorPath: path, kind });
  const parameter = (key: string): GenericFormulaExpr => {
    const rows = author.parameters.filter(row => row.parameterKey === key);
    const path = `skills.${author.skillKey}.parameters.${key}`;
    if (rows.length !== 1) fail(path, '参数缺失或重复');
    const row = rows[0]!; exact(row, parameterKeys, path);
    if (row.gameId !== author.gameId || row.skillKey !== author.skillKey) fail(path, '参数不属于实际作者');
    if (!['INTEGER', 'DECIMAL'].includes(row.valueType)) fail(path, '未知参数类型');
    if (!['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL'].includes(row.valueMode)) fail(path, '普攻组成不授权计算时输入');
    if (row.valueMode === 'FIXED' ? row.levelValues !== null : row.fixedValue !== null) fail(path, '参数值与取值模式不一致');
    if (row.valueMode !== 'FIXED') {
      if (!row.levelValues || typeof row.levelValues !== 'object' || Array.isArray(row.levelValues)) fail(path, '需要完整等级参数表');
      for (const [level, number] of Object.entries(row.levelValues)) {
        if (!/^[1-9][0-9]*$/.test(level) || !Number.isSafeInteger(Number(level))) fail(path, '等级参数键不合法');
        finiteNumber(number, `${path}.levelValues.${level}`, fail);
        if (row.valueType === 'INTEGER' && !Number.isSafeInteger(number)) fail(path, '整数参数必须为安全整数');
      }
    }
    const expression = compileParameter(key, path, state, fail);
    const number = finiteNumber(expression.value, path, fail);
    if (expression.op !== 'const' || row.valueType === 'INTEGER' && !Number.isSafeInteger(number)) fail(path, '参数未冻结为合法静态数值');
    selected.set(key, { definition: row, value: number });
    return expression;
  };
  const emitPrimitive = (expression: GenericFormulaExpr, path: string, privatePath: string, depth: number): GenericFormulaExpr => {
    account(depth, path); map(privatePath, path, 'binding');
    return { ...expression, ...(expression.args ? { args: expression.args.map((child, i) => emitPrimitive(child, path, `${privatePath}.args[${i}]`, depth + 1)) } : {}) };
  };

  let formula: SkillFormula | null = null;
  let lowerValue: (privatePath: string, depth: number) => GenericFormulaExpr;
  if (value.kind !== 'FORMULA') {
    const primitive = value.kind === 'FIXED' ? { op: 'const', value: value.value } : parameter(value.parameterKey);
    lowerValue = (privatePath, depth) => {
      if (value.kind === 'PARAMETER') map(privatePath, `skills.${author.skillKey}.parameters.${value.parameterKey}`, 'parameter');
      return emitPrimitive(primitive, authorPath, privatePath, depth);
    };
  } else {
    const rows = author.formulas.filter(row => row.formulaKey === value.formulaKey);
    if (rows.length !== 1) fail(authorPath, '公式缺失或重复');
    const selectedFormula = rows[0]!;
    formula = selectedFormula;
    const formulaPath = `skills.${author.skillKey}.formulas.${selectedFormula.formulaKey}`;
    exact(selectedFormula, formulaKeys, formulaPath);
    if (selectedFormula.gameId !== author.gameId || selectedFormula.skillKey !== author.skillKey) fail(formulaPath, '公式不属于实际作者');
    const definition = selectedFormula.expression;
    const issue = validateStoredSkillFormula(definition, author.skillKey)
      ?? validateFormulaDefinition(definition, skillFormulaAllowedBindings(author.skillKey, author.parameters, author.attributes));
    if (issue) fail(`${formulaPath}.expression${issue.path}`, issue.code);
    const checkSubset = (expression: Expression, path: string): void => {
      if (!['const', 'read', 'ref', 'add', 'mul'].includes(expression.op)) fail(path, '普攻组成仅授权常量、读取、阶段引用、加法与乘法');
      if ('args' in expression) expression.args.forEach((child, i) => checkSubset(child, `${path}.args[${i}]`));
    };
    definition.stages.forEach((stage, i) => checkSubset(stage.expression, `${formulaPath}.expression.stages[${i}].expression`));
    const inputs = new Map<string, { binding: Binding; path: string; expression: GenericFormulaExpr }>();
    definition.inputs.forEach((input, i) => {
      const path = `${formulaPath}.expression.inputs[${i}].binding`, binding = input.binding;
      if (binding.kind === 'context') return fail(path, '普攻组成不授权事件、过程或实例上下文');
      if (binding.kind === 'attribute' && (binding.view !== 'current_frame' || binding.valueKind !== 'TOTAL')) {
        return fail(path, '普攻组成属性仅授权当前帧总值TOTAL');
      }
      const expression = binding.kind === 'parameter' ? parameter(binding.parameterKey)
        : compileAttributeValue({ attributeOwner: binding.object === 'source' ? 'SOURCE' : 'TARGET',
          attributeKey: binding.attributeKey, attributeValueKind: binding.valueKind }, path, state, fail);
      inputs.set(input.key, { binding, path, expression });
    });
    const stages = new Map(definition.stages.map((stage, i) => [stage.key, { expression: stage.expression,
      path: `${formulaPath}.expression.stages[${i}].expression` }]));
    const expand = (expression: Expression, path: string, privatePath: string, depth: number): GenericFormulaExpr => {
      if (expression.op === 'ref') {
        map(privatePath, path, 'stageReference');
        const stage = stages.get(expression.stageKey)!;
        return expand(stage.expression, stage.path, privatePath, depth);
      }
      if (expression.op === 'read') {
        map(privatePath, path, 'expression');
        const input = inputs.get(expression.inputKey)!;
        if (input.binding.kind === 'attribute') required[input.binding.object as 'source' | 'target'].add(input.binding.attributeKey);
        return emitPrimitive(input.expression, input.path, privatePath, depth);
      }
      account(depth, path); map(privatePath, path, 'expression');
      if (expression.op === 'const') return { op: 'const', value: finiteNumber(Number(expression.value), path, fail) };
      if (expression.op !== 'add' && expression.op !== 'mul') return fail(path, '未授权表达式');
      return { op: expression.op, args: expression.args.map((child, i) => expand(child, `${path}.args[${i}]`, `${privatePath}.args[${i}]`, depth + 1)) };
    };
    const output = stages.get(definition.outputStageKey)!;
    lowerValue = (privatePath, depth) => expand(output.expression, output.path, privatePath, depth);
  }

  const wrappers: Array<{ op: string; value: number; path: string }> = [];
  if (wrapped) {
    const { rule, path } = wrapped;
    if (rule.fixedMultiplier !== 1) wrappers.push({ op: 'mul', value: rule.fixedMultiplier, path: `${path}.fixedMultiplier` });
    if (rule.fixedMinValue !== null) wrappers.push({ op: 'max', value: rule.fixedMinValue, path: `${path}.fixedMinValue` });
    if (rule.fixedMaxValue !== null) wrappers.push({ op: 'min', value: rule.fixedMaxValue, path: `${path}.fixedMaxValue` });
  }
  const wrap = (index: number, privatePath: string, depth: number): GenericFormulaExpr => {
    if (index < 0) return lowerValue(privatePath, depth);
    const wrapper = wrappers[index]!; account(depth, wrapper.path); map(privatePath, wrapper.path, 'valueRule');
    const left = wrap(index - 1, `${privatePath}.args[0]`, depth + 1);
    account(depth + 1, wrapper.path); map(`${privatePath}.args[1]`, wrapper.path, 'valueRule');
    return { op: wrapper.op, args: [left, { op: 'const', value: wrapper.value }] };
  };
  const expression = wrap(wrappers.length - 1, 'expression', 1);
  return { expression, requiredAttributes: { source: [...required.source], target: [...required.target] },
    source: structuredClone({ purpose, authorPath, author, value, valueRule: wrapped?.rule ?? null, formula,
      selectedParameters: [...selected.values()] }), mappings, usage: { nodes, depth: maximumDepth } };
}
