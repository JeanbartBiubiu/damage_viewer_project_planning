/**
 * Pure three-state edit model for combat-data `imageUri` associations.
 *
 * Semantics mirror Backend CombatDataImageReference:
 * - omitted key → preserve existing (new row defaults to null)
 * - JSON null / blank string → clear association (does not delete the image asset)
 * - nonblank string → exact same-game images.uri (no trim/normalize of the stored value)
 *
 * Do not call normalizeImageAssetUri here — that helper is only for upload asset route URIs.
 */

export type ImageReferenceEditStatus = 'untouched' | 'clear' | 'set';

export type ImageReferenceEditState = {
  status: ImageReferenceEditStatus;
  /** Loaded server value; null when absent/blank. */
  original: string | null;
  /**
   * Exact nonblank source text when status === 'set'.
   * May contain leading/trailing whitespace; never trimmed for serialization.
   */
  value?: string;
};

/** Normalize a loaded row value to null (absent/blank) or the exact nonblank string. */
export function normalizeLoadedImageUri(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value.trim() === '' ? null : value;
}

/** Start untouched/preserve from a loaded original (undefined/null → null). */
export function createUntouchedImageReference(
  original: string | null | undefined
): ImageReferenceEditState {
  return {
    status: 'untouched',
    original: normalizeLoadedImageUri(original)
  };
}

/**
 * Transition to exact set, or clear when the raw input is blank-only.
 * Nonblank values are kept byte-for-byte (trim used only to classify blank vs nonblank).
 */
export function setExactImageReference(
  state: ImageReferenceEditState,
  rawInput: string
): ImageReferenceEditState {
  if (rawInput.trim() === '') {
    return {
      status: 'clear',
      original: state.original
    };
  }
  return {
    status: 'set',
    original: state.original,
    value: rawInput
  };
}

/** Explicit clear (serialize as JSON null). */
export function clearImageReference(state: ImageReferenceEditState): ImageReferenceEditState {
  return {
    status: 'clear',
    original: state.original
  };
}

/** Revert to untouched/preserve of the loaded original. */
export function revertImageReference(state: ImageReferenceEditState): ImageReferenceEditState {
  return {
    status: 'untouched',
    original: state.original
  };
}

/**
 * Intentionally reuse a binding in a create/copy draft (touched set or untouched empty).
 * Nonblank originals become an exact set; null/blank stay untouched.
 */
export function createCopiedImageReference(
  original: string | null | undefined
): ImageReferenceEditState {
  const normalized = normalizeLoadedImageUri(original);
  if (normalized === null) {
    return createUntouchedImageReference(null);
  }
  return {
    status: 'set',
    original: null,
    value: normalized
  };
}

export function isImageReferenceTouched(state: ImageReferenceEditState): boolean {
  return state.status !== 'untouched';
}

/** URI currently shown for preview (set value, else original when untouched, else null when clear). */
export function displayImageUri(state: ImageReferenceEditState): string | null {
  if (state.status === 'set') {
    const value = state.value ?? '';
    return value.trim() === '' ? null : value;
  }
  if (state.status === 'clear') {
    return null;
  }
  return state.original;
}

/**
 * Serialize a PATCH fragment for Admin PUT / batch.
 * Untouched omits the key entirely; clear sends null; set sends the exact nonblank string.
 * Blank-only set values serialize as null (clear).
 */
export function serializeImageUriPatch(
  state: ImageReferenceEditState
): { imageUri: string | null } | Record<string, never> {
  if (state.status === 'untouched') {
    return {};
  }
  if (state.status === 'clear') {
    return { imageUri: null };
  }
  const value = state.value ?? '';
  if (value.trim() === '') {
    return { imageUri: null };
  }
  return { imageUri: value };
}

export function isImageReferenceEditState(value: unknown): value is ImageReferenceEditState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (status !== 'untouched' && status !== 'clear' && status !== 'set') {
    return false;
  }
  if (record.original !== null && typeof record.original !== 'string') {
    return false;
  }
  if (status === 'set' && record.value !== undefined && typeof record.value !== 'string') {
    return false;
  }
  return true;
}
