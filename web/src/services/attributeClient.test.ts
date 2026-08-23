import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './apiClient';
import {
  createAttribute,
  getAttribute,
  listAttributes,
  updateAttribute
} from './attributeClient';
import type {
  Attribute,
  CreateAttributeRequest,
  UpdateAttributeRequest
} from '../types/attribute';

const ATTRIBUTE: Attribute = {
  gameId: 'demo',
  attributeKey: 'move_speed',
  name: '移动速度',
  valueType: 'DECIMAL',
  minValue: 0,
  maxValue: null,
  description: '角色面板移动速度',
  status: 'ENABLED',
  sortOrder: 100,
  createdAt: '2026-08-22T09:00:00Z',
  updatedAt: '2026-08-22T09:00:00Z'
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('attributeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists attributes with normalized query parameters', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/admin/games/demo%20arena/attributes');
      expect(url.searchParams.get('keyword')).toBe('移动 速度/+');
      expect(url.searchParams.get('status')).toBe('DISABLED');
      expect([...url.searchParams.keys()]).toEqual(['keyword', 'status']);
      expect(url.pathname).not.toContain('combat-data');
      expect(init?.method).toBeUndefined();
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer admin-token');
      return jsonResponse(200, { items: [ATTRIBUTE], total: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listAttributes(
      'http://localhost:8080/',
      'demo arena',
      'admin-token',
      { keyword: '  移动 速度/+  ', status: 'DISABLED' }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ items: [ATTRIBUTE], total: 1 });
  });

  it('omits an empty keyword instead of sending an empty query value', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://localhost:8080/api/admin/games/demo/attributes');
      return jsonResponse(200, { items: [], total: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await listAttributes('http://localhost:8080', 'demo', 'token', { keyword: '   ' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gets an attribute with its key encoded as one path segment', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo/attributes/armor%2Fpenetration'
      );
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(200, ATTRIBUTE);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getAttribute(
      'http://localhost:8080',
      'demo',
      'armor/penetration',
      'token'
    );

    expect(result.data).toEqual(ATTRIBUTE);
  });

  it('creates an attribute with POST and the complete request body', async () => {
    const body: CreateAttributeRequest = {
      attributeKey: 'move_speed',
      name: '移动速度',
      valueType: 'DECIMAL',
      minValue: 0,
      maxValue: null,
      description: null,
      status: 'ENABLED',
      sortOrder: 100
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8080/api/admin/games/demo/attributes');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
      expect(JSON.parse(String(init?.body))).toEqual(body);
      return jsonResponse(201, ATTRIBUTE);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createAttribute(
      'http://localhost:8080',
      'demo',
      'token',
      body
    );

    expect(result.status).toBe(201);
    expect(result.data.attributeKey).toBe('move_speed');
  });

  it('updates an attribute with a full PUT body and no mutable attribute key', async () => {
    const body: UpdateAttributeRequest = {
      name: '移动速度（已停用）',
      valueType: 'DECIMAL',
      minValue: null,
      maxValue: 1000,
      description: null,
      status: 'DISABLED',
      sortOrder: 110
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo/attributes/move_speed'
      );
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(String(init?.body))).toEqual(body);
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('attributeKey');
      return jsonResponse(200, { ...ATTRIBUTE, ...body });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await updateAttribute(
      'http://localhost:8080',
      'demo',
      'move_speed',
      'token',
      body
    );

    expect(result.data.status).toBe('DISABLED');
  });

  it.each([
    {
      status: 400,
      code: '400.VALIDATION_FAILED',
      message: '属性信息不合法',
      details: {
        fieldIssues: [
          { field: 'maxValue', code: 'RANGE_INVALID', message: '最大值不能小于最小值' }
        ]
      }
    },
    {
      status: 404,
      code: '404.ATTRIBUTE_NOT_FOUND',
      message: '属性不存在',
      details: {}
    },
    {
      status: 409,
      code: '409.ATTRIBUTE_NAME_EXISTS',
      message: '属性名称已存在',
      details: {}
    }
  ])('preserves stable $status $code errors without a legacy fallback', async (payload) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/api/admin/games/demo/attributes');
      expect(String(input)).not.toContain('/combat-data/');
      expect(String(input)).not.toContain('/resource-definitions');
      return jsonResponse(payload.status, { error: payload });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAttribute('http://localhost:8080', 'demo', 'missing', 'token')).rejects.toMatchObject<
      Partial<ApiRequestError>
    >({
      name: 'ApiRequestError',
      status: payload.status,
      code: payload.code,
      message: payload.message,
      details: payload.details
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
