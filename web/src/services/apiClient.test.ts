import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, getErrorMessage, listGames, requestJson } from './apiClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('apiClient.listGames', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps gameId, gameName and nullable representativeImageKey', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://localhost:8080/api/games');
      return jsonResponse(200, [
        { gameId: 'lol', gameName: '英雄联盟', representativeImageKey: 'lol.png' },
        { gameId: 'demo', gameName: 'Demo Arena', representativeImageKey: null }
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listGames('http://localhost:8080');
    expect(result.data).toEqual([
      { gameId: 'lol', gameName: '英雄联盟', representativeImageKey: 'lol.png' },
      { gameId: 'demo', gameName: 'Demo Arena', representativeImageKey: null }
    ]);
  });

  it('drops progressionSchema and missing representativeImageKey becomes null', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, [
        {
          gameId: 'lol',
          gameName: '英雄联盟',
          progressionSchema: { progressionKind: 'LEVEL', stageMin: 1, stageMax: 18 }
        }
      ])
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await listGames('http://localhost:8080');
    expect(result.data).toEqual([{ gameId: 'lol', gameName: '英雄联盟', representativeImageKey: null }]);
    expect(result.data[0]).not.toHaveProperty('progressionSchema');
  });
});

describe('apiClient 错误提示', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([undefined, null, {}, 'unexpected failure', new Error('')])('未知错误使用中文提示：%s', (error) => {
    expect(getErrorMessage(error)).toBe('发生未知错误，请稍后重试。');
  });

  it.each([
    'Failed to fetch',
    'fetch failed',
    'Network request failed',
    'Load failed',
    'NetworkError when attempting to fetch resource.'
  ])('网络错误使用中文提示并保留原始诊断：%s', (message) => {
    const error = new TypeError(message);
    const stack = error.stack;
    expect(getErrorMessage(error)).toBe('网络请求失败，请检查网络连接和 API 地址。');
    expect(error.message).toBe(message);
    expect(error.name).toBe('TypeError');
    expect(error.stack).toBe(stack);
  });

  it('保留前端明确给出的错误说明', () => {
    expect(getErrorMessage(new Error('输入值必须大于零'))).toBe('输入值必须大于零');
    expect(getErrorMessage(new Error('invalid response: missing gameId'))).toBe('invalid response: missing gameId');
  });

  it('服务端业务错误优先于通用提示，保留状态、错误码与字段问题', async () => {
    const details = {
      fieldIssues: [{ field: 'name', code: 'NAME_EXISTS', message: '名称已存在' }],
      diagnostic: 'stable-server-diagnostic'
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409, {
      error: { code: '409.NAME_EXISTS', message: 'Failed to fetch', details }
    })));

    const error = await requestJson('http://localhost:8080', '/api/example').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, code: '409.NAME_EXISTS', message: 'Failed to fetch', details });
    expect(getErrorMessage(error)).toBe('409.NAME_EXISTS: Failed to fetch');
  });

  it.each([
    { body: null, contentType: 'application/json' },
    { body: '<h1>Bad Gateway</h1>', contentType: 'text/html' },
    { body: JSON.stringify({ error: { code: '502.UPSTREAM', details: { diagnostic: 'upstream unavailable' } } }), contentType: 'application/json' }
  ])('无业务错误说明时使用中文并保留 HTTP 状态：$contentType $body', async ({ body, contentType }) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 502, headers: { 'Content-Type': contentType }
    })));

    const error = await requestJson('http://localhost:8080', '/api/example').catch((cause: unknown) => cause);
    expect(error).toMatchObject({ status: 502, message: '请求失败（HTTP 502）。' });
    expect(getErrorMessage(error)).toContain('请求失败（HTTP 502）。');
  });

  it('请求失败保留原始网络错误且不自动重试写入', async () => {
    const error = new TypeError('Failed to fetch');
    const fetchMock = vi.fn().mockRejectedValue(error);
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestJson('http://localhost:8080', '/api/example', {
      method: 'POST', body: JSON.stringify({ name: '示例' })
    })).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
