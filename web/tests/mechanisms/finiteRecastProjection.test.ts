import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DoneResult, ProcessInstanceSnapshot } from '../../src/types/genericEngine';
import { prepareSimulation } from '../../src/engine/simulationAdapter';
import { skillActionRequest } from '../../src/engine/skillActionRequest';
import { automaticSkillRequest } from '../../src/engine/automaticSkillRequest';
import { validateSimulationSnapshot } from '../../src/services/simulationSnapshotClient';
import { parseMechanismCase, type MechanismProjection } from './mechanismCase';
import { compareMechanismExpectation } from './mechanismRunner';
import { projectFiniteRecasts } from './finiteRecastProjection';
import { projectUseTriggerLedger } from './useTriggerProjection';

const names = ['manual_three', 'automatic_haste', 'busy_wait', 'first_lethal', 'second_lethal', 'original_deadline'];

/** Pure production author adaptation only: no engine client or native-proof fixture. */
async function authored(name = 'manual_three') {
  const file = new URL(`./cases/finite_recast_${name}.json`, import.meta.url);
  const definition = parseMechanismCase(readFileSync(file), file.pathname);
  const snapshot = definition.buildSnapshot(), s = definition.scenario;
  validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection);
  const prepared = await prepareSimulation(snapshot, { source: {}, target: {} }, s.initialHealth);
  const common = { durationMs: s.durationMs, recordTimeSeries: false, attackSpeedInputMax: 10 };
  const { runRequest: request } = s.mode === 'automatic_skill'
    ? await automaticSkillRequest(prepared, snapshot, { ...common, rules: s.automaticRules!, outputMode: 'summary', maxAutomaticSkillRecords: 0, maxHealingRecords: 0 })
    : await skillActionRequest(prepared, snapshot, { ...common, actions: s.actions!, maxSkillActionRecords: 0, maxSkillUseRecords: 0, maxHealingRecords: 0 });
  return { definition, prepared, request };
}

async function synthetic(name = 'manual_three') {
  const input = await authored(name), { definition, request } = input, expected = definition.expected;
  const { bindingKey: _binding, providerDefinitionRef: _definition, maximumRecastCount: _maximum, intervalMs: _interval,
    windowMs: _window, ...window } = structuredClone(expected.finiteRecastWindows![0]!);
  const syntheticContacts = [{ hitSequence: 2, hitOccurrenceId: 13 }, { hitSequence: 7, hitOccurrenceId: 21 }, { hitSequence: 15, hitOccurrenceId: 34 }];
  const process: ProcessInstanceSnapshot = { ...window, skillHitStages: expected.finiteRecastStages!.map((s, index) => {
    const base = { hitBindingKey: s.hitBindingKey, stepKey: s.stepKey, timeMs: s.timeMs, released: s.released, completed: s.completed };
    return s.contact ? { ...base, contact: true as const, ...syntheticContacts[index]!, hitBlocked: 0 as const }
      : { ...base, contact: false as const };
  }) };
  const finalSnapshot = structuredClone(request.initialSnapshot);
  finalSnapshot.timeMs = expected.summary!.targetKilledAtMs ?? definition.scenario.durationMs;
  finalSnapshot.processInstances = [process];
  finalSnapshot.useTriggerLedger = structuredClone(expected.finalUseTriggerLedger!);
  const source = finalSnapshot.combatants.find(c => c.key === 'source')!;
  for (const witness of expected.finiteRecastWitnesses!) source.providerState[witness.providerRef] = { state: { [witness.stateKey]: witness.value }, expireAt: {} };
  const done = { ok: true, finalSnapshot, summary: { durationMs: finalSnapshot.timeMs },
    automaticSkillSummary: { attemptCount: 1 }, attackRecords: [], damageRecords: [], skillUseRecords: [], skillActionRecords: [],
    evidence: { items: [], truncated: false, truncatedEvidenceCount: 0, countsByKind: {} } } as unknown as DoneResult;
  return { ...input, process, done };
}

describe('有限重施固定作者与不可截断事实投影（不运行Wasm）', () => {
  it.each(['staged_lethal_manual', 'staged_lethal_automatic'])('普通%s首段致死作者形状纯装配，保留后台驱动及两独立绑定', async name => {
    const { definition: c, prepared, request } = await authored(name);
    expect(request.driverPlan.basicAttack).toBeTruthy();
    expect(prepared.compileRequest.rules.skillActionBindings).toHaveLength(1);
    const b = prepared.compileRequest.rules.skillActionBindings![0]!;
    const p = prepared.compileRequest.sharedProviders!.find(p => p.providerKey === b.providerDefinitionRef)!.processes![0]!;
    expect(p.steps.map(s => [s.stepType, s.occupiesAction])).toEqual([['DELAY', true], ['IMMEDIATE', false], ['IMMEDIATE', false]]);
    expect(b.controls.map(c => c.action)).toEqual(['INITIAL']);
    expect(b.hitBindings.map(h => [h.moment.stepKey, h.requiresPriorHitBindingKey ?? null])).toEqual([['first_hit', null], ['second_hit', null]]);
    expect(c.expected.summary).toMatchObject({ sourceDamageDealt: 100, skillUseReleased: 2, skillUseHits: 1, skillUseCompleted: 1 });
    expect(prepared.skillOrigins.some(o => o.skillKey === 'lab_cast_counter')).toBe(false);
  });
  it.each(names)('固定%s沿完整生产适配和真实请求构造；后台普攻保留', async name => {
    const { definition: c, prepared, request } = await authored(name);
    expect(prepared.basicAttackBinding).toBeTruthy();
    expect(request.driverPlan.basicAttack).toBeTruthy();
    const expected = c.expected.finiteRecastWindows![0]!;
    const binding = prepared.compileRequest.rules.skillActionBindings!.find(b => b.skillKey === 'lab_true_strike')!;
    expect({ providerRef: binding.providerRef, providerDefinitionRef: binding.providerDefinitionRef, bindingKey: binding.bindingKey }).toEqual({
      providerRef: expected.providerRef, providerDefinitionRef: expected.providerDefinitionRef, bindingKey: expected.bindingKey
    });
    const p = prepared.compileRequest.sharedProviders!.find(p => p.providerKey === binding.providerDefinitionRef)!.processes![0]!;
    expect(p.steps[1]!.maximumRecastCount).toEqual({ op: 'const', value: 2 });
    expect(p.steps[1]!.intervalMs).toEqual({ op: 'const', value: 1000 });
    expect(p.steps[1]!.windowMs).toEqual({ op: 'const', value: 15000 });
    expect(binding.hitBindings.map(b => [b.hitBindingKey, b.moment.stepKey, b.requiresPriorHitBindingKey ?? null])).toEqual([
      ['selected_skill_release_hit_0', 'initial_bolt', null], ['selected_skill_release_hit_1', 'recasts', null]
    ]);
  });
  it.each(names)('固定%s的手写零明细快照保留窗口、逐发和施放见证', async name => {
    const { definition: c, prepared, request, done } = await synthetic(name);
    const projected = projectFiniteRecasts(prepared.compileRequest, request, done);
    expect(projected.finiteRecastWindows).toEqual(c.expected.finiteRecastWindows);
    expect(projected.finiteRecastStages).toEqual(c.expected.finiteRecastStages);
    expect(projected.finiteRecastWitnesses).toEqual(c.expected.finiteRecastWitnesses);
    expect(projectUseTriggerLedger(prepared.compileRequest, request, done)).toEqual(c.expected.finalUseTriggerLedger);
    expect(projected.finiteRecastWindows).toHaveLength(1);
    expect(projected.finiteRecastStages.every(s => !Object.prototype.hasOwnProperty.call(s, 'castInstanceId'))).toBe(true);
    // 原始九字段先经严格核验；此稳定业务投影不把不要求连续的原生编号变成手算数值。
    expect(projected.finiteRecastStages.every(s => !['hitSequence', 'hitOccurrenceId', 'hitBlocked'].some(key => Object.prototype.hasOwnProperty.call(s, key)))).toBe(true);
  });
  it.each(['missing_stage', 'duplicate_stage', 'extra_stage_field', 'wrong_order', 'short_interval', 'refreshed_deadline', 'wrong_index', 'fake_completion',
    'wrong_owner', 'wrong_mount', 'wrong_skill', 'wrong_process', 'wrong_binding_mount', 'wrong_definition', 'wrong_control', 'wrong_hit_ability', 'wrong_target', 'wrong_parent',
    'wrong_start_time', 'missing_witness', 'unmounted_witness'])('拒绝%s，不从伤害补事实', async kind => {
    const f = await synthetic(), p = f.process, compile = f.prepared.compileRequest;
    if (kind === 'missing_stage') p.skillHitStages!.pop();
    if (kind === 'duplicate_stage') p.skillHitStages!.push(structuredClone(p.skillHitStages![2]!));
    if (kind === 'extra_stage_field') Object.assign(p.skillHitStages![1]!, { castInstanceId: 2 });
    if (kind === 'wrong_order') p.skillHitStages!.reverse();
    if (kind === 'short_interval') p.skillHitStages![1]!.timeMs = 999;
    if (kind === 'refreshed_deadline') p.expiresAtMs = 16000;
    if (kind === 'wrong_index') p.stepExecutionIndex = 1;
    if (kind === 'fake_completion') { p.status = 'active'; p.finishedAtMs = null; p.stepCompletedAtMs = null; }
    if (kind === 'wrong_owner') p.owner = 'target';
    if (kind === 'wrong_mount') p.providerRef = 'other';
    if (kind === 'wrong_skill') p.skillKey = 'other';
    if (kind === 'wrong_process') p.processKey = 'other';
    if (kind === 'wrong_binding_mount') compile.rules.skillActionBindings![0]!.providerRef = 'other';
    if (kind === 'wrong_definition') compile.rules.skillActionBindings![0]!.providerDefinitionRef = 'other';
    if (kind === 'wrong_control') compile.rules.skillActionBindings![0]!.controls[1]!.abilityRef = 'source.provider[foreign].ability[advance]';
    if (kind === 'wrong_hit_ability') compile.rules.skillActionBindings![0]!.hitBindings[1]!.hitAbilityRef = 'source.provider[foreign].ability[selected_skill_hit_1]';
    if (kind === 'wrong_target') p.target = 'source';
    if (kind === 'wrong_parent') f.request.driverPlan.skillActions![1]!.parentInstructionKey = 'second';
    if (kind === 'wrong_start_time') p.startedAtMs = 1;
    if (kind === 'missing_witness') f.done.finalSnapshot.combatants[0]!.providerState = {};
    if (kind === 'unmounted_witness') f.done.finalSnapshot.combatants[0]!.providers = f.done.finalSnapshot.combatants[0]!.providers.filter(p => p.providerRef !== f.definition.expected.finiteRecastWitnesses![0]!.providerRef);
    expect(() => projectFiniteRecasts(compile, f.request, f.done)).toThrow('finiteRecast');
  });
  it.each(['recast:skill:missing:1', 'recast:skill:first:01', 'recast:skill:first:3', 'recast:skill:first:0', 'recast:skill:first:1:1'])('额度拒绝伪Ui %s', async useKey => {
    const f = await synthetic(); f.done.finalSnapshot.useTriggerLedger![0]!.useKey = useKey;
    expect(() => projectUseTriggerLedger(f.prepared.compileRequest, f.request, f.done)).toThrow('同次使用额度');
  });
  it('有损明细为空仍保留已提交Ui，少阶段不能靠合法字符串蒙混', async () => {
    const f = await synthetic();
    expect(projectUseTriggerLedger(f.prepared.compileRequest, f.request, f.done)).toHaveLength(3);
    f.process.skillHitStages!.pop();
    expect(() => projectUseTriggerLedger(f.prepared.compileRequest, f.request, f.done)).toThrow();
  });
  it('伪造request使用声明不能给未提交重施序号授权', async () => {
    const f = await synthetic(), row = f.done.finalSnapshot.useTriggerLedger![0]!;
    row.useKey = 'recast:skill:first:3';
    f.request.skillUses = [{ useKey: row.useKey, source: 'source', skillKey: row.useSkillKey, historyState: 'complete' }];
    expect(() => projectUseTriggerLedger(f.prepared.compileRequest, f.request, f.done)).toThrow('同次使用额度');
  });
  it('重施按目标额度仍须保留真实父窗口目标，不能借用另一方', async () => {
    const f = await synthetic();
    for (const provider of f.prepared.compileRequest.sharedProviders!) for (const ability of provider.abilities ?? []) {
      if (ability.listenerSpec?.oncePerUse) ability.listenerSpec.oncePerUse.scope = 'provider_target';
    }
    for (const row of f.done.finalSnapshot.useTriggerLedger!) { row.scope = 'provider_target'; row.target = 'target'; }
    expect(projectUseTriggerLedger(f.prepared.compileRequest, f.request, f.done)).toHaveLength(3);
    f.done.finalSnapshot.useTriggerLedger![0]!.target = 'source';
    expect(() => projectUseTriggerLedger(f.prepared.compileRequest, f.request, f.done)).toThrow('同次使用额度');
  });
  it('未配置间隔的同毫秒重施按已提交序号和实际指令排序，保持一个窗口', async () => {
    const f = await synthetic(), p = f.process;
    const b = f.prepared.compileRequest.rules.skillActionBindings![0]!;
    const d = f.prepared.compileRequest.sharedProviders!.find(d => d.providerKey === b.providerDefinitionRef)!.processes![0]!;
    delete d.steps[1]!.intervalMs;
    f.request.driverPlan.skillActions!.forEach((a, i) => { a.firstAtMs = 0; a.sortOrder = i; });
    p.skillHitStages!.forEach(s => { s.timeMs = 0; });
    p.advanceAtMs = 0; p.lastExecutionAtMs = 0; p.finishedAtMs = 0; p.stepCompletedAtMs = 0;
    const actual = projectFiniteRecasts(f.prepared.compileRequest, f.request, f.done);
    expect(actual.finiteRecastWindows).toHaveLength(1);
    expect(actual.finiteRecastStages.map(s => [s.timeMs, s.executionOrdinal, s.useRef])).toEqual([
      [0, 0, 'skill:first'], [0, 1, 'recast:skill:first:1'], [0, 2, 'recast:skill:first:2']
    ]);
  });
  it('完整期望字段、数字和各列表长度均比较', async () => {
    const f = await synthetic(), actual = projectFiniteRecasts(f.prepared.compileRequest, f.request, f.done) as MechanismProjection;
    const expected = { finiteRecastWindows: f.definition.expected.finiteRecastWindows, finiteRecastStages: f.definition.expected.finiteRecastStages,
      finiteRecastWitnesses: f.definition.expected.finiteRecastWitnesses };
    expect(compareMechanismExpectation(actual, expected)).toEqual([]);
    actual.finiteRecastStages[1]!.useRef = 'skill:first';
    actual.finiteRecastWindows[0]!.expiresAtMs = 16000;
    actual.finiteRecastWitnesses.pop();
    expect(compareMechanismExpectation(actual, expected).length).toBe(3);
  });
  it.each(['finiteRecastWindows', 'finiteRecastStages', 'finiteRecastWitnesses'] as const)('%s不允许残缺期望隐藏数字错误', async key => {
    const file = new URL('./cases/finite_recast_manual_three.json', import.meta.url);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    delete raw.expected[key][0].providerRef;
    expect(() => parseMechanismCase(Buffer.from(JSON.stringify(raw)), file.pathname)).toThrow('完整窗口');
  });
  it.each(['skillUseStarted', 'skillUseReleased', 'skillUseHits', 'skillUseCompleted', 'skillUseFailed', 'skillUseInFlight'])('%s需要明确非负整数，不以缺失值冒充0', key => {
    const file = new URL('./cases/finite_recast_manual_three.json', import.meta.url);
    for (const value of [-1, .5, '0', null]) {
      const raw = JSON.parse(readFileSync(file, 'utf8')); raw.expected.summary[key] = value;
      expect(() => parseMechanismCase(Buffer.from(JSON.stringify(raw)), file.pathname)).toThrow();
    }
    expect(compareMechanismExpectation({ summary: {} } as MechanismProjection, { summary: { [key]: 0 } }).join(';')).toContain(key);
  });
});
