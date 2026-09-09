import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRune, getRune, getRunePath, listRunePaths, listRunes, updateRune, updateRunePath } from './runeClient';
const BASE = 'http://localhost:8080';
const rune = { gameId: 'g', runeKey: 'shard', name: '属性碎片', description: null, category: 'SHARD', createdAt: 'now', updatedAt: 'now' };
const path = { gameId: 'g', pathKey: 'shards', name: '碎片组', description: null, kind: 'SHARD_GROUP', sortOrder: 0, slots: [], createdAt: 'now', updatedAt: 'now' };
function response(data: unknown) { return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
afterEach(() => vi.unstubAllGlobals());
describe('runeClient', () => {
  it('keeps category and literal keyword filters on the identity endpoint', async () => {
    const fetch = vi.fn(async () => response({ items: [rune], total: 1 })); vi.stubGlobal('fetch', fetch);
    const result = await listRunes(BASE, 'g', 'test', { keyword: ' 碎片 /%_ ', category: 'SHARD' });
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/admin/games/g/runes');
    expect(url.searchParams.get('keyword')).toBe('碎片 /%_'); expect(url.searchParams.get('category')).toBe('SHARD');
    expect(result.data.items[0]).toEqual(rune);
  });
  it('preserves empty layouts and a single shard identity reused in different slots', async () => {
    const layout = { ...path, slots: [{ name: '一', category: 'SHARD', runeKeys: ['shard'] }, { name: '二', category: 'SHARD', runeKeys: ['shard'] }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ items: [path], total: 1 })).mockResolvedValueOnce(response(layout)));
    expect((await listRunePaths(BASE, 'g', 'test')).data.items[0].slots).toEqual([]);
    expect((await getRunePath(BASE, 'g', 'shards', 'test')).data.slots).toEqual(layout.slots);
  });
  it.each([{}, { items: [], total: 1 }, { items: [rune, rune], total: 2 }, { items: [{ ...rune, gameId: 'other' }], total: 1 }, { items: [{ ...rune, category: 'UNKNOWN' }], total: 1 }])('rejects missing, incomplete or foreign identity responses', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)));
    await expect(listRunes(BASE, 'g', 'test')).rejects.toMatchObject({ status: 502 });
  });
  it.each([{ ...path, slots: undefined }, { ...path, kind: 'OTHER' }, { ...path, slots: [{ name: '一', category: 'MINOR', runeKeys: [] }] }, { ...path, slots: [{ name: '一', category: 'SHARD', runeKeys: ['shard', 'shard'] }] }])('does not silently replace a malformed layout with an empty draft', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)));
    await expect(getRunePath(BASE, 'g', 'shards', 'test')).rejects.toMatchObject({ status: 502 });
  });
  it('keeps identity, image and skill writes separate and sends complete ordered layout on PUT', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const body = JSON.parse(init.body); calls.push({ url: String(url), body });
      return response(String(url).includes('rune-paths') ? { ...path, ...body } : { ...rune, ...body });
    }));
    const { gameId: _g, createdAt: _c, updatedAt: _u, ...create } = rune;
    await createRune(BASE, 'g', 'test', { ...create, category: 'SHARD' });
    await updateRune(BASE, 'g', 'shard', 'test', { name: '新名称', description: null, category: 'SHARD' });
    const slots = [{ name: '二', category: 'SHARD' as const, runeKeys: ['b', 'a'] }, { name: '一', category: 'SHARD' as const, runeKeys: [] }];
    await updateRunePath(BASE, 'g', 'shards', 'test', { name: path.name, description: null, kind: 'SHARD_GROUP', sortOrder: 0, slots });
    expect(Object.keys(calls[0].body).sort()).toEqual(['category', 'description', 'name', 'runeKey']);
    expect(calls[1].body).not.toHaveProperty('runeKey'); expect(calls[2].body).not.toHaveProperty('pathKey');
    expect(calls[2].body.slots).toEqual(slots);
  });
  it('rejects a successful response for a different stable key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...rune, runeKey: 'other' })));
    await expect(getRune(BASE, 'g', 'shard', 'test')).rejects.toMatchObject({ status: 502 });
  });
});
