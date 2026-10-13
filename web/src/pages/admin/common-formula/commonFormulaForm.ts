import { FORMULA_SCHEMA, type Binding, type Expression } from '../../../types/formulaContract.generated';
export type CommonFormulaOperation = Exclude<Expression['op'], 'const' | 'read' | 'ref'>;
export const COMMON_FORMULA_OPERATIONS: CommonFormulaOperation[] = [
  'add', 'sub', 'mul', 'div', 'min', 'max', 'eq', 'ne', 'lt', 'lte', 'gt', 'gte',
  'if', 'clamp', 'floor', 'ceil', 'trunc', 'round'
];
export type CommonFormulaNodeDraft =
  | { op: 'empty' } | { op: 'const'; value: string } | { op: 'read'; inputKey: string }
  | { op: 'ref'; stageKey: string }
  | { op: CommonFormulaOperation; args: CommonFormulaNodeDraft[]; decimals?: number };
export type CommonFormulaInputDraft = { key: string; binding:
  | { kind: 'parameter'; skillKey: string; parameterKey: string }
  | { kind: 'attribute'; object: Extract<Binding, { kind: 'attribute' }>['object'] | '';
    attributeKey: string; valueKind: Extract<Binding, { kind: 'attribute' }>['valueKind'] | '';
    view: Extract<Binding, { kind: 'attribute' }>['view'] }
  | { kind: 'context'; contextKey: string } };
export type CommonFormulaDraft = { inputs: CommonFormulaInputDraft[];
  stages: Array<{ key: string; name: string; expression: CommonFormulaNodeDraft }>; outputStageKey: string };
export type CommonFormulaNodeKind = CommonFormulaNodeDraft['op'];
export type CommonFormulaNodeIssue = { path: string; message: string };
const LABELS: Record<CommonFormulaOperation, string> = {
  add: '加', sub: '减', mul: '乘', div: '除', min: '取较小值', max: '取较大值',
  eq: '等于', ne: '不等于', lt: '小于', lte: '小于或等于', gt: '大于', gte: '大于或等于',
  if: '条件选择', clamp: '范围夹取', floor: '向下取整', ceil: '向上取整', trunc: '截断小数', round: '四舍五入'
};
export function commonFormulaOperationLabel(op: CommonFormulaOperation) { return LABELS[op]; }
export function commonFormulaNode(op: CommonFormulaNodeDraft['op']): CommonFormulaNodeDraft {
  if (op === 'empty') return { op };
  if (op === 'const') return { op, value: '' };
  if (op === 'read') return { op, inputKey: '' };
  if (op === 'ref') return { op, stageKey: '' };
  const count = op === 'if' || op === 'clamp' ? 3 : ['floor', 'ceil', 'trunc', 'round'].includes(op) ? 1 : 2;
  return { op, args: Array.from({ length: count }, () => ({ op: 'empty' })), ...(op === 'round' ? { decimals: 0 } : {}) };
}
export function updateCommonFormulaNode(draft: CommonFormulaDraft, path: string, next: CommonFormulaNodeDraft): CommonFormulaDraft {
  const match = /^\/(?:formula|expression)\/stages\/(\d+)\/expression((?:\/args\/\d+)*)$/.exec(path);
  if (!match || !draft.stages[Number(match[1])]) return draft;
  const indexes = [...match[2]!.matchAll(/\/args\/(\d+)/g)].map(row => Number(row[1]));
  const update = (node: CommonFormulaNodeDraft, remaining: number[]): CommonFormulaNodeDraft => {
    if (!remaining.length) return next;
    if (!('args' in node)) return node;
    const [head, ...tail] = remaining;
    return { ...node, args: node.args.map((child, index) => index === head ? update(child, tail) : child) };
  };
  return { ...draft, stages: draft.stages.map((stage, index) => index === Number(match[1])
    ? { ...stage, expression: update(stage.expression, indexes) } : stage) };
}
export function canReplaceCommonFormulaNode(draft: CommonFormulaDraft, path: string, next: CommonFormulaNodeDraft) {
  const updated = updateCommonFormulaNode(draft, path, next);
  const count = (node: CommonFormulaNodeDraft): number => 1 + ('args' in node ? node.args.reduce((sum, child) => sum + count(child), 0) : 0);
  const depth = (node: CommonFormulaNodeDraft): number => 1 + ('args' in node ? Math.max(0, ...node.args.map(depth)) : 0);
  if (updated.stages.reduce((sum, stage) => sum + count(stage.expression), 0) > FORMULA_SCHEMA['x-limits'].maxNodes)
    return { ok: false as const, path, message: '整份公式节点不能超过 256 个。' };
  if (updated.stages.some(stage => depth(stage.expression) > FORMULA_SCHEMA['x-limits'].maxDepth))
    return { ok: false as const, path, message: '公式深度不能超过 32 层。' };
  return { ok: true as const };
}
