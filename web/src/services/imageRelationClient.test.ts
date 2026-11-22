import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMaintenanceBatchFixture } from '../../tests/fixtures/maintenanceBatchFixture';

useMaintenanceBatchFixture();
import { ApiRequestError } from './apiClient';
import { getImageUsages, getRepresentativeImage, listImageOptions } from './imageRelationClient';
import { removeRepresentativeImage, removeRepresentativeImageVerified, setRepresentativeImage, setRepresentativeImageVerified } from './maintenance/imageRelationWrites';
import type { ImageRelationTarget, ImageUsages } from '../types/imageRelation';

const BASE = 'http://localhost:8080';
const GAME = 'demo arena';
const IMAGE = { imageKey: 'portrait/?', name: '测试图片', enabled: true };
const EMPTY_USAGES: ImageUsages = { imageKey: IMAGE.imageKey, games: [], characters: [], attributes: [], equipment: [], skills: [], skillEffects: [], statuses: [], buildOptions: [], buildGroups: [] };
const SOURCES: Array<{ target: ImageRelationTarget; path: string }> = [
  { target: { kind: 'game', key: GAME, name: '游戏' }, path: '/representative-image' },
  { target: { kind: 'character', key: 'same/?', name: '角色' }, path: '/characters/same%2F%3F/representative-image' },
  { target: { kind: 'attribute', key: 'same/?', name: '属性' }, path: '/attributes/same%2F%3F/representative-image' },
  { target: { kind: 'equipment', key: 'same/?', name: '装备' }, path: '/equipment/same%2F%3F/representative-image' },
  { target: { kind: 'buildOption', key: 'same/?', name: '可选项', systemKey: 'system/?' }, path: '/build-systems/system%2F%3F/options/same%2F%3F/representative-image' },
  { target: { kind: 'buildGroup', key: 'same/?', name: '分组', systemKey: 'system/?' }, path: '/build-systems/system%2F%3F/groups/same%2F%3F/representative-image' },
  { target: { kind: 'skill', key: 'same/?', name: '技能' }, path: '/skills/same%2F%3F/representative-image' },
  { target: { kind: 'skillEffect', key: 'same/?', name: '技能效果', skillKey: 'parent/#' }, path: '/skills/parent%2F%23/effects/same%2F%3F/representative-image' },
  { target: { kind: 'status', key: 'same/?', name: '状态' }, path: '/statuses/same%2F%3F/representative-image' }
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('imageRelationClient', () => {
  it.each(SOURCES)('uses independently encoded $target.kind object routes for all reads and writes', async ({ target, path }) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'DELETE' ? new Response(null, { status: 204 }) : jsonResponse({ image: IMAGE }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await getRepresentativeImage(BASE, GAME, target)).data.image).toEqual(IMAGE);
    await setRepresentativeImage(BASE, GAME, target, IMAGE.imageKey);
    const removed = await removeRepresentativeImage(BASE, GAME, target);
    expect(removed.status).toBe(204);
    expect(removed.data).toBeNull();
    for (const [input, options] of fetchMock.mock.calls) {
      expect(String(input)).toBe(`${BASE}/api/admin/games/demo%20arena${path}`);
      expect(new Headers(options?.headers).get('Authorization')).toBeNull();
    }
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ imageKey: IMAGE.imageKey });
    expect(fetchMock.mock.calls[2][1]?.method).toBe('DELETE');
  });

  it('preserves an absent image and an existing disabled image', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ image: null })).mockResolvedValueOnce(jsonResponse({ image: { ...IMAGE, enabled: false } })));
    expect((await getRepresentativeImage(BASE, GAME, SOURCES[1].target)).data).toEqual({ image: null });
    expect((await getRepresentativeImage(BASE, GAME, SOURCES[1].target)).data.image?.enabled).toBe(false);
  });

  it('refuses an effect without its parent and a game source outside the current game before sending requests', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(() => getRepresentativeImage(BASE, GAME, { kind: 'skillEffect', key: 'same', name: '效果' })).toThrow(ApiRequestError);
    expect(() => getRepresentativeImage(BASE, GAME, { kind: 'game', key: 'other', name: '其他游戏' })).toThrow(ApiRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches by trimmed literal text and sends no image content', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [{ imageKey: IMAGE.imageKey, name: IMAGE.name }], total: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await listImageOptions(BASE, GAME, '  图像 /%_?  ');
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/admin/games/demo%20arena/image-options');
    expect(url.searchParams.get('keyword')).toBe('图像 /%_?');
    expect(result.data).toEqual({ items: [{ imageKey: IMAGE.imageKey, name: IMAGE.name }], total: 1 });
  });

  it.each(['   ', '字'.repeat(101)])('rejects invalid candidate searches before requesting', async (keyword) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(listImageOptions(BASE, GAME, keyword)).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {}, { image: {} }, { image: { ...IMAGE, enabled: 'true' } }, { image: { ...IMAGE, name: '' } }
  ])('rejects malformed representative image responses', async (body) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)));
    await expect(getRepresentativeImage(BASE, GAME, SOURCES[1].target)).rejects.toMatchObject({ status: 502, code: '502.IMAGE_RELATION_RESPONSE_INVALID' });
  });

  it('rejects a successful write response for a different image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ image: { ...IMAGE, imageKey: 'other' } })));
    await expect(setRepresentativeImage(BASE, GAME, SOURCES[1].target, IMAGE.imageKey)).rejects.toMatchObject({ status: 502 });
  });

  it('recovers an uncertain representative-image write only through an independent readback', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'response lost' } }, 502))
      .mockResolvedValueOnce(jsonResponse({ image: IMAGE }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await setRepresentativeImageVerified(BASE, GAME, SOURCES[4].target, IMAGE.imageKey)).data.image)
      .toEqual(IMAGE);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['PUT', 'GET']);
  });

  it('confirms representative-image removal with a GET before reporting success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ image: null }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await removeRepresentativeImageVerified(BASE, GAME, SOURCES[5].target)).data.image).toBeNull();
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['DELETE', 'GET']);
  });

  it.each([
    { items: [], total: 1 },
    { items: [{ imageKey: 'same', name: '图' }, { imageKey: 'same', name: '图' }], total: 2 },
    { items: Array.from({ length: 51 }, (_, index) => ({ imageKey: String(index), name: '图' })), total: 51 }
  ])('rejects mismatched candidate counts, duplicate keys and more than 50 entries', async (body) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)));
    await expect(listImageOptions(BASE, GAME, '图片')).rejects.toMatchObject({ status: 502 });
  });

  it('reads all nine fixed usage groups and preserves effect parent identity', async () => {
    const payload: ImageUsages = {
      imageKey: IMAGE.imageKey,
      games: [{ gameId: GAME, gameName: '游戏' }],
      characters: [{ characterKey: 'c', characterName: '角色' }],
      attributes: [{ attributeKey: 'a', attributeName: '属性', attributeStatus: 'DISABLED' }],
      equipment: [{ equipmentKey: 'e', equipmentName: '装备' }],
      buildOptions: [{ systemKey: 'sys', optionKey: 'r', optionName: '可选项' }],
      buildGroups: [{ systemKey: 'sys', groupKey: 'p', groupName: '分组' }],
      skills: [{ skillKey: 's', skillName: '技能', skillStatus: 'ENABLED' }],
      skillEffects: [{ skillKey: 'parent/one', skillName: '所属技能', effectKey: 'same', effectName: '效果' }],
      statuses: [{ statusKey: 't', statusName: '状态', statusStatus: 'DISABLED' }]
    };
    const fetchMock = vi.fn(async () => jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);
    expect((await getImageUsages(BASE, GAME, IMAGE.imageKey)).data).toEqual(payload);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/api/admin/games/demo%20arena/images/portrait%2F%3F/usages`);
  });

  it.each([
    { ...EMPTY_USAGES, statuses: undefined },
    { ...EMPTY_USAGES, imageKey: 'another-image' },
    { ...EMPTY_USAGES, games: [{ gameId: 'other-game', gameName: '其他游戏' }] },
    { ...EMPTY_USAGES, skills: [{ skillKey: 's', skillName: '技能', skillStatus: 'UNKNOWN' }] },
    { ...EMPTY_USAGES, skillEffects: [{ effectKey: 'e', effectName: '效果' }] }
  ])('rejects incomplete, foreign or invalid usage records', async (body) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)));
    await expect(getImageUsages(BASE, GAME, IMAGE.imageKey)).rejects.toMatchObject({ status: 502 });
  });

  it.each([400, 404, 409])('preserves HTTP %s, backend error codes and field issues', async (status) => {
    const details = { fieldIssues: [{ field: 'imageKey', code: 'REFERENCE_DISABLED', message: '图片已停用' }] };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: `${status}.REFERENCE_DISABLED`, message: '图片已停用', details } }, status)));
    await expect(setRepresentativeImage(BASE, GAME, SOURCES[1].target, IMAGE.imageKey)).rejects.toMatchObject({ status, code: `${status}.REFERENCE_DISABLED`, details });
  });
});
