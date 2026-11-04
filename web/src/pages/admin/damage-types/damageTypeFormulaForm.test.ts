import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../services/apiClient';
import { DAMAGE_TYPE_FORMULA_NOT_FOUND, type DamageTypeFormula } from '../../../types/damageTypeFormula';
import {
  FORMULA_SAVE_PENDING_MESSAGE, applyFormulaReadbackResult, canReplaceDamageTypeFormulaNode,
  canSubmitDamageTypeFormula, countDamageTypeFormulaNodes, createBlankDamageTypeFormulaDraft,
  damageTypeFormulasEqual, formulaToDraft, isSameFormulaContext, mapDamageTypeFormulaFieldIssues,
  measureDamageTypeFormulaDepth, normalizeDamageTypeFormulaFieldPath, previewDamageTypeFormulaStage,
  resolveFormulaCloseAttempt, resolveFormulaLoad, restoreScrollTop, selectableAttributeOptions,
  switchDamageTypeFormulaNode, updateFormulaDraftAtPath, validateDamageTypeFormulaDraft, visibleFormulaIssueMessages,
  type DamageTypeFormulaNodeDraft
} from './damageTypeFormulaForm';
const catalog = [{ attributeKey: 'armor', name: '护甲', status: 'ENABLED' }];
function formula(value = '1.000'): DamageTypeFormula {
  return { inputs: [], stages: [{ key: 'factor', name: '倍率', expression: { op: 'const', value } }], outputStageKey: 'factor' };
}
describe('共同公式管理草稿', () => {
  it('任意展示顺序允许前向引用，常量保持原文，重命名后的失效引用明确提示', () => {
    const draft = formulaToDraft(formula());
    draft.inputs = [{ key: 'defense', binding: { kind: 'attribute', object: 'target', attributeKey: 'armor', valueKind: 'TOTAL', view: 'current_frame' } }];
    draft.stages = [
      { key: 'factor', name: '倍率', expression: { op: 'ref', stageKey: 'later' } },
      { key: 'later', name: '后置结果', expression: { op: 'const', value: '1.000' } }
    ];
    expect(validateDamageTypeFormulaDraft(draft, catalog)).toEqual({ ok: true, formula: draft });
    expect(previewDamageTypeFormulaStage(draft.stages[0]!.expression, draft)).toBe('后置结果（later）');
    draft.stages[1]!.key = 'renamed';
    expect(validateDamageTypeFormulaDraft(draft, catalog)).toMatchObject({ ok: false, nodeIssues: [{ path: '/formula/stages/0/expression', message: expect.stringContaining('FORMULA_UNKNOWN_STAGE') }] });
  });
  it('循环、越权口径、停用属性及非十进制常量阻止保存且草稿不变', () => {
    const draft = formulaToDraft(formula());
    draft.stages[0]!.expression = { op: 'ref', stageKey: 'factor' };
    expect(validateDamageTypeFormulaDraft(draft, catalog)).toMatchObject({ ok: false, nodeIssues: [{ message: expect.stringContaining('FORMULA_CYCLE') }] });
    draft.stages[0]!.expression = { op: 'const', value: '1e3' };
    expect(validateDamageTypeFormulaDraft(draft, catalog).ok).toBe(false);
    draft.stages[0]!.expression = { op: 'const', value: '1' };
    draft.inputs = [{ key: 'defense', binding: { kind: 'attribute', object: 'target', attributeKey: 'armor', valueKind: 'TOTAL', view: 'current_frame' } }];
    const before = structuredClone(draft);
    expect(validateDamageTypeFormulaDraft(draft, [{ ...catalog[0]!, status: 'DISABLED' }])).toMatchObject({ ok: false, nodeIssues: [{ message: expect.stringContaining('FORMULA_UNKNOWN_BINDING') }] });
    expect(draft).toEqual(before);
    expect(selectableAttributeOptions([{ ...catalog[0]!, status: 'DISABLED' }], 'armor')).toEqual([{ value: 'armor', label: '护甲（armor）已停用，请修复' }]);
    draft.inputs[0]!.binding.valueKind = 'CURRENT' as never;
    expect(validateDamageTypeFormulaDraft(draft, catalog).ok).toBe(false);
  });
  it('整份公式预算与递归路径改动均使用共同树，换运算清除旧字段', () => {
    expect(switchDamageTypeFormulaNode('if')).toEqual({ op: 'if', args: [{ op: 'empty' }, { op: 'empty' }, { op: 'empty' }] });
    expect(switchDamageTypeFormulaNode('round')).toEqual({ op: 'round', args: [{ op: 'empty' }], decimals: 0 });
    const draft = formulaToDraft(formula());
    draft.stages[0]!.expression = { op: 'add', args: [{ op: 'const', value: '1' }, { op: 'const', value: '2' }] };
    const changed = updateFormulaDraftAtPath(draft, '/formula/stages/0/expression/args/1', { op: 'read', inputKey: 'armor' });
    expect(changed.stages[0]!.expression).toMatchObject({ args: [{ value: '1' }, { op: 'read', inputKey: 'armor' }] });
    expect(draft.stages[0]!.expression).toMatchObject({ args: [{ value: '1' }, { value: '2' }] });
    let deep: DamageTypeFormulaNodeDraft = { op: 'const', value: '1' };
    for (let index = 1; index < 32; index++) deep = { op: 'floor', args: [deep] };
    draft.stages[0]!.expression = deep;
    expect(measureDamageTypeFormulaDepth(deep)).toBe(32);
    expect(countDamageTypeFormulaNodes(deep)).toBe(32);
    expect(canReplaceDamageTypeFormulaNode(draft, '/formula/stages/0/expression', { op: 'floor', args: [deep] }).ok).toBe(false);
  });
  it('只有精确的缺公式响应产生空草稿，读取失败不伪装未配置', () => {
    const blank = resolveFormulaLoad({ ok: false, error: new ApiRequestError('尚未配置', 404, DAMAGE_TYPE_FORMULA_NOT_FOUND) });
    expect(blank).toEqual({ kind: 'ready', persisted: false, draft: createBlankDamageTypeFormulaDraft() });
    for (const error of [new ApiRequestError('不存在', 404, '404.DAMAGE_TYPE_NOT_FOUND'), new ApiRequestError('未授权', 401), new TypeError('fetch failed')]) {
      expect(resolveFormulaLoad({ ok: false, error }).kind).toBe('error');
    }
    expect(resolveFormulaLoad({ ok: true, detail: { gameId: 'demo', damageTypeKey: 'heat', formula: formula(), updatedAt: 'now' } }))
      .toMatchObject({ kind: 'ready', persisted: true });
  });
  it('独立读回一致才能关闭，失败或常量原文改变不重放PUT、不丢草稿', () => {
    const submitted = formula(), draft = formulaToDraft(submitted);
    const confirmed = applyFormulaReadbackResult(draft, submitted, { ok: true, formula: submitted });
    expect(confirmed).toMatchObject({ close: true, resendPut: false, message: null });
    expect(damageTypeFormulasEqual(submitted, formula('1'))).toBe(false);
    for (const readback of [{ ok: false as const }, { ok: true as const, formula: formula('1') }]) {
      const result = applyFormulaReadbackResult(draft, submitted, readback);
      expect(result).toMatchObject({ close: false, resendPut: false, message: FORMULA_SAVE_PENDING_MESSAGE });
      expect(result.draft).toBe(draft);
    }
    expect(canSubmitDamageTypeFormula({ readOnly: false, catalogReady: true, pending: true, saving: false, ready: true })).toBe(false);
    expect(canSubmitDamageTypeFormula({ readOnly: false, catalogReady: false, pending: false, saving: false, ready: true })).toBe(false);
  });
  it('共同字段路径映射到实际节点，未知路径保持可见，取消保护和滚动恢复仍生效', () => {
    expect(normalizeDamageTypeFormulaFieldPath('formula.stages[0].expression.args[1].value')).toBe('/formula/stages/0/expression/args/1');
    expect(normalizeDamageTypeFormulaFieldPath('/inputs/0/binding/attributeKey')).toBe('/formula/inputs/0/binding/attributeKey');
    const draft = formulaToDraft(formula());
    const mapped = mapDamageTypeFormulaFieldIssues({ details: { fieldIssues: [
      { field: '/formula/stages/0/expression/value', message: '常量错误' },
      { field: '/formula/stages/1/expression', message: '节点不存在' }, { field: 'damageTypeKey', message: '不应写入' }
    ] } });
    expect(visibleFormulaIssueMessages(draft, mapped)).toEqual(['damageTypeKey：不应写入', '节点不存在']);
    expect(resolveFormulaCloseAttempt(true, false)).toBe('keep');
    expect(resolveFormulaCloseAttempt(true, true)).toBe('close');
    expect(isSameFormulaContext({ apiBaseUrl: 'http://localhost', gameId: 'demo', damageTypeKey: 'heat' },
      { apiBaseUrl: 'http://localhost/', gameId: 'demo', damageTypeKey: 'heat' })).toBe(false);
    const scroller = { scrollTop: 0 }; restoreScrollTop(scroller, 240); expect(scroller.scrollTop).toBe(240);
  });
});
