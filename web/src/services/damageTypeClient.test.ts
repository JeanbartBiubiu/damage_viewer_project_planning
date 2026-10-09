import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnconfirmedDamageTypeFormulaWriteError,
  createDamageType,
  deleteDamageType,
  deleteDamageTypeFormula,
  getDamageType,
  getDamageTypeFormula,
  listDamageTypes,
  parseDamageType,
  parseDamageTypeFormulaDetail,
  updateDamageType,
  updateDamageTypeFormula
} from './damageTypeClient';
import { ApiRequestError } from './apiClient';
import type { DamageType } from '../types/damageType';
import type { DamageTypeFormula, DamageTypeFormulaNode } from '../types/damageTypeFormula';


function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function damageType(formulaConfigured: boolean, overrides: Partial<DamageType> = {}): DamageType {
  return {
    gameId: 'demo',
    damageTypeKey: 'physical',
    name: '物理伤害',
    description: null,
    status: 'ENABLED',
    sortOrder: 10,
    formulaConfigured,
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
    ...overrides
  };
}

function fixed(value: number): DamageTypeFormulaNode { return { op: 'const', value: String(value) }; }
function formulaWith(expression: DamageTypeFormulaNode): DamageTypeFormula {
  return { inputs: [], stages: [{ key: 'factor', name: '倍率', expression }], outputStageKey: 'factor' };
}
function formulaDetail(formula: DamageTypeFormula, gameId = 'demo', damageTypeKey = 'physical/bonus') {
  return { gameId, damageTypeKey, formula, updatedAt: '2026-09-27T01:00:00Z' };
}

describe('damageTypeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encodes game, key and normalized list query', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/admin/games/demo%20arena/damage-types');
      expect(url.searchParams.get('keyword')).toBe('物理/+');
      expect(url.searchParams.get('status')).toBe('ENABLED');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(200, { items: [], total: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await listDamageTypes('http://localhost:8080/', 'demo arena', 'token', {
      keyword: ' 物理/+ ',
      status: 'ENABLED'
    });
  });

  it('parses formulaConfigured and rejects a response that omits it', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo/damage-types/physical%2Fbonus'
      );
      return jsonResponse(200, damageType(true, { damageTypeKey: 'physical/bonus' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const loaded = await getDamageType('http://localhost:8080', 'demo', 'physical/bonus', 'token');
    expect(loaded.data.formulaConfigured).toBe(true);

    const incomplete = damageType(false);
    const { formulaConfigured: _ignored, ...withoutFlag } = incomplete;
    expect(() => parseDamageType(withoutFlag)).toThrow(/formulaConfigured/);
    expect(() => parseDamageType({ ...incomplete, formulaConfigured: 'false' })).toThrow(/formulaConfigured/);
    expect(() => parseDamageType({})).toThrow(/不完整/);
  });

  it('sends POST, full PUT without formula fields, and DELETE', async () => {
    const calls: Array<{ method: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      if (init?.method === 'DELETE') return jsonResponse(204, null);
      return jsonResponse(init?.method === 'POST' ? 201 : 200, damageType(false));
    });
    vi.stubGlobal('fetch', fetchMock);

    await createDamageType('http://localhost:8080', 'demo', 'token', {
      damageTypeKey: 'physical',
      name: '物理伤害',
      description: null,
      status: 'ENABLED',
      sortOrder: 10,
      ...({ formulaConfigured: true, formula: { resistanceBeforePenetration: fixed(1) } } as object)
    });
    await updateDamageType('http://localhost:8080', 'demo', 'physical', 'token', {
      name: '物理伤害',
      description: null,
      status: 'DISABLED',
      sortOrder: 20,
      ...({ formulaConfigured: false, formula: formulaWith(fixed(1)) } as object)
    });
    const deleted = await deleteDamageType('http://localhost:8080', 'demo', 'physical', 'token');

    expect(calls.map((call) => call.method)).toEqual(['POST', 'PUT', 'DELETE']);
    expect(calls[0]?.body).toEqual({
      damageTypeKey: 'physical',
      name: '物理伤害',
      description: null,
      status: 'ENABLED',
      sortOrder: 10
    });
    expect(calls[1]?.body).toEqual({
      name: '物理伤害',
      description: null,
      status: 'DISABLED',
      sortOrder: 20
    });
    expect(calls[1]?.body).not.toHaveProperty('damageTypeKey');
    expect(calls[1]?.body).not.toHaveProperty('formula');
    expect(calls[1]?.body).not.toHaveProperty('formulaConfigured');
    expect(deleted.status).toBe(204);
    expect(deleted.data).toBeNull();
  });

  it('encodes the formula path and preserves the complete common definition and decimal text', async () => {
    const formula: DamageTypeFormula = {
      inputs: [{ key: 'armor', binding: { kind: 'attribute', object: 'target', attributeKey: 'armor', valueKind: 'TOTAL', view: 'current_frame' } }],
      stages: [
        { key: 'factor', name: '倍率', expression: { op: 'add', args: [{ op: 'read', inputKey: 'armor' }, { op: 'ref', stageKey: 'base' }] } },
        { key: 'base', name: '常量', expression: { op: 'const', value: '1.000' } }
      ], outputStageKey: 'factor'
    };
    const detail = formulaDetail(formula, 'demo arena', 'physical/bonus');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo%20arena/damage-types/physical%2Fbonus/formula'
      );
      expect(init?.method ?? 'GET').toBe('GET');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(200, detail);
    });
    vi.stubGlobal('fetch', fetchMock);

    const loaded = await getDamageTypeFormula(
      'http://localhost:8080/',
      'demo arena',
      'physical/bonus',
      'token'
    );
    expect(loaded.data.formula).toEqual(formula);
    expect(Object.keys(loaded.data)).toEqual(['gameId', 'damageTypeKey', 'formula', 'updatedAt']);
  });

  it('puts only formula and deletes the formula resource', async () => {
    const formula = formulaWith(fixed(2));
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      if (method === 'DELETE') return jsonResponse(204, null);
      return jsonResponse(200, formulaDetail(formula, 'demo', 'physical'));
    });
    vi.stubGlobal('fetch', fetchMock);

    await updateDamageTypeFormula('http://localhost:8080', 'demo', 'physical', 'token', { formula });
    const deleted = await deleteDamageTypeFormula('http://localhost:8080', 'demo', 'physical', 'token');

    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: 'http://localhost:8080/api/admin/games/demo/damage-types/physical/formula',
      body: { formula }
    });
    expect(Object.keys(calls[0]?.body as object)).toEqual(['formula']);
    expect(calls[1]?.method).toBe('DELETE');
    expect(deleted.status).toBe(204);
  });

  it('marks network and server failures as unconfirmed writes but preserves client errors', async () => {
    const formula = formulaWith(fixed(2));

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network interrupted');
    }));
    await expect(updateDamageTypeFormula(
      'http://localhost:8080',
      'demo',
      'physical',
      'token',
      { formula }
    )).rejects.toBeInstanceOf(UnconfirmedDamageTypeFormulaWriteError);
    await expect(deleteDamageTypeFormula(
      'http://localhost:8080',
      'demo',
      'physical',
      'token'
    )).rejects.toBeInstanceOf(UnconfirmedDamageTypeFormulaWriteError);

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, {
      error: { code: '500.INTERNAL_ERROR', message: '服务端错误' }
    })));
    await expect(updateDamageTypeFormula(
      'http://localhost:8080',
      'demo',
      'physical',
      'token',
      { formula }
    )).rejects.toBeInstanceOf(UnconfirmedDamageTypeFormulaWriteError);

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(400, {
      error: { code: '400.VALIDATION_FAILED', message: '公式不合法' }
    })));
    const clientFailure = updateDamageTypeFormula(
      'http://localhost:8080',
      'demo',
      'physical',
      'token',
      { formula }
    );
    await expect(clientFailure).rejects.toBeInstanceOf(ApiRequestError);
    await expect(clientFailure).rejects.not.toBeInstanceOf(UnconfirmedDamageTypeFormulaWriteError);
  });

  it('preserves the exact missing-formula error and rejects illegal formula responses', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(404, {
      error: { code: '404.DAMAGE_TYPE_FORMULA_NOT_FOUND', message: '尚未配置结算公式' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getDamageTypeFormula('http://localhost:8080', 'demo', 'physical', 'token'))
      .rejects.toMatchObject({ status: 404, code: '404.DAMAGE_TYPE_FORMULA_NOT_FOUND' });

    const expected = { gameId: 'demo', damageTypeKey: 'physical' };
    expect(() => parseDamageTypeFormulaDetail(formulaDetail(formulaWith({ nodeType: 'FIXED', value: 1 } as unknown as DamageTypeFormulaNode), 'demo', 'physical'), expected))
      .toThrow(/FORMULA_INVALID_STRUCTURE/);
    expect(() => parseDamageTypeFormulaDetail({ ...formulaDetail(formulaWith(fixed(1)), 'demo', 'physical'), extra: true }, expected)).toThrow(/不完整/);
    expect(() => parseDamageTypeFormulaDetail(formulaDetail(formulaWith(fixed(1)), 'other', 'physical'), expected)).toThrow(/不一致/);
    const unknown = formulaWith({ op: 'ref', stageKey: 'missing' });
    expect(() => parseDamageTypeFormulaDetail(formulaDetail(unknown, 'demo', 'physical'), expected)).toThrow(/FORMULA_UNKNOWN_STAGE/);
    const cycle = formulaWith({ op: 'ref', stageKey: 'factor' });
    expect(() => parseDamageTypeFormulaDetail(formulaDetail(cycle, 'demo', 'physical'), expected)).toThrow(/FORMULA_CYCLE/);
    const unauthorized = formulaWith(fixed(1));
    unauthorized.inputs.push({ key: 'unapproved', binding: { kind: 'context', contextKey: 'raw_damage' } });
    expect(() => parseDamageTypeFormulaDetail(formulaDetail(unauthorized, 'demo', 'physical'), expected)).toThrow(/FORMULA_UNKNOWN_BINDING/);
    const old = { resistanceBeforePenetration: fixed(0), penetrationPercent: fixed(0), penetrationFlat: fixed(0), effectiveResistance: fixed(0), resistanceFactor: fixed(1) };
    expect(() => parseDamageTypeFormulaDetail(formulaDetail(old as unknown as DamageTypeFormula, 'demo', 'physical'), expected)).toThrow(/FORMULA_INVALID_STRUCTURE/);
  });
  it('rejects formula trees beyond 32 levels or 256 nodes', () => {
    const expected = { gameId: 'demo', damageTypeKey: 'physical' };
    let deep: DamageTypeFormulaNode = fixed(1);
    for (let depth = 2; depth <= 33; depth += 1) {
      deep = { op: 'add', args: [deep, fixed(1)] };
    }
    expect(() => parseDamageTypeFormulaDetail(
      formulaDetail(formulaWith(deep), 'demo', 'physical'),
      expected
    )).toThrow(/FORMULA_LIMIT/);

    const wide = wideTree(257);
    expect(() => parseDamageTypeFormulaDetail(
      formulaDetail(formulaWith(wide), 'demo', 'physical'),
      expected
    )).toThrow(/FORMULA_LIMIT/);
    expect(parseDamageTypeFormulaDetail(
      formulaDetail(formulaWith(wideTree(255)), 'demo', 'physical'),
      expected
    ).formula.stages[0]!.expression.op).toBe('add');

  });
});

function wideTree(count: number): DamageTypeFormulaNode {
  if (count === 1) return fixed(1);
  const rest = count - 1;
  const leftCount = rest / 2 % 2 === 1 ? rest / 2 : rest / 2 - 1;
  return {
    op: 'add',
    args: [wideTree(leftCount), wideTree(rest - leftCount)]
  };
}
