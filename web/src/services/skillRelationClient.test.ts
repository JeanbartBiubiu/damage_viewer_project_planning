import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCharacterSkillRelation,
  createEquipmentSkillRelation,
  deleteCharacterSkillRelation,
  deleteEquipmentSkillRelation,
  listCharacterSkillRelations,
  listEquipmentSkillRelations,
  updateCharacterSkillRelation,
  updateEquipmentSkillRelation,
  listBuildOptionSkillRelations, createBuildOptionSkillRelation, updateBuildOptionSkillRelation, deleteBuildOptionSkillRelation
} from './skillRelationClient';

const character = {
  gameId: 'demo /+', characterKey: 'hero/a', characterName: '角色甲', skillKey: 'skill /+',
  skillName: '技能甲', skillStatus: 'DISABLED', sortOrder: 0
};
const equipment = {
  gameId: character.gameId, equipmentKey: 'item/b', equipmentName: '装备乙', skillKey: character.skillKey,
  skillName: character.skillName, skillStatus: 'ENABLED', sortOrder: 7
};
const base = 'http://localhost:8080';

function response(status: number, body?: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('skillRelationClient', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('queries build option grants by skill or by system and option, and updates the full grant', async () => {
    const grant = {
      gameId: 'g', systemKey: 'paths', optionKey: 'shard', optionName: '碎片', skillKey: 's', skillName: '技能',
      skillStatus: 'DISABLED', activationRank: 1, skillLevelMode: 'FIXED', fixedSkillLevel: 2, sortOrder: 1
    };
    const calls: Array<{ url: URL; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = new URL(String(input)); calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return init.method === 'DELETE' ? response(204) : response(200, !init.method ? { items: [grant], total: 1 } : grant);
    }));
    expect((await listBuildOptionSkillRelations(base, 'g', { systemKey: 'paths', optionKey: 'shard' })).data.items[0].skillStatus).toBe('DISABLED');
    await listBuildOptionSkillRelations(base, 'g', { skillKey: 's' });
    await expect(listBuildOptionSkillRelations(base, 'g', { systemKey: 'paths' })).rejects.toThrow('同时提供');
    await createBuildOptionSkillRelation(base, 'g', { systemKey: 'paths', optionKey: 'shard', skillKey: 's', activationRank: 1, skillLevelMode: 'FIXED', fixedSkillLevel: 2, sortOrder: 1 });
    await updateBuildOptionSkillRelation(base, 'g', 'paths', 'shard', 's', { activationRank: 1, skillLevelMode: 'FIXED', fixedSkillLevel: 2, sortOrder: 1 });
    await deleteBuildOptionSkillRelation(base, 'g', 'paths', 'shard', 's');
    expect(calls[0].url.searchParams.get('systemKey')).toBe('paths');
    expect(calls[0].url.searchParams.get('optionKey')).toBe('shard');
    expect(calls[1].url.searchParams.get('skillKey')).toBe('s');
    expect(calls[3].url.pathname).toBe('/api/admin/games/g/build-option-skill-relations/paths/shard/s');
    expect(calls[3].body).toEqual({ activationRank: 1, skillLevelMode: 'FIXED', fixedSkillLevel: 2, sortOrder: 1 });
  });
  it('rejects another build option identity and an illegal skill level mode', async () => {
    const grant = {
      gameId: 'g', systemKey: 'other', optionKey: 'shard', optionName: '碎片', skillKey: 's', skillName: '技能',
      skillStatus: 'ENABLED', activationRank: 1, skillLevelMode: 'FIXED', fixedSkillLevel: 1, sortOrder: 0
    };
    const sameRank = { ...grant, systemKey: 'paths', skillLevelMode: 'SAME_AS_OPTION', fixedSkillLevel: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(200, { items: [grant], total: 1 })).mockResolvedValueOnce(response(200, grant)).mockResolvedValueOnce(response(200, sameRank)));
    await expect(listBuildOptionSkillRelations(base, 'g', { systemKey: 'paths', optionKey: 'shard' })).rejects.toMatchObject({ status: 502 });
    await expect(createBuildOptionSkillRelation(base, 'g', { systemKey: 'paths', optionKey: 'shard', skillKey: 's', activationRank: 1, skillLevelMode: 'FIXED', fixedSkillLevel: 1, sortOrder: 0 })).rejects.toMatchObject({ status: 502 });
    await expect(createBuildOptionSkillRelation(base, 'g', { systemKey: 'paths', optionKey: 'shard', skillKey: 's', activationRank: 1, skillLevelMode: 'SAME_AS_OPTION', fixedSkillLevel: null, sortOrder: 0 })).rejects.toMatchObject({ status: 502 });
  });

  it('queries both directions on their explicit paths and preserves disabled relations', async () => {
    const calls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url);
      expect(new Headers(init?.headers).get('Authorization')).toBeNull();
      const item = url.pathname.includes('character-skill-relations') ? character : equipment;
      return response(200, { items: [item], total: 1 });
    }));
    const fromCharacter = await listCharacterSkillRelations(base, character.gameId, { characterKey: character.characterKey });
    await listCharacterSkillRelations(base, character.gameId, { skillKey: character.skillKey });
    await listEquipmentSkillRelations(base, character.gameId, { equipmentKey: equipment.equipmentKey });
    await listEquipmentSkillRelations(base, character.gameId, { skillKey: character.skillKey });
    expect(fromCharacter.data.items[0].skillStatus).toBe('DISABLED');
    expect(calls[0].pathname).toBe('/api/admin/games/demo%20%2F%2B/character-skill-relations');
    expect(calls[0].searchParams.get('characterKey')).toBe('hero/a');
    expect(calls[1].searchParams.get('skillKey')).toBe('skill /+');
    expect(calls[2].pathname).toBe('/api/admin/games/demo%20%2F%2B/equipment-skill-relations');
    expect(calls[3].searchParams.get('skillKey')).toBe('skill /+');
  });

  it('writes independent encoded segments and PUT contains only sortOrder', async () => {
    const calls: Array<{ url: URL; method: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (method === 'DELETE') return response(204);
      const item = url.pathname.includes('character-skill-relations') ? character : equipment;
      return response(method === 'POST' ? 201 : 200, item);
    }));
    await createCharacterSkillRelation(base, character.gameId, { characterKey: character.characterKey, skillKey: character.skillKey, sortOrder: 0 });
    await updateCharacterSkillRelation(base, character.gameId, character.characterKey, character.skillKey, { sortOrder: 0 });
    await deleteCharacterSkillRelation(base, character.gameId, character.characterKey, character.skillKey);
    await createEquipmentSkillRelation(base, equipment.gameId, { equipmentKey: equipment.equipmentKey, skillKey: equipment.skillKey, sortOrder: 7 });
    await updateEquipmentSkillRelation(base, equipment.gameId, equipment.equipmentKey, equipment.skillKey, { sortOrder: 7 });
    await deleteEquipmentSkillRelation(base, equipment.gameId, equipment.equipmentKey, equipment.skillKey);
    expect(calls.map(call => call.method)).toEqual(['POST', 'PUT', 'DELETE', 'POST', 'PUT', 'DELETE']);
    expect(calls[1].url.pathname).toBe('/api/admin/games/demo%20%2F%2B/character-skill-relations/hero%2Fa/skill%20%2F%2B');
    expect(calls[4].url.pathname).toBe('/api/admin/games/demo%20%2F%2B/equipment-skill-relations/item%2Fb/skill%20%2F%2B');
    expect(calls[1].body).toEqual({ sortOrder: 0 });
    expect(calls[4].body).toEqual({ sortOrder: 7 });
  });

  it.each([
    { items: [{ ...character, skillStatus: 'UNKNOWN' }], total: 1 },
    { items: [{ ...character, gameId: 'another-game' }], total: 1 },
    { items: [{ ...character, skillName: null }], total: 1 },
    { items: [{ ...character, characterKey: 'wrong-target' }], total: 1 },
    { items: [{ ...character, sortOrder: '0' }], total: 1 },
    { items: [{ ...character, sortOrder: -1 }], total: 1 },
    { items: [{ ...character, sortOrder: 0.5 }], total: 1 },
    { items: [{ ...character, sortOrder: 2147483648 }], total: 1 },
    { items: [character], total: 2 },
    { items: [character, character], total: 2 },
    { total: 0 },
    null
  ])('rejects malformed or mismatched relation lists %#', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, body)));
    await expect(listCharacterSkillRelations(base, character.gameId, { characterKey: character.characterKey }))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([400, 404, 409])('preserves server status and stable error code for HTTP %i', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => response(status, { error: { code: 'REFERENCE_DISABLED', message: '目标技能已停用' } })));
    await expect(createEquipmentSkillRelation(base, equipment.gameId, { equipmentKey: equipment.equipmentKey, skillKey: equipment.skillKey, sortOrder: 0 }))
      .rejects.toMatchObject({ status, code: 'REFERENCE_DISABLED', message: '目标技能已停用' });
  });

  it('rejects an unfiltered query without sending a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(listCharacterSkillRelations(base, character.gameId, {})).rejects.toThrow('至少需要选择一个对象');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects mismatched write identities and non-204 deletion responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, { ...character, skillKey: 'other' })));
    await expect(updateCharacterSkillRelation(base, character.gameId, character.characterKey, character.skillKey, { sortOrder: 0 }))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    vi.stubGlobal('fetch', vi.fn(async () => response(200, null)));
    await expect(deleteCharacterSkillRelation(base, character.gameId, character.characterKey, character.skillKey))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
