import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSimulationSnapshot, simulationSnapshotPath, validateSimulationSnapshot } from './simulationSnapshotClient';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';

afterEach(() => vi.unstubAllGlobals());

describe('场景只读快照接口', () => {
  it('仅发送已选对象GET，复用令牌与中止信号，不发送写入请求', async () => {
    const snapshot = simulationSample();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const abort = new AbortController();
    await expect(getSimulationSnapshot('http://localhost:8080', snapshot.gameId, snapshot.selection, 'example-token', abort.signal))
      .resolves.toMatchObject({ data: snapshot });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/admin/games/demo/simulation-snapshot?');
    expect(options.method).toBeUndefined();
    expect(options.signal).toBe(abort.signal);
    expect(options.headers.get('Authorization')).toBe('Bearer example-token');
    expect(simulationSnapshotPath('a/b', snapshot.selection)).toContain('/games/a%2Fb/');
  });

  it('真实零与未填保持区别，选中等级必须来自同一属性图', () => {
    const snapshot = simulationSample();
    snapshot.source.selectedLevelValues.attack_damage = 0;
    snapshot.source.attributes.levelValues['1']!.attack_damage = 0;
    expect(validateSimulationSnapshot(snapshot, 'demo', snapshot.selection).source.selectedLevelValues.attack_damage).toBe(0);
    snapshot.source.selectedLevelValues.attack_damage = 1;
    expect(() => validateSimulationSnapshot(snapshot, 'demo', snapshot.selection)).toThrow(/selectedLevelValues/);
  });

  it('跨游戏、串场景、缺组成、重复身份和停用目录不伪装成功', () => {
    const mutate = [
      (s: ReturnType<typeof simulationSample>) => { s.gameId = 'other'; },
      (s: ReturnType<typeof simulationSample>) => { s.selection.targetLevel = 2; },
      (s: ReturnType<typeof simulationSample>) => { s.skillConfigurations = []; },
      (s: ReturnType<typeof simulationSample>) => { s.catalogs.attributes.push(s.catalogs.attributes[0]!); },
      (s: ReturnType<typeof simulationSample>) => { s.catalogs.attributes[0]!.status = 'DISABLED'; },
      (s: ReturnType<typeof simulationSample>) => { s.catalogs.attributes[0]!.valueType = 'UNKNOWN' as never; },
      (s: ReturnType<typeof simulationSample>) => { s.source.attachedSkills = []; }
    ];
    for (const mutation of mutate) {
      const snapshot = simulationSample(); const expected = { ...snapshot.selection }; mutation(snapshot);
      expect(() => validateSimulationSnapshot(snapshot, 'demo', expected)).toThrow();
    }
  });
});
