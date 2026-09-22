import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createModifierZone, deleteModifierZone, listModifierZones, parseModifierZone, updateModifierZone
} from './modifierZoneClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const zone = {
  gameId: 'lol', modifierZoneKey: 'damage_pre_defense', name: '伤害前修正',
  domain: 'DAMAGE' as const, calculationMode: 'RATIO_ADD' as const,
  applicationStage: 'DAMAGE_PRE_DEFENSE' as const, description: null,
  status: 'ENABLED' as const, sortOrder: 0,
  createdAt: '2026-09-23T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z'
};

describe('modifierZoneClient', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('encodes list filters', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/admin/games/demo%20arena/modifier-zones');
      expect(url.searchParams.get('keyword')).toBe('伤害');
      expect(url.searchParams.get('domain')).toBe('DAMAGE');
      expect(url.searchParams.get('status')).toBe('ENABLED');
      return jsonResponse(200, { items: [], total: 0 });
    }));
    await listModifierZones('http://localhost:8080', 'demo arena', 'token', {
      keyword: ' 伤害 ', domain: 'DAMAGE', status: 'ENABLED'
    });
  });

  it('sends the complete structure and keeps the key immutable on update', async () => {
    const calls: Array<{ method: string; body: Record<string, unknown> | null }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
      });
      return jsonResponse(init?.method === 'DELETE' ? 204 : init?.method === 'POST' ? 201 : 200, zone);
    }));
    const body = {
      name: '伤害前修正', domain: 'DAMAGE' as const, calculationMode: 'RATIO_ADD' as const,
      applicationStage: 'DAMAGE_PRE_DEFENSE' as const, description: null,
      status: 'ENABLED' as const, sortOrder: 0
    };
    await createModifierZone('http://localhost:8080', 'lol', 'token', {
      modifierZoneKey: 'damage_pre_defense', ...body
    });
    await updateModifierZone('http://localhost:8080', 'lol', 'damage_pre_defense', 'token', body);
    await deleteModifierZone('http://localhost:8080', 'lol', 'damage_pre_defense', 'token');
    expect(calls.map((item) => item.method)).toEqual(['POST', 'PUT', 'DELETE']);
    expect(calls[1]?.body).not.toHaveProperty('modifierZoneKey');
  });

  it('strictly parses RATIO_MAX and rejects unknown or illegal combinations without guessing', () => {
    const ratioMax = {
      ...zone, modifierZoneKey: 'grievous', name: '重伤', domain: 'HEALING',
      calculationMode: 'RATIO_MAX', applicationStage: 'HEALING_RESULT'
    };
    expect(parseModifierZone(ratioMax).calculationMode).toBe('RATIO_MAX');
    expect(() => parseModifierZone({ ...ratioMax, calculationMode: 'UNKNOWN' })).toThrow('计算方式');
    expect(() => parseModifierZone({ ...ratioMax, calculationMode: undefined })).toThrow('计算方式');
    expect(() => parseModifierZone({ ...ratioMax, domain: 'DAMAGE' })).toThrow('组合不合法');
    expect(() => parseModifierZone({ items: [ratioMax], total: 1 })).toThrow('计算方式');
  });

  it('list rejects the whole catalog when any item has an unknown mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {
      items: [{ ...zone, calculationMode: 'TAKE_MAX' }], total: 1
    })));
    await expect(listModifierZones('http://localhost:8080', 'lol', 'token')).rejects.toThrow('计算方式');
  });
});
