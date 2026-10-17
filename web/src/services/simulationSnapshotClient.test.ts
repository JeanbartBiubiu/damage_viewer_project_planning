import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSimulationSnapshot, normalizeSimulationSelection, simulationSnapshotPath, validateSimulationSnapshot } from './simulationSnapshotClient';
import { simulationDefaultSourcesSample, simulationSample } from '../../tests/fixtures/simulationSnapshot';
import { equipmentSimulationSample } from '../../tests/fixtures/simulationEquipment';
import { simulationSkillSourceIdentity } from './simulationSkillSourceIdentity';
import type { SimulationSelection, SimulationSkillOrigin } from '../types/simulationSnapshot';
import { getIsolatedSimulationSnapshot } from '../../tests/fixtures/simulationLiveSnapshot';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';

afterEach(() => vi.unstubAllGlobals());

describe('场景只读快照接口', () => {
  it.each(['selected', 'disabled'] as const)('完整%s来源保留未挂接的已知实例时间公式，未知上下文仍拒绝', variant => {
    const snapshot = variant === 'selected' ? simulationSample() : simulationDefaultSourcesSample();
    const configuration = variant === 'selected' ? snapshot.skillConfigurations[0]!
      : snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === 'sample_disabled')!;
    const formula = { gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, formulaKey: 'unconsumed_elapsed', name: '保留的有限实例公式',
      description: null, sortOrder: 0, createdAt: '', updatedAt: '', expression: {
        inputs: [{ key: 'elapsed', binding: { kind: 'context' as const, contextKey: 'effect_elapsed_ms' } }],
        stages: [{ key: 'output', name: '已过时间', expression: { op: 'read' as const, inputKey: 'elapsed' } }], outputStageKey: 'output'
      } };
    configuration.formulas.push(formula);
    const before = structuredClone(snapshot);
    expect(validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection)).toBe(snapshot);
    expect(snapshot).toEqual(before);
    formula.expression.inputs[0]!.binding.contextKey = 'arbitrary_clock';
    expect(() => validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection)).toThrow(/技能公式详情不完整/);
  });

  it('阶段对照读取保留全局停用来源，默认本场标记不使其重新激活', async () => {
    const candidate = simulationDefaultSourcesSample();
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, options: RequestInit) => {
      const snapshot = structuredClone(candidate);
      snapshot.selection = JSON.parse(String(options.body));
      syncSimulationSkillSources(snapshot);
      return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const snapshot = await getIsolatedSimulationSnapshot('http://api.test', 'demo', candidate.selection, 'test');
    expect(snapshot.source.skillSources.find(source => source.skillKey === 'sample_disabled'))
      .toMatchObject({ enabled: true, inactiveReason: 'GLOBAL_DISABLED', enabledRuleKeys: [] });
  });

  it('POST选择稳定排序，同装备两侧合法且必填空数组不省略', () => {
    const snapshot = equipmentSimulationSample(['item_1036', 'item_1028'], ['item_1036']);
    snapshot.selection.sourceEquipmentKeys.reverse();
    const selection = normalizeSimulationSelection(snapshot.selection);
    expect(selection.sourceEquipmentKeys).toEqual(['item_1028', 'item_1036']);
    expect(selection.targetEquipmentKeys).toEqual(['item_1036']);
    snapshot.selection.sourceEquipmentKeys.reverse();
    expect(normalizeSimulationSelection(snapshot.selection)).toEqual(selection);
    for (const keys of [['item_1036', 'item_1036'], Array.from({ length: 7 }, (_, index) => `item_${index}`), undefined]) {
      expect(() => normalizeSimulationSelection({ ...snapshot.selection, sourceEquipmentKeys: keys as string[] })).toThrow(/selection.sourceEquipmentKeys/);
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

  it('服务保留完整被动与停用关系，而不是过滤；清单及对应配置严格核对', () => {
    const snapshot = equipmentSimulationSample(['item_1036']);
    snapshot.source.selectedEquipment[0]!.attachedSkills.push({ gameId: 'lol', equipmentKey: 'item_1036', equipmentName: '样例长剑',
      skillKey: snapshot.selection.basicAttackSkillKey, skillName: '明确测试关系', skillStatus: 'ENABLED', sortOrder: 0 });
    snapshot.source.skillSources.push({ origin: { kind: 'EQUIPMENT', equipmentKey: 'item_1036' }, skillKey: snapshot.selection.basicAttackSkillKey,
      skillName: '明确测试关系', skillStatus: 'ENABLED', enabled: true, skillLevel: 1, enabledRuleKeys: [], inactiveReason: 'ACTIVE_DEFERRED' });
    expect(validateSimulationSnapshot(snapshot, 'lol', snapshot.selection).source.selectedEquipment[0]!.attachedSkills).toHaveLength(1);
    snapshot.source.selectedEquipment[0]!.attachedSkills[0]!.skillKey = 'missing_configuration';
    expect(() => validateSimulationSnapshot(snapshot, 'lol', snapshot.selection)).toThrow(/skillSources/);
    snapshot.source.selectedEquipment[0]!.attachedSkills[0]!.skillKey = snapshot.selection.basicAttackSkillKey;
    snapshot.source.selectedEquipment[0]!.attachedSkills[0]!.skillStatus = 'DISABLED';
    expect(() => validateSimulationSnapshot(snapshot, 'lol', snapshot.selection)).toThrow(/skillSources/);
    snapshot.source.selectedEquipment[0]!.attachedSkills[0]!.skillKey = 'sample_disabled';
    snapshot.source.skillSources[1] = { ...snapshot.source.skillSources[1]!, skillKey: 'sample_disabled', skillStatus: 'DISABLED', inactiveReason: 'GLOBAL_DISABLED' };
    snapshot.skillConfigurations.push({ skill: { ...snapshot.skillConfigurations[0]!.skill, skillKey: 'sample_disabled', status: 'DISABLED' },
      parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [], baseDigest: 'independent_disabled' });
    expect(validateSimulationSnapshot(snapshot, 'lol', snapshot.selection).source.selectedEquipment[0]!.attachedSkills[0]!.skillStatus).toBe('DISABLED');
  });

  it('只读快照替换为结构化POST，复用令牌与中止信号且无GET兼容', async () => {
    const snapshot = simulationSample();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const abort = new AbortController();
    await expect(getSimulationSnapshot('http://localhost:8080', snapshot.gameId, snapshot.selection, 'example-token', abort.signal))
      .resolves.toMatchObject({ data: snapshot });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:8080/api/admin/games/demo/simulation-snapshot');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual(snapshot.selection);
    expect(options.headers.get('Content-Type')).toBe('application/json');
    expect(options.signal).toBe(abort.signal);
    expect(options.headers.get('Authorization')).toBe('Bearer example-token');
    expect(simulationSnapshotPath('a/b')).toContain('/games/a%2Fb/');
  });

  it('三种完整身份使用稳定JSON数组，同技能双方和构筑不同位置不会合并', () => {
    const character: SimulationSkillOrigin = { kind: 'CHARACTER', characterKey: 'actor_a' };
    const equipment: SimulationSkillOrigin = { kind: 'EQUIPMENT', equipmentKey: 'item_1036' };
    const build: SimulationSkillOrigin = { kind: 'BUILD_OPTION', systemKey: 'sample_build', roleKey: 'primary',
      groupKey: 'sample_group', slotKey: 'first', optionKey: 'sample_option' };
    expect(simulationSkillSourceIdentity(character, 'sample')).toBe('["CHARACTER","actor_a","sample"]');
    expect(simulationSkillSourceIdentity(equipment, 'sample')).toBe('["EQUIPMENT","item_1036","sample"]');
    expect(simulationSkillSourceIdentity(build, 'sample')).toBe('["BUILD_OPTION","sample_build","primary","sample_group","first","sample_option","sample"]');
    expect(simulationSkillSourceIdentity({ ...build, slotKey: 'second' }, 'sample')).not.toBe(simulationSkillSourceIdentity(build, 'sample'));
    expect(simulationSkillSourceIdentity({ ...character, characterKey: 'actor_b' }, 'sample')).not.toBe(simulationSkillSourceIdentity(character, 'sample'));
  });

  it('四个新数组必填，未知字段、伪造来源和非布尔开关不进入请求', () => {
    const sample = simulationDefaultSourcesSample();
    for (const field of ['sourceBuildConfigurations', 'targetBuildConfigurations', 'sourceSkillSettings', 'targetSkillSettings'] as const) {
      const selection = structuredClone(sample.selection);
      delete (selection as Partial<SimulationSelection>)[field];
      expect(() => normalizeSimulationSelection(selection)).toThrow(field);
    }
    const changes = [
      { origin: { kind: 'CHARACTER', characterKey: 'actor_b' }, skillKey: 'sample_natural', enabled: true },
      { origin: { kind: 'EQUIPMENT', equipmentKey: 'item_1036' }, skillKey: 'sample_natural', enabled: true },
      { origin: { kind: 'CHARACTER', characterKey: 'actor_a', equipmentKey: 'item_1036' }, skillKey: 'sample_natural', enabled: true },
      { origin: { kind: 'EXTRA' }, skillKey: 'sample_natural', enabled: true },
      { origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey: 'sample_natural', enabled: 'true' },
      { origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey: 'sample_natural', enabled: true, skillLevel: null },
      { origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey: 'sample_natural', enabled: true, enabledRuleKeys: [] }
    ];
    for (const setting of changes) expect(() => normalizeSimulationSelection({ ...sample.selection, sourceSkillSettings: [setting] } as SimulationSelection)).toThrow();
    expect(() => normalizeSimulationSelection({ ...sample.selection, extraSkills: [] } as SimulationSelection)).toThrow(/extraSkills/);
  });

  it('机制初值只属于Web冻结输入，不增加后端POST快照字段', () => {
    const snapshot = simulationSample();
    expect(() => normalizeSimulationSelection({ ...snapshot.selection, mechanicStateInputs: [] } as SimulationSelection)).toThrow(/mechanicStateInputs/);
    expect(normalizeSimulationSelection(snapshot.selection)).not.toHaveProperty('mechanicStateInputs');
  });

  it('覆盖仅限完整默认集合，同来源重复拒绝且所选普攻等级不能冲突', () => {
    const sample = simulationDefaultSourcesSample();
    const setting = { origin: { kind: 'CHARACTER' as const, characterKey: 'actor_a' }, skillKey: 'sample_natural', enabled: false };
    expect(() => normalizeSimulationSelection({ ...sample.selection, sourceSkillSettings: [setting, setting] })).toThrow(/sourceSkillSettings/);
    expect(() => normalizeSimulationSelection({ ...sample.selection, sourceSkillSettings: [{ ...setting, skillKey: sample.selection.basicAttackSkillKey, skillLevel: 0 }] })).toThrow(/skillLevel/);
    const forged = { ...sample.selection, sourceSkillSettings: [{ ...setting, skillKey: 'missing_skill' }] };
    sample.selection = forged;
    expect(() => validateSimulationSnapshot(sample, 'demo', forged)).toThrow(/SkillSettings/);
  });

  it('完整来源含待供等级、全局停用和同选项两位置，读取不依赖编译准入', () => {
    const sample = simulationDefaultSourcesSample();
    expect(validateSimulationSnapshot(sample, 'demo', sample.selection)).toBe(sample);
    expect(sample.source.skillSources.filter(source => source.origin.kind === 'BUILD_OPTION')).toHaveLength(2);
    const mutations = [
      (snapshot: typeof sample) => { snapshot.source.skillSources.pop(); },
      (snapshot: typeof sample) => { snapshot.source.skillSources.push(snapshot.source.skillSources[0]!); },
      (snapshot: typeof sample) => { snapshot.source.skillSources[1]!.origin = { kind: 'CHARACTER', characterKey: 'actor_b' }; },
      (snapshot: typeof sample) => { snapshot.source.skillSources[1]!.inactiveReason = 'UNKNOWN' as never; },
      (snapshot: typeof sample) => { snapshot.source.skillSources[1]!.skillLevel = 4; },
      (snapshot: typeof sample) => { snapshot.source.skillSources[2]!.enabled = false; },
      (snapshot: typeof sample) => { snapshot.source.skillSources[1]!.enabledRuleKeys = ['begin_attack']; },
      (snapshot: typeof sample) => { snapshot.source.selectedBuilds = []; },
      (snapshot: typeof sample) => { snapshot.source.selectedBuilds[0]!.definition.groups = []; },
      (snapshot: typeof sample) => { snapshot.source.selectedBuilds[0]!.configuration.selections[0]!.rank = 2; }
    ];
    for (const mutate of mutations) {
      const snapshot = simulationDefaultSourcesSample();
      const selection = structuredClone(snapshot.selection);
      mutate(snapshot);
      expect(() => validateSimulationSnapshot(snapshot, 'demo', selection)).toThrow();
    }
  });

  it('角色等级0保留未学来源；另一方及构筑等级独立，不修改固定授予', () => {
    const sample = simulationDefaultSourcesSample();
    sample.selection.sourceSkillSettings = [{ origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey: 'sample_natural', enabled: true, skillLevel: 0 }];
    sample.source.skillSources[1] = { ...sample.source.skillSources[1]!, skillLevel: 0, inactiveReason: 'UNLEARNED' };
    expect(validateSimulationSnapshot(sample, 'demo', sample.selection).source.skillSources[1]!.skillLevel).toBe(0);
    expect(sample.target.skillSources[1]!.skillLevel).toBeNull();
    const buildOrigin = sample.source.skillSources[3]!.origin;
    expect(() => normalizeSimulationSelection({ ...sample.selection, sourceSkillSettings: [{ origin: buildOrigin, skillKey: 'sample_natural', enabled: true, skillLevel: 2 }] })).toThrow(/skillLevel/);
    sample.selection.sourceSkillSettings = [{ origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey: 'sample_disabled', enabled: true }];
    expect(() => validateSimulationSnapshot(sample, 'demo', sample.selection)).toThrow(/enabled/);
  });

  it('关闭来源仍回显原关系和完整树，不能用缺配置或伪造根蒙混通过', () => {
    const sample = simulationDefaultSourcesSample();
    sample.selection.sourceSkillSettings = [{ origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey: 'sample_natural', enabled: false }];
    sample.source.skillSources[1] = { ...sample.source.skillSources[1]!, enabled: false, inactiveReason: 'SCENE_DISABLED' };
    expect(validateSimulationSnapshot(sample, 'demo', sample.selection).source.attachedSkills).toHaveLength(3);
    sample.source.skillSources[1]!.enabledRuleKeys = ['missing_rule'];
    expect(() => validateSimulationSnapshot(sample, 'demo', sample.selection)).toThrow(/enabledRuleKeys/);
    sample.source.skillSources[1]!.enabledRuleKeys = [];
    sample.skillConfigurations.pop();
    expect(() => validateSimulationSnapshot(sample, 'demo', sample.selection)).toThrow(/skillConfigurations/);
  });

  it('完整只读依赖可返回但不变成额外授予来源，无引用的额外配置拒绝', () => {
    const sample = simulationSample();
    const dependency = { skill: { ...sample.skillConfigurations[0]!.skill, skillKey: 'sample_dependency', skillCategoryKeys: [] },
      parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [], baseDigest: 'independent_dependency' };
    sample.skillConfigurations.push(dependency);
    expect(() => validateSimulationSnapshot(sample, 'demo', sample.selection)).toThrow(/skillConfigurations/);
    sample.references.push({ sourceSkillKey: sample.selection.basicAttackSkillKey, sourceType: 'TRIGGER', sourceKey: 'begin_attack',
      fieldPath: 'actions[0].detail.skillKey', targetType: 'SKILL', targetSkillKey: '', targetKey: 'sample_dependency', targetSubKey: '' });
    expect(validateSimulationSnapshot(sample, 'demo', sample.selection).source.skillSources).toHaveLength(1);
  });

  it('伤害类型来源允许空技能归属和共同输入路径，其他来源继续要求技能标识', () => {
    const snapshot = simulationSample();
    snapshot.references.push({ sourceType: 'DAMAGE_TYPE', sourceSkillKey: '', sourceKey: 'physics',
      fieldPath: 'inputs/0/binding/attributeKey', targetType: 'ATTRIBUTE', targetSkillKey: '', targetKey: 'armor', targetSubKey: '' });
    expect(validateSimulationSnapshot(snapshot, 'demo', snapshot.selection)).toBe(snapshot);
    snapshot.references[0]!.sourceType = 'TRIGGER';
    expect(() => validateSimulationSnapshot(snapshot, 'demo', snapshot.selection)).toThrow(/sourceSkillKey/);
    snapshot.references[0]!.sourceType = 'DAMAGE_TYPE';
    snapshot.references[0]!.sourceSkillKey = 'sample_basic_attack';
    expect(() => validateSimulationSnapshot(snapshot, 'demo', snapshot.selection)).toThrow(/references/);
  });

  it('真实零与未填保持区别，选中等级必须来自同一属性图', () => {
    const snapshot = simulationSample();
    snapshot.source.selectedLevelValues.attack_damage = 0;
    snapshot.source.attributes.levelValues['1']!.attack_damage = 0;
    expect(validateSimulationSnapshot(snapshot, 'demo', snapshot.selection).source.selectedLevelValues.attack_damage).toBe(0);
    snapshot.source.selectedLevelValues.attack_damage = 1;
    expect(() => validateSimulationSnapshot(snapshot, 'demo', snapshot.selection)).toThrow(/selectedLevelValues/);
  });

  it('只读完整作者树的停用分类仍可读取，不把分类目录状态当成执行准入', () => {
    const snapshot = simulationDefaultSourcesSample();
    const disabled = snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === 'sample_disabled')!;
    disabled.skill.skillCategoryKeys = ['disabled_metadata'];
    const category = { ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'disabled_metadata', status: 'DISABLED' as const };
    snapshot.catalogs.skillCategories.push(category);
    expect(validateSimulationSnapshot(snapshot, 'demo', snapshot.selection)).toBe(snapshot);
    expect(snapshot.catalogs.skillCategories.find(row => row.skillCategoryKey === 'disabled_metadata')).toEqual(category);
    expect(snapshot.source.skillSources.find(source => source.skillKey === 'sample_disabled')).toMatchObject({ inactiveReason: 'GLOBAL_DISABLED' });
  });

  it('只读分类放宽后仍拒绝未知状态、跨游戏、重复标识和非法稳定键', () => {
    const changes = [
      (snapshot: ReturnType<typeof simulationSample>) => { snapshot.catalogs.skillCategories[0]!.status = 'UNKNOWN' as never; },
      (snapshot: ReturnType<typeof simulationSample>) => { snapshot.catalogs.skillCategories[0]!.status = null as never; },
      (snapshot: ReturnType<typeof simulationSample>) => { snapshot.catalogs.skillCategories[0]!.status = false as never; },
      (snapshot: ReturnType<typeof simulationSample>) => { delete (snapshot.catalogs.skillCategories[0] as Partial<typeof snapshot.catalogs.skillCategories[number]>).status; },
      (snapshot: ReturnType<typeof simulationSample>) => { snapshot.catalogs.skillCategories[0]!.gameId = 'other'; },
      (snapshot: ReturnType<typeof simulationSample>) => { snapshot.catalogs.skillCategories.push(snapshot.catalogs.skillCategories[0]!); },
      (snapshot: ReturnType<typeof simulationSample>) => { snapshot.catalogs.skillCategories[0]!.skillCategoryKey = '../outside'; }
    ];
    for (const change of changes) {
      const snapshot = simulationSample();
      change(snapshot);
      expect(() => validateSimulationSnapshot(snapshot, 'demo', snapshot.selection)).toThrow(/catalogs.skillCategories/);
    }
  });

  it('停用分类可作元数据，但不放宽属性和伤害类型目录的已有约束', () => {
    for (const domain of ['attribute', 'damageType'] as const) {
      const snapshot = simulationSample();
      snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'unused_disabled', status: 'DISABLED' });
      if (domain === 'attribute') snapshot.catalogs.attributes[0]!.status = 'DISABLED';
      else snapshot.catalogs.damageTypes[0]!.type.status = 'DISABLED';
      expect(() => validateSimulationSnapshot(snapshot, 'demo', snapshot.selection)).toThrow(/catalogs/);
    }
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
