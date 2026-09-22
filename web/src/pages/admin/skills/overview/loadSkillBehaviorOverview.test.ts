import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSkillBehaviorOverview, SKILL_BEHAVIOR_DETAIL_CONCURRENCY, overviewIncompleteReasons } from './loadSkillBehaviorOverview';

vi.mock('../../../../services/skillParameterClient', () => ({ listSkillParameters: vi.fn() }));
vi.mock('../../../../services/skillFormulaClient', () => ({ listSkillFormulas: vi.fn() }));
vi.mock('../../../../services/skillEffectClient', () => ({ listSkillEffects: vi.fn(), getSkillEffect: vi.fn() }));
vi.mock('../../../../services/skillProcessClient', () => ({ listSkillProcesses: vi.fn(), getSkillProcess: vi.fn() }));
vi.mock('../../../../services/skillInternalStateClient', () => ({ listSkillInternalStates: vi.fn(), getSkillInternalState: vi.fn() }));
vi.mock('../../../../services/skillTriggerRuleClient', () => ({ listSkillTriggerRules: vi.fn(), getSkillTriggerRule: vi.fn() }));

import { listSkillParameters } from '../../../../services/skillParameterClient';
import { listSkillFormulas } from '../../../../services/skillFormulaClient';
import { getSkillEffect, listSkillEffects } from '../../../../services/skillEffectClient';
import { getSkillProcess, listSkillProcesses } from '../../../../services/skillProcessClient';
import { getSkillInternalState, listSkillInternalStates } from '../../../../services/skillInternalStateClient';
import { getSkillTriggerRule, listSkillTriggerRules } from '../../../../services/skillTriggerRuleClient';

const listFns = [
  listSkillParameters, listSkillFormulas, listSkillEffects, listSkillProcesses,
  listSkillInternalStates, listSkillTriggerRules
] as const;

function ok<T>(data: T) {
  return Promise.resolve({ data, status: 200, etag: null });
}

describe('loadSkillBehaviorOverview', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('keeps successful details when another detail fails and distinguishes that from a true empty list', async () => {
    vi.mocked(listSkillParameters).mockResolvedValue({ data: [], status: 200, etag: null });
    vi.mocked(listSkillFormulas).mockResolvedValue({ data: [], status: 200, etag: null });
    vi.mocked(listSkillInternalStates).mockResolvedValue({ data: [], status: 200, etag: null });
    vi.mocked(listSkillProcesses).mockResolvedValue({ data: [], status: 200, etag: null });
    vi.mocked(listSkillTriggerRules).mockResolvedValue({ data: [], status: 200, etag: null });
    vi.mocked(listSkillEffects).mockResolvedValue({
      data: [
        { effectKey: 'ok', name: '成功', resultCount: 0, lifecycleEnabled: false } as never,
        { effectKey: 'bad', name: '失败', resultCount: 0, lifecycleEnabled: false } as never
      ],
      status: 200, etag: null
    });
    vi.mocked(getSkillEffect).mockImplementation(async (_base, _game, _skill, key) => {
      if (key === 'bad') throw new Error('效果详情失败');
      return { data: { effectKey: key, name: '成功', results: [] } as never, status: 200, etag: null };
    });

    const partial = await loadSkillBehaviorOverview({
      apiBaseUrl: 'http://overview.test', gameId: 'demo', skillKey: 'q', token: 't', generation: 1
    });
    expect(partial?.effects.details.map((item) => item.effectKey)).toEqual(['ok']);
    expect(partial?.effects.failedKeys).toEqual(['bad']);
    expect(partial?.complete).toBe(false);
    expect(overviewIncompleteReasons(partial!)).toContain('效果详情未完整：bad');

    vi.mocked(listSkillEffects).mockResolvedValue({ data: [], status: 200, etag: null });
    const empty = await loadSkillBehaviorOverview({
      apiBaseUrl: 'http://overview.test', gameId: 'demo', skillKey: 'q', token: 't', generation: 2
    });
    expect(empty?.effects.listError).toBeNull();
    expect(empty?.effects.details).toEqual([]);
    expect(empty?.effects.failedKeys).toEqual([]);
    expect(empty?.complete).toBe(true);
  });

  it('does not hide a list failure behind an empty array', async () => {
    for (const fn of listFns) vi.mocked(fn).mockResolvedValue({ data: [], status: 200, etag: null });
    vi.mocked(listSkillProcesses).mockRejectedValue(new Error('过程列表失败'));
    const bundle = await loadSkillBehaviorOverview({
      apiBaseUrl: 'http://overview.test', gameId: 'demo', skillKey: 'q', token: 't', generation: 3
    });
    expect(bundle?.processes.listError).toContain('过程列表失败');
    expect(bundle?.processes.summaries).toEqual([]);
    expect(getSkillProcess).not.toHaveBeenCalled();
    expect(bundle?.complete).toBe(false);
  });

  it('caps detail fetches at four concurrent requests', async () => {
    for (const fn of listFns) vi.mocked(fn).mockResolvedValue({ data: [], status: 200, etag: null });
    vi.mocked(listSkillEffects).mockResolvedValue({
      data: Array.from({ length: 6 }, (_, index) => ({ effectKey: `e${index}`, name: `e${index}`, resultCount: 0, lifecycleEnabled: false })) as never,
      status: 200, etag: null
    });
    let running = 0;
    let peak = 0;
    vi.mocked(getSkillEffect).mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return ok({ effectKey: 'e', name: 'e', results: [] } as never);
    });
    await loadSkillBehaviorOverview({
      apiBaseUrl: 'http://overview.test', gameId: 'demo', skillKey: 'q', token: 't', generation: 4
    });
    expect(peak).toBe(SKILL_BEHAVIOR_DETAIL_CONCURRENCY);
    expect(getSkillEffect).toHaveBeenCalledTimes(6);
  });

  it('drops a finished payload after the request generation has been replaced', async () => {
    for (const fn of listFns) vi.mocked(fn).mockResolvedValue({ data: [], status: 200, etag: null });
    let current = 8;
    const pending = loadSkillBehaviorOverview({
      apiBaseUrl: 'http://overview.test', gameId: 'demo', skillKey: 'q', token: 't', generation: 8
    }, (generation) => generation === current);
    current = 9;
    expect(await pending).toBeNull();
  });
});
