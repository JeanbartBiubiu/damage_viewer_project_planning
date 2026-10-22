import { describe, expect, it } from 'vitest';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { mechanismEngine } from '../../tests/mechanisms/mechanismRunner';
import { fixedValue, formulaValue, parameterValue } from '../types/numericValue';
import type { SkillEffectResult } from '../types/skillEffect';
import type { SkillFormula } from '../types/skillFormula';
import { adaptHitProgram, type AuthoredHitProgram } from './hitAdapter';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { skillActionRequest } from './skillActionRequest';

const key = 'sample_active';
type LinkResult = Extract<SkillEffectResult, { resultType: 'HIT_LINK_APPLICATION' | 'ATTACK_LINK_APPLICATION' }>;
function fixture() {
  const snapshot = simulationActiveSample(), configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === key)!;
  configuration.processes[0]!.steps[0] = { ...configuration.processes[0]!.steps[0]!, detail: { delayValue: fixedValue(250) } } as typeof configuration.processes[0]['steps'][number];
  configuration.processes[0]!.cooldown!.durationValue = fixedValue(5500);
  const effect = configuration.effects[0]!;
  effect.results[0]!.spellShieldBlockScope = 'SKILL';
  const links: LinkResult[] = (['HIT_LINK_APPLICATION', 'ATTACK_LINK_APPLICATION'] as const).map((resultType, index) => ({
    resultKey: index === 0 ? 'hit_link' : 'attack_link', name: '真实命中特效', description: null, sortOrder: 10 + index,
    resultType, target: 'TARGET', detail: {}, lifecycleBehavior: null, spellShieldBlockScope: 'SKILL',
    valueRule: { value: fixedValue(index + 2), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null }
  }));
  effect.results.push(...links);
  const program: AuthoredHitProgram = { gameId: snapshot.gameId, skillKey: key, skillLevel: 1, characterLevel: 1,
    effects: configuration.effects, rules: configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_HIT'),
    parameters: configuration.parameters, formulas: configuration.formulas, statuses: snapshot.catalogs.statuses,
    modifierZones: snapshot.catalogs.modifierZones, vampRules: snapshot.catalogs.vampRules.rules,
    skillCategoryKeys: configuration.skill.skillCategoryKeys,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } } };
  return { snapshot, configuration, effect, links, program };
}
function prepare(value: ReturnType<typeof fixture>) {
  approveSnapshotFixture(value.snapshot);
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(value.snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(value.snapshot, inputs, { source: 250, target: 500 });
}
function lookup(input: unknown, path: string): unknown {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)?.[part], input);
}

describe('真实技能命中的两类特效', () => {
  it('保持候选次序、共同阻挡范围、静态次数及各自事件类型', () => {
    const value = fixture(), original = structuredClone(value.program), adapted = adaptHitProgram(value.program);
    expect(value.program).toEqual(original);
    expect(adapted.skillHit.candidates.map(candidate => candidate.semantic.resultType)).toEqual(['DAMAGE', 'HIT_LINK_APPLICATION', 'ATTACK_LINK_APPLICATION']);
    expect(adapted.skillHit.candidates.slice(1)).toMatchObject([
      { semantic: { target: 'TARGET', moment: 'INSTANT' }, spellShieldBlockScope: 'SKILL', operations: [{ operation: 'apply_hit_link', target: 'target', amount: { op: 'const', value: 2 } }] },
      { semantic: { target: 'TARGET', moment: 'INSTANT' }, spellShieldBlockScope: 'SKILL', operations: [{ operation: 'apply_attack_link', target: 'target', amount: { op: 'const', value: 3 } }] }
    ]);
    expect(adapted.typeEntries).toEqual(expect.arrayContaining([{ key: 'event/hit_link_applied', domain: 'event' }, { key: 'event/attack_link_applied', domain: 'event' }]));
  });
  it('完整数值规则先折常量，零次合法且不补缺失次数', () => {
    const value = fixture();
    value.links[0]!.valueRule = { value: fixedValue(2), fixedMultiplier: 3, fixedMinValue: 0, fixedMaxValue: 4 };
    value.links[1]!.valueRule!.value = fixedValue(0);
    expect(adaptHitProgram(value.program).skillHit.candidates.slice(1).map(row => row.operations[0]!.amount)).toEqual([{ op: 'const', value: 4 }, { op: 'const', value: 0 }]);
    value.links[1]!.valueRule = null as unknown as LinkResult['valueRule'];
    expect(() => adaptHitProgram(value.program)).toThrow(/缺少完整次数/);
  });
  it.each([-1, .5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('拒绝非有限非负安全整数次数%s', count => {
    const value = fixture(); value.links[0]!.valueRule!.value = fixedValue(count);
    expect(() => adaptHitProgram(value.program)).toThrow();
  });
  it.each(['source', 'lifecycle', 'moment', 'detail', 'basic'] as const)('不扩大%s入口', mode => {
    const value = fixture();
    if (mode === 'source') value.links[0]!.target = 'SOURCE';
    if (mode === 'lifecycle') value.effect.lifecycle = {} as NonNullable<typeof value.effect.lifecycle>;
    if (mode === 'moment') value.links[0]!.lifecycleBehavior = { moment: 'PERIODIC', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: 'WHOLE_STACK' };
    if (mode === 'detail') (value.links[0]!.detail as Record<string, unknown>).unknown = true;
    if (mode === 'basic') {
      value.program.rules[0]!.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
      value.effect.results = value.links;
    }
    expect(() => adaptHitProgram(value.program)).toThrow();
  });
  it('不能用未选分支或数值夹取隐藏动态依赖', () => {
    const value = fixture();
    value.configuration.parameters.push({ gameId: value.program.gameId, skillKey: key, parameterKey: 'late', name: '动态次数', description: null,
      sortOrder: 0, valueType: 'INTEGER', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null, createdAt: '', updatedAt: '' });
    value.links[0]!.valueRule!.value = parameterValue('late');
    value.links[0]!.valueRule!.fixedMaxValue = 1;
    expect(() => adaptHitProgram(value.program)).toThrow(/计算时输入/);
    value.configuration.formulas.push({ gameId: value.program.gameId, skillKey: key, formulaKey: 'hidden', name: '隐藏属性', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
      expression: { inputs: [{ key: 'late', binding: { kind: 'attribute', object: 'source', attributeKey: 'attack_damage', valueKind: 'TOTAL', view: 'current_frame' } }],
        stages: [{ key: 'out', name: '输出', expression: { op: 'if', args: [{ op: 'const', value: '1' }, { op: 'const', value: '1' }, { op: 'read', inputKey: 'late' }] } }], outputStageKey: 'out' } } as SkillFormula);
    value.links[0]!.valueRule!.value = formulaValue('hidden');
    expect(() => adaptHitProgram(value.program)).toThrow(/不能依赖属性/);
  });
  it('最终编译路径与作者来源匹配，链接不变成普通攻击能力', () => {
    const prepared = prepare(fixture());
    const origins = prepared.operationOrigins.filter(row => ['hit_link', 'attack_link'].includes(row.resultKey));
    expect(origins).toHaveLength(2);
    for (const origin of origins) {
      expect(origin.skillKey).toBe(key); expect(origin.compiledPaths).toHaveLength(1);
      expect(lookup(prepared.compileRequest, origin.compiledPaths[0]!)).toMatchObject({ operation: origin.resultKey === 'hit_link' ? 'apply_hit_link' : 'apply_attack_link', ref: origin.operationRef });
    }
    expect(prepared.compileRequest.sharedProviders!.filter(row => row.skillKey === key).flatMap(row => row.abilities ?? []).every(row => !row.types?.includes('ability/basic_attack'))).toBe(true);
  });
});

describe('正式Wasm上的真实链接事件与法盾资格', () => {
  it.each(['TARGET_HIT', 'MISS', 'SPELL_SHIELD'] as const)('%s只在实际合格命中触发链接，保留原使用且不新增根命中', async mode => {
    const value = fixture();
    value.effect.results.push({ resultKey: 'reduce', name: '原命中减冷却', description: null, sortOrder: 30, resultType: 'COOLDOWN_CHANGE', target: 'SOURCE',
      detail: { operation: 'REDUCE', affectedSkillScope: { mode: 'SKILLS', skillKeys: [key], skillCategoryKeys: [] } },
      valueRule: { value: fixedValue(1500), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null }, lifecycleBehavior: null, spellShieldBlockScope: null });
    const prepared = prepare(value), { client } = await mechanismEngine();
    if (mode === 'SPELL_SHIELD') {
      // 现行合法通用协议探针，不表示管理端法盾装备来源已经准入。
      prepared.compileRequest.typeCatalog.types.push({ key: 'provider/spell_shield', domain: 'provider' });
      prepared.compileRequest.sharedProviders!.push({ providerKey: 'probe_shield_definition', kind: 'character', stableId: 'probe_shield', types: ['provider/spell_shield'] });
      prepared.compileRequest.combatants.find(row => row.key === 'target')!.providers.push({ providerRef: 'probe_shield', definitionRef: 'probe_shield_definition' });
    }
    const compiled = await client.compile(prepared.compileRequest);
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
    if (!compiled.sessionId) throw Error('Missing actual session');
    try {
      const built = await skillActionRequest(prepared, value.snapshot, { durationMs: 300, recordTimeSeries: false,
        actions: [{ origin: value.snapshot.selection.plannedSkills[0]!.origin, skillKey: key, skillLevel: 1, instructionKey: 'probe_cast', atMs: 0,
          sortOrder: 0, targetSide: 'target', hitPreset: mode === 'MISS' ? 'MISS' : 'TARGET_HIT', phaseKind: 'INITIAL', parentInstructionKey: null }],
        maxSkillActionRecords: 100, maxSkillUseRecords: 100, maxHealingRecords: 100 }, compiled.sessionId);
      const done = await client.run(built.runRequest);
      expect(done.ok).toBe(true);
      const links = done.evidence.items.filter(row => row.kind === 'emitted_event' && ['event/hit_link_applied', 'event/attack_link_applied'].includes(row.ref!));
      expect(links).toHaveLength(mode === 'TARGET_HIT' ? 5 : 0);
      if (mode === 'TARGET_HIT') for (const [event, count] of [['event/hit_link_applied', 2], ['event/attack_link_applied', 3]] as const) {
        const rows = links.filter(row => row.ref === event);
        expect(rows.map(row => row.data!.LINK_INDEX)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
        for (const row of rows) expect(row).toMatchObject({ timeMs: 250, data: { source: 'source', target: 'target', skillKey: key, useRef: 'skill:probe_cast', LINK_COUNT: count } });
      }
      const contacts = done.evidence.items.filter(row => row.kind === 'skill_hit');
      expect(contacts).toHaveLength(mode === 'MISS' ? 0 : 1);
      if (mode !== 'MISS') expect(contacts[0]).toMatchObject({ timeMs: 250, data: { blocked: mode === 'SPELL_SHIELD' ? 1 : 0 } });
      const source = done.finalSnapshot.combatants.find(row => row.key === 'source')!, binding = prepared.compileRequest.rules.skillActionBindings![0]!;
      expect(source.cooldowns[binding.controls[0]!.abilityRef]!.readyAtMs).toBe(mode === 'MISS' ? 5500 : 4000);
      expect(done.summary.basicAttack).toBeUndefined();
      expect(done.summary.sourceDamageDealt).toBe(mode === 'TARGET_HIT' ? 100 / 1.21 : 0);
      expect(await client.run(built.runRequest)).toEqual(done);
    } finally { expect((await client.release(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
  }, 60000);
});
