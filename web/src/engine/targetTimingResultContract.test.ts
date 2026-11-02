import { describe, expect, it } from 'vitest';
import type { AbilityDefinition, CompileRequest, DamageRecord, DoneResult, EvidenceItem, OperationDefinition, RunRequest } from '../types/genericEngine';
import type { OperationOrigin } from './simulation/model';
import { inspectDamageStateBefore, targetTimingDamageOriginMatches } from './targetTimingResultContract';

const constant = (value: number) => ({ op: 'const', value });
const abilityRef = (key: string) => `source.provider[timing].ability[${key}]`;
const damageRef = 'skills.lab_timing.effects.periodic.results.damage';
const restoreRef = 'skills.lab_timing.effects.terminal.results.mana';
const slot = (current: number, max = current) => ({ base: max, resolved: max, max, current });

function fixture() {
  const damageOperation: OperationDefinition = { operation: 'damage', target: 'target', ref: damageRef,
    amount: constant(20), damageType: 'physics', critEligible: false, vampQualification: 'RESOLVED',
    types: ['damage_trait/delivery_skill', 'damage_trait/origin_direct'] };
  const tick: AbilityDefinition = { abilityKey: 'periodic', skillKey: 'lab_timing', kind: 'tick',
    types: ['ability/skill_category/passive', 'ability/skill/lab_timing'],
    tickSpec: { intervalMs: 250, startDelayMs: 0, phasePolicy: 'preserve_on_extend',
      anchorScope: 'state_scope/provider_target', anchorStateKey: 'phase', onTick: [damageOperation] } };
  const onHit: AbilityDefinition = { abilityKey: 'apply', kind: 'passive_listener', skillKey: 'lab_timing',
    listenerSpec: { listenerKey: 'apply', maxTriggersPerEvent: 1,
      eventMatcher: { all: ['event/skill_hit', 'event/source_owner', 'ability/skill/bolt', 'ability/target_timing_hit/bolt_mount'] },
      operations: [{ operation: 'state_change', target: 'self', ref: 'phase', valuePolicy: 'set', amount: constant(1), types: ['state_scope/provider_target'] }] } };
  const consumer: AbilityDefinition = { abilityKey: 'terminal', skillKey: 'lab_timing', kind: 'passive_listener',
    params: { mana_award: 40 }, listenerSpec: { listenerKey: 'terminal', maxTriggersPerEvent: 1,
      eventMatcher: { all: ['event/damage_instance', 'event/source_owner'] },
      condition: { op: 'gt', args: [{ op: 'read', path: 'event.provider_target_state_before.layers' }, constant(0)] },
      operations: [{ operation: 'resource_change', target: 'self', resourceKey: 'mana', ref: restoreRef,
        amount: { op: 'read', path: 'ability.param.mana_award' } }] } };
  const provider = { providerKey: 'timing_definition', skillKey: 'lab_timing', kind: 'character', stableId: 'synthetic_timing',
    initialStateSchema: {
      phase: { valueType: 'integer' as const, defaultValue: 0, maxValue: 1, durationMs: 4000, refreshPolicy: 'refresh_on_write' },
      layers: { valueType: 'integer' as const, defaultValue: 0, maxValue: 3, durationMs: 4000, refreshPolicy: 'refresh_on_write' }
    }, abilities: [tick, onHit, consumer] };
  const compile: CompileRequest = { schemaVersion: 'test', schemaHash: 'schema', rulesHash: 'rules', typeCatalog: { types: [], relations: [] },
    combatants: [{ key: 'source', attributes: { hp: slot(500, 1000) }, resources: { mana: { current: 80, max: 100 } },
      providers: [{ providerRef: 'timing', definitionRef: provider.providerKey }] },
    { key: 'target', attributes: { hp: slot(20) }, resources: {}, providers: [] }], sharedProviders: [provider],
    rules: { skillActionBindings: [{ bindingKey: 'bolt', source: 'source', skillKey: 'bolt', providerRef: 'bolt_mount', providerDefinitionRef: 'bolt_definition',
      controls: [{ action: 'INITIAL', abilityRef: 'source.provider[bolt_mount].ability[initial]', processKey: 'cast' }], hitBindings: [] }] } };
  const snapshotActor = (key: 'source' | 'target') => ({ key, attributes: { hp: slot(key === 'source' ? 500 : 20, key === 'source' ? 1000 : 20) },
    resources: key === 'source' ? { mana: { current: 80, max: 100 } } : {}, cooldowns: {}, shields: [], abilityState: {}, providerState: {}, vars: {},
    providers: key === 'source' ? [{ providerRef: 'timing', definitionRef: provider.providerKey, owner: 'source' as const,
      source: 'source' as const, stacks: 1, state: {}, expireAt: null }] : [] });
  const request: RunRequest = { sessionId: 'synthetic', expectedRulesHash: 'rules', schemaVersion: 'test', schemaHash: 'schema', rulesHash: 'rules',
    initialSnapshot: { schemaHash: 'schema', rulesHash: 'rules', timeMs: 0, combatants: [snapshotActor('source'), snapshotActor('target')] },
    driverPlan: { entries: [], conditionRecheckIntervalMs: 1 }, stopPolicy: { durationMs: 250, stopOnTargetDeath: false, stopWhenNoEvents: false },
    sampling: { disabled: true, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 0 } };
  const damage: DamageRecord = { damageId: 1, owner: 'source', source: 'source', target: 'target',
    abilityRef: abilityRef('periodic'), providerDefinitionRef: provider.providerKey, operationRef: damageRef,
    operationPath: 'sharedProviders[0].abilities[0].tickSpec.onTick[0]', damageType: 'physics', useRef: '',
    timeMs: 250, castInstanceId: 0, attackIndex: null, rawAmount: 20, postDefenseDamage: 20, shieldAbsorbed: 0,
    actualHpLoss: 20, overkillDamage: 0, hpBefore: 20, hpAfter: 0, sourceHpBefore: 500, sourceHpAfter: 500 };
  const before: EvidenceItem = { timeMs: 250, kind: 'damage_state_before', ref: 'timing', data: {
    damageId: 1, owner: 'source', providerRef: 'timing', definitionRef: provider.providerKey, stateKey: 'layers', target: 'target', beforeValue: 2 } };
  const event: EvidenceItem = { timeMs: 250, kind: 'emitted_event', ref: 'event/damage_instance', data: {
    damageId: 1, source: 'source', target: 'target', damage: { killed: 1 }, abilityRef: abilityRef('periodic'),
    damageType: 'physics', operationRef: damageRef, traits: ['damage_trait/delivery_skill', 'damage_trait/origin_direct'] } };
  // 手算：请求40，原80/100，真实恢复20，溢出20。伤害20恰好击杀20生命目标。
  const restore: EvidenceItem = { timeMs: 250, kind: 'resource_restore', ref: restoreRef, data: {
    owner: 'source', source: 'source', target: 'source', providerRef: 'timing', providerDefinitionRef: provider.providerKey,
    abilityRef: abilityRef('terminal'), operationRef: restoreRef, resourceKey: 'mana', requestedAmount: 40,
    operationPath: 'sharedProviders[0].abilities[2].listenerSpec.operations[0]', useRef: null,
    currentBefore: 80, currentAfter: 100, actualDelta: 20, overflow: 20,
    triggerDamageId: 1, triggerDamageSource: 'source', triggerDamageTarget: 'target' } };
  const final = structuredClone(request.initialSnapshot);
  final.timeMs = 250; final.combatants[0]!.resources.mana!.current = 100; final.combatants[1]!.attributes.hp!.current = 0;
  const done: DoneResult = { ok: true, summary: { durationMs: 250, stopReason: 'duration_reached', sourceFinalHp: 500, targetFinalHp: 0,
    sourceDamageDealt: 20, sourceDamageTaken: 0, targetDamageDealt: 0, targetDamageTaken: 20,
    abilityAttemptCount: 0, abilityCastCount: 0, attemptSkippedCount: 0, warningCount: 0, evidenceTruncated: false, seriesDownsampled: false, abilityStats: [] },
    finalSnapshot: final, series: [], warnings: [], evidence: { items: [before, event, restore], truncated: false,
      truncatedEvidenceCount: 0, countsByKind: { damage_state_before: 1, emitted_event: 1, resource_restore: 1 } },
    seriesSamplingEvidence: { requestedSampleEveryMs: 100, effectiveSampleEveryMs: 0, requestedPointCount: 0, finalPointCount: 0,
      maxSeriesPoints: 0, downsampled: false, method: 'disabled' }, damageRecords: [damage],
    recording: { attackRecordCount: 0, returnedAttackRecords: 0, droppedAttackRecords: 0, attackRecordsTruncated: false,
      damageRecordCount: 1, returnedDamageRecords: 1, droppedDamageRecords: 0, damageRecordsTruncated: false,
      mechanicRecordCount: 0, returnedMechanicRecords: 0, droppedMechanicRecords: 0, mechanicRecordsTruncated: false } };
  const origin: OperationOrigin = { abilityRef: abilityRef('periodic'), operationRef: damageRef, skillKey: 'lab_timing',
    effectKey: 'periodic', resultKey: 'damage', providerDefinitionRef: provider.providerKey, compiledPaths: [damage.operationPath] };
  return { compile, request, done, provider, tick, onHit, consumer, damageOperation, origin, damage, before, event, restore };
}
type Fixture = ReturnType<typeof fixture>;
const inspect = (s: Fixture) => inspectDamageStateBefore(s.compile, s.request, s.done);
const originMatches = (s: Fixture) => targetTimingDamageOriginMatches(s.compile, s.provider, s.tick, s.origin, s.damageOperation);

describe('逐伤前值与回蓝的真实因果结果检查', () => {
  it('精确七字段前值、同damageId致死事件和40请求/20实际/20溢出闭合', () => {
    const sample = fixture();
    expect(inspect(sample)).toEqual({ issues: [], identityGaps: [] });
    expect(Object.keys(sample.before.data!)).toHaveLength(7);
  });

  const invalid: Array<[string, (s: Fixture) => void]> = [
    ['前值额外字段', s => { s.before.data!.extra = 1; }],
    ['前值缺字段', s => { delete s.before.data!.definitionRef; }],
    ['零伤害编号', s => { s.before.data!.damageId = 0; }],
    ['非整数前值', s => { s.before.data!.beforeValue = 0.5; }],
    ['负前值', s => { s.before.data!.beforeValue = -1; }],
    ['超真实容量的前值', s => { s.before.data!.beforeValue = 4; }],
    ['重复冻结证据', s => { s.done.evidence.items.push(structuredClone(s.before)); s.done.evidence.countsByKind.damage_state_before = 2; }],
    ['外来provider', s => { s.before.data!.providerRef = 'foreign'; }],
    ['外来定义', s => { s.before.data!.definitionRef = 'foreign'; }],
    ['错误拥有者', s => { s.before.data!.owner = 'target'; }],
    ['前值ref不匹配', s => { s.before.ref = 'foreign'; }],
    ['前值时刻不匹配', s => { s.before.timeMs = 249; }],
    ['伤害双方不匹配', s => { s.damage.target = 'foreign'; }],
    ['逐伤事件编号不匹配', s => { s.event.data!.damageId = 2; }],
    ['逐伤事件击杀事实不匹配', s => { (s.event.data!.damage as Record<string, unknown>).killed = 0; }],
    ['缺冻结事实', s => { s.done.evidence.items = s.done.evidence.items.filter(row => row !== s.before); s.done.evidence.countsByKind.damage_state_before = 0; }],
    ['无读者混入事实', s => { delete s.consumer.listenerSpec!.condition; }],
    ['混用受伤监听', s => { s.consumer.listenerSpec!.eventMatcher.all![0] = 'event/damage_taken'; }],
    ['读取计时锚前值', s => { s.consumer.listenerSpec!.condition = { op: 'read', path: 'event.provider_target_state_before.phase' }; }],
    ['恢复没有触发编号', s => { delete s.restore.data!.triggerDamageId; }],
    ['恢复触发到另一笔', s => { s.restore.data!.triggerDamageId = 2; }],
    ['恢复外来拥有者', s => { s.restore.data!.owner = 'target'; }],
    ['恢复外来能力', s => { s.restore.data!.abilityRef = 'source.provider[foreign].ability[terminal]'; }],
    ['恢复外来操作', s => { s.restore.data!.operationRef = 'foreign'; }],
    ['恢复接收者不符', s => { s.restore.data!.target = 'target'; }],
    ['恢复触发目标不符', s => { s.restore.data!.triggerDamageTarget = 'source'; }],
    ['非致死伤害回蓝', s => { s.damage.hpAfter = 1; (s.event.data!.damage as Record<string, unknown>).killed = 0; }],
    ['前值不满足实际恢复条件', s => { s.before.data!.beforeValue = 0; }],
    ['恢复外来使用', s => { s.restore.data!.useRef = 'foreign_use'; }],
    ['恢复外来编译路径', s => { s.restore.data!.operationPath = 'sharedProviders[9].abilities[99].listenerSpec.operations[3]'; }],
    ['实际伤害不匹配监听技能类型', s => { s.consumer.listenerSpec!.eventMatcher.all!.push('ability/skill/bolt'); }],
    ['截断伤害仍保留相矛盾的使用事件', s => {
      s.done.damageRecords = []; s.done.recording!.damageRecordsTruncated = true;
      s.event.data!.useRef = 'real_use'; s.restore.data!.useRef = 'foreign_use';
    }],
    ['截断伤害仍保留相矛盾的技能类型', s => {
      s.done.damageRecords = []; s.done.recording!.damageRecordsTruncated = true;
      s.consumer.listenerSpec!.eventMatcher.all!.push('ability/skill/bolt');
    }],
    ['重复同伤恢复', s => { s.done.evidence.items.push(structuredClone(s.restore)); s.done.evidence.countsByKind.resource_restore = 2; }],
    ['恢复金额篡改但仍守恒', s => { s.restore.data!.requestedAmount = 30; s.restore.data!.overflow = 10; }],
    ['恢复前后资源不守恒', s => { s.restore.data!.currentAfter = 99; }],
    ['恢复单笔超真实容量而终值仍守恒', s => {
      Object.assign(s.restore.data!, { currentBefore: 200, currentAfter: 200, actualDelta: 0, overflow: 40 });
      s.done.finalSnapshot.combatants[0]!.resources.mana!.current = 80;
    }],
    ['恢复单笔错误夹取', s => {
      Object.assign(s.restore.data!, { currentBefore: 75, currentAfter: 95, actualDelta: 20, overflow: 20 });
    }],
    ['前值计数小于保留前缀', s => { s.done.evidence.countsByKind.damage_state_before = 0; }],
    ['完整模式前值计数大于保留前缀', s => { s.done.evidence.countsByKind.damage_state_before = 2; }]
  ];
  it.each(invalid)('明确拒绝%s', (_name, mutate) => {
    const sample = fixture(); mutate(sample);
    expect(inspect(sample).issues.length).toBeGreaterThan(0);
  });

  it.each(['summary', 'zero_damage', 'zero_evidence'] as const)('%s只报告身份缺口，保留真实累计，不误报金额失败', mode => {
    const sample = fixture();
    if (mode === 'summary') { sample.request.outputMode = 'summary'; sample.done.outputMode = 'summary'; }
    if (mode === 'zero_damage') sample.request.recordBudget = { maxDamageRecords: 0 };
    if (mode !== 'zero_evidence') {
      sample.done.damageRecords = [];
      Object.assign(sample.done.recording!, { returnedDamageRecords: 0, droppedDamageRecords: 1, damageRecordsTruncated: mode !== 'summary' });
    }
    if (mode !== 'zero_damage') {
      sample.done.evidence.items = [];
      sample.done.evidence.truncated = true;
      sample.done.evidence.truncatedEvidenceCount = 3;
    }
    const result = inspect(sample);
    expect(result.issues).toEqual([]);
    expect(result.identityGaps.length).toBeGreaterThan(0);
    expect(sample.done.evidence.countsByKind.damage_state_before).toBe(1);
    expect(sample.done.summary.sourceDamageDealt).toBe(20);
  });

  it('截断输出仍拒绝保留下来的外来事实，不按缺口放宽身份', () => {
    const sample = fixture(); sample.done.evidence.truncated = true; sample.before.data!.providerRef = 'foreign';
    const result = inspect(sample);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.identityGaps.length).toBeGreaterThan(0);
  });

  it('旧会话不新增逐伤事实或因果恢复字段', () => {
    const sample = fixture(); delete sample.consumer.listenerSpec!.condition;
    sample.done.evidence.items = []; sample.done.evidence.countsByKind = {};
    expect(inspect(sample)).toEqual({ issues: [], identityGaps: [] });
  });

  it('完整细节不能连伤害、冻结和恢复一并遗漏后签通过', () => {
    const sample = fixture(); sample.done.evidence.items = [sample.event];
    sample.done.evidence.countsByKind = { emitted_event: 1 };
    expect(inspect(sample).issues.length).toBeGreaterThan(0);
  });
});

describe('显式目标时序伤害的作者起源授权', () => {
  it('真实永久挂载、同父周期锚和实际命中来源闭合才授权', () => expect(originMatches(fixture())).toBe(true));
  it('预约8条作者叶保留真实父能力与唯一伤害起源', () => {
    const sample = fixture();
    Object.assign(sample.provider.initialStateSchema, {
      phase_b: { ...sample.provider.initialStateSchema.phase }, phase_c: { ...sample.provider.initialStateSchema.phase },
      reservation: { ...sample.provider.initialStateSchema.phase, durationMs: 2000 },
      restriction: { ...sample.provider.initialStateSchema.phase }
    });
    const state = (ref: string, value: number): OperationDefinition => ({ operation: 'state_change', target: 'self',
      ref, valuePolicy: 'set', amount: constant(value), types: ['state_scope/provider_target'] });
    const alive = { op: 'gt', args: [{ op: 'read', path: 'target.attr.hp.current' }, constant(0)] };
    sample.tick.kind = 'stateful'; delete sample.tick.tickSpec;
    sample.tick.targetExpirySpec = { anchorScope: 'state_scope/provider_target', anchorStateKey: 'reservation', onExpire: [
      state('phase', 0), state('phase_b', 0), state('phase_c', 0), state('layers', 0), sample.damageOperation,
      state('restriction', 1), { ...state('phase', 1), condition: alive }, { ...state('layers', 1), condition: alive }
    ] };
    expect(sample.tick.targetExpirySpec.onExpire).toHaveLength(8);
    expect(originMatches(sample)).toBe(true);
  });
  const invalid: Array<[string, (s: Fixture) => void]> = [
    ['旧无相位周期', s => { delete s.tick.tickSpec!.phasePolicy; }],
    ['临时item', s => { s.provider.kind = 'item'; }],
    ['缺稳定身份', s => { s.provider.stableId = ''; }],
    ['第二挂载', s => { s.compile.combatants[0]!.providers.push({ providerRef: 'duplicate', definitionRef: s.provider.providerKey }); }],
    ['目标拥有者', s => { s.compile.combatants[1]!.providers = s.compile.combatants[0]!.providers; s.compile.combatants[0]!.providers = []; }],
    ['外来技能起源', s => { s.origin.skillKey = 'other'; }],
    ['外来能力起源', s => { s.origin.abilityRef = 'source.provider[other].ability[periodic]'; }],
    ['没有实际命中来源', s => { s.compile.rules.skillActionBindings = []; }],
    ['遗漏实际命中类型', s => { s.onHit.listenerSpec!.eventMatcher.all = ['event/skill_hit', 'event/source_owner', 'ability/skill/bolt']; }],
    ['多个周期伤害', s => { s.tick.tickSpec!.onTick.push({ ...s.damageOperation }); }],
    ['计时能力夹带主动操作', s => { s.tick.operations = [s.damageOperation]; }],
    ['非零冷启动', s => { s.provider.initialStateSchema.phase.defaultValue = 1; }]
  ];
  it.each(invalid)('拒绝%s', (_name, mutate) => { const sample = fixture(); mutate(sample); expect(originMatches(sample)).toBe(false); });
});
