import { formulaValue } from '../../../../types/numericValue';
import { describe, expect, it } from 'vitest';
import type { SkillEffect, SkillEffectResult } from '../../../../types/skillEffect';
import type { SkillTriggerPriorResultOutputKind } from '../../../../types/skillTriggerRule';
import {
  SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES,
  SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_DOMAINS,
  SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_KINDS,
  SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_LABELS,
  SKILL_TRIGGER_SOURCE_EFFECT_LOAD_MESSAGE,
  collectExecuteEffectFormulaKeys,
  createEmptyActionDraft,
  createEmptyEventSource,
  createEmptyRuleDraft,
  eventValueOptionLabel,
  filterPriorResultOutputsForParameter,
  findStalePriorResultBindings,
  isImmediateResult,
  listAvailablePriorResultOutputs,
  listEarlierExecuteEffectActions,
  listImmediateSourceResults,
  priorResultOutputDomain,
  priorResultOutputLabel,
  sourceValueDomain,
  validateSkillTriggerDraft
} from './triggerRuleForm';

const STAMP = {
  gameId: 'lol',
  skillKey: 'ashe_q',
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z'
} as const;

const VALUE_RULE = { value: formulaValue('base'), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null };

function effect(
  effectKey: string,
  results: SkillEffectResult[],
  lifecycle: SkillEffect['lifecycle'] = null
): SkillEffect {
  return {
    ...STAMP,
    effectKey,
    name: effectKey,
    description: null,
    sortOrder: 10,
    lifecycle,
    results
  };
}

function baseResult(
  resultKey: string,
  resultType: SkillEffectResult['resultType'],
  rest: Partial<SkillEffectResult> & Pick<SkillEffectResult, 'valueRule' | 'detail'>
): SkillEffectResult {
  return {
    resultKey,
    name: resultKey,
    target: 'TARGET',
    description: null,
    sortOrder: 10,
    spellShieldBlockScope: null,
    lifecycleBehavior: null,
    resultType,
    ...rest
  } as SkillEffectResult;
}

function executeAction(actionKey: string, effectKey: string, sortOrder: string) {
  return {
    ...createEmptyActionDraft([], 'EXECUTE_EFFECT' as const),
    actionKey,
    name: actionKey,
    sortOrder,
    detail: { effectKey }
  };
}

describe('stage 7.6.5 event values and prior-result outputs', () => {
  it('owns one event-value capability table for conditions and runtime bindings', () => {
    expect(SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES.DAMAGE_PENDING).toEqual([
      'RAW_DAMAGE',
      'POST_DEFENSE_DAMAGE',
      'HEALTH_BEFORE',
      'PROJECTED_HEALTH_AFTER'
    ]);
    expect(SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES.DAMAGE_DEALT).toEqual([
      'RAW_DAMAGE',
      'POST_DEFENSE_DAMAGE',
      'SHIELD_ABSORBED',
      'ACTUAL_HP_LOSS',
      'BLOCKED',
      'IMMUNE',
      'KILLED'
    ]);
    expect(SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES.DAMAGE_TAKEN).toEqual(
      SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES.DAMAGE_DEALT
    );
    expect(SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES.HIT_LINK_APPLIED).toEqual(['LINK_INDEX', 'LINK_COUNT']);
    expect(SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES.ATTACK_LINK_APPLIED).toEqual(['LINK_INDEX', 'LINK_COUNT']);
    expect(SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES.SPELL_SHIELD_BLOCKED).toEqual([]);
    expect(eventValueOptionLabel('KILLED')).toContain('否 = 0，是 = 1');
    expect(eventValueOptionLabel('LINK_INDEX')).toContain('从 1 开始');
  });

  it('exposes the final ten prior outputs with Chinese labels and value domains', () => {
    expect([...SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_KINDS]).toEqual([
      'CONFIGURED_VALUE',
      'RAW_DAMAGE',
      'POST_DEFENSE_DAMAGE',
      'SHIELD_ABSORBED',
      'ACTUAL_HP_LOSS',
      'ACTUAL_HEALING',
      'BLOCKED',
      'IMMUNE',
      'STATUS_APPLIED',
      'KILLED'
    ]);
    expect(priorResultOutputLabel('CONFIGURED_VALUE')).toBe('基础配置值');
    expect(priorResultOutputLabel('ACTUAL_HP_LOSS')).toBe('实际扣血');
    expect(priorResultOutputLabel('BLOCKED')).toBe('是否被法术护盾阻挡（0/1）');
    expect(priorResultOutputLabel('KILLED')).toBe('是否形成击杀（0/1）');
    expect(SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_LABELS.STATUS_APPLIED).toBe('是否成功施加状态（0/1）');
    expect(SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_DOMAINS.CONFIGURED_VALUE).toBe('DECIMAL');
    expect(priorResultOutputDomain('KILLED')).toBe('INTEGER');
    expect(priorResultOutputDomain('ACTUAL_HEALING')).toBe('DECIMAL');
  });

  it('matches the backend output matrix for each result kind', () => {
    const damage = baseResult('damage', 'DAMAGE', {
      valueRule: VALUE_RULE,
      detail: {
        damageTypeKey: 'physical',
        deliveryKind: 'SKILL',
        originKind: 'DIRECT',
        critical: { mode: 'DISALLOWED', multiplierValue: null },
        vampRules: []
      }
    });
    expect(listAvailablePriorResultOutputs(damage)).toEqual([
      'CONFIGURED_VALUE',
      'RAW_DAMAGE',
      'POST_DEFENSE_DAMAGE',
      'SHIELD_ABSORBED',
      'ACTUAL_HP_LOSS',
      'IMMUNE',
      'KILLED'
    ]);

    const vamped = structuredClone(damage);
    if (vamped.resultType === 'DAMAGE') {
      vamped.detail.vampRules = [{
        vampType: 'OMNIVAMP',
        basisOutputKind: 'ACTUAL_HP_LOSS',
        efficiencyValue: formulaValue("vamp")
      }];
    }
    expect(listAvailablePriorResultOutputs(vamped)).toContain('ACTUAL_HEALING');

    expect(listAvailablePriorResultOutputs(baseResult('heal', 'DIRECT_HEAL', {
      valueRule: VALUE_RULE,
      detail: {}
    }))).toEqual(['CONFIGURED_VALUE', 'ACTUAL_HEALING']);

    const blockedDamage = structuredClone(damage);
    blockedDamage.spellShieldBlockScope = 'RESULT';
    expect(listAvailablePriorResultOutputs(blockedDamage)).toContain('BLOCKED');

    const healWithScope = baseResult('heal', 'DIRECT_HEAL', {
      valueRule: VALUE_RULE,
      detail: {},
      spellShieldBlockScope: 'RESULT'
    });
    expect(listAvailablePriorResultOutputs(healWithScope)).not.toContain('BLOCKED');

    const shield = baseResult('shield', 'NORMAL_SHIELD', {
      valueRule: VALUE_RULE,
      detail: { absorbedDamageTypeKey: null, decayMode: 'NONE' },
      spellShieldBlockScope: 'RESULT'
    });
    expect(listAvailablePriorResultOutputs(shield)).toEqual(['CONFIGURED_VALUE']);

    expect(listAvailablePriorResultOutputs(baseResult('apply', 'STATUS_OPERATION', {
      valueRule: null,
      detail: { statusKey: 'slow', operation: 'APPLY' }
    }))).toEqual(['STATUS_APPLIED']);
    expect(listAvailablePriorResultOutputs(baseResult('remove', 'STATUS_OPERATION', {
      valueRule: null,
      detail: { statusKey: 'slow', operation: 'REMOVE' }
    }))).toEqual([]);

    expect(listAvailablePriorResultOutputs(baseResult('execute', 'EXECUTE', {
      valueRule: VALUE_RULE,
      detail: { attributeKey: 'hp' }
    }))).toEqual(['CONFIGURED_VALUE', 'KILLED']);

    const reduce = baseResult('cdr', 'COOLDOWN_CHANGE', {
      valueRule: VALUE_RULE,
      detail: {
        affectedSkillScope: { mode: 'SKILLS', skillKeys: ['q', 'w', 'e'], skillCategoryKeys: [] },
        operation: 'REDUCE'
      }
    });
    expect(listAvailablePriorResultOutputs(reduce)).toEqual(['CONFIGURED_VALUE']);
    const reset = baseResult('reset', 'COOLDOWN_CHANGE', {
      valueRule: null,
      detail: {
        affectedSkillScope: { mode: 'SKILLS', skillKeys: ['q', 'w'], skillCategoryKeys: [] },
        operation: 'RESET'
      }
    });
    expect(listAvailablePriorResultOutputs(reset)).toEqual([]);

    const modifier = baseResult('taken', 'DAMAGE_MODIFIER', {
      valueRule: VALUE_RULE,
      detail: {
        modifierZoneKey: 'pre_defense',
        direction: 'TAKEN',
        operation: 'DECREASE',
        damageTypeKey: null,
        deliveryKind: 'ANY',
        originKind: 'ANY',
        criticalFilter: 'ANY'
      }
    });
    expect(listAvailablePriorResultOutputs(modifier)).toEqual(['CONFIGURED_VALUE']);
    expect(listAvailablePriorResultOutputs(modifier)).not.toContain('FINAL_MODIFIED_VALUE' as SkillTriggerPriorResultOutputKind);
    expect(collectExecuteEffectFormulaKeys(effect('zones', [
      modifier,
      baseResult('heal_mod', 'HEALING_MODIFIER', {
        valueRule: { ...VALUE_RULE, value: formulaValue("heal_mod_formula") },
        detail: {
          modifierZoneKey: 'post_defense',
          direction: 'RECEIVED',
          operation: 'INCREASE',
          healingKind: 'ANY'
        }
      }),
      baseResult('floor', 'HEALTH_FLOOR', {
        valueRule: { ...VALUE_RULE, value: formulaValue("floor_formula") },
        detail: { attributeKey: 'hp' }
      })
    ]))).toEqual(['base', 'heal_mod_formula', 'floor_formula']);
  });

  it('filters integer targets to integer outputs and keeps decimal targets mixed', () => {
    const damage = baseResult('damage', 'DAMAGE', {
      valueRule: VALUE_RULE,
      detail: {
        damageTypeKey: 'physical',
        deliveryKind: 'SKILL',
        originKind: 'DIRECT',
        critical: { mode: 'DISALLOWED', multiplierValue: null },
        vampRules: []
      }
    });
    const all = listAvailablePriorResultOutputs(damage);
    expect(filterPriorResultOutputsForParameter(all, 'INTEGER')).toEqual(['IMMUNE', 'KILLED']);
    expect(filterPriorResultOutputsForParameter(all, 'DECIMAL')).toEqual(all);
    expect(sourceValueDomain({
      bindingKey: 'bind',
      parameterKey: 'killed',
      sourceType: 'PRIOR_ACTION_RESULT',
      detail: { sourceActionKey: 'first', sourceResultKey: 'damage', outputKind: 'KILLED' }
    })).toBe('INTEGER');
  });

  it('lists earlier execute-effect actions by sortOrder then actionKey and skips current or later', () => {
    const actions = [
      executeAction('later_key', 'later', '10'),
      executeAction('earlier_key', 'first', '10'),
      executeAction('current', 'second', '20')
    ];
    expect(listEarlierExecuteEffectActions(actions, 2).map((item) => item.sourceActionKey)).toEqual([
      'earlier_key',
      'later_key'
    ]);
    expect(listEarlierExecuteEffectActions(actions, 0)).toEqual([]);
  });

  it('excludes non-application lifecycle and MOMENT_EVALUATION persistent modifiers', () => {
    const lifecycle = {
      durationValue: formulaValue("ms"),
      maxStacksValue: formulaValue("one"),
      applicationStacksValue: formulaValue("one"),
      instanceScope: 'TARGET' as const,
      reapplicationStackMode: 'KEEP' as const,
      reapplicationDurationMode: 'REFRESH_ALL' as const,
      expiryMode: 'ALL_AT_ONCE' as const,
      periodicIntervalValue: null,
      firstPeriodicExecution: null
    };
    const persistentModifier = baseResult('taken', 'DAMAGE_MODIFIER', {
      valueRule: VALUE_RULE,
      lifecycleBehavior: {
        moment: 'PERSISTENT',
        valueReadMode: 'MOMENT_EVALUATION',
        stackValueMode: 'SHARED',
        reapplicationValueMode: null,
        periodicExecutionMode: null
      },
      detail: {
        modifierZoneKey: 'pre_defense',
        direction: 'TAKEN',
        operation: 'DECREASE',
        damageTypeKey: null,
        deliveryKind: 'ANY',
        originKind: 'ANY',
        criticalFilter: 'ANY'
      }
    });
    expect(isImmediateResult(persistentModifier, true)).toBe(false);
    expect(listImmediateSourceResults(effect('guard', [persistentModifier], lifecycle))).toEqual([]);

    const cooldown = baseResult('cdr', 'COOLDOWN_CHANGE', {
      valueRule: VALUE_RULE,
      detail: {
        affectedSkillScope: { mode: 'SKILLS', skillKeys: ['q', 'w'], skillCategoryKeys: [] },
        operation: 'REDUCE'
      }
    });
    expect(listImmediateSourceResults(effect('cdr_effect', [cooldown, cooldown])).map((item) => item.resultKey))
      .toEqual(['cdr']);
  });

  it('marks prior-result bindings stale after reorder and keeps missing-effect bindings for retry', () => {
    const first = executeAction('first', 'on_hit', '10');
    const second = {
      ...executeAction('second', 'follow', '20'),
      runtimeInputBindings: [{
        bindingKey: 'bind_killed',
        parameterKey: 'killed',
        sourceType: 'PRIOR_ACTION_RESULT' as const,
        detail: {
          sourceActionKey: 'first',
          sourceResultKey: 'damage',
          outputKind: 'KILLED' as const
        }
      }]
    };
    const reordered = [second, { ...first, sortOrder: '30' }];
    const damageEffect = effect('on_hit', [baseResult('damage', 'DAMAGE', {
      valueRule: VALUE_RULE,
      detail: {
        damageTypeKey: 'physical',
        deliveryKind: 'SKILL',
        originKind: 'DIRECT',
        critical: { mode: 'DISALLOWED', multiplierValue: null },
        vampRules: []
      }
    })]);
    const stale = findStalePriorResultBindings(reordered, new Map([['on_hit', damageEffect]]));
    expect(stale[0]?.bindingKeys).toEqual(['bind_killed']);
    expect(stale[0]?.summaries[0]).toBe('second / bind_killed / damage / 是否形成击杀（0/1）');

    const missing = findStalePriorResultBindings([first, second], new Map());
    expect(missing).toEqual([]);

    const draft = {
      ...createEmptyRuleDraft(),
      ruleKey: 'prior_scale',
      name: '前序驱动',
      sortOrder: '10',
      actions: [first, second]
    };
    const blocked = validateSkillTriggerDraft(draft, {
      includeRuleKey: true,
      effectsByKey: new Map()
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error('expected missing source effect');
    expect(blocked.nestedErrors).toContainEqual({
      path: 'actions[1].runtimeInputBindings[0].detail.sourceActionKey',
      message: SKILL_TRIGGER_SOURCE_EFFECT_LOAD_MESSAGE
    });
  });

  it('keeps skill haste out of immediate prior-result outputs', () => {
    const haste = baseResult('haste', 'SKILL_HASTE_MODIFIER', {
      valueRule: VALUE_RULE,
      lifecycleBehavior: {
        moment: 'PERSISTENT',
        valueReadMode: 'APPLICATION_SNAPSHOT',
        stackValueMode: 'SHARED',
        reapplicationValueMode: 'KEEP',
        periodicExecutionMode: null
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
    expect(isImmediateResult(haste, true)).toBe(false);
    expect(listImmediateSourceResults(effect('haste_effect', [haste], {
      durationValue: formulaValue("ms"),
      maxStacksValue: formulaValue("one"),
      applicationStacksValue: formulaValue("one"),
      instanceScope: 'SOURCE',
      reapplicationStackMode: 'KEEP',
      reapplicationDurationMode: 'REFRESH_ALL',
      expiryMode: 'ALL_AT_ONCE',
      periodicIntervalValue: null,
      firstPeriodicExecution: null
    }))).toEqual([]);
    expect(listAvailablePriorResultOutputs(haste)).toEqual(['CONFIGURED_VALUE']);
  });

  it('does not expose event values for pending damage actual HP loss or kill', () => {
    expect(SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES.DAMAGE_PENDING).not.toContain('ACTUAL_HP_LOSS');
    expect(SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES.DAMAGE_PENDING).not.toContain('KILLED');
    expect(SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES.DAMAGE_PENDING).not.toContain('SHIELD_ABSORBED');
    expect(createEmptyEventSource('SPELL_SHIELD_BLOCKED').eventType).toBe('SPELL_SHIELD_BLOCKED');
  });
});
