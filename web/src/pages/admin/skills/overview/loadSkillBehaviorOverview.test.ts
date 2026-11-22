import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSkillBehaviorOverview, SKILL_BEHAVIOR_DETAIL_CONCURRENCY, overviewIncompleteReasons } from './loadSkillBehaviorOverview';

vi.mock('../../../../services/maintenance/skillParameterClient', () => ({ listSkillParameters: vi.fn() }));
vi.mock('../../../../services/maintenance/skillFormulaClient', () => ({ listSkillFormulas: vi.fn() }));
vi.mock('../../../../services/skillEffectClient', () => ({ listSkillEffects: vi.fn(), getSkillEffect: vi.fn() }));
vi.mock('../../../../services/maintenance/skillProcessClient', () => ({ listSkillProcesses: vi.fn(), getSkillProcess: vi.fn() }));
vi.mock('../../../../services/maintenance/skillInternalStateClient', () => ({ listSkillInternalStates: vi.fn(), getSkillInternalState: vi.fn() }));
vi.mock('../../../../services/skillTriggerRuleClient', () => ({ listSkillTriggerRules: vi.fn(), getSkillTriggerRule: vi.fn() }));

import { listSkillParameters } from '../../../../services/maintenance/skillParameterClient';
import { listSkillFormulas } from '../../../../services/maintenance/skillFormulaClient';
import { getSkillEffect, listSkillEffects } from '../../../../services/skillEffectClient';
import { getSkillProcess, listSkillProcesses } from '../../../../services/maintenance/skillProcessClient';
import { getSkillInternalState, listSkillInternalStates } from '../../../../services/maintenance/skillInternalStateClient';
import { getSkillTriggerRule, listSkillTriggerRules } from '../../../../services/skillTriggerRuleClient';

const listFns = [
  listSkillParameters, listSkillFormulas, listSkillEffects, listSkillProcesses,
  listSkillInternalStates, listSkillTriggerRules
] as const;

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
      apiBaseUrl: 'http://overview.test', gameId: 'demo', skillKey: 'q', generation: 1
    });
    expect(partial?.effects.details.map((item) => item.effectKey)).toEqual(['ok']);
    expect(partial?.effects.failedKeys).toEqual(['bad']);
    expect(partial?.complete).toBe(false);
    expect(overviewIncompleteReasons(partial!)).toContain('效果详情未完整：bad');

    vi.mocked(listSkillEffects).mockResolvedValue({ data: [], status: 200, etag: null });
    const empty = await loadSkillBehaviorOverview({
      apiBaseUrl: 'http://overview.test', gameId: 'demo', skillKey: 'q', generation: 2
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
      apiBaseUrl: 'http://overview.test', gameId: 'demo', skillKey: 'q', generation: 3
    });
    expect(bundle?.processes.listError).toContain('过程列表失败');
    expect(bundle?.processes.summaries).toEqual([]);
    expect(getSkillProcess).not.toHaveBeenCalled();
    expect(bundle?.complete).toBe(false);
  });

  it('按详情并发额度排队，乱序完成仍保留全部详情的原始身份与顺序', async () => {
    for (const fn of listFns) vi.mocked(fn).mockResolvedValue({ data: [], status: 200, etag: null });
    const keys = Array.from({ length: SKILL_BEHAVIOR_DETAIL_CONCURRENCY + 2 }, (_, index) => `e${index}`);
    const gates = keys.map(() => {
      let release!: () => void;
      const promise = new Promise<void>(resolve => { release = resolve; });
      return { promise, release };
    });
    const starts = keys.map(() => {
      let signal!: () => void;
      const promise = new Promise<void>(resolve => { signal = resolve; });
      return { promise, signal };
    });
    vi.mocked(listSkillEffects).mockResolvedValue({
      data: keys.map(effectKey => ({ effectKey, name: effectKey, resultCount: 0, lifecycleEnabled: false })) as never,
      status: 200, etag: null
    });
    const started: string[] = [];
    let running = 0;
    let peak = 0;
    vi.mocked(getSkillEffect).mockImplementation(async (_api, _game, _skill, key) => {
      const index = keys.indexOf(key);
      started.push(key);
      running += 1;
      peak = Math.max(peak, running);
      starts[index]!.signal();
      await gates[index]!.promise;
      running -= 1;
      return { data: { effectKey: key, name: key, results: [] } as never, status: 200, etag: null };
    });
    const pending = loadSkillBehaviorOverview({
      apiBaseUrl: 'http://overview.test', gameId: 'demo', skillKey: 'q', generation: 4
    });
    try {
      await starts[SKILL_BEHAVIOR_DETAIL_CONCURRENCY - 1]!.promise;
      expect(started).toEqual(keys.slice(0, SKILL_BEHAVIOR_DETAIL_CONCURRENCY));
      expect(running).toBe(SKILL_BEHAVIOR_DETAIL_CONCURRENCY);
      gates[SKILL_BEHAVIOR_DETAIL_CONCURRENCY - 1]!.release();
      await starts[SKILL_BEHAVIOR_DETAIL_CONCURRENCY]!.promise;
      expect(started).toEqual(keys.slice(0, SKILL_BEHAVIOR_DETAIL_CONCURRENCY + 1));
      expect(running).toBe(SKILL_BEHAVIOR_DETAIL_CONCURRENCY);
      gates[SKILL_BEHAVIOR_DETAIL_CONCURRENCY]!.release();
      await starts[SKILL_BEHAVIOR_DETAIL_CONCURRENCY + 1]!.promise;
      gates.forEach(gate => gate.release());
      const bundle = await pending;
      expect(bundle?.effects.details.map(row => row.effectKey)).toEqual(keys);
      expect(bundle?.effects.failedKeys).toEqual([]);
      expect(bundle?.complete).toBe(true);
      expect(peak).toBe(SKILL_BEHAVIOR_DETAIL_CONCURRENCY);
      expect(running).toBe(0);
    } finally {
      gates.forEach(gate => gate.release());
      await pending;
    }
  });

  it('drops a finished payload after the request generation has been replaced', async () => {
    for (const fn of listFns) vi.mocked(fn).mockResolvedValue({ data: [], status: 200, etag: null });
    let current = 8;
    const pending = loadSkillBehaviorOverview({
      apiBaseUrl: 'http://overview.test', gameId: 'demo', skillKey: 'q', generation: 8
    }, (generation) => generation === current);
    current = 9;
    expect(await pending).toBeNull();
  });
});
