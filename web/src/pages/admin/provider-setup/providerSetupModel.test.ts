import { describe, expect, it } from 'vitest';
import type { Provider, TypeDefinition } from '../../../types/combatData';
import {
  NO_PROVIDER_KIND_TYPES_MESSAGE,
  buildProviderIdFromKey,
  buildProviderPutBody,
  createDefaultFormDraft,
  listProviderKindOptions,
  providerKindBlockingMessage,
  resolveProviderPresence,
  validateFormDraft
} from './providerSetupModel';

function typeRow(
  typeKey: string,
  typeId: number,
  name?: string
): TypeDefinition {
  return {
    gameId: 'demo',
    typeId,
    typeKey,
    name,
    changeRevision: 1,
    updatedAt: 't'
  };
}

function providerRow(
  providerId: string,
  displayName: string,
  providerKindTypeId: number
): Provider {
  return {
    gameId: 'demo',
    providerId,
    displayName,
    providerKindTypeId,
    changeRevision: 1,
    updatedAt: 't'
  };
}

describe('providerSetupModel ID construction', () => {
  it('builds provider_<key> from a valid stem', () => {
    expect(buildProviderIdFromKey('ashe_q')).toBe('provider_ashe_q');
    expect(buildProviderIdFromKey('  q  ')).toBe('provider_q');
    expect(buildProviderIdFromKey('a')).toBe('provider_a');
    expect(buildProviderIdFromKey('9_skill')).toBe('provider_9_skill');
  });

  it('rejects empty, illegal, and provider_ prefix keys', () => {
    expect(buildProviderIdFromKey('')).toBeNull();
    expect(buildProviderIdFromKey('   ')).toBeNull();
    expect(buildProviderIdFromKey('Ashe')).toBeNull();
    expect(buildProviderIdFromKey('bad-key')).toBeNull();
    expect(buildProviderIdFromKey('_leading')).toBeNull();
    expect(buildProviderIdFromKey('provider_')).toBeNull();
    expect(buildProviderIdFromKey('provider_q')).toBeNull();
    expect(buildProviderIdFromKey('provider_ashe_q')).toBeNull();
  });
});

describe('providerSetupModel form validation', () => {
  const kinds = listProviderKindOptions([
    typeRow('provider_kind/passive', 2, '被动'),
    typeRow('provider_kind/active', 1, '主动')
  ]);

  it('rejects empty display name', () => {
    const result = validateFormDraft(
      { providerKey: 'q', displayName: '   ', providerKindTypeKey: 'provider_kind/active' },
      kinds
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('显示名');
    }
  });

  it('rejects empty / illegal / provider_ prefix keys', () => {
    expect(validateFormDraft(createDefaultFormDraft(), kinds).ok).toBe(false);

    const prefix = validateFormDraft(
      { providerKey: 'provider_q', displayName: 'Q', providerKindTypeKey: 'provider_kind/active' },
      kinds
    );
    expect(prefix.ok).toBe(false);
    if (!prefix.ok) {
      expect(prefix.reason).toContain('provider_');
    }

    const illegal = validateFormDraft(
      { providerKey: 'Bad', displayName: 'Q', providerKindTypeKey: 'provider_kind/active' },
      kinds
    );
    expect(illegal.ok).toBe(false);
  });

  it('accepts trimmed valid draft and yields generated providerId', () => {
    const result = validateFormDraft(
      {
        providerKey: '  ashe_q  ',
        displayName: '  寒冰箭  ',
        providerKindTypeKey: 'provider_kind/active'
      },
      kinds
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trimmed.providerKey).toBe('ashe_q');
      expect(result.trimmed.providerId).toBe('provider_ashe_q');
      expect(result.trimmed.displayName).toBe('寒冰箭');
      expect(result.trimmed.providerKindTypeId).toBe(1);
    }
  });
});

describe('providerSetupModel kind filtering and sorting', () => {
  it('filters provider_kind/* with finite integer typeId and sorts by label', () => {
    const options = listProviderKindOptions([
      typeRow('ability_kind/active', 99, '技能'),
      typeRow('provider_kind/zeta', Number.NaN, 'Z'),
      typeRow('provider_kind/beta', 1.5, 'B'),
      typeRow('provider_kind/gamma', 3),
      typeRow('provider_kind/alpha', 2, '阿尔法'),
      typeRow('provider_kind/delta', 4, 'Delta')
    ]);

    expect(options.map((item) => item.typeKey)).toEqual([
      'provider_kind/alpha',
      'provider_kind/delta',
      'provider_kind/gamma'
    ]);
    expect(options[0].label).toBe('阿尔法 / provider_kind/alpha');
    expect(options[1].label).toBe('Delta / provider_kind/delta');
    expect(options[2].label).toBe('provider_kind/gamma');
  });

  it('exposes a Chinese blocking message when no kinds exist', () => {
    const empty = listProviderKindOptions([typeRow('ability_kind/active', 1)]);
    expect(empty).toEqual([]);
    expect(providerKindBlockingMessage(empty)).toBe(NO_PROVIDER_KIND_TYPES_MESSAGE);

    const validation = validateFormDraft(
      { providerKey: 'q', displayName: 'Q', providerKindTypeKey: 'provider_kind/active' },
      empty
    );
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.reason).toBe(NO_PROVIDER_KIND_TYPES_MESSAGE);
    }
  });
});

describe('providerSetupModel create/update and body', () => {
  it('reports create vs update summary without reverse-filling the key', () => {
    const providers = [
      providerRow('provider_q', '已有 Q', 10),
      providerRow('provider_w', '已有 W', 11)
    ];

    expect(resolveProviderPresence(providers, null)).toEqual({ mode: 'create' });
    expect(resolveProviderPresence(providers, 'provider_e')).toEqual({ mode: 'create' });
    expect(resolveProviderPresence(providers, 'provider_q')).toEqual({
      mode: 'update',
      summary: {
        providerId: 'provider_q',
        displayName: '已有 Q',
        providerKindTypeId: 10
      }
    });
  });

  it('builds an exact body with only providerKindTypeId and trimmed displayName', () => {
    const kinds = listProviderKindOptions([typeRow('provider_kind/active', 7, '主动')]);
    const validated = validateFormDraft(
      {
        providerKey: 'q',
        displayName: '  Display  ',
        providerKindTypeKey: 'provider_kind/active'
      },
      kinds
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    const body = buildProviderPutBody(validated.trimmed);
    expect(body).toEqual({
      providerKindTypeId: 7,
      displayName: 'Display'
    });
    expect(Object.keys(body).sort()).toEqual(['displayName', 'providerKindTypeId']);
  });
});
