import { beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { mechanismEngine, runMechanismCase, type MechanismRun } from '../../tests/mechanisms/mechanismRunner';
import { projectUseTriggerLedger } from '../../tests/mechanisms/useTriggerProjection';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { automaticSkillRequest } from './automaticSkillRequest';
import { assessSkillActionResult } from './skillActionResult';
import { assessAutomaticSkillResult } from './automaticSkillResult';
import { decodeFramePayload, TinyGoV2InvocationError } from './tinygoV2Bridge';
import type { CompileRequest, DoneResult, RunRequest, SkillHitDefinition } from '../types/genericEngine';

const definitions = loadMechanismCases();
let reference: MechanismRun;
beforeAll(async () => {
  reference = await runMechanismCase(definitions.find(row => row.caseKey === 'hit_rule_group_two_actions')!);
  save('reference', reference.prepared.compileRequest, reference.runRequest, reference.done);
}, 60000);

function save(name: string, input: CompileRequest, request: RunRequest | null, done: unknown) {
  const directory = new URL('../../../output/skill-adaptation-20261021-chogath/q-rule-groups/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  writeFileSync(new URL(`${name}.actual.json`, directory), JSON.stringify({ input, request, done }, null, 2) + '\n');
}
function hitOf(input: CompileRequest): SkillHitDefinition {
  return input.sharedProviders!.flatMap(provider => provider.abilities ?? []).flatMap(ability => ability.operations ?? [])
    .find(operation => !!operation.skillHit?.ruleGroups?.length)!.skillHit!;
}
async function fresh(name: string, input: CompileRequest, amend: (request: RunRequest) => void = () => {}) {
  const { client } = await mechanismEngine();
  input.rulesHash += `/${name}`;
  const compiled = await client.compile(input);
  expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
  const sessionId = compiled.sessionId!;
  try {
    const request = structuredClone(reference.runRequest);
    Object.assign(request, { sessionId, expectedRulesHash: input.rulesHash, initialSnapshot: simulationInitialSnapshot(input) });
    amend(request);
    const done = await client.run(request); save(name, input, request, done);
    expect(done.ok, JSON.stringify(done.errors)).toBe(true);
    expect(await client.run(request)).toEqual(done);
    return { done, request };
  } finally { expect((await client.release(sessionId, input.rulesHash)).released).toBe(true); }
}
async function invocationFailure(invoke: () => Promise<unknown>, fnName: string) {
  try { await invoke(); } catch (error) {
    expect(error).toBeInstanceOf(TinyGoV2InvocationError);
    if (!(error instanceof TinyGoV2InvocationError)) throw error;
    expect(error.fnName).toBe(fnName);
    const frames = error.frames.map(frame => ({ kind: frame.kind, payload: decodeFramePayload<Record<string, unknown>>(frame) }));
    const errors = frames.flatMap(frame => Array.isArray(frame.payload.errors) ? frame.payload.errors : [frame.payload]) as Array<Record<string, unknown>>;
    expect(errors.some(row => row.ok === false && typeof row.code === 'string')).toBe(true);
    return { fnName, code: error.code, frames, errors };
  }
  throw new Error(`本反例应由正式${fnName}错误帧拒绝`);
}
async function failedRun(name: string, input: CompileRequest, amend: (request: RunRequest) => void, code: string) {
  const { client } = await mechanismEngine(); input.rulesHash += `/${name}`;
  const compiled = await client.compile(input); expect(compiled.ok).toBe(true);
  try {
    const request = structuredClone(reference.runRequest);
    Object.assign(request, { sessionId: compiled.sessionId!, expectedRulesHash: input.rulesHash, initialSnapshot: simulationInitialSnapshot(input) });
    amend(request);
    const failure = await invocationFailure(() => client.run(request), 'engine_run'); save(name, input, request, failure);
    expect(failure.errors.some(row => row.code === code)).toBe(true);
    expect(await invocationFailure(() => client.run(request), 'engine_run')).toEqual(failure);
    return failure;
  } finally { expect((await client.release(compiled.sessionId!, input.rulesHash)).released).toBe(true); }
}
function external(request: RunRequest, input: CompileRequest, targets: Array<'source' | 'target'> = ['target', 'target']) {
  const provider = input.sharedProviders!.find(provider => provider.abilities?.some(ability => ability.operations?.some(operation => operation.skillHit?.ruleGroups?.length)))!;
  const ability = provider.abilities!.find(ability => ability.operations?.some(operation => operation.skillHit?.ruleGroups?.length))!;
  const mount = input.combatants.find(row => row.key === 'source')!.providers.find(row => row.definitionRef === provider.providerKey)!;
  const abilityRef = `source.provider[${mount.providerRef}].ability[${ability.abilityKey}]`, skillKey = ability.skillKey!;
  request.driverPlan = { entries: targets.map((target, i) => ({ entryKey: `contact_${i}`, abilityRef, source: 'source', target, firstAtMs: i + 1 })), conditionRecheckIntervalMs: 1 };
  request.skillUses = [{ useKey: 'external_use', source: 'source', skillKey, historyState: 'complete' }];
  request.skillHitFacts = targets.map((_target, i) => ({ driverEntryKey: `contact_${i}`, useRef: 'external_use', sequence: i + 1 }));
  request.attackStartFacts = []; request.processCommandFacts = [];
}

describe('同次使用命中规则组的真实Wasm边界', () => {
  it.each(['omitted', 'empty', 'null'])('无组协议%s沿旧逐候选路径，不造额度', async mode => {
    const input = structuredClone(reference.prepared.compileRequest), hit = hitOf(input);
    if (mode === 'omitted') delete hit.ruleGroups;
    else hit.ruleGroups = (mode === 'empty' ? [] : null) as never;
    const { done } = await fresh(`legacy-${mode}`, input);
    expect(done.summary.sourceDamageDealt).toBe(100);
    expect(done.finalSnapshot.useTriggerLedger ?? []).toEqual([]);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.providers).toHaveLength(2);
  }, 60000);
  it('两动作控制与独立伤害各提交一条额度，真实背景普攻保留', () => {
    expect(reference.runRequest.driverPlan.basicAttack).toBeDefined();
    expect(reference.done.summary.sourceDamageDealt).toBe(100);
    expect(reference.projection.finalUseTriggerLedger).toHaveLength(2);
    expect(reference.projection.finalProviders.filter(row => row.owner === 'target')).toHaveLength(2);
  });
  it('初始Generic法盾令伤害规则全跳写仍占额，显式blocked0控制不匹配不占额', async () => {
    const input = structuredClone(reference.prepared.compileRequest);
    input.typeCatalog.types.push({ key: 'provider/spell_shield', domain: 'provider' });
    input.sharedProviders!.push({ providerKey: 'group_probe_shield_definition', stableId: 'group_probe_shield', kind: 'character', types: ['provider/spell_shield'] });
    input.combatants.find(row => row.key === 'target')!.providers.push({ providerRef: 'group_probe_shield', definitionRef: 'group_probe_shield_definition' });
    const { done, request } = await fresh('blocked-credit', input);
    expect(done.summary.sourceDamageDealt).toBe(0);
    expect(projectUseTriggerLedger(input, request, done).map(row => row.groupKey)).toEqual(['damage_once']);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.providers.some(row => row.definitionRef.startsWith('status:lab_transfer:'))).toBe(false);
  }, 60000);
  it('第二动作当前强度非法沿正式错误通道失败并可重放释放，不伪造错误后的最终快照', async () => {
    const input = structuredClone(reference.prepared.compileRequest);
    const slow = input.sharedProviders!.find(provider => provider.statusContributions?.some(row => row.statusKind === 'movement_slow'))!;
    slow.statusContributions![0]!.strength = { op: 'add', args: [{ op: 'read', path: 'provider.elapsed_ms' }, { op: 'const', value: 2 }] };
    const failure = await failedRun('second-action-failure', input, () => {}, 'formula_type_error');
    expect(failure.errors.some(row => String(row.path).includes('statusContributions[0].strength'))).toBe(true);
  }, 60000);
  it('明确Generic两次外来真实接触同use/target只结一次，跨target范围可各结一次', async () => {
    for (const targets of [['target', 'target'], ['target', 'source']] as Array<Array<'source' | 'target'>>) {
      const input = structuredClone(reference.prepared.compileRequest);
      delete input.rules.skillActionBindings;
      const { done, request } = await fresh(`external-${targets.join('-')}`, input, request => {
        external(request, input, targets);
      });
      expect(done.summary.sourceDamageDealt).toBe(targets[1] === 'source' ? 200 : 100);
      expect(projectUseTriggerLedger(input, request, done)).toHaveLength(targets[1] === 'source' ? 4 : 2);
    }
  }, 60000);
  it('真实use缺失不能借driver/cast编号获得额度', async () => {
    const input = structuredClone(reference.prepared.compileRequest);
    delete input.rules.skillActionBindings;
    await failedRun('unknown-use', input, request => {
      external(request, input, ['target']);
      request.skillUses = [];
    }, 'unknown_ref');
  }, 60000);
  it('真实已提交额度可沿独立Generic历史使用恢复，重接触不重复写入', async () => {
    const input = structuredClone(reference.prepared.compileRequest); delete input.rules.skillActionBindings;
    const { done, request } = await fresh('restored-use', input, request => {
      external(request, input);
      const restored = structuredClone(reference.done.finalSnapshot.useTriggerLedger!);
      request.initialSnapshot.useTriggerLedger = restored;
      request.skillUses![0]!.useKey = restored[0]!.useKey;
      for (const fact of request.skillHitFacts!) fact.useRef = restored[0]!.useKey;
    });
    expect(done.summary.sourceDamageDealt).toBe(0);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.providers).toEqual([]);
    expect(projectUseTriggerLedger(input, request, done)).toEqual(reference.projection.finalUseTriggerLedger);
  }, 60000);
  it.each(['owner', 'provider', 'group', 'skill', 'source', 'duplicate'])('额度恢复拒绝%s伪造或冲突', async kind => {
    const input = structuredClone(reference.prepared.compileRequest); delete input.rules.skillActionBindings;
    await failedRun(`restore-invalid-${kind}`, input, request => {
      external(request, input);
      const restored = structuredClone(reference.done.finalSnapshot.useTriggerLedger!), row = restored[0]!;
      request.skillUses![0]!.useKey = row.useKey;
      for (const fact of request.skillHitFacts!) fact.useRef = row.useKey;
      if (kind === 'owner') row.owner = 'target';
      if (kind === 'provider') row.providerRef = 'unknown';
      if (kind === 'group') row.groupKey = 'unknown';
      if (kind === 'skill') row.useSkillKey = 'wrong_skill';
      if (kind === 'source') row.useSource = 'target';
      if (kind === 'duplicate') restored.push(structuredClone(row));
      request.initialSnapshot.useTriggerLedger = restored;
    }, 'unknown_ref');
  }, 60000);
  it.each(['missing_owner', 'foreign_group', 'foreign_mount', 'scope', 'use', 'target', 'duplicate'])('额度完整投影拒绝%s', kind => {
    const done = structuredClone(reference.done), row = done.finalSnapshot.useTriggerLedger![0]!;
    if (kind === 'missing_owner') delete (row as unknown as Record<string, unknown>).owner;
    if (kind === 'foreign_group') row.groupKey = 'not_mounted';
    if (kind === 'foreign_mount') row.providerRef = 'not_mounted';
    if (kind === 'scope') row.scope = 'provider';
    if (kind === 'use') row.useKey = 'not_a_real_use';
    if (kind === 'target') row.target = 'foreign';
    if (kind === 'duplicate') done.finalSnapshot.useTriggerLedger!.push(structuredClone(row));
    expect(() => projectUseTriggerLedger(reference.prepared.compileRequest, reference.runRequest, done)).toThrow('同次使用额度');
  });
  it('Generic明确较小组与独立候选可共存，真实作者完整闭包由宿主校验', async () => {
    const input = structuredClone(reference.prepared.compileRequest), controls = hitOf(input).ruleGroups![1]!;
    controls.candidateKeys.pop();
    const { client } = await mechanismEngine(), compiled = await client.compile(input);
    save('generic-subset-with-independent-candidate', input, null, compiled);
    try { expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true); }
    finally { if (compiled.sessionId) expect((await client.release(compiled.sessionId, input.rulesHash)).released).toBe(true); }
  }, 60000);
  it.each(['duplicate_member', 'reversed', 'first_contact', 'condition', 'scope_conflict', 'dynamic_parent'])('编译拒绝不完整或越权组%s', async kind => {
    const input = structuredClone(reference.prepared.compileRequest), hit = hitOf(input), controls = hit.ruleGroups![1]!;
    if (kind === 'duplicate_member') controls.candidateKeys.push(controls.candidateKeys[0]!);
    if (kind === 'reversed') controls.candidateKeys.reverse();
    if (kind === 'first_contact') for (const key of controls.candidateKeys) hit.candidates.find(row => row.candidateKey === key)!.eventValueConditions = [
      { key: 'first_contact', comparator: 'eq', value: { op: 'const', value: 1 } }];
    if (kind === 'condition') hit.candidates.find(row => row.candidateKey === controls.candidateKeys[0])!.operations[0]!.condition = { op: 'const', value: 1 };
    const parent = input.sharedProviders!.find(provider => provider.abilities?.some(ability => ability.operations?.some(operation => operation.skillHit === hit)))!;
    if (kind === 'scope_conflict') parent.abilities!.push({ abilityKey: 'same_key_listener', skillKey: 'lab_transfer', kind: 'passive_listener',
      types: [...(parent.abilities!.find(ability => ability.operations?.some(operation => operation.skillHit === hit))!.types ?? [])],
      listenerSpec: { listenerKey: 'same_key', eventMatcher: { all: ['event/skill_hit', 'event/source_owner'] }, maxTriggersPerEvent: 1,
        oncePerUse: { groupKey: controls.oncePerUse.groupKey, scope: 'provider' }, operations: [structuredClone(hit.candidates[0]!.operations[0]!)] } });
    if (kind === 'dynamic_parent') parent.lifecycle = { durationMs: { op: 'const', value: 10000 }, maxStacks: 1, refreshPolicy: 'replace' };
    const { client } = await mechanismEngine();
    const failure = await invocationFailure(() => client.compile(input), 'engine_compile'); save(`compile-${kind}`, input, null, failure);
    expect(failure.errors.some(row => String(row.path).includes('skillHit') || kind === 'dynamic_parent' && String(row.path).includes('processes'))).toBe(true);
  }, 60000);
  it('汇总和0预算不丢已提交额度或控制实例，同会话100次保持后释放', async () => {
    const { client } = await mechanismEngine(), input = reference.prepared.compileRequest, compiled = await client.compile(input);
    expect(compiled.ok).toBe(true);
    try {
      const zero = structuredClone(reference.runRequest); zero.sessionId = compiled.sessionId!;
      zero.recordBudget = Object.fromEntries(Object.keys(zero.recordBudget!).map(key => [key, 0]));
      const done = await client.run(zero); save('zero-records', input, zero, done);
      expect(done.finalSnapshot).toEqual(reference.done.finalSnapshot); expect(done.summary).toEqual(reference.done.summary);
      const assessment = assessSkillActionResult(input, zero, done, reference.prepared.operationOrigins);
      expect(assessment.complete, assessment.issues.join(';')).toBe(true);
      for (let i = 0; i < 100; i++) expect(await client.run(zero)).toEqual(done);
      const definition = definitions.find(row => row.caseKey === 'hit_rule_group_two_actions')!, snapshot = definition.buildSnapshot();
      const plan = snapshot.selection.plannedSkills[0]!;
      const built = await automaticSkillRequest(reference.prepared, snapshot, { durationMs: 1125, recordTimeSeries: false,
        attackSpeedInputMax: 1, maxAutomaticSkillRecords: 1000, maxHealingRecords: 1000, maxResourceChangeRecords: 1000, outputMode: 'detailed',
        rules: [{ origin: plan.origin, skillKey: plan.skillKey, skillLevel: 1, ruleKey: 'one_cast', sortOrder: 0, targetSide: 'target',
          hitPreset: 'TARGET_HIT', waitForCooldowns: [], releaseAfterRuleKey: null }] }, compiled.sessionId!);
      const automaticDetailed = await client.run(built.runRequest);
      expect(automaticDetailed.summary.sourceDamageDealt).toBe(100);
      expect(automaticDetailed.finalSnapshot.useTriggerLedger?.length).toBe(2);
      for (const mode of ['summary', 'zero'] as const) {
        const request = structuredClone(built.runRequest);
        if (mode === 'summary') request.outputMode = 'summary';
        else request.recordBudget = Object.fromEntries(Object.keys(request.recordBudget!).map(key => [key, 0]));
        const current = await client.run(request); save(`automatic-${mode}`, input, request, current);
        expect(current.finalSnapshot).toEqual(automaticDetailed.finalSnapshot);
        expect(current.summary).toEqual(automaticDetailed.summary);
        const assessed = assessAutomaticSkillResult(input, request, current, reference.prepared.operationOrigins);
        expect(assessed.complete, assessed.issues.join(';')).toBe(true);
        expect(await client.run(request)).toEqual(current);
      }
    } finally { expect((await client.release(compiled.sessionId!, input.rulesHash)).released).toBe(true); }
  }, 60000);
});
