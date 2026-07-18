import { describe, expect, it } from 'vitest';
import type { CombatEntity } from '../../../types/combatData';
import {
  clearImageReference,
  createUntouchedImageReference,
  setExactImageReference
} from '../../../services/combatDataImageReference';
import {
  buildEntityPutBody,
  createDefaultFormDraft,
  normalizeEntityDescription,
  populateDraftFromEntity,
  resolveEntityPresence,
  validateFormDraft,
  willClearExistingDescription,
  willClearExistingImageUri
} from './entitySetupModel';

function entityRow(
  entityId: string,
  displayName: string,
  description?: string,
  imageUri?: string | null
): CombatEntity {
  return {
    gameId: 'demo',
    entityId,
    displayName,
    description,
    imageUri,
    changeRevision: 1,
    updatedAt: 't'
  };
}

describe('entitySetupModel form validation', () => {
  it('rejects empty entityId and displayName after trim', () => {
    expect(validateFormDraft(createDefaultFormDraft()).ok).toBe(false);

    const blankId = validateFormDraft({
      entityId: '   ',
      displayName: 'Vayne',
      description: '',
      imageReference: createUntouchedImageReference(null)
    });
    expect(blankId.ok).toBe(false);
    if (!blankId.ok) {
      expect(blankId.reason).toContain('实体 ID');
    }

    const blankName = validateFormDraft({
      entityId: 'hero_vayne',
      displayName: '   ',
      description: 'x',
      imageReference: createUntouchedImageReference(null)
    });
    expect(blankName.ok).toBe(false);
    if (!blankName.ok) {
      expect(blankName.reason).toContain('显示名');
    }
  });

  it('trims text fields and allows blank description as empty string', () => {
    const withDesc = validateFormDraft({
      entityId: '  hero_vayne  ',
      displayName: '  薇恩  ',
      description: '  night hunter  ',
      imageReference: createUntouchedImageReference(null)
    });
    expect(withDesc.ok).toBe(true);
    if (withDesc.ok) {
      expect(withDesc.trimmed).toMatchObject({
        entityId: 'hero_vayne',
        displayName: '薇恩',
        description: 'night hunter'
      });
    }

    const blankDesc = validateFormDraft({
      entityId: 'item_2510',
      displayName: 'Item',
      description: '   ',
      imageReference: createUntouchedImageReference(null)
    });
    expect(blankDesc.ok).toBe(true);
    if (blankDesc.ok) {
      expect(blankDesc.trimmed.description).toBe('');
    }
  });

  it('new draft starts with untouched image state', () => {
    const draft = createDefaultFormDraft();
    expect(draft.imageReference).toEqual({ status: 'untouched', original: null });
  });
});

describe('entitySetupModel create/update presence and load', () => {
  it('reports create vs update with existing fields including imageUri', () => {
    const entities = [
      entityRow('hero_vayne', '薇恩', '暗夜猎手', 'character_vayne'),
      entityRow('item_2510', '无描述物品')
    ];

    expect(resolveEntityPresence(entities, null)).toEqual({ mode: 'create' });
    expect(resolveEntityPresence(entities, 'hero_new')).toEqual({ mode: 'create' });
    expect(resolveEntityPresence(entities, 'hero_vayne')).toEqual({
      mode: 'update',
      summary: {
        entityId: 'hero_vayne',
        displayName: '薇恩',
        description: '暗夜猎手',
        imageUri: 'character_vayne'
      }
    });
    expect(resolveEntityPresence(entities, 'item_2510')).toEqual({
      mode: 'update',
      summary: {
        entityId: 'item_2510',
        displayName: '无描述物品',
        description: '',
        imageUri: null
      }
    });
  });

  it('populateDraftFromEntity sets untouched preserve and does not mark image touched', () => {
    const draft = populateDraftFromEntity(
      entityRow('hero_vayne', '薇恩', '暗夜猎手', 'character_vayne')
    );
    expect(draft).toEqual({
      entityId: 'hero_vayne',
      displayName: '薇恩',
      description: '暗夜猎手',
      imageReference: { status: 'untouched', original: 'character_vayne' }
    });
  });

  it('normalizes absent or whitespace-only existing description to empty string', () => {
    expect(normalizeEntityDescription(undefined)).toBe('');
    expect(normalizeEntityDescription(null)).toBe('');
    expect(normalizeEntityDescription('  ')).toBe('');
    expect(normalizeEntityDescription('  keep  ')).toBe('keep');
  });

  it('detects blank-description clearing on update when existing had text', () => {
    const presence = resolveEntityPresence(
      [entityRow('hero_vayne', '薇恩', '暗夜猎手')],
      'hero_vayne'
    );
    expect(willClearExistingDescription(presence, '')).toBe(true);
    expect(willClearExistingDescription(presence, 'kept')).toBe(false);
    expect(willClearExistingDescription({ mode: 'create' }, '')).toBe(false);
  });
});

describe('entitySetupModel exact body with imageUri three-state', () => {
  it('omits imageUri when untouched/preserve', () => {
    const validated = validateFormDraft({
      entityId: 'hero_vayne',
      displayName: '  薇恩  ',
      description: '  desc  ',
      imageReference: createUntouchedImageReference('character_vayne')
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    const body = buildEntityPutBody(validated.trimmed);
    expect(body).toEqual({
      displayName: '薇恩',
      description: 'desc'
    });
    expect(Object.keys(body).sort()).toEqual(['description', 'displayName']);
  });

  it('includes exact imageUri when set', () => {
    const validated = validateFormDraft({
      entityId: 'hero_vayne',
      displayName: '薇恩',
      description: '',
      imageReference: setExactImageReference(
        createUntouchedImageReference(null),
        '  character_vayne  '
      )
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(buildEntityPutBody(validated.trimmed)).toEqual({
      displayName: '薇恩',
      description: '',
      imageUri: '  character_vayne  '
    });
  });

  it('includes imageUri null when cleared', () => {
    const validated = validateFormDraft({
      entityId: 'hero_vayne',
      displayName: '薇恩',
      description: '',
      imageReference: clearImageReference(createUntouchedImageReference('character_vayne'))
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(buildEntityPutBody(validated.trimmed)).toEqual({
      displayName: '薇恩',
      description: '',
      imageUri: null
    });
  });

  it('detects clearing an existing image association', () => {
    const presence = resolveEntityPresence(
      [entityRow('hero_vayne', '薇恩', '', 'character_vayne')],
      'hero_vayne'
    );
    expect(
      willClearExistingImageUri(
        presence,
        clearImageReference(createUntouchedImageReference('character_vayne'))
      )
    ).toBe(true);
    expect(
      willClearExistingImageUri(presence, createUntouchedImageReference('character_vayne'))
    ).toBe(false);
  });
});
