import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModifierZone, deleteModifierZone, listModifierZones, updateModifierZone } from './modifierZoneClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

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
      return jsonResponse(init?.method === 'DELETE' ? 204 : init?.method === 'POST' ? 201 : 200, {});
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
});
