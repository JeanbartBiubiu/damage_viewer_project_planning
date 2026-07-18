import type {
  EffectSequence,
  EffectStep,
  ProviderFormula,
  TypeDefinition
} from '../../../types/combatData';
import type { EffectStepDetailKey } from '../../../services/adminPayload';
import {
  buildEffectStepPutFromEditor,
  createEmptyEffectStepEditorState,
  recordToSemanticEffectStepEditorState,
  type EffectStepEditorState,
  type EffectStepPutBodyFromEditor,
  type EffectStepSemanticTypeOption,
  type EffectStepSemanticTypeOptions
} from '../combat-data/EffectStepEditor';

/** Existing Sequence ID must match this to derive a create-mode stepId. */
export const SEQUENCE_ID_PATTERN = /^sequence_([a-z0-9][a-z0-9_]*)$/;

/** User-entered stepKey (no step_ prefix); blank = primary step_<stem>. */
export const STEP_KEY_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

export const CREATE_UNAVAILABLE_NONSTANDARD_SEQUENCE_MESSAGE =
  '所选 Effect Sequence ID 不符合 sequence_<stem> 约定，无法推导新建 stepId。本页对该序列仅可更新已有 Effect Step；请在上方选择已有 Step，或改用符合约定的 Sequence。';

/** Detail family → recommended operation typeKey (overridable). */
export const RECOMMENDED_OPERATION_BY_DETAIL: Record<EffectStepDetailKey, string> = {
  damageDetail: 'operation/damage',
  healDetail: 'operation/heal',
  resourceDetail: 'operation/resource_change',
  attributeDetail: 'operation/attribute_change',
  shieldDetail: 'operation/shield',
  providerDetail: 'operation/apply_provider',
  eventDetail: 'operation/emit_event',
  abilityControlDetail: 'operation/cooldown_change',
  stateDetail: 'operation/state_change',
  repeatDetail: 'operation/repeat',
  executeDetail: 'operation/execute_threshold'
};

/** Provider action typeKey → recommended operation typeKey. */
export const OPERATION_BY_PROVIDER_ACTION: Record<string, string> = {
  'provider_action/apply': 'operation/apply_provider',
  'provider_action/refresh': 'operation/refresh_provider',
  'provider_action/expire': 'operation/expire_provider'
};

const TYPE_PREFIXES = {
  operation: 'operation/',
  targetSelector: 'selector/',
  damageType: 'damage/',
  valuePolicy: 'value_policy/',
  providerAction: 'provider_action/',
  eventType: 'event/',
  abilityControlAction: 'ability_control_action/',
  stateScope: 'state_scope/',
  repeatScope: 'repeat_scope/'
} as const;

export type EffectStepSetupFormDraft = {
  sequenceId: string;
  /** Empty = create mode; otherwise intentional update of that exact stepId. */
  selectedExistingStepId: string;
  /** Optional; blank → primary step_<stem>; nonblank → step_<stem>_<stepKey>. */
  stepKey: string;
  stepOrder: number;
  editor: EffectStepEditorState;
};

export type EffectStepTarget =
  | {
      mode: 'create';
      stepId: string;
      sequenceId: string;
    }
  | {
      mode: 'update';
      stepId: string;
      sequenceId: string;
      summary: {
        stepId: string;
        stepOrder: number;
        operationTypeId: number;
        targetSelectorTypeId: number;
      };
    }
  | {
      mode: 'unavailable';
      reason: string;
    };

export type EffectStepCollisionResult = { ok: true } | { ok: false; reason: string };

export type EffectStepSetupFormValidation =
  | { ok: true; target: Extract<EffectStepTarget, { mode: 'create' | 'update' }> }
  | { ok: false; reason: string; target: EffectStepTarget };

export function createDefaultFormDraft(): EffectStepSetupFormDraft {
  const editor = createEmptyEffectStepEditorState();
  editor.common.operationTypeId = RECOMMENDED_OPERATION_BY_DETAIL.damageDetail;
  editor.common.targetSelectorTypeId = 'selector/opponent';
  return {
    sequenceId: '',
    selectedExistingStepId: '',
    stepKey: '',
    stepOrder: 1,
    editor
  };
}

export function formatStableLabel(stableId: string, displayName?: string | null): string {
  const name = displayName?.trim();
  return name ? `${stableId} / ${name}` : stableId;
}

export function extractSequenceStem(sequenceIdRaw: string): string | null {
  const match = SEQUENCE_ID_PATTERN.exec(sequenceIdRaw.trim());
  return match ? match[1] : null;
}

export function isStandardSequenceId(sequenceIdRaw: string): boolean {
  return SEQUENCE_ID_PATTERN.test(sequenceIdRaw.trim());
}

/**
 * Blank stepKey → step_<stem>; nonblank valid key → step_<stem>_<stepKey>.
 * Returns null when sequence is nonstandard or stepKey is invalid (nonblank).
 */
export function buildStepIdFromSequenceAndKey(
  sequenceIdRaw: string,
  stepKeyRaw: string
): string | null {
  const stem = extractSequenceStem(sequenceIdRaw);
  if (!stem) {
    return null;
  }
  const stepKey = stepKeyRaw.trim();
  if (!stepKey) {
    return `step_${stem}`;
  }
  if (!STEP_KEY_PATTERN.test(stepKey)) {
    return null;
  }
  return `step_${stem}_${stepKey}`;
}

export function createUnavailableReason(sequenceIdRaw: string): string | null {
  const sequenceId = sequenceIdRaw.trim();
  if (!sequenceId) {
    return null;
  }
  if (isStandardSequenceId(sequenceId)) {
    return null;
  }
  return CREATE_UNAVAILABLE_NONSTANDARD_SEQUENCE_MESSAGE;
}

export function typeOptionLabel(type: TypeDefinition): string {
  const name = typeof type.name === 'string' ? type.name.trim() : '';
  return name ? `${name} / ${type.typeKey}` : type.typeKey;
}

function listOptionsByPrefix(
  types: TypeDefinition[],
  prefix: string
): EffectStepSemanticTypeOption[] {
  const options: EffectStepSemanticTypeOption[] = [];
  for (const type of types) {
    if (!type.typeKey.startsWith(prefix)) {
      continue;
    }
    if (!Number.isFinite(type.typeId) || !Number.isInteger(type.typeId)) {
      continue;
    }
    options.push({
      typeKey: type.typeKey,
      typeId: type.typeId,
      label: typeOptionLabel(type)
    });
  }
  options.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  return options;
}

/** Build semantic catalogs from GET types (typeKey → typeId only at PUT time). */
export function buildSemanticTypeOptions(types: TypeDefinition[]): EffectStepSemanticTypeOptions {
  return {
    operation: listOptionsByPrefix(types, TYPE_PREFIXES.operation),
    targetSelector: listOptionsByPrefix(types, TYPE_PREFIXES.targetSelector),
    damageType: listOptionsByPrefix(types, TYPE_PREFIXES.damageType),
    valuePolicy: listOptionsByPrefix(types, TYPE_PREFIXES.valuePolicy),
    providerAction: listOptionsByPrefix(types, TYPE_PREFIXES.providerAction),
    eventType: listOptionsByPrefix(types, TYPE_PREFIXES.eventType),
    abilityControlAction: listOptionsByPrefix(types, TYPE_PREFIXES.abilityControlAction),
    stateScope: listOptionsByPrefix(types, TYPE_PREFIXES.stateScope),
    repeatScope: listOptionsByPrefix(types, TYPE_PREFIXES.repeatScope)
  };
}

export function recommendedOperationTypeKey(detailFamily: EffectStepDetailKey): string {
  return RECOMMENDED_OPERATION_BY_DETAIL[detailFamily];
}

export function operationTypeKeyForProviderAction(actionTypeKeyRaw: string): string | null {
  const key = actionTypeKeyRaw.trim();
  return OPERATION_BY_PROVIDER_ACTION[key] ?? null;
}

/** Max stepOrder in a sequence, or 0 when none. */
export function maxStepOrderForSequence(steps: EffectStep[], sequenceId: string): number {
  const trimmed = sequenceId.trim();
  let max = 0;
  for (const step of steps) {
    if (step.sequenceId !== trimmed) {
      continue;
    }
    if (Number.isFinite(step.stepOrder) && step.stepOrder > max) {
      max = step.stepOrder;
    }
  }
  return max;
}

export function defaultStepOrderForSequence(steps: EffectStep[], sequenceId: string): number {
  return maxStepOrderForSequence(steps, sequenceId) + 1;
}

export function listStepsForSequence(steps: EffectStep[], sequenceId: string): EffectStep[] {
  const trimmed = sequenceId.trim();
  if (!trimmed) {
    return [];
  }
  return steps
    .filter((item) => item.sequenceId === trimmed)
    .slice()
    .sort((a, b) => {
      if (a.stepOrder !== b.stepOrder) {
        return a.stepOrder - b.stepOrder;
      }
      return a.stepId.localeCompare(b.stepId, 'zh-CN');
    });
}

/**
 * Resolve create / intentional update / create-unavailable from draft + loaded steps.
 * Never renames a selected legacy stepId.
 */
export function resolveEffectStepTarget(
  draft: EffectStepSetupFormDraft,
  steps: EffectStep[]
): EffectStepTarget {
  const sequenceId = draft.sequenceId.trim();
  const selectedId = draft.selectedExistingStepId.trim();

  if (selectedId) {
    const existing = steps.find((item) => item.stepId === selectedId);
    if (!existing) {
      return {
        mode: 'unavailable',
        reason: `所选 Effect Step「${selectedId}」不在当前列表中，请重新选择。`
      };
    }
    if (sequenceId && existing.sequenceId !== sequenceId) {
      return {
        mode: 'unavailable',
        reason: `Effect Step「${selectedId}」不属于所选 Sequence「${sequenceId}」。`
      };
    }
    return {
      mode: 'update',
      stepId: existing.stepId,
      sequenceId: existing.sequenceId,
      summary: {
        stepId: existing.stepId,
        stepOrder: existing.stepOrder,
        operationTypeId: existing.operationTypeId,
        targetSelectorTypeId: existing.targetSelectorTypeId
      }
    };
  }

  if (!sequenceId) {
    return { mode: 'unavailable', reason: '请先选择已有 Effect Sequence。' };
  }

  const createBlock = createUnavailableReason(sequenceId);
  if (createBlock) {
    return { mode: 'unavailable', reason: createBlock };
  }

  const stepKey = draft.stepKey.trim();
  if (stepKey && !STEP_KEY_PATTERN.test(stepKey)) {
    return {
      mode: 'unavailable',
      reason: 'stepKey 须匹配 ^[a-z0-9][a-z0-9_]*$（小写字母、数字、下划线），或留空以生成主步骤 ID。'
    };
  }

  const stepId = buildStepIdFromSequenceAndKey(sequenceId, stepKey);
  if (!stepId) {
    return {
      mode: 'unavailable',
      reason: CREATE_UNAVAILABLE_NONSTANDARD_SEQUENCE_MESSAGE
    };
  }

  return {
    mode: 'create',
    stepId,
    sequenceId
  };
}

/**
 * Collision rules:
 * - create blocks when derived target stepId already exists;
 * - every save blocks when another step in the same sequence owns the requested stepOrder;
 * - update with unchanged order does not self-block.
 */
export function evaluateEffectStepCollisions(
  target: Extract<EffectStepTarget, { mode: 'create' | 'update' }>,
  stepOrderRaw: number,
  steps: EffectStep[]
): EffectStepCollisionResult {
  if (target.mode === 'create') {
    const idHit = steps.find((item) => item.stepId === target.stepId);
    if (idHit) {
      return {
        ok: false,
        reason: `目标 stepId「${target.stepId}」已存在（sequenceId=${idHit.sequenceId}, stepOrder=${idHit.stepOrder}）。请在上方选择该已有 Step 进行更新，或更换 stepKey。`
      };
    }
  }

  if (!Number.isFinite(stepOrderRaw)) {
    return { ok: false, reason: '步骤顺序必须是有效数字。' };
  }

  const orderHit = steps.find(
    (item) =>
      item.stepId !== target.stepId &&
      item.sequenceId === target.sequenceId &&
      item.stepOrder === stepOrderRaw
  );
  if (orderHit) {
    return {
      ok: false,
      reason: `同一 Sequence「${target.sequenceId}」下已有 Effect Step「${orderHit.stepId}」占用 stepOrder=${stepOrderRaw}。请更换顺序，或选择该已有 Step 进行更新。`
    };
  }

  return { ok: true };
}

/** Empty detail for family + set recommended operation (provider initially apply_provider). */
export function withRecommendedOperationForFamily(
  editor: EffectStepEditorState,
  nextFamily: EffectStepDetailKey
): EffectStepEditorState {
  return {
    ...editor,
    detailFamily: nextFamily,
    detail: createEmptyDetailForFamily(nextFamily),
    common: {
      ...editor.common,
      operationTypeId: recommendedOperationTypeKey(nextFamily)
    }
  };
}

function createEmptyDetailForFamily(family: EffectStepDetailKey): EffectStepEditorState['detail'] {
  // Mirror EffectStepEditor emptyDetail field names without exporting private helper.
  const templates: Record<EffectStepDetailKey, Record<string, string>> = {
    damageDetail: { amountFormulaKey: '', damageTypeId: '', valuePolicyTypeId: '' },
    healDetail: { amountFormulaKey: '', valuePolicyTypeId: '' },
    resourceDetail: { resourceKey: '', amountFormulaKey: '', valuePolicyTypeId: '' },
    attributeDetail: { attrKey: '', amountFormulaKey: '', valuePolicyTypeId: '' },
    shieldDetail: {
      shieldRef: '',
      amountFormulaKey: '',
      durationFormulaKey: '',
      valuePolicyTypeId: ''
    },
    providerDetail: {
      actionTypeId: '',
      targetProviderId: '',
      stacksFormulaKey: '',
      durationFormulaKey: ''
    },
    eventDetail: { eventTypeId: '', eventRef: '', payload: '{}' },
    abilityControlDetail: {
      actionTypeId: '',
      targetAbilityId: '',
      amountFormulaKey: '',
      valuePolicyTypeId: ''
    },
    stateDetail: {
      stateScopeTypeId: '',
      stateKey: '',
      amountFormulaKey: '',
      valuePolicyTypeId: ''
    },
    repeatDetail: {
      repeatScopeTypeId: '',
      repeatCount: '',
      repeatTag: '',
      triggerStateKey: '',
      threshold: ''
    },
    executeDetail: { threshold: '' }
  };
  return { ...templates[family] };
}

/**
 * When provider action typeKey changes, select matching recommended operation.
 * Returns null when no mapping (leave user override as-is).
 */
export function withProviderActionOperation(
  editor: EffectStepEditorState,
  actionTypeKey: string
): EffectStepEditorState {
  const operation = operationTypeKeyForProviderAction(actionTypeKey);
  if (!operation) {
    return editor;
  }
  return {
    ...editor,
    common: {
      ...editor.common,
      operationTypeId: operation
    }
  };
}

export function draftFromExistingStep(
  step: EffectStep,
  options: EffectStepSemanticTypeOptions
): EffectStepSetupFormDraft {
  const record = step as unknown as Record<string, unknown>;
  return {
    sequenceId: step.sequenceId,
    selectedExistingStepId: step.stepId,
    stepKey: '',
    stepOrder: step.stepOrder,
    editor: recordToSemanticEffectStepEditorState(record, options)
  };
}

export function validateEffectStepSetup(
  draft: EffectStepSetupFormDraft,
  steps: EffectStep[],
  semanticTypeOptions: EffectStepSemanticTypeOptions
): EffectStepSetupFormValidation {
  const target = resolveEffectStepTarget(draft, steps);
  if (target.mode === 'unavailable') {
    return { ok: false, reason: target.reason, target };
  }

  if (!Number.isFinite(draft.stepOrder)) {
    return { ok: false, reason: '步骤顺序必须是有效数字。', target };
  }

  const collision = evaluateEffectStepCollisions(target, draft.stepOrder, steps);
  if (!collision.ok) {
    return { ok: false, reason: collision.reason, target };
  }

  // Probe body construction for semantic type / one-detail validation without inventing IDs.
  try {
    buildEffectStepPutBodyFromDraft(draft, target, semanticTypeOptions);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason, target };
  }

  return { ok: true, target };
}

export function buildEffectStepPutBodyFromDraft(
  draft: EffectStepSetupFormDraft,
  target: Extract<EffectStepTarget, { mode: 'create' | 'update' }>,
  semanticTypeOptions: EffectStepSemanticTypeOptions
): EffectStepPutBodyFromEditor {
  const editor: EffectStepEditorState = {
    ...draft.editor,
    common: {
      ...draft.editor.common,
      stepId: target.stepId,
      sequenceId: target.sequenceId,
      stepOrder: draft.stepOrder
    }
  };
  return buildEffectStepPutFromEditor(editor, semanticTypeOptions);
}

/** Sequences sorted by label (zh-CN). */
export function listSortedSequences(sequences: EffectSequence[]): EffectSequence[] {
  return sequences
    .slice()
    .sort((a, b) =>
      formatStableLabel(a.sequenceId, a.displayName).localeCompare(
        formatStableLabel(b.sequenceId, b.displayName),
        'zh-CN'
      )
    );
}

/**
 * Provider-scoped formula records for the selected Effect Sequence.
 * Blank/unknown sequence, blank/missing providerId, or no formula match → [].
 * Never returns the unfiltered formula list for an unresolved owner.
 */
export function listProviderFormulasForSelectedSequence(
  sequences: EffectSequence[],
  formulas: ProviderFormula[],
  sequenceIdRaw: string
): ProviderFormula[] {
  const sequenceId = sequenceIdRaw.trim();
  if (!sequenceId) {
    return [];
  }
  const sequence = sequences.find((item) => item.sequenceId.trim() === sequenceId);
  if (!sequence) {
    return [];
  }
  const providerId = String(sequence.providerId ?? '').trim();
  if (!providerId) {
    return [];
  }
  return formulas.filter((item) => String(item.providerId ?? '').trim() === providerId);
}
