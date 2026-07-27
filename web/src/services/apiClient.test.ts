import { afterEach, describe, expect, it, vi } from 'vitest';
import { putImage } from './apiClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('apiClient.putImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('PUTs encoded URI path with Bearer token and imageBase64 body', async () => {
    const asset = {
      uri: 'character_vayne',
      imageBase64: 'data:image/png;base64,abc',
      updatedAt: '2026-07-18T00:00:00Z'
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo/images/character_vayne'
      );
      expect(init?.method).toBe('PUT');

      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer admin-token-1');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('Accept')).toBe('application/json');

      expect(JSON.parse(String(init?.body))).toEqual({
        imageBase64: 'data:image/png;base64,abc'
      });

      return jsonResponse(200, asset);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await putImage(
      'http://localhost:8080',
      'demo',
      'character_vayne',
      'admin-token-1',
      'data:image/png;base64,abc'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(200);
    expect(result.data).toEqual(asset);
  });

  it('encodes URI into the admin images path segment', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        `http://localhost:8080/api/admin/games/demo/images/${encodeURIComponent('item.2510_test-1')}`
      );
      return jsonResponse(200, {
        uri: 'item.2510_test-1',
        imageBase64: 'data:image/png;base64,xyz',
        updatedAt: '2026-07-18T01:00:00Z'
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await putImage(
      'http://localhost:8080',
      'demo',
      'item.2510_test-1',
      'token',
      'data:image/png;base64,xyz'
    );

    expect(result.data.uri).toBe('item.2510_test-1');
  });
});
