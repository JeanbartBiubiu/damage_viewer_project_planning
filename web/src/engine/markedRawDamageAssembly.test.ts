import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { mechanismEngine } from '../../tests/mechanisms/mechanismRunner';
import type { AbilityDefinition, CompileRequest, ProviderDefinition, RunRequest, SkillHitCandidate } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { GenericEngineClient } from './genericEngineClient';
import type { BasicAttackBinding, OperationOrigin } from './simulation/model';
import { prepareSimulation } from './simulationAdapter';
import { simulationAutomaticCastCosts } from './simulationActiveSkills';
import { preflightSkillFormulas } from './skillFormulaPreflight';
import { skillActionRequest } from './skillActionRequest';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import type { SkillActionInput } from './skillActionRequest';
import { basicAttackPrimaryBinding } from './primaryAttackReplacementContract';
import { validateMarkedRawDamageAssembly, validateMarkedRawPrimaryOrder } from './markedRawDamageAssembly';
import { WASM_IDENTITY } from './wasmIdentity';

const primarySkill = 'physical_body';
const skillTag = `ability/skill/${primarySkill}`;
const damageTypes = ['damage_trait/delivery_basic_attack', 'damage_trait/origin_direct', skillTag];
const before = 'event.provider_target_state_before.target_mark';

function candidate(key: string, type = 'physics'): SkillHitCandidate {
  return { candidateKey: key, effectOccurrenceKey: `hit:${key}`, effectKey: 'attack_hit', resultKey: key,
    semantic: { resultType: 'DAMAGE', target: 'TARGET', moment: 'INSTANT' }, spellShieldBlockScope: null,
    operations: [{ operation: 'damage', target: 'target', damageType: type, amount: { op: 'const', value: 100 },
      types: [...damageTypes], ref: `skills.${primarySkill}.effects.attack_hit.results.${key}` }] };
}

/** A static Generic graph using the same PRIMARY identity helper; it is not runtime evidence. */
function sample() {
  const binding: BasicAttackBinding = { source: 'source', target: 'target', skillKey: primarySkill,
    startAbilityRef: 'source.provider[basic].ability[start]', initialControlAbilityRef: 'source.provider[basic].ability[control]',
    hitAbilityRef: 'source.provider[basic].ability[hit]', attackSpeedAttributeKey: 'attack_speed' };
  const primary = candidate('primary'); primary.attackDamageRole = 'PRIMARY';
  const basic: ProviderDefinition = { providerKey: 'basic_definition', skillKey: primarySkill, stableId: 'basic', kind: 'character',
    abilities: [{ abilityKey: 'start', kind: 'active', skillKey: primarySkill, operations: [] },
      { abilityKey: 'control', kind: 'active', skillKey: primarySkill, processControl: { processKey: 'attack', action: 'INITIAL', useRefFromEvent: true } },
      { abilityKey: 'hit', kind: 'active', skillKey: primarySkill, types: [skillTag], operations: [{ operation: 'resolve_skill_hit', target: 'target',
        skillHit: { skillKey: primarySkill, candidates: [primary] } }] }],
    processes: [{ processKey: 'attack', skillKey: primarySkill, steps: [{ stepKey: 'begin', stepType: 'IMMEDIATE' }], costs: [], cooldown: null, momentOperations: [] }] };
  const markAbility: AbilityDefinition = { abilityKey: 'mark', kind: 'passive_listener', skillKey: 'marked_passive', listenerSpec: {
    listenerKey: 'mark', eventMatcher: { all: ['event/damage_instance', 'event/source_owner', skillTag, 'physics', ...damageTypes.slice(0, 2)] },
    condition: { op: 'gte', args: [{ op: 'read', path: before }, { op: 'const', value: 0 }] },
    operations: [{ operation: 'state_change', target: 'self', valuePolicy: 'set', ref: 'target_mark', amount: { op: 'const', value: 1 }, types: ['state_scope/provider_target'] }] } };
  const mark: ProviderDefinition = { providerKey: 'mark_definition', stableId: 'mark', kind: 'character', skillKey: 'marked_passive',
    initialStateSchema: { target_mark: { valueType: 'integer', defaultValue: 0, maxValue: 1, durationMs: 3000, refreshPolicy: 'refresh_on_write' } }, abilities: [markAbility] };
  const request: CompileRequest = { schemaVersion: 'generic-p0', schemaHash: 'static-primary-review', rulesHash: 'static-primary-review',
    typeCatalog: { types: [], relations: [] }, combatants: [{ key: 'source', attributes: {}, resources: {},
      providers: [{ providerRef: 'basic', definitionRef: 'basic_definition' }, { providerRef: 'mark', definitionRef: 'mark_definition' }] },
    { key: 'target', attributes: {}, resources: {}, providers: [] }], sharedProviders: [basic, mark], rules: {} };
  const origins: OperationOrigin[] = [{ abilityRef: binding.hitAbilityRef, skillKey: primarySkill, effectKey: 'attack_hit', resultKey: 'primary',
    operationRef: primary.operations[0]!.ref!, compiledPaths: ['sharedProviders[0].abilities[2].operations[0].skillHit.candidates[0].operations[0]'] }];
  const contract = { primarySkillKey: primarySkill, physicalDamageTypeKey: 'physics', magicDamageTypeKey: 'magic' };
  return { request, binding, basic, primary, mark, markAbility, origins, contract,
    candidates: basic.abilities![2]!.operations![0]!.skillHit!.candidates };
}

function assess(data: ReturnType<typeof sample>) {
  validateMarkedRawPrimaryOrder(data.request, data.binding, data.contract, { provider: data.mark, ability: data.markAbility }, data.origins, 'skills.marked_passive');
}

describe('最终PRIMARY候选的真实挂载与独立提交边界', () => {
  it('唯一独立物理PRIMARY先提交，后续单独魔法候选合法', () => {
    const data = sample(); data.candidates.push(candidate('later_magic', 'magic'));
    expect(basicAttackPrimaryBinding(data.request, data.binding)?.operation).toBe(data.primary.operations[0]);
    expect(() => assess(data)).not.toThrow();
  });
  it('另一个REFLECTED物理候选与DIRECT挂标过滤不相交', () => {
    const data = sample(), reflected = candidate('reflected');
    reflected.operations[0]!.types = ['damage_trait/delivery_basic_attack', 'damage_trait/origin_reflected', skillTag];
    data.candidates.push(reflected); expect(() => assess(data)).not.toThrow();
  });
  it.each(['no_primary', 'duplicate_primary', 'same_candidate_magic', 'before_primary_magic', 'replacement', 'extra_physical', 'wrong_binding',
    'missing_origin', 'wrong_origin_path', 'extra_start_damage', 'process_damage', 'early_listener'])('拒绝%s', mutation => {
    const data = sample();
    if (mutation === 'no_primary') delete data.primary.attackDamageRole;
    if (mutation === 'duplicate_primary') { const next = candidate('second'); next.attackDamageRole = 'PRIMARY'; data.candidates.push(next); }
    if (mutation === 'same_candidate_magic') data.primary.operations.push(candidate('mixed', 'magic').operations[0]!);
    if (mutation === 'before_primary_magic') data.candidates.unshift(candidate('before', 'magic'));
    if (mutation === 'replacement') { const next = candidate('replacement'); next.attackDamageRole = 'REPLACE_PRIMARY'; data.candidates.push(next); }
    if (mutation === 'extra_physical') data.candidates.push(candidate('second'));
    if (mutation === 'wrong_binding') Object.assign(data.binding, { source: 'target' });
    if (mutation === 'missing_origin') data.origins.splice(0);
    if (mutation === 'wrong_origin_path') data.origins[0]!.compiledPaths = ['sharedProviders[0].abilities[2].operations[0].skillHit.candidates[1].operations[0]'];
    if (mutation === 'extra_start_damage') data.basic.abilities![0]!.operations = [candidate('early', 'magic').operations[0]!];
    if (mutation === 'process_damage') data.basic.processes![0]!.momentOperations.push({ moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, operations: [candidate('early', 'magic').operations[0]!] });
    if (mutation === 'early_listener') data.mark.abilities!.push({ abilityKey: 'early', kind: 'passive_listener', listenerSpec: {
      listenerKey: 'early', eventMatcher: { all: ['event/damage_instance', 'event/source_owner', 'physics'] }, operations: [candidate('early', 'magic').operations[0]!] } });
    expect(() => assess(data)).toThrow();
  });
  it.each(['provider_listener', 'rule_listener', 'link_before_primary'])('先发事件闭包不能遗漏%s', mutation => {
    const data = sample();
    const listener = { listenerKey: 'before_mark', eventMatcher: { all: ['event/damage_instance', 'event/source_owner', 'physics'] },
      operations: [candidate('early', 'magic').operations[0]!] };
    if (mutation === 'provider_listener') data.mark.listeners = [listener];
    if (mutation === 'rule_listener') data.request.rules.listeners = [listener];
    if (mutation === 'link_before_primary') {
      data.candidates.unshift({ candidateKey: 'early_link', effectOccurrenceKey: 'hit:early_link', effectKey: 'attack_hit', resultKey: 'early_link',
        spellShieldBlockScope: null, semantic: { resultType: 'HIT_LINK_APPLICATION', target: 'TARGET', moment: 'INSTANT' },
        operations: [{ operation: 'apply_hit_link', target: 'target', ref: 'skills.physical_body.effects.attack_hit.results.early_link', amount: { op: 'const', value: 1 } }] });
      data.origins[0]!.compiledPaths = ['sharedProviders[0].abilities[2].operations[0].skillHit.candidates[1].operations[0]'];
      data.mark.abilities!.push({ abilityKey: 'early_link_damage', kind: 'passive_listener', listenerSpec: {
        ...listener, eventMatcher: { all: ['event/hit_link_applied', 'event/source_owner'] } } });
    }
    expect(() => assess(data)).toThrow();
  });
  it('真实普攻开始的独立联动操作可以保留，无先发伤害监听时不误拒', () => {
    const data = sample();
    data.basic.processes![0]!.momentOperations.push({ moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null },
      operations: [{ operation: 'apply_attack_link', target: 'target', amount: { op: 'const', value: 1 }, ref: 'authored.start.attack_link' }] });
    expect(() => assess(data)).not.toThrow();
  });
  it('真实普攻开始联动若有先发魔伤监听则拒绝', () => {
    const data = sample();
    data.basic.processes![0]!.momentOperations.push({ moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null },
      operations: [{ operation: 'apply_attack_link', target: 'target', amount: { op: 'const', value: 1 }, ref: 'authored.start.attack_link' }] });
    data.mark.abilities!.push({ abilityKey: 'early_link', kind: 'passive_listener', listenerSpec: { listenerKey: 'early_link',
      eventMatcher: { all: ['event/attack_link_applied', 'event/source_owner'] }, operations: [candidate('early', 'magic').operations[0]!] } });
    expect(() => assess(data)).toThrow();
  });
});

const probeRoot = new URL(`../../../output/skill-adaptation-20261023-amumu/web-primary-independent-review/probes-${Date.now()}/`, import.meta.url);
function shieldRemaining(shield: unknown) {
  if (!shield || typeof shield !== 'object' || !('remaining' in shield) || typeof shield.remaining !== 'number') {
    throw new Error('Missing actual numeric shield remaining');
  }
  return shield.remaining;
}
const probeExpected = {
  scope: '合法Generic层协议探针；不代表管理目标法盾或永久伤害修正作者入口已经支持',
  wasmSha256: WASM_IDENTITY.sha256,
  initial_spell_shield: { rHitAtMs: [250], blocked: [1], targetHp: 1000, damage: [], marked: false, markDeadline: null },
  late_spell_shield: { rHitAtMs: [250, 1250], blocked: [0, 1], shieldAppliedAtMs: 1000,
    targetHp: 900, damage: [{ timeMs: 250, damageType: 'magic', rawAmount: 200, postDefenseDamage: 100 }], marked: true, markDeadline: 3250 },
  modifiers_and_normal_shield: { targetMr: 100, sourceMagicMultiplier: 1.5, targetMagicMultiplier: 0.5,
    driverScope: '现有Generic直接能力驱动；真实P永久图保持，物理与Q单伤害叶从真实prepare提取，不证明生产BAA/Q计划入口',
    seed: 10, parentAuthoredRaw: 120, parentPublicRaw: 180, parentPostDefense: 45, pRaw: 12,
    sourceHp: 1000, targetHp: 1000, shieldInitial: 70, shieldAfterSeed: 60, shieldFinal: 3, totalPostDefenseDamage: 67 },
  normal_shield: { targetMr: 500 / 3, seed: 10, parentRaw: 120, parentPostDefense: 45, pRaw: 12,
    sourceHp: 1000, targetHp: 1000, shieldInitial: 70, shieldFinal: 3, totalPostDefenseDamage: 67 },
};
let probeFrozen = false;
function freezeProbeMathematics() {
  if (probeFrozen) return;
  mkdirSync(probeRoot, { recursive: true });
  writeFileSync(new URL('mathematics-before-runtime.json', probeRoot), JSON.stringify(probeExpected, null, 2) + '\n', { flag: 'wx' });
  probeFrozen = true;
}

function declareSpellShield(request: CompileRequest, late: boolean) {
  request.typeCatalog.types.push({ key: 'provider/spell_shield', domain: 'provider' });
  if (!request.typeCatalog.types.some(row => row.key === 'event/spell_shield_blocked')) request.typeCatalog.types.push({ key: 'event/spell_shield_blocked', domain: 'event' });
  request.sharedProviders!.push({ providerKey: 'protocol_spell_shield', kind: 'character', stableId: 'protocol_spell_shield', types: ['provider/spell_shield'],
    listeners: [{ listenerKey: 'consume_spell_shield', eventMatcher: { all: ['event/spell_shield_blocked'] }, maxTriggersPerEvent: 1,
      operations: [{ operation: 'expire_provider', target: 'self', providerRefFromEvent: true }] }] });
  if (late) {
    request.sharedProviders!.push({ providerKey: 'protocol_target_clock', kind: 'character', stableId: 'protocol_target_clock', abilities: [{
      abilityKey: 'late_shield', kind: 'tick', tickSpec: { startDelayMs: 1000, intervalMs: 100000,
        onTick: [{ operation: 'apply_provider', target: 'self', providerDefinitionRef: 'protocol_spell_shield', ref: 'protocol.late_shield' }] } }] });
    request.combatants.find(row => row.key === 'target')!.providers.push({ providerRef: 'protocol_target_clock', definitionRef: 'protocol_target_clock' });
  } else request.combatants.find(row => row.key === 'target')!.providers.push({ providerRef: 'protocol_spell_shield', definitionRef: 'protocol_spell_shield' });
}

async function freshProbe(caseKey: string, probeKey: keyof Omit<typeof probeExpected, 'scope' | 'wasmSha256'>,
  durationMs: number, actions: SkillActionInput[] | undefined, mutate: (request: CompileRequest) => void,
  mutateSnapshot?: (snapshot: SimulationSnapshot) => void,
  mutateRun?: (run: RunRequest, prepared: Awaited<ReturnType<typeof prepareSimulation>>) => void) {
  freezeProbeMathematics(); // Before even formula compilation, never inferred from DONE.
  const definition = loadMechanismCases().find(row => row.caseKey === caseKey)!;
  const snapshot = definition.buildSnapshot(); mutateSnapshot?.(snapshot);
  const engine = await mechanismEngine(), client = engine.client as unknown as GenericEngineClient;
  expect(engine.wasmSha256).toBe(probeExpected.wasmSha256);
  expect(engine.wasmBytes).toBe(WASM_IDENTITY.bytes);
  const preflight = await preflightSkillFormulas(snapshot, client, () => true);
  const prepared = await prepareSimulation(snapshot, definition.scenario.attributeInputs ?? { source: {}, target: {} }, definition.scenario.initialHealth,
    [], [], simulationAutomaticCastCosts(snapshot));
  // Validate the actual production graph before introducing fresh Generic-only declarations.
  validateMarkedRawDamageAssembly(snapshot, prepared.compileRequest, prepared.basicAttackBinding, prepared.skillOrigins, prepared.operationOrigins);
  const built = await skillActionRequest(prepared, snapshot, { durationMs, recordTimeSeries: false, attackSpeedInputMax: 10,
    actions: actions ?? definition.scenario.actions ?? [], maxSkillActionRecords: 1000, maxSkillUseRecords: 1000,
    maxHealingRecords: 1000, maxResourceChangeRecords: 1000 });
  const productionRunRequest = structuredClone(built.runRequest);
  mutate(prepared.compileRequest);
  let sessionId: string | undefined;
  const raw: Record<string, unknown> = { boundary: probeExpected.scope, expected: probeExpected[probeKey], caseKey,
    caseSha256: definition.fileSha256, wasmSha256: engine.wasmSha256, wasmBytes: engine.wasmBytes,
    snapshot, preflight, compileRequest: prepared.compileRequest, productionRunRequest,
    skillOrigins: prepared.skillOrigins, operationOrigins: prepared.operationOrigins,
    counts: { formulaCompiles: preflight.compileCount, formulaReleased: preflight.released, battleCompiles: 1, runs: 0, releases: 0 } };
  let result: { done: Awaited<ReturnType<GenericEngineClient['run']>>; run: Awaited<ReturnType<typeof skillActionRequest>>['runRequest']; prepared: typeof prepared; snapshot: SimulationSnapshot };
  try {
    const compiled = await client.compile(prepared.compileRequest); raw.compiled = compiled; sessionId = compiled.sessionId;
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
    if (!sessionId) throw new Error('Missing actual fresh session');
    // Only fresh declared Generic mounts are introduced. There is no mid-run state
    // replacement: the ordinary snapshot constructor runs before either replay.
    built.runRequest.sessionId = sessionId;
    built.runRequest.initialSnapshot = simulationInitialSnapshot(prepared.compileRequest);
    mutateRun?.(built.runRequest, prepared);
    raw.runRequest = structuredClone(built.runRequest);
    const frozenRun = JSON.stringify(built.runRequest), done = await client.run(built.runRequest);
    (raw.counts as { runs: number }).runs++;
    raw.done = done;
    const repeated = await client.run(built.runRequest);
    (raw.counts as { runs: number }).runs++;
    raw.repeated = repeated;
    expect(repeated).toEqual(done);
    expect(JSON.stringify(built.runRequest)).toBe(frozenRun);
    result = { done, run: built.runRequest, prepared, snapshot };
  } catch (error) {
    raw.error = String(error); throw error;
  } finally {
    if (sessionId) {
      raw.release = await client.release(sessionId, prepared.compileRequest.rulesHash);
      (raw.counts as { releases: number }).releases++;
      expect(raw.release).toMatchObject({ sessionId, released: true }); sessionId = undefined;
    }
    raw.compileSha256 = createHash('sha256').update(JSON.stringify(prepared.compileRequest)).digest('hex');
    writeFileSync(new URL(`${probeKey}.json`, probeRoot), JSON.stringify(raw, null, 2) + '\n', { flag: 'wx' });
  }
  return result;
}

describe('已授权Generic法盾协议与实际P图', () => {
  it('初始真实法盾拦R250，既不伤害也不建立诅咒', async () => {
    const definition = loadMechanismCases().find(row => row.caseKey === 'marked_raw_r_after_damage')!;
    const action = { ...definition.scenario.actions![0]!, hitPreset: 'TARGET_HIT' as const };
    const result = await freshProbe(definition.caseKey, 'initial_spell_shield', 251, [action], request => declareSpellShield(request, false));
    expect(result.prepared.basicAttackBinding).toBeNull();
    const done = result.done;
    expect(done.ok).toBe(true); expect(done.summary.sourceDamageDealt).toBe(0); expect(done.summary.targetFinalHp).toBe(1000);
    expect(done.damageRecords).toEqual([]);
    expect(done.evidence.items.filter(row => row.kind === 'skill_hit')).toMatchObject([{ timeMs: 250, data: { skillKey: 'lab_r', blocked: 1 } }]);
    const p = result.prepared.skillOrigins.find(row => row.skillKey === 'lab_marked_p')!;
    expect(p.enabledRuleKeys).not.toContain('mark_on_primary_attack');
    const source = done.finalSnapshot.combatants.find(row => row.key === 'source')!;
    const state = source.providerState[p.providerRef!] as { targetState?: { values: Record<string, number>; expireAt: Record<string, number> } } | undefined;
    // Untouched provider-target state is lazy; an absent bag is not a fabricated zero write.
    expect(state?.targetState?.values.curse ?? 0).toBe(0); expect(state?.targetState?.expireAt.curse).toBeUndefined();
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.providers.some(row => row.definitionRef === 'protocol_spell_shield')).toBe(false);
    const forgedOrigins = structuredClone(result.prepared.skillOrigins);
    forgedOrigins.find(row => row.skillKey === 'lab_marked_p')!.enabledRuleKeys.push('mark_on_primary_attack');
    expect(() => validateMarkedRawDamageAssembly(result.snapshot, result.prepared.compileRequest, null, forgedOrigins, result.prepared.operationOrigins)).toThrow();
    for (const mutation of ['extra_writer', 'extra_provider_listener', 'same_skill_mount', 'missing_blocked']) {
      const request = structuredClone(result.prepared.compileRequest);
      const provider = request.sharedProviders!.find(row => row.providerKey === p.definitionRef)!;
      const r = provider.abilities!.find(row => row.listenerSpec?.eventMatcher.all?.includes('event/skill_hit'))!;
      expect(r).toBeDefined();
      if (mutation === 'extra_writer') provider.abilities!.push({ ...structuredClone(r), abilityKey: 'forged_writer' });
      if (mutation === 'extra_provider_listener') provider.listeners = [structuredClone(r.listenerSpec!)];
      if (mutation === 'same_skill_mount') request.combatants.find(row => row.key === 'source')!.providers.push({ providerRef: 'forged_p', definitionRef: provider.providerKey });
      if (mutation === 'missing_blocked') r.listenerSpec!.condition = { op: 'const', value: 1 };
      expect(() => validateMarkedRawDamageAssembly(result.snapshot, request, result.prepared.basicAttackBinding,
        result.prepared.skillOrigins, result.prepared.operationOrigins), `R-only ${mutation}`).toThrow();
    }
  }, 60000);

  it('R已挂标后1000ms实际施盾，1250被挡不续原3250期限', async () => {
    const definition = loadMechanismCases().find(row => row.caseKey === 'marked_raw_r_after_damage')!;
    const actions = definition.scenario.actions!.slice(0, 2).map(row => ({ ...row, hitPreset: 'TARGET_HIT' as const }));
    const result = await freshProbe(definition.caseKey, 'late_spell_shield', 1301, actions, request => declareSpellShield(request, true));
    const done = result.done; expect(done.ok).toBe(true);
    expect(done.damageRecords).toMatchObject(probeExpected.late_spell_shield.damage);
    expect(done.damageRecords).toHaveLength(1); expect(done.summary.sourceDamageDealt).toBe(100); expect(done.summary.targetFinalHp).toBe(900);
    expect(done.evidence.items.filter(row => row.kind === 'skill_hit')).toMatchObject([
      { timeMs: 250, data: { skillKey: 'lab_r', blocked: 0 } }, { timeMs: 1250, data: { skillKey: 'lab_r', blocked: 1 } }]);
    expect(done.evidence.items.filter(row => row.kind === 'provider_apply' && row.data?.definitionRef === 'protocol_spell_shield')).toMatchObject([{ timeMs: 1000 }]);
    const p = result.prepared.skillOrigins.find(row => row.skillKey === 'lab_marked_p')!;
    const state = done.finalSnapshot.combatants.find(row => row.key === 'source')!.providerState[p.providerRef!] as {
      targetState: { target: string; values: Record<string, number>; expireAt: Record<string, number> } };
    expect(state.targetState.target).toBe('target'); expect(state.targetState.values.curse).toBe(1); expect(state.targetState.expireAt.curse).toBe(3250);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.providers.some(row => row.definitionRef === 'protocol_spell_shield')).toBe(false);
  }, 60000);
});

describe('真实普通盾终态与Generic原额乘区边界', () => {
  it('原生产固定普通盾70吸收10/45/12，最终残盾3且HP1000', async () => {
    const result = await freshProbe('marked_raw_pre_modifier_shield', 'normal_shield', 1001, undefined, () => {});
    const done = result.done;
    expect(done.ok).toBe(true); expect(done.damageRecords).toHaveLength(3);
    const damage = done.damageRecords;
    if (!damage) throw new Error('Missing actual damage records');
    [10, 45, 12].forEach((amount, index) => expect(damage[index]!.shieldAbsorbed).toBeCloseTo(amount, 10));
    expect(done.summary.sourceDamageDealt).toBeCloseTo(67, 10); expect(done.summary.targetFinalHp).toBe(1000);
    const target = done.finalSnapshot.combatants.find(row => row.key === 'target')!;
    expect(target.shields).toHaveLength(1); expect(target.shields[0]).toMatchObject({ source: 'target', owner: 'target' });
    expect(shieldRemaining(target.shields[0])).toBeCloseTo(3, 10);

    // These are only in-memory mutations of a real prepared graph, not new engine evidence.
    for (const mutation of ['condition_eq', 'hidden_false', 'write_condition', 'write_repeat', 'write_scope', 'once', 'duration', 'extra_writer', 'raw_types', 'raw_vamp']) {
      const request = structuredClone(result.prepared.compileRequest);
      const p = result.prepared.skillOrigins.find(row => row.skillKey === 'lab_marked_p')!;
      const provider = request.sharedProviders!.find(row => row.providerKey === p.definitionRef)!;
      const mark = provider.abilities!.find(row => row.abilityKey === 'mark_on_primary_attack')!, listener = mark.listenerSpec!;
      if (mutation === 'condition_eq') listener.condition!.op = 'eq';
      if (mutation === 'hidden_false') listener.condition = { op: 'min', args: [{ op: 'const', value: 0 }, listener.condition!] };
      if (mutation === 'write_condition') listener.operations![0]!.condition = { op: 'const', value: 0 };
      if (mutation === 'write_repeat') listener.operations![0]!.repeatCount = 2;
      if (mutation === 'write_scope') listener.operations![0]!.types = ['state_scope/provider'];
      if (mutation === 'once') listener.oncePerUse = { groupKey: 'forged_once', scope: 'provider_target' };
      if (mutation === 'duration') (provider.initialStateSchema!.curse as { durationMs: number }).durationMs = 1;
      if (mutation === 'extra_writer') provider.abilities!.push({ abilityKey: 'extra_clear_writer', kind: 'passive_listener', skillKey: 'lab_marked_p',
        listenerSpec: { ...structuredClone(listener), listenerKey: 'extra_clear_writer', operations: [{ operation: 'state_change', target: 'self',
          ref: 'curse', valuePolicy: 'set', amount: { op: 'const', value: 0 }, types: ['state_scope/provider_target'] }] } });
      const raw = provider.abilities!.find(row => row.abilityKey === 'derive_true_on_marked_magic')!.listenerSpec!.operations![0]!;
      if (mutation === 'raw_types') raw.types = ['damage_trait/delivery_basic_attack', 'damage_trait/origin_reflected'];
      if (mutation === 'raw_vamp') raw.vampQualification = 'UNRESOLVED';
      expect.soft(() => validateMarkedRawDamageAssembly(result.snapshot, request, result.prepared.basicAttackBinding,
        result.prepared.skillOrigins, result.prepared.operationOrigins), mutation).toThrow();
    }
  }, 60000);

  it('Generic发出1.5与承伤0.5真实生效，P仍读120原额而非180或45', async () => {
    let genericMagicRef = '';
    const result = await freshProbe('marked_raw_pre_modifier_shield', 'modifiers_and_normal_shield', 1001, undefined, request => {
      genericMagicRef = request.rules.skillActionBindings!.find(row => row.skillKey === 'lab_q')!.hitBindings[0]!.hitAbilityRef;
      // The existing plain Generic driver executes these real damage leaves.
      // P itself, its listener filters and its RAW formula are never replaced.
      for (const skillKey of ['lab_basic_attack', 'lab_q']) {
        const provider = request.sharedProviders!.find(row => row.skillKey === skillKey)!;
        const hit = provider.abilities!.find(row => row.operations?.[0]?.operation === 'resolve_skill_hit')!;
        const candidates = hit.operations![0]!.skillHit!.candidates;
        expect(candidates).toHaveLength(1); expect(candidates[0]!.operations).toHaveLength(1);
        expect(candidates[0]!.operations[0]!.operation).toBe('damage');
        hit.operations = structuredClone(candidates[0]!.operations);
      }
      // No active-skill plan is claimed for these plain Generic driver entries.
      delete request.rules.skillActionBindings;
      // Independent Generic definitions keep linked-shield authoring restrictions
      // intact; they do not claim production management supports these modifiers.
      for (const [owner, key, stage, multiplier] of [['source', 'protocol_outgoing', 'outgoing_pre_mitigation', 1.5],
        ['target', 'protocol_incoming', 'incoming_post_mitigation', 0.5]] as const) {
        request.sharedProviders!.push({ providerKey: key, stableId: key, kind: 'character', modifiers: [{ modifierKey: key,
          kind: 'pipeline', command: 'damage', channel: 'all_damage', stage, bucket: 'all_instances', valuePolicy: 'multiply',
          value: { op: 'const', value: multiplier }, condition: { op: 'read', path: 'damage.type.magic' } }] });
        request.combatants.find(row => row.key === owner)!.providers.push({ providerRef: key, definitionRef: key });
      }
    }, snapshot => {
      // A fresh explicit Generic probe input; the fixed JSON and author damage amounts are unchanged.
      snapshot.target.selectedLevelValues.magic_resist = 100;
      Object.assign(snapshot.target.attributes.levelValues['1']!, { magic_resist: 100 });
    }, (run, prepared) => {
      run.driverPlan = { conditionRecheckIntervalMs: 100, entries: [
        { entryKey: 'protocol_physical_seed', abilityRef: prepared.basicAttackBinding!.hitAbilityRef, source: 'source', target: 'target', firstAtMs: 0 },
        { entryKey: 'protocol_magic', abilityRef: genericMagicRef, source: 'source', target: 'target', firstAtMs: 250 },
      ] };
    });
    const done = result.done; expect(done.ok).toBe(true); expect(done.damageRecords).toHaveLength(3);
    const damage = done.damageRecords;
    if (!damage) throw new Error('Missing actual damage records');
    expect(damage.map(row => [row.timeMs, row.source, row.target, row.owner]))
      .toEqual([[0, 'source', 'target', 'source'], [250, 'source', 'target', 'source'], [250, 'source', 'target', 'source']]);
    expect(damage.map(row => [row.damageType, row.rawAmount, row.actualHpLoss]))
      .toEqual([['physics', 10, 0], ['magic', 180, 0], ['true', 12, 0]]);
    [10, 45, 12].forEach((amount, index) => {
      expect(damage[index]!.postDefenseDamage).toBeCloseTo(amount, 10);
      expect(damage[index]!.shieldAbsorbed).toBeCloseTo(amount, 10);
    });
    expect(done.summary.sourceDamageDealt).toBeCloseTo(67, 10); expect(done.summary.sourceFinalHp).toBe(1000); expect(done.summary.targetFinalHp).toBe(1000);
    const shields = done.finalSnapshot.combatants.find(row => row.key === 'target')!.shields;
    expect(shields).toHaveLength(1); expect(shieldRemaining(shields[0])).toBeCloseTo(3, 10);
    expect(done.healingRecords).toEqual([]);
    const [seed, magic, derived] = damage;
    const origin = result.prepared.skillOrigins.find(row => row.skillKey === 'lab_marked_p')!;
    expect(derived).toMatchObject({ providerRef: origin.providerRef, abilityRef: `source.provider[${origin.providerRef}].ability[derive_true_on_marked_magic]`,
      operationRef: 'skills.lab_marked_p.effects.curse_true_damage.results.damage', castInstanceId: magic!.castInstanceId });
    expect(seed!.castInstanceId).not.toBe(magic!.castInstanceId);
    expect(done.evidence.items.filter(row => row.kind === 'emitted_event' && row.ref === 'event/damage_instance'))
      .toMatchObject([{ timeMs: 0, data: { source: 'source', target: 'target', damage: { baseRawAmount: 10 } } },
        { timeMs: 250, data: { source: 'source', target: 'target', operationRef: 'skills.lab_q.effects.hit.results.damage',
          damage: { baseRawAmount: 120, preMitigationAmount: 180, mitigatedAmount: 45 } } },
        { timeMs: 250, data: { source: 'source', target: 'target', operationRef: 'skills.lab_marked_p.effects.curse_true_damage.results.damage', damage: { baseRawAmount: 12 } } }]);
  }, 60000);
});
