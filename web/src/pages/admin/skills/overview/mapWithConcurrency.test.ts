import { describe, expect, it, vi } from 'vitest';
import { mapWithConcurrency } from './mapWithConcurrency';

describe('mapWithConcurrency', () => {
  it('never starts more than the declared number of tasks at once and keeps individual failures', async () => {
    const gates = Array.from({ length: 6 }, () => {
      let release!: () => void;
      const promise = new Promise<void>(resolve => { release = resolve; });
      return { promise, release };
    });
    const starts = Array.from({ length: 6 }, () => {
      let signal!: () => void;
      const promise = new Promise<void>(resolve => { signal = resolve; });
      return { promise, signal };
    });
    const started: number[] = [];
    const failure = new Error('fail-2');
    let running = 0;
    let peak = 0;
    const pending = mapWithConcurrency([10, 20, 30, 40, 50, 60], 4, async (value, index) => {
      started.push(index);
      running += 1;
      peak = Math.max(peak, running);
      starts[index]!.signal();
      await gates[index]!.promise;
      running -= 1;
      if (index === 2) throw failure;
      return value;
    });
    try {
      expect(started).toEqual([0, 1, 2, 3]);
      expect(running).toBe(4);
      gates[2]!.release();
      await starts[4]!.promise;
      expect(started).toEqual([0, 1, 2, 3, 4]);
      expect(running).toBe(4);
      gates[0]!.release();
      await starts[5]!.promise;
      expect(started).toEqual([0, 1, 2, 3, 4, 5]);
      for (const index of [5, 3, 4, 1]) gates[index]!.release();
      expect(await pending).toEqual([
        { status: 'fulfilled', value: 10 }, { status: 'fulfilled', value: 20 },
        { status: 'rejected', reason: failure }, { status: 'fulfilled', value: 40 },
        { status: 'fulfilled', value: 50 }, { status: 'fulfilled', value: 60 }
      ]);
      expect(peak).toBe(4);
      expect(running).toBe(0);
    } finally {
      gates.forEach(gate => gate.release());
      await pending;
    }
  });

  it('does not treat an empty list as a failed batch', async () => {
    const mapper = vi.fn();
    expect(await mapWithConcurrency([], 4, mapper)).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });
});
