import { describe, expect, it } from 'vitest';
import type { Ability, TypeDefinition } from '../../../types/combatData';
import {
  ABILITY_KEY_PATTERN,
  CREATE_UNAVAILABLE_NON_PROVIDER_FORM_MESSAGE,
  NO_ABILITY_KIND_TYPES_MESSAGE,
  PROVIDER_ID_PATTERN,
  buildAbilityIdFromProviderAndKey,
  buildAbilityPutBody,
  createDefaultFormDraft,
  draftFromExistingAbility,
  evaluateAbilityCollisions,
  extractProviderStem,
  listAbilityKindOptions,
  listAbilitiesForProvider,
  resolveAbilityKindTypeKey,
  resolveAbilityTarget,
  validateAbilitySetup,
  validateFormDraft
} from './abilitySetupModel';

function typeRow(typeKey: string, typeId: number, name?: string): TypeDefinition {
  return {
    gameId: 'demo',
    typeId,
    typeKey,
    name,
    changeRevision: 1,
    updatedAt: 't'
  };
}

function abilityRow(
  abilityId: string,
  providerId: string,
  abilityKey: string,
  abilityKindTypeId: number,
  displayName = abilityKey,
  castConditionFormulaKey?: string
): Ability {
  return {
    gameId: 'demo',
    abilityId,
    providerId,
    abilityKey,
    abilityKindTypeId,
    displayName,
    castConditionFormulaKey,
    changeRevision: 1,
    updatedAt: 't'
  };
}

describe('abilitySetupModel ability_kind filtering and sorting', () => {
  it('filters ability_kind/* with finite integer typeId and sorts by label', () => {
    const options = listAbilityKindOptions([
      typeRow('provider_kind/active', 99, 'Provider'),
      typeRow('ability_kind/zeta', Number.NaN, 'Z'),
      typeRow('ability_kind/beta', 1.5, 'B'),
      typeRow('ability_kind/gamma', 3),
      typeRow('ability_kind/alpha', 2, '阿尔法'),
      typeRow('ability_kind/delta', 4, 'Delta')
    ]);

    expect(options.map((item) => item.typeKey)).toEqual([
      'ability_kind/alpha',
      'ability_kind/gamma',
      'ability_kind/delta'
    ]);
    expect(options[0].label).toBe('阿尔法 / ability_kind/alpha');
    expect(options[1].label).toBe('ability_kind/gamma');
    expect(options[2].label).toBe('Delta / ability_kind/delta');
  });
});

describe('abilitySetupModel regexes and derived ID', () => {
  it('accepts provider_<stem> and abilityKey patterns used for create', () => {
    expect(PROVIDER_ID_PATTERN.test('provider_ashe_q')).toBe(true);
    expect(PROVIDER_ID_PATTERN.test('provider_q')).toBe(true);
    expect(PROVIDER_ID_PATTERN.test('provider_')).toBe(false);
    expect(PROVIDER_ID_PATTERN.test('legacyProvider')).toBe(false);
    expect(PROVIDER_ID_PATTERN.test('provider_Ashe')).toBe(false);

    expect(ABILITY_KEY_PATTERN.test('q')).toBe(true);
    expect(ABILITY_KEY_PATTERN.test('ashe_q')).toBe(true);
    expect(ABILITY_KEY_PATTERN.test('9_skill')).toBe(true);
    expect(ABILITY_KEY_PATTERN.test('Q')).toBe(false);
    expect(ABILITY_KEY_PATTERN.test('_leading')).toBe(false);
    expect(ABILITY_KEY_PATTERN.test('bad-key')).toBe(false);
  });

  it('derives ability_<stem>_<abilityKey> and extracts stem', () => {
    expect(buildAbilityIdFromProviderAndKey('provider_ashe_q', 'w')).toBe('ability_ashe_q_w');
    expect(buildAbilityIdFromProviderAndKey('  provider_q  ', '  basic  ')).toBe('ability_q_basic');
    expect(buildAbilityIdFromProviderAndKey('legacy', 'q')).toBeNull();
    expect(buildAbilityIdFromProviderAndKey('provider_q', 'Bad')).toBeNull();
    expect(buildAbilityIdFromProviderAndKey('provider_q', '')).toBeNull();
    expect(extractProviderStem('provider_ashe_q')).toBe('ashe_q');
    expect(extractProviderStem('not_provider')).toBeNull();
  });
});

describe('abilitySetupModel target and presence selection', () => {
  const abilities = [
    abilityRow('ability_q', 'provider_q', 'q', 1, 'Q 技能'),
    abilityRow('legacy_ult', 'weird_provider', 'r', 2, '大招')
  ];

  it('creates from provider_<stem> + abilityKey', () => {
    const target = resolveAbilityTarget(
      {
        ...createDefaultFormDraft(),
        providerId: 'provider_q',
        abilityKey: 'w'
      },
      abilities
    );
    expect(target).toEqual({
      mode: 'create',
      abilityId: 'ability_q_w',
      providerId: 'provider_q'
    });
  });

  it('preserves legacy selected abilityId and never renames it', () => {
    const target = resolveAbilityTarget(
      {
        ...createDefaultFormDraft(),
        providerId: 'weird_provider',
        selectedExistingAbilityId: 'legacy_ult',
        abilityKey: 'renamed_should_not_change_id',
        displayName: '新名'
      },
      abilities
    );
    expect(target.mode).toBe('update');
    if (target.mode === 'update') {
      expect(target.abilityId).toBe('legacy_ult');
      expect(target.summary.abilityKey).toBe('r');
      expect(target.summary.displayName).toBe('大招');
    }
  });

  it('blocks create for non provider_<stem> IDs with an explanatory reason', () => {
    const target = resolveAbilityTarget(
      {
        ...createDefaultFormDraft(),
        providerId: 'weird_provider',
        abilityKey: 'q'
      },
      abilities
    );
    expect(target.mode).toBe('unavailable');
    if (target.mode === 'unavailable') {
      expect(target.reason).toBe(CREATE_UNAVAILABLE_NON_PROVIDER_FORM_MESSAGE);
    }
  });

  it('lists only abilities for the selected provider', () => {
    const listed = listAbilitiesForProvider(
      [
        ...abilities,
        abilityRow('ability_q_e', 'provider_q', 'e', 1, 'E')
      ],
      'provider_q'
    );
    expect(listed.map((item) => item.abilityId)).toEqual(['ability_q', 'ability_q_e']);
  });
});

describe('abilitySetupModel collisions', () => {
  const abilities = [
    abilityRow('ability_q_q', 'provider_q', 'q', 1, 'Q'),
    abilityRow('ability_q_w', 'provider_q', 'w', 1, 'W'),
    abilityRow('other', 'provider_other', 'q', 1, 'Other Q')
  ];
  const kinds = listAbilityKindOptions([typeRow('ability_kind/active', 1, '主动')]);

  it('blocks create when derived target abilityId already exists', () => {
    const result = validateAbilitySetup(
      {
        ...createDefaultFormDraft(),
        providerId: 'provider_q',
        abilityKey: 'q',
        displayName: 'Q',
        abilityKindTypeKey: 'ability_kind/active'
      },
      kinds,
      abilities
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('ability_q_q');
      expect(result.reason).toContain('选择该已有 Ability');
    }
  });

  it('blocks provider+key collision excluding the selected target', () => {
    const collision = evaluateAbilityCollisions(
      { mode: 'update', abilityId: 'ability_q_q', providerId: 'provider_q', summary: {
        abilityId: 'ability_q_q',
        abilityKey: 'q',
        displayName: 'Q',
        abilityKindTypeId: 1,
        castConditionFormulaKey: ''
      } },
      'w',
      abilities
    );
    expect(collision.ok).toBe(false);
    if (!collision.ok) {
      expect(collision.reason).toContain('ability_q_w');
      expect(collision.reason).toContain('abilityKey「w」');
    }
  });

  it('does not self-block update when abilityKey is unchanged', () => {
    const result = validateAbilitySetup(
      {
        providerId: 'provider_q',
        selectedExistingAbilityId: 'ability_q_q',
        abilityKey: 'q',
        displayName: 'Q 更新',
        abilityKindTypeKey: 'ability_kind/active',
        castConditionFormulaKey: ''
      },
      kinds,
      abilities
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.mode).toBe('update');
      if (result.target.mode === 'update') {
        expect(result.target.abilityId).toBe('ability_q_q');
      }
    }
  });
});

describe('abilitySetupModel missing type and optional castCondition', () => {
  it('blocks legacy update when old kind cannot be resolved', () => {
    const kinds = listAbilityKindOptions([typeRow('ability_kind/active', 1, '主动')]);
    const ability = abilityRow('legacy_ult', 'provider_q', 'r', 99, '大招');
    const draft = draftFromExistingAbility(ability, kinds);
    expect(draft.abilityKindTypeKey).toBe('');
    expect(resolveAbilityKindTypeKey(kinds, 99)).toBeNull();

    const result = validateAbilitySetup(draft, kinds, [ability]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('abilityKindTypeId=99');
      expect(result.reason).toContain('无法映射');
    }
  });

  it('omits blank castConditionFormulaKey and builds exact PUT body', () => {
    const kinds = listAbilityKindOptions([typeRow('ability_kind/passive', 7, '被动')]);
    const emptyKinds = listAbilityKindOptions([typeRow('provider_kind/active', 1)]);
    expect(emptyKinds).toEqual([]);

    const validated = validateFormDraft(
      {
        providerId: 'provider_q',
        selectedExistingAbilityId: '',
        abilityKey: '  passive  ',
        displayName: '  被动  ',
        abilityKindTypeKey: 'ability_kind/passive',
        castConditionFormulaKey: '   '
      },
      kinds,
      { mode: 'create', abilityId: 'ability_q_passive', providerId: 'provider_q' }
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.trimmed.castConditionFormulaKey).toBeUndefined();

    const body = buildAbilityPutBody(validated.trimmed);
    expect(body).toEqual({
      providerId: 'provider_q',
      abilityKey: 'passive',
      abilityKindTypeId: 7,
      displayName: '被动'
    });
    expect(Object.keys(body).sort()).toEqual([
      'abilityKey',
      'abilityKindTypeId',
      'displayName',
      'providerId'
    ]);

    const withOptional = buildAbilityPutBody({
      ...validated.trimmed,
      castConditionFormulaKey: 'cast_ok'
    });
    expect(withOptional).toEqual({
      providerId: 'provider_q',
      abilityKey: 'passive',
      abilityKindTypeId: 7,
      displayName: '被动',
      castConditionFormulaKey: 'cast_ok'
    });

    const noKinds = validateFormDraft(
      {
        ...createDefaultFormDraft(),
        providerId: 'provider_q',
        abilityKey: 'q',
        displayName: 'Q',
        abilityKindTypeKey: 'ability_kind/active'
      },
      emptyKinds,
      { mode: 'create', abilityId: 'ability_q_q', providerId: 'provider_q' }
    );
    expect(noKinds.ok).toBe(false);
    if (!noKinds.ok) {
      expect(noKinds.reason).toBe(NO_ABILITY_KIND_TYPES_MESSAGE);
    }
  });
});
