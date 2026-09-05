import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './apiClient';
import {
  createImage,
  getImage,
  imageFieldIssues,
  listPublicImages,
  updateImage
} from './imageClient';

const IMAGE = {
  gameId: 'demo arena',
  imageKey: 'icon/test',
  name: '测试图片',
  description: null,
  imageBase64: 'data:image/png;base64,AQID',
  mimeType: 'image/png',
  byteSize: 3,
  width: 32,
  height: 20,
  enabled: true,
  createdAt: '2026-09-05T10:00:00Z',
  updatedAt: '2026-09-05T10:00:00Z'
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('imageClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses independent detail, create and update contracts', async () => {
    const calls: Array<{ url: string; method: string; token: string | null; body: Record<string, unknown> | null }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        token: new Headers(init?.headers).get('Authorization'),
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
      });
      return jsonResponse(init?.method === 'POST' ? 201 : 200, IMAGE);
    });
    vi.stubGlobal('fetch', fetchMock);

    await getImage('http://localhost:8080', 'demo arena', 'icon/test', 'token');
    await createImage('http://localhost:8080', 'demo arena', 'token', {
      imageKey: 'icon/test',
      name: '测试图片',
      description: null,
      imageBase64: IMAGE.imageBase64
    });
    await updateImage('http://localhost:8080', 'demo arena', 'icon/test', 'token', {
      name: '测试图片二',
      description: '说明',
      enabled: false
    });

    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'PUT']);
    expect(calls.map((call) => call.token)).toEqual(['Bearer token', 'Bearer token', 'Bearer token']);
    expect(calls[0]?.url).toBe('http://localhost:8080/api/admin/games/demo%20arena/images/icon%2Ftest');
    expect(calls[1]?.body).toEqual({
      imageKey: 'icon/test',
      name: '测试图片',
      description: null,
      imageBase64: IMAGE.imageBase64
    });
    expect(calls[2]?.body).toEqual({
      name: '测试图片二',
      description: '说明',
      enabled: false
    });
    expect(calls[2]?.body).not.toHaveProperty('imageBase64');
  });

  it('normalizes public incremental responses and encodes the timestamp once', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/games/demo%20arena/images');
      expect(url.searchParams.get('updatedAfter')).toBe('2026-09-05T10:00:00.000Z');
      return jsonResponse(200, {
        gameId: 'demo arena',
        images: [{
          imageKey: 'icon',
          enabled: false,
          imageBase64: null,
          updatedAt: '2026-09-05T11:00:00Z'
        }]
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listPublicImages(
      'http://localhost:8080',
      'demo arena',
      '2026-09-05T10:00:00.000Z'
    );
    expect(result.data.images[0]).toMatchObject({ imageKey: 'icon', enabled: false, imageBase64: null });
  });

  it('rejects partial image responses instead of assembling defaults', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ...IMAGE, width: undefined })));

    await expect(getImage('http://localhost:8080', 'demo', 'icon', 'token')).rejects.toMatchObject({
      code: '502.IMAGE_RESPONSE_INVALID'
    });
  });

  it('maps backend field issues without changing their field names', () => {
    const error = new ApiRequestError('校验失败', 400, '400.VALIDATION_FAILED', {
      fieldIssues: [
        { field: 'imageKey', code: 'FORMAT_INVALID', message: '格式不合法' },
        { field: 'imageBase64', code: 'CONTENT_INVALID', message: '图片不合法' },
        { field: 1, code: 'bad', message: 'ignored' }
      ]
    });
    expect(imageFieldIssues(error)).toEqual([
      { field: 'imageKey', code: 'FORMAT_INVALID', message: '格式不合法' },
      { field: 'imageBase64', code: 'CONTENT_INVALID', message: '图片不合法' }
    ]);
  });
});
