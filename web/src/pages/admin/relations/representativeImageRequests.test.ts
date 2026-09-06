import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTableRepresentativeImage } from './representativeImageRequests';

const read = (key: string, signal = new AbortController().signal) =>
  readTableRepresentativeImage('http://localhost:8080', 'lol', { kind: 'skill', key, name: key }, 'local-entry', signal);
const response = () => new Response(JSON.stringify({ image: null }), { status: 200 });
afterEach(() => { vi.unstubAllGlobals(); });

describe('table representative image requests', () => {
  it('loads 900 rows with at most six in flight, including after a failed request', async () => {
    let active = 0;
    let peak = 0;
    let finished = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 0));
      active -= 1;
      finished += 1;
      if (url.includes('/skill_7/')) throw new Error('读取失败样例');
      return response();
    }));
    const results = await Promise.allSettled(Array.from({ length: 900 }, (_, i) => read(`skill_${i}`)));
    expect(peak).toBe(6);
    expect(finished).toBe(900);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(899);
    expect(results[7].status).toBe('rejected');
  });

  it('cancels queued rows without fetching and aborts active rows before serving a new list', async () => {
    const controllers = Array.from({ length: 900 }, () => new AbortController());
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
      const signal = options.signal!;
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      if (_url.includes('/new_')) resolve(response());
    }));
    vi.stubGlobal('fetch', fetchMock);
    const previous = Promise.allSettled(controllers.map((controller, i) => read(`old_${i}`, controller.signal)));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(6);
    controllers.forEach(controller => controller.abort());
    const next = await Promise.all(Array.from({ length: 5 }, (_, i) => read(`new_${i}`)));
    expect((await previous).every(result => result.status === 'rejected')).toBe(true);
    expect(next).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });

  it('does not reuse old relations when the same row is refreshed', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response(JSON.stringify({
      image: { imageKey: 'replacement', name: '新图片', enabled: true }
    })));
    vi.stubGlobal('fetch', fetchMock);
    expect((await read('same')).data.image).toBeNull();
    expect((await read('same')).data.image?.imageKey).toBe('replacement');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
