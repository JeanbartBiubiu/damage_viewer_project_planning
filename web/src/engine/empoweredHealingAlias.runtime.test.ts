import { beforeAll, describe, expect, it } from 'vitest';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { compareMechanismExpectation, mechanismEngine, runMechanismCase, type MechanismRun } from '../../tests/mechanisms/mechanismRunner';
import { inspectEmpoweredHealingAliases } from './empoweredHealingAlias';
import { inspectSimulationHealthLedger } from './simulationHealthLedger';
import { assessSkillActionResult } from './skillActionResult';
import { assessAutomaticSkillResult } from './automaticSkillResult';
import { automaticSkillRequest } from './automaticSkillRequest';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';

const definitions = loadMechanismCases();
let lethal: MechanismRun;
beforeAll(async () => { lethal = await runMechanismCase(definitions.find(row => row.caseKey === 'empowered_quota_lethal_self_healing')!); }, 60000);

describe('配额附伤与伤害监听恢复的真实原使用', () => {
  it('实际E激活use经真实伤害事件与P挂载治疗证据接回原BAA尾', () => {
    const { prepared, runRequest, done, projection } = lethal;
    expect(compareMechanismExpectation(projection, definitions.find(row => row.caseKey === 'empowered_quota_lethal_self_healing')!.expected)).toEqual([]);
    const aliases = inspectEmpoweredHealingAliases(prepared.compileRequest, done);
    expect(aliases.issues).toEqual([]); expect(aliases.identityGaps).toEqual([]);
    expect(done.healingRecords![0]!.useRef).toBe('skill:activate');
    expect(aliases.aliases.get(done.healingRecords![0]!)).toBe(done.damageRecords![2]!.empoweredAttack!.useRef);
    expect(inspectSimulationHealthLedger(prepared.compileRequest, runRequest, done)).toEqual([]);
  });
  it.each(['event', 'heal_evidence', 'path', 'listener', 'wrong_damage_use', 'wrong_heal_use'] as const)(
    '不能借时刻或另一真实刀生成恢复关联 %s', kind => {
      const compile = structuredClone(lethal.prepared.compileRequest), done = structuredClone(lethal.done);
      const event = done.evidence.items.find(item => item.kind === 'emitted_event' && item.ref === 'event/damage_instance' && item.data?.useRef === 'skill:activate')!;
      const heal = done.evidence.items.find(item => item.kind === 'heal')!;
      if (kind === 'event') event.data!.operationRef = 'foreign';
      if (kind === 'heal_evidence') heal.data!.providerRef = 'foreign';
      if (kind === 'path') heal.data!.operationPath = 'foreign';
      if (kind === 'listener') compile.sharedProviders.find(provider => provider.skillKey === 'lab_kill_restore')!.abilities![0]!.listenerSpec!.eventMatcher.all = ['event/damage_instance'];
      if (kind === 'wrong_damage_use') done.damageRecords![2]!.empoweredAttack!.useRef = done.attackRecords![0]!.useRef;
      if (kind === 'wrong_heal_use') {
        done.healingRecords![0]!.useRef = done.attackRecords![0]!.useRef;
        heal.data!.useRef = done.attackRecords![0]!.useRef;
      }
      expect(inspectSimulationHealthLedger(compile, lethal.runRequest, done).length).toBeGreaterThan(0);
    });
  it('证据截断只降低独立归属证明，不丢弃真实治疗记录或凭时刻补另一刀', () => {
    const done = structuredClone(lethal.done);
    done.evidence.items = []; done.evidence.truncated = true;
    const aliases = inspectEmpoweredHealingAliases(lethal.prepared.compileRequest, done);
    expect(aliases.issues).toEqual([]); expect(aliases.identityGaps).toHaveLength(1);
    expect(inspectSimulationHealthLedger(lethal.prepared.compileRequest, lethal.runRequest, done)).toEqual([]);
  });
  it.each(['owner', 'path', 'before', 'after_modifiers', 'event_source', 'event_operation'] as const)('截断不能掩盖已保留候选的矛盾 %s', kind => {
    const done = structuredClone(lethal.done); done.evidence.truncated = true;
    const heal = done.evidence.items.find(item => item.kind === 'heal')!;
    const event = done.evidence.items.find(item => item.kind === 'emitted_event' && item.ref === 'event/damage_instance' && item.data?.useRef === 'skill:activate')!;
    if (kind === 'owner') heal.data!.owner = 'target';
    if (kind === 'path') heal.data!.operationPath = 'foreign';
    if (kind === 'before') heal.data!.hpBefore = 201;
    if (kind === 'after_modifiers') heal.data!.healingAfterModifiers = 31;
    if (kind === 'event_source') event.data!.source = 'target';
    if (kind === 'event_operation') event.data!.operationRef = 'foreign';
    expect(inspectEmpoweredHealingAliases(lethal.prepared.compileRequest, done).issues.length).toBeGreaterThan(0);
  });
  it('真实0记录预算保留额度、直接治疗累计与最终生命，同会话重放并释放', async () => {
    const { client } = await mechanismEngine(), compile = lethal.prepared.compileRequest;
    const compiled = await client.compile(compile);
    expect(compiled.ok).toBe(true);
    try {
      const request = structuredClone(lethal.runRequest); request.sessionId = compiled.sessionId!;
      request.recordBudget = Object.fromEntries(Object.keys(request.recordBudget!).map(key => [key, 0]));
      const done = await client.run(request);
      expect(done.summary).toEqual(lethal.done.summary);
      expect(done.finalSnapshot).toEqual(lethal.done.finalSnapshot);
      expect(assessSkillActionResult(compile, request, done, lethal.prepared.operationOrigins).complete).toBe(true);
      expect(await client.run(request)).toEqual(done);
    } finally { expect((await client.release(compiled.sessionId!, compile.rulesHash)).released).toBe(true); }
  }, 60000);
  it('真实自动E/R共享输入在summary与0预算下保留永久初始化、额度与完整累计', async () => {
    const definition = definitions.find(row => row.caseKey === 'permanent_health_damage_max_minus_base')!, snapshot = definition.buildSnapshot();
    const reference = await runMechanismCase(definition), compile = reference.prepared.compileRequest;
    const { client } = await mechanismEngine(), compiled = await client.compile(compile);
    expect(compiled.ok).toBe(true);
    try {
      const rules = snapshot.selection.plannedSkills.map((plan, sortOrder) => ({ ...plan, ruleKey: `rule_${sortOrder}`, sortOrder,
        targetSide: plan.skillKey === 'lab_true_strike' ? 'source' as const : 'target' as const,
        hitPreset: plan.skillKey === 'lab_true_strike' ? null : 'TARGET_HIT' as const, waitForCooldowns: [], releaseAfterRuleKey: null }));
      expect(new Set(rules.map(rule => simulationSkillSourceIdentity(rule.origin, rule.skillKey))).size).toBe(2);
      const { runRequest } = await automaticSkillRequest(reference.prepared, snapshot, { rules, durationMs: 3500, attackSpeedInputMax: 5,
        recordTimeSeries: false, outputMode: 'detailed', maxAutomaticSkillRecords: 1000, maxHealingRecords: 1000, maxResourceChangeRecords: 1000 }, compiled.sessionId!);
      const detailed = await client.run(runRequest);
      expect(detailed.summary.sourceDamageDealt).toBe(750);
      expect(assessAutomaticSkillResult(compile, runRequest, detailed, reference.prepared.operationOrigins).complete).toBe(true);
      for (const summary of [false, true]) {
        const request = structuredClone(runRequest);
        if (summary) request.outputMode = 'summary';
        else request.recordBudget = Object.fromEntries(Object.keys(request.recordBudget!).map(key => [key, 0]));
        const done = await client.run(request);
        expect(done.summary).toEqual(detailed.summary); expect(done.finalSnapshot).toEqual(detailed.finalSnapshot);
        expect(assessAutomaticSkillResult(compile, request, done, reference.prepared.operationOrigins).complete).toBe(true);
        expect(await client.run(request)).toEqual(done);
      }
    } finally { expect((await client.release(compiled.sessionId!, compile.rulesHash)).released).toBe(true); }
  }, 60000);
});
