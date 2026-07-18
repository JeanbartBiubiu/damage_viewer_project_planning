import type { CombatEntity } from '../../../types/combatData';
import {
  createUntouchedImageReference,
  serializeImageUriPatch,
  type ImageReferenceEditState
} from '../../../services/combatDataImageReference';

export type EntitySetupFormDraft = {
  entityId: string;
  displayName: string;
  description: string;
  imageReference: ImageReferenceEditState;
};

export type ValidatedEntitySetupFields = {
  entityId: string;
  displayName: string;
  /** Trimmed; blank input becomes `''` so PUT can clear description. */
  description: string;
  imageReference: ImageReferenceEditState;
};

export type EntitySetupFormValidation =
  | { ok: true; trimmed: ValidatedEntitySetupFields }
  | { ok: false; reason: string };

export type EntityPresence =
  | { mode: 'create' }
  | {
      mode: 'update';
      summary: {
        entityId: string;
        displayName: string;
        /** Existing stored value; empty string when absent/blank. */
        description: string;
        imageUri: string | null;
      };
    };

/**
 * Exact PUT body: displayName + description, plus optional imageUri patch when touched.
 * Untouched omits imageUri entirely.
 */
export type EntityPutBody = {
  displayName: string;
  description: string;
  imageUri?: string | null;
};

export function createDefaultFormDraft(): EntitySetupFormDraft {
  return {
    entityId: '',
    displayName: '',
    description: '',
    imageReference: createUntouchedImageReference(null)
  };
}

/** Normalize optional/blank description from a loaded entity row to `''`. */
export function normalizeEntityDescription(description: string | null | undefined): string {
  if (typeof description !== 'string') {
    return '';
  }
  return description.trim();
}

/**
 * Detect create vs intentional update from the loaded entities list.
 * Update summary includes existing displayName, description, and imageUri.
 * Merely typing an ID without an explicit load must not overwrite draft fields.
 */
export function resolveEntityPresence(
  entities: CombatEntity[],
  entityId: string | null
): EntityPresence {
  if (!entityId) {
    return { mode: 'create' };
  }
  const existing = entities.find((item) => item.entityId === entityId);
  if (!existing) {
    return { mode: 'create' };
  }
  return {
    mode: 'update',
    summary: {
      entityId: existing.entityId,
      displayName: existing.displayName,
      description: normalizeEntityDescription(existing.description),
      imageUri:
        typeof existing.imageUri === 'string' && existing.imageUri.trim() !== ''
          ? existing.imageUri
          : null
    }
  };
}

/**
 * Populate draft from an explicitly loaded entity row.
 * Image state starts untouched/preserve (not touched).
 */
export function populateDraftFromEntity(entity: CombatEntity): EntitySetupFormDraft {
  return {
    entityId: entity.entityId,
    displayName: entity.displayName,
    description: normalizeEntityDescription(entity.description),
    imageReference: createUntouchedImageReference(entity.imageUri)
  };
}

export function validateFormDraft(draft: EntitySetupFormDraft): EntitySetupFormValidation {
  const entityId = draft.entityId.trim();
  if (!entityId) {
    return { ok: false, reason: '实体 ID 不能为空。' };
  }

  const displayName = draft.displayName.trim();
  if (!displayName) {
    return { ok: false, reason: '显示名不能为空。' };
  }

  const description = draft.description.trim();

  return {
    ok: true,
    trimmed: {
      entityId,
      displayName,
      description,
      imageReference: draft.imageReference
    }
  };
}

/**
 * Exact PUT body: trimmed displayName + description, plus imageUri only when touched.
 */
export function buildEntityPutBody(trimmed: ValidatedEntitySetupFields): EntityPutBody {
  return {
    displayName: trimmed.displayName,
    description: trimmed.description,
    ...serializeImageUriPatch(trimmed.imageReference)
  };
}

/**
 * True when an update would send a blank description while the existing row has one.
 * Backend maps blank description to null (clears).
 */
export function willClearExistingDescription(
  presence: EntityPresence,
  trimmedDescription: string
): boolean {
  return (
    presence.mode === 'update' &&
    Boolean(presence.summary.description) &&
    trimmedDescription === ''
  );
}

/** True when the draft will send imageUri: null against a previously associated URI. */
export function willClearExistingImageUri(
  presence: EntityPresence,
  imageReference: ImageReferenceEditState
): boolean {
  if (presence.mode !== 'update' || !presence.summary.imageUri) {
    return false;
  }
  const patch = serializeImageUriPatch(imageReference);
  return Object.prototype.hasOwnProperty.call(patch, 'imageUri') && patch.imageUri === null;
}
