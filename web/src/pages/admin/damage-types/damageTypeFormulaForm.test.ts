import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../services/apiClient';
import type { DamageTypeFormula, DamageTypeFormulaNode } from '../../../types/damageTypeFormula';
import { DAMAGE_TYPE_FORMULA_NOT_FOUND, DAMAGE_TYPE_FORMULA_STAGE_KEYS } from '../../../types/damageTypeFormula';
import {
  DAMAGE_TYPE_FORMULA_MAX_DEPTH,
  DAMAGE_TYPE_FORMULA_MAX_NODES
} from '../../../types/damageTypeFormula';
import {
  FORMULA_SAVE_PENDING_MESSAGE,
  applyFormulaReadbackResult,
  canExpandDamageTypeFormulaOperation,
  canSubmitDamageTypeFormula,
  countDamageTypeFormulaNodes,
  createBlankDamageTypeFormulaDraft,
  damageTypeFormulasEqual,
  formulaStageViews,
  formulaToDraft,
  isSameFormulaContext,
  mapDamageTypeFormulaFieldIssues,
  measureDamageTypeFormulaDepth,
  normalizeDamageTypeFormulaFieldPath,
  previewDamageTypeFormulaChain,
  previewDamageTypeFormulaStage,
  resolveFormulaCloseAttempt,
  resolveFormulaLoad,
  restoreScrollTop,
  retainedDisabledAttributeTriples,
  selectableAttributeOptions,
  stageResultOptions,
  switchDamageTypeFormulaNode,
  validateDamageTypeFormulaDraft,
  visibleFormulaIssueMessages,
  type DamageTypeFormulaDraft,
  type DamageTypeFormulaNodeDraft
} from './damageTypeFormulaForm';

const attributes = [
  { attributeKey: 'hp', name: '生命值', status: 'ENABLED' },
  { attributeKey: 'armor', name: '护甲', status: 'DISABLED' },
  { attributeKey: 'mr', name: '魔抗', status: 'DISABLED' }
];

function fixedNode(value: string): DamageTypeFormulaNodeDraft {
  return { nodeType: 'FIXED', value };
}

function fixedFormula(value = 1): DamageTypeFormula {
  const node: DamageTypeFormulaNode = { nodeType: 'FIXED', value };
  return {
    resistanceBeforePenetration: node,
    penetrationPercent: node,
    penetrationFlat: node,
    effectiveResistance: node,
    resistanceFactor: node
  };
}

function withStage(
  draft: DamageTypeFormulaDraft,
  stage: DamageTypeFormulaDraft extends infer _T ? keyof DamageTypeFormulaDraft : never,
  node: DamageTypeFormulaNodeDraft
): DamageTypeFormulaDraft {
  return { ...draft, [stage]: node };
}

describe('damage type formula nodes', () => {
  it('switches among the four node kinds and clears the previous fields', () => {
    expect(switchDamageTypeFormulaNode('OPERATION')).toEqual({
      nodeType: 'OPERATION',
      operation: '',
      left: { nodeType: 'empty' },
      right: { nodeType: 'empty' }
    });
    expect(switchDamageTypeFormulaNode('FIXED')).toEqual({ nodeType: 'FIXED', value: '' });
    expect(switchDamageTypeFormulaNode('ATTRIBUTE')).toEqual({
      nodeType: 'ATTRIBUTE',
      attributeOwner: '',
      attributeKey: '',
      attributeValueKind: ''
    });
    expect(switchDamageTypeFormulaNode('STAGE_RESULT')).toEqual({ nodeType: 'STAGE_RESULT', stageKey: '' });
    const parameter = { nodeType: 'PARAMETER', parameterKey: 'ratio' } as unknown as DamageTypeFormulaNodeDraft;
    const validated = validateDamageTypeFormulaDraft(
      withStage(createBlankDamageTypeFormulaDraft(), 'resistanceBeforePenetration', parameter),
      attributes,
      []
    );
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.nodeIssues.some((issue) => issue.message === '节点类型无效。')).toBe(true);
    }
  });

  it('keeps each stage within depth 32 and 256 nodes', () => {
    let deep = fixedNode('1');
    for (let depth = 2; depth <= DAMAGE_TYPE_FORMULA_MAX_DEPTH; depth += 1) {
      deep = { nodeType: 'OPERATION', operation: 'ADD', left: deep, right: fixedNode('1') };
    }
    expect(measureDamageTypeFormulaDepth(deep)).toBe(DAMAGE_TYPE_FORMULA_MAX_DEPTH);
    let deepest = 'formula.resistanceBeforePenetration';
    let cursor = deep;
    while (cursor.nodeType === 'OPERATION') {
      deepest = `${deepest}.operands[0]`;
      cursor = cursor.left;
    }
    expect(canExpandDamageTypeFormulaOperation('resistanceBeforePenetration', deep, deepest).ok).toBe(false);

    let wide = fixedNode('1');
    while (countDamageTypeFormulaNodes(wide) + 2 <= DAMAGE_TYPE_FORMULA_MAX_NODES) {
      wide = { nodeType: 'OPERATION', operation: 'ADD', left: wide, right: fixedNode('1') };
    }
    expect(countDamageTypeFormulaNodes(wide)).toBeLessThanOrEqual(DAMAGE_TYPE_FORMULA_MAX_NODES);
    expect(canExpandDamageTypeFormulaOperation('penetrationPercent', wide, 'formula.penetrationPercent').ok).toBe(false);
    expect(canExpandDamageTypeFormulaOperation(
      'resistanceFactor',
      fixedNode('1'),
      'formula.resistanceFactor'
    ).ok).toBe(true);
  });

  it('offers prior stages in fixed order and rejects later references', () => {
    expect(DAMAGE_TYPE_FORMULA_STAGE_KEYS.map((stage) => stageResultOptions(stage).map((item) => item.value)))
      .toEqual([
        [],
        ['RESISTANCE_BEFORE_PENETRATION'],
        ['RESISTANCE_BEFORE_PENETRATION', 'PENETRATION_PERCENT'],
        ['RESISTANCE_BEFORE_PENETRATION', 'PENETRATION_PERCENT', 'PENETRATION_FLAT'],
        ['RESISTANCE_BEFORE_PENETRATION', 'PENETRATION_PERCENT', 'PENETRATION_FLAT', 'EFFECTIVE_RESISTANCE']
      ]);
    const views = formulaStageViews(createBlankDamageTypeFormulaDraft());
    expect(views.map((stage) => stage.label)).toEqual([
      '穿透前抗性',
      '百分比穿透',
      '固定穿透',
      '有效抗性',
      '抗性系数'
    ]);
    expect(views.every((stage) => stage.node.nodeType === 'empty')).toBe(true);

    const draft = createBlankDamageTypeFormulaDraft();
    draft.resistanceBeforePenetration = fixedNode('10');
    draft.penetrationPercent = { nodeType: 'STAGE_RESULT', stageKey: 'EFFECTIVE_RESISTANCE' };
    draft.penetrationFlat = fixedNode('0');
    draft.effectiveResistance = { nodeType: 'STAGE_RESULT', stageKey: 'RESISTANCE_BEFORE_PENETRATION' };
    draft.resistanceFactor = fixedNode('1');
    const validated = validateDamageTypeFormulaDraft(draft, attributes, []);
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.nodeIssues).toContainEqual({
        path: 'formula.penetrationPercent',
        message: '只能引用更早的阶段结果。'
      });
    }
    draft.penetrationPercent = { nodeType: 'STAGE_RESULT', stageKey: 'RESISTANCE_BEFORE_PENETRATION' };
    expect(validateDamageTypeFormulaDraft(draft, attributes, []).ok).toBe(true);
  });
});

describe('damage type formula preview and attributes', () => {
  it('previews operation, fixed value, owner attribute and prior stage in Chinese', () => {
    const node: DamageTypeFormulaNodeDraft = {
      nodeType: 'OPERATION',
      operation: 'SUBTRACT',
      left: { nodeType: 'STAGE_RESULT', stageKey: 'RESISTANCE_BEFORE_PENETRATION' },
      right: {
        nodeType: 'OPERATION',
        operation: 'MULTIPLY',
        left: {
          nodeType: 'ATTRIBUTE',
          attributeOwner: 'SOURCE',
          attributeKey: 'hp',
          attributeValueKind: 'CURRENT'
        },
        right: { nodeType: 'FIXED', value: '0.4' }
      }
    };
    const text = previewDamageTypeFormulaStage(node, 'effectiveResistance', attributes)
      .map((segment) => segment.text)
      .join('');
    expect(text).toBe('穿透前抗性 − (来源.生命值.当前值 × 0.4)');
    expect(previewDamageTypeFormulaStage(
      { nodeType: 'OPERATION', operation: 'MIN', left: fixedNode('1'), right: fixedNode('2') },
      'resistanceFactor',
      attributes
    ).map((segment) => segment.text).join('')).toBe('取较小值(1, 2)');
  });

  it('previews the five-stage relationship with stable symbols and attribute sources', () => {
    const draft = createBlankDamageTypeFormulaDraft();
    draft.resistanceBeforePenetration = {
      nodeType: 'ATTRIBUTE',
      attributeOwner: 'TARGET',
      attributeKey: 'armor',
      attributeValueKind: 'TOTAL'
    };
    draft.penetrationPercent = {
      nodeType: 'ATTRIBUTE',
      attributeOwner: 'SOURCE',
      attributeKey: 'armor_pen_percent',
      attributeValueKind: 'TOTAL'
    };
    draft.penetrationFlat = {
      nodeType: 'ATTRIBUTE',
      attributeOwner: 'SOURCE',
      attributeKey: 'armor_pen_flat',
      attributeValueKind: 'TOTAL'
    };
    draft.effectiveResistance = {
      nodeType: 'OPERATION',
      operation: 'SUBTRACT',
      left: { nodeType: 'STAGE_RESULT', stageKey: 'RESISTANCE_BEFORE_PENETRATION' },
      right: { nodeType: 'STAGE_RESULT', stageKey: 'PENETRATION_FLAT' }
    };
    draft.resistanceFactor = { nodeType: 'STAGE_RESULT', stageKey: 'EFFECTIVE_RESISTANCE' };
    const catalog = [
      { attributeKey: 'armor', name: '护甲', status: 'ENABLED' },
      { attributeKey: 'armor_pen_percent', name: '百分比护甲穿透', status: 'ENABLED' },
      { attributeKey: 'armor_pen_flat', name: '固定护甲穿透', status: 'ENABLED' }
    ];

    const rows = previewDamageTypeFormulaChain(draft, catalog).map((stage) => (
      `${stage.symbol}（${stage.label}） = ${stage.segments.map((segment) => segment.text).join('')}`
    ));
    expect(rows).toEqual([
      'R（穿透前抗性） = 目标.护甲.最终值',
      'P（百分比穿透） = 来源.百分比护甲穿透.最终值',
      'F（固定穿透） = 来源.固定护甲穿透.最终值',
      'E（有效抗性） = R（穿透前抗性） − F（固定穿透）',
      'M（抗性系数） = E（有效抗性）'
    ]);
  });

  it('keeps a disabled attribute only for its original owner, key and value kind', () => {
    const origin = createBlankDamageTypeFormulaDraft();
    origin.resistanceBeforePenetration = {
      nodeType: 'ATTRIBUTE',
      attributeOwner: 'SOURCE',
      attributeKey: 'armor',
      attributeValueKind: 'BASE'
    };
    const retained = retainedDisabledAttributeTriples(origin, attributes);
    expect(retained).toEqual([{
      attributeOwner: 'SOURCE',
      attributeKey: 'armor',
      attributeValueKind: 'BASE'
    }]);

    const fresh = switchDamageTypeFormulaNode('ATTRIBUTE');
    expect(selectableAttributeOptions(attributes, retained, fresh).map((item) => item.attributeKey))
      .toEqual(['hp']);
    expect(selectableAttributeOptions(attributes, retained, origin.resistanceBeforePenetration))
      .toContainEqual({ attributeKey: 'armor', label: '护甲（armor）已停用' });
    expect(selectableAttributeOptions(attributes, retained, {
      nodeType: 'ATTRIBUTE',
      attributeOwner: 'TARGET',
      attributeKey: 'mr',
      attributeValueKind: 'TOTAL'
    }).some((item) => item.attributeKey === 'mr')).toBe(false);

    const draft = formulaToDraft(fixedFormula(0));
    draft.resistanceBeforePenetration = origin.resistanceBeforePenetration;
    expect(validateDamageTypeFormulaDraft(draft, attributes, retained).ok).toBe(true);
    draft.penetrationPercent = {
      nodeType: 'ATTRIBUTE',
      attributeOwner: 'SOURCE',
      attributeKey: 'armor',
      attributeValueKind: 'BONUS'
    };
    const changed = validateDamageTypeFormulaDraft(draft, attributes, retained);
    expect(changed.ok).toBe(false);
    if (!changed.ok) {
      expect(changed.nodeIssues).toContainEqual({
        path: 'formula.penetrationPercent',
        message: '已停用的属性不能用于新的选择。'
      });
    }
  });
});

describe('damage type formula load, save and field errors', () => {
  it('creates a blank draft only for the exact missing-formula response', () => {
    const blank = resolveFormulaLoad({
      ok: false,
      error: new ApiRequestError('尚未配置', 404, DAMAGE_TYPE_FORMULA_NOT_FOUND)
    });
    expect(blank).toMatchObject({ kind: 'ready', persisted: false });
    if (blank.kind === 'ready') {
      expect(blank.draft).toEqual(createBlankDamageTypeFormulaDraft());
    }

    const failures = [
      new ApiRequestError('伤害类型不存在', 404, '404.DAMAGE_TYPE_NOT_FOUND'),
      new ApiRequestError('不存在', 404),
      new ApiRequestError('未授权', 401, '401.UNAUTHORIZED'),
      new ApiRequestError('禁止访问', 403, '403.FORBIDDEN'),
      new ApiRequestError('失败', 500, '500.INTERNAL'),
      new TypeError('Failed to fetch'),
      new ApiRequestError('不是缺失公式', 400, DAMAGE_TYPE_FORMULA_NOT_FOUND)
    ];
    for (const error of failures) {
      const resolved = resolveFormulaLoad({ ok: false, error });
      expect(resolved.kind).toBe('error');
    }

    const loaded = resolveFormulaLoad({
      ok: true,
      detail: {
        gameId: 'demo',
        damageTypeKey: 'physical',
        formula: fixedFormula(3),
        updatedAt: '2026-09-27T00:00:00Z'
      }
    });
    expect(loaded).toMatchObject({ kind: 'ready', persisted: true });
  });

  it('closes only when the independent read matches and never resends while unconfirmed', () => {
    const submitted = fixedFormula(4);
    const swapped: DamageTypeFormula = {
      ...submitted,
      resistanceBeforePenetration: {
        nodeType: 'OPERATION',
        operation: 'SUBTRACT',
        operands: [
          { nodeType: 'FIXED', value: 2 },
          { nodeType: 'FIXED', value: 1 }
        ]
      }
    };
    const reversed: DamageTypeFormula = {
      ...swapped,
      resistanceBeforePenetration: {
        nodeType: 'OPERATION',
        operation: 'SUBTRACT',
        operands: [
          { nodeType: 'FIXED', value: 1 },
          { nodeType: 'FIXED', value: 2 }
        ]
      }
    };
    expect(damageTypeFormulasEqual(swapped, reversed)).toBe(false);
    const draft = formulaToDraft(submitted);
    const confirmed = applyFormulaReadbackResult(draft, submitted, { ok: true, formula: submitted });
    expect(confirmed).toMatchObject({ draft, close: true, resendPut: false, message: null });
    const mismatch = applyFormulaReadbackResult(draft, submitted, { ok: true, formula: reversed });
    const failed = applyFormulaReadbackResult(draft, submitted, { ok: false });
    expect(mismatch).toMatchObject({
      draft,
      close: false,
      resendPut: false,
      message: FORMULA_SAVE_PENDING_MESSAGE
    });
    expect(failed.close).toBe(false);
    expect(failed.resendPut).toBe(false);
    expect(failed.draft).toBe(draft);
    expect(canSubmitDamageTypeFormula({
      readOnly: false,
      catalogReady: true,
      pending: true,
      saving: false,
      ready: true
    })).toBe(false);
    expect(canSubmitDamageTypeFormula({
      readOnly: false,
      catalogReady: false,
      pending: false,
      saving: false,
      ready: true
    })).toBe(false);
  });

  it('maps stage and node paths and keeps unknown paths visible', () => {
    expect(normalizeDamageTypeFormulaFieldPath('formula.resistanceBeforePenetration.operands[0].value'))
      .toBe('formula.resistanceBeforePenetration.operands[0]');
    expect(normalizeDamageTypeFormulaFieldPath('formula.resistanceBeforePenetration.operands[2].value')).toBeNull();
    expect(normalizeDamageTypeFormulaFieldPath('formula.notAStage')).toBeNull();

    const draft = createBlankDamageTypeFormulaDraft();
    draft.resistanceBeforePenetration = {
      nodeType: 'OPERATION',
      operation: 'ADD',
      left: fixedNode('1'),
      right: fixedNode('2')
    };
    const mapped = mapDamageTypeFormulaFieldIssues({
      details: {
        fieldIssues: [
          { field: 'formula.resistanceBeforePenetration.operands[0].value', message: '固定值无效' },
          { field: 'formula.penetrationPercent.operation', message: '运算无效' },
          { field: 'formula.resistanceBeforePenetration.operands[0].operands[1].stageKey', message: '节点不存在' },
          { field: 'formula.unknown', message: '未知阶段' },
          { field: 'damageTypeKey', message: '不应写入基础资料' },
          { message: '缺少路径' }
        ]
      }
    });
    expect(mapped.nodeIssues).toEqual([
      { path: 'formula.resistanceBeforePenetration.operands[0]', message: '固定值无效' },
      { path: 'formula.penetrationPercent', message: '运算无效' },
      { path: 'formula.resistanceBeforePenetration.operands[0].operands[1]', message: '节点不存在' }
    ]);
    expect(visibleFormulaIssueMessages(draft, mapped)).toEqual([
      'formula.unknown：未知阶段',
      'damageTypeKey：不应写入基础资料',
      '缺少路径',
      '节点不存在'
    ]);
    expect(resolveFormulaCloseAttempt(true, false)).toBe('keep');
    expect(resolveFormulaCloseAttempt(true, true)).toBe('close');
    expect(isSameFormulaContext(
      { apiBaseUrl: 'http://localhost:8080', gameId: 'demo', token: 'a', damageTypeKey: 'physical' },
      { apiBaseUrl: 'http://localhost:8080/', gameId: 'demo', token: 'a', damageTypeKey: 'physical' }
    )).toBe(false);
    const scroller = { scrollTop: 0 };
    restoreScrollTop(scroller, 240);
    expect(scroller.scrollTop).toBe(240);
  });
});
