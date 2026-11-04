import { COMMON_FORMULA_OPERATIONS, commonFormulaOperationLabel, commonFormulaNode, type CommonFormulaOperation, type CommonFormulaNodeDraft } from '../common-formula/commonFormulaForm';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import { validateFormulaDefinition } from '../../../services/formulaContract';
import { FORMULA_SCHEMA } from '../../../types/formulaContract.generated';
import type { DamageTypeFormula, DamageTypeFormulaDetail } from '../../../types/damageTypeFormula';
import { DAMAGE_TYPE_FORMULA_NOT_FOUND, damageTypeFormulaAllowedBindings } from '../../../types/damageTypeFormula';

export const FORMULA_SAVE_PENDING_MESSAGE = '保存结果待确认';
export type DamageTypeFormulaOperation = CommonFormulaOperation;
export const DAMAGE_TYPE_FORMULA_OPERATIONS = COMMON_FORMULA_OPERATIONS;
export type DamageTypeFormulaNodeKind = CommonFormulaNodeDraft['op'];
export type DamageTypeFormulaNodeDraft = CommonFormulaNodeDraft;
export type DamageTypeFormulaInputDraft = {
  key: string;
  binding: { kind: 'attribute'; object: 'source' | 'target' | ''; attributeKey: string;
    valueKind: 'BASE' | 'BONUS' | 'TOTAL' | ''; view: 'current_frame' };
};
export type DamageTypeFormulaDraft = {
  inputs: DamageTypeFormulaInputDraft[];
  stages: Array<{ key: string; name: string; expression: DamageTypeFormulaNodeDraft }>;
  outputStageKey: string;
};
export type DamageTypeFormulaNodeIssue = { path: string; message: string };
export type DamageTypeFormulaValidation =
  | { ok: true; formula: DamageTypeFormula }
  | { ok: false; nodeIssues: DamageTypeFormulaNodeIssue[] };
export type DamageTypeFormulaAttributeOption = { attributeKey: string; name: string; status: string };
export type DamageTypeFormulaRequestContext = { apiBaseUrl: string; gameId: string; damageTypeKey: string };

export function damageTypeFormulaOperationLabel(operation: DamageTypeFormulaOperation): string {
  return commonFormulaOperationLabel(operation);
}
export function damageTypeFormulaOwnerLabel(owner: string): string {
  return owner === 'source' ? '来源' : owner === 'target' ? '目标' : '未选对象';
}
export function damageTypeFormulaValueKindLabel(kind: string): string {
  return kind === 'BASE' ? '基础值' : kind === 'BONUS' ? '加成值' : kind === 'TOTAL' ? '最终值' : '未选口径';
}
export function createBlankDamageTypeFormulaDraft(): DamageTypeFormulaDraft {
  return { inputs: [], stages: [], outputStageKey: '' };
}
export function createDamageTypeFormulaInputDraft(): DamageTypeFormulaInputDraft {
  return { key: '', binding: { kind: 'attribute', object: '', attributeKey: '', valueKind: '', view: 'current_frame' } };
}
export function formulaOperationArity(operation: DamageTypeFormulaOperation): number {
  if (operation === 'if' || operation === 'clamp') return 3;
  if (operation === 'floor' || operation === 'ceil' || operation === 'trunc' || operation === 'round') return 1;
  return 2;
}
export function switchDamageTypeFormulaNode(op: DamageTypeFormulaNodeKind): DamageTypeFormulaNodeDraft { return commonFormulaNode(op); }
export function formulaToDraft(formula: DamageTypeFormula): DamageTypeFormulaDraft {
  return structuredClone(formula) as DamageTypeFormulaDraft;
}
export function selectableAttributeOptions(attributes: readonly DamageTypeFormulaAttributeOption[], selectedKey: string) {
  const enabled = attributes.filter(attribute => attribute.status === 'ENABLED')
    .map(attribute => ({ value: attribute.attributeKey, label: `${attribute.name}（${attribute.attributeKey}）` }));
  if (selectedKey && !enabled.some(attribute => attribute.value === selectedKey)) {
    const stored = attributes.find(attribute => attribute.attributeKey === selectedKey);
    enabled.push({ value: selectedKey, label: stored ? `${stored.name}（${selectedKey}）已停用，请修复` : `${selectedKey}（目录中不存在，请修复）` });
  }
  return enabled;
}

function expressionAtPath(draft: DamageTypeFormulaDraft, path: string): DamageTypeFormulaNodeDraft | null {
  const match = /^\/formula\/stages\/(\d+)\/expression((?:\/args\/\d+)*)$/.exec(path);
  if (!match) return null;
  let node = draft.stages[Number(match[1])]?.expression;
  if (!node) return null;
  const indexes = [...match[2]!.matchAll(/\/args\/(\d+)/g)].map(part => Number(part[1]));
  for (const index of indexes) {
    if (!('args' in node)) return null;
    node = node.args[index];
    if (!node) return null;
  }
  return node;
}
export function getDamageTypeFormulaNodeAtPath(draft: DamageTypeFormulaDraft, path: string) {
  return expressionAtPath(draft, path);
}
export function updateFormulaDraftAtPath(draft: DamageTypeFormulaDraft, path: string, next: DamageTypeFormulaNodeDraft): DamageTypeFormulaDraft {
  const match = /^\/formula\/stages\/(\d+)\/expression((?:\/args\/\d+)*)$/.exec(path);
  if (!match || !expressionAtPath(draft, path)) return draft;
  const stageIndex = Number(match[1]);
  const indexes = [...match[2]!.matchAll(/\/args\/(\d+)/g)].map(part => Number(part[1]));
  function update(node: DamageTypeFormulaNodeDraft, remaining: number[]): DamageTypeFormulaNodeDraft {
    if (!remaining.length) return next;
    if (!('args' in node)) return node;
    const [head, ...tail] = remaining;
    return { ...node, args: node.args.map((child, index) => index === head ? update(child, tail) : child) };
  }
  return { ...draft, stages: draft.stages.map((stage, index) => index === stageIndex
    ? { ...stage, expression: update(stage.expression, indexes) } : stage) };
}
export function countDamageTypeFormulaNodes(node: DamageTypeFormulaNodeDraft): number {
  return 1 + ('args' in node ? node.args.reduce((sum, child) => sum + countDamageTypeFormulaNodes(child), 0) : 0);
}
export function measureDamageTypeFormulaDepth(node: DamageTypeFormulaNodeDraft): number {
  return 1 + ('args' in node ? Math.max(0, ...node.args.map(measureDamageTypeFormulaDepth)) : 0);
}
export function canReplaceDamageTypeFormulaNode(draft: DamageTypeFormulaDraft, path: string, next: DamageTypeFormulaNodeDraft) {
  const updated = updateFormulaDraftAtPath(draft, path, next);
  const limits = FORMULA_SCHEMA['x-limits'];
  if (updated.stages.reduce((sum, stage) => sum + countDamageTypeFormulaNodes(stage.expression), 0) > limits.maxNodes) {
    return { ok: false as const, path, message: `整份公式节点不能超过 ${limits.maxNodes} 个。` };
  }
  if (updated.stages.some(stage => measureDamageTypeFormulaDepth(stage.expression) > limits.maxDepth)) {
    return { ok: false as const, path, message: `公式深度不能超过 ${limits.maxDepth} 层。` };
  }
  return { ok: true as const };
}
const ISSUE_MESSAGES: Record<string, string> = {
  FORMULA_INVALID_STRUCTURE: '字段不完整或格式不合法。', FORMULA_INVALID_DECIMAL: '常量必须是可表示的有限十进制数。',
  FORMULA_DUPLICATE_KEY: '标识重复，请使用不同标识。', FORMULA_UNKNOWN_INPUT: '引用的输入不存在。',
  FORMULA_UNKNOWN_STAGE: '引用的结果不存在。', FORMULA_UNKNOWN_BINDING: '输入须选择当前游戏启用属性、来源或目标、当前帧及基础／加成／最终值。',
  FORMULA_CYCLE: '结果引用形成循环，请修复。', FORMULA_LIMIT: '公式超过共同节点、指令或深度限制。'
};
export function validateDamageTypeFormulaDraft(draft: DamageTypeFormulaDraft, attributes: readonly DamageTypeFormulaAttributeOption[]): DamageTypeFormulaValidation {
  const problem = validateFormulaDefinition(draft, damageTypeFormulaAllowedBindings(attributes));
  if (problem) return { ok: false, nodeIssues: [{ path: normalizeDamageTypeFormulaFieldPath(`/formula${problem.path}`) ?? '/formula',
    message: `${ISSUE_MESSAGES[problem.code]}（${problem.code}）` }] };
  return { ok: true, formula: structuredClone(draft) as DamageTypeFormula };
}
/** 只展示作者表达式，不展开引用，不求运行数值。 */
export function previewDamageTypeFormulaStage(node: DamageTypeFormulaNodeDraft, draft: DamageTypeFormulaDraft): string {
  if (node.op === 'empty') return '（空节点）';
  if (node.op === 'const') return node.value || '（未填常量）';
  if (node.op === 'read') {
    const input = draft.inputs.find(input => input.key === node.inputKey);
    return input ? `${input.key}（${damageTypeFormulaOwnerLabel(input.binding.object)}.${input.binding.attributeKey}.${damageTypeFormulaValueKindLabel(input.binding.valueKind)}）`
      : `（输入 ${node.inputKey || '未选择'}）`;
  }
  if (node.op === 'ref') {
    const stage = draft.stages.find(stage => stage.key === node.stageKey);
    return stage ? `${stage.name}（${stage.key}）` : `（结果 ${node.stageKey || '未选择'}）`;
  }
  return `${damageTypeFormulaOperationLabel(node.op)}(${node.args.map(argument => previewDamageTypeFormulaStage(argument, draft)).join('，')}${node.op === 'round' ? `；小数位 ${node.decimals ?? '未填'}` : ''})`;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function normalizeDamageTypeFormulaFieldPath(field: string): string | null {
  let pointer = field;
  if (pointer.startsWith('inputs/') || pointer.startsWith('stages/') || pointer === 'outputStageKey') pointer = `/${pointer}`;
  if (pointer.startsWith('formula.')) pointer = `/${pointer.replace(/\[(\d+)\]/g, '.$1').split('.').join('/')}`;
  if (pointer.startsWith('/stages/') || pointer.startsWith('/inputs/') || pointer === '/outputStageKey') pointer = `/formula${pointer}`;
  if (/^\/formula\/stages\/\d+\/expression/.test(pointer)) {
    const match = /^\/formula\/stages\/\d+\/expression(?:\/args\/\d+)*/.exec(pointer);
    return match?.[0] ?? null;
  }
  if (/^\/formula\/inputs\/\d+(?:\/key|\/binding(?:\/(?:object|attributeKey|view|valueKind))?)?$/.test(pointer)
    || /^\/formula\/stages\/\d+\/(?:key|name)$/.test(pointer) || pointer === '/formula/outputStageKey') return pointer;
  return pointer === '/formula' ? pointer : null;
}
export function mapDamageTypeFormulaFieldIssues(source: unknown) {
  const nodeIssues: DamageTypeFormulaNodeIssue[] = [];
  const unmappedMessages: string[] = [];
  const details = isRecord(source) && 'details' in source ? source.details : source;
  if (!isRecord(details) || !Array.isArray(details.fieldIssues)) return { nodeIssues, unmappedMessages };
  for (const raw of details.fieldIssues) {
    if (!isRecord(raw)) { unmappedMessages.push('字段值不合法。'); continue; }
    const message = typeof raw.message === 'string' && raw.message.trim() ? raw.message.trim() : '字段值不合法。';
    const field = typeof raw.field === 'string' ? raw.field : typeof raw.path === 'string' ? raw.path : '';
    const path = normalizeDamageTypeFormulaFieldPath(field);
    if (path) nodeIssues.push({ path, message });
    else unmappedMessages.push(field ? `${field}：${message}` : message);
  }
  return { nodeIssues, unmappedMessages };
}
export function partitionFormulaNodeIssues(draft: DamageTypeFormulaDraft, issues: readonly DamageTypeFormulaNodeIssue[]) {
  const placed: DamageTypeFormulaNodeIssue[] = [], unplaced: DamageTypeFormulaNodeIssue[] = [];
  for (const issue of issues) {
    if (expressionAtPath(draft, issue.path)) placed.push(issue);
    else unplaced.push(issue);
  }
  return { placed, unplaced };
}
export function visibleFormulaIssueMessages(draft: DamageTypeFormulaDraft,
  mapped: { nodeIssues: readonly DamageTypeFormulaNodeIssue[]; unmappedMessages: readonly string[] }) {
  return [...mapped.unmappedMessages, ...partitionFormulaNodeIssues(draft, mapped.nodeIssues).unplaced.map(issue => issue.message)];
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
    && request.gameId === current.gameId && request.damageTypeKey === current.damageTypeKey;
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
