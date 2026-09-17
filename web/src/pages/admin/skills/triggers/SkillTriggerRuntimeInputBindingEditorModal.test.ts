import { formulaValue } from '../../../../types/numericValue';
import { describe, expect, it } from 'vitest';
import type { SkillEffect, SkillEffectResult } from '../../../../types/skillEffect';
import type { SkillTriggerPriorResultBinding } from '../../../../types/skillTriggerRule';
import {
  confirmedPriorResultBinding,
  initialPriorResultOutputSelection,
  isPriorResultEditorConfirmReady,
  priorResultDraftSummary,
  retainPriorResultOutputSelection
} from './SkillTriggerRuntimeInputBindingEditorModal';
import {
  createEmptyBinding,
  filterPriorResultOutputsForParameter,
  listAvailablePriorResultOutputs,
  patchPriorResultBinding,
  switchBindingSourceType,
  type PriorSourceActionOption
} from './triggerRuleForm';

const STAMP = {
  gameId: 'lol',
  skillKey: 'ashe_q',
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z'
} as const;

const VALUE_RULE = { value: formulaValue('base'), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null };

function damageResult(resultKey: string, vamp = false): SkillEffectResult {
  return {
    resultKey,
    name: resultKey,
    target: 'TARGET',
    description: null,
    sortOrder: 10,
    spellShieldBlockScope: null,
    lifecycleBehavior: null,
    resultType: 'DAMAGE',
    valueRule: VALUE_RULE,
    detail: {
      damageTypeKey: 'physical',
      deliveryKind: 'SKILL',
      originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierValue: null },
      vampRules: vamp
        ? [{
          vampType: 'OMNIVAMP',
          basisOutputKind: 'ACTUAL_HP_LOSS',
          efficiencyValue: formulaValue("vamp")
        }]
        : []
    }
  };
}

function healResult(resultKey: string): SkillEffectResult {
  return {
    resultKey,
    name: resultKey,
    target: 'TARGET',
    description: null,
    sortOrder: 20,
    spellShieldBlockScope: null,
    lifecycleBehavior: null,
    resultType: 'DIRECT_HEAL',
    valueRule: VALUE_RULE,
    detail: {}
  };
}

function effect(effectKey: string, results: SkillEffectResult[]): SkillEffect {
  return {
    ...STAMP,
    effectKey,
    name: effectKey,
    description: null,
    sortOrder: 10,
    lifecycle: null,
    results
  };
}

const SOURCE_ACTION: PriorSourceActionOption = {
  sourceActionKey: 'first',
  sourceActionName: 'first',
  sourceEffectKey: 'on_hit'
};

const PRIOR_BINDING: SkillTriggerPriorResultBinding = {
  bindingKey: 'bind_prior',
  parameterKey: 'prior_hit_value',
  sourceType: 'PRIOR_ACTION_RESULT',
  detail: {
    sourceActionKey: 'first',
    sourceResultKey: 'damage',
    outputKind: 'KILLED'
  }
};

const DAMAGE_EFFECT = effect('on_hit', [damageResult('damage', true), healResult('heal')]);
const DAMAGE_OUTPUTS = filterPriorResultOutputsForParameter(
  listAvailablePriorResultOutputs(DAMAGE_EFFECT.results[0]),
  'DECIMAL'
);
const INTEGER_OUTPUTS = filterPriorResultOutputsForParameter(
  listAvailablePriorResultOutputs(DAMAGE_EFFECT.results[0]),
  'INTEGER'
);
const HEAL_OUTPUTS = filterPriorResultOutputsForParameter(
  listAvailablePriorResultOutputs(DAMAGE_EFFECT.results[1]),
  'DECIMAL'
);

function confirmReady(
  overrides: Partial<Parameters<typeof isPriorResultEditorConfirmReady>[0]> = {}
): boolean {
  return isPriorResultEditorConfirmReady({
    selectedSourceAction: SOURCE_ACTION,
    sourceEffect: DAMAGE_EFFECT,
    sourceEffectLoading: false,
    sourceEffectError: null,
    sourceResultKey: 'damage',
    immediateSourceResults: DAMAGE_EFFECT.results,
    selectedOutputKind: 'KILLED',
    legalOutputOptions: INTEGER_OUTPUTS,
    parameterValueType: 'INTEGER',
    ...overrides
  });
}

describe('SkillTriggerRuntimeInputBindingEditorModal prior-result output selection', () => {
  it('does not treat CONFIGURED_VALUE as selected after create, source switch, or source action/result changes', () => {
    expect(initialPriorResultOutputSelection('create', null)).toBeNull();
    const switched = switchBindingSourceType(
      createEmptyBinding([], 'INTERNAL_STATE'),
      'PRIOR_ACTION_RESULT'
    );
    expect(switched.sourceType).toBe('PRIOR_ACTION_RESULT');
    if (switched.sourceType !== 'PRIOR_ACTION_RESULT') {
      throw new Error('expected prior-action-result binding');
    }
    expect(switched.detail.outputKind).toBe('CONFIGURED_VALUE');
    expect(initialPriorResultOutputSelection('create', switched)).toBeNull();
    expect(priorResultDraftSummary(switched, null)).not.toContain('基础配置值');

    const afterActionChange = patchPriorResultBinding(PRIOR_BINDING, {
      sourceActionKey: 'other',
      sourceResultKey: ''
    });
    expect(afterActionChange.detail.outputKind).toBe('KILLED');
    expect(retainPriorResultOutputSelection(null, DAMAGE_OUTPUTS, {
      canEvaluateAvailability: true,
      parameterValueType: 'DECIMAL'
    })).toBeNull();
    expect(confirmReady({
      selectedOutputKind: null,
      sourceResultKey: '',
      legalOutputOptions: DAMAGE_OUTPUTS,
      parameterValueType: 'DECIMAL'
    })).toBe(false);

    const afterResultChange = patchPriorResultBinding(PRIOR_BINDING, {
      sourceResultKey: 'heal'
    });
    expect(afterResultChange.detail.sourceResultKey).toBe('heal');
    expect(retainPriorResultOutputSelection(null, HEAL_OUTPUTS, {
      canEvaluateAvailability: true,
      parameterValueType: 'DECIMAL'
    })).toBeNull();
    expect(HEAL_OUTPUTS).toContain('CONFIGURED_VALUE');
    expect(confirmReady({
      selectedOutputKind: null,
      sourceResultKey: 'heal',
      legalOutputOptions: HEAL_OUTPUTS,
      parameterValueType: 'DECIMAL'
    })).toBe(false);
    expect(confirmReady({
      selectedOutputKind: 'CONFIGURED_VALUE',
      sourceResultKey: 'heal',
      legalOutputOptions: HEAL_OUTPUTS,
      parameterValueType: 'DECIMAL'
    })).toBe(true);
  });

  it('reopens a still-legal existing edit output and keeps it through source-effect load failure', () => {
    expect(initialPriorResultOutputSelection('edit', PRIOR_BINDING)).toBe('KILLED');
    expect(retainPriorResultOutputSelection('KILLED', INTEGER_OUTPUTS, {
      canEvaluateAvailability: true,
      parameterValueType: 'INTEGER'
    })).toBe('KILLED');
    expect(retainPriorResultOutputSelection('KILLED', [], {
      canEvaluateAvailability: false,
      parameterValueType: 'INTEGER'
    })).toBe('KILLED');
    expect(confirmReady({
      sourceEffect: null,
      sourceEffectError: '来源效果详情未加载，无法校验前序结果。请重试。',
      selectedOutputKind: 'KILLED',
      legalOutputOptions: []
    })).toBe(false);
    expect(retainPriorResultOutputSelection('KILLED', INTEGER_OUTPUTS, {
      canEvaluateAvailability: true,
      parameterValueType: 'INTEGER'
    })).toBe('KILLED');
    expect(confirmReady()).toBe(true);
    expect(priorResultDraftSummary(PRIOR_BINDING, 'KILLED')).toBe(
      '更早动作结果 / first / damage / 是否形成击杀（0/1）'
    );
  });

  it('clears an output that is no longer compatible or legal after parameter or result changes', () => {
    expect(retainPriorResultOutputSelection('CONFIGURED_VALUE', DAMAGE_OUTPUTS, {
      canEvaluateAvailability: true,
      parameterValueType: 'INTEGER'
    })).toBeNull();
    expect(retainPriorResultOutputSelection('CONFIGURED_VALUE', [], {
      canEvaluateAvailability: false,
      parameterValueType: 'INTEGER'
    })).toBeNull();
    expect(retainPriorResultOutputSelection('KILLED', HEAL_OUTPUTS, {
      canEvaluateAvailability: true,
      parameterValueType: 'DECIMAL'
    })).toBeNull();
    expect(retainPriorResultOutputSelection('ACTUAL_HEALING', DAMAGE_OUTPUTS, {
      canEvaluateAvailability: true,
      parameterValueType: 'DECIMAL'
    })).toBe('ACTUAL_HEALING');
  });

  it('keeps confirm disabled until earlier action, loaded effect, immediate result, and explicit legal output are all present', () => {
    expect(confirmReady({ selectedSourceAction: null })).toBe(false);
    expect(confirmReady({ sourceEffect: null })).toBe(false);
    expect(confirmReady({ sourceEffectLoading: true })).toBe(false);
    expect(confirmReady({ sourceResultKey: '' })).toBe(false);
    expect(confirmReady({ sourceResultKey: 'missing' })).toBe(false);
    expect(confirmReady({ selectedOutputKind: null })).toBe(false);
    expect(confirmReady({
      selectedOutputKind: 'CONFIGURED_VALUE',
      legalOutputOptions: INTEGER_OUTPUTS
    })).toBe(false);
    expect(confirmReady({ parameterValueType: null })).toBe(false);
    expect(confirmReady({
      selectedOutputKind: 'KILLED',
      legalOutputOptions: INTEGER_OUTPUTS,
      parameterValueType: 'INTEGER'
    })).toBe(true);
    expect(confirmReady({
      selectedOutputKind: 'KILLED',
      legalOutputOptions: DAMAGE_OUTPUTS,
      parameterValueType: 'DECIMAL'
    })).toBe(true);
  });

  it('confirms only an explicit legal outputKind and never adds sourceEffectKey', () => {
    expect(confirmedPriorResultBinding(PRIOR_BINDING, null)).toBeNull();
    const confirmed = confirmedPriorResultBinding(PRIOR_BINDING, 'ACTUAL_HP_LOSS');
    expect(confirmed?.detail).toEqual({
      sourceActionKey: 'first',
      sourceResultKey: 'damage',
      outputKind: 'ACTUAL_HP_LOSS'
    });
    expect(confirmed?.detail).not.toHaveProperty('sourceEffectKey');
    expect(Object.keys(confirmed?.detail ?? {}).sort()).toEqual([
      'outputKind',
      'sourceActionKey',
      'sourceResultKey'
    ]);
  });
});
