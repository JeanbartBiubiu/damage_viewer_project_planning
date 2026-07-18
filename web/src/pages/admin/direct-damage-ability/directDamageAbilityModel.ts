import type {
  Ability,
  AbilityPhase,
  AbilityPhaseEffectSequence,
  DirectDamageAbilitySetupPutBody,
  EffectSequence,
  EffectStep,
  TypeDefinition
} from '../../../types/combatData';

export const PROVIDER_ID_PATTERN = /^provider_([a-z0-9][a-z0-9_]*)$/;
export const ABILITY_KEY_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

/** Fixed semantic typeKeys resolved from GET types (never hard-coded numeric IDs). */
export const FIXED_TYPE_KEYS = {
  abilityKind: 'ability_kind/active',
  phaseType: 'ability_phase/impact',
  operation: 'operation/damage',
  targetSelector: 'selector/opponent',
  valuePolicy: 'value_policy/add',
  phaseTrigger: 'phase_trigger/on_enter'
} as const;

export const DAMAGE_KIND_OPTIONS = [
  { kind: 'physical', typeKey: 'damage/physical', label: '物理' },
  { kind: 'magic', typeKey: 'damage/magic', label: '魔法' },
  { kind: 'true', typeKey: 'damage/true', label: '真实' }
] as const;

export type DamageKind = (typeof DAMAGE_KIND_OPTIONS)[number]['kind'];

export type DerivedGraphIds = {
  stem: string;
  abilityId: string;
  phaseId: string;
  sequenceId: string;
  stepId: string;
};

export type DirectDamageAbilityFormDraft = {
  providerId: string;
  abilityKey: string;
  displayName: string;
  amountFormulaKey: string;
  damageKind: DamageKind;
  castConditionFormulaKey: string;
  durationFormulaKey: string;
  conditionFormulaKey: string;
  interruptible: boolean;
  copyableOnHit: boolean;
  critEligible: boolean;
};

export type ResolvedFixedTypes = {
  abilityKindTypeId: number;
  phaseTypeId: number;
  operationTypeId: number;
  targetSelectorTypeId: number;
  valuePolicyTypeId: number;
  triggerTypeId: number;
};

export type TypeResolution =
  | { ok: true; fixed: ResolvedFixedTypes; damageTypeIdByKind: Record<DamageKind, number> }
  | { ok: false; missingTypeKeys: string[] };

export type CollisionNodeStatus = 'absent' | 'update' | 'conflict';

export type GraphCollisionReport = {
  ability: CollisionNodeStatus;
  phase: CollisionNodeStatus;
  sequence: CollisionNodeStatus;
  step: CollisionNodeStatus;
  /** Non-blocking: same phaseId already bound to a different sequenceId. */
  bindingWarning: string | null;
  hardConflicts: string[];
  hasHardConflict: boolean;
};

export type FormValidation =
  | { ok: true; trimmed: ValidatedFormFields }
  | { ok: false; reason: string };

export type ValidatedFormFields = {
  providerId: string;
  abilityKey: string;
  displayName: string;
  amountFormulaKey: string;
  damageKind: DamageKind;
  castConditionFormulaKey?: string;
  durationFormulaKey?: string;
  conditionFormulaKey?: string;
  interruptible: boolean;
  copyableOnHit: boolean;
  critEligible: boolean;
};

export function createDefaultFormDraft(): DirectDamageAbilityFormDraft {
  return {
    providerId: '',
    abilityKey: '',
    displayName: '',
    amountFormulaKey: '',
    damageKind: 'physical',
    castConditionFormulaKey: '',
    durationFormulaKey: '',
    conditionFormulaKey: '',
    interruptible: true,
    copyableOnHit: false,
    critEligible: false
  };
}

export function deriveGraphIdsFromProviderId(providerId: string): DerivedGraphIds | null {
  const match = PROVIDER_ID_PATTERN.exec(providerId.trim());
  if (!match) {
    return null;
  }
  const stem = match[1];
  return {
    stem,
    abilityId: `ability_${stem}`,
    phaseId: `phase_${stem}_impact`,
    sequenceId: `sequence_${stem}_impact`,
    stepId: `step_${stem}_damage`
  };
}

export function optionalTrimmed(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

export function validateFormDraft(draft: DirectDamageAbilityFormDraft): FormValidation {
  const providerId = draft.providerId.trim();
  if (!providerId) {
    return { ok: false, reason: '请选择已有 Provider。' };
  }
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    return {
      ok: false,
      reason: `Provider ID「${providerId}」不符合 provider_<stem> 约定，无法推导稳定图 ID。`
    };
  }

  const abilityKey = draft.abilityKey.trim();
  if (!abilityKey) {
    return { ok: false, reason: 'abilityKey 不能为空。' };
  }
  if (!ABILITY_KEY_PATTERN.test(abilityKey)) {
    return {
      ok: false,
      reason: 'abilityKey 须匹配 ^[a-z0-9][a-z0-9_]*$。'
    };
  }

  const displayName = draft.displayName.trim();
  if (!displayName) {
    return { ok: false, reason: 'displayName 不能为空。' };
  }

  const amountFormulaKey = draft.amountFormulaKey.trim();
  if (!amountFormulaKey) {
    return { ok: false, reason: 'amountFormulaKey 不能为空。' };
  }

  return {
    ok: true,
    trimmed: {
      providerId,
      abilityKey,
      displayName,
      amountFormulaKey,
      damageKind: draft.damageKind,
      castConditionFormulaKey: optionalTrimmed(draft.castConditionFormulaKey),
      durationFormulaKey: optionalTrimmed(draft.durationFormulaKey),
      conditionFormulaKey: optionalTrimmed(draft.conditionFormulaKey),
      interruptible: draft.interruptible,
      copyableOnHit: draft.copyableOnHit,
      critEligible: draft.critEligible
    }
  };
}

function typeIdByKey(types: TypeDefinition[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of types) {
    if (typeof row.typeId === 'number' && Number.isFinite(row.typeId) && row.typeKey) {
      map.set(row.typeKey, row.typeId);
    }
  }
  return map;
}

/** Resolve required typeIds from exact typeKey matches; never invent IDs. */
export function resolveRequiredTypes(types: TypeDefinition[]): TypeResolution {
  const byKey = typeIdByKey(types);
  const requiredFixed = Object.values(FIXED_TYPE_KEYS);
  const requiredDamage = DAMAGE_KIND_OPTIONS.map((item) => item.typeKey);
  const missingTypeKeys = [...requiredFixed, ...requiredDamage].filter((key) => !byKey.has(key));

  if (missingTypeKeys.length > 0) {
    return { ok: false, missingTypeKeys };
  }

  return {
    ok: true,
    fixed: {
      abilityKindTypeId: byKey.get(FIXED_TYPE_KEYS.abilityKind) as number,
      phaseTypeId: byKey.get(FIXED_TYPE_KEYS.phaseType) as number,
      operationTypeId: byKey.get(FIXED_TYPE_KEYS.operation) as number,
      targetSelectorTypeId: byKey.get(FIXED_TYPE_KEYS.targetSelector) as number,
      valuePolicyTypeId: byKey.get(FIXED_TYPE_KEYS.valuePolicy) as number,
      triggerTypeId: byKey.get(FIXED_TYPE_KEYS.phaseTrigger) as number
    },
    damageTypeIdByKind: {
      physical: byKey.get('damage/physical') as number,
      magic: byKey.get('damage/magic') as number,
      true: byKey.get('damage/true') as number
    }
  };
}

export function evaluateGraphCollisions(
  ids: DerivedGraphIds,
  providerId: string,
  lists: {
    abilities: Ability[];
    phases: AbilityPhase[];
    sequences: EffectSequence[];
    steps: EffectStep[];
    bindings: AbilityPhaseEffectSequence[];
  }
): GraphCollisionReport {
  const hardConflicts: string[] = [];

  const existingAbility = lists.abilities.find((row) => row.abilityId === ids.abilityId);
  let ability: CollisionNodeStatus = 'absent';
  if (existingAbility) {
    if (existingAbility.providerId !== providerId) {
      ability = 'conflict';
      hardConflicts.push(
        `abilityId「${ids.abilityId}」已归属 provider「${existingAbility.providerId}」，与所选「${providerId}」冲突（见 #/combat-data/abilities）。`
      );
    } else {
      ability = 'update';
    }
  }

  const existingPhase = lists.phases.find((row) => row.phaseId === ids.phaseId);
  let phase: CollisionNodeStatus = 'absent';
  if (existingPhase) {
    if (existingPhase.abilityId !== ids.abilityId) {
      phase = 'conflict';
      hardConflicts.push(
        `phaseId「${ids.phaseId}」已归属 ability「${existingPhase.abilityId}」，与推导「${ids.abilityId}」冲突（见 #/combat-data/ability-phases）。`
      );
    } else {
      phase = 'update';
    }
  }

  const existingSequence = lists.sequences.find((row) => row.sequenceId === ids.sequenceId);
  let sequence: CollisionNodeStatus = 'absent';
  if (existingSequence) {
    if (existingSequence.providerId !== providerId) {
      sequence = 'conflict';
      hardConflicts.push(
        `sequenceId「${ids.sequenceId}」已归属 provider「${existingSequence.providerId}」，与所选「${providerId}」冲突（见 #/combat-data/effect-sequences）。`
      );
    } else {
      sequence = 'update';
    }
  }

  const existingStep = lists.steps.find((row) => row.stepId === ids.stepId);
  let step: CollisionNodeStatus = 'absent';
  if (existingStep) {
    if (existingStep.sequenceId !== ids.sequenceId) {
      step = 'conflict';
      hardConflicts.push(
        `stepId「${ids.stepId}」已归属 sequence「${existingStep.sequenceId}」，与推导「${ids.sequenceId}」冲突（见 #/combat-data/effect-steps）。`
      );
    } else {
      step = 'update';
    }
  }

  const bindingsForPhase = lists.bindings.filter((row) => row.phaseId === ids.phaseId);
  const mismatched = bindingsForPhase.find((row) => row.sequenceId !== ids.sequenceId);
  const bindingWarning = mismatched
    ? `phaseId「${ids.phaseId}」已绑定 sequence「${mismatched.sequenceId}」（非本页推导的「${ids.sequenceId}」）；保存将按契约 upsert 本页绑定，不会删除其它图节点。`
    : null;

  return {
    ability,
    phase,
    sequence,
    step,
    bindingWarning,
    hardConflicts,
    hasHardConflict: hardConflicts.length > 0
  };
}

export function buildDirectDamageAbilitySetupBody(
  expectedCurrentRevision: number,
  fields: ValidatedFormFields,
  ids: DerivedGraphIds,
  types: Extract<TypeResolution, { ok: true }>
): DirectDamageAbilitySetupPutBody {
  const damageTypeId = types.damageTypeIdByKind[fields.damageKind];

  const ability: DirectDamageAbilitySetupPutBody['ability'] = {
    abilityId: ids.abilityId,
    providerId: fields.providerId,
    abilityKey: fields.abilityKey,
    abilityKindTypeId: types.fixed.abilityKindTypeId,
    displayName: fields.displayName
  };
  if (fields.castConditionFormulaKey !== undefined) {
    ability.castConditionFormulaKey = fields.castConditionFormulaKey;
  }

  const phase: DirectDamageAbilitySetupPutBody['phase'] = {
    phaseId: ids.phaseId,
    abilityId: ids.abilityId,
    phaseOrder: 0,
    phaseTypeId: types.fixed.phaseTypeId,
    interruptible: fields.interruptible
  };
  if (fields.durationFormulaKey !== undefined) {
    phase.durationFormulaKey = fields.durationFormulaKey;
  }

  const effectStep: DirectDamageAbilitySetupPutBody['effectStep'] = {
    stepId: ids.stepId,
    sequenceId: ids.sequenceId,
    stepOrder: 0,
    operationTypeId: types.fixed.operationTypeId,
    targetSelectorTypeId: types.fixed.targetSelectorTypeId,
    damageDetail: {
      amountFormulaKey: fields.amountFormulaKey,
      damageTypeId,
      valuePolicyTypeId: types.fixed.valuePolicyTypeId,
      copyableOnHit: fields.copyableOnHit,
      critEligible: fields.critEligible
    }
  };
  if (fields.conditionFormulaKey !== undefined) {
    effectStep.conditionFormulaKey = fields.conditionFormulaKey;
  }

  return {
    expectedCurrentRevision,
    ability,
    phase,
    effectSequence: {
      sequenceId: ids.sequenceId,
      providerId: fields.providerId,
      sequenceKey: `${fields.abilityKey}_impact`,
      displayName: fields.displayName
    },
    effectStep,
    phaseEffectSequenceBinding: {
      phaseId: ids.phaseId,
      triggerTypeId: types.fixed.triggerTypeId,
      sequenceId: ids.sequenceId
    }
  };
}

export function formatStableLabel(stableId: string, displayName?: string | null): string {
  const name = displayName?.trim();
  return name ? `${stableId} / ${name}` : stableId;
}

export function collisionStatusLabel(status: CollisionNodeStatus): string {
  if (status === 'update') {
    return '更新已有';
  }
  if (status === 'conflict') {
    return '父级冲突';
  }
  return '新建';
}
