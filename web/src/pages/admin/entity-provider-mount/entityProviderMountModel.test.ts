import { describe, expect, it } from 'vitest';
import type { CombatEntity, EntityProviderMount, Provider } from '../../../types/combatData';
import {
  buildMountPutBody,
  createDefaultFormDraft,
  formatStableLabel,
  isDraftComplete,
  listEntityOptions,
  listProviderOptions,
  resolveMountRelationStatus
} from './entityProviderMountModel';

function entityRow(entityId: string, displayName: string): CombatEntity {
  return {
    gameId: 'demo',
    entityId,
    displayName,
    changeRevision: 1,
    updatedAt: 't'
  };
}

function providerRow(providerId: string, displayName: string): Provider {
  return {
    gameId: 'demo',
    providerId,
    displayName,
    providerKindTypeId: 1,
    changeRevision: 1,
    updatedAt: 't'
  };
}

function mountRow(entityId: string, providerId: string): EntityProviderMount {
  return {
    gameId: 'demo',
    entityId,
    providerId,
    changeRevision: 1,
    updatedAt: 't'
  };
}

describe('entityProviderMountModel labels and sort', () => {
  it('formats stable ID / display name', () => {
    expect(formatStableLabel('entity_ashe', '寒冰射手')).toBe('entity_ashe / 寒冰射手');
    expect(formatStableLabel('entity_ashe', '  ')).toBe('entity_ashe');
    expect(formatStableLabel('provider_q', null)).toBe('provider_q');
  });

  it('lists entities sorted by zh-CN label', () => {
    const options = listEntityOptions([
      entityRow('entity_b', 'Beta'),
      entityRow('entity_a', '阿尔法'),
      entityRow('entity_c', '')
    ]);
    expect(options.map((item) => item.value)).toEqual([
      'entity_a',
      'entity_b',
      'entity_c'
    ]);
    expect(options[0].label).toBe('entity_a / 阿尔法');
    expect(options[1].label).toBe('entity_b / Beta');
    expect(options[2].label).toBe('entity_c');
  });

  it('lists providers sorted by zh-CN label', () => {
    const options = listProviderOptions([
      providerRow('provider_w', 'W'),
      providerRow('provider_q', '寒冰箭'),
      providerRow('provider_e', '  ')
    ]);
    expect(options.map((item) => item.value)).toEqual([
      'provider_e',
      'provider_q',
      'provider_w'
    ]);
    expect(options[1].label).toBe('provider_q / 寒冰箭');
  });
});

describe('entityProviderMountModel draft and relation status', () => {
  it('tracks entityId/providerId draft completeness', () => {
    expect(isDraftComplete(createDefaultFormDraft())).toBe(false);
    expect(isDraftComplete({ entityId: 'entity_a', providerId: '' })).toBe(false);
    expect(isDraftComplete({ entityId: '', providerId: 'provider_q' })).toBe(false);
    expect(isDraftComplete({ entityId: '  entity_a  ', providerId: '  provider_q  ' })).toBe(true);
  });

  it('resolves incomplete / new / existing mount states', () => {
    const mounts = [mountRow('entity_a', 'provider_q')];

    expect(resolveMountRelationStatus(createDefaultFormDraft(), mounts)).toEqual({
      status: 'incomplete'
    });
    expect(
      resolveMountRelationStatus({ entityId: 'entity_a', providerId: '' }, mounts)
    ).toEqual({ status: 'incomplete' });

    expect(
      resolveMountRelationStatus({ entityId: 'entity_a', providerId: 'provider_w' }, mounts)
    ).toEqual({
      status: 'new',
      entityId: 'entity_a',
      providerId: 'provider_w'
    });

    expect(
      resolveMountRelationStatus(
        { entityId: '  entity_a  ', providerId: '  provider_q  ' },
        mounts
      )
    ).toEqual({
      status: 'existing',
      entityId: 'entity_a',
      providerId: 'provider_q'
    });
  });
});

describe('entityProviderMountModel PUT body', () => {
  it('builds an exact empty object body', () => {
    const body = buildMountPutBody();
    expect(body).toEqual({});
    expect(Object.keys(body)).toEqual([]);
  });
});
