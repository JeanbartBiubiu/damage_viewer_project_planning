import type { Ability, TypeDefinition } from '../../../types/combatData';

/** Existing Provider ID must match this to derive a create-mode abilityId. */
export const PROVIDER_ID_PATTERN = /^provider_([a-z0-9][a-z0-9_]*)$/;

/** User-entered abilityKey (no ability_ prefix). */
export const ABILITY_KEY_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

export const ABILITY_KIND_TYPE_KEY_PREFIX = 'ability_kind/';

export const NO_ABILITY_KIND_TYPES_MESSAGE =
  '未找到可用的 Ability 种类类型（typeKey 以 ability_kind/ 开头）。请先在 #/combat-data/types 补齐后再创建 Ability。';

export const CREATE_UNAVAILABLE_NON_PROVIDER_FORM_MESSAGE =
  '所选 Provider ID 不符合 provider_<stem> 约定，无法推导新建 abilityId。本页仅可更新该 Provider 下已有 Ability；请在上方选择已有 Ability，或改用符合约定的 Provider。';

export type AbilitySetupFormDraft = {
  providerId: string;
  /** Empty = create mode; otherwise intentional update of that legacy/current abilityId. */
  selectedExistingAbilityId: string;
  abilityKey: string;
  displayName: string;
  /** Stable UI selection value (= typeKey). */
  abilityKindTypeKey: string;
  castConditionFormulaKey: string;
};

export type AbilityKindOption = {
  typeKey: string;
  typeId: number;
  label: string;
};

export type ValidatedAbilitySetupFields = {
  providerId: string;
  abilityKey: string;
  displayName: string;
  abilityKindTypeKey: string;
  abilityKindTypeId: number;
  /** Present only when trimmed optional value is nonblank. */
  castConditionFormulaKey?: string;
};

export type AbilitySetupFormValidation =
  | { ok: true; trimmed: ValidatedAbilitySetupFields }
  | { ok: false; reason: string };

export type AbilityTarget =
  | {
      mode: 'create';
      abilityId: string;
      providerId: string;
    }
  | {
      mode: 'update';
      abilityId: string;
      providerId: string;
      summary: {
        abilityId: string;
        abilityKey: string;
        displayName: string;
        abilityKindTypeId: number;
        castConditionFormulaKey: string;
      };
    }
  | {
      mode: 'unavailable';
      reason: string;
    };

export type AbilityCollisionResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Exact PUT body: required fields + optional castConditionFormulaKey only when nonblank. */
export type AbilityPutBody = {
  providerId: string;
  abilityKey: string;
  abilityKindTypeId: number;
  displayName: string;
  castConditionFormulaKey?: string;
};

export function createDefaultFormDraft(): AbilitySetupFormDraft {
  return {
    providerId: '',
    selectedExistingAbilityId: '',
    abilityKey: '',
    displayName: '',
    abilityKindTypeKey: '',
    castConditionFormulaKey: ''
  };
}

export function optionalTrimmed(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

export function formatStableLabel(stableId: string, displayName?: string | null): string {
  const name = displayName?.trim();
  return name ? `${stableId} / ${name}` : stableId;
}

export function abilityKindOptionLabel(type: TypeDefinition): string {
  const name = typeof type.name === 'string' ? type.name.trim() : '';
  return name ? `${name} / ${type.typeKey}` : type.typeKey;
}

/**
 * Accept only `ability_kind/*` rows with a finite integer typeId.
 * Labels sorted lexicographically (zh-CN).
 */
export function listAbilityKindOptions(types: TypeDefinition[]): AbilityKindOption[] {
  const options: AbilityKindOption[] = [];
  for (const type of types) {
    if (!type.typeKey.startsWith(ABILITY_KIND_TYPE_KEY_PREFIX)) {
      continue;
    }
    if (!Number.isFinite(type.typeId) || !Number.isInteger(type.typeId)) {
      continue;
    }
    options.push({
      typeKey: type.typeKey,
      typeId: type.typeId,
      label: abilityKindOptionLabel(type)
    });
  }
  options.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  return options;
}

export function abilityKindBlockingMessage(options: AbilityKindOption[]): string | null {
  return options.length === 0 ? NO_ABILITY_KIND_TYPES_MESSAGE : null;
}

/** Resolve a stored abilityKindTypeId back to a selectable typeKey, or null when missing. */
export function resolveAbilityKindTypeKey(
  kindOptions: AbilityKindOption[],
  abilityKindTypeId: number
): string | null {
  const found = kindOptions.find((item) => item.typeId === abilityKindTypeId);
  return found ? found.typeKey : null;
}

/**
 * Build `ability_<providerStem>_<abilityKey>` when both sides are valid; otherwise null.
 */
export function buildAbilityIdFromProviderAndKey(
  providerIdRaw: string,
  abilityKeyRaw: string
): string | null {
  const providerId = providerIdRaw.trim();
  const match = PROVIDER_ID_PATTERN.exec(providerId);
  if (!match) {
    return null;
  }
  const abilityKey = abilityKeyRaw.trim();
  if (!abilityKey || !ABILITY_KEY_PATTERN.test(abilityKey)) {
    return null;
  }
  return `ability_${match[1]}_${abilityKey}`;
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

/**
 * Resolve create / intentional update / create-unavailable from draft + loaded abilities.
 * Never renames a selected legacy abilityId.
 */
export function resolveAbilityTarget(
  draft: AbilitySetupFormDraft,
  abilities: Ability[]
): AbilityTarget {
  const providerId = draft.providerId.trim();
  const selectedId = draft.selectedExistingAbilityId.trim();

  if (selectedId) {
    const existing = abilities.find((item) => item.abilityId === selectedId);
    if (!existing) {
      return {
        mode: 'unavailable',
        reason: `所选 Ability「${selectedId}」不在当前列表中，请重新选择。`
      };
    }
    if (providerId && existing.providerId !== providerId) {
      return {
        mode: 'unavailable',
        reason: `Ability「${selectedId}」不属于所选 Provider「${providerId}」。`
      };
    }
    return {
      mode: 'update',
      abilityId: existing.abilityId,
      providerId: existing.providerId,
      summary: {
        abilityId: existing.abilityId,
        abilityKey: existing.abilityKey,
        displayName: existing.displayName,
        abilityKindTypeId: existing.abilityKindTypeId,
        castConditionFormulaKey:
          typeof existing.castConditionFormulaKey === 'string'
            ? existing.castConditionFormulaKey
            : ''
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

  const abilityKey = draft.abilityKey.trim();
  if (!abilityKey) {
    return { mode: 'unavailable', reason: 'abilityKey 不能为空。' };
  }
  if (!ABILITY_KEY_PATTERN.test(abilityKey)) {
    return {
      mode: 'unavailable',
      reason: 'abilityKey 须匹配 ^[a-z0-9][a-z0-9_]*$（小写字母、数字、下划线）。'
    };
  }

  const abilityId = buildAbilityIdFromProviderAndKey(providerId, abilityKey);
  if (!abilityId) {
    return {
      mode: 'unavailable',
      reason: CREATE_UNAVAILABLE_NON_PROVIDER_FORM_MESSAGE
    };
  }

  return {
    mode: 'create',
    abilityId,
    providerId
  };
}

/**
 * Collision rules:
 * - create blocks when derived target abilityId already exists;
 * - every save blocks when another Ability (≠ target) shares providerId + trimmed abilityKey;
 * - update with unchanged key does not self-block.
 */
export function evaluateAbilityCollisions(
  target: Extract<AbilityTarget, { mode: 'create' | 'update' }>,
  abilityKeyRaw: string,
  abilities: Ability[]
): AbilityCollisionResult {
  const abilityKey = abilityKeyRaw.trim();
  if (!abilityKey) {
    return { ok: true };
  }

  if (target.mode === 'create') {
    const idHit = abilities.find((item) => item.abilityId === target.abilityId);
    if (idHit) {
      return {
        ok: false,
        reason: `目标 abilityId「${target.abilityId}」已存在（abilityKey=${idHit.abilityKey}）。请在上方选择该已有 Ability 进行更新，或更换 abilityKey。`
      };
    }
  }

  const keyHit = abilities.find(
    (item) =>
      item.abilityId !== target.abilityId &&
      item.providerId === target.providerId &&
      item.abilityKey === abilityKey
  );
  if (keyHit) {
    return {
      ok: false,
      reason: `同一 Provider「${target.providerId}」下已有 Ability「${keyHit.abilityId}」使用 abilityKey「${abilityKey}」。请选择该已有 Ability，或更换 abilityKey。`
    };
  }

  return { ok: true };
}

export function validateFormDraft(
  draft: AbilitySetupFormDraft,
  kindOptions: AbilityKindOption[],
  target: AbilityTarget
): AbilitySetupFormValidation {
  if (target.mode === 'unavailable') {
    return { ok: false, reason: target.reason };
  }

  const providerId = draft.providerId.trim() || target.providerId;
  if (!providerId) {
    return { ok: false, reason: '请先选择已有 Provider。' };
  }

  const abilityKey = draft.abilityKey.trim();
  if (!abilityKey) {
    return { ok: false, reason: 'abilityKey 不能为空。' };
  }
  if (!ABILITY_KEY_PATTERN.test(abilityKey)) {
    return {
      ok: false,
      reason: 'abilityKey 须匹配 ^[a-z0-9][a-z0-9_]*$（小写字母、数字、下划线）。'
    };
  }

  const displayName = draft.displayName.trim();
  if (!displayName) {
    return { ok: false, reason: '显示名不能为空。' };
  }

  if (kindOptions.length === 0) {
    return { ok: false, reason: NO_ABILITY_KIND_TYPES_MESSAGE };
  }

  const abilityKindTypeKey = draft.abilityKindTypeKey.trim();
  if (!abilityKindTypeKey) {
    if (target.mode === 'update') {
      return {
        ok: false,
        reason: `已有 Ability「${target.abilityId}」的 abilityKindTypeId=${target.summary.abilityKindTypeId} 无法映射到可用的 ability_kind/* 选项；请先在 #/combat-data/types 补齐后再更新。`
      };
    }
    return { ok: false, reason: '请选择 Ability 种类。' };
  }

  const kind = kindOptions.find((item) => item.typeKey === abilityKindTypeKey);
  if (!kind) {
    return { ok: false, reason: `所选种类「${abilityKindTypeKey}」不在可用列表中。` };
  }

  return {
    ok: true,
    trimmed: {
      providerId,
      abilityKey,
      displayName,
      abilityKindTypeKey: kind.typeKey,
      abilityKindTypeId: kind.typeId,
      castConditionFormulaKey: optionalTrimmed(draft.castConditionFormulaKey)
    }
  };
}

/**
 * Full validation including collisions against the loaded Ability list.
 */
export function validateAbilitySetup(
  draft: AbilitySetupFormDraft,
  kindOptions: AbilityKindOption[],
  abilities: Ability[]
): AbilitySetupFormValidation & { target: AbilityTarget } {
  const target = resolveAbilityTarget(draft, abilities);
  const fieldValidation = validateFormDraft(draft, kindOptions, target);
  if (!fieldValidation.ok) {
    return { ...fieldValidation, target };
  }
  if (target.mode === 'unavailable') {
    return { ok: false, reason: target.reason, target };
  }
  const collision = evaluateAbilityCollisions(target, fieldValidation.trimmed.abilityKey, abilities);
  if (!collision.ok) {
    return { ok: false, reason: collision.reason, target };
  }
  return { ok: true, trimmed: fieldValidation.trimmed, target };
}

/** Exact PUT body; omit castConditionFormulaKey when blank (clears backend optional). */
export function buildAbilityPutBody(trimmed: ValidatedAbilitySetupFields): AbilityPutBody {
  const body: AbilityPutBody = {
    providerId: trimmed.providerId,
    abilityKey: trimmed.abilityKey,
    abilityKindTypeId: trimmed.abilityKindTypeId,
    displayName: trimmed.displayName
  };
  if (trimmed.castConditionFormulaKey !== undefined) {
    body.castConditionFormulaKey = trimmed.castConditionFormulaKey;
  }
  return body;
}

/** Abilities belonging to one Provider, sorted by label (zh-CN). */
export function listAbilitiesForProvider(
  abilities: Ability[],
  providerId: string
): Ability[] {
  const trimmed = providerId.trim();
  if (!trimmed) {
    return [];
  }
  return abilities
    .filter((item) => item.providerId === trimmed)
    .slice()
    .sort((a, b) =>
      formatStableLabel(a.abilityId, a.displayName).localeCompare(
        formatStableLabel(b.abilityId, b.displayName),
        'zh-CN'
      )
    );
}

/**
 * Fill draft fields from an existing Ability row.
 * Resolves typeKey from typeId; leaves abilityKindTypeKey blank when unresolvable.
 */
export function draftFromExistingAbility(
  ability: Ability,
  kindOptions: AbilityKindOption[]
): AbilitySetupFormDraft {
  return {
    providerId: ability.providerId,
    selectedExistingAbilityId: ability.abilityId,
    abilityKey: ability.abilityKey,
    displayName: ability.displayName,
    abilityKindTypeKey: resolveAbilityKindTypeKey(kindOptions, ability.abilityKindTypeId) ?? '',
    castConditionFormulaKey:
      typeof ability.castConditionFormulaKey === 'string' ? ability.castConditionFormulaKey : ''
  };
}
