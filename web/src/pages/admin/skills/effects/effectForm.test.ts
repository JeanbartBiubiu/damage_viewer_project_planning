import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../../services/apiClient';
import type {
  SkillEffect,
  SkillEffectLifecycle,
  SkillEffectResult,
  SkillEffectResultLifecycleBehavior
} from '../../../../types/skillEffect';
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
  applyDurationFormulaChange,
  applyLifecycleMomentChange,
  applyLifecycleOperationChange,
  applyResultTypeChange,
  applyStackValueModeChange,
  buildCreateSkillEffectRequest,
  buildUpdateSkillEffectRequest,
  clearHiddenResultFields,
  cooldownChangeAmountHint,
  createEmptyEffectDraft,
  createEmptyLifecycleBehaviorDraft,
  createEmptyResultDraft,
  disableLifecycleDraft,
  enableLifecycleDraft,
  isCatalogOptionSelectable,
  isInstanceScopeLocked,
  isValueRuleVisible,
  listAffectedSkillOptions,
  listAllowedLifecycleMoments,
  listDamageTypeOptions,
  listFormulaOptions,
  listLifecycleTargetOptions,
  listStatusOptions,
  mapSkillEffectFieldIssues,
  normalizeEffectDraftForDirtyComparison,
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
    { formulaKey: 'cooldown_reduction_ms' },
    { formulaKey: 'one' },
    { formulaKey: 'poison_duration_ms' },
    { formulaKey: 'poison_tick_interval_ms' }
  ],
  effects: [
    { effectKey: 'toxic_trap', name: '剧毒陷阱', lifecycleEnabled: true },
    { effectKey: 'plain_hit', name: '普通命中', lifecycleEnabled: false }
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

const NULL_BEHAVIOR = null as SkillEffectResult['lifecycleBehavior'];

const EFFECT: SkillEffect = {
  gameId: 'lol',
  skillKey: 'ezreal_q',
  effectKey: 'on_hit_results',
  name: '命中结果',
  description: null,
  sortOrder: 10,
  lifecycle: null,
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
      lifecycleBehavior: NULL_BEHAVIOR,
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
      lifecycleBehavior: NULL_BEHAVIOR,
      valueRule: {
        formulaKey: 'cooldown_reduction_ms',
        fixedMultiplier: 1,
        fixedMinValue: 0,
        fixedMaxValue: null
      },
      detail: { affectedSkillKeys: ['ezreal_q'], operation: 'REDUCE' }
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
    lifecycleEnabled: false,
    lifecycle: createEmptyEffectDraft().lifecycle,
    originalLifecycleEnabled: false,
    originalInstanceScope: '',
    results,
    ...overrides
  };
}

function validLifecycle(): SkillEffectLifecycle {
  return {
    durationFormulaKey: 'poison_duration_ms',
    maxStacksFormulaKey: 'one',
    applicationStacksFormulaKey: 'one',
    instanceScope: 'SOURCE_TARGET',
    reapplicationStackMode: 'KEEP',
    reapplicationDurationMode: 'REFRESH_ALL',
    expiryMode: 'ALL_AT_ONCE',
    periodicIntervalFormulaKey: null,
    firstPeriodicExecution: null
  };
}

function applicationSnapshot(): SkillEffectResultLifecycleBehavior {
  return {
    moment: 'APPLICATION',
    valueReadMode: 'APPLICATION_SNAPSHOT',
    stackValueMode: null,
    reapplicationValueMode: null,
    periodicExecutionMode: null
  };
}

function withBehavior(
  draft: SkillEffectResultDraft,
  behavior: Partial<SkillEffectResultDraft['lifecycleBehavior']> = {}
): SkillEffectResultDraft {
  return applyLifecycleMomentChange(
    {
      ...draft,
      lifecycleBehavior: {
        ...createEmptyLifecycleBehaviorDraft(),
        ...behavior
      }
    },
    (behavior.moment ?? 'APPLICATION') as SkillEffectResultDraft['lifecycleBehavior']['moment']
  );
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
      lifecycleEnabled: false,
      lifecycle: {
        durationFormulaKey: '',
        maxStacksFormulaKey: '',
        applicationStacksFormulaKey: '',
        instanceScope: '',
        reapplicationStackMode: '',
        reapplicationDurationMode: '',
        expiryMode: '',
        periodicIntervalFormulaKey: '',
        firstPeriodicExecution: ''
      },
      originalLifecycleEnabled: false,
      originalInstanceScope: '',
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
    expect(SKILL_EFFECT_RESULT_TYPE_LABELS.LIFECYCLE_OPERATION).toBe('生命周期操作');
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
      affectedSkillKeys: []
    });
    expect(draft.results[1]).toMatchObject({
      resultType: 'COOLDOWN_CHANGE',
      cooldownOperation: 'REDUCE',
      affectedSkillKeys: ['ezreal_q'],
      originalAffectedSkillKeys: ['ezreal_q'],
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
      lifecycle: null,
      results: [
        {
          resultKey: 'damage',
          name: '造成物理伤害',
          resultType: 'DAMAGE',
          target: 'TARGET',
          description: null,
          sortOrder: 10,
          lifecycleBehavior: null,
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
      lifecycle: null,
      results: normalized.results
    });
    const updateBody = buildUpdateSkillEffectRequest(normalized);
    expect(updateBody).toEqual({
      name: '命中结果',
      description: null,
      sortOrder: 10,
      lifecycle: null,
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
    cooldown.affectedSkillKeys = ['ezreal_q', 'ezreal_w'];
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
      lifecycleBehavior: null,
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
      lifecycleBehavior: null,
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
      detail: { affectedSkillKeys: ['ezreal_q', 'ezreal_w'], operation: 'REDUCE' }
    });
    expect(normalized.results[5]).not.toHaveProperty('damageTypeKey');
    expect(normalized.results[6]).toEqual({
      resultKey: 'reset',
      name: '重置冷却',
      resultType: 'COOLDOWN_CHANGE',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      lifecycleBehavior: null,
      valueRule: null,
      detail: { affectedSkillKeys: ['ezreal_q', 'ezreal_w'], operation: 'RESET' }
    });
    expect(normalized.results[7]).toEqual({
      resultKey: 'poison',
      name: '施加中毒',
      resultType: 'STATUS_OPERATION',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      lifecycleBehavior: null,
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

  it('requires at least one cooldown target and rejects normalized duplicates', () => {
    const cooldown = createEmptyResultDraft('COOLDOWN_CHANGE');
    cooldown.resultKey = 'reduce_abilities';
    cooldown.name = '减少技能冷却';
    cooldown.formulaKey = 'cooldown_reduction_ms';

    const empty = validateSkillEffectDraft(validEffectDraft([cooldown]), {
      includeEffectKey: true,
      catalog: CATALOG
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) throw new Error('expected invalid');
    expect(empty.resultErrors[0]?.fieldErrors.affectedSkillKeys).toBe('请至少选择一个受影响技能。');

    const duplicate = validateSkillEffectDraft(
      validEffectDraft([{ ...cooldown, affectedSkillKeys: ['ezreal_w', ' ezreal_w '] }]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error('expected invalid');
    expect(duplicate.resultErrors[0]?.fieldErrors.affectedSkillKeys).toBe('受影响技能不能重复。');
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
    newParentCooldown.affectedSkillKeys = ['ezreal_q'];
    expect(
      validateSkillEffectDraft(validEffectDraft([newParentCooldown]), {
        includeEffectKey: true,
        catalog: CATALOG
      }).ok
    ).toBe(true);

    const editParentCooldown = {
      ...newParentCooldown,
      originalResultType: 'COOLDOWN_CHANGE' as const,
      originalAffectedSkillKeys: ['ezreal_w']
    };
    expect(
      validateSkillEffectDraft(validEffectDraft([editParentCooldown]), {
        includeEffectKey: false,
        catalog: CATALOG
      }).ok
    ).toBe(true);

    const otherDisabled = validateSkillEffectDraft(
      validEffectDraft([{ ...newParentCooldown, affectedSkillKeys: ['retired_skill'] }]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(otherDisabled.ok).toBe(false);
    if (otherDisabled.ok) throw new Error('expected invalid');
    expect(otherDisabled.resultErrors[0]?.fieldErrors.affectedSkillKeys).toBe(DISABLED_CATALOG_MESSAGE);

    const retainOtherDisabled = validateSkillEffectDraft(
      validEffectDraft([
        {
          ...newParentCooldown,
          affectedSkillKeys: ['retired_skill'],
          originalResultType: 'COOLDOWN_CHANGE',
          originalAffectedSkillKeys: ['retired_skill']
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

    const retainedOptions = listAffectedSkillOptions(CATALOG, ['retired_skill'], ['retired_skill']);
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
        { field: 'results[2].detail.affectedSkillKeys[1]', code: 'UNKNOWN_SKILL', message: '技能不存在' },
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
            affectedSkillKeys: '技能不存在'
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

  it('treats cooldown target order as a set for dirty comparison', () => {
    const cooldown = createEmptyResultDraft('COOLDOWN_CHANGE');
    cooldown.affectedSkillKeys = ['ezreal_w', 'ezreal_q'];
    cooldown.originalAffectedSkillKeys = ['ezreal_w', 'ezreal_q'];
    const left = validEffectDraft([cooldown]);
    const right = validEffectDraft([{
      ...cooldown,
      affectedSkillKeys: ['ezreal_q', 'ezreal_w'],
      originalAffectedSkillKeys: ['ezreal_q', 'ezreal_w']
    }]);

    expect(normalizeEffectDraftForDirtyComparison(left)).toEqual(
      normalizeEffectDraftForDirtyComparison(right)
    );
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
        lifecycleBehavior: null,
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
        lifecycleBehavior: null,
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
        lifecycleBehavior: null,
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
        lifecycleBehavior: null,
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
        lifecycleBehavior: null,
        valueRule: null,
        detail: { affectedSkillKeys: ['ezreal_w'], operation: 'RESET' }
      },
      {
        resultKey: 'cc',
        name: '状态',
        resultType: 'STATUS_OPERATION',
        target: 'TARGET',
        description: null,
        sortOrder: 6,
        lifecycleBehavior: null,
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
      originalAffectedSkillKeys: ['ezreal_w']
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

function lifecycleEnabledDraft(
  results: SkillEffectResultDraft[],
  lifecycleOverrides: Partial<SkillEffectDraft['lifecycle']> = {}
): SkillEffectDraft {
  const enabled = enableLifecycleDraft(validEffectDraft(results));
  return {
    ...enabled,
    lifecycle: {
      durationFormulaKey: 'poison_duration_ms',
      maxStacksFormulaKey: 'one',
      applicationStacksFormulaKey: 'one',
      instanceScope: 'SOURCE_TARGET',
      reapplicationStackMode: 'KEEP',
      reapplicationDurationMode: 'REFRESH_ALL',
      expiryMode: 'ALL_AT_ONCE',
      periodicIntervalFormulaKey: '',
      firstPeriodicExecution: '',
      ...lifecycleOverrides
    }
  };
}

describe('skill effect lifecycle drafts', () => {
  it('converts null lifecycle and enabled lifecycle without rewriting instance scope', () => {
    const empty = skillEffectToDraft(EFFECT);
    expect(empty.lifecycleEnabled).toBe(false);
    expect(empty.originalLifecycleEnabled).toBe(false);
    expect(empty.results[0]?.lifecycleBehavior.moment).toBe('');

    const enabled: SkillEffect = {
      ...EFFECT,
      lifecycle: validLifecycle(),
      results: EFFECT.results.map((item) => ({
        ...item,
        lifecycleBehavior: applicationSnapshot()
      }))
    };
    const draft = skillEffectToDraft(enabled);
    expect(draft.lifecycleEnabled).toBe(true);
    expect(draft.originalInstanceScope).toBe('SOURCE_TARGET');
    expect(isInstanceScopeLocked(draft)).toBe(true);
    expect(draft.results[0]?.lifecycleBehavior).toMatchObject({
      moment: 'APPLICATION',
      valueReadMode: 'APPLICATION_SNAPSHOT'
    });
  });

  it('enables and disables lifecycle without deleting results', () => {
    const enabled = enableLifecycleDraft(validEffectDraft());
    expect(enabled.lifecycleEnabled).toBe(true);
    expect(enabled.lifecycle.expiryMode).toBe('EXPLICIT_ONLY');
    expect(enabled.results).toHaveLength(1);

    const disabled = disableLifecycleDraft({
      ...enabled,
      results: [withBehavior(enabled.results[0]!, { moment: 'APPLICATION' })]
    });
    expect(disabled.lifecycleEnabled).toBe(false);
    expect(disabled.lifecycle.expiryMode).toBe('');
    expect(disabled.results[0]?.lifecycleBehavior.moment).toBe('');
    expect(disabled.results[0]?.resultKey).toBe('damage');
  });

  it('builds a complete lifecycle request and keeps no-lifecycle requests null', () => {
    const normalized = expectValid(
      lifecycleEnabledDraft([
        withBehavior(validDamageDraft(), { moment: 'APPLICATION' })
      ])
    );
    expect(normalized.lifecycle).toEqual(validLifecycle());
    expect(normalized.results[0]?.lifecycleBehavior).toEqual(applicationSnapshot());
    expect(buildCreateSkillEffectRequest(normalized).lifecycle).toEqual(validLifecycle());

    const plain = expectValid(validEffectDraft());
    expect(plain.lifecycle).toBeNull();
    expect(plain.results[0]?.lifecycleBehavior).toBeNull();
  });

  it('keeps NATURAL_END after duration is cleared and blocks save', () => {
    const draft = applyDurationFormulaChange(
      lifecycleEnabledDraft([
        withBehavior(validDamageDraft(), {
          moment: 'NATURAL_END',
          valueReadMode: 'MOMENT_EVALUATION'
        })
      ]),
      ''
    );
    expect(draft.results[0]?.lifecycleBehavior.moment).toBe('NATURAL_END');
    expect(draft.lifecycle.expiryMode).toBe('EXPLICIT_ONLY');
    const result = validateSkillEffectDraft(draft, { includeEffectKey: true, catalog: CATALOG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid');
    expect(result.resultErrors[0]?.fieldErrors.moment).toBe('没有持续时间时不能选择自然结束。');
  });

  it('requires periodic interval only when a PERIODIC result exists', () => {
    const periodic = validateSkillEffectDraft(
      lifecycleEnabledDraft([
        withBehavior(validDamageDraft(), {
          moment: 'PERIODIC',
          valueReadMode: 'MOMENT_EVALUATION',
          periodicExecutionMode: 'ONCE_PER_INSTANCE'
        })
      ]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(periodic.ok).toBe(false);
    if (periodic.ok) throw new Error('expected invalid');
    expect(periodic.fieldErrors.periodicIntervalFormulaKey).toBe('请选择周期间隔公式。');
    expect(periodic.fieldErrors.firstPeriodicExecution).toBe('请选择首次周期。');

    const complete = expectValid(lifecycleEnabledDraft(
      [
        withBehavior(validDamageDraft(), {
          moment: 'PERIODIC',
          valueReadMode: 'MOMENT_EVALUATION',
          periodicExecutionMode: 'ONCE_PER_ACTIVE_STACK'
        })
      ],
      {
        periodicIntervalFormulaKey: 'poison_tick_interval_ms',
        firstPeriodicExecution: 'AFTER_INTERVAL'
      }
    ));
    expect(complete.lifecycle).toMatchObject({
      periodicIntervalFormulaKey: 'poison_tick_interval_ms',
      firstPeriodicExecution: 'AFTER_INTERVAL'
    });
  });

  it('pairs independent duration with independent expiry and rejects ONE_BY_ONE with INDEPENDENT', () => {
    const independent = expectValid(lifecycleEnabledDraft(
      [withBehavior(validDamageDraft(), { moment: 'APPLICATION' })],
      {
        reapplicationDurationMode: 'INDEPENDENT',
        expiryMode: 'INDEPENDENT'
      }
    ));
    expect(independent.lifecycle).toMatchObject({
      reapplicationDurationMode: 'INDEPENDENT',
      expiryMode: 'INDEPENDENT'
    });

    const invalid = validateSkillEffectDraft(
      lifecycleEnabledDraft(
        [withBehavior(validDamageDraft(), { moment: 'APPLICATION' })],
        {
          reapplicationDurationMode: 'INDEPENDENT',
          expiryMode: 'ONE_BY_ONE'
        }
      ),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error('expected invalid');
    expect(invalid.fieldErrors.expiryMode).toBe('独立计时必须搭配独立到期。');
  });

  it('allows persistent shield, attribute and status apply, and rejects other persistent shapes', () => {
    const shield = createEmptyResultDraft('NORMAL_SHIELD');
    shield.resultKey = 'shield';
    shield.name = '护盾';
    shield.formulaKey = 'heal';
    const persistentShield = applyStackValueModeChange(
      withBehavior(shield, { moment: 'PERSISTENT' }),
      'SHARED'
    );
    persistentShield.lifecycleBehavior.reapplicationValueMode = 'REPLACE';

    const attribute = createEmptyResultDraft('ATTRIBUTE_CHANGE');
    attribute.resultKey = 'slow';
    attribute.name = '减速';
    attribute.formulaKey = 'damage';
    attribute.attributeKey = 'move_speed';
    attribute.attributeOperation = 'DECREASE';
    const persistentAttr = applyStackValueModeChange(
      withBehavior(attribute, { moment: 'PERSISTENT' }),
      'SHARED'
    );
    persistentAttr.lifecycleBehavior.reapplicationValueMode = 'KEEP';

    const status = createEmptyResultDraft('STATUS_OPERATION');
    status.resultKey = 'poison';
    status.name = '施加中毒';
    status.statusKey = 'poison';
    const persistentStatus = withBehavior(status, { moment: 'PERSISTENT' });

    expectValid(lifecycleEnabledDraft([persistentShield, persistentAttr, persistentStatus]));

    const damagePersistent = validateSkillEffectDraft(
      lifecycleEnabledDraft([withBehavior(validDamageDraft(), { moment: 'PERSISTENT' })]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(damagePersistent.ok).toBe(false);
    if (damagePersistent.ok) throw new Error('expected invalid');
    expect(damagePersistent.resultErrors[0]?.fieldErrors.moment).toBe('该结果不能选择持续生效。');

    expect(listAllowedLifecycleMoments(validDamageDraft(), false)).not.toContain('NATURAL_END');
    expect(listAllowedLifecycleMoments(validDamageDraft(), false)).not.toContain('PERSISTENT');
    expect(listAllowedLifecycleMoments(status, true)).toContain('PERSISTENT');
    expect(listAllowedLifecycleMoments(status, true)).toContain('NATURAL_END');
  });

  it('rejects attribute SET with PER_STACK or ADD', () => {
    const attribute = createEmptyResultDraft('ATTRIBUTE_CHANGE');
    attribute.resultKey = 'set_speed';
    attribute.name = '覆盖移速';
    attribute.formulaKey = 'damage';
    attribute.attributeKey = 'move_speed';
    attribute.attributeOperation = 'SET';
    const stacked = applyStackValueModeChange(
      withBehavior(attribute, { moment: 'PERSISTENT' }),
      'PER_STACK'
    );
    const stackedResult = validateSkillEffectDraft(
      lifecycleEnabledDraft([stacked]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(stackedResult.ok).toBe(false);
    if (stackedResult.ok) throw new Error('expected invalid');
    expect(stackedResult.resultErrors[0]?.fieldErrors.stackValueMode).toBe(
      '属性覆盖只能使用整个实例共享数值。'
    );

    const added = applyStackValueModeChange(
      withBehavior(attribute, { moment: 'PERSISTENT' }),
      'SHARED'
    );
    added.lifecycleBehavior.reapplicationValueMode = 'ADD';
    const addedResult = validateSkillEffectDraft(
      lifecycleEnabledDraft([added]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(addedResult.ok).toBe(false);
    if (addedResult.ok) throw new Error('expected invalid');
    expect(addedResult.resultErrors[0]?.fieldErrors.reapplicationValueMode).toBe(
      '属性覆盖不能使用相加。'
    );
  });

  it('builds lifecycle operation results and rejects self references', () => {
    const adjust = createEmptyResultDraft('LIFECYCLE_OPERATION');
    adjust.resultKey = 'consume_trap';
    adjust.name = '消耗陷阱';
    adjust.formulaKey = 'one';
    adjust.targetEffectKey = 'toxic_trap';
    adjust.lifecycleOperation = 'CONSUME';

    const refresh = applyLifecycleOperationChange(
      { ...adjust, resultKey: 'refresh_trap', name: '刷新陷阱' },
      'REFRESH'
    );
    expect(refresh.formulaKey).toBe('');
    expect(isValueRuleVisible(refresh)).toBe(false);

    const normalized = expectValid(
      validEffectDraft([adjust, refresh]),
      true
    );
    expect(normalized.results[0]).toEqual({
      resultKey: 'consume_trap',
      name: '消耗陷阱',
      resultType: 'LIFECYCLE_OPERATION',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      lifecycleBehavior: null,
      valueRule: {
        formulaKey: 'one',
        fixedMultiplier: 1,
        fixedMinValue: null,
        fixedMaxValue: null
      },
      detail: { targetEffectKey: 'toxic_trap', operation: 'CONSUME' }
    });
    expect(normalized.results[1]).toMatchObject({
      resultType: 'LIFECYCLE_OPERATION',
      valueRule: null,
      detail: { targetEffectKey: 'toxic_trap', operation: 'REFRESH' }
    });

    const selfRef = validateSkillEffectDraft(
      validEffectDraft([{ ...adjust, targetEffectKey: 'on_hit_results' }]),
      { includeEffectKey: true, catalog: { ...CATALOG, parentEffectKey: 'on_hit_results' } }
    );
    expect(selfRef.ok).toBe(false);
    if (selfRef.ok) throw new Error('expected invalid');
    expect(selfRef.resultErrors[0]?.fieldErrors.targetEffectKey).toBe('不能引用当前效果。');

    const options = listLifecycleTargetOptions(CATALOG, 'missing_target', 'on_hit_results');
    expect(options.map((item) => item.key)).toEqual(['toxic_trap', 'missing_target']);
    expect(options.find((item) => item.key === 'missing_target')?.source).toBe('unknown');
    expect(options.some((item) => item.key === 'plain_hit')).toBe(false);
  });

  it('maps lifecycle field paths and keeps unmatched result indexes generic', () => {
    const error = new ApiRequestError('效果信息不合法', 400, '400.VALIDATION_FAILED', {
      fieldIssues: [
        { field: 'lifecycle.durationFormulaKey', code: 'REFRESH_OPERATION_IN_USE', message: '仍被刷新占用' },
        { field: 'lifecycle.instanceScope', code: 'IMMUTABLE', message: '实例范围不可修改' },
        { field: 'results[0].lifecycleBehavior.moment', code: 'ENUM_INVALID', message: '时点不合法' },
        { field: 'results[0].detail.targetEffectKey', code: 'TARGET_EFFECT_HAS_NO_DURATION', message: '目标没有持续时间' },
        { field: 'results[9].lifecycleBehavior.valueReadMode', code: 'ENUM_INVALID', message: '越界时点' }
      ]
    });
    expect(mapSkillEffectFieldIssues(error, [
      { resultType: 'LIFECYCLE_OPERATION' }
    ])).toEqual({
      fieldErrors: {
        durationFormulaKey: '仍被刷新占用',
        instanceScope: '实例范围不可修改'
      },
      resultErrors: [
        {
          index: 0,
          fieldErrors: {
            moment: '时点不合法',
            targetEffectKey: '目标没有持续时间'
          }
        }
      ],
      unmappedMessages: ['越界时点']
    });
  });

  it('locks saved instance scope and still maps backend IMMUTABLE', () => {
    const draft = skillEffectToDraft({
      ...EFFECT,
      lifecycle: validLifecycle(),
      results: [{
        ...EFFECT.results[0]!,
        lifecycleBehavior: applicationSnapshot()
      }]
    });
    expect(isInstanceScopeLocked(draft)).toBe(true);
    draft.lifecycle.instanceScope = 'SKILL';
    const result = validateSkillEffectDraft(draft, { includeEffectKey: false, catalog: CATALOG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid');
    expect(result.fieldErrors.instanceScope).toBe('已有生命周期的实例范围不可修改。');
  });
});
