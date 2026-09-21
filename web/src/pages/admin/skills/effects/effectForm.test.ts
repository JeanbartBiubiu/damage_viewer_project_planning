import { formulaValue } from '../../../../types/numericValue';
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
  SKILL_EFFECT_RESULT_TYPES,
  STATUS_OPERATION_LABELS,
  applyCooldownOperationChange,
  applyDurationFormulaChange,
  applyAffectedSkillScopeModeChange,
  applyLifecycleMomentChange,
  applyLifecycleOperationChange,
  applyResultTypeChange,
  applyStackValueModeChange,
  buildCreateSkillEffectRequest,
  buildUpdateSkillEffectRequest,
  clearHiddenLifecycleBehaviorFields,
  clearHiddenResultFields,
  cooldownChangeAmountHint,
  createEmptyEffectDraft,
  createEmptyLifecycleBehaviorDraft,
  createEmptyResultDraft,
  disableLifecycleDraft,
  enableLifecycleDraft,
  isCatalogOptionSelectable,
  isExecuteOrLinkResultType,
  isFixedPersistentSnapshotResult,
  isInstanceScopeLocked,
  isPersistentMomentAllowed,
  isPersistentNumericResult,
  isPersistentOnlyResultType,
  isReapplicationValueModeVisible,
  isValueReadModeFixed,
  isValueRuleVisible,
  listAffectedSkillCategoryOptions,
  listAffectedSkillOptions,
  listAllowedLifecycleMoments,
  listDamageTypeOptions,
  listFormulaOptions,
  listLifecycleTargetOptions,
  listSpellShieldBlockScopeOptions,
  listStatusOptions,
  mapSkillEffectFieldIssues,
  normalizeEffectDraftForDirtyComparison,
  skillEffectResultToDraft,
  skillEffectToCopyDraft,
  skillEffectToDraft,
  sortResultDrafts,
  isSpellShieldBlockScopeVisible,
  supportsMomentEvaluation,
  usesAffectedSkillScope,
  validateSkillEffectDraft,
  valueFormulaLabelFor,
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
  skillCategories: [
    { skillCategoryKey: 'displacement', status: 'ENABLED' },
    { skillCategoryKey: 'retired_category', status: 'DISABLED' }
  ],
  statuses: [
    { statusKey: 'poison', status: 'ENABLED', statusKind: 'STUN' },
    { statusKey: 'old_poison', status: 'DISABLED', statusKind: 'STUN' }
  ],
  modifierZones: [
    { modifierZoneKey: 'attribute_percent', domain: 'ATTRIBUTE', status: 'ENABLED' },
    { modifierZoneKey: 'damage_ratio', domain: 'DAMAGE', status: 'ENABLED' },
    { modifierZoneKey: 'healing_ratio', domain: 'HEALING', status: 'ENABLED' }
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
      spellShieldBlockScope: null,
      lifecycleBehavior: NULL_BEHAVIOR,
      valueRule: {
        value: formulaValue("damage"),
        fixedMultiplier: 1,
        fixedMinValue: null,
        fixedMaxValue: null
      },
      detail: {
        damageTypeKey: 'physical',
        deliveryKind: 'SKILL',
        originKind: 'DIRECT',
        critical: { mode: 'DISALLOWED', multiplierValue: null },
        vampRules: []
      }
    },
    {
      resultKey: 'self_cooldown_reduction',
      name: '减少自身冷却',
      resultType: 'COOLDOWN_CHANGE',
      target: 'SOURCE',
      description: null,
      sortOrder: 20,
      spellShieldBlockScope: null,
      lifecycleBehavior: NULL_BEHAVIOR,
      valueRule: {
        value: formulaValue("cooldown_reduction_ms"),
        fixedMultiplier: 1,
        fixedMinValue: 0,
        fixedMaxValue: null
      },
      detail: {
        affectedSkillScope: {
          mode: 'SKILLS',
          skillKeys: ['ezreal_q'],
          skillCategoryKeys: []
        },
        operation: 'REDUCE'
      }
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
    value: formulaValue('damage'),
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
    durationValue: formulaValue("poison_duration_ms"),
    maxStacksValue: formulaValue("one"),
    applicationStacksValue: formulaValue("one"),
    instanceScope: 'SOURCE_TARGET',
    reapplicationStackMode: 'KEEP',
    reapplicationDurationMode: 'REFRESH_ALL',
    expiryMode: 'ALL_AT_ONCE',
    periodicIntervalValue: null,
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
  const result = validateSkillEffectDraft(draft, {
    includeEffectKey, catalog: CATALOG, catalogLoadState: { statuses: 'ready' }
  });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected valid draft: ${JSON.stringify(result)}`);
  }
  return result.normalized;
}

describe('skill effect form defaults and conversion', () => {
  it('copies independent business data and requires a new key without inheriting edit locks', () => {
    const source = structuredClone(EFFECT);
    source.lifecycle = validLifecycle();
    const draft = skillEffectToCopyDraft(source);
    expect(draft.effectKey).toBe('');
    expect(draft.lifecycleEnabled).toBe(true);
    expect(isInstanceScopeLocked(draft)).toBe(false);
    expect(draft.originalInstanceScope).toBe('');
    expect(draft.results[0].originalResultType).toBeNull();
    expect(draft.results[0].originalDamageTypeKey).toBeNull();
    expect(draft.results[1].originalAffectedSkillKeys).toEqual([]);
    expect(draft.results[1].affectedSkillScope.skillKeys).toEqual(['ezreal_q']);
    draft.results[1].affectedSkillScope.skillKeys.push('ezreal_w');
    const value = draft.results[0].value;
    if (value?.kind !== 'FORMULA') throw new Error('expected formula value');
    value.formulaKey = 'heal';
    expect(source).toEqual({ ...EFFECT, lifecycle: validLifecycle() });
    expect(validateSkillEffectDraft(draft, { includeEffectKey: true, catalog: CATALOG }).ok).toBe(false);
  });

  it('validates copied references as new selections instead of retaining disabled references', () => {
    const source = structuredClone(EFFECT);
    source.results = [source.results[0]];
    const detail = source.results[0].detail;
    if (!('damageTypeKey' in detail)) throw new Error('expected damage detail');
    detail.damageTypeKey = 'true';
    expectValid(skillEffectToDraft(source));
    const draft = skillEffectToCopyDraft(source);
    draft.effectKey = 'copied_hit';
    expect(validateSkillEffectDraft(draft, { includeEffectKey: true, catalog: CATALOG }).ok).toBe(false);
    draft.results[0].damageTypeKey = 'physical';
    const request = buildCreateSkillEffectRequest(expectValid(draft));
    expect(request.effectKey).toBe('copied_hit');
    expect(request.results[0].valueRule).toEqual(source.results[0].valueRule);
    expect(request.results[0].resultKey).toBe('damage');
  });

  it('creates empty effect and result drafts with stable defaults', () => {
    expect(createEmptyEffectDraft()).toEqual({
      effectKey: '',
      name: '',
      description: '',
      sortOrder: '0',
      lifecycleEnabled: false,
      lifecycle: {
        durationValue: null,
        maxStacksValue: null,
        applicationStacksValue: null,
        instanceScope: '',
        reapplicationStackMode: '',
        reapplicationDurationMode: '',
        expiryMode: '',
        periodicIntervalValue: null,
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
      damageDeliveryKind: 'SKILL',
      damageOriginKind: 'DIRECT',
      criticalMode: 'DISALLOWED',
      vampRules: [],
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
      damageDeliveryKind: 'SKILL',
      damageOriginKind: 'DIRECT',
      criticalMode: 'DISALLOWED',
      vampRules: [],
      originalResultType: 'DAMAGE',
      originalDamageTypeKey: 'physical',
      statusKey: '',
      affectedSkillScope: { mode: 'ALL', skillKeys: [], skillCategoryKeys: [] }
    });
    expect(draft.results[1]).toMatchObject({
      resultType: 'COOLDOWN_CHANGE',
      cooldownOperation: 'REDUCE',
      affectedSkillScope: {
        mode: 'SKILLS',
        skillKeys: ['ezreal_q'],
        skillCategoryKeys: []
      },
      originalAffectedSkillKeys: ['ezreal_q'],
      value: formulaValue('cooldown_reduction_ms'),
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
          spellShieldBlockScope: null,
          lifecycleBehavior: null,
          valueRule: {
            value: formulaValue("damage"),
            fixedMultiplier: 1,
            fixedMinValue: null,
            fixedMaxValue: null
          },
          detail: {
            damageTypeKey: 'physical',
            deliveryKind: 'SKILL',
            originKind: 'DIRECT',
            critical: { mode: 'DISALLOWED', multiplierValue: null },
            vampRules: []
          }
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
    heal.value = formulaValue('heal');
    heal.damageTypeKey = 'should_not_leak';
    heal.statusKey = 'poison';

    const shield = createEmptyResultDraft('NORMAL_SHIELD');
    shield.resultKey = 'shield';
    shield.name = '普通护盾';
    shield.value = formulaValue('heal');

    const attribute = createEmptyResultDraft('ATTRIBUTE_CHANGE');
    attribute.resultKey = 'slow';
    attribute.name = '减少移速';
    attribute.value = formulaValue('damage');
    attribute.attributeKey = 'move_speed';
    attribute.attributeOperation = 'DECREASE';

    const resource = createEmptyResultDraft('RESOURCE_CHANGE');
    resource.resultKey = 'mana';
    resource.name = '恢复法力';
    resource.value = formulaValue('heal');
    resource.attributeKey = 'mana';
    resource.resourceOperation = 'RESTORE';

    const cooldown = createEmptyResultDraft('COOLDOWN_CHANGE');
    cooldown.resultKey = 'cdr';
    cooldown.name = '减少冷却';
    cooldown.value = formulaValue('cooldown_reduction_ms');
    cooldown.affectedSkillScope = {
      mode: 'SKILLS',
      skillKeys: ['ezreal_q', 'ezreal_w'],
      skillCategoryKeys: []
    };
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
    status.value = formulaValue('damage');
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
      spellShieldBlockScope: null,
      lifecycleBehavior: null,
      valueRule: {
        value: formulaValue("heal"),
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
      spellShieldBlockScope: null,
      lifecycleBehavior: null,
      valueRule: {
        value: formulaValue("damage"),
        fixedMultiplier: 1,
        fixedMinValue: null,
        fixedMaxValue: null
      },
      detail: { attributeKey: 'move_speed', operation: 'DECREASE', modifierZoneKey: null }
    });
    expect(normalized.results[4]).toMatchObject({
      resultType: 'RESOURCE_CHANGE',
      detail: { attributeKey: 'mana', operation: 'RESTORE' }
    });
    expect(normalized.results[5]).toMatchObject({
      resultType: 'COOLDOWN_CHANGE',
      valueRule: { value: formulaValue("cooldown_reduction_ms"), fixedMultiplier: 1 },
      detail: {
        affectedSkillScope: {
          mode: 'SKILLS',
          skillKeys: ['ezreal_q', 'ezreal_w'],
          skillCategoryKeys: []
        },
        operation: 'REDUCE'
      }
    });
    expect(normalized.results[5]).not.toHaveProperty('damageTypeKey');
    expect(normalized.results[6]).toEqual({
      resultKey: 'reset',
      name: '重置冷却',
      resultType: 'COOLDOWN_CHANGE',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      spellShieldBlockScope: null,
      lifecycleBehavior: null,
      valueRule: null,
      detail: {
        affectedSkillScope: {
          mode: 'SKILLS',
          skillKeys: ['ezreal_q', 'ezreal_w'],
          skillCategoryKeys: []
        },
        operation: 'RESET'
      }
    });
    expect(normalized.results[7]).toEqual({
      resultKey: 'poison',
      name: '施加中毒',
      resultType: 'STATUS_OPERATION',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      spellShieldBlockScope: null,
      lifecycleBehavior: null,
      valueRule: null,
      detail: { statusKey: 'poison', operation: 'APPLY' }
    });
  });
});

describe('skill effect form validation', () => {
  it('rejects duplicate or incomplete vamp rows', () => {
    const duplicate = validateSkillEffectDraft(validEffectDraft([validDamageDraft({
      vampRules: [
        {
          vampType: 'OMNIVAMP',
          basisOutputKind: 'POST_DEFENSE_DAMAGE',
          efficiencyValue: formulaValue("heal")
        },
        {
          vampType: 'OMNIVAMP',
          basisOutputKind: 'ACTUAL_HP_LOSS',
          efficiencyValue: formulaValue("damage")
        }
      ]
    })]), { includeEffectKey: true, catalog: CATALOG });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.resultErrors[0]?.fieldErrors.vampRules).toBe('吸血种类不能重复。');
    }

    const missingFormula = validateSkillEffectDraft(validEffectDraft([validDamageDraft({
      vampRules: [{
        vampType: 'SPELL_VAMP',
        basisOutputKind: 'ACTUAL_HP_LOSS',
        efficiencyValue: null
      }]
    })]), { includeEffectKey: true, catalog: CATALOG });
    expect(missingFormula.ok).toBe(false);
    if (!missingFormula.ok) {
      expect(missingFormula.resultErrors[0]?.fieldErrors.vampRules).toBe('请选择吸血效率取值。');
    }
  });

  it('keeps spell-shield block scopes only on eligible target results', () => {
    const damage = validDamageDraft({ spellShieldBlockScope: 'DAMAGE_INSTANCE' });
    expect(isSpellShieldBlockScopeVisible(damage)).toBe(true);
    expect(listSpellShieldBlockScopeOptions(damage)).toEqual([
      'SKILL',
      'EFFECT',
      'DAMAGE_INSTANCE',
      'RESULT'
    ]);

    const attribute = createEmptyResultDraft('ATTRIBUTE_CHANGE');
    attribute.target = 'TARGET';
    expect(listSpellShieldBlockScopeOptions(attribute)).toEqual(['SKILL', 'EFFECT', 'RESULT']);

    const selfDamage = clearHiddenResultFields({ ...damage, target: 'SOURCE' });
    expect(selfDamage.spellShieldBlockScope).toBe('');
    expect(isSpellShieldBlockScopeVisible(selfDamage)).toBe(false);

    const persistentDamage = clearHiddenResultFields({
      ...damage,
      lifecycleBehavior: {
        ...damage.lifecycleBehavior,
        moment: 'PERSISTENT'
      }
    });
    expect(persistentDamage.spellShieldBlockScope).toBe('');

    const heal = createEmptyResultDraft('DIRECT_HEAL');
    heal.spellShieldBlockScope = 'RESULT';
    expect(clearHiddenResultFields(heal).spellShieldBlockScope).toBe('');
    expect(isSpellShieldBlockScopeVisible(heal)).toBe(false);
  });

  it('preserves only result scope for persistent target status application through save and readback', () => {
    const status = withBehavior(createEmptyResultDraft('STATUS_OPERATION'), { moment: 'PERSISTENT' });
    status.resultKey = 'poison';
    status.name = '施加中毒';
    status.statusKey = 'poison';
    status.spellShieldBlockScope = 'RESULT';
    expect(isSpellShieldBlockScopeVisible(status)).toBe(true);
    expect(listSpellShieldBlockScopeOptions(status)).toEqual(['RESULT']);
    expect(clearHiddenResultFields(status).spellShieldBlockScope).toBe('RESULT');
    expect(clearHiddenLifecycleBehaviorFields(status).spellShieldBlockScope).toBe('RESULT');
    const saved = expectValid(lifecycleEnabledDraft([status])).results[0];
    expect(saved).toMatchObject({
      target: 'TARGET', resultType: 'STATUS_OPERATION', spellShieldBlockScope: 'RESULT',
      detail: { operation: 'APPLY', statusKey: 'poison' },
      lifecycleBehavior: { moment: 'PERSISTENT', stackValueMode: null, reapplicationValueMode: null }
    });
    expect(clearHiddenResultFields(skillEffectResultToDraft(saved)).spellShieldBlockScope).toBe('RESULT');
    expect(expectValid(lifecycleEnabledDraft([{ ...status, spellShieldBlockScope: '' }])).results[0]
      .spellShieldBlockScope).toBeNull();

    for (const scope of ['SKILL', 'EFFECT', 'DAMAGE_INSTANCE'] as const) {
      const invalid = { ...status, spellShieldBlockScope: scope };
      expect(clearHiddenResultFields(invalid).spellShieldBlockScope).toBe('');
      expect(clearHiddenLifecycleBehaviorFields(invalid).spellShieldBlockScope).toBe('');
      expect(expectValid(lifecycleEnabledDraft([invalid])).results[0].spellShieldBlockScope).toBeNull();
    }
    for (const ineligible of [
      { ...status, target: 'SOURCE' as const },
      { ...status, statusOperation: 'REMOVE' as const },
      { ...status, resultType: 'ATTRIBUTE_CHANGE' as const },
      { ...status, resultType: 'DAMAGE' as const }
    ]) {
      expect(isSpellShieldBlockScopeVisible(ineligible)).toBe(false);
      expect(listSpellShieldBlockScopeOptions(ineligible)).toEqual([]);
      expect(clearHiddenLifecycleBehaviorFields(ineligible).spellShieldBlockScope).toBe('');
    }
  });

  it('lets a valid child result enter an unfinished parent draft while final parent save stays strict', () => {
    const parent = {
      ...validEffectDraft([validDamageDraft()]), name: '', description: '长'.repeat(2001), sortOrder: '-1'
    };
    const childOptions = {
      includeEffectKey: false, catalog: CATALOG,
      skipLifecycleShapeValidation: true, skipEffectMetadataValidation: true
    };
    expect(validateSkillEffectDraft(parent, childOptions).ok).toBe(true);
    const final = validateSkillEffectDraft(parent, { includeEffectKey: true, catalog: CATALOG });
    expect(final.ok).toBe(false);
    if (!final.ok) {
      expect(final.fieldErrors.name).toBe('效果名称不能为空。');
      expect(final.fieldErrors.description).toBe('说明不能超过 2000 个字符。');
      expect(final.fieldErrors.sortOrder).toBeTruthy();
    }
    const badChild = validateSkillEffectDraft({
      ...parent, results: [{ ...validDamageDraft(), name: '' }]
    }, childOptions);
    expect(badChild.ok).toBe(false);
    if (!badChild.ok) expect(badChild.resultErrors[0]?.fieldErrors.name).toBe('结果名称不能为空。');
  });

  it('builds a persistent spell-shield result with no value or block scope', () => {
    const shield = createEmptyResultDraft('SPELL_SHIELD');
    shield.resultKey = 'spell_shield';
    shield.name = '法术护盾';
    expect(shield.lifecycleBehavior.moment).toBe('PERSISTENT');
    expect(isValueRuleVisible(shield)).toBe(false);
    expect(isSpellShieldBlockScopeVisible(shield)).toBe(false);

    const normalized = expectValid(lifecycleEnabledDraft([shield]));
    expect(normalized.results[0]).toEqual({
      resultKey: 'spell_shield',
      name: '法术护盾',
      resultType: 'SPELL_SHIELD',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      lifecycleBehavior: {
        moment: 'PERSISTENT',
        valueReadMode: null,
        stackValueMode: null,
        reapplicationValueMode: null,
        periodicExecutionMode: null
      },
      spellShieldBlockScope: null,
      valueRule: null,
      detail: {}
    });
  });

  it('accepts the frozen lowercase stable-key grammar', () => {
    expect(SKILL_EFFECT_KEY_PATTERN.test('on_hit_results')).toBe(true);
    expect(SKILL_EFFECT_KEY_PATTERN.test('OnHit')).toBe(false);
    expect(SKILL_EFFECT_KEY_PATTERN.test('1damage')).toBe(false);
  });

  it('requires a result without lifecycle and unique result keys', () => {
    const empty = validateSkillEffectDraft(validEffectDraft([]), {
      includeEffectKey: true,
      catalog: CATALOG
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) throw new Error('expected invalid');
    expect(empty.fieldErrors.results).toBe('未启用生命周期时至少需要一个结果。');

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

  it('allows ALL cooldown scope and rejects empty, duplicate or mixed SKILLS targets', () => {
    const cooldown = createEmptyResultDraft('COOLDOWN_CHANGE');
    cooldown.resultKey = 'reduce_abilities';
    cooldown.name = '减少技能冷却';
    cooldown.value = formulaValue('cooldown_reduction_ms');

    const all = validateSkillEffectDraft(validEffectDraft([cooldown]), {
      includeEffectKey: true,
      catalog: CATALOG
    });
    expect(all.ok).toBe(true);

    const emptySkills = validateSkillEffectDraft(
      validEffectDraft([{
        ...cooldown,
        affectedSkillScope: { mode: 'SKILLS', skillKeys: [], skillCategoryKeys: [] }
      }]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(emptySkills.ok).toBe(false);
    if (emptySkills.ok) throw new Error('expected invalid');
    expect(emptySkills.resultErrors[0]?.fieldErrors.affectedSkillKeys).toBe('请至少选择一个技能。');

    const duplicate = validateSkillEffectDraft(
      validEffectDraft([{
        ...cooldown,
        affectedSkillScope: { mode: 'SKILLS', skillKeys: ['ezreal_w', ' ezreal_w '], skillCategoryKeys: [] }
      }]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error('expected invalid');
    expect(duplicate.resultErrors[0]?.fieldErrors.affectedSkillKeys).toBe('指定技能不能重复。');
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
    expect(result.resultErrors[0]?.fieldErrors.resultType)
      .toBe('已有结果的种类不可修改。');
  });

  it('requires value rules for numeric results and rejects min greater than max', () => {
    const missingFormula = validateSkillEffectDraft(
      validEffectDraft([validDamageDraft({ value: null })]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(missingFormula.ok).toBe(false);
    if (missingFormula.ok) throw new Error('expected invalid');
    expect(missingFormula.resultErrors[0]?.fieldErrors.value).toBe('请配置取值来源。');

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
      value: null,
      fixedMultiplier: '',
      statusOperation: 'APPLY'
    });
    expect(isValueRuleVisible(switched)).toBe(false);
    expect(clearHiddenResultFields({ ...switched, value: formulaValue('damage'), damageTypeKey: 'physical' })).toMatchObject({
      value: null,
      damageTypeKey: '',
      statusKey: ''
    });

    const reduce = createEmptyResultDraft('COOLDOWN_CHANGE');
    reduce.cooldownOperation = 'REDUCE';
    expect(cooldownChangeAmountHint(reduce)).toBe(COOLDOWN_CHANGE_AMOUNT_HINT);
    const reset = applyCooldownOperationChange(reduce, 'RESET');
    expect(reset.value).toBeNull();
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
    newParentCooldown.value = formulaValue('cooldown_reduction_ms');
    newParentCooldown.affectedSkillScope = {
      mode: 'SKILLS',
      skillKeys: ['ezreal_q'],
      skillCategoryKeys: []
    };
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
      validEffectDraft([{
        ...newParentCooldown,
        affectedSkillScope: { mode: 'SKILLS', skillKeys: ['retired_skill'], skillCategoryKeys: [] }
      }]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(otherDisabled.ok).toBe(false);
    if (otherDisabled.ok) throw new Error('expected invalid');
    expect(otherDisabled.resultErrors[0]?.fieldErrors.affectedSkillKeys).toBe(DISABLED_CATALOG_MESSAGE);

    const retainOtherDisabled = validateSkillEffectDraft(
      validEffectDraft([
        {
          ...newParentCooldown,
          affectedSkillScope: { mode: 'SKILLS', skillKeys: ['retired_skill'], skillCategoryKeys: [] },
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
      validEffectDraft([validDamageDraft({ value: formulaValue('missing_formula') })]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error('expected invalid');
    expect(blocked.resultErrors[0]?.fieldErrors.value).toBe(INCOMPLETE_CATALOG_MESSAGE);

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
      { resultType: 'COOLDOWN_CHANGE' as const },
      { resultType: 'NORMAL_SHIELD' as const }
    ];
    const error = new ApiRequestError('效果信息不合法', 400, '400.VALIDATION_FAILED', {
      fieldIssues: [
        { field: 'effectKey', code: 'FORMAT_INVALID', message: ' 效果标识不合法 ' },
        { field: 'name', code: 'LENGTH_INVALID', message: '效果名称不能超过 100 个字符' },
        { field: 'results[0].valueRule.value', code: 'UNKNOWN_FORMULA', message: '公式不存在' },
        { field: 'results[0].detail.damageTypeKey', code: 'UNKNOWN_DAMAGE_TYPE', message: '伤害类型不存在' },
        { field: 'results[0].detail.originKind', code: 'ENUM_INVALID', message: '来源性质不合法' },
        { field: 'results[0].detail.critical.multiplierValue', code: 'UNKNOWN_FORMULA', message: '暴击公式不存在' },
        { field: 'results[0].detail.vampRules[1].efficiencyValue', code: 'UNKNOWN_FORMULA', message: '吸血公式不存在' },
        { field: 'results[1].detail.operation', code: 'ENUM_INVALID', message: '操作不合法' },
        { field: 'results[1].resultType', code: 'IMMUTABLE', message: '结果种类不可修改' },
        { field: 'results[2].detail.affectedSkillScope.skillKeys[1]', code: 'UNKNOWN_SKILL', message: '技能不存在' },
        { field: 'results[3].detail.decayMode', code: 'ENUM_INVALID', message: '护盾衰减不合法' },
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
            value: '公式不存在',
            damageTypeKey: '伤害类型不存在',
            damageOriginKind: '来源性质不合法',
            criticalMultiplierValue: "暴击公式不存在",
            vampRules: '吸血公式不存在'
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
        },
        {
          index: 3,
          fieldErrors: {
            shieldDecayMode: '护盾衰减不合法'
          }
        }
      ],
      unmappedMessages: ['游戏不存在'],
      inboundDependencies: []
    });
  });

  it('maps results[index] without a nested field and ignores malformed details', () => {
    expect(mapSkillEffectFieldIssues(null)).toEqual({
      fieldErrors: {},
      resultErrors: [],
      unmappedMessages: [],
      inboundDependencies: []
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
      unmappedMessages: [],
      inboundDependencies: []
    });
  });

  it('keeps 409 inbound shape occupancy details with rule, action, binding and output labels', () => {
    const error = new ApiRequestError(
      '结果形状变化会使既有前序输出失效',
      409,
      '409.SKILL_EFFECT_IN_USE',
      {
        fieldIssues: [
          {
            field: 'results[0].detail.vampRules',
            code: 'TRIGGER_RULE_SHAPE_IN_USE',
            message: '结果形状变化会使既有前序输出失效',
            ruleKey: 'prior',
            actionKey: 'follow',
            bindingKey: 'from_first',
            outputKind: 'ACTUAL_HEALING'
          }
        ]
      }
    );
    expect(mapSkillEffectFieldIssues(error, [{ resultType: 'DAMAGE' }])).toEqual({
      fieldErrors: {},
      resultErrors: [{
        index: 0,
        fieldErrors: {
          vampRules: '结果形状变化会使既有前序输出失效'
        }
      }],
      unmappedMessages: [
        '请先调整条件与触发规则再保存效果。',
        'prior / follow / from_first / 实际治疗'
      ],
      inboundDependencies: [{
        ruleKey: 'prior',
        actionKey: 'follow',
        bindingKey: 'from_first',
        outputKind: 'ACTUAL_HEALING'
      }]
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
    cooldown.affectedSkillScope = {
      mode: 'SKILLS',
      skillKeys: ['ezreal_w', 'ezreal_q'],
      skillCategoryKeys: []
    };
    cooldown.originalAffectedSkillKeys = ['ezreal_w', 'ezreal_q'];
    const left = validEffectDraft([cooldown]);
    const right = validEffectDraft([{
      ...cooldown,
      affectedSkillScope: {
        mode: 'SKILLS',
        skillKeys: ['ezreal_q', 'ezreal_w'],
        skillCategoryKeys: []
      },
      originalAffectedSkillKeys: ['ezreal_q', 'ezreal_w']
    }]);

    expect(normalizeEffectDraftForDirtyComparison(left)).toEqual(
      normalizeEffectDraftForDirtyComparison(right)
    );
  });

  it('builds critical and fixed-order vamp details without empty rows', () => {
    const normalized = expectValid(validEffectDraft([validDamageDraft({
      criticalMode: 'SOURCE_CRIT_CHANCE',
      criticalMultiplierValue: formulaValue("heal"),
      vampRules: [
        {
          vampType: 'OMNIVAMP',
          basisOutputKind: 'ACTUAL_HP_LOSS',
          efficiencyValue: formulaValue("heal")
        },
        {
          vampType: 'LIFE_STEAL',
          basisOutputKind: 'POST_DEFENSE_DAMAGE',
          efficiencyValue: formulaValue("damage")
        }
      ]
    })]));

    expect(normalized.results[0]).toMatchObject({
      resultType: 'DAMAGE',
      detail: {
        deliveryKind: 'SKILL',
        originKind: 'DIRECT',
        critical: { mode: 'SOURCE_CRIT_CHANCE', multiplierValue: formulaValue("heal") },
        vampRules: [
          { vampType: 'LIFE_STEAL', efficiencyValue: formulaValue("damage") },
          { vampType: 'OMNIVAMP', efficiencyValue: formulaValue("heal") }
        ]
      }
    });
  });

  it('builds a linearly decaying normal shield only with matching lifecycle fields', () => {
    const shield = createEmptyResultDraft('NORMAL_SHIELD');
    Object.assign(shield, {
      resultKey: 'shield',
      name: '普通护盾',
      value: formulaValue('heal'),
      fixedMultiplier: '1',
      absorbedDamageTypeKey: 'physical',
      shieldDecayMode: 'LINEAR_TO_ZERO',
      lifecycleBehavior: {
        moment: 'PERSISTENT',
        valueReadMode: 'APPLICATION_SNAPSHOT',
        stackValueMode: 'SHARED',
        reapplicationValueMode: 'KEEP',
        periodicExecutionMode: ''
      }
    });
    const normalized = expectValid(validEffectDraft([shield], {
      lifecycleEnabled: true,
      lifecycle: validLifecycle()
    }));
    expect(normalized.results[0]).toMatchObject({
      resultType: 'NORMAL_SHIELD',
      detail: { absorbedDamageTypeKey: 'physical', decayMode: 'LINEAR_TO_ZERO' }
    });

    const invalid = validateSkillEffectDraft(validEffectDraft([shield]), {
      includeEffectKey: true,
      catalog: CATALOG
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.resultErrors[0]?.fieldErrors.shieldDecayMode)
        .toBe('线性衰减需要先启用父效果生命周期。');
    }
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
        valueRule: { value: formulaValue("heal"), fixedMultiplier: 1.5, fixedMinValue: 1, fixedMaxValue: 9 },
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
        valueRule: { value: formulaValue("heal"), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
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
        valueRule: { value: formulaValue("damage"), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
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
        valueRule: { value: formulaValue("heal"), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
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
        detail: {
          affectedSkillScope: { mode: 'SKILLS', skillKeys: ['ezreal_w'], skillCategoryKeys: [] },
          operation: 'RESET'
        }
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
      value: formulaValue('heal'),
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
      value: null,
      originalAffectedSkillKeys: ['ezreal_w']
    });
    expect(drafts[5]).toMatchObject({
      statusOperation: 'REMOVE',
      originalStatusKey: 'old_poison',
      value: null
    });

    const retained = validateSkillEffectDraft(
      validEffectDraft([drafts[2]!, drafts[5]!]),
      { includeEffectKey: false, catalog: CATALOG, catalogLoadState: { statuses: 'ready' } }
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
      durationValue: formulaValue("poison_duration_ms"),
      maxStacksValue: formulaValue("one"),
      applicationStacksValue: formulaValue("one"),
      instanceScope: 'SOURCE_TARGET',
      reapplicationStackMode: 'KEEP',
      reapplicationDurationMode: 'REFRESH_ALL',
      expiryMode: 'ALL_AT_ONCE',
      periodicIntervalValue: null,
      firstPeriodicExecution: '',
      ...lifecycleOverrides
    }
  };
}

describe('skill effect lifecycle drafts', () => {
  it('creates and updates lifecycle-only effects without inventing a result', () => {
    const draft = lifecycleEnabledDraft([]);
    const normalized = expectValid(draft);
    expect(buildCreateSkillEffectRequest(normalized)).toMatchObject({ lifecycle: validLifecycle(), results: [] });
    const effect: SkillEffect = { ...EFFECT, lifecycle: validLifecycle(), results: [] };
    expect(buildUpdateSkillEffectRequest(expectValid(skillEffectToDraft(effect), false)))
      .toMatchObject({ lifecycle: validLifecycle(), results: [] });
    expect(listLifecycleTargetOptions({ ...CATALOG, effects: [{ effectKey: 'only_mark', lifecycleEnabled: true }] }, '', ''))
      .toEqual([{ key: 'only_mark', status: 'ENABLED', source: 'enabled' }]);
  });

  it('retains lifecycle validation and recovers after disabling lifecycle with no results', () => {
    const draft = lifecycleEnabledDraft([]);
    const invalid = validateSkillEffectDraft({ ...draft, lifecycle: { ...draft.lifecycle, maxStacksValue: null } },
      { includeEffectKey: true, catalog: CATALOG });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.fieldErrors.maxStacksValue).toBeTruthy();
    const disabled = disableLifecycleDraft(draft);
    expect(disabled.results).toEqual([]);
    expect(disabled.name).toBe(draft.name);
    const validation = validateSkillEffectDraft(disabled, { includeEffectKey: true, catalog: CATALOG });
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.fieldErrors.results).toBe('未启用生命周期时至少需要一个结果。');
    expectValid({ ...enableLifecycleDraft(disabled), lifecycle: draft.lifecycle });
  });

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
    expect(periodic.fieldErrors.periodicIntervalValue).toBe('请选择周期间隔取值。');
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
        periodicIntervalValue: formulaValue("poison_tick_interval_ms"),
        firstPeriodicExecution: 'AFTER_INTERVAL'
      }
    ));
    expect(complete.lifecycle).toMatchObject({
      periodicIntervalValue: formulaValue("poison_tick_interval_ms"),
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
    shield.value = formulaValue('heal');
    const persistentShield = applyStackValueModeChange(
      withBehavior(shield, { moment: 'PERSISTENT' }),
      'SHARED'
    );
    persistentShield.lifecycleBehavior.reapplicationValueMode = 'REPLACE';

    const attribute = createEmptyResultDraft('ATTRIBUTE_CHANGE');
    attribute.resultKey = 'slow';
    attribute.name = '减速';
    attribute.value = formulaValue('damage');
    attribute.attributeKey = 'move_speed';
    attribute.attributeOperation = 'DECREASE';
    const persistentAttr = applyStackValueModeChange(
      withBehavior(attribute, { moment: 'PERSISTENT' }),
      'SHARED'
    );
    persistentAttr.lifecycleBehavior.reapplicationValueMode = 'KEEP';
    persistentAttr.modifierZoneKey = 'attribute_percent';

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

  it('builds the four persistent modifier and pre-damage protection result shapes', () => {
    const damageModifier = createEmptyResultDraft('DAMAGE_MODIFIER');
    damageModifier.resultKey = 'damage_taken_reduction';
    damageModifier.name = '受到伤害降低';
    damageModifier.value = formulaValue('damage');
    damageModifier.modifierDirection = 'TAKEN';
    damageModifier.modifierOperation = 'DECREASE';
    damageModifier.damageTypeKey = 'physical';
    damageModifier.damageFilterDeliveryKind = 'SKILL';
    damageModifier.damageFilterOriginKind = 'DIRECT';
    damageModifier.criticalFilter = 'NON_CRITICAL_ONLY';
    damageModifier.modifierZoneKey = 'damage_ratio';
    const perStackDamageModifier = applyStackValueModeChange(damageModifier, 'PER_STACK');

    const healingModifier = createEmptyResultDraft('HEALING_MODIFIER');
    healingModifier.resultKey = 'vamp_received_reduction';
    healingModifier.name = '受到吸血治疗降低';
    healingModifier.value = formulaValue('heal');
    healingModifier.healingModifierDirection = 'RECEIVED';
    healingModifier.modifierOperation = 'DECREASE';
    healingModifier.healingKind = 'VAMP';
    healingModifier.modifierZoneKey = 'healing_ratio';
    const sharedHealingModifier = applyStackValueModeChange(healingModifier, 'SHARED');
    sharedHealingModifier.lifecycleBehavior.reapplicationValueMode = 'REPLACE';

    const immunity = createEmptyResultDraft('DAMAGE_IMMUNITY');
    immunity.resultKey = 'skill_damage_immunity';
    immunity.name = '技能伤害免疫';
    immunity.damageFilterDeliveryKind = 'SKILL';
    immunity.damageFilterOriginKind = 'ANY';

    const healthFloor = createEmptyResultDraft('HEALTH_FLOOR');
    healthFloor.resultKey = 'health_floor';
    healthFloor.name = '生命下限';
    healthFloor.value = formulaValue('heal');
    healthFloor.attributeKey = 'move_speed';
    const sharedHealthFloor = applyStackValueModeChange(healthFloor, 'SHARED');
    sharedHealthFloor.lifecycleBehavior.reapplicationValueMode = 'KEEP';

    const normalized = expectValid(lifecycleEnabledDraft([
      perStackDamageModifier,
      sharedHealingModifier,
      immunity,
      sharedHealthFloor
    ]));

    expect(normalized.results).toEqual([
      {
        resultKey: 'damage_taken_reduction',
        name: '受到伤害降低',
        resultType: 'DAMAGE_MODIFIER',
        target: 'TARGET',
        description: null,
        sortOrder: 0,
        spellShieldBlockScope: null,
        lifecycleBehavior: {
          moment: 'PERSISTENT',
          valueReadMode: 'APPLICATION_SNAPSHOT',
          stackValueMode: 'PER_STACK',
          reapplicationValueMode: null,
          periodicExecutionMode: null
        },
        valueRule: {
          value: formulaValue("damage"),
          fixedMultiplier: 1,
          fixedMinValue: null,
          fixedMaxValue: null
        },
        detail: {
          modifierZoneKey: 'damage_ratio',
          direction: 'TAKEN',
          operation: 'DECREASE',
          damageTypeKey: 'physical',
          deliveryKind: 'SKILL',
          originKind: 'DIRECT',
          criticalFilter: 'NON_CRITICAL_ONLY'
        }
      },
      {
        resultKey: 'vamp_received_reduction',
        name: '受到吸血治疗降低',
        resultType: 'HEALING_MODIFIER',
        target: 'TARGET',
        description: null,
        sortOrder: 0,
        spellShieldBlockScope: null,
        lifecycleBehavior: {
          moment: 'PERSISTENT',
          valueReadMode: 'APPLICATION_SNAPSHOT',
          stackValueMode: 'SHARED',
          reapplicationValueMode: 'REPLACE',
          periodicExecutionMode: null
        },
        valueRule: {
          value: formulaValue("heal"),
          fixedMultiplier: 1,
          fixedMinValue: null,
          fixedMaxValue: null
        },
        detail: {
          modifierZoneKey: 'healing_ratio',
          direction: 'RECEIVED',
          operation: 'DECREASE',
          healingKind: 'VAMP'
        }
      },
      {
        resultKey: 'skill_damage_immunity',
        name: '技能伤害免疫',
        resultType: 'DAMAGE_IMMUNITY',
        target: 'TARGET',
        description: null,
        sortOrder: 0,
        spellShieldBlockScope: null,
        lifecycleBehavior: {
          moment: 'PERSISTENT',
          valueReadMode: null,
          stackValueMode: null,
          reapplicationValueMode: null,
          periodicExecutionMode: null
        },
        valueRule: null,
        detail: {
          damageTypeKey: null,
          deliveryKind: 'SKILL',
          originKind: 'ANY'
        }
      },
      {
        resultKey: 'health_floor',
        name: '生命下限',
        resultType: 'HEALTH_FLOOR',
        target: 'TARGET',
        description: null,
        sortOrder: 0,
        spellShieldBlockScope: null,
        lifecycleBehavior: {
          moment: 'PERSISTENT',
          valueReadMode: 'APPLICATION_SNAPSHOT',
          stackValueMode: 'SHARED',
          reapplicationValueMode: 'KEEP',
          periodicExecutionMode: null
        },
        valueRule: {
          value: formulaValue("heal"),
          fixedMultiplier: 1,
          fixedMinValue: null,
          fixedMaxValue: null
        },
        detail: { attributeKey: 'move_speed' }
      }
    ]);
  });

  it('supports current-moment evaluation only for continuous adjustment results', () => {
    const modifier = createEmptyResultDraft('DAMAGE_MODIFIER');
    modifier.resultKey = 'dynamic_damage';
    modifier.name = '动态伤害修正';
    modifier.value = formulaValue('damage');
    modifier.modifierZoneKey = 'damage_ratio';
    modifier.lifecycleBehavior.stackValueMode = 'SHARED';
    modifier.lifecycleBehavior.reapplicationValueMode = 'KEEP';
    modifier.lifecycleBehavior.valueReadMode = 'MOMENT_EVALUATION';
    const normalizedDraft = clearHiddenLifecycleBehaviorFields(modifier);

    expect(isValueReadModeFixed(normalizedDraft)).toBe(false);
    expect(normalizedDraft.lifecycleBehavior.reapplicationValueMode).toBe('');
    expect(isReapplicationValueModeVisible(normalizedDraft)).toBe(false);
    const normalized = expectValid(lifecycleEnabledDraft([normalizedDraft]));
    expect(normalized.results[0]?.lifecycleBehavior).toMatchObject({
      valueReadMode: 'MOMENT_EVALUATION',
      stackValueMode: 'SHARED',
      reapplicationValueMode: null
    });

    const shield = createEmptyResultDraft('NORMAL_SHIELD');
    shield.resultKey = 'dynamic_shield';
    shield.name = '动态护盾';
    shield.value = formulaValue('heal');
    const persistentShield = withBehavior(shield, {
      moment: 'PERSISTENT',
      valueReadMode: 'MOMENT_EVALUATION',
      stackValueMode: 'SHARED',
      reapplicationValueMode: ''
    });
    const invalid = validateSkillEffectDraft(
      lifecycleEnabledDraft([persistentShield]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(invalid.ok).toBe(false);
  });

  it('requires a parent lifecycle and enforces the health-floor shared value matrix', () => {
    const modifier = createEmptyResultDraft('DAMAGE_MODIFIER');
    modifier.resultKey = 'damage_modifier';
    modifier.name = '伤害修正';
    modifier.value = formulaValue('damage');
    const withoutLifecycle = validateSkillEffectDraft(
      validEffectDraft([applyStackValueModeChange(modifier, 'PER_STACK')]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(withoutLifecycle.ok).toBe(false);
    if (withoutLifecycle.ok) throw new Error('expected invalid');
    expect(withoutLifecycle.resultErrors[0]?.fieldErrors.lifecycleBehavior)
      .toBe('该结果需要先启用父效果生命周期。');

    const healthFloor = createEmptyResultDraft('HEALTH_FLOOR');
    healthFloor.resultKey = 'health_floor';
    healthFloor.name = '生命下限';
    healthFloor.value = formulaValue('heal');
    healthFloor.attributeKey = 'move_speed';
    const perStack = applyStackValueModeChange(healthFloor, 'PER_STACK');
    const invalidPerStack = validateSkillEffectDraft(
      lifecycleEnabledDraft([perStack]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(invalidPerStack.ok).toBe(false);
    if (invalidPerStack.ok) throw new Error('expected invalid');
    expect(invalidPerStack.resultErrors[0]?.fieldErrors.stackValueMode)
      .toBe('该结果只能使用整个实例共享数值。');

    const added = applyStackValueModeChange(healthFloor, 'SHARED');
    added.lifecycleBehavior.reapplicationValueMode = 'ADD';
    const invalidAdd = validateSkillEffectDraft(
      lifecycleEnabledDraft([added]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(invalidAdd.ok).toBe(false);
    if (invalidAdd.ok) throw new Error('expected invalid');
    expect(invalidAdd.resultErrors[0]?.fieldErrors.reapplicationValueMode)
      .toBe('该结果不能使用相加。');
  });

  it('rejects attribute SET with PER_STACK or ADD', () => {
    const attribute = createEmptyResultDraft('ATTRIBUTE_CHANGE');
    attribute.resultKey = 'set_speed';
    attribute.name = '覆盖移速';
    attribute.value = formulaValue('damage');
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
    adjust.value = formulaValue('one');
    adjust.targetEffectKey = 'toxic_trap';
    adjust.lifecycleOperation = 'CONSUME';

    const refresh = applyLifecycleOperationChange(
      { ...adjust, resultKey: 'refresh_trap', name: '刷新陷阱' },
      'REFRESH'
    );
    expect(refresh.value).toBeNull();
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
      spellShieldBlockScope: null,
      lifecycleBehavior: null,
      valueRule: {
        value: formulaValue("one"),
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
        { field: 'lifecycle.durationValue', code: 'REFRESH_OPERATION_IN_USE', message: '仍被刷新占用' },
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
        durationValue: "仍被刷新占用",
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
      unmappedMessages: ['越界时点'],
      inboundDependencies: []
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

describe('execute, hit-link and attack-link results', () => {
  it('exposes eighteen result types and chinese labels', () => {
    expect(SKILL_EFFECT_RESULT_TYPES).toHaveLength(19);
    expect(SKILL_EFFECT_RESULT_TYPE_LABELS.EXECUTE).toBe('斩杀');
    expect(SKILL_EFFECT_RESULT_TYPE_LABELS.HIT_LINK_APPLICATION).toBe('命中联动应用');
    expect(SKILL_EFFECT_RESULT_TYPE_LABELS.ATTACK_LINK_APPLICATION).toBe('攻击联动应用');
    expect(SKILL_EFFECT_RESULT_TYPE_LABELS.SKILL_HASTE_MODIFIER).toBe('技能急速修正');
    expect(valueFormulaLabelFor('EXECUTE')).toBe('斩杀阈值取值');
    expect(valueFormulaLabelFor('HIT_LINK_APPLICATION')).toBe('命中联动次数取值');
    expect(valueFormulaLabelFor('ATTACK_LINK_APPLICATION')).toBe('攻击联动次数取值');
  });

  it('maps execute attribute drafts and empty link details, including discrete moments', () => {
    const execute = createEmptyResultDraft('EXECUTE');
    execute.resultKey = 'collect_execute';
    execute.name = '斩杀';
    execute.value = formulaValue('heal');
    execute.attributeKey = 'mana';
    execute.spellShieldBlockScope = 'RESULT';
    const normalizedExecute = expectValid(validEffectDraft([execute]));
    expect(normalizedExecute.results[0]).toEqual({
      resultKey: 'collect_execute',
      name: '斩杀',
      resultType: 'EXECUTE',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      spellShieldBlockScope: 'RESULT',
      lifecycleBehavior: null,
      valueRule: {
        value: formulaValue("heal"),
        fixedMultiplier: 1,
        fixedMinValue: null,
        fixedMaxValue: null
      },
      detail: { attributeKey: 'mana' }
    });
    expect(skillEffectResultToDraft(normalizedExecute.results[0]!)).toMatchObject({
      resultType: 'EXECUTE',
      attributeKey: 'mana',
      value: formulaValue('heal'),
      modifierZoneKey: '',
      spellShieldBlockScope: 'RESULT'
    });

    const hitLink = createEmptyResultDraft('HIT_LINK_APPLICATION');
    hitLink.resultKey = 'on_hit_link';
    hitLink.name = '命中联动';
    hitLink.value = formulaValue('one');
    const attackLink = withBehavior(createEmptyResultDraft('ATTACK_LINK_APPLICATION'), {
      moment: 'APPLICATION',
      valueReadMode: 'APPLICATION_SNAPSHOT'
    });
    attackLink.resultKey = 'on_attack_link';
    attackLink.name = '攻击联动';
    attackLink.value = formulaValue('one');
    const periodic = withBehavior(hitLink, {
      moment: 'PERIODIC',
      valueReadMode: 'APPLICATION_SNAPSHOT',
      periodicExecutionMode: 'ONCE_PER_INSTANCE'
    });
    const normalizedLinks = expectValid(lifecycleEnabledDraft([periodic, attackLink], {
      periodicIntervalValue: formulaValue("poison_tick_interval_ms"),
      firstPeriodicExecution: 'AFTER_INTERVAL'
    }));
    expect(normalizedLinks.results[0]).toMatchObject({
      resultType: 'HIT_LINK_APPLICATION',
      detail: {},
      lifecycleBehavior: {
        moment: 'PERIODIC',
        valueReadMode: 'APPLICATION_SNAPSHOT',
        stackValueMode: null,
        reapplicationValueMode: null,
        periodicExecutionMode: 'ONCE_PER_INSTANCE'
      },
      valueRule: { value: formulaValue("one"), fixedMultiplier: 1 }
    });
    expect(normalizedLinks.results[1]).toMatchObject({
      resultType: 'ATTACK_LINK_APPLICATION',
      detail: {},
      valueRule: { value: formulaValue("one"), fixedMultiplier: 1 }
    });
  });

  it('clears modifier zones when switching to the new results and keeps them on other results', () => {
    const modifier = createEmptyResultDraft('DAMAGE_MODIFIER');
    modifier.resultKey = 'taken_reduction';
    modifier.name = '受到伤害降低';
    modifier.value = formulaValue('damage');
    modifier.modifierZoneKey = 'damage_ratio';
    modifier.modifierDirection = 'TAKEN';
    modifier.modifierOperation = 'DECREASE';
    const switched = applyResultTypeChange(modifier, 'EXECUTE');
    expect(switched.modifierZoneKey).toBe('');
    expect(switched.resultType).toBe('EXECUTE');
    expect(isPersistentMomentAllowed(switched)).toBe(false);
    expect(listAllowedLifecycleMoments(switched, true)).not.toContain('PERSISTENT');
    expect(listSpellShieldBlockScopeOptions(switched)).toEqual(['SKILL', 'EFFECT', 'RESULT']);
    expect(listSpellShieldBlockScopeOptions(switched)).not.toContain('DAMAGE_INSTANCE');

    const hitLink = createEmptyResultDraft('HIT_LINK_APPLICATION');
    hitLink.resultKey = 'on_hit_link';
    hitLink.name = '命中联动';
    hitLink.value = formulaValue('one');
    hitLink.spellShieldBlockScope = 'DAMAGE_INSTANCE';
    const invalidScope = validateSkillEffectDraft(validEffectDraft([hitLink]), {
      includeEffectKey: true,
      catalog: CATALOG
    });
    expect(invalidScope.ok).toBe(false);
    if (invalidScope.ok) throw new Error('expected invalid');
    expect(invalidScope.resultErrors[0]?.fieldErrors.spellShieldBlockScope)
      .toBe('当前结果不能使用该法术护盾阻挡粒度。');
    expect(isExecuteOrLinkResultType('ATTACK_LINK_APPLICATION')).toBe(true);

    const persistent = withBehavior(createEmptyResultDraft('EXECUTE'), { moment: 'PERSISTENT' });
    const invalidPersistent = validateSkillEffectDraft(
      lifecycleEnabledDraft([persistent]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(invalidPersistent.ok).toBe(false);
    if (invalidPersistent.ok) throw new Error('expected invalid');
    expect(invalidPersistent.resultErrors[0]?.fieldErrors.moment).toBe('该结果不能选择持续生效。');

    const sourceExecute = createEmptyResultDraft('EXECUTE');
    sourceExecute.target = 'SOURCE';
    sourceExecute.spellShieldBlockScope = 'RESULT';
    expect(clearHiddenResultFields(sourceExecute).spellShieldBlockScope).toBe('');
    expect(isSpellShieldBlockScopeVisible(sourceExecute)).toBe(false);
  });

  it('keeps a dynamic modifier and a new result in the same effect without losing zone or read mode', () => {
    const modifier = createEmptyResultDraft('DAMAGE_MODIFIER');
    modifier.resultKey = 'dynamic_taken';
    modifier.name = '动态减伤';
    modifier.value = formulaValue('damage');
    modifier.modifierZoneKey = 'damage_ratio';
    modifier.lifecycleBehavior.stackValueMode = 'SHARED';
    modifier.lifecycleBehavior.valueReadMode = 'MOMENT_EVALUATION';
    const normalizedModifier = clearHiddenLifecycleBehaviorFields(modifier);

    const execute = withBehavior(createEmptyResultDraft('EXECUTE'), {
      moment: 'APPLICATION',
      valueReadMode: 'APPLICATION_SNAPSHOT'
    });
    execute.resultKey = 'execute_hp';
    execute.name = '斩杀';
    execute.value = formulaValue('heal');
    execute.attributeKey = 'mana';
    execute.spellShieldBlockScope = 'SKILL';

    const normalized = expectValid(lifecycleEnabledDraft([normalizedModifier, execute]));
    expect(normalized.results[0]).toMatchObject({
      resultType: 'DAMAGE_MODIFIER',
      detail: { modifierZoneKey: 'damage_ratio' },
      lifecycleBehavior: {
        moment: 'PERSISTENT',
        valueReadMode: 'MOMENT_EVALUATION',
        stackValueMode: 'SHARED',
        reapplicationValueMode: null
      }
    });
    expect(normalized.results[1]).toMatchObject({
      resultType: 'EXECUTE',
      detail: { attributeKey: 'mana' },
      spellShieldBlockScope: 'SKILL'
    });
    const roundTrip = skillEffectToDraft({
      ...EFFECT,
      lifecycle: validLifecycle(),
      results: normalized.results
    });
    expect(roundTrip.results[0]).toMatchObject({
      resultType: 'DAMAGE_MODIFIER',
      modifierZoneKey: 'damage_ratio',
      lifecycleBehavior: { valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED' }
    });
    expect(roundTrip.results[1]).toMatchObject({
      resultType: 'EXECUTE',
      attributeKey: 'mana',
      modifierZoneKey: ''
    });
  });

  it('maps execute attribute and value-rule field issues', () => {
    const error = new ApiRequestError('效果信息不合法', 400, '400.VALIDATION_FAILED', {
      fieldIssues: [
        { field: 'results[0].detail.attributeKey', code: 'UNKNOWN_ATTRIBUTE', message: '属性不存在' },
        { field: 'results[0].valueRule.value', code: 'UNKNOWN_FORMULA', message: '公式不存在' },
        { field: 'results[0].spellShieldBlockScope', code: 'ENUM_INVALID', message: '阻挡范围不合法' }
      ]
    });
    expect(mapSkillEffectFieldIssues(error, [{ resultType: 'EXECUTE' }])).toEqual({
      fieldErrors: {},
      resultErrors: [{
        index: 0,
        fieldErrors: {
          attributeKey: '属性不存在',
          value: '公式不存在',
          spellShieldBlockScope: '阻挡范围不合法'
        }
      }],
      unmappedMessages: [],
      inboundDependencies: []
    });
  });
});

describe('affected skill scope and skill haste', () => {
  it('clears hidden collections on mode switch and does not leak scope onto other results', () => {
    const cooldown = createEmptyResultDraft('COOLDOWN_CHANGE');
    cooldown.resultKey = 'cdr';
    cooldown.name = '冷却';
    cooldown.value = formulaValue('cooldown_reduction_ms');
    cooldown.affectedSkillScope = {
      mode: 'SKILLS',
      skillKeys: ['ezreal_w', 'ezreal_w'],
      skillCategoryKeys: ['displacement']
    };
    const skillsOnly = applyAffectedSkillScopeModeChange(cooldown, 'SKILLS');
    expect(skillsOnly.affectedSkillScope).toEqual({
      mode: 'SKILLS',
      skillKeys: ['ezreal_w', 'ezreal_w'],
      skillCategoryKeys: []
    });
    const all = applyAffectedSkillScopeModeChange(skillsOnly, 'ALL');
    expect(all.affectedSkillScope).toEqual({
      mode: 'ALL',
      skillKeys: [],
      skillCategoryKeys: []
    });
    const categories = applyAffectedSkillScopeModeChange({
      ...all,
      affectedSkillScope: {
        mode: 'CATEGORIES',
        skillKeys: ['ezreal_w'],
        skillCategoryKeys: ['displacement']
      }
    }, 'CATEGORIES');
    expect(categories.affectedSkillScope).toEqual({
      mode: 'CATEGORIES',
      skillKeys: [],
      skillCategoryKeys: ['displacement']
    });

    const damage = applyResultTypeChange(categories, 'DAMAGE');
    expect(damage.affectedSkillScope).toEqual({
      mode: 'ALL',
      skillKeys: [],
      skillCategoryKeys: []
    });
    const normalizedDamage = expectValid(validEffectDraft([validDamageDraft({
      affectedSkillScope: {
        mode: 'SKILLS',
        skillKeys: ['ezreal_w'],
        skillCategoryKeys: ['displacement']
      }
    })]));
    expect(normalizedDamage.results[0]?.detail).not.toHaveProperty('affectedSkillScope');
  });

  it('round-trips three scope modes and retains disabled category refs', () => {
    const all = createEmptyResultDraft('COOLDOWN_CHANGE');
    all.resultKey = 'all_cd';
    all.name = '全部冷却';
    all.value = formulaValue('cooldown_reduction_ms');
    expect(expectValid(validEffectDraft([all])).results[0]?.detail).toMatchObject({
      affectedSkillScope: { mode: 'ALL', skillKeys: [], skillCategoryKeys: [] }
    });

    const categories = createEmptyResultDraft('COOLDOWN_CHANGE');
    categories.resultKey = 'cat_cd';
    categories.name = '分类冷却';
    categories.value = formulaValue('cooldown_reduction_ms');
    categories.affectedSkillScope = {
      mode: 'CATEGORIES',
      skillKeys: [],
      skillCategoryKeys: ['displacement']
    };
    expect(expectValid(validEffectDraft([categories])).results[0]?.detail).toMatchObject({
      affectedSkillScope: {
        mode: 'CATEGORIES',
        skillKeys: [],
        skillCategoryKeys: ['displacement']
      }
    });

    const retained = validateSkillEffectDraft(
      validEffectDraft([{
        ...categories,
        affectedSkillScope: {
          mode: 'CATEGORIES',
          skillKeys: [],
          skillCategoryKeys: ['retired_category']
        },
        originalResultType: 'COOLDOWN_CHANGE',
        originalSkillCategoryKeys: ['retired_category']
      }]),
      { includeEffectKey: false, catalog: CATALOG }
    );
    expect(retained.ok).toBe(true);

    const newDisabled = validateSkillEffectDraft(
      validEffectDraft([{
        ...categories,
        affectedSkillScope: {
          mode: 'CATEGORIES',
          skillKeys: [],
          skillCategoryKeys: ['retired_category']
        }
      }]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(newDisabled.ok).toBe(false);
    if (newDisabled.ok) throw new Error('expected invalid');
    expect(newDisabled.resultErrors[0]?.fieldErrors.skillCategoryKeys).toBe(DISABLED_CATALOG_MESSAGE);

    const unknown = validateSkillEffectDraft(
      validEffectDraft([{
        ...categories,
        affectedSkillScope: {
          mode: 'CATEGORIES',
          skillKeys: [],
          skillCategoryKeys: ['missing_category']
        }
      }]),
      { includeEffectKey: true, catalog: CATALOG }
    );
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error('expected invalid');
    expect(unknown.resultErrors[0]?.fieldErrors.skillCategoryKeys).toBe(INCOMPLETE_CATALOG_MESSAGE);

    const options = listAffectedSkillCategoryOptions(CATALOG, ['retired_category'], ['retired_category']);
    expect(options.some((item) => item.key === 'retired_category' && item.source === 'retained-disabled')).toBe(true);
  });

  it('builds skill haste with fixed lifecycle and rejects it without a parent lifecycle', () => {
    const haste = createEmptyResultDraft('SKILL_HASTE_MODIFIER');
    expect(usesAffectedSkillScope(haste.resultType)).toBe(true);
    expect(isPersistentOnlyResultType(haste.resultType)).toBe(true);
    expect(isPersistentNumericResult(haste)).toBe(true);
    expect(isFixedPersistentSnapshotResult(haste)).toBe(true);
    expect(supportsMomentEvaluation(haste)).toBe(false);
    expect(haste.lifecycleBehavior).toMatchObject({
      moment: 'PERSISTENT',
      valueReadMode: 'APPLICATION_SNAPSHOT',
      stackValueMode: 'SHARED',
      reapplicationValueMode: 'KEEP'
    });
    expect(haste.skillHasteOperation).toBe('INCREASE');
    expect(haste.modifierZoneKey).toBe('');
    expect(haste.spellShieldBlockScope).toBe('');

    haste.resultKey = 'displacement_haste';
    haste.name = '位移急速';
    haste.value = formulaValue('one');
    haste.affectedSkillScope = {
      mode: 'CATEGORIES',
      skillKeys: [],
      skillCategoryKeys: ['displacement']
    };

    const missingLifecycle = validateSkillEffectDraft(validEffectDraft([haste]), {
      includeEffectKey: true,
      catalog: CATALOG
    });
    expect(missingLifecycle.ok).toBe(false);
    if (missingLifecycle.ok) throw new Error('expected invalid');
    expect(missingLifecycle.resultErrors[0]?.fieldErrors.lifecycleBehavior)
      .toBe('该结果需要先启用父效果生命周期。');

    const normalized = expectValid(lifecycleEnabledDraft([haste]));
    expect(normalized.results[0]).toEqual({
      resultKey: 'displacement_haste',
      name: '位移急速',
      resultType: 'SKILL_HASTE_MODIFIER',
      target: 'TARGET',
      description: null,
      sortOrder: 0,
      spellShieldBlockScope: null,
      lifecycleBehavior: {
        moment: 'PERSISTENT',
        valueReadMode: 'APPLICATION_SNAPSHOT',
        stackValueMode: 'SHARED',
        reapplicationValueMode: 'KEEP',
        periodicExecutionMode: null
      },
      valueRule: {
        value: formulaValue("one"),
        fixedMultiplier: 1,
        fixedMinValue: null,
        fixedMaxValue: null
      },
      detail: {
        operation: 'INCREASE',
        affectedSkillScope: {
          mode: 'CATEGORIES',
          skillKeys: [],
          skillCategoryKeys: ['displacement']
        }
      }
    });
    expect(normalized.results[0]?.detail).not.toHaveProperty('affectedSkillKeys');
    expect(normalized.results[0]?.detail).not.toHaveProperty('modifierZoneKey');

    const switched = applyResultTypeChange(validDamageDraft({
      lifecycleBehavior: {
        moment: 'APPLICATION',
        valueReadMode: 'MOMENT_EVALUATION',
        stackValueMode: 'PER_STACK',
        reapplicationValueMode: 'ADD',
        periodicExecutionMode: ''
      }
    }), 'SKILL_HASTE_MODIFIER');
    expect(switched.lifecycleBehavior).toMatchObject({
      moment: 'PERSISTENT',
      valueReadMode: 'APPLICATION_SNAPSHOT',
      stackValueMode: 'SHARED',
      reapplicationValueMode: 'KEEP'
    });
    expect(listAllowedLifecycleMoments(switched, true)).toEqual(['PERSISTENT']);
  });

  it('maps nested affectedSkillScope and lifecycle moment field issues', () => {
    const error = new ApiRequestError('效果信息不合法', 400, '400.VALIDATION_FAILED', {
      fieldIssues: [
        { field: 'results[0].detail.affectedSkillScope.mode', code: 'ENUM_INVALID', message: '范围模式不合法' },
        { field: 'results[0].detail.affectedSkillScope.skillKeys[1]', code: 'UNKNOWN_SKILL', message: '技能不存在' },
        { field: 'results[0].detail.affectedSkillScope.skillCategoryKeys[0]', code: 'UNKNOWN_SKILL_CATEGORY', message: '分类不存在' },
        { field: 'results[0].lifecycleBehavior.moment', code: 'ENUM_INVALID', message: '时点不合法' },
        { field: 'results[0].detail.operation', code: 'ENUM_INVALID', message: '操作不合法' }
      ]
    });
    expect(mapSkillEffectFieldIssues(error, [{ resultType: 'SKILL_HASTE_MODIFIER' }])).toEqual({
      fieldErrors: {},
      resultErrors: [{
        index: 0,
        fieldErrors: {
          affectedSkillScopeMode: '范围模式不合法',
          affectedSkillKeys: '技能不存在',
          skillCategoryKeys: '分类不存在',
          moment: '时点不合法',
          skillHasteOperation: '操作不合法'
        }
      }],
      unmappedMessages: [],
      inboundDependencies: []
    });
  });
});
