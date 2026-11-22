import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMaintenanceBatchFixture } from '../../tests/fixtures/maintenanceBatchFixture';

useMaintenanceBatchFixture();
import { getBuildDefinition, listBuildOptions, listBuildSystems } from './buildClient';
import { updateBuildSystem } from './maintenance/buildWrites';

const base = 'http://localhost:8080';
const time = { createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z' };
const rules = { groupRoles: [], budget: null, prerequisites: [], exclusions: [] };
const system = { ...time, gameId: 'g', systemKey: 'paths', name: '系', description: null, configurationMode: 'SLOT_SELECTION', sortOrder: 0, selectionRules: rules };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('buildClient', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('lists by the current game and omits a blank keyword', async () => {
    const fetchMock = vi.fn(async () => response({ items: [system], total: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await listBuildSystems(base, 'g', '  ')).data.items[0].systemKey).toBe('paths');
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${base}/api/admin/games/g/build-systems`);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBeNull();
  });

  it('rejects a foreign game, an unknown configuration mode and a mismatched list total', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ items: [{ ...system, gameId: 'other' }], total: 1 }))
      .mockResolvedValueOnce(response({ items: [{ ...system, configurationMode: 'CUSTOM' }], total: 1 }))
      .mockResolvedValueOnce(response({ items: [system], total: 2 })));
    await expect(listBuildSystems(base, 'g')).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' });
    await expect(listBuildSystems(base, 'g')).rejects.toMatchObject({ status: 502 });
    await expect(listBuildSystems(base, 'g')).rejects.toMatchObject({ status: 502 });
  });

  it('rejects unknown fields in a definition snapshot instead of silently accepting another contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      system: { ...system, futureRule: true }, groups: [], options: [], skillRelations: []
    })));
    await expect(getBuildDefinition(base, 'g', 'paths')).rejects.toMatchObject({
      status: 502, code: 'INVALID_RESPONSE'
    });
  });

  it('rejects a definition snapshot that reuses an option or points at another system', async () => {
    const option = { ...time, gameId: 'g', systemKey: 'paths', optionKey: 'press', name: '强攻', description: null, maxRank: 1, rankCosts: [0] };
    const group = { ...time, gameId: 'g', systemKey: 'paths', groupKey: 'precision', name: '精密', description: null, sortOrder: 0, slots: [
      { slotKey: 'one', name: '一', minimumSelections: 0, maximumSelections: 1, optionKeys: ['press'] },
      { slotKey: 'two', name: '二', minimumSelections: 0, maximumSelections: 1, optionKeys: ['press'] }
    ] };
    const point = { ...system, configurationMode: 'POINT_ALLOCATION' };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ system: point, groups: [group], options: [option], skillRelations: [] }))
      .mockResolvedValueOnce(response({ system, groups: [{ ...group, systemKey: 'other', slots: [] }], options: [], skillRelations: [] })));
    await expect(getBuildDefinition(base, 'g', 'paths')).rejects.toMatchObject({ status: 502 });
    await expect(getBuildDefinition(base, 'g', 'paths')).rejects.toMatchObject({ status: 502 });
  });

  it('updates without resending the stable system key', async () => {
    const fetchMock = vi.fn(async (_input, init) => response(init?.method === 'PUT' ? system : { items: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    await updateBuildSystem(base, 'g', 'paths', { name: '系', description: null, configurationMode: 'SLOT_SELECTION', sortOrder: 0, selectionRules: rules });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${base}/api/admin/games/g/build-systems/paths`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).not.toHaveProperty('systemKey');
  });

  it('rejects an option list that repeats an identity', async () => {
    const option = { ...time, gameId: 'g', systemKey: 'paths', optionKey: 'press', name: '强攻', description: null, maxRank: 1, rankCosts: [0] };
    vi.stubGlobal('fetch', vi.fn(async () => response({ items: [option, option], total: 2 })));
    await expect(listBuildOptions(base, 'g', 'paths')).rejects.toMatchObject({ status: 502 });
  });
});
