import type { Attribute } from '../../../types/attribute';
import type { CreateSkillFormulaRequest, FormulaAttributeOwner, FormulaAttributeValueKind, FormulaExpressionNode, UpdateSkillFormulaRequest } from '../../../types/skillFormula';
import type { SkillParameter } from '../../../types/skillParameter';
import { validateFormulaDefinition } from '../../../services/formulaContract';
import { skillFormulaAllowedBindings, SKILL_FORMULA_VALUE_KINDS } from '../../../services/skillFormulaContract';
import type { CommonFormulaDraft, CommonFormulaNodeDraft, CommonFormulaNodeIssue } from '../common-formula/commonFormulaForm';
import { commonFormulaOperationLabel, updateCommonFormulaNode } from '../common-formula/commonFormulaForm';
export const FORMULA_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const MAX_FORMULA_DEPTH = 32;
export const MAX_FORMULA_NODES = 256;
export const FORMULA_ATTRIBUTE_VALUE_KINDS = [...SKILL_FORMULA_VALUE_KINDS];
export type FormulaNodeDraft = CommonFormulaDraft;
export type FormulaNodeIssue = CommonFormulaNodeIssue;
export type SkillFormulaDraft = { formulaKey: string; name: string; description: string; sortOrder: string; expression: CommonFormulaDraft };
export type SkillFormulaDraftField = keyof SkillFormulaDraft;
export type SkillFormulaDraftErrors = Partial<Record<SkillFormulaDraftField, string>>;
export type FormulaPreviewCatalog = {
  skillKey?: string;
  parameters: ReadonlyArray<Pick<SkillParameter, 'parameterKey' | 'name' | 'valueMode' | 'skillKey'>>;
  attributes: ReadonlyArray<Pick<Attribute, 'attributeKey' | 'name'> & { status?: string }>;
};
export type FormulaPreviewSegment = { text: string; error?: boolean };
export type SkillFormulaFormValidation = { ok: true; normalized: CreateSkillFormulaRequest }
  | { ok: false; fieldErrors: SkillFormulaDraftErrors; nodeIssues: FormulaNodeIssue[] };
export function createEmptyFormulaDraft(): SkillFormulaDraft {
  return { formulaKey: '', name: '', description: '', sortOrder: '0', expression: { inputs: [], stages: [], outputStageKey: '' } };
}
export function expressionToDraft(expression: FormulaExpressionNode): CommonFormulaDraft { return structuredClone(expression); }
export function formulaToDraft(formula: { formulaKey: string; name: string; description: string | null; sortOrder: number; expression: FormulaExpressionNode }): SkillFormulaDraft {
  return { formulaKey: formula.formulaKey, name: formula.name, description: formula.description ?? '', sortOrder: String(formula.sortOrder), expression: expressionToDraft(formula.expression) };
}
export function updateNodeAtPath(root: CommonFormulaDraft, path: string, next: CommonFormulaNodeDraft | CommonFormulaDraft): CommonFormulaDraft {
  if ('stages' in next) return structuredClone(next);
  return updateCommonFormulaNode(root, path, next);
}
export function collectReferencedAttributeKeys(formula: CommonFormulaDraft): Set<string> {
  return new Set(formula.inputs.flatMap(input => input.binding.kind === 'attribute' && input.binding.attributeKey ? [input.binding.attributeKey] : []));
}
export function validateFormulaDraft(draft: SkillFormulaDraft, includeKey: boolean, catalog: FormulaPreviewCatalog): SkillFormulaFormValidation {
  const fieldErrors: SkillFormulaDraftErrors = {}, nodeIssues: FormulaNodeIssue[] = [];
  const formulaKey = draft.formulaKey.trim(), name = draft.name.trim(), description = draft.description.trim();
  const sortOrder = Number(draft.sortOrder);
  if (includeKey && !FORMULA_KEY_PATTERN.test(formulaKey)) fieldErrors.formulaKey = '稳定标识须以小写字母开头，仅含小写字母、数字、下划线，最长64位。';
  if (!name || name.length > 100) fieldErrors.name = '公式名称必填且不能超过100个字符。';
  if (description.length > 2000) fieldErrors.description = '说明不能超过2000个字符。';
  if (!draft.sortOrder.trim() || !Number.isSafeInteger(sortOrder) || sortOrder < 0) fieldErrors.sortOrder = '排序必须是非负整数。';
  const skillKey = catalog.skillKey ?? catalog.parameters[0]?.skillKey ?? '';
  const problem = validateFormulaDefinition(draft.expression, skillFormulaAllowedBindings(skillKey, catalog.parameters, catalog.attributes));
  if (problem) {
    const bindingMatch = /^\/inputs\/(\d+)\/binding/.exec(problem.path);
    const input = bindingMatch ? draft.expression.inputs[Number(bindingMatch[1])] : undefined;
    const key = input?.binding.kind === 'parameter' ? input.binding.parameterKey : input?.binding.kind === 'attribute' ? input.binding.attributeKey : '';
    const message = '共同公式字段、引用或授权不合法' + (key ? '：' + key : '') + '（' + problem.code + '）。';
    fieldErrors.expression = message;
    nodeIssues.push({ path: '/expression' + problem.path, message });
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors, nodeIssues };
  return { ok: true, normalized: { formulaKey, name, description: description || null, sortOrder, expression: structuredClone(draft.expression) as FormulaExpressionNode } };
}
export function buildCreateFormulaRequest(normalized: CreateSkillFormulaRequest): CreateSkillFormulaRequest { return structuredClone(normalized); }
export function buildUpdateFormulaRequest(normalized: CreateSkillFormulaRequest): UpdateSkillFormulaRequest {
  const { formulaKey: _key, ...body } = normalized; return structuredClone(body);
}
export function attributeOwnerLabel(owner: FormulaAttributeOwner | '') { return owner === 'SOURCE' ? '施法者' : owner === 'TARGET' ? '目标' : ''; }
export function attributeValueKindLabel(kind: FormulaAttributeValueKind | '') {
  return ({ BASE: '基础值', BONUS: '加成值', TOTAL: '最终值', CURRENT: '当前值', MAX: '最大值', MISSING: '已损失值', CURRENT_RATIO: '当前值比例', MISSING_RATIO: '已损失比例' })[kind as FormulaAttributeValueKind] ?? '';
}
/** 仅显示作者表达式，保留声明顺序，不计算公式。 */
export function previewFormulaExpression(formula: CommonFormulaDraft, catalog: FormulaPreviewCatalog): FormulaPreviewSegment[] {
  const render = (node: CommonFormulaNodeDraft): string => {
    if (node.op === 'empty') return '（空节点）';
    if (node.op === 'const') return node.value || '（未填常量）';
    if (node.op === 'ref') return '结果 ' + node.stageKey;
    if (node.op === 'read') {
      const binding = formula.inputs.find(input => input.key === node.inputKey)?.binding;
      if (binding?.kind === 'parameter') return catalog.parameters.find(row => row.parameterKey === binding.parameterKey)?.name ?? binding.parameterKey;
      if (binding?.kind === 'attribute') return (binding.object === 'source' ? '施法者' : '目标') + '.' + (catalog.attributes.find(row => row.attributeKey === binding.attributeKey)?.name ?? binding.attributeKey) + '.' + attributeValueKindLabel(binding.valueKind);
      return '输入 ' + node.inputKey;
    }
    return commonFormulaOperationLabel(node.op) + '(' + node.args.map(render).join('，') + (node.op === 'round' ? '；小数位 ' + node.decimals : '') + ')';
  };
  return formula.stages.length ? formula.stages.map(stage => ({ text: stage.name + '（' + stage.key + '）=' + render(stage.expression) + (stage.key === formula.outputStageKey ? '〔最终输出〕' : '') + '；' })) : [{ text: '（尚未添加具名结果）', error: true }];
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
    if (field.startsWith('expression') || field.startsWith('/expression')) {
      nodeIssues.push({ path: normalizeFormulaNodePath(field), message });
      continue;
    }
    unmappedMessages.push(message);
  }

  return { fieldErrors, nodeIssues, unmappedMessages };
}


export function normalizeFormulaNodePath(field: string): string {
  let pointer = field.replace(/\[(\d+)\]/g, '/$1').replaceAll('.', '/');
  if (!pointer.startsWith('/')) pointer = '/' + pointer;
  if (!pointer.startsWith('/expression')) pointer = '/expression' + pointer;
  const node = /^\/expression\/stages\/\d+\/expression(?:\/args\/\d+)*/.exec(pointer);
  return node?.[0] ?? pointer;
}
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
