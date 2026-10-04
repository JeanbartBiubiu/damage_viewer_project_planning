import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSimulationSnapshot, simulationSnapshotPath, validateSimulationSnapshot } from './simulationSnapshotClient';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';
import { equipmentSimulationSample } from '../../tests/fixtures/simulationEquipment';

afterEach(() => vi.unstubAllGlobals());

describe('场景只读快照接口', () => {
  it('装备参数稳定排序、重复参数只表达多选，同装备两侧合法且空数组不省略类型要求', () => {
    const snapshot = equipmentSimulationSample(['item_1036', 'item_1028'], ['item_1036']);
    snapshot.selection.sourceEquipmentKeys.reverse();
    const path = simulationSnapshotPath('lol', snapshot.selection);
    const query = new URL(path, 'http://example.test').searchParams;
    expect(query.getAll('sourceEquipmentKeys')).toEqual(['item_1028', 'item_1036']);
    expect(query.getAll('targetEquipmentKeys')).toEqual(['item_1036']);
    snapshot.selection.sourceEquipmentKeys.reverse();
    expect(simulationSnapshotPath('lol', snapshot.selection)).toBe(path);
    for (const keys of [['item_1036', 'item_1036'], Array.from({ length: 7 }, (_, index) => `item_${index}`), undefined]) {
      expect(() => simulationSnapshotPath('lol', { ...snapshot.selection, sourceEquipmentKeys: keys as string[] })).toThrow(/selection.sourceEquipmentKeys/);
    }
  });

  it('装备快照完整对应所选稳定顺序，不接受缺失、错方、额外返回、无目录属性或无关系数组', () => {
    const mutations = [
      (snapshot: ReturnType<typeof equipmentSimulationSample>) => { snapshot.source.selectedEquipment = []; },
      (snapshot: ReturnType<typeof equipmentSimulationSample>) => { snapshot.source.selectedEquipment.reverse(); },
      (snapshot: ReturnType<typeof equipmentSimulationSample>) => { snapshot.source.selectedEquipment[0]!.equipment.gameId = 'other'; },
      (snapshot: ReturnType<typeof equipmentSimulationSample>) => { snapshot.target.selectedEquipment = snapshot.source.selectedEquipment; },
      (snapshot: ReturnType<typeof equipmentSimulationSample>) => { snapshot.source.selectedEquipment[0]!.attributes.attributeValues.unknown = 1; },
      (snapshot: ReturnType<typeof equipmentSimulationSample>) => { delete (snapshot.source.selectedEquipment[0] as Partial<typeof snapshot.source.selectedEquipment[number]>).attachedSkills; },
      (snapshot: ReturnType<typeof equipmentSimulationSample>) => { snapshot.selection.sourceEquipmentKeys.reverse(); }
    ];
    const valid = equipmentSimulationSample(['item_1036', 'item_1028']);
    expect(validateSimulationSnapshot(valid, 'lol', valid.selection)).toBe(valid);
    for (const mutate of mutations) {
      const snapshot = equipmentSimulationSample(['item_1036', 'item_1028']);
      const selection = structuredClone(snapshot.selection);
      mutate(snapshot);
      expect(() => validateSimulationSnapshot(snapshot, 'lol', selection)).toThrow();
    }
  });

  it('服务保留完整被动关系而非过滤；关系启用状态及对应完整配置严格核对', () => {
    const snapshot = equipmentSimulationSample(['item_1036']);
    snapshot.source.selectedEquipment[0]!.attachedSkills.push({ gameId: 'lol', equipmentKey: 'item_1036', equipmentName: '样例长剑',
      skillKey: snapshot.selection.basicAttackSkillKey, skillName: '明确测试关系', skillStatus: 'ENABLED', sortOrder: 0 });
    expect(validateSimulationSnapshot(snapshot, 'lol', snapshot.selection).source.selectedEquipment[0]!.attachedSkills).toHaveLength(1);
    snapshot.source.selectedEquipment[0]!.attachedSkills[0]!.skillKey = 'missing_configuration';
    expect(() => validateSimulationSnapshot(snapshot, 'lol', snapshot.selection)).toThrow(/skillConfigurations/);
    snapshot.source.selectedEquipment[0]!.attachedSkills[0]!.skillStatus = 'DISABLED';
    expect(() => validateSimulationSnapshot(snapshot, 'lol', snapshot.selection)).toThrow(/attachedSkills/);
  });

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
