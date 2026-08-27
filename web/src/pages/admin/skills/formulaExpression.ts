import type { Attribute } from '../../../types/attribute';
import type {
  CreateSkillFormulaRequest,
  FormulaAttributeOwner,
  FormulaAttributeValueKind,
  FormulaExpressionNode,
  FormulaOperation,
  UpdateSkillFormulaRequest
} from '../../../types/skillFormula';
import type { SkillParameter } from '../../../types/skillParameter';

export const FORMULA_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const MAX_FORMULA_DEPTH = 32;
export const MAX_FORMULA_NODES = 256;

export type FormulaNodeKind = 'empty' | 'OPERATION' | 'PARAMETER' | 'ATTRIBUTE';

export type FormulaNodeDraft =
  | { nodeType: 'empty' }
  | {
      nodeType: 'OPERATION';
      operation: FormulaOperation | '';
      left: FormulaNodeDraft;
      right: FormulaNodeDraft;
    }
  | {
      nodeType: 'PARAMETER';
      parameterKey: string;
    }
  | {
      nodeType: 'ATTRIBUTE';
      attributeOwner: FormulaAttributeOwner | '';
      attributeKey: string;
      attributeValueKind: FormulaAttributeValueKind | '';
    };

export type SkillFormulaDraft = {
  formulaKey: string;
  name: string;
  description: string;
  sortOrder: string;
  expression: FormulaNodeDraft;
};

export type SkillFormulaDraftField =
  | 'formulaKey'
  | 'name'
  | 'description'
  | 'sortOrder'
  | 'expression';

export type SkillFormulaDraftErrors = Partial<Record<SkillFormulaDraftField, string>>;

export type FormulaNodeIssue = {
  path: string;
  message: string;
};

export type SkillFormulaFormValidation =
  | { ok: true; normalized: CreateSkillFormulaRequest }
  | { ok: false; fieldErrors: SkillFormulaDraftErrors; nodeIssues: FormulaNodeIssue[] };

export type FormulaPreviewCatalog = {
  parameters: ReadonlyArray<Pick<SkillParameter, 'parameterKey' | 'name' | 'valueMode'>>;
  attributes: ReadonlyArray<Pick<Attribute, 'attributeKey' | 'name'>>;
};

export type FormulaPreviewSegment = {
  text: string;
  error?: boolean;
};

export const FORMULA_OPERATIONS: FormulaOperation[] = [
  'ADD',
  'SUBTRACT',
  'MULTIPLY',
  'DIVIDE',
  'MIN',
  'MAX'
];

export const FORMULA_ATTRIBUTE_VALUE_KINDS: FormulaAttributeValueKind[] = [
  'BASE',
  'BONUS',
  'TOTAL',
  'CURRENT',
  'MISSING',
  'CURRENT_RATIO',
  'MISSING_RATIO'
];

export function createEmptyFormulaDraft(): SkillFormulaDraft {
  return {
    formulaKey: '',
    name: '',
    description: '',
    sortOrder: '0',
    expression: { nodeType: 'empty' }
  };
}

export function createEmptyNodeDraft(): FormulaNodeDraft {
  return { nodeType: 'empty' };
}

export function expressionToDraft(expression: FormulaExpressionNode): FormulaNodeDraft {
  if (expression.nodeType === 'OPERATION') {
    return {
      nodeType: 'OPERATION',
      operation: expression.operation,
      left: expressionToDraft(expression.operands[0]),
      right: expressionToDraft(expression.operands[1])
    };
  }
  if (expression.nodeType === 'PARAMETER') {
    return {
      nodeType: 'PARAMETER',
      parameterKey: expression.parameterKey
    };
  }
  return {
    nodeType: 'ATTRIBUTE',
    attributeOwner: expression.attributeOwner,
    attributeKey: expression.attributeKey,
    attributeValueKind: expression.attributeValueKind
  };
}

export function formulaToDraft(formula: {
  formulaKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  expression: FormulaExpressionNode;
}): SkillFormulaDraft {
  return {
    formulaKey: formula.formulaKey,
    name: formula.name,
    description: formula.description ?? '',
    sortOrder: String(formula.sortOrder),
    expression: expressionToDraft(formula.expression)
  };
}

export function switchNodeType(
  _current: FormulaNodeDraft,
  nextType: FormulaNodeKind
): FormulaNodeDraft {
  if (nextType === 'empty') {
    return { nodeType: 'empty' };
  }
  if (nextType === 'OPERATION') {
    return {
      nodeType: 'OPERATION',
      operation: '',
      left: { nodeType: 'empty' },
      right: { nodeType: 'empty' }
    };
  }
  if (nextType === 'PARAMETER') {
    return { nodeType: 'PARAMETER', parameterKey: '' };
  }
  return {
    nodeType: 'ATTRIBUTE',
    attributeOwner: '',
    attributeKey: '',
    attributeValueKind: ''
  };
}

export function countFormulaNodes(node: FormulaNodeDraft): number {
  if (node.nodeType === 'OPERATION') {
    return 1 + countFormulaNodes(node.left) + countFormulaNodes(node.right);
  }
  return 1;
}

export function measureFormulaDepth(node: FormulaNodeDraft, depth = 1): number {
  if (node.nodeType !== 'OPERATION') {
    return depth;
  }
  return Math.max(
    measureFormulaDepth(node.left, depth + 1),
    measureFormulaDepth(node.right, depth + 1)
  );
}

export function canExpandOperationChild(
  root: FormulaNodeDraft,
  parentPath: string
): { ok: true } | { ok: false; path: string; message: string } {
  const nextCount = countFormulaNodes(root) + 2;
  if (nextCount > MAX_FORMULA_NODES) {
    return {
      ok: false,
      path: parentPath || 'expression',
      message: `公式节点总数不能超过 ${MAX_FORMULA_NODES}。`
    };
  }
  const parentDepth = depthAtPath(root, parentPath);
  if (parentDepth + 1 > MAX_FORMULA_DEPTH) {
    return {
      ok: false,
      path: parentPath || 'expression',
      message: `公式深度不能超过 ${MAX_FORMULA_DEPTH}。`
    };
  }
  return { ok: true };
}

function depthAtPath(node: FormulaNodeDraft, path: string, depth = 1): number {
  if (!path || path === 'expression') {
    return depth;
  }
  const relative = path.startsWith('expression.') ? path.slice('expression.'.length) : path;
  const parts = relative.split('.').filter(Boolean);
  let current: FormulaNodeDraft = node;
  let currentDepth = depth;
  for (const part of parts) {
    if (current.nodeType !== 'OPERATION') {
      return currentDepth;
    }
    if (part === 'operands[0]' || part === 'left') {
      current = current.left;
      currentDepth += 1;
      continue;
    }
    if (part === 'operands[1]' || part === 'right') {
      current = current.right;
      currentDepth += 1;
      continue;
    }
  }
  return currentDepth;
}

export function updateNodeAtPath(
  root: FormulaNodeDraft,
  path: string,
  next: FormulaNodeDraft
): FormulaNodeDraft {
  if (!path || path === 'expression') {
    return next;
  }
  const relative = path.startsWith('expression.') ? path.slice('expression.'.length) : path;
  return updateRelative(root, relative.split('.').filter(Boolean), next);
}

function updateRelative(
  node: FormulaNodeDraft,
  parts: string[],
  next: FormulaNodeDraft
): FormulaNodeDraft {
  if (parts.length === 0) {
    return next;
  }
  if (node.nodeType !== 'OPERATION') {
    return node;
  }
  const [head, ...rest] = parts;
  if (head === 'operands[0]' || head === 'left') {
    return { ...node, left: updateRelative(node.left, rest, next) };
  }
  if (head === 'operands[1]' || head === 'right') {
    return { ...node, right: updateRelative(node.right, rest, next) };
  }
  return node;
}

export function getNodeAtPath(root: FormulaNodeDraft, path: string): FormulaNodeDraft | null {
  if (!path || path === 'expression') {
    return root;
  }
  const relative = path.startsWith('expression.') ? path.slice('expression.'.length) : path;
  let current: FormulaNodeDraft = root;
  for (const part of relative.split('.').filter(Boolean)) {
    if (current.nodeType !== 'OPERATION') {
      return null;
    }
    if (part === 'operands[0]' || part === 'left') {
      current = current.left;
      continue;
    }
    if (part === 'operands[1]' || part === 'right') {
      current = current.right;
      continue;
    }
    return null;
  }
  return current;
}

export function collectReferencedAttributeKeys(node: FormulaNodeDraft): Set<string> {
  const keys = new Set<string>();
  walk(node);
  return keys;

  function walk(current: FormulaNodeDraft): void {
    if (current.nodeType === 'ATTRIBUTE' && current.attributeKey) {
      keys.add(current.attributeKey);
    }
    if (current.nodeType === 'OPERATION') {
      walk(current.left);
      walk(current.right);
    }
  }
}

export function validateFormulaDraft(
  draft: SkillFormulaDraft,
  includeKey: boolean,
  catalog: FormulaPreviewCatalog
): SkillFormulaFormValidation {
  const fieldErrors: SkillFormulaDraftErrors = {};
  const nodeIssues: FormulaNodeIssue[] = [];
  const formulaKey = draft.formulaKey.trim();
  const name = draft.name.trim();
  const description = draft.description.trim();

  if (includeKey) {
    if (!formulaKey) {
      fieldErrors.formulaKey = '稳定标识不能为空。';
    } else if (!FORMULA_KEY_PATTERN.test(formulaKey)) {
      fieldErrors.formulaKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
    }
  }

  if (!name) {
    fieldErrors.name = '公式名称不能为空。';
  } else if (name.length > 100) {
    fieldErrors.name = '公式名称不能超过 100 个字符。';
  }

  if (description.length > 2000) {
    fieldErrors.description = '说明不能超过 2000 个字符。';
  }

  const sortOrderRaw = draft.sortOrder.trim();
  const sortOrder = Number(sortOrderRaw);
  if (!sortOrderRaw) {
    fieldErrors.sortOrder = '排序不能为空。';
  } else if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    fieldErrors.sortOrder = '排序必须是大于等于 0 的整数。';
  }

  const nodeCount = countFormulaNodes(draft.expression);
  if (nodeCount > MAX_FORMULA_NODES) {
    nodeIssues.push({
      path: 'expression',
      message: `公式节点总数不能超过 ${MAX_FORMULA_NODES}。`
    });
  }
  const depth = measureFormulaDepth(draft.expression);
  if (depth > MAX_FORMULA_DEPTH) {
    nodeIssues.push({
      path: 'expression',
      message: `公式深度不能超过 ${MAX_FORMULA_DEPTH}。`
    });
  }

  const built = buildExpressionNode(
    draft.expression,
    'expression',
    catalog,
    nodeIssues
  );

  if (Object.keys(fieldErrors).length > 0 || nodeIssues.length > 0 || !built) {
    if (!built && !fieldErrors.expression && nodeIssues.length === 0) {
      fieldErrors.expression = '公式结构不完整。';
    } else if (!built && nodeIssues.length > 0) {
      fieldErrors.expression = nodeIssues[0]!.message;
    }
    return { ok: false, fieldErrors, nodeIssues };
  }

  return {
    ok: true,
    normalized: {
      formulaKey,
      name,
      description: description || null,
      sortOrder,
      expression: built
    }
  };
}

function buildExpressionNode(
  node: FormulaNodeDraft,
  path: string,
  catalog: FormulaPreviewCatalog,
  issues: FormulaNodeIssue[]
): FormulaExpressionNode | null {
  if (node.nodeType === 'empty') {
    issues.push({ path, message: '请选择节点类型。' });
    return null;
  }

  if (node.nodeType === 'OPERATION') {
    if (!node.operation) {
      issues.push({ path, message: '请选择运算。' });
      return null;
    }
    if (!FORMULA_OPERATIONS.includes(node.operation)) {
      issues.push({ path, message: '运算类型无效。' });
      return null;
    }
    const left = buildExpressionNode(node.left, `${path}.operands[0]`, catalog, issues);
    const right = buildExpressionNode(node.right, `${path}.operands[1]`, catalog, issues);
    if (!left || !right) {
      return null;
    }
    return {
      nodeType: 'OPERATION',
      operation: node.operation,
      operands: [left, right]
    };
  }

  if (node.nodeType === 'PARAMETER') {
    if (!node.parameterKey.trim()) {
      issues.push({ path, message: '请选择技能参数。' });
      return null;
    }
    if (!catalog.parameters.some((item) => item.parameterKey === node.parameterKey)) {
      issues.push({ path, message: `参数不存在：${node.parameterKey}` });
      return null;
    }
    return {
      nodeType: 'PARAMETER',
      parameterKey: node.parameterKey
    };
  }

  if (!node.attributeOwner) {
    issues.push({ path, message: '请选择属性对象。' });
    return null;
  }
  if (!node.attributeKey.trim()) {
    issues.push({ path, message: '请选择属性。' });
    return null;
  }
  if (!node.attributeValueKind) {
    issues.push({ path, message: '请选择属性取值方式。' });
    return null;
  }
  if (!catalog.attributes.some((item) => item.attributeKey === node.attributeKey)) {
    issues.push({ path, message: `属性不存在：${node.attributeKey}` });
    return null;
  }
  return {
    nodeType: 'ATTRIBUTE',
    attributeOwner: node.attributeOwner,
    attributeKey: node.attributeKey,
    attributeValueKind: node.attributeValueKind
  };
}

export function buildCreateFormulaRequest(
  normalized: CreateSkillFormulaRequest
): CreateSkillFormulaRequest {
  return {
    ...normalized,
    expression: cloneExpression(normalized.expression)
  };
}

export function buildUpdateFormulaRequest(
  normalized: CreateSkillFormulaRequest
): UpdateSkillFormulaRequest {
  const { formulaKey: _formulaKey, ...request } = normalized;
  return {
    ...request,
    expression: cloneExpression(request.expression)
  };
}

function cloneExpression(node: FormulaExpressionNode): FormulaExpressionNode {
  if (node.nodeType === 'OPERATION') {
    return {
      nodeType: 'OPERATION',
      operation: node.operation,
      operands: [cloneExpression(node.operands[0]), cloneExpression(node.operands[1])]
    };
  }
  if (node.nodeType === 'PARAMETER') {
    return { nodeType: 'PARAMETER', parameterKey: node.parameterKey };
  }
  return {
    nodeType: 'ATTRIBUTE',
    attributeOwner: node.attributeOwner,
    attributeKey: node.attributeKey,
    attributeValueKind: node.attributeValueKind
  };
}

export function attributeOwnerLabel(owner: FormulaAttributeOwner | ''): string {
  if (owner === 'SOURCE') return '施法者';
  if (owner === 'TARGET') return '目标';
  return '';
}

export function attributeValueKindLabel(kind: FormulaAttributeValueKind | ''): string {
  switch (kind) {
    case 'BASE':
      return '基础值';
    case 'BONUS':
      return '加成值';
    case 'TOTAL':
      return '最终值';
    case 'CURRENT':
      return '当前值';
    case 'MISSING':
      return '已损失值';
    case 'CURRENT_RATIO':
      return '当前值比例';
    case 'MISSING_RATIO':
      return '已损失比例';
    default:
      return '';
  }
}

export function operationLabel(operation: FormulaOperation | ''): string {
  switch (operation) {
    case 'ADD':
      return '加';
    case 'SUBTRACT':
      return '减';
    case 'MULTIPLY':
      return '乘';
    case 'DIVIDE':
      return '除';
    case 'MIN':
      return '取较小值';
    case 'MAX':
      return '取较大值';
    default:
      return '';
  }
}

export function previewFormulaExpression(
  node: FormulaNodeDraft,
  catalog: FormulaPreviewCatalog
): FormulaPreviewSegment[] {
  return previewNode(node, catalog, false);
}

function previewNode(
  node: FormulaNodeDraft,
  catalog: FormulaPreviewCatalog,
  wrap: boolean
): FormulaPreviewSegment[] {
  if (node.nodeType === 'empty') {
    return [{ text: '（空节点）', error: true }];
  }

  if (node.nodeType === 'PARAMETER') {
    if (!node.parameterKey) {
      return [{ text: '（未选参数）', error: true }];
    }
    const parameter = catalog.parameters.find((item) => item.parameterKey === node.parameterKey);
    if (!parameter) {
      return [{ text: node.parameterKey, error: true }];
    }
    return [{ text: parameter.name }];
  }

  if (node.nodeType === 'ATTRIBUTE') {
    if (!node.attributeOwner || !node.attributeKey || !node.attributeValueKind) {
      return [{ text: '（属性不完整）', error: true }];
    }
    const attribute = catalog.attributes.find((item) => item.attributeKey === node.attributeKey);
    const owner = attributeOwnerLabel(node.attributeOwner);
    const kind = attributeValueKindLabel(node.attributeValueKind);
    if (!attribute) {
      return [{ text: `${owner}.${node.attributeKey}.${kind}`, error: true }];
    }
    return [{ text: `${owner}.${attribute.name}.${kind}` }];
  }

  if (!node.operation) {
    return [{ text: '（未选运算）', error: true }];
  }

  const left = previewNode(node.left, catalog, true);
  const right = previewNode(node.right, catalog, true);

  if (node.operation === 'MIN' || node.operation === 'MAX') {
    const label = node.operation === 'MIN' ? '取较小值' : '取较大值';
    return [
      { text: `${label}(` },
      ...left,
      { text: ', ' },
      ...right,
      { text: ')' }
    ];
  }

  const operator = node.operation === 'ADD'
    ? ' + '
    : node.operation === 'SUBTRACT'
      ? ' − '
      : node.operation === 'MULTIPLY'
        ? ' × '
        : ' ÷ ';

  const needsWrap = wrap
    || node.operation === 'SUBTRACT'
    || node.operation === 'DIVIDE';

  const body = [...left, { text: operator }, ...right];
  if (!needsWrap) {
    return body;
  }
  // Root SUBTRACT/DIVIDE still keep order; only wrap when nested (wrap=true).
  if (!wrap) {
    return body;
  }
  return [{ text: '(' }, ...body, { text: ')' }];
}

export function mapFormulaFieldIssues(source: unknown): {
  fieldErrors: SkillFormulaDraftErrors;
  nodeIssues: FormulaNodeIssue[];
  unmappedMessages: string[];
} {
  const fieldErrors: SkillFormulaDraftErrors = {};
  const nodeIssues: FormulaNodeIssue[] = [];
  const unmappedMessages: string[] = [];
  const details = isRecord(source) && 'details' in source
    ? (source as { details?: unknown }).details
    : source;
  if (!isRecord(details) || !Array.isArray(details.fieldIssues)) {
    return { fieldErrors, nodeIssues, unmappedMessages };
  }

  for (const rawIssue of details.fieldIssues) {
    if (!isRecord(rawIssue)) continue;
    const field = typeof rawIssue.field === 'string' ? rawIssue.field : '';
    const message = typeof rawIssue.message === 'string' && rawIssue.message.trim()
      ? rawIssue.message.trim()
      : '字段值不合法。';
    if (
      field === 'formulaKey'
      || field === 'name'
      || field === 'description'
      || field === 'sortOrder'
      || field === 'expression'
    ) {
      fieldErrors[field] = message;
      continue;
    }
    if (field.startsWith('expression')) {
      nodeIssues.push({ path: normalizeFormulaNodePath(field), message });
      continue;
    }
    unmappedMessages.push(message);
  }

  return { fieldErrors, nodeIssues, unmappedMessages };
}

/**
 * Normalize backend field paths like `expression.operands[0].parameterKey`
 * to the owning node path `expression.operands[0]`.
 * Bare node paths stay unchanged; `expression.operands` maps to `expression`.
 */
export function normalizeFormulaNodePath(field: string): string {
  if (!field || field === 'expression') {
    return 'expression';
  }
  const relative = field.startsWith('expression.')
    ? field.slice('expression.'.length)
    : field;
  const kept: string[] = [];
  for (const part of relative.split('.').filter(Boolean)) {
    if (/^operands\[\d+\]$/.test(part)) {
      kept.push(part);
      continue;
    }
    // Leaf node field (parameterKey, attributeKey, operation, operands, …) — stop.
    break;
  }
  return kept.length === 0 ? 'expression' : `expression.${kept.join('.')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
