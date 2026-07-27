import { describe, expect, it } from 'vitest';
import type {
  Ability,
  AbilityPhase,
  AbilityPhaseEffectSequence,
  EffectSequence,
  EffectStep,
  TypeDefinition
} from '../../../types/combatData';
import {
  buildDirectDamageAbilitySetupBody,
  createDefaultFormDraft,
  deriveGraphIdsFromProviderId,
  evaluateGraphCollisions,
  resolveRequiredTypes,
  validateFormDraft
} from './directDamageAbilityModel';

function typeRow(typeKey: string, typeId: number): TypeDefinition {
  return {
    gameId: 'demo',
    typeId,
    typeKey,
    changeRevision: 1,
    updatedAt: 't'
  };
}

function allTypes(): TypeDefinition[] {
  return [
    typeRow('ability_kind/active', 101),
    typeRow('ability_phase/impact', 102),
    typeRow('operation/damage', 103),
    typeRow('selector/opponent', 104),
    typeRow('value_policy/add', 105),
    typeRow('phase_trigger/on_enter', 106),
    typeRow('damage/physical', 201),
    typeRow('damage/magic', 202),
    typeRow('damage/true', 203)
  ];
}

describe('directDamageAbilityModel ID derivation', () => {
  it('derives exact stable IDs from provider stem', () => {
    expect(deriveGraphIdsFromProviderId('provider_ashe_volley')).toEqual({
      stem: 'ashe_volley',
      abilityId: 'ability_ashe_volley',
      phaseId: 'phase_ashe_volley_impact',
      sequenceId: 'sequence_ashe_volley_impact',
      stepId: 'step_ashe_volley_damage'
    });
  });

  it('rejects malformed provider IDs', () => {
    expect(deriveGraphIdsFromProviderId('ashe_volley')).toBeNull();
    expect(deriveGraphIdsFromProviderId('provider_')).toBeNull();
    expect(deriveGraphIdsFromProviderId('provider_Ashe')).toBeNull();
    expect(deriveGraphIdsFromProviderId('Provider_q')).toBeNull();
  });
});

describe('directDamageAbilityModel form validation', () => {
  it('rejects blank required fields and invalid abilityKey', () => {
    const blank = validateFormDraft(createDefaultFormDraft());
    expect(blank.ok).toBe(false);

    const badKey = validateFormDraft({
      ...createDefaultFormDraft(),
      providerId: 'provider_q',
      abilityKey: 'Bad-Key',
      displayName: 'Q',
      amountFormulaKey: 'dmg'
    });
    expect(badKey.ok).toBe(false);
    if (!badKey.ok) {
      expect(badKey.reason).toContain('abilityKey');
    }
  });

  it('trims optional formula keys to undefined', () => {
    const ok = validateFormDraft({
      ...createDefaultFormDraft(),
      providerId: 'provider_q',
      abilityKey: 'q',
      displayName: '  Volley  ',
      amountFormulaKey: '  dmg  ',
      castConditionFormulaKey: '   ',
      durationFormulaKey: ' dur ',
      conditionFormulaKey: ''
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.trimmed.displayName).toBe('Volley');
      expect(ok.trimmed.amountFormulaKey).toBe('dmg');
      expect(ok.trimmed.castConditionFormulaKey).toBeUndefined();
      expect(ok.trimmed.durationFormulaKey).toBe('dur');
      expect(ok.trimmed.conditionFormulaKey).toBeUndefined();
      expect(ok.trimmed.interruptible).toBe(true);
      expect(ok.trimmed.copyableOnHit).toBe(false);
      expect(ok.trimmed.critEligible).toBe(false);
    }
  });
});

describe('directDamageAbilityModel type resolution', () => {
  it('blocks when any required typeKey is missing', () => {
    const missing = resolveRequiredTypes(allTypes().filter((row) => row.typeKey !== 'damage/true'));
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.missingTypeKeys).toContain('damage/true');
    }
  });

  it('resolves integer type IDs for payload construction', () => {
    const types = resolveRequiredTypes(allTypes());
    expect(types.ok).toBe(true);
    if (!types.ok) {
      return;
    }

    const ids = deriveGraphIdsFromProviderId('provider_q');
    expect(ids).not.toBeNull();
    if (!ids) {
      return;
    }

    const form = validateFormDraft({
      ...createDefaultFormDraft(),
      providerId: 'provider_q',
      abilityKey: 'q',
      displayName: 'Q',
      amountFormulaKey: 'dmg',
      damageKind: 'magic'
    });
    expect(form.ok).toBe(true);
    if (!form.ok) {
      return;
    }

    const body = buildDirectDamageAbilitySetupBody(42, form.trimmed, ids, types);
    expect(body.expectedCurrentRevision).toBe(42);
    expect(body.ability.abilityKindTypeId).toBe(101);
    expect(body.phase.phaseTypeId).toBe(102);
    expect(body.phase.phaseOrder).toBe(0);
    expect(body.phase.interruptible).toBe(true);
    expect(body.effectSequence.sequenceKey).toBe('q_impact');
    expect(body.effectSequence.displayName).toBe('Q');
    expect(body.effectStep.stepOrder).toBe(0);
    expect(body.effectStep.operationTypeId).toBe(103);
    expect(body.effectStep.targetSelectorTypeId).toBe(104);
    expect(body.effectStep.damageDetail.damageTypeId).toBe(202);
    expect(body.effectStep.damageDetail.valuePolicyTypeId).toBe(105);
    expect(body.effectStep.damageDetail.copyableOnHit).toBe(false);
    expect(body.effectStep.damageDetail.critEligible).toBe(false);
    expect(body.phaseEffectSequenceBinding.triggerTypeId).toBe(106);
    expect(typeof body.ability.abilityKindTypeId).toBe('number');
  });
});

describe('directDamageAbilityModel collisions', () => {
  const ids = deriveGraphIdsFromProviderId('provider_q')!;

  it('blocks parent-mismatch hard conflicts', () => {
    const ability: Ability = {
      gameId: 'demo',
      abilityId: 'ability_q',
      providerId: 'provider_other',
      abilityKey: 'q',
      abilityKindTypeId: 1,
      displayName: 'Q',
      changeRevision: 1,
      updatedAt: 't'
    };
    const phase: AbilityPhase = {
      gameId: 'demo',
      phaseId: 'phase_q_impact',
      abilityId: 'ability_other',
      phaseOrder: 0,
      phaseTypeId: 1,
      interruptible: true,
      changeRevision: 1,
      updatedAt: 't'
    };
    const sequence: EffectSequence = {
      gameId: 'demo',
      sequenceId: 'sequence_q_impact',
      providerId: 'provider_other',
      sequenceKey: 'q_impact',
      changeRevision: 1,
      updatedAt: 't'
    };
    const step = {
      gameId: 'demo',
      stepId: 'step_q_damage',
      sequenceId: 'sequence_other',
      stepOrder: 0,
      operationTypeId: 1,
      targetSelectorTypeId: 1,
      damageDetail: {
        amountFormulaKey: 'dmg',
        damageTypeId: 1,
        valuePolicyTypeId: 1
      },
      changeRevision: 1,
      updatedAt: 't'
    } as EffectStep;

    const report = evaluateGraphCollisions(ids, 'provider_q', {
      abilities: [ability],
      phases: [phase],
      sequences: [sequence],
      steps: [step],
      bindings: []
    });

    expect(report.hasHardConflict).toBe(true);
    expect(report.ability).toBe('conflict');
    expect(report.phase).toBe('conflict');
    expect(report.sequence).toBe('conflict');
    expect(report.step).toBe('conflict');
    expect(report.hardConflicts).toHaveLength(4);
  });

  it('labels same-parent matches as update and only warns on binding mismatch', () => {
    const ability: Ability = {
      gameId: 'demo',
      abilityId: 'ability_q',
      providerId: 'provider_q',
      abilityKey: 'q',
      abilityKindTypeId: 1,
      displayName: 'Q',
      changeRevision: 1,
      updatedAt: 't'
    };
    const phase: AbilityPhase = {
      gameId: 'demo',
      phaseId: 'phase_q_impact',
      abilityId: 'ability_q',
      phaseOrder: 0,
      phaseTypeId: 1,
      interruptible: true,
      changeRevision: 1,
      updatedAt: 't'
    };
    const sequence: EffectSequence = {
      gameId: 'demo',
      sequenceId: 'sequence_q_impact',
      providerId: 'provider_q',
      sequenceKey: 'q_impact',
      changeRevision: 1,
      updatedAt: 't'
    };
    const step = {
      gameId: 'demo',
      stepId: 'step_q_damage',
      sequenceId: 'sequence_q_impact',
      stepOrder: 0,
      operationTypeId: 1,
      targetSelectorTypeId: 1,
      damageDetail: {
        amountFormulaKey: 'dmg',
        damageTypeId: 1,
        valuePolicyTypeId: 1
      },
      changeRevision: 1,
      updatedAt: 't'
    } as EffectStep;
    const binding: AbilityPhaseEffectSequence = {
      gameId: 'demo',
      phaseId: 'phase_q_impact',
      triggerTypeId: 1,
      sequenceId: 'sequence_other',
      changeRevision: 1,
      updatedAt: 't'
    };

    const report = evaluateGraphCollisions(ids, 'provider_q', {
      abilities: [ability],
      phases: [phase],
      sequences: [sequence],
      steps: [step],
      bindings: [binding]
    });

    expect(report.hasHardConflict).toBe(false);
    expect(report.ability).toBe('update');
    expect(report.phase).toBe('update');
    expect(report.sequence).toBe('update');
    expect(report.step).toBe('update');
    expect(report.bindingWarning).toContain('sequence_other');
  });
});
