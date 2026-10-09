import {
  FORMULA_SCHEMA,
  type Binding,
  type Expression,
  type FormulaContractErrorCode,
  type FormulaDefinition
} from '../types/formulaContract.generated';

export type FormulaContractIssue = { code: FormulaContractErrorCode; path: string };

type Schema = {
  readonly $ref?: string;
  readonly type?: string;
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly oneOf?: readonly Schema[];
  readonly 'x-discriminator'?: string;
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: Schema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
};

type Budget = { nodes: number; instructions: number };
type ExpressionEntry = { expression: Expression; path: string };
type StageReference = { target: number; path: string };

const limits = FORMULA_SCHEMA['x-limits'];
const expressionSchema: Schema = FORMULA_SCHEMA.$defs.expression;
const stageSchema: Schema = FORMULA_SCHEMA.$defs.stage;

function issue(code: FormulaContractErrorCode, path: string): FormulaContractIssue {
  return { code, path };
}

function childPath(path: string, key: string | number): string {
  return `${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0)!);
  const rightPoints = Array.from(right, character => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function resolveSchema(schema: Schema): Schema {
  if (!schema.$ref) return schema;
  let target: unknown = FORMULA_SCHEMA;
  for (const part of schema.$ref.slice(2).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isObject(target) || !hasOwn(target, key)) {
      throw new Error('共同公式结构规范包含无法解析的引用');
    }
    target = target[key];
  }
  return resolveSchema(target as Schema);
}

function validateStructure(
  value: unknown,
  schemaNode: Schema,
  path: string,
  budget: Budget,
  parentExpressionDepth: number
): FormulaContractIssue | null {
  let schema = resolveSchema(schemaNode);
  let expressionDepth = parentExpressionDepth;
  if (schema === expressionSchema) {
    // 在读取或遍历超限节点之前停止，整份定义共用同一预算。
    if (expressionDepth >= limits.maxDepth || budget.nodes >= limits.maxNodes) {
      return issue('FORMULA_LIMIT', path);
    }
    expressionDepth += 1;
    budget.nodes += 1;
    budget.instructions += isObject(value) && value.op === 'if' ? 3 : 1;
  } else if (schema === stageSchema) {
    budget.instructions += 1;
  }
  if (budget.instructions > limits.maxInstructions) return issue('FORMULA_LIMIT', path);

  if (schema.oneOf) {
    if (!isObject(value)) return issue('FORMULA_INVALID_STRUCTURE', path);
    const discriminator = schema['x-discriminator'];
    if (!discriminator) throw new Error('共同公式结构规范缺少节点判别字段');
    const selected = schema.oneOf.find(candidate => {
      const property = candidate.properties?.[discriminator];
      if (!property) return false;
      const resolved = resolveSchema(property);
      return ('const' in resolved && value[discriminator] === resolved.const)
        || resolved.enum?.some(candidateValue => value[discriminator] === candidateValue);
    });
    if (!selected) return issue('FORMULA_INVALID_STRUCTURE', childPath(path, discriminator));
    schema = resolveSchema(selected);
  }

  if ('const' in schema && value !== schema.const) return issue('FORMULA_INVALID_STRUCTURE', path);
  if (schema.enum && !schema.enum.some(candidate => value === candidate)) {
    return issue('FORMULA_INVALID_STRUCTURE', path);
  }

  if (schema.type === 'object') {
    if (!isObject(value)) return issue('FORMULA_INVALID_STRUCTURE', path);
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      const unknownKeys = Object.keys(value).filter(key => !hasOwn(properties, key)).sort(compareCodePoints);
      if (unknownKeys.length > 0) return issue('FORMULA_INVALID_STRUCTURE', childPath(path, unknownKeys[0]));
    }
    for (const key of schema.required ?? []) {
      if (!hasOwn(value, key)) return issue('FORMULA_INVALID_STRUCTURE', childPath(path, key));
    }
    for (const [key, property] of Object.entries(properties)) {
      if (!hasOwn(value, key)) continue;
      const problem = validateStructure(value[key], property, childPath(path, key), budget, expressionDepth);
      if (problem) return problem;
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return issue('FORMULA_INVALID_STRUCTURE', path);
    if ((schema.minItems !== undefined && value.length < schema.minItems)
      || (schema.maxItems !== undefined && value.length > schema.maxItems)) {
      return issue('FORMULA_INVALID_STRUCTURE', path);
    }
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const problem = validateStructure(value[index], schema.items, childPath(path, index), budget, expressionDepth);
        if (problem) return problem;
      }
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') return issue('FORMULA_INVALID_STRUCTURE', path);
    const length = Array.from(value).length;
    if ((schema.minLength !== undefined && length < schema.minLength)
      || (schema.maxLength !== undefined && length > schema.maxLength)) {
      return issue('FORMULA_INVALID_STRUCTURE', path);
    }
    if (schema.pattern) {
      // JavaScript 的 $ 允许匹配末尾换行之前，契约要求整个字符串匹配。
      const match = new RegExp(schema.pattern, 'u').exec(value);
      if (!match || match[0] !== value) return issue('FORMULA_INVALID_STRUCTURE', path);
    }
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)
      || (schema.type === 'integer' && !Number.isInteger(value))) {
      return issue('FORMULA_INVALID_STRUCTURE', path);
    }
    if ((schema.minimum !== undefined && value < schema.minimum)
      || (schema.maximum !== undefined && value > schema.maximum)) {
      return issue('FORMULA_INVALID_STRUCTURE', path);
    }
  }
  return null;
}

function collectExpressions(expression: Expression, path: string, entries: ExpressionEntry[]): void {
  entries.push({ expression, path });
  if ('args' in expression) {
    expression.args.forEach((argument, index) => {
      collectExpressions(argument, childPath(childPath(path, 'args'), index), entries);
    });
  }
}

function sameBinding(left: Binding, right: Binding): boolean {
  const leftFields = Object.keys(left);
  const rightFields = Object.keys(right);
  if (leftFields.length !== rightFields.length) return false;
  return leftFields.every(key => hasOwn(right, key)
    && (left as Record<string, unknown>)[key] === (right as Record<string, unknown>)[key]);
}

/** 校验共同公式定义的结构、局部引用和声明授权，不读取或执行任何运行数值。 */
export function validateFormulaDefinition(
  definition: unknown,
  allowedBindings: readonly Binding[]
): FormulaContractIssue | null {
  const structureProblem = validateStructure(definition, FORMULA_SCHEMA, '', { nodes: 0, instructions: 0 }, 0);
  if (structureProblem) return structureProblem;

  const formula = definition as FormulaDefinition;
  const stageExpressions = formula.stages.map((stage, index) => {
    const entries: ExpressionEntry[] = [];
    collectExpressions(stage.expression, `/stages/${index}/expression`, entries);
    return entries;
  });
  const expressions = stageExpressions.flat();
  for (const { expression, path } of expressions) {
    if (expression.op !== 'const') continue;
    const numericValue = Number(expression.value);
    if (!Number.isFinite(numericValue) || (numericValue === 0 && /[1-9]/.test(expression.value))) {
      return issue('FORMULA_INVALID_DECIMAL', childPath(path, 'value'));
    }
  }

  const inputKeys = new Set<string>();
  for (let index = 0; index < formula.inputs.length; index += 1) {
    const input = formula.inputs[index];
    if (inputKeys.has(input.key)) return issue('FORMULA_DUPLICATE_KEY', `/inputs/${index}/key`);
    inputKeys.add(input.key);
  }
  const stageIndexes = new Map<string, number>();
  for (let index = 0; index < formula.stages.length; index += 1) {
    const stage = formula.stages[index];
    if (stageIndexes.has(stage.key)) return issue('FORMULA_DUPLICATE_KEY', `/stages/${index}/key`);
    stageIndexes.set(stage.key, index);
  }
  if (!stageIndexes.has(formula.outputStageKey)) return issue('FORMULA_UNKNOWN_STAGE', '/outputStageKey');

  for (let index = 0; index < formula.inputs.length; index += 1) {
    if (!allowedBindings.some(binding => sameBinding(formula.inputs[index].binding, binding))) {
      return issue('FORMULA_UNKNOWN_BINDING', `/inputs/${index}/binding`);
    }
  }
  for (const { expression, path } of expressions) {
    if (expression.op === 'read' && !inputKeys.has(expression.inputKey)) {
      return issue('FORMULA_UNKNOWN_INPUT', childPath(path, 'inputKey'));
    }
    if (expression.op === 'ref' && !stageIndexes.has(expression.stageKey)) {
      return issue('FORMULA_UNKNOWN_STAGE', childPath(path, 'stageKey'));
    }
  }

  const references: StageReference[][] = stageExpressions.map(entries => entries.flatMap(({ expression, path }) => (
    expression.op === 'ref' ? [{ target: stageIndexes.get(expression.stageKey)!, path: childPath(path, 'stageKey') }] : []
  )));
  const states = formula.stages.map(() => 0);
  function checkCycle(index: number): FormulaContractIssue | null {
    if (states[index] === 2) return null;
    states[index] = 1;
    for (const reference of references[index]) {
      if (states[reference.target] === 1) return issue('FORMULA_CYCLE', reference.path);
      const problem = checkCycle(reference.target);
      if (problem) return problem;
    }
    states[index] = 2;
    return null;
  }
  for (let index = 0; index < formula.stages.length; index += 1) {
    const cycleProblem = checkCycle(index);
    if (cycleProblem) return cycleProblem;
  }

  // 按结果缓存深度；引用节点占一层，共享结果不会递归内联复制。
  const stageDepths = new Map<number, number>();
  function stageDepth(index: number): number {
    const cached = stageDepths.get(index);
    if (cached !== undefined) return cached;
    const depth = expressionDepth(formula.stages[index].expression);
    stageDepths.set(index, depth);
    return depth;
  }
  function expressionDepth(expression: Expression): number {
    if (expression.op === 'ref') return 1 + stageDepth(stageIndexes.get(expression.stageKey)!);
    if ('args' in expression) return 1 + Math.max(...expression.args.map(expressionDepth));
    return 1;
  }
  for (let index = 0; index < formula.stages.length; index += 1) {
    if (stageDepth(index) > limits.maxDepth) return issue('FORMULA_LIMIT', `/stages/${index}/expression`);
  }
  return null;
}
