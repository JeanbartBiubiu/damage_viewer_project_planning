import { describe, expect, it } from 'vitest';
import type { EffectSequence } from '../../../types/combatData';
import {
  CREATE_UNAVAILABLE_NON_PROVIDER_FORM_MESSAGE,
  PROVIDER_ID_PATTERN,
  SEQUENCE_KEY_PATTERN,
  buildEffectSequencePutBody,
  buildSequenceIdFromProviderAndKey,
  createDefaultFormDraft,
  draftFromExistingSequence,
  evaluateEffectSequenceCollisions,
  extractProviderStem,
  listSequencesForProvider,
  resolveEffectSequenceTarget,
  validateEffectSequenceSetup,
  validateFormDraft
} from './effectSequenceSetupModel';

function sequenceRow(
  sequenceId: string,
  providerId: string,
  sequenceKey: string,
  displayName?: string
): EffectSequence {
  return {
    gameId: 'demo',
    sequenceId,
    providerId,
    sequenceKey,
    displayName,
    changeRevision: 1,
    updatedAt: 't'
  };
}

describe('effectSequenceSetupModel regexes and derived ID', () => {
  it('accepts provider_<stem> and sequenceKey patterns used for create', () => {
    expect(PROVIDER_ID_PATTERN.test('provider_ashe_q')).toBe(true);
    expect(PROVIDER_ID_PATTERN.test('provider_q')).toBe(true);
    expect(PROVIDER_ID_PATTERN.test('provider_')).toBe(false);
    expect(PROVIDER_ID_PATTERN.test('legacyProvider')).toBe(false);
    expect(PROVIDER_ID_PATTERN.test('provider_Ashe')).toBe(false);

    expect(SEQUENCE_KEY_PATTERN.test('impact')).toBe(true);
    expect(SEQUENCE_KEY_PATTERN.test('ashe_q_hit')).toBe(true);
    expect(SEQUENCE_KEY_PATTERN.test('9_seq')).toBe(true);
    expect(SEQUENCE_KEY_PATTERN.test('Impact')).toBe(false);
    expect(SEQUENCE_KEY_PATTERN.test('_leading')).toBe(false);
    expect(SEQUENCE_KEY_PATTERN.test('bad-key')).toBe(false);
  });

  it('derives sequence_<stem>_<sequenceKey> only as new-record seed naming', () => {
    expect(buildSequenceIdFromProviderAndKey('provider_ashe_q', 'impact')).toBe(
      'sequence_ashe_q_impact'
    );
    expect(buildSequenceIdFromProviderAndKey('  provider_q  ', '  hit  ')).toBe(
      'sequence_q_hit'
    );
    expect(buildSequenceIdFromProviderAndKey('legacy', 'hit')).toBeNull();
    expect(buildSequenceIdFromProviderAndKey('provider_q', 'Bad')).toBeNull();
    expect(buildSequenceIdFromProviderAndKey('provider_q', '')).toBeNull();
    expect(extractProviderStem('provider_ashe_q')).toBe('ashe_q');
    expect(extractProviderStem('not_provider')).toBeNull();
  });
});

describe('effectSequenceSetupModel target and presence selection', () => {
  const sequences = [
    sequenceRow('sequence_q_impact', 'provider_q', 'impact', '命中'),
    sequenceRow('legacy_seq_ult', 'weird_provider', 'r', '大招序列')
  ];

  it('creates from provider_<stem> + sequenceKey', () => {
    const target = resolveEffectSequenceTarget(
      {
        ...createDefaultFormDraft(),
        providerId: 'provider_q',
        sequenceKey: 'cast'
      },
      sequences
    );
    expect(target).toEqual({
      mode: 'create',
      sequenceId: 'sequence_q_cast',
      providerId: 'provider_q'
    });
  });

  it('preserves legacy/non-derived selected sequenceId and never renames it', () => {
    const target = resolveEffectSequenceTarget(
      {
        ...createDefaultFormDraft(),
        providerId: 'weird_provider',
        selectedExistingSequenceId: 'legacy_seq_ult',
        sequenceKey: 'renamed_should_not_change_id',
        displayName: '新名'
      },
      sequences
    );
    expect(target.mode).toBe('update');
    if (target.mode === 'update') {
      expect(target.sequenceId).toBe('legacy_seq_ult');
      expect(target.summary.sequenceKey).toBe('r');
      expect(target.summary.displayName).toBe('大招序列');
    }
  });

  it('blocks create for non provider_<stem> IDs with an explanatory reason', () => {
    const target = resolveEffectSequenceTarget(
      {
        ...createDefaultFormDraft(),
        providerId: 'weird_provider',
        sequenceKey: 'hit'
      },
      sequences
    );
    expect(target.mode).toBe('unavailable');
    if (target.mode === 'unavailable') {
      expect(target.reason).toBe(CREATE_UNAVAILABLE_NON_PROVIDER_FORM_MESSAGE);
    }
  });

  it('lists only sequences for the selected provider', () => {
    const listed = listSequencesForProvider(
      [
        ...sequences,
        sequenceRow('sequence_q_cast', 'provider_q', 'cast', '施放')
      ],
      'provider_q'
    );
    expect(listed.map((item) => item.sequenceId)).toEqual([
      'sequence_q_cast',
      'sequence_q_impact'
    ]);
  });
});

describe('effectSequenceSetupModel collisions', () => {
  const sequences = [
    sequenceRow('sequence_q_impact', 'provider_q', 'impact', '命中'),
    sequenceRow('sequence_q_cast', 'provider_q', 'cast', '施放'),
    sequenceRow('other', 'provider_other', 'impact', 'Other')
  ];

  it('blocks create when derived target sequenceId already exists', () => {
    const result = validateEffectSequenceSetup(
      {
        ...createDefaultFormDraft(),
        providerId: 'provider_q',
        sequenceKey: 'impact',
        displayName: '命中'
      },
      sequences
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('sequence_q_impact');
      expect(result.reason).toContain('选择该已有 Sequence');
    }
  });

  it('blocks provider+key collision excluding the selected target', () => {
    const collision = evaluateEffectSequenceCollisions(
      {
        mode: 'update',
        sequenceId: 'sequence_q_impact',
        providerId: 'provider_q',
        summary: {
          sequenceId: 'sequence_q_impact',
          sequenceKey: 'impact',
          displayName: '命中'
        }
      },
      'cast',
      sequences
    );
    expect(collision.ok).toBe(false);
    if (!collision.ok) {
      expect(collision.reason).toContain('sequence_q_cast');
      expect(collision.reason).toContain('sequenceKey「cast」');
    }
  });

  it('does not self-block update when provider/key are unchanged', () => {
    const result = validateEffectSequenceSetup(
      {
        providerId: 'provider_q',
        selectedExistingSequenceId: 'sequence_q_impact',
        sequenceKey: 'impact',
        displayName: '命中更新'
      },
      sequences
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.mode).toBe('update');
      if (result.target.mode === 'update') {
        expect(result.target.sequenceId).toBe('sequence_q_impact');
      }
    }
  });
});

describe('effectSequenceSetupModel optional blank displayName exact body', () => {
  it('always includes trimmed displayName including empty string', () => {
    const validated = validateFormDraft(
      {
        providerId: 'provider_q',
        selectedExistingSequenceId: '',
        sequenceKey: '  hit  ',
        displayName: '   '
      },
      { mode: 'create', sequenceId: 'sequence_q_hit', providerId: 'provider_q' }
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.trimmed.displayName).toBe('');

    const body = buildEffectSequencePutBody(validated.trimmed);
    expect(body).toEqual({
      providerId: 'provider_q',
      sequenceKey: 'hit',
      displayName: ''
    });
    expect(Object.keys(body).sort()).toEqual(['displayName', 'providerId', 'sequenceKey']);

    const withName = buildEffectSequencePutBody({
      ...validated.trimmed,
      displayName: '命中'
    });
    expect(withName).toEqual({
      providerId: 'provider_q',
      sequenceKey: 'hit',
      displayName: '命中'
    });
  });

  it('draftFromExistingSequence keeps exact sequenceId without reconstructing from key', () => {
    const legacy = sequenceRow('totally_custom_id', 'provider_q', 'impact', '自定义');
    const draft = draftFromExistingSequence(legacy);
    expect(draft.selectedExistingSequenceId).toBe('totally_custom_id');
    expect(draft.sequenceKey).toBe('impact');
    expect(buildSequenceIdFromProviderAndKey(draft.providerId, draft.sequenceKey)).toBe(
      'sequence_q_impact'
    );
    expect(draft.selectedExistingSequenceId).not.toBe(
      buildSequenceIdFromProviderAndKey(draft.providerId, draft.sequenceKey)
    );
  });
});
