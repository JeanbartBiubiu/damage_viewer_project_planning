import type { CombatEntity, EntityProviderMount, Provider } from '../../../types/combatData';

export type EntityProviderMountFormDraft = {
  entityId: string;
  providerId: string;
};

export type LabelledOption = {
  value: string;
  label: string;
};

export type MountRelationStatus =
  | { status: 'incomplete' }
  | { status: 'new'; entityId: string; providerId: string }
  | { status: 'existing'; entityId: string; providerId: string };

/** Exact PUT body for create/upsert mount: must be `{}`. */
export type EntityProviderMountPutBody = Record<string, never>;

export function createDefaultFormDraft(): EntityProviderMountFormDraft {
  return {
    entityId: '',
    providerId: ''
  };
}

/** Stable ID / display name; falls back to ID alone when name is blank. */
export function formatStableLabel(stableId: string, displayName?: string | null): string {
  const name = displayName?.trim();
  return name ? `${stableId} / ${name}` : stableId;
}

export function listEntityOptions(entities: CombatEntity[]): LabelledOption[] {
  return entities
    .map((item) => ({
      value: item.entityId,
      label: formatStableLabel(item.entityId, item.displayName)
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

export function listProviderOptions(providers: Provider[]): LabelledOption[] {
  return providers
    .map((item) => ({
      value: item.providerId,
      label: formatStableLabel(item.providerId, item.displayName)
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

export function isDraftComplete(draft: EntityProviderMountFormDraft): boolean {
  return Boolean(draft.entityId.trim() && draft.providerId.trim());
}

/**
 * Resolve whether the selected pair is incomplete, new, or already mounted.
 * Existing mounts disable Save (backend upsert advances revision on repeated PUT).
 */
export function resolveMountRelationStatus(
  draft: EntityProviderMountFormDraft,
  mounts: EntityProviderMount[]
): MountRelationStatus {
  const entityId = draft.entityId.trim();
  const providerId = draft.providerId.trim();
  if (!entityId || !providerId) {
    return { status: 'incomplete' };
  }

  const exists = mounts.some(
    (item) => item.entityId === entityId && item.providerId === providerId
  );
  if (exists) {
    return { status: 'existing', entityId, providerId };
  }
  return { status: 'new', entityId, providerId };
}

/** Exact empty body — never add fields. */
export function buildMountPutBody(): EntityProviderMountPutBody {
  return {};
}
