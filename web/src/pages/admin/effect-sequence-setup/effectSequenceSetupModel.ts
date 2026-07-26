import type { EffectSequence } from '../../../types/combatData';

/** Existing Provider ID must match this to derive a create-mode sequenceId. */
export const PROVIDER_ID_PATTERN = /^provider_([a-z0-9][a-z0-9_]*)$/;

/** User-entered sequenceKey (no sequence_ prefix). */
export const SEQUENCE_KEY_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

export const CREATE_UNAVAILABLE_NON_PROVIDER_FORM_MESSAGE =
  '所选 Provider ID 不符合 provider_<stem> 约定，无法推导新建 sequenceId。本页仅可更新该 Provider 下已有 Effect Sequence；请在上方选择已有 Sequence，或改用符合约定的 Provider。';

export type EffectSequenceSetupFormDraft = {
  providerId: string;
  /** Empty = create mode; otherwise intentional update of that legacy/current sequenceId. */
  selectedExistingSequenceId: string;
  sequenceKey: string;
  displayName: string;
};

export type ValidatedEffectSequenceSetupFields = {
  providerId: string;
  sequenceKey: string;
  /** Always trimmed, including empty string (backend optionalText clears blank → null). */
  displayName: string;
};

export type EffectSequenceSetupFormValidation =
  | { ok: true; trimmed: ValidatedEffectSequenceSetupFields }
  | { ok: false; reason: string };

export type EffectSequenceTarget =
  | {
      mode: 'create';
      sequenceId: string;
      providerId: string;
    }
  | {
      mode: 'update';
      sequenceId: string;
      providerId: string;
      summary: {
        sequenceId: string;
        sequenceKey: string;
        displayName: string;
      };
    }
  | {
      mode: 'unavailable';
      reason: string;
    };

export type EffectSequenceCollisionResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Exact PUT body: required providerId + sequenceKey + always-present trimmed displayName. */
export type EffectSequencePutBody = {
  providerId: string;
  sequenceKey: string;
  displayName: string;
};

export function createDefaultFormDraft(): EffectSequenceSetupFormDraft {
  return {
    providerId: '',
    selectedExistingSequenceId: '',
    sequenceKey: '',
    displayName: ''
  };
}

export function formatStableLabel(stableId: string, displayName?: string | null): string {
  const name = displayName?.trim();
  return name ? `${stableId} / ${name}` : stableId;
}

/**
 * Build `sequence_<providerStem>_<sequenceKey>` when both sides are valid; otherwise null.
 * Seed naming only — never reconstruct legacy IDs from stored keys.
 */
export function buildSequenceIdFromProviderAndKey(
  providerIdRaw: string,
  sequenceKeyRaw: string
): string | null {
  const providerId = providerIdRaw.trim();
  const match = PROVIDER_ID_PATTERN.exec(providerId);
  if (!match) {
    return null;
  }
  const sequenceKey = sequenceKeyRaw.trim();
  if (!sequenceKey || !SEQUENCE_KEY_PATTERN.test(sequenceKey)) {
    return null;
  }
  return `sequence_${match[1]}_${sequenceKey}`;
}

export function extractProviderStem(providerIdRaw: string): string | null {
  const match = PROVIDER_ID_PATTERN.exec(providerIdRaw.trim());
  return match ? match[1] : null;
}

export function createUnavailableReason(providerIdRaw: string): string | null {
  const providerId = providerIdRaw.trim();
  if (!providerId) {
    return null;
  }
  if (PROVIDER_ID_PATTERN.test(providerId)) {
    return null;
  }
  return CREATE_UNAVAILABLE_NON_PROVIDER_FORM_MESSAGE;
}

function normalizeStoredDisplayName(displayName: string | null | undefined): string {
  if (typeof displayName !== 'string') {
    return '';
  }
  return displayName;
}

/**
 * Resolve create / intentional update / create-unavailable from draft + loaded sequences.
 * Never renames a selected legacy sequenceId.
 */
export function resolveEffectSequenceTarget(
  draft: EffectSequenceSetupFormDraft,
  sequences: EffectSequence[]
): EffectSequenceTarget {
  const providerId = draft.providerId.trim();
  const selectedId = draft.selectedExistingSequenceId.trim();

  if (selectedId) {
    const existing = sequences.find((item) => item.sequenceId === selectedId);
    if (!existing) {
      return {
        mode: 'unavailable',
        reason: `所选 Effect Sequence「${selectedId}」不在当前列表中，请重新选择。`
      };
    }
    if (providerId && existing.providerId !== providerId) {
      return {
        mode: 'unavailable',
        reason: `Effect Sequence「${selectedId}」不属于所选 Provider「${providerId}」。`
      };
    }
    return {
      mode: 'update',
      sequenceId: existing.sequenceId,
      providerId: existing.providerId,
      summary: {
        sequenceId: existing.sequenceId,
        sequenceKey: existing.sequenceKey,
        displayName: normalizeStoredDisplayName(existing.displayName)
      }
    };
  }

  if (!providerId) {
    return { mode: 'unavailable', reason: '请先选择已有 Provider。' };
  }

  const createBlock = createUnavailableReason(providerId);
  if (createBlock) {
    return { mode: 'unavailable', reason: createBlock };
  }

  const sequenceKey = draft.sequenceKey.trim();
  if (!sequenceKey) {
    return { mode: 'unavailable', reason: 'sequenceKey 不能为空。' };
  }
  if (!SEQUENCE_KEY_PATTERN.test(sequenceKey)) {
    return {
      mode: 'unavailable',
      reason: 'sequenceKey 须匹配 ^[a-z0-9][a-z0-9_]*$（小写字母、数字、下划线）。'
    };
  }

  const sequenceId = buildSequenceIdFromProviderAndKey(providerId, sequenceKey);
  if (!sequenceId) {
    return {
      mode: 'unavailable',
      reason: CREATE_UNAVAILABLE_NON_PROVIDER_FORM_MESSAGE
    };
  }

  return {
    mode: 'create',
    sequenceId,
    providerId
  };
}

/**
 * Collision rules:
 * - create blocks when derived target sequenceId already exists;
 * - every save blocks when another Sequence (≠ target) shares providerId + trimmed sequenceKey;
 * - update with unchanged key does not self-block.
 */
export function evaluateEffectSequenceCollisions(
  target: Extract<EffectSequenceTarget, { mode: 'create' | 'update' }>,
  sequenceKeyRaw: string,
  sequences: EffectSequence[]
): EffectSequenceCollisionResult {
  const sequenceKey = sequenceKeyRaw.trim();
  if (!sequenceKey) {
    return { ok: true };
  }

  if (target.mode === 'create') {
    const idHit = sequences.find((item) => item.sequenceId === target.sequenceId);
    if (idHit) {
      return {
        ok: false,
        reason: `目标 sequenceId「${target.sequenceId}」已存在（sequenceKey=${idHit.sequenceKey}）。请在上方选择该已有 Sequence 进行更新，或更换 sequenceKey。`
      };
    }
  }

  const keyHit = sequences.find(
    (item) =>
      item.sequenceId !== target.sequenceId &&
      item.providerId === target.providerId &&
      item.sequenceKey === sequenceKey
  );
  if (keyHit) {
    return {
      ok: false,
      reason: `同一 Provider「${target.providerId}」下已有 Effect Sequence「${keyHit.sequenceId}」使用 sequenceKey「${sequenceKey}」。请选择该已有 Sequence，或更换 sequenceKey。`
    };
  }

  return { ok: true };
}

export function validateFormDraft(
  draft: EffectSequenceSetupFormDraft,
  target: EffectSequenceTarget
): EffectSequenceSetupFormValidation {
  if (target.mode === 'unavailable') {
    return { ok: false, reason: target.reason };
  }

  const providerId = draft.providerId.trim() || target.providerId;
  if (!providerId) {
    return { ok: false, reason: '请先选择已有 Provider。' };
  }

  const sequenceKey = draft.sequenceKey.trim();
  if (!sequenceKey) {
    return { ok: false, reason: 'sequenceKey 不能为空。' };
  }
  if (!SEQUENCE_KEY_PATTERN.test(sequenceKey)) {
    return {
      ok: false,
      reason: 'sequenceKey 须匹配 ^[a-z0-9][a-z0-9_]*$（小写字母、数字、下划线）。'
    };
  }

  return {
    ok: true,
    trimmed: {
      providerId,
      sequenceKey,
      displayName: draft.displayName.trim()
    }
  };
}

/**
 * Full validation including collisions against the loaded Effect Sequence list.
 */
export function validateEffectSequenceSetup(
  draft: EffectSequenceSetupFormDraft,
  sequences: EffectSequence[]
): EffectSequenceSetupFormValidation & { target: EffectSequenceTarget } {
  const target = resolveEffectSequenceTarget(draft, sequences);
  const fieldValidation = validateFormDraft(draft, target);
  if (!fieldValidation.ok) {
    return { ...fieldValidation, target };
  }
  if (target.mode === 'unavailable') {
    return { ok: false, reason: target.reason, target };
  }
  const collision = evaluateEffectSequenceCollisions(
    target,
    fieldValidation.trimmed.sequenceKey,
    sequences
  );
  if (!collision.ok) {
    return { ok: false, reason: collision.reason, target };
  }
  return { ok: true, trimmed: fieldValidation.trimmed, target };
}

/** Exact PUT body; always include trimmed displayName (blank clears backend optional). */
export function buildEffectSequencePutBody(
  trimmed: ValidatedEffectSequenceSetupFields
): EffectSequencePutBody {
  return {
    providerId: trimmed.providerId,
    sequenceKey: trimmed.sequenceKey,
    displayName: trimmed.displayName
  };
}

/** Sequences belonging to one Provider, sorted by label (zh-CN). */
export function listSequencesForProvider(
  sequences: EffectSequence[],
  providerId: string
): EffectSequence[] {
  const trimmed = providerId.trim();
  if (!trimmed) {
    return [];
  }
  return sequences
    .filter((item) => item.providerId === trimmed)
    .slice()
    .sort((a, b) =>
      formatStableLabel(a.sequenceId, a.displayName).localeCompare(
        formatStableLabel(b.sequenceId, b.displayName),
        'zh-CN'
      )
    );
}

/**
 * Fill draft fields from an existing Effect Sequence row.
 * Keeps exact sequenceId as selectedExistingSequenceId — never derived.
 */
export function draftFromExistingSequence(
  sequence: EffectSequence
): EffectSequenceSetupFormDraft {
  return {
    providerId: sequence.providerId,
    selectedExistingSequenceId: sequence.sequenceId,
    sequenceKey: sequence.sequenceKey,
    displayName: normalizeStoredDisplayName(sequence.displayName)
  };
}
