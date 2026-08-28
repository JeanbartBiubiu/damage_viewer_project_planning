import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../../services/apiClient';
import type { SkillEffect, SkillEffectResult } from '../../../../types/skillEffect';
import {
  ATTRIBUTE_CHANGE_OPERATION_LABELS,
  COOLDOWN_CHANGE_AMOUNT_HINT,
  COOLDOWN_CHANGE_OPERATION_LABELS,
  DISABLED_CATALOG_MESSAGE,
  INCOMPLETE_CATALOG_MESSAGE,
  RESOURCE_CHANGE_OPERATION_LABELS,
  SKILL_EFFECT_KEY_PATTERN,
  SKILL_EFFECT_RESULT_TYPE_LABELS,
  STATUS_OPERATION_LABELS,
  applyCooldownOperationChange,
  applyResultTypeChange,
  buildCreateSkillEffectRequest,
  buildUpdateSkillEffectRequest,
  clearHiddenResultFields,
  cooldownChangeAmountHint,
  createEmptyEffectDraft,
  createEmptyResultDraft,
  isCatalogOptionSelectable,
  isValueRuleVisible,
  listAffectedSkillOptions,
  listDamageTypeOptions,
  listFormulaOptions,
  listStatusOptions,
  mapSkillEffectFieldIssues,
  skillEffectResultToDraft,
  skillEffectToDraft,
  sortResultDrafts,
  validateSkillEffectDraft,
  type EffectFormCatalog,
  type SkillEffectDraft,
  type SkillEffectResultDraft
} from './effectForm';

const CATALOG: EffectFormCatalog = {
  parentSkillKey: 'ezreal_q',
  formulas: [
    { formulaKey: 'damage' },
    { formulaKey: 'heal' },
    { formulaKey: 'cooldown_reduction_ms' }
  ],
  damageTypes: [
    { damageTypeKey: 'physical', status: 'ENABLED' },
    { damageTypeKey: 'true', status: 'DISABLED' }
  ],
  attributes: [
    { attributeKey: 'move_speed', status: 'ENABLED' },
    { attributeKey: 'mana', status: 'ENABLED' },
    { attributeKey: 'old_attr', status: 'DISABLED' }
  ],
  skills: [
    { skillKey: 'ezreal_q', status: 'DISABLED' },
    { skillKey: 'ezreal_w', status: 'ENABLED' },
    { skillKey: 'retired_skill', status: 'DISABLED' }
  ],
  statuses: [
    { statusKey: 'poison', status: 'ENABLED' },
    { statusKey: 'old_poison', status: 'DISABLED' }
  ]
};

const EFFECT: SkillEffect = {
  gameId: 'lol',
  skillKey: 'ezreal_q',
  effectKey: 'on_hit_results',
  name: '命中结果',
  description: null,
  sortOrder: 10,
  createdAt: '2026-08-27T00:00:00Z',
  updatedAt: '2026-08-27T00:00:00Z',
  results: [
    {
      resultKey: 'damage',
      name: '造成物理伤害',
      resultType: 'DAMAGE',
      target: 'TARGET',
      description: null,
      sortOrder: 10,
      valueRule: {
        formulaKey: 'damage',
        fixedMultiplier: 1,
        fixedMinValue: null,
        fixedMaxValue: null
      },
      detail: { damageTypeKey: 'physical' }
    },
    {
      resultKey: 'self_cooldown_reduction',
      name: '减少自身冷却',
      resultType: 'COOLDOWN_CHANGE',
      target: 'SOURCE',
      description: null,
      sortOrder: 20,
      valueRule: {
        formulaKey: 'cooldown_reduction_ms',
        fixedMultiplier: 1,
        fixedMinValue: 0,
        fixedMaxValue: null
      },
      detail: { affectedSkillKey: 'ezreal_q', operation: 'REDUCE' }
    }
  ]
};

function validDamageDraft(overrides: Partial<SkillEffectResultDraft> = {}): SkillEffectResultDraft {
  return {
    ...createEmptyResultDraft('DAMAGE'),
    resultKey: 'damage',
    name: '造成物理伤害',
    target: 'TARGET',
    sortOrder: '10',
    formulaKey: 'damage',
    fixedMultiplier: '1',
    damageTypeKey: 'physical',
    ...overrides
  };
}

function validEffectDraft(
  results: SkillEffectResultDraft[] = [validDamageDraft()],
  overrides: Partial<SkillEffectDraft> = {}
): SkillEffectDraft {
  return {
    effectKey: 'on_hit_results',
    name: '命中结果',
    description: '',
    sortOrder: '10',
    results,
    ...overrides
  };
}

function expectValid(draft: SkillEffectDraft, includeEffectKey = true) {
  const result = validateSkillEffectDraft(draft, { includeEffectKey, catalog: CATALOG });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected valid draft: ${JSON.stringify(result)}`);
  }
  return result.normalized;
}

describe('skill effect form defaults and conversion', () => {
  it('creates empty effect and result drafts with stable defaults', () => {
    expect(createEmptyEffectDraft()).toEqual({
      effectKey: '',
      name: '',
      description: '',
      sortOrder: '0',
      results: []
    });
    expect(createEmptyResultDraft()).toMatchObject({
      resultType: 'DAMAGE',
      target: 'TARGET',
      fixedMultiplier: '1',
      originalResultType: null,
      originalDamageTypeKey: null
    });
    expect(SKILL_EFFECT_RESULT_TYPE_LABELS.STATUS_OPERATION).toBe('状态操作');
    expect(ATTRIBUTE_CHANGE_OPERATION_LABELS.SET).toBe('覆盖');
    expect(RESOURCE_CHANGE_OPERATION_LABELS.REFUND).toBe('返还');
    expect(COOLDOWN_CHANGE_OPERATION_LABELS.RESET).toBe('重置为可用');
    expect(STATUS_OPERATION_LABELS.REMOVE).toBe('移除');
  });

  it('converts an effect detail into drafts and keeps original catalog refs', () => {
    const draft = skillEffectToDraft(EFFECT);
    expect(draft.effectKey).toBe('on_hit_results');
    expect(draft.description).toBe('');
    expect(draft.results).toHaveLength(2);
    expect(draft.results[0]).toMatchObject({
      resultType: 'DAMAGE',
      damageTypeKey: 'physical',
      originalResultType: 'DAMAGE',
      originalDamageTypeKey: 'physical',
      statusKey: '',
      affectedSkillKey: ''
    });
    expect(draft.results[1]).toMatchObject({
      resultType: 'COOLDOWN_CHANGE',
      cooldownOperation: 'REDUCE',
      affectedSkillKey: 'ezreal_q',
      originalAffectedSkillKey: 'ezreal_q',
      formulaKey: 'cooldown_reduction_ms',
      fixedMinValue: '0'
    });
  });
});

describe('skill effect form normalization and request building', () => {
  it('trims text, turns blank description into null and builds create/update bodies', () => {
    const normalized = expectValid(
      validEffectDraft([validDamageDraft({ name: '  造成物理伤害  ', description: '   ' })], {
        effectKey: '  on_hit_results  ',
        name: '  命中结果  ',
        description: '   ',
        sortOrder: ' 10 '
      })
    );

    expect(normalized).toEqual({
      effectKey: 'on_hit_results',
      name: '命中结果',
      description: null,
      sortOrder: 10,
      results: [
        {
          resultKey: 'damage',
          name: '造成物理伤害',
          resultType: 'DAMAGE',
          target: 'TARGET',
          description: null,
          sortOrder: 10,
          valueRule: {
            formulaKey: 'damage',
            fixedMultiplier: 1,
            fixedMinValue: null,
            fixedMaxValue: null
          },
          detail: { damageTypeKey: 'physical' }
        }
      ]
    });

    expect(buildCreateSkillEffectRequest(normalized)).toEqual({
      effectKey: 'on_hit_results',
      name: '命中结果',
      description: null,
      sortOrder: 10,
      results: normalized.results
    });
    const updateBody = buildUpdateSkillEffectRequest(normalized);
    expect(updateBody).toEqual({
      name: '命中结果',
      description: null,
      sortOrder: 10,
      results: normalized.results
    });
    expect(updateBody).not.toHaveProperty('effectKey');
  });

  it('builds all seven strongly typed result requests and drops hidden fields', () => {
    const heal = createEmptyResultDraft('DIRECT_HEAL');
    heal.resultKey = 'heal';
    heal.name = '直接治疗';
    heal.formulaKey = 'heal';
    heal.damageTypeKey = 'should_not_leak';
    heal.statusKey = 'poison';

    const shield = createEmptyResultDraft('NORMAL_SHIELD');
    shield.resultKey = 'shield';
    shield.name = '普通护盾';
    shield.formulaKey = 'heal';

    const attribute = createEmptyResultDraft('ATTRIBUTE_CHANGE');
    attribute.resultKey = 'slow';
    attribute.name = '减少移速';
    attribute.formulaKey = 'damage';
    attribute.attributeKey = 'move_speed';
    attribute.attributeOperation = 'DECREASE';

    const resource = createEmptyResultDraft('RESOURCE_CHANGE');
    resource.resultKey = 'mana';
    resource.name = '恢复法力';
    resource.formulaKey = 'heal';
    resource.attributeKey = 'mana';
    resource.resourceOperation = 'RESTORE';

    const cooldown = createEmptyResultDraft('COOLDOWN_CHANGE');
    cooldown.resultKey = 'cdr';
    cooldown.name = '减少冷却';
    cooldown.formulaKey = 'cooldown_reduction_ms';
    cooldown.affectedSkillKey = 'ezreal_q';
    cooldown.cooldownOperation = 'REDUCE';
    cooldown.damageTypeKey = 'physical';

    const reset = applyCooldownOperationChange(
      { ...cooldown, resultKey: 'reset', name: '重置冷却' },
      'RESET'
    );

    const status = createEmptyResultDraft('STATUS_OPERATION');
    status.resultKey = 'poison';
    status.name = '施加中毒';
    status.statusKey = 'poison';
    status.statusOperation = 'APPLY';
    status.formulaKey = 'damage';
    status.fixedMultiplier = '2';

    const normalized = expectValid(
      validEffectDraft([
        validDamageDraft(),
        heal,
        shield,
        attribute,
        resource,
        cooldown,
        reset,
        status
      ])
    );

    expect(normalized.results.map((item) => item.resultType)).toEqual([
      'DAMAGE',
      'DIRECT_HEAL',
      'NORMAL_SHIELD',
      'ATTRIBUTE_CHANGE',
      'RESOURCE_CHANGE',
      'COOLDOWN_CHANGE',
      'COOLDOWN_CHANGE',
      'STATUS_OPERATION'
    ]);
    expect(normalized.results[1]).toEqual({
      resultKey: 'heal',
      name: '直接治疗',
      resultType: 'DIRECT_HEAL',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      valueRule: {
        formulaKey: 'heal',
        fixedMultiplier: 1,
        fixedMinValue: null,
        fixedMaxValue: null
      },
      detail: {}
    });
    expect(Object.keys(normalized.results[1]!.detail)).toEqual([]);
    expect(normalized.results[2]).toMatchObject({ resultType: 'NORMAL_SHIELD', detail: {} });
    expect(normalized.results[3]).toEqual({
      resultKey: 'slow',
      name: '减少移速',
      resultType: 'ATTRIBUTE_CHANGE',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      valueRule: {
        formulaKey: 'damage',
        fixedMultiplier: 1,
        fixedMinValue: null,
        fixedMaxValue: null
      },
      detail: { attributeKey: 'move_speed', operation: 'DECREASE' }
    });
    expect(normalized.results[4]).toMatchObject({
      resultType: 'RESOURCE_CHANGE',
      detail: { attributeKey: 'mana', operation: 'RESTORE' }
    });
    expect(normalized.results[5]).toMatchObject({
      resultType: 'COOLDOWN_CHANGE',
      valueRule: { formulaKey: 'cooldown_reduction_ms', fixedMultiplier: 1 },
      detail: { affectedSkillKey: 'ezreal_q', operation: 'REDUCE' }
    });
    expect(normalized.results[5]).not.toHaveProperty('damageTypeKey');
    expect(normalized.results[6]).toEqual({
      resultKey: 'reset',
      name: '重置冷却',
      resultType: 'COOLDOWN_CHANGE',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      valueRule: null,
      detail: { affectedSkillKey: 'ezreal_q', operation: 'RESET' }
    });
    expect(normalized.results[7]).toEqual({
      resultKey: 'poison',
      name: '施加中毒',
      resultType: 'STATUS_OPERATION',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      valueRule: null,
      detail: { statusKey: 'poison', operation: 'APPLY' }
    });
  });
});

describe('skill effect form validation', () => {
  it('accepts the frozen lowercase stable-key grammar', () => {
    expect(SKILL_EFFECT_KEY_PATTERN.test('on_hit_results')).toBe(true);
    expect(SKILL_EFFECT_KEY_PATTERN.test('OnHit')).toBe(false);
    expect(SKILL_EFFECT_KEY_PATTERN.test('1damage')).toBe(false);
  });

  it('requires at least one result and unique result keys', () => {
    const empty = validateSkillEffectDraft(validEffectDraft([]), {
      includeEffectKey: true,
      catalog: CATALOG
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) throw new Error('expected invalid');
    expect(empty.fieldErrors.results).toBe('至少需要一个结果。');

    const duplicated = validateSkillEffectDraft(
      validEffectDraft([
        validDamageDraft(),
        validDamageDraft({ name: '另一伤害' })
      ]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(duplicated.ok).toBe(false);
    if (duplicated.ok) throw new Error('expected invalid');
    expect(duplicated.resultErrors).toEqual([
      { index: 1, fieldErrors: { resultKey: '结果标识不能重复。' } }
    ]);
  });

  it('rejects changing the original result type', () => {
    const draft = skillEffectResultToDraft(EFFECT.results[0]!);
    const changed = applyResultTypeChange(draft, 'DIRECT_HEAL');
    const result = validateSkillEffectDraft(validEffectDraft([changed]), {
      includeEffectKey: false,
      catalog: CATALOG
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid');
    expect(result.resultErrors[0]?.fieldErrors.resultType).toBe('已有结果的种类不可修改。');
  });

  it('requires value rules for numeric results and rejects min greater than max', () => {
    const missingFormula = validateSkillEffectDraft(
      validEffectDraft([validDamageDraft({ formulaKey: '' })]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(missingFormula.ok).toBe(false);
    if (missingFormula.ok) throw new Error('expected invalid');
    expect(missingFormula.resultErrors[0]?.fieldErrors.formulaKey).toBe('请选择数值公式。');

    const negativeMultiplier = validateSkillEffectDraft(
      validEffectDraft([validDamageDraft({ fixedMultiplier: '-1' })]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(negativeMultiplier.ok).toBe(false);
    if (negativeMultiplier.ok) throw new Error('expected invalid');
    expect(negativeMultiplier.resultErrors[0]?.fieldErrors.fixedMultiplier).toBe(
      '固定倍率必须大于等于 0。'
    );

    const invertedRange = validateSkillEffectDraft(
      validEffectDraft([validDamageDraft({ fixedMinValue: '8', fixedMaxValue: '3' })]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(invertedRange.ok).toBe(false);
    if (invertedRange.ok) throw new Error('expected invalid');
    expect(invertedRange.resultErrors[0]?.fieldErrors.fixedMinValue).toBe(
      '固定最小值不能大于固定最大值。'
    );
  });

  it('clears hidden fields, hides value rules for cooldown reset and status operation, and exposes the millisecond hint', () => {
    const switched = applyResultTypeChange(validDamageDraft({ statusKey: 'poison' }), 'STATUS_OPERATION');
    expect(switched).toMatchObject({
      resultType: 'STATUS_OPERATION',
      damageTypeKey: '',
      formulaKey: '',
      fixedMultiplier: '',
      statusOperation: 'APPLY'
    });
    expect(isValueRuleVisible(switched)).toBe(false);
    expect(clearHiddenResultFields({ ...switched, formulaKey: 'damage', damageTypeKey: 'physical' })).toMatchObject({
      formulaKey: '',
      damageTypeKey: '',
      statusKey: ''
    });

    const reduce = createEmptyResultDraft('COOLDOWN_CHANGE');
    reduce.cooldownOperation = 'REDUCE';
    expect(cooldownChangeAmountHint(reduce)).toBe(COOLDOWN_CHANGE_AMOUNT_HINT);
    const reset = applyCooldownOperationChange(reduce, 'RESET');
    expect(reset.formulaKey).toBe('');
    expect(reset.fixedMultiplier).toBe('');
    expect(isValueRuleVisible(reset)).toBe(false);
    expect(cooldownChangeAmountHint(reset)).toBeNull();
  });
});

describe('skill effect catalog refs', () => {
  it('keeps existing disabled refs, blocks new disabled refs, and always allows the parent skill', () => {
    const retainedDamage = validateSkillEffectDraft(
      validEffectDraft([
        validDamageDraft({
          damageTypeKey: 'true',
          originalResultType: 'DAMAGE',
          originalDamageTypeKey: 'true'
        })
      ]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(retainedDamage.ok).toBe(true);

    const newDisabledDamage = validateSkillEffectDraft(
      validEffectDraft([validDamageDraft({ damageTypeKey: 'true' })]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(newDisabledDamage.ok).toBe(false);
    if (newDisabledDamage.ok) throw new Error('expected invalid');
    expect(newDisabledDamage.resultErrors[0]?.fieldErrors.damageTypeKey).toBe(DISABLED_CATALOG_MESSAGE);

    const newParentCooldown = createEmptyResultDraft('COOLDOWN_CHANGE');
    newParentCooldown.resultKey = 'self_cd';
    newParentCooldown.name = '自身冷却';
    newParentCooldown.formulaKey = 'cooldown_reduction_ms';
    newParentCooldown.affectedSkillKey = 'ezreal_q';
    expect(
      validateSkillEffectDraft(validEffectDraft([newParentCooldown]), {
        includeEffectKey: true,
        catalog: CATALOG
      }).ok
    ).toBe(true);

    const editParentCooldown = {
      ...newParentCooldown,
      originalResultType: 'COOLDOWN_CHANGE' as const,
      originalAffectedSkillKey: 'ezreal_w'
    };
    expect(
      validateSkillEffectDraft(validEffectDraft([editParentCooldown]), {
        includeEffectKey: false,
        catalog: CATALOG
      }).ok
    ).toBe(true);

    const otherDisabled = validateSkillEffectDraft(
      validEffectDraft([{ ...newParentCooldown, affectedSkillKey: 'retired_skill' }]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(otherDisabled.ok).toBe(false);
    if (otherDisabled.ok) throw new Error('expected invalid');
    expect(otherDisabled.resultErrors[0]?.fieldErrors.affectedSkillKey).toBe(DISABLED_CATALOG_MESSAGE);

    const retainOtherDisabled = validateSkillEffectDraft(
      validEffectDraft([
        {
          ...newParentCooldown,
          affectedSkillKey: 'retired_skill',
          originalResultType: 'COOLDOWN_CHANGE',
          originalAffectedSkillKey: 'retired_skill'
        }
      ]),
      { includeEffectKey: false, catalog: CATALOG }
    );
    expect(retainOtherDisabled.ok).toBe(true);
  });

  it('lists enabled options, retained disabled refs, parent self-ref, and unknown keys that block save', () => {
    const newSkillOptions = listAffectedSkillOptions(CATALOG);
    expect(newSkillOptions.map((item) => item.key)).toEqual(['ezreal_w', 'ezreal_q']);
    expect(newSkillOptions.find((item) => item.key === 'ezreal_q')?.source).toBe('parent-skill-self-ref');
    expect(newSkillOptions.some((item) => item.key === 'retired_skill')).toBe(false);

    const retainedOptions = listAffectedSkillOptions(CATALOG, 'retired_skill', 'retired_skill');
    expect(retainedOptions.some((item) => item.key === 'retired_skill' && item.source === 'retained-disabled')).toBe(
      true
    );

    const damageOptions = listDamageTypeOptions(CATALOG, 'true', 'true');
    expect(damageOptions.some((item) => item.key === 'true' && item.source === 'retained-disabled')).toBe(true);
    expect(listDamageTypeOptions(CATALOG).some((item) => item.key === 'true')).toBe(false);

    const unknown = listFormulaOptions(CATALOG, 'missing_formula');
    const missing = unknown.find((item) => item.key === 'missing_formula');
    expect(missing?.source).toBe('unknown');
    expect(isCatalogOptionSelectable(missing!)).toBe(false);

    const blocked = validateSkillEffectDraft(
      validEffectDraft([validDamageDraft({ formulaKey: 'missing_formula' })]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error('expected invalid');
    expect(blocked.resultErrors[0]?.fieldErrors.formulaKey).toBe(INCOMPLETE_CATALOG_MESSAGE);

    const failedCatalog = validateSkillEffectDraft(validEffectDraft(), {
      includeEffectKey: true,
      catalog: CATALOG,
      catalogLoadState: { statuses: 'failed' }
    });
    expect(failedCatalog.ok).toBe(true);

    const statusDraft = createEmptyResultDraft('STATUS_OPERATION');
    statusDraft.resultKey = 'apply_poison';
    statusDraft.name = '施加中毒';
    statusDraft.statusKey = 'poison';
    const failedStatus = validateSkillEffectDraft(validEffectDraft([statusDraft]), {
      includeEffectKey: true,
      catalog: CATALOG,
      catalogLoadState: { statuses: 'failed' }
    });
    expect(failedStatus.ok).toBe(false);
    if (failedStatus.ok) throw new Error('expected invalid');
    expect(failedStatus.resultErrors[0]?.fieldErrors.statusKey).toBe(INCOMPLETE_CATALOG_MESSAGE);

    expect(listStatusOptions(CATALOG).map((item) => item.key)).toEqual(['poison']);
  });
});

describe('skill effect API field issue mapping', () => {
  it('maps effect fields and submitted results[index] paths', () => {
    const submitted = [
      { resultType: 'DAMAGE' as const },
      { resultType: 'ATTRIBUTE_CHANGE' as const },
      { resultType: 'COOLDOWN_CHANGE' as const }
    ];
    const error = new ApiRequestError('效果信息不合法', 400, '400.VALIDATION_FAILED', {
      fieldIssues: [
        { field: 'effectKey', code: 'FORMAT_INVALID', message: ' 效果标识不合法 ' },
        { field: 'name', code: 'LENGTH_INVALID', message: '效果名称不能超过 100 个字符' },
        { field: 'results[0].valueRule.formulaKey', code: 'UNKNOWN_FORMULA', message: '公式不存在' },
        { field: 'results[0].detail.damageTypeKey', code: 'UNKNOWN_DAMAGE_TYPE', message: '伤害类型不存在' },
        { field: 'results[1].detail.operation', code: 'ENUM_INVALID', message: '操作不合法' },
        { field: 'results[1].resultType', code: 'IMMUTABLE', message: '结果种类不可修改' },
        { field: 'results[2].detail.affectedSkillKey', code: 'UNKNOWN_SKILL', message: '技能不存在' },
        { field: 'gameId', code: 'NOT_FOUND', message: '游戏不存在' }
      ]
    });

    expect(mapSkillEffectFieldIssues(error, submitted)).toEqual({
      fieldErrors: {
        effectKey: '效果标识不合法',
        name: '效果名称不能超过 100 个字符'
      },
      resultErrors: [
        {
          index: 0,
          fieldErrors: {
            formulaKey: '公式不存在',
            damageTypeKey: '伤害类型不存在'
          }
        },
        {
          index: 1,
          fieldErrors: {
            attributeOperation: '操作不合法',
            resultType: '结果种类不可修改'
          }
        },
        {
          index: 2,
          fieldErrors: {
            affectedSkillKey: '技能不存在'
          }
        }
      ],
      unmappedMessages: ['游戏不存在']
    });
  });

  it('maps results[index] without a nested field and ignores malformed details', () => {
    expect(mapSkillEffectFieldIssues(null)).toEqual({
      fieldErrors: {},
      resultErrors: [],
      unmappedMessages: []
    });
    expect(
      mapSkillEffectFieldIssues({
        fieldIssues: [
          null,
          { field: 'results[0]', code: 'INVALID', message: '   ' },
          { field: 'results[9].detail.damageTypeKey', code: 'UNKNOWN', message: '越界仍按提交下标映射' }
        ]
      })
    ).toEqual({
      fieldErrors: {},
      resultErrors: [
        { index: 0, fieldErrors: { resultKey: '字段值不合法。' } },
        { index: 9, fieldErrors: { damageTypeKey: '越界仍按提交下标映射' } }
      ],
      unmappedMessages: []
    });
  });
});

describe('skill effect draft sorting', () => {
  it('sorts result drafts by sortOrder then resultKey', () => {
    const sorted = sortResultDrafts([
      validDamageDraft({ resultKey: 'b', sortOrder: '10' }),
      validDamageDraft({ resultKey: 'a', sortOrder: '10' }),
      validDamageDraft({ resultKey: 'c', sortOrder: '5' })
    ]);
    expect(sorted.map((item) => item.resultKey)).toEqual(['c', 'a', 'b']);
  });
});

describe('skill effect result conversion coverage', () => {
  it('converts heal, shield, attribute, resource, reset and status results', () => {
    const results: SkillEffectResult[] = [
      {
        resultKey: 'heal',
        name: '治疗',
        resultType: 'DIRECT_HEAL',
        target: 'SOURCE',
        description: 'desc',
        sortOrder: 1,
        valueRule: { formulaKey: 'heal', fixedMultiplier: 1.5, fixedMinValue: 1, fixedMaxValue: 9 },
        detail: {}
      },
      {
        resultKey: 'shield',
        name: '护盾',
        resultType: 'NORMAL_SHIELD',
        target: 'SOURCE',
        description: null,
        sortOrder: 2,
        valueRule: { formulaKey: 'heal', fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: {}
      },
      {
        resultKey: 'attr',
        name: '属性',
        resultType: 'ATTRIBUTE_CHANGE',
        target: 'TARGET',
        description: null,
        sortOrder: 3,
        valueRule: { formulaKey: 'damage', fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: { attributeKey: 'old_attr', operation: 'SET' }
      },
      {
        resultKey: 'res',
        name: '资源',
        resultType: 'RESOURCE_CHANGE',
        target: 'SOURCE',
        description: null,
        sortOrder: 4,
        valueRule: { formulaKey: 'heal', fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: { attributeKey: 'mana', operation: 'CONSUME' }
      },
      {
        resultKey: 'reset',
        name: '重置',
        resultType: 'COOLDOWN_CHANGE',
        target: 'SOURCE',
        description: null,
        sortOrder: 5,
        valueRule: null,
        detail: { affectedSkillKey: 'ezreal_w', operation: 'RESET' }
      },
      {
        resultKey: 'cc',
        name: '状态',
        resultType: 'STATUS_OPERATION',
        target: 'TARGET',
        description: null,
        sortOrder: 6,
        valueRule: null,
        detail: { statusKey: 'old_poison', operation: 'REMOVE' }
      }
    ];

    const drafts = results.map(skillEffectResultToDraft);
    expect(drafts[0]).toMatchObject({
      formulaKey: 'heal',
      fixedMultiplier: '1.5',
      fixedMinValue: '1',
      fixedMaxValue: '9',
      originalResultType: 'DIRECT_HEAL'
    });
    expect(drafts[2]).toMatchObject({
      attributeOperation: 'SET',
      originalAttributeKey: 'old_attr'
    });
    expect(drafts[4]).toMatchObject({
      cooldownOperation: 'RESET',
      formulaKey: '',
      originalAffectedSkillKey: 'ezreal_w'
    });
    expect(drafts[5]).toMatchObject({
      statusOperation: 'REMOVE',
      originalStatusKey: 'old_poison',
      formulaKey: ''
    });

    const retained = validateSkillEffectDraft(
      validEffectDraft([drafts[2]!, drafts[5]!]),
      { includeEffectKey: false, catalog: CATALOG }
    );
    expect(retained.ok).toBe(true);
  });
});
