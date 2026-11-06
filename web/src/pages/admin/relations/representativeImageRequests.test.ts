import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTableRepresentativeImage } from './representativeImageRequests';

const read = (key: string, signal = new AbortController().signal) =>
  readTableRepresentativeImage('http://localhost:8080', 'lol', { kind: 'skill', key, name: key }, signal);
const response = () => new Response(JSON.stringify({ image: null }), { status: 200 });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('table representative image requests', () => {
  it('loads 900 rows with at most six in flight, including after a failed request', async () => {
    vi.useFakeTimers();
    const failure = new Error('读取失败样例');
    let active = 0;
    let peak = 0;
    let finished = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 0));
      active -= 1;
      finished += 1;
      if (url.includes('/skill_7/')) throw failure;
      return response();
    }));
    const pending = Promise.allSettled(Array.from({ length: 900 }, (_, i) => read(`skill_${i}`)));
    await vi.runAllTimersAsync();
    const results = await pending;
    expect(peak).toBe(6);
    expect(finished).toBe(900);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(899);
    expect(results[7]).toEqual({ status: 'rejected', reason: failure });
  });

  it('cancels queued rows without fetching and aborts active rows before serving a new list', async () => {
    const controllers = Array.from({ length: 900 }, () => new AbortController());
    let signalFirstWave!: () => void;
    const firstWave = new Promise<void>(resolve => { signalFirstWave = resolve; });
    let started = 0;
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
      const signal = options.signal!;
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      if (++started === 6) signalFirstWave();
      if (_url.includes('/new_')) resolve(response());
    }));
    vi.stubGlobal('fetch', fetchMock);
    const previous = Promise.allSettled(controllers.map((controller, i) => read(`old_${i}`, controller.signal)));
    try {
      await firstWave;
      expect(fetchMock).toHaveBeenCalledTimes(6);
      controllers.forEach(controller => controller.abort());
      const next = await Promise.all(Array.from({ length: 5 }, (_, i) => read(`new_${i}`)));
      expect((await previous).map(result => result.status)).toEqual(Array(900).fill('rejected'));
      expect(next).toHaveLength(5);
      expect(fetchMock).toHaveBeenCalledTimes(11);
    } finally {
      controllers.forEach(controller => controller.abort());
      await previous;
    }
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
