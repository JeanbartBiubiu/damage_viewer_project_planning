import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import type {
  FormulaAttributeOwner,
  FormulaAttributeValueKind,
  FormulaOperation
} from '../../../types/skillFormula';
import type {
  DamageTypeFormula,
  DamageTypeFormulaDetail,
  DamageTypeFormulaNode,
  DamageTypeFormulaStageKey,
  DamageTypeFormulaStageResultKey
} from '../../../types/damageTypeFormula';
import {
  DAMAGE_TYPE_FORMULA_MAX_DEPTH,
  DAMAGE_TYPE_FORMULA_MAX_NODES,
  DAMAGE_TYPE_FORMULA_NOT_FOUND,
  DAMAGE_TYPE_FORMULA_STAGE_KEYS,
  damageTypeFormulaStageFromResultKey,
  isDamageTypeFormulaStageResultKey,
  isDamageTypeFormulaStageKey,
  priorDamageTypeFormulaStageResults,
  priorDamageTypeFormulaStages
} from '../../../types/damageTypeFormula';

export const FORMULA_SAVE_PENDING_MESSAGE = '保存结果待确认';

const FIXED_VALUE_PATTERN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u;
const OPERATIONS: FormulaOperation[] = ['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'];
const ATTRIBUTE_OWNERS: FormulaAttributeOwner[] = ['SOURCE', 'TARGET'];
const ATTRIBUTE_VALUE_KINDS: FormulaAttributeValueKind[] = [
  'BASE',
  'BONUS',
  'TOTAL',
  'CURRENT',
  'MISSING',
  'CURRENT_RATIO',
  'MISSING_RATIO'
];

export type DamageTypeFormulaNodeKind = 'empty' | 'OPERATION' | 'FIXED' | 'ATTRIBUTE' | 'STAGE_RESULT';

export type DamageTypeFormulaNodeDraft =
  | { nodeType: 'empty' }
  | {
      nodeType: 'OPERATION';
      operation: FormulaOperation | '';
      left: DamageTypeFormulaNodeDraft;
      right: DamageTypeFormulaNodeDraft;
    }
  | { nodeType: 'FIXED'; value: string }
  | {
      nodeType: 'ATTRIBUTE';
      attributeOwner: FormulaAttributeOwner | '';
      attributeKey: string;
      attributeValueKind: FormulaAttributeValueKind | '';
    }
  | { nodeType: 'STAGE_RESULT'; stageKey: DamageTypeFormulaStageResultKey | '' };

export type DamageTypeFormulaDraft = Record<DamageTypeFormulaStageKey, DamageTypeFormulaNodeDraft>;

export type DamageTypeFormulaNodeIssue = {
  path: string;
  message: string;
};

export type DamageTypeFormulaValidation =
  | { ok: true; formula: DamageTypeFormula }
  | { ok: false; nodeIssues: DamageTypeFormulaNodeIssue[] };

export type DamageTypeFormulaAttributeOption = {
  attributeKey: string;
  name: string;
  status: string;
};

export type DamageTypeFormulaAttributeTriple = {
  attributeOwner: FormulaAttributeOwner;
  attributeKey: string;
  attributeValueKind: FormulaAttributeValueKind;
};

export type DamageTypeFormulaPreviewSegment = {
  text: string;
  error?: boolean;
};

export type DamageTypeFormulaChainPreview = {
  stageKey: DamageTypeFormulaStageKey;
  symbol: 'R' | 'P' | 'F' | 'E' | 'M';
  label: string;
  segments: DamageTypeFormulaPreviewSegment[];
};

export type DamageTypeFormulaRequestContext = {
  apiBaseUrl: string;
  gameId: string;
  token: string;
  damageTypeKey: string;
};

export function damageTypeFormulaStageLabel(stage: DamageTypeFormulaStageKey): string {
  switch (stage) {
    case 'resistanceBeforePenetration':
      return '穿透前抗性';
    case 'penetrationPercent':
      return '百分比穿透';
    case 'penetrationFlat':
      return '固定穿透';
    case 'effectiveResistance':
      return '有效抗性';
    case 'resistanceFactor':
      return '抗性系数';
    default:
      return stage;
  }
}

export function damageTypeFormulaStageSymbol(
  stage: DamageTypeFormulaStageKey
): DamageTypeFormulaChainPreview['symbol'] {
  switch (stage) {
    case 'resistanceBeforePenetration':
      return 'R';
    case 'penetrationPercent':
      return 'P';
    case 'penetrationFlat':
      return 'F';
    case 'effectiveResistance':
      return 'E';
    case 'resistanceFactor':
      return 'M';
    default:
      return stage;
  }
}

export function damageTypeFormulaOwnerLabel(owner: FormulaAttributeOwner | ''): string {
  if (owner === 'SOURCE') return '来源';
  if (owner === 'TARGET') return '目标';
  return '';
}

export function damageTypeFormulaValueKindLabel(kind: FormulaAttributeValueKind | ''): string {
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

export function damageTypeFormulaOperationLabel(operation: FormulaOperation | ''): string {
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

export function createBlankDamageTypeFormulaDraft(): DamageTypeFormulaDraft {
  return {
    resistanceBeforePenetration: { nodeType: 'empty' },
    penetrationPercent: { nodeType: 'empty' },
    penetrationFlat: { nodeType: 'empty' },
    effectiveResistance: { nodeType: 'empty' },
    resistanceFactor: { nodeType: 'empty' }
  };
}

export function switchDamageTypeFormulaNode(nextType: DamageTypeFormulaNodeKind): DamageTypeFormulaNodeDraft {
  if (nextType === 'empty') return { nodeType: 'empty' };
  if (nextType === 'OPERATION') {
    return {
      nodeType: 'OPERATION',
      operation: '',
      left: { nodeType: 'empty' },
      right: { nodeType: 'empty' }
    };
  }
  if (nextType === 'FIXED') return { nodeType: 'FIXED', value: '' };
  if (nextType === 'ATTRIBUTE') {
    return {
      nodeType: 'ATTRIBUTE',
      attributeOwner: '',
      attributeKey: '',
      attributeValueKind: ''
    };
  }
  return { nodeType: 'STAGE_RESULT', stageKey: '' };
}

function nodeToDraft(node: DamageTypeFormulaNode): DamageTypeFormulaNodeDraft {
  if (node.nodeType === 'OPERATION') {
    return {
      nodeType: 'OPERATION',
      operation: node.operation,
      left: nodeToDraft(node.operands[0]),
      right: nodeToDraft(node.operands[1])
    };
  }
  if (node.nodeType === 'FIXED') return { nodeType: 'FIXED', value: String(node.value) };
  if (node.nodeType === 'STAGE_RESULT') return { nodeType: 'STAGE_RESULT', stageKey: node.stageKey };
  return {
    nodeType: 'ATTRIBUTE',
    attributeOwner: node.attributeOwner,
    attributeKey: node.attributeKey,
    attributeValueKind: node.attributeValueKind
  };
}

export function formulaToDraft(formula: DamageTypeFormula): DamageTypeFormulaDraft {
  return {
    resistanceBeforePenetration: nodeToDraft(formula.resistanceBeforePenetration),
    penetrationPercent: nodeToDraft(formula.penetrationPercent),
    penetrationFlat: nodeToDraft(formula.penetrationFlat),
    effectiveResistance: nodeToDraft(formula.effectiveResistance),
    resistanceFactor: nodeToDraft(formula.resistanceFactor)
  };
}

export function formulaStageViews(draft: DamageTypeFormulaDraft): Array<{
  stageKey: DamageTypeFormulaStageKey;
  label: string;
  path: string;
  priorStageKeys: DamageTypeFormulaStageKey[];
  node: DamageTypeFormulaNodeDraft;
}> {
  return DAMAGE_TYPE_FORMULA_STAGE_KEYS.map((stageKey) => ({
    stageKey,
    label: damageTypeFormulaStageLabel(stageKey),
    path: `formula.${stageKey}`,
    priorStageKeys: priorDamageTypeFormulaStages(stageKey),
    node: draft[stageKey]
  }));
}

export function stageResultOptions(stage: DamageTypeFormulaStageKey): Array<{
  value: DamageTypeFormulaStageResultKey;
  label: string;
}> {
  return priorDamageTypeFormulaStageResults(stage).map((value) => ({
    value,
    label: damageTypeFormulaStageLabel(damageTypeFormulaStageFromResultKey(value))
  }));
}

function stageFromPath(path: string): DamageTypeFormulaStageKey | null {
  const match = /^formula\.([^.]+)/.exec(path);
  const stage = match?.[1];
  return isDamageTypeFormulaStageKey(stage) ? stage : null;
}

function relativeToStage(stage: DamageTypeFormulaStageKey, path: string): string {
  const prefix = `formula.${stage}`;
  if (path === prefix) return '';
  if (path.startsWith(`${prefix}.`)) return path.slice(prefix.length + 1);
  return '';
}

function childAt(node: DamageTypeFormulaNodeDraft, part: string): DamageTypeFormulaNodeDraft | null {
  if (node.nodeType !== 'OPERATION') return null;
  if (part === 'operands[0]' || part === 'left') return node.left;
  if (part === 'operands[1]' || part === 'right') return node.right;
  return null;
}

export function getDamageTypeFormulaNodeAtPath(
  draft: DamageTypeFormulaDraft,
  path: string
): DamageTypeFormulaNodeDraft | null {
  const stage = stageFromPath(path);
  if (!stage) return null;
  const relative = relativeToStage(stage, path);
  let current = draft[stage];
  if (!relative) return current;
  for (const part of relative.split('.').filter(Boolean)) {
    const next = childAt(current, part);
    if (!next) return null;
    current = next;
  }
  return current;
}

function updateRelative(
  node: DamageTypeFormulaNodeDraft,
  parts: string[],
  next: DamageTypeFormulaNodeDraft
): DamageTypeFormulaNodeDraft {
  if (parts.length === 0) return next;
  if (node.nodeType !== 'OPERATION') return node;
  const [head, ...rest] = parts;
  if (head === 'operands[0]' || head === 'left') {
    return { ...node, left: updateRelative(node.left, rest, next) };
  }
  if (head === 'operands[1]' || head === 'right') {
    return { ...node, right: updateRelative(node.right, rest, next) };
  }
  return node;
}

export function updateFormulaDraftAtPath(
  draft: DamageTypeFormulaDraft,
  path: string,
  next: DamageTypeFormulaNodeDraft
): DamageTypeFormulaDraft {
  const stage = stageFromPath(path);
  if (!stage) return draft;
  const relative = relativeToStage(stage, path);
  return {
    ...draft,
    [stage]: relative
      ? updateRelative(draft[stage], relative.split('.').filter(Boolean), next)
      : next
  };
}

export function countDamageTypeFormulaNodes(node: DamageTypeFormulaNodeDraft): number {
  if (node.nodeType === 'OPERATION') {
    return 1 + countDamageTypeFormulaNodes(node.left) + countDamageTypeFormulaNodes(node.right);
  }
  return 1;
}

export function measureDamageTypeFormulaDepth(node: DamageTypeFormulaNodeDraft, depth = 1): number {
  if (node.nodeType !== 'OPERATION') return depth;
  return Math.max(
    measureDamageTypeFormulaDepth(node.left, depth + 1),
    measureDamageTypeFormulaDepth(node.right, depth + 1)
  );
}

function depthAtPath(node: DamageTypeFormulaNodeDraft, relative: string, depth = 1): number {
  if (!relative) return depth;
  let current = node;
  let currentDepth = depth;
  for (const part of relative.split('.').filter(Boolean)) {
    const next = childAt(current, part);
    if (!next) return currentDepth;
    current = next;
    currentDepth += 1;
  }
  return currentDepth;
}

export function canExpandDamageTypeFormulaOperation(
  stage: DamageTypeFormulaStageKey,
  root: DamageTypeFormulaNodeDraft,
  path: string
): { ok: true } | { ok: false; path: string; message: string } {
  const nextCount = countDamageTypeFormulaNodes(root) + 2;
  if (nextCount > DAMAGE_TYPE_FORMULA_MAX_NODES) {
    return {
      ok: false,
      path,
      message: `公式节点总数不能超过 ${DAMAGE_TYPE_FORMULA_MAX_NODES}。`
    };
  }
  const parentDepth = depthAtPath(root, relativeToStage(stage, path));
  if (parentDepth + 1 > DAMAGE_TYPE_FORMULA_MAX_DEPTH) {
    return {
      ok: false,
      path,
      message: `公式深度不能超过 ${DAMAGE_TYPE_FORMULA_MAX_DEPTH}。`
    };
  }
  return { ok: true };
}

function isOwner(value: string): value is FormulaAttributeOwner {
  return ATTRIBUTE_OWNERS.some((owner) => owner === value);
}

function isValueKind(value: string): value is FormulaAttributeValueKind {
  return ATTRIBUTE_VALUE_KINDS.some((kind) => kind === value);
}

function isOperation(value: string): value is FormulaOperation {
  return OPERATIONS.some((operation) => operation === value);
}

function triplesEqual(
  left: DamageTypeFormulaAttributeTriple,
  right: DamageTypeFormulaAttributeTriple
): boolean {
  return left.attributeOwner === right.attributeOwner
    && left.attributeKey === right.attributeKey
    && left.attributeValueKind === right.attributeValueKind;
}

export function retainedDisabledAttributeTriples(
  draft: DamageTypeFormulaDraft,
  attributes: readonly DamageTypeFormulaAttributeOption[]
): DamageTypeFormulaAttributeTriple[] {
  const triples: DamageTypeFormulaAttributeTriple[] = [];
  for (const stage of DAMAGE_TYPE_FORMULA_STAGE_KEYS) walk(draft[stage]);
  return triples;

  function walk(node: DamageTypeFormulaNodeDraft): void {
    if (node.nodeType === 'OPERATION') {
      walk(node.left);
      walk(node.right);
      return;
    }
    if (node.nodeType !== 'ATTRIBUTE' || !node.attributeOwner || !node.attributeKey || !node.attributeValueKind) {
      return;
    }
    if (!isOwner(node.attributeOwner) || !isValueKind(node.attributeValueKind)) return;
    const attribute = attributes.find((item) => item.attributeKey === node.attributeKey);
    if (attribute?.status !== 'DISABLED') return;
    const triple = {
      attributeOwner: node.attributeOwner,
      attributeKey: node.attributeKey,
      attributeValueKind: node.attributeValueKind
    };
    if (!triples.some((item) => triplesEqual(item, triple))) triples.push(triple);
  }
}

export function selectableAttributeOptions(
  attributes: readonly DamageTypeFormulaAttributeOption[],
  retained: readonly DamageTypeFormulaAttributeTriple[],
  node: DamageTypeFormulaNodeDraft
): Array<{ attributeKey: string; label: string }> {
  const options: Array<{ attributeKey: string; label: string }> = [];
  const seen = new Set<string>();
  for (const attribute of attributes) {
    if (attribute.status !== 'ENABLED' || seen.has(attribute.attributeKey)) continue;
    seen.add(attribute.attributeKey);
    options.push({
      attributeKey: attribute.attributeKey,
      label: `${attribute.name}（${attribute.attributeKey}）`
    });
  }
  if (node.nodeType !== 'ATTRIBUTE' || !node.attributeKey || seen.has(node.attributeKey)) return options;
  const attribute = attributes.find((item) => item.attributeKey === node.attributeKey);
  const retainedMatch = isOwner(node.attributeOwner)
    && isValueKind(node.attributeValueKind)
    && retained.some((item) => triplesEqual(item, {
      attributeOwner: node.attributeOwner as FormulaAttributeOwner,
      attributeKey: node.attributeKey,
      attributeValueKind: node.attributeValueKind as FormulaAttributeValueKind
    }));
  if (attribute?.status === 'DISABLED' && retainedMatch) {
    options.push({
      attributeKey: node.attributeKey,
      label: `${attribute.name}（${node.attributeKey}）已停用`
    });
  } else if (!attribute) {
    options.push({
      attributeKey: node.attributeKey,
      label: `${node.attributeKey}（目录中不存在）`
    });
  }
  return options;
}

function parseFixedValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (!FIXED_VALUE_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function buildNode(
  node: DamageTypeFormulaNodeDraft,
  stage: DamageTypeFormulaStageKey,
  path: string,
  attributes: readonly DamageTypeFormulaAttributeOption[],
  retained: readonly DamageTypeFormulaAttributeTriple[],
  issues: DamageTypeFormulaNodeIssue[]
): DamageTypeFormulaNode | null {
  if (node.nodeType === 'empty') {
    issues.push({ path, message: '请选择节点类型。' });
    return null;
  }
  if (node.nodeType === 'OPERATION') {
    const operationReady = isOperation(node.operation);
    if (!operationReady) {
      issues.push({ path, message: node.operation ? '运算类型无效。' : '请选择运算。' });
    }
    const left = buildNode(node.left, stage, `${path}.operands[0]`, attributes, retained, issues);
    const right = buildNode(node.right, stage, `${path}.operands[1]`, attributes, retained, issues);
    if (!operationReady || !left || !right) return null;
    return { nodeType: 'OPERATION', operation: node.operation as FormulaOperation, operands: [left, right] };
  }
  if (node.nodeType === 'FIXED') {
    if (!node.value.trim()) {
      issues.push({ path, message: '请填写固定值。' });
      return null;
    }
    const value = parseFixedValue(node.value);
    if (value === null) {
      issues.push({ path, message: '固定值必须是有限数字。' });
      return null;
    }
    return { nodeType: 'FIXED', value };
  }
  if (node.nodeType === 'ATTRIBUTE') {
    if (!isOwner(node.attributeOwner)) {
      issues.push({ path, message: node.attributeOwner ? '属性对象无效。' : '请选择属性对象。' });
      return null;
    }
    if (!node.attributeKey.trim()) {
      issues.push({ path, message: '请选择属性。' });
      return null;
    }
    if (!isValueKind(node.attributeValueKind)) {
      issues.push({ path, message: node.attributeValueKind ? '属性取值方式无效。' : '请选择属性取值方式。' });
      return null;
    }
    const attribute = attributes.find((item) => item.attributeKey === node.attributeKey);
    if (!attribute) {
      issues.push({ path, message: `属性不存在：${node.attributeKey}` });
      return null;
    }
    const triple: DamageTypeFormulaAttributeTriple = {
      attributeOwner: node.attributeOwner,
      attributeKey: node.attributeKey,
      attributeValueKind: node.attributeValueKind
    };
    if (attribute.status !== 'ENABLED' && !retained.some((item) => triplesEqual(item, triple))) {
      issues.push({
        path,
        message: attribute.status === 'DISABLED' ? '已停用的属性不能用于新的选择。' : '属性不可用。'
      });
      return null;
    }
    return { nodeType: 'ATTRIBUTE', ...triple };
  }
  if (node.nodeType === 'STAGE_RESULT') {
    const prior = priorDamageTypeFormulaStageResults(stage);
    if (prior.length === 0) {
      issues.push({ path, message: '当前阶段没有可引用的前序结果。' });
      return null;
    }
    if (!node.stageKey) {
      issues.push({ path, message: '请选择前序结果。' });
      return null;
    }
    if (!isDamageTypeFormulaStageResultKey(node.stageKey) || !prior.includes(node.stageKey)) {
      issues.push({ path, message: '只能引用更早的阶段结果。' });
      return null;
    }
    return { nodeType: 'STAGE_RESULT', stageKey: node.stageKey };
  }
  issues.push({ path, message: '节点类型无效。' });
  return null;
}

export function validateDamageTypeFormulaDraft(
  draft: DamageTypeFormulaDraft,
  attributes: readonly DamageTypeFormulaAttributeOption[],
  retained: readonly DamageTypeFormulaAttributeTriple[]
): DamageTypeFormulaValidation {
  const issues: DamageTypeFormulaNodeIssue[] = [];
  const formula = {} as DamageTypeFormula;
  for (const stage of DAMAGE_TYPE_FORMULA_STAGE_KEYS) {
    const path = `formula.${stage}`;
    const node = draft[stage];
    if (countDamageTypeFormulaNodes(node) > DAMAGE_TYPE_FORMULA_MAX_NODES) {
      issues.push({ path, message: `公式节点总数不能超过 ${DAMAGE_TYPE_FORMULA_MAX_NODES}。` });
    }
    if (measureDamageTypeFormulaDepth(node) > DAMAGE_TYPE_FORMULA_MAX_DEPTH) {
      issues.push({ path, message: `公式深度不能超过 ${DAMAGE_TYPE_FORMULA_MAX_DEPTH}。` });
    }
    const built = buildNode(node, stage, path, attributes, retained, issues);
    if (built) formula[stage] = built;
  }
  if (issues.length > 0 || DAMAGE_TYPE_FORMULA_STAGE_KEYS.some((stage) => !formula[stage])) {
    if (issues.length === 0) issues.push({ path: 'formula', message: '结算公式不完整。' });
    return { ok: false, nodeIssues: issues };
  }
  return { ok: true, formula };
}

function previewNode(
  node: DamageTypeFormulaNodeDraft,
  stage: DamageTypeFormulaStageKey,
  catalog: readonly DamageTypeFormulaAttributeOption[],
  retained: readonly DamageTypeFormulaAttributeTriple[],
  wrap: boolean,
  stageReferenceStyle: 'label' | 'symbol'
): DamageTypeFormulaPreviewSegment[] {
  if (node.nodeType === 'empty') return [{ text: '（空节点）', error: true }];
  if (node.nodeType === 'FIXED') {
    if (!node.value.trim()) return [{ text: '（未填固定值）', error: true }];
    if (parseFixedValue(node.value) === null) return [{ text: node.value.trim(), error: true }];
    return [{ text: node.value.trim() }];
  }
  if (node.nodeType === 'STAGE_RESULT') {
    if (!node.stageKey) return [{ text: '（未选前序结果）', error: true }];
    const prior = priorDamageTypeFormulaStageResults(stage);
    if (!isDamageTypeFormulaStageResultKey(node.stageKey) || !prior.includes(node.stageKey)) {
      return [{ text: node.stageKey, error: true }];
    }
    const referencedStage = damageTypeFormulaStageFromResultKey(node.stageKey);
    const label = damageTypeFormulaStageLabel(referencedStage);
    return [{
      text: stageReferenceStyle === 'symbol'
        ? `${damageTypeFormulaStageSymbol(referencedStage)}（${label}）`
        : label
    }];
  }
  if (node.nodeType === 'ATTRIBUTE') {
    if (!node.attributeOwner || !node.attributeKey || !node.attributeValueKind) {
      return [{ text: '（属性不完整）', error: true }];
    }
    const owner = damageTypeFormulaOwnerLabel(node.attributeOwner) || node.attributeOwner;
    const kind = damageTypeFormulaValueKindLabel(node.attributeValueKind) || node.attributeValueKind;
    const attribute = catalog.find((item) => item.attributeKey === node.attributeKey);
    const tripleReady = isOwner(node.attributeOwner) && isValueKind(node.attributeValueKind);
    const retainedMatch = tripleReady && retained.some((item) => triplesEqual(item, {
      attributeOwner: node.attributeOwner as FormulaAttributeOwner,
      attributeKey: node.attributeKey,
      attributeValueKind: node.attributeValueKind as FormulaAttributeValueKind
    }));
    if (!attribute || (attribute.status !== 'ENABLED' && !retainedMatch)) {
      return [{ text: `${owner}.${attribute?.name ?? node.attributeKey}.${kind}`, error: true }];
    }
    return [{ text: `${owner}.${attribute.name}.${kind}` }];
  }
  if (!isOperation(node.operation)) return [{ text: '（未选运算）', error: true }];
  const left = previewNode(node.left, stage, catalog, retained, true, stageReferenceStyle);
  const right = previewNode(node.right, stage, catalog, retained, true, stageReferenceStyle);
  if (node.operation === 'MIN' || node.operation === 'MAX') {
    const label = node.operation === 'MIN' ? '取较小值' : '取较大值';
    return [{ text: `${label}(` }, ...left, { text: ', ' }, ...right, { text: ')' }];
  }
  const operator = node.operation === 'ADD'
    ? ' + '
    : node.operation === 'SUBTRACT'
      ? ' − '
      : node.operation === 'MULTIPLY'
        ? ' × '
        : ' ÷ ';
  const body = [...left, { text: operator }, ...right];
  const needsWrap = wrap || node.operation === 'SUBTRACT' || node.operation === 'DIVIDE';
  if (!needsWrap || !wrap) return body;
  return [{ text: '(' }, ...body, { text: ')' }];
}

export function previewDamageTypeFormulaStage(
  node: DamageTypeFormulaNodeDraft,
  stage: DamageTypeFormulaStageKey,
  catalog: readonly DamageTypeFormulaAttributeOption[],
  retained: readonly DamageTypeFormulaAttributeTriple[] = []
): DamageTypeFormulaPreviewSegment[] {
  return previewNode(node, stage, catalog, retained, false, 'label');
}

export function previewDamageTypeFormulaChain(
  draft: DamageTypeFormulaDraft,
  catalog: readonly DamageTypeFormulaAttributeOption[],
  retained: readonly DamageTypeFormulaAttributeTriple[] = []
): DamageTypeFormulaChainPreview[] {
  return DAMAGE_TYPE_FORMULA_STAGE_KEYS.map((stageKey) => ({
    stageKey,
    symbol: damageTypeFormulaStageSymbol(stageKey),
    label: damageTypeFormulaStageLabel(stageKey),
    segments: previewNode(draft[stageKey], stageKey, catalog, retained, false, 'symbol')
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeDamageTypeFormulaFieldPath(field: string): string | null {
  if (!field.startsWith('formula.')) return null;
  const parts = field.slice('formula.'.length).split('.').filter(Boolean);
  const stage = parts[0];
  if (!isDamageTypeFormulaStageKey(stage)) return null;
  const kept: string[] = [stage];
  for (const part of parts.slice(1)) {
    if (/^operands\[\d+\]$/.test(part)) {
      if (part !== 'operands[0]' && part !== 'operands[1]') return null;
      kept.push(part);
      continue;
    }
    break;
  }
  return `formula.${kept.join('.')}`;
}

export function mapDamageTypeFormulaFieldIssues(source: unknown): {
  nodeIssues: DamageTypeFormulaNodeIssue[];
  unmappedMessages: string[];
} {
  const nodeIssues: DamageTypeFormulaNodeIssue[] = [];
  const unmappedMessages: string[] = [];
  const details = isRecord(source) && 'details' in source ? source.details : source;
  if (!isRecord(details) || !Array.isArray(details.fieldIssues)) {
    return { nodeIssues, unmappedMessages };
  }
  for (const rawIssue of details.fieldIssues) {
    if (!isRecord(rawIssue)) {
      unmappedMessages.push('字段值不合法。');
      continue;
    }
    const message = typeof rawIssue.message === 'string' && rawIssue.message.trim()
      ? rawIssue.message.trim()
      : '字段值不合法。';
    const field = typeof rawIssue.field === 'string' ? rawIssue.field : '';
    const path = field ? normalizeDamageTypeFormulaFieldPath(field) : null;
    if (!path) {
      unmappedMessages.push(field ? `${field}：${message}` : message);
      continue;
    }
    nodeIssues.push({ path, message });
  }
  return { nodeIssues, unmappedMessages };
}

export function partitionFormulaNodeIssues(
  draft: DamageTypeFormulaDraft,
  issues: readonly DamageTypeFormulaNodeIssue[]
): { placed: DamageTypeFormulaNodeIssue[]; unplaced: DamageTypeFormulaNodeIssue[] } {
  const placed: DamageTypeFormulaNodeIssue[] = [];
  const unplaced: DamageTypeFormulaNodeIssue[] = [];
  for (const issue of issues) {
    if (getDamageTypeFormulaNodeAtPath(draft, issue.path)) placed.push(issue);
    else unplaced.push(issue);
  }
  return { placed, unplaced };
}

export function visibleFormulaIssueMessages(
  draft: DamageTypeFormulaDraft,
  mapped: { nodeIssues: readonly DamageTypeFormulaNodeIssue[]; unmappedMessages: readonly string[] }
): string[] {
  const { unplaced } = partitionFormulaNodeIssues(draft, mapped.nodeIssues);
  return [...mapped.unmappedMessages, ...unplaced.map((issue) => issue.message)];
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
  }
  return value;
}

export function damageTypeFormulasEqual(left: DamageTypeFormula, right: DamageTypeFormula): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function resolveFormulaLoad(
  outcome: { ok: true; detail: DamageTypeFormulaDetail } | { ok: false; error: unknown }
):
  | { kind: 'ready'; draft: DamageTypeFormulaDraft; persisted: boolean }
  | { kind: 'error'; message: string } {
  if (!outcome.ok) {
    if (outcome.error instanceof ApiRequestError
      && outcome.error.status === 404
      && outcome.error.code === DAMAGE_TYPE_FORMULA_NOT_FOUND) {
      return { kind: 'ready', draft: createBlankDamageTypeFormulaDraft(), persisted: false };
    }
    return { kind: 'error', message: getErrorMessage(outcome.error) };
  }
  return { kind: 'ready', draft: formulaToDraft(outcome.detail.formula), persisted: true };
}

export function isSameFormulaContext(
  request: DamageTypeFormulaRequestContext,
  current: DamageTypeFormulaRequestContext
): boolean {
  return request.apiBaseUrl === current.apiBaseUrl
    && request.gameId === current.gameId
    && request.token === current.token
    && request.damageTypeKey === current.damageTypeKey;
}

export function resolveFormulaCloseAttempt(dirty: boolean, confirmedDiscard: boolean): 'close' | 'keep' {
  if (!dirty) return 'close';
  return confirmedDiscard ? 'close' : 'keep';
}

export function decideFormulaSaveReadback(
  submitted: DamageTypeFormula,
  readback: { ok: true; formula: DamageTypeFormula } | { ok: false }
): { close: boolean; resendPut: false; message: string | null } {
  if (readback.ok && damageTypeFormulasEqual(submitted, readback.formula)) {
    return { close: true, resendPut: false, message: null };
  }
  return { close: false, resendPut: false, message: FORMULA_SAVE_PENDING_MESSAGE };
}

export function applyFormulaReadbackResult<TDraft>(
  draft: TDraft,
  submitted: DamageTypeFormula,
  readback: { ok: true; formula: DamageTypeFormula } | { ok: false }
): { draft: TDraft; close: boolean; resendPut: false; message: string | null } {
  return { draft, ...decideFormulaSaveReadback(submitted, readback) };
}

export function canSubmitDamageTypeFormula(input: {
  readOnly: boolean;
  catalogReady: boolean;
  pending: boolean;
  saving: boolean;
  ready: boolean;
}): boolean {
  return input.ready && !input.readOnly && input.catalogReady && !input.pending && !input.saving;
}

export function restoreScrollTop(target: { scrollTop: number } | null, scrollTop: number): void {
  if (!target) return;
  target.scrollTop = scrollTop;
}
