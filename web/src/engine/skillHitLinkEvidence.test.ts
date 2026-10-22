import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMechanismCase } from '../../tests/mechanisms/mechanismCase';
import { mechanismEngine, runMechanismCase, type MechanismRun } from '../../tests/mechanisms/mechanismRunner';
import type { DoneResult } from '../types/genericEngine';
import { inspectSkillHitLinkEvidence } from './skillHitLinkEvidence';
import { assessSkillActionResult } from './skillActionResult';

let actual: MechanismRun;
let summary: DoneResult;
let zero: DoneResult;
beforeAll(async () => {
  const path = new URL('../../tests/mechanisms/cases/skill_hit_links_mixed_two_uses.json', import.meta.url);
  actual = await runMechanismCase(parseMechanismCase(readFileSync(path), path.pathname));
  const { client } = await mechanismEngine(), compiled = await client.compile(actual.prepared.compileRequest);
  expect(compiled.ok).toBe(true);
  if (!compiled.sessionId) throw Error('Missing actual session');
  try {
    summary = await client.run({ ...actual.runRequest, sessionId: compiled.sessionId, outputMode: 'summary' });
    zero = await client.run({ ...actual.runRequest, sessionId: compiled.sessionId, recordBudget: {
      maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0, maxHealingRecords: 0,
      maxSkillActionRecords: 0, maxSkillUseRecords: 0, maxResourceChangeRecords: 0
    } });
    expect(summary.ok).toBe(true); expect(zero.ok).toBe(true);
  } finally { expect((await client.release(compiled.sessionId, actual.prepared.compileRequest.rulesHash)).released).toBe(true); }
}, 60000);
const clone = () => structuredClone(actual);
const inspect = (row = actual) => inspectSkillHitLinkEvidence(row.prepared.compileRequest, row.runRequest, row.done, row.prepared.operationOrigins);
const packet = (row: MechanismRun) => row.done.evidence.items.find(item => item.kind === 'emitted_event'
  && item.ref === 'event/attack_link_applied' && item.data?.useRef === 'skill:first')!;
const application = (row: MechanismRun) => row.done.evidence.items.find(item => item.kind === 'link_application'
  && item.data?.eventType === 'event/attack_link_applied' && item.data.useRef === 'skill:first')!;
const child = (row: MechanismRun) => row.done.damageRecords!.find(record => record.operationRef === 'skills.lab_attack_echo.effects.echo.results.damage'
  && record.useRef === 'skill:first')!;

describe('两类链接附伤只承认真实原使用、生产路径和事件', () => {
  it('HIT及普攻开始链接保留真实身份，普攻攻击链接无hitRef仍合法', () => {
    expect(inspect()).toEqual({ issues: [], identityGaps: [] });
    expect(assessSkillActionResult(actual.prepared.compileRequest, actual.runRequest, actual.done, actual.prepared.operationOrigins))
      .toMatchObject({ complete: true, factsValid: true, detailIdentityVerified: true, issues: [] });
    const onAttack = actual.done.damageRecords!.filter(row => row.operationRef === 'skills.lab_attack_echo.effects.echo.results.damage');
    expect(onAttack.filter(row => row.attackIndex !== null).every(row => row.hitRef === null)).toBe(true);
    expect(new Set(onAttack.map(row => row.useRef)).size).toBe(4);
  });
  it.each(['use', 'type', 'source', 'target', 'skill', 'time', 'path', 'count', 'index', 'zero', 'fraction'] as const)('篡改真实链接%s即拒绝', kind => {
    const row = clone(), event = packet(row);
    if (kind === 'use') event.data!.useRef = 'skill:second';
    if (kind === 'type') { event.ref = 'event/hit_link_applied'; event.data!.eventType = event.ref; }
    if (kind === 'source') event.data!.source = 'target';
    if (kind === 'target') event.data!.target = 'source';
    if (kind === 'skill') event.data!.skillKey = 'lab_attack_echo';
    if (kind === 'time') event.timeMs++;
    if (kind === 'path') event.path = child(row).operationPath;
    if (kind === 'count') event.data!.LINK_COUNT = 2;
    if (kind === 'index') event.data!.LINK_INDEX = 2;
    if (kind === 'zero') event.data!.LINK_COUNT = 0;
    if (kind === 'fraction') event.data!.LINK_INDEX = .5;
    expect(inspect(row).issues.length).toBeGreaterThan(0);
  });
  it.each(['event', 'application', 'damage', 'duplicate_event', 'duplicate_damage', 'damage_use', 'damage_path', 'author', 'compiled_kind'] as const)(
    '缺失或伪造%s不能凭汇总放行', kind => {
      const row = clone(), event = packet(row), record = child(row);
      if (kind === 'event') row.done.evidence.items = row.done.evidence.items.filter(item => item !== event);
      if (kind === 'application') row.done.evidence.items = row.done.evidence.items.filter(item => item !== application(row));
      if (kind === 'damage') row.done.evidence.items = row.done.evidence.items.filter(item => item.kind !== 'damage' || item.data?.damageId !== record.damageId);
      if (kind === 'duplicate_event') row.done.evidence.items.splice(row.done.evidence.items.indexOf(event) + 1, 0, structuredClone(event));
      if (kind === 'duplicate_damage') row.done.damageRecords!.push({ ...record, damageId: 999 });
      if (kind === 'damage_use') record.useRef = 'skill:second';
      if (kind === 'damage_path') record.operationPath += '.other';
      if (kind === 'author') row.prepared.operationOrigins.find(origin => origin.compiledPaths.includes(event.path!))!.abilityRef = 'source.provider[foreign].ability[no]';
      if (kind === 'compiled_kind') {
        const candidates = row.prepared.compileRequest.sharedProviders!.flatMap(provider => provider.abilities ?? [])
          .flatMap(ability => ability.operations ?? []).flatMap(operation => operation.skillHit?.candidates ?? []);
        const operation = candidates.flatMap(candidate => candidate.operations).find(operation => operation.ref === application(row).ref)!;
        operation.operation = 'apply_hit_link';
      }
      expect(inspect(row).issues.length).toBeGreaterThan(0);
    });
  it('真实施加和事件同时改成另一技能仍不能借用原使用', () => {
    const row = clone(); packet(row).data!.skillKey = 'lab_attack_echo'; application(row).data!.skillKey = 'lab_attack_echo';
    expect(inspect(row).issues.join(';')).toContain('原技能');
  });
  it.each(['none', 'any', 'all'] as const)('不能忽略真实监听matcher的%s限制', field => {
    const row = clone(), provider = row.prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === 'source_natural_skill_1_definition')!;
    const matcher = provider.abilities![0]!.listenerSpec!.eventMatcher;
    if (field === 'none') matcher.none = ['event/attack_link_applied'];
    if (field === 'any') matcher.any = ['ability/basic_attack'];
    if (field === 'all') matcher.all!.push('ability/basic_attack');
    expect(inspect(row).issues.length).toBeGreaterThan(0);
  });
  it('同一个真实事件可供两个独立监听消费，不能全局只消费一次', () => {
    const row = clone(), original = row.prepared.operationOrigins.find(origin => origin.skillKey === 'lab_attack_echo' && origin.resultKey === 'damage')!;
    const providerIndex = row.prepared.compileRequest.sharedProviders!.findIndex(provider => provider.providerKey === 'source_natural_skill_1_definition');
    const provider = row.prepared.compileRequest.sharedProviders![providerIndex]!, ability = structuredClone(provider.abilities![0]!);
    ability.abilityKey = 'independent_echo'; provider.abilities!.push(ability);
    const abilityRef = 'source.provider[source_natural_skill_1].ability[independent_echo]', path = `sharedProviders[${providerIndex}].abilities[1].listenerSpec.operations[0]`;
    row.prepared.operationOrigins.push({ ...original, abilityRef, compiledPaths: [path] });
    const record = { ...child(row), damageId: 999, abilityRef, operationPath: path };
    row.done.damageRecords!.push(record);
    const evidence = structuredClone(row.done.evidence.items.find(item => item.kind === 'damage' && item.data?.damageId === child(row).damageId)!);
    evidence.ref = abilityRef; evidence.data!.abilityRef = abilityRef; evidence.data!.damageId = 999;
    row.done.evidence.items.push(evidence);
    expect(inspect(row)).toEqual({ issues: [], identityGaps: [] });
  });
  it('有后来保留的伤害证据时，截断标记不能掩盖更早链接事件被删除', () => {
    const row = clone(), event = packet(row);
    row.done.evidence.items = row.done.evidence.items.filter(item => item !== event); row.done.evidence.truncated = true;
    expect(inspect(row).issues.length).toBeGreaterThan(0);
  });
  it('真实汇总及零记录预算只声明缺少身份明细，不改数值或伪造证明', () => {
    for (const [done, request] of [[summary, { ...actual.runRequest, outputMode: 'summary' as const }], [zero, actual.runRequest]] as const) {
      const result = inspectSkillHitLinkEvidence(actual.prepared.compileRequest, request, done, actual.prepared.operationOrigins);
      expect(result.issues).toEqual([]); expect(result.identityGaps.length).toBeGreaterThan(0);
      expect(done.summary.sourceDamageDealt).toBe(actual.done.summary.sourceDamageDealt);
      expect(done.damageRecords ?? []).toEqual([]);
    }
  });
  it('证据只剩真实前缀时，尾部因果不可证明与数值错误分别记录', () => {
    const row = clone(); row.done.evidence.items = []; row.done.evidence.truncated = true;
    const result = inspect(row);
    expect(result.issues).toEqual([]); expect(result.identityGaps.length).toBeGreaterThan(0);
  });
});
