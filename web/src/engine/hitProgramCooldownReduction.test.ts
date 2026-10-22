import { describe, expect, it } from 'vitest';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { mechanismEngine } from '../../tests/mechanisms/mechanismRunner';
import type { SkillEffectResult } from '../types/skillEffect';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { fixedValue } from '../types/numericValue';
import { adaptHitProgram, withHitProgram, type AuthoredHitProgram } from './hitAdapter';
import { assembleActiveSkills } from './simulationActiveSkills';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { skillActionRequest } from './skillActionRequest';
import { isOwnCooldownReductionResult } from './basicAttackCooldownReduction';

const key = 'sample_active';
function snapshotWithReduction() {
  const snapshot = simulationActiveSample(), config = snapshot.skillConfigurations.find(row => row.skill.skillKey === key)!;
  config.processes[0]!.steps[0] = { ...config.processes[0]!.steps[0]!, detail: { delayValue: fixedValue(250) } } as typeof config.processes[0]['steps'][number];
  config.processes[0]!.cooldown!.durationValue = fixedValue(5500);
  const result: Extract<SkillEffectResult, { resultType: 'COOLDOWN_CHANGE' }> = {
    resultKey: 'reduce', name: '同拥有者当前冷却', description: null, sortOrder: 20, resultType: 'COOLDOWN_CHANGE', target: 'SOURCE',
    lifecycleBehavior: null, spellShieldBlockScope: null,
    detail: { operation: 'REDUCE', affectedSkillScope: { mode: 'SKILLS', skillKeys: [key], skillCategoryKeys: [] } },
    valueRule: { value: fixedValue(1500), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
  };
  const effect = config.effects[0]!;
  effect.results[0]!.spellShieldBlockScope = 'RESULT';
  effect.results.push(result);
  approveSnapshotFixture(snapshot);
  return snapshot;
}
function program(snapshot: SimulationSnapshot): AuthoredHitProgram {
  const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === key)!;
  return { gameId: snapshot.gameId, skillKey: key, skillLevel: 1, characterLevel: 1,
    effects: configuration.effects, rules: configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_HIT'),
    parameters: configuration.parameters, formulas: configuration.formulas, statuses: snapshot.catalogs.statuses,
    modifierZones: snapshot.catalogs.modifierZones, vampRules: snapshot.catalogs.vampRules.rules, skillCategoryKeys: configuration.skill.skillCategoryKeys,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } } };
}
function prepare(snapshot: SimulationSnapshot) {
  approveSnapshotFixture(snapshot);
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(snapshot, inputs, { source: 250, target: 500 });
}
function lookup(input: unknown, path: string): unknown {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], input);
}

describe('命中计划减冷却的真实主动总装配', () => {
  it('保留完整命中候选顺序；只有最终装配能展开真实INITIAL引用', () => {
    const snapshot = snapshotWithReduction(), authored = program(snapshot), original = structuredClone(snapshot);
    const adapted = adaptHitProgram(authored);
    expect(adapted.skillHit.candidates.map(candidate => candidate.semantic.resultType)).toEqual(['DAMAGE', 'COOLDOWN_CHANGE']);
    expect(adapted.cooldownReductions).toHaveLength(1);
    expect(adapted.skillHit.candidates[1]!.operations).toEqual([]);
    const active = assembleActiveSkills(snapshot), binding = active.bindings[0]!;
    const parent = active.providers.find(provider => provider.providerKey === binding.providerDefinitionRef)!;
    const hit = parent.abilities!.find(ability => ability.operations?.some(operation => operation.operation === 'resolve_skill_hit'))!.operations![0]!.skillHit!;
    expect(hit.candidates[1]!.operations).toEqual([{ operation: 'cooldown_change', target: 'source', valuePolicy: 'reduce',
      abilityRef: binding.controls.find(control => control.action === 'INITIAL')!.abilityRef, amount: { op: 'const', value: 1500 },
      ref: `skills.${key}.effects.hit.results.reduce` }]);
    expect(active).not.toHaveProperty('hitCooldownReductions');
    expect(JSON.stringify(hit)).not.toContain('cooldownReductions');
    expect(snapshot).toEqual(original);
  });
  it('自然来源合并形成offset后，覆盖及OperationOrigin每一路径仍指向本条实际操作', () => {
    const snapshot = snapshotWithReduction(), config = snapshot.skillConfigurations.find(row => row.skill.skillKey === key)!;
    const init = structuredClone(config.triggerRules[0]!);
    init.ruleKey = 'natural_init'; init.eventSource = { eventType: 'SOURCE_INITIALIZED', detail: {} };
    init.actions = [{ ...init.actions[0]!, actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'natural_heal' }, targetContext: 'EVENT_SOURCE' }];
    config.effects.push({ ...structuredClone(config.effects[0]!), effectKey: 'natural_heal', results: [{
      resultKey: 'heal', name: '自身初始化治疗', description: null, sortOrder: 0, resultType: 'DIRECT_HEAL', target: 'SOURCE', detail: {},
      valueRule: { value: fixedValue(0), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, lifecycleBehavior: null, spellShieldBlockScope: null }] });
    config.triggerRules.push(init);
    snapshot.source.skillSources.find(source => source.skillKey === key)!.enabledRuleKeys = config.triggerRules.map(rule => rule.ruleKey).sort();
    const prepared = prepare(snapshot);
    const origin = prepared.operationOrigins.find(row => row.resultKey === 'reduce')!;
    expect(origin.compiledPaths).toHaveLength(1);
    for (const path of origin.compiledPaths) expect(lookup(prepared.compileRequest, path)).toMatchObject({ operation: 'cooldown_change', target: 'source', ref: origin.operationRef });
    const amount = prepared.coverage.find(row => row.authorPath === `${origin.operationRef}.valueRule`)!;
    expect(lookup(prepared.compileRequest, amount.compiledPath)).toEqual({ op: 'const', value: 1500 });
    const parent = prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === origin.providerDefinitionRef)!;
    expect(parent.abilities!.findIndex(ability => origin.abilityRef.endsWith(`.ability[${ability.abilityKey}]`))).toBeGreaterThan(1);
  });
  it('独立withHitProgram不能将待绑定空候选交给wire', () => {
    const snapshot = snapshotWithReduction();
    const request = prepare(simulationActiveSample()).compileRequest;
    expect(() => withHitProgram(request, { authored: program(snapshot), hitProviderKey: 'unneeded', hitAbilityKey: 'unneeded' }, { rulesHash: 'new' }))
      .toThrow(/不能序列化待绑定/);
  });
  it.each(['HIT_LINK_APPLICATION', 'ATTACK_LINK_APPLICATION', 'RESOURCE_CHANGE', 'DIRECT_HEAL'] as const)('其它未支持命中结果%s继续整体拒绝', resultType => {
    const snapshot = snapshotWithReduction(), config = snapshot.skillConfigurations.find(row => row.skill.skillKey === key)!;
    const extra = { ...structuredClone(config.effects[0]!.results[1]!), resultKey: 'unsupported', resultType, detail: {} } as SkillEffectResult;
    config.effects[0]!.results.push(extra);
    expect(() => adaptHitProgram(program(snapshot))).toThrow(/未支持的命中结果/);
  });
  it('CDR加同次额度明确拒绝，既有无CDR规则组保持；BAA及旧单技能维护门不扩大', () => {
    const snapshot = snapshotWithReduction(), authored = program(snapshot);
    authored.rules[0]!.oncePerUse = { groupKey: 'once', scope: 'TARGET' };
    expect(() => adaptHitProgram(authored)).toThrow(/不属于现行同次使用组/);
    expect(snapshot.skillConfigurations.find(row => row.skill.skillKey === key)!.effects[0]!.results).toHaveLength(2);
    const old = simulationActiveSample(), oldProgram = program(old);
    oldProgram.rules[0]!.oncePerUse = { groupKey: 'once', scope: 'TARGET' };
    expect(adaptHitProgram(oldProgram).skillHit.ruleGroups).toHaveLength(1);
    authored.rules[0]!.oncePerUse = null;
    authored.rules[0]!.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
    authored.effects[0]!.results = authored.effects[0]!.results.filter(result => result.resultType === 'COOLDOWN_CHANGE');
    expect(() => adaptHitProgram(authored)).toThrow(/不扩大普攻/);
    const reduction = authored.effects[0]!.results[0]!;
    expect(isOwnCooldownReductionResult(reduction, key)).toBe(true);
    if (reduction.resultType !== 'COOLDOWN_CHANGE') throw Error('Fixture result type');
    reduction.detail.affectedSkillScope.skillKeys.push('sibling');
    expect(isOwnCooldownReductionResult(reduction, key)).toBe(false);
  });
  it('既有生命偷取覆盖仍以SKILL伤害承载，CDR不复制P或普攻身份', () => {
    const snapshot = snapshotWithReduction(), damage = snapshot.skillConfigurations.find(row => row.skill.skillKey === key)!.effects[0]!.results[0]!;
    if (damage.resultType !== 'DAMAGE') throw Error('Fixture damage type');
    damage.detail.vampOverrides = [{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE', basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiencyValue: fixedValue(1) }];
    const prepared = prepare(snapshot);
    const operations = prepared.compileRequest.sharedProviders!.flatMap(provider => provider.abilities ?? []).flatMap(ability => ability.operations ?? []);
    const hit = operations.find(operation => operation.operation === 'resolve_skill_hit')!.skillHit!;
    expect(hit.candidates[0]!.operations[0]).toMatchObject({ operation: 'damage', vampOverrides: [{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE', efficiency: { op: 'const', value: 1 } }] });
    expect(prepared.basicAttackBinding).toBeNull();
    expect(hit.candidates).toHaveLength(2);
  });
});

describe('真实Wasm命中减冷却与法盾协议探针', () => {
  it.each(['TARGET_HIT', 'MISS', 'SPELL_SHIELD'] as const)('%s只由真实过程接触供值：250命中，5500减至4000', async mode => {
    const snapshot = snapshotWithReduction(), prepared = prepare(snapshot), { client } = await mechanismEngine();
    if (mode === 'SPELL_SHIELD') {
      // 合法Generic类型的fresh协议探针；不表示管理SPELL_SHIELD作者来源已接入。
      prepared.compileRequest.typeCatalog.types.push({ key: 'provider/spell_shield', domain: 'provider' });
      prepared.compileRequest.sharedProviders!.push({ providerKey: 'probe_shield_definition', kind: 'character', stableId: 'probe_shield', types: ['provider/spell_shield'] });
      prepared.compileRequest.combatants.find(actor => actor.key === 'target')!.providers.push({ providerRef: 'probe_shield', definitionRef: 'probe_shield_definition' });
    }
    const compiled = await client.compile(prepared.compileRequest);
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
    if (!compiled.sessionId) throw Error('Missing actual session');
    try {
      const built = await skillActionRequest(prepared, snapshot, { durationMs: 300, recordTimeSeries: false,
        actions: [{ origin: snapshot.selection.plannedSkills[0]!.origin, skillKey: key, skillLevel: 1, instructionKey: 'actual_cast', atMs: 0,
          sortOrder: 0, targetSide: 'target', hitPreset: mode === 'MISS' ? 'MISS' : 'TARGET_HIT', phaseKind: 'INITIAL', parentInstructionKey: null }],
        maxSkillActionRecords: 100, maxSkillUseRecords: 100, maxHealingRecords: 100 }, compiled.sessionId);
      if (mode === 'SPELL_SHIELD') expect(built.runRequest.initialSnapshot.combatants.find(actor => actor.key === 'target')!.providers
        .filter(provider => provider.providerRef === 'probe_shield')).toHaveLength(1);
      const done = await client.run(built.runRequest);
      expect(done.ok).toBe(true);
      const hitFacts = done.evidence.items.filter(row => row.kind === 'skill_hit');
      if (mode === 'MISS') expect(hitFacts).toEqual([]);
      else expect(hitFacts).toMatchObject([{ timeMs: 250, data: { skillKey: key, blocked: mode === 'SPELL_SHIELD' ? 1 : 0 } }]);
      const source = done.finalSnapshot.combatants.find(actor => actor.key === 'source')!;
      const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
      expect(source.cooldowns[binding.controls[0]!.abilityRef]).toEqual({ readyAtMs: mode === 'MISS' ? 5500 : 4000, remainingMs: mode === 'MISS' ? 5200 : 3700 });
      expect(done.summary.sourceDamageDealt).toBe(mode === 'TARGET_HIT' ? 100 / 1.21 : 0);
      expect(done.summary.basicAttack).toBeUndefined();
      expect(await client.run(built.runRequest)).toEqual(done);
    } finally { expect((await client.release(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
  }, 60000);
});
