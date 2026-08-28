import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../../services/apiClient';
import type { SkillInternalState } from '../../../../types/skillInternalState';
import {
  AMMO_RECOVERY_MODE_LABELS,
  INCOMPLETE_CATALOG_MESSAGE,
  SKILL_INTERNAL_STATE_KEY_PATTERN,
  SKILL_INTERNAL_STATE_SCOPE_LABELS,
  SKILL_INTERNAL_STATE_TYPE_LABELS,
  applyStateTypeChange,
  buildCreateSkillInternalStateRequest,
  buildUpdateSkillInternalStateRequest,
  clearHiddenInternalStateFields,
  createEmptyInternalStateDraft,
  createEmptyModeOptionDraft,
  listFormulaOptions,
  mapSkillInternalStateFieldIssues,
  skillInternalStateToDraft,
  validateSkillInternalStateDraft,
  type InternalStateFormCatalog,
  type SkillInternalStateDraft,
  type SkillInternalStateModeOptionDraft
} from './internalStateForm';

const CATALOG: InternalStateFormCatalog = {
  formulas: [
    { formulaKey: 'zero', name: '零' },
    { formulaKey: 'focus_max_stacks', name: '专注上限' },
    { formulaKey: 'max_ammo', name: '最大弹药' },
    { formulaKey: 'ammo_recovery_ms', name: '弹药恢复' },
    { formulaKey: 'internal_cooldown_ms', name: '内部冷却' }
  ]
};

const COUNTER: SkillInternalState = {
  gameId: 'lol',
  skillKey: 'ashe_q',
  stateKey: 'focus_stacks',
  name: '专注层数',
  stateType: 'COUNTER',
  scope: 'SKILL',
  description: null,
  sortOrder: 10,
  detail: {
    initialValueFormulaKey: 'zero',
    maxValueFormulaKey: 'focus_max_stacks'
  },
  createdAt: '2026-08-27T00:00:00Z',
  updatedAt: '2026-08-27T00:00:00Z'
};

function validCounterDraft(overrides: Partial<SkillInternalStateDraft> = {}): SkillInternalStateDraft {
  return {
    ...createEmptyInternalStateDraft('COUNTER'),
    stateKey: 'focus_stacks',
    name: '专注层数',
    sortOrder: '10',
    initialValueFormulaKey: 'zero',
    maxValueFormulaKey: 'focus_max_stacks',
    ...overrides
  };
}

function validModeOptions(): SkillInternalStateModeOptionDraft[] {
  return [
    { optionKey: 'minigun', name: '机枪', sortOrder: '10', initial: true, originalOptionKey: null },
    { optionKey: 'rocket', name: '火箭', sortOrder: '20', initial: false, originalOptionKey: null }
  ];
}

function expectValid(draft: SkillInternalStateDraft, includeStateKey = true) {
  const result = validateSkillInternalStateDraft(draft, { includeStateKey, catalog: CATALOG });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected valid draft: ${JSON.stringify(result)}`);
  }
  return result.normalized;
}

describe('skill internal state form defaults and conversion', () => {
  it('creates empty drafts with stable defaults', () => {
    expect(createEmptyInternalStateDraft()).toMatchObject({
      stateKey: '',
      stateType: 'COUNTER',
      scope: 'SKILL',
      options: [],
      originalStateType: null
    });
    expect(createEmptyModeOptionDraft()).toEqual({
      optionKey: '',
      name: '',
      sortOrder: '0',
      initial: false,
      originalOptionKey: null
    });
    expect(SKILL_INTERNAL_STATE_KEY_PATTERN.test('focus_stacks')).toBe(true);
    expect(SKILL_INTERNAL_STATE_TYPE_LABELS.COUNTER).toBe('计数');
    expect(SKILL_INTERNAL_STATE_SCOPE_LABELS.TARGET).toBe('按当前目标分别保存');
    expect(AMMO_RECOVERY_MODE_LABELS.ONE_BY_ONE).toBe('逐个恢复');
  });

  it('converts saved counter state and clears hidden fields', () => {
    const draft = skillInternalStateToDraft(COUNTER);
    expect(draft.initialValueFormulaKey).toBe('zero');
    expect(draft.options).toEqual([]);
    expect(draft.durationFormulaKey).toBe('');
    expect(clearHiddenInternalStateFields({
      ...draft,
      options: validModeOptions(),
      durationFormulaKey: 'internal_cooldown_ms'
    }).options).toEqual([]);
  });
});

describe('skill internal state kinds and scope', () => {
  it('builds five strong-typed requests and strips hidden fields', () => {
    const counter = expectValid(validCounterDraft());
    expect(counter).toEqual({
      stateKey: 'focus_stacks',
      name: '专注层数',
      stateType: 'COUNTER',
      scope: 'SKILL',
      description: null,
      sortOrder: 10,
      detail: {
        initialValueFormulaKey: 'zero',
        maxValueFormulaKey: 'focus_max_stacks'
      }
    });

    const ammo = expectValid({
      ...createEmptyInternalStateDraft('AMMO'),
      stateKey: 'ammo',
      name: '弹药',
      sortOrder: '1',
      initialValueFormulaKey: 'max_ammo',
      maxValueFormulaKey: 'max_ammo',
      recoveryIntervalFormulaKey: 'ammo_recovery_ms',
      recoveryMode: 'ALL_AT_ONCE'
    });
    expect(ammo.stateType).toBe('AMMO');
    if (ammo.stateType !== 'AMMO') throw new Error('expected ammo');
    expect(ammo.detail.recoveryMode).toBe('ALL_AT_ONCE');
    expect(ammo.detail).not.toHaveProperty('options');

    const mode = expectValid({
      ...createEmptyInternalStateDraft('MODE'),
      stateKey: 'weapon_mode',
      name: '武器模式',
      sortOrder: '2',
      options: validModeOptions()
    });
    expect(mode.stateType).toBe('MODE');
    if (mode.stateType !== 'MODE') throw new Error('expected mode');
    expect(mode.detail.options).toHaveLength(2);
    expect(mode.detail).not.toHaveProperty('initialValueFormulaKey');

    const flag = expectValid({
      ...createEmptyInternalStateDraft('FLAG'),
      stateKey: 'ready',
      name: '已准备',
      sortOrder: '3',
      initialEnabled: true
    });
    expect(flag.stateType).toBe('FLAG');
    if (flag.stateType !== 'FLAG') throw new Error('expected flag');
    expect(flag.detail).toEqual({ initialEnabled: true });

    const cooldown = expectValid({
      ...createEmptyInternalStateDraft('INTERNAL_COOLDOWN'),
      stateKey: 'internal_cd',
      name: '内部冷却',
      sortOrder: '4',
      durationFormulaKey: 'internal_cooldown_ms'
    });
    expect(cooldown.stateType).toBe('INTERNAL_COOLDOWN');
    if (cooldown.stateType !== 'INTERNAL_COOLDOWN') throw new Error('expected cooldown');
    expect(cooldown.detail).toEqual({ durationFormulaKey: 'internal_cooldown_ms' });
  });

  it('only allows target scope for counters and resets it when switching kinds', () => {
    const targetCounter = expectValid(validCounterDraft({ scope: 'TARGET' }));
    expect(targetCounter.scope).toBe('TARGET');

    const switched = applyStateTypeChange(validCounterDraft({ scope: 'TARGET' }), 'AMMO');
    expect(switched.scope).toBe('SKILL');
    expect(switched.initialValueFormulaKey).toBe('');
    expect(switched.recoveryMode).toBe('ONE_BY_ONE');

    const invalidAmmo = validateSkillInternalStateDraft({
      ...createEmptyInternalStateDraft('AMMO'),
      stateKey: 'ammo',
      name: '弹药',
      scope: 'TARGET',
      sortOrder: '0',
      initialValueFormulaKey: 'max_ammo',
      maxValueFormulaKey: 'max_ammo',
      recoveryIntervalFormulaKey: 'ammo_recovery_ms',
      recoveryMode: 'ONE_BY_ONE'
    }, { includeStateKey: true, catalog: CATALOG });
    expect(invalidAmmo.ok).toBe(false);
    if (invalidAmmo.ok) throw new Error('expected invalid');
    expect(invalidAmmo.fieldErrors.scope).toBe('只有计数允许按当前目标分别保存。');
  });

  it('requires formulas, two unique mode options and exactly one initial option', () => {
    const missingFormula = validateSkillInternalStateDraft(validCounterDraft({
      initialValueFormulaKey: ''
    }), { includeStateKey: true, catalog: CATALOG });
    expect(missingFormula.ok).toBe(false);
    if (missingFormula.ok) throw new Error('expected invalid');
    expect(missingFormula.fieldErrors.initialValueFormulaKey).toBe('请选择初始值公式。');

    const oneOption = validateSkillInternalStateDraft({
      ...createEmptyInternalStateDraft('MODE'),
      stateKey: 'weapon_mode',
      name: '武器模式',
      sortOrder: '0',
      options: [validModeOptions()[0]!]
    }, { includeStateKey: true, catalog: CATALOG });
    expect(oneOption.ok).toBe(false);
    if (oneOption.ok) throw new Error('expected invalid');
    expect(oneOption.fieldErrors.options).toBe('模式至少需要两个选项。');

    const duplicateKey = validateSkillInternalStateDraft({
      ...createEmptyInternalStateDraft('MODE'),
      stateKey: 'weapon_mode',
      name: '武器模式',
      sortOrder: '0',
      options: [
        validModeOptions()[0]!,
        { ...validModeOptions()[1]!, optionKey: 'minigun' }
      ]
    }, { includeStateKey: true, catalog: CATALOG });
    expect(duplicateKey.ok).toBe(false);
    if (duplicateKey.ok) throw new Error('expected invalid');
    expect(duplicateKey.optionErrors[0]?.fieldErrors.optionKey ?? duplicateKey.optionErrors[1]?.fieldErrors.optionKey)
      .toBe('选项标识不能重复。');

    const twoInitial = validateSkillInternalStateDraft({
      ...createEmptyInternalStateDraft('MODE'),
      stateKey: 'weapon_mode',
      name: '武器模式',
      sortOrder: '0',
      options: validModeOptions().map((item) => ({ ...item, initial: true }))
    }, { includeStateKey: true, catalog: CATALOG });
    expect(twoInitial.ok).toBe(false);
    if (twoInitial.ok) throw new Error('expected invalid');
    expect(twoInitial.fieldErrors.options).toBe('必须且只能选择一个初始选项。');
  });

  it('blocks unknown formula refs and maps server option array errors', () => {
    const unknown = validateSkillInternalStateDraft(validCounterDraft({
      maxValueFormulaKey: 'missing_formula'
    }), { includeStateKey: true, catalog: CATALOG });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error('expected invalid');
    expect(unknown.fieldErrors.maxValueFormulaKey).toBe(INCOMPLETE_CATALOG_MESSAGE);

    const failedCatalog = validateSkillInternalStateDraft(validCounterDraft(), {
      includeStateKey: true,
      catalog: CATALOG,
      catalogLoadState: { formulas: 'failed' }
    });
    expect(failedCatalog.ok).toBe(false);
    if (failedCatalog.ok) throw new Error('expected invalid');
    expect(failedCatalog.fieldErrors.initialValueFormulaKey).toBe(INCOMPLETE_CATALOG_MESSAGE);

    const options = listFormulaOptions(CATALOG, 'legacy_zero');
    expect(options.find((item) => item.key === 'legacy_zero')?.source).toBe('unknown');

    const mapped = mapSkillInternalStateFieldIssues(new ApiRequestError('invalid', 400, '400.VALIDATION_FAILED', {
      fieldIssues: [
        { field: 'detail.options[1].initial', message: '必须且只能选择一个初始选项。' },
        { field: 'detail.options[0].optionKey', message: '选项标识已存在。' },
        { field: 'name', message: '名称不合法。' }
      ]
    }));
    expect(mapped.fieldErrors.name).toBe('名称不合法。');
    expect(mapped.optionErrors).toEqual([
      { index: 0, fieldErrors: { optionKey: '选项标识已存在。' } },
      { index: 1, fieldErrors: { initial: '必须且只能选择一个初始选项。' } }
    ]);
  });

  it('keeps stateKey out of update requests and preserves immutable type and scope', () => {
    const normalized = expectValid(validCounterDraft({ originalStateType: 'COUNTER', originalScope: 'SKILL' }));
    expect(buildCreateSkillInternalStateRequest(normalized).stateKey).toBe('focus_stacks');
    expect(buildUpdateSkillInternalStateRequest(normalized)).not.toHaveProperty('stateKey');

    const typeChanged = validateSkillInternalStateDraft(validCounterDraft({
      originalStateType: 'COUNTER',
      stateType: 'FLAG'
    }), { includeStateKey: false, catalog: CATALOG });
    expect(typeChanged.ok).toBe(false);
    if (typeChanged.ok) throw new Error('expected invalid');
    expect(typeChanged.fieldErrors.stateType).toBe('已有内部状态的种类不可修改。');

    const scopeChanged = validateSkillInternalStateDraft(validCounterDraft({
      originalScope: 'SKILL',
      scope: 'TARGET'
    }), { includeStateKey: false, catalog: CATALOG });
    expect(scopeChanged.ok).toBe(false);
    if (scopeChanged.ok) throw new Error('expected invalid');
    expect(scopeChanged.fieldErrors.scope).toBe('已有内部状态的范围不可修改。');
  });
});
