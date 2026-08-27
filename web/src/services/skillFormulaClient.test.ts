import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSkillFormula,
  deleteSkillFormula,
  getSkillFormula,
  listSkillFormulas,
  updateSkillFormula
} from './skillFormulaClient';
import type { FormulaExpressionNode, SkillFormula, SkillFormulaSummary } from '../types/skillFormula';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const expression: FormulaExpressionNode = {
  nodeType: 'OPERATION',
  operation: 'MULTIPLY',
  operands: [
    {
      nodeType: 'ATTRIBUTE',
      attributeOwner: 'TARGET',
      attributeKey: 'hp',
      attributeValueKind: 'MISSING'
    },
    {
      nodeType: 'PARAMETER',
      parameterKey: 'missing_health_ratio'
    }
  ]
};

describe('skillFormulaClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encodes path segments and separates summary/detail types', async () => {
    const summary: SkillFormulaSummary = {
      gameId: 'demo',
      skillKey: 'varus_w',
      formulaKey: 'missing_health_damage',
      name: '已损失生命值伤害',
      description: null,
      sortOrder: 10,
      createdAt: '2026-08-26T00:00:00Z',
      updatedAt: '2026-08-26T00:00:00Z'
    };
    const detail: SkillFormula = { ...summary, expression };

    const listMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo%20arena/skills/active%2Fw/formulas'
      );
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(200, [summary]);
    });
    vi.stubGlobal('fetch', listMock);
    const listed = await listSkillFormulas('http://localhost:8080/', 'demo arena', 'active/w', 'token');
    expect(listed.data[0]).not.toHaveProperty('expression');

    const detailMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo/skills/varus_w/formulas/missing%2Fhealth'
      );
      return jsonResponse(200, detail);
    });
    vi.stubGlobal('fetch', detailMock);
    const loaded = await getSkillFormula(
      'http://localhost:8080',
      'demo',
      'varus_w',
      'missing/health',
      'token'
    );
    expect(loaded.data.expression).toEqual(expression);
  });

  it('sends POST/PUT/DELETE bodies and omits formulaKey on PUT', async () => {
    const calls: Array<{ method: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      return jsonResponse(method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    await createSkillFormula('http://localhost:8080', 'demo', 'varus_w', 'token', {
      formulaKey: 'missing_health_damage',
      name: '已损失生命值伤害',
      description: null,
      sortOrder: 10,
      expression
    });
    await updateSkillFormula(
      'http://localhost:8080',
      'demo',
      'varus_w',
      'missing_health_damage',
      'token',
      {
        name: '已损失生命值伤害',
        description: null,
        sortOrder: 11,
        expression
      }
    );
    await deleteSkillFormula(
      'http://localhost:8080',
      'demo',
      'varus_w',
      'missing_health_damage',
      'token'
    );

    expect(calls.map((call) => call.method)).toEqual(['POST', 'PUT', 'DELETE']);
    expect(calls[0]?.body).toMatchObject({
      formulaKey: 'missing_health_damage',
      expression
    });
    expect(calls[1]?.body).not.toHaveProperty('formulaKey');
    expect(calls[1]?.body).toMatchObject({ sortOrder: 11, expression });
    expect(calls[2]?.body).toBeNull();
  });
});
