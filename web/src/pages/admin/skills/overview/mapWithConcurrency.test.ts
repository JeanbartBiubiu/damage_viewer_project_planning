import { describe, expect, it, vi } from 'vitest';
import { mapWithConcurrency } from './mapWithConcurrency';

describe('mapWithConcurrency', () => {
  it('never starts more than the declared number of tasks at once and keeps individual failures', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithConcurrency([30, 10, 20, 15, 5, 8], 4, async (wait, index) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, wait));
      running -= 1;
      if (index === 2) throw new Error(`fail-${index}`);
      return index;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(results.map((item) => item.status)).toEqual([
      'fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled'
    ]);
    expect(results[2]).toMatchObject({ status: 'rejected' });
    expect(results[0]).toEqual({ status: 'fulfilled', value: 0 });
  });

  it('does not treat an empty list as a failed batch', async () => {
    const mapper = vi.fn();
    expect(await mapWithConcurrency([], 4, mapper)).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });
});
