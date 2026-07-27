import type { Provider, TypeDefinition } from '../../../types/combatData';

/** User-entered stem; must not include the `provider_` prefix. */
export const PROVIDER_KEY_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

export const PROVIDER_KIND_TYPE_KEY_PREFIX = 'provider_kind/';

export const NO_PROVIDER_KIND_TYPES_MESSAGE =
  '未找到可用的 Provider 种类类型（typeKey 以 provider_kind/ 开头）。请先在 #/combat-data/types 补齐后再创建 Provider。';

export type ProviderSetupFormDraft = {
  providerKey: string;
  displayName: string;
  /** Stable UI selection value (= typeKey). */
  providerKindTypeKey: string;
};

export type ProviderKindOption = {
  typeKey: string;
  typeId: number;
  label: string;
};

export type ValidatedProviderSetupFields = {
  providerKey: string;
  providerId: string;
  displayName: string;
  providerKindTypeKey: string;
  providerKindTypeId: number;
};

export type ProviderSetupFormValidation =
  | { ok: true; trimmed: ValidatedProviderSetupFields }
  | { ok: false; reason: string };

export type ProviderPresence =
  | { mode: 'create' }
  | {
      mode: 'update';
      summary: {
        providerId: string;
        displayName: string;
        providerKindTypeId: number;
      };
    };

export type ProviderPutBody = {
  providerKindTypeId: number;
  displayName: string;
};

export function createDefaultFormDraft(): ProviderSetupFormDraft {
  return {
    providerKey: '',
    displayName: '',
    providerKindTypeKey: ''
  };
}

/** Build `provider_${key}` when key is valid; otherwise null. */
export function buildProviderIdFromKey(providerKeyRaw: string): string | null {
  const providerKey = providerKeyRaw.trim();
  if (!providerKey) {
    return null;
  }
  if (providerKey.startsWith('provider_')) {
    return null;
  }
  if (!PROVIDER_KEY_PATTERN.test(providerKey)) {
    return null;
  }
  return `provider_${providerKey}`;
}

export function providerKindOptionLabel(type: TypeDefinition): string {
  const name = typeof type.name === 'string' ? type.name.trim() : '';
  return name ? `${name} / ${type.typeKey}` : type.typeKey;
}

/**
 * Accept only `provider_kind/*` rows with a finite integer typeId.
 * Labels sorted lexicographically (zh-CN).
 */
export function listProviderKindOptions(types: TypeDefinition[]): ProviderKindOption[] {
  const options: ProviderKindOption[] = [];
  for (const type of types) {
    if (!type.typeKey.startsWith(PROVIDER_KIND_TYPE_KEY_PREFIX)) {
      continue;
    }
    if (!Number.isFinite(type.typeId) || !Number.isInteger(type.typeId)) {
      continue;
    }
    options.push({
      typeKey: type.typeKey,
      typeId: type.typeId,
      label: providerKindOptionLabel(type)
    });
  }
  options.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  return options;
}

export function providerKindBlockingMessage(options: ProviderKindOption[]): string | null {
  return options.length === 0 ? NO_PROVIDER_KIND_TYPES_MESSAGE : null;
}

/**
 * Look up an existing provider by the generated stable ID only.
 * Never reverse-fills or splits providerId into the draft key.
 */
export function resolveProviderPresence(
  providers: Provider[],
  providerId: string | null
): ProviderPresence {
  if (!providerId) {
    return { mode: 'create' };
  }
  const existing = providers.find((item) => item.providerId === providerId);
  if (!existing) {
    return { mode: 'create' };
  }
  return {
    mode: 'update',
    summary: {
      providerId: existing.providerId,
      displayName: existing.displayName,
      providerKindTypeId: existing.providerKindTypeId
    }
  };
}

export function validateFormDraft(
  draft: ProviderSetupFormDraft,
  kindOptions: ProviderKindOption[]
): ProviderSetupFormValidation {
  const providerKey = draft.providerKey.trim();
  if (!providerKey) {
    return { ok: false, reason: 'Provider Key 不能为空。' };
  }
  if (providerKey.startsWith('provider_')) {
    return {
      ok: false,
      reason: 'Provider Key 不要包含 provider_ 前缀；系统会自动生成 provider_<key>。'
    };
  }
  if (!PROVIDER_KEY_PATTERN.test(providerKey)) {
    return {
      ok: false,
      reason: 'Provider Key 须匹配 ^[a-z0-9][a-z0-9_]*$（小写字母、数字、下划线）。'
    };
  }

  const displayName = draft.displayName.trim();
  if (!displayName) {
    return { ok: false, reason: '显示名不能为空。' };
  }

  if (kindOptions.length === 0) {
    return { ok: false, reason: NO_PROVIDER_KIND_TYPES_MESSAGE };
  }

  const providerKindTypeKey = draft.providerKindTypeKey.trim();
  if (!providerKindTypeKey) {
    return { ok: false, reason: '请选择 Provider 种类。' };
  }

  const kind = kindOptions.find((item) => item.typeKey === providerKindTypeKey);
  if (!kind) {
    return { ok: false, reason: `所选种类「${providerKindTypeKey}」不在可用列表中。` };
  }

  return {
    ok: true,
    trimmed: {
      providerKey,
      providerId: `provider_${providerKey}`,
      displayName,
      providerKindTypeKey: kind.typeKey,
      providerKindTypeId: kind.typeId
    }
  };
}

/** Exact PUT body: only providerKindTypeId + trimmed displayName. */
export function buildProviderPutBody(trimmed: ValidatedProviderSetupFields): ProviderPutBody {
  return {
    providerKindTypeId: trimmed.providerKindTypeId,
    displayName: trimmed.displayName
  };
}
