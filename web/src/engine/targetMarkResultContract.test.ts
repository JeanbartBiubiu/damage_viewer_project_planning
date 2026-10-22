import { describe, expect, it } from 'vitest';
import type {
  AbilityDefinition, CompileRequest, DamageRecord, DoneResult, EvidenceItem, ProcessInstanceSnapshot, RunRequest, SkillActionBinding
} from '../types/genericEngine';
import type { OperationOrigin } from './simulationAdapter';
import { inspectTargetMarkResult, targetMarkDamageOriginMatches } from './targetMarkResultContract';

const ref = (provider: string, ability: string) => `source.provider[${provider}].ability[${ability}]`;
const constant = (value: number) => ({ op: 'const', value });
const slot = (current: number, max = current) => ({ base: max, resolved: max, max, current });
const path = 'sharedProviders[0].abilities[2].listenerSpec.operations[0]';
const damagePath = `${path}.targetMark.damage`;
const damageRef = 'skills.mark.effects.burst.results.magic';
const restoreRef = 'skills.mark.effects.burst.results.mana';
const consumeRef = 'skills.mark.triggerRules.consume.actions.burst';
function process(provider: string, skill: string, use: string, start: number, hit: number): ProcessInstanceSnapshot {
  return { owner: 'source', providerRef: provider, processKey: 'cast', skillKey: skill, useKey: use, target: 'target',
    stepKey: 'hit', stepVersion: 1, stepExecutionIndex: 0, lastExecutionAtMs: hit, stepCompletedAtMs: hit,
    startedAtMs: start, stepStartedAtMs: start, advanceAtMs: hit, expiresAtMs: null, actualCosts: {}, cooldownStarted: true,
    status: 'complete', failureReason: null, finishedAtMs: hit, repeat: null, actionOccupancies: [] };
}
function binding(provider: string, skill: string): SkillActionBinding {
  return { bindingKey: skill, source: 'source', providerRef: provider, providerDefinitionRef: `${provider}_def`, skillKey: skill,
    controls: [{ action: 'INITIAL', abilityRef: ref(provider, 'initial'), processKey: 'cast' }],
    hitBindings: [{ hitBindingKey: 'contact', processKey: 'cast', moment: { momentType: 'STEP_EXECUTION', stepKey: 'hit' }, hitAbilityRef: ref(provider, 'hit') }] };
}
function root(provider: string, skill: string, basic = false): AbilityDefinition[] {
  return [{ abilityKey: 'initial', skillKey: skill, kind: 'active', processControl: { action: 'INITIAL', processKey: 'cast' } },
    { abilityKey: 'hit', skillKey: skill, kind: 'active', types: [basic ? 'ability/basic_attack' : 'ability/spell', `ability/skill/${skill}`],
      operations: [{ operation: 'resolve_skill_hit', target: 'target', skillHit: { skillKey: skill, candidates: [{ candidateKey: 'root',
        effectOccurrenceKey: 'root', effectKey: 'root', resultKey: 'root', semantic: { resultType: 'DAMAGE', target: 'TARGET', moment: 'INSTANT' },
        spellShieldBlockScope: 'SKILL', operations: [{ operation: 'damage', target: 'target', amount: constant(provider === 'mark' ? 0 : 20) }] }] } }] }];
}
function damage(damageId: number, abilityRef: string, operationRef: string, operationPath: string, raw: number, hpBefore: number,
  useRef: string, definitionRef = 'mark_def'): DamageRecord {
  return { damageId, owner: 'source', source: 'source', target: 'target', abilityRef, operationRef, operationPath,
    providerDefinitionRef: definitionRef, damageType: 'damage/magic', useRef, timeMs: 500, castInstanceId: 2, attackIndex: null,
    rawAmount: raw, postDefenseDamage: raw, shieldAbsorbed: 0, actualHpLoss: raw, overkillDamage: 0,
    hpBefore, hpAfter: hpBefore - raw, sourceHpBefore: 500, sourceHpAfter: 500 };
}
function fixture(basic = false) {
  const triggerProvider = basic ? 'attack' : 'spell', triggerSkill = basic ? 'native_attack' : 'bolt';
  const triggerKind = basic ? 'event/basic_attack_hit' as const : 'event/skill_hit' as const;
  const use = basic ? 'basic:plan:1' : 'skill:bolt:1', triggerRef = ref(triggerProvider, 'hit');
  const consumer: AbilityDefinition = { abilityKey: 'consume', skillKey: 'mark', kind: 'passive_listener', types: ['ability/spell', 'ability/skill/mark'],
    listenerSpec: { listenerKey: 'consume', maxTriggersPerEvent: 1,
      eventMatcher: { all: [triggerKind, 'event/source_owner', ...(basic ? [] : ['ability/skill/bolt'])] },
      operations: [{ operation: 'consume_target_mark', target: 'target', ref: consumeRef, targetMark: {
        stateKey: 'mark', stateScope: 'provider_target', triggerKind, triggerAbilityRef: triggerRef, damageBlockScope: 'DAMAGE_INSTANCE',
        damage: { operation: 'damage', target: 'target', ref: damageRef, amount: constant(10), damageType: 'damage/magic',
          types: ['damage_trait/delivery_skill', 'damage_trait/origin_direct'], critEligible: false, vampQualification: 'RESOLVED' },
        ...(basic ? {} : { restore: { operation: 'resource_change', target: 'self', ref: restoreRef, resourceKey: 'mana', amount: constant(60) } })
      } }] } };
  const writer: AbilityDefinition = { abilityKey: 'arm', skillKey: 'mark', kind: 'passive_listener', listenerSpec: { listenerKey: 'arm',
    maxTriggersPerEvent: 1, eventMatcher: { all: ['event/skill_hit', 'event/source_owner', 'ability/skill/mark'] },
    condition: { op: 'eq', args: [{ op: 'read', path: 'event.skill_hit.blocked' }, constant(0)] },
    operations: [{ operation: 'state_change', target: 'self', ref: 'mark', amount: constant(1), valuePolicy: 'set', types: ['state_scope/provider_target'] }] } };
  const markRoots = root('mark', 'mark');
  const compile: CompileRequest = { schemaVersion: 'test', schemaHash: 'schema', rulesHash: 'rules', typeCatalog: { types: [], relations: [] },
    combatants: [{ key: 'source', attributes: { hp: slot(500, 1000) }, resources: { mana: { current: 80, max: 100 } }, providers: [
      { providerRef: 'mark', definitionRef: 'mark_def' }, { providerRef: triggerProvider, definitionRef: `${triggerProvider}_def` }] },
    { key: 'target', attributes: { hp: slot(1000) }, resources: {}, providers: [] }],
    sharedProviders: [{ providerKey: 'mark_def', skillKey: 'mark', kind: 'character', stableId: 'synthetic_mark',
      initialStateSchema: { mark: { valueType: 'integer', defaultValue: 0, maxValue: 1, durationMs: 4000, refreshPolicy: 'refresh_on_write' } },
      abilities: [markRoots[0]!, markRoots[1]!, consumer, writer] },
    { providerKey: `${triggerProvider}_def`, skillKey: triggerSkill, kind: 'character', stableId: 'synthetic_trigger', abilities: root(triggerProvider, triggerSkill, basic) }],
    rules: { skillActionBindings: [binding('mark', 'mark'), ...(basic ? [] : [binding(triggerProvider, triggerSkill)])] } };
  const source = { key: 'source' as const, attributes: { hp: slot(500, 1000) }, resources: { mana: { current: 80, max: 100 } },
    cooldowns: {}, shields: [], abilityState: {}, providerState: {}, vars: {}, providers: compile.combatants[0]!.providers.map(mount =>
      ({ ...mount, owner: 'source' as const, source: 'source' as const, stacks: 1, state: {}, expireAt: null })) };
  const target = { key: 'target' as const, attributes: { hp: slot(1000) }, resources: {}, cooldowns: {}, shields: [], abilityState: {}, providerState: {}, vars: {}, providers: [] };
  const request: RunRequest = { sessionId: 'synthetic', expectedRulesHash: 'rules', schemaVersion: 'test', schemaHash: 'schema', rulesHash: 'rules',
    initialSnapshot: { schemaHash: 'schema', rulesHash: 'rules', timeMs: 0, combatants: [source, target] },
    driverPlan: { entries: [], conditionRecheckIntervalMs: 1, skillActions: compile.rules.skillActionBindings!.map(value => ({ instructionKey: value.skillKey,
      firstAtMs: value.skillKey === 'mark' ? 0 : 250, sortOrder: 0, source: 'source', target: 'target', skillKey: value.skillKey,
      bindingKey: value.bindingKey, action: 'INITIAL', abilityRef: value.controls[0]!.abilityRef, hitBindings: [{ hitBindingKey: 'contact', preset: 'TARGET_HIT' }] })),
    ...(basic ? { basicAttack: { planKey: 'plan', source: 'source', target: 'target', skillKey: triggerSkill,
      startAbilityRef: ref(triggerProvider, 'start'), hitAbilityRef: triggerRef, initialControlAbilityRef: ref(triggerProvider, 'initial'),
      attackSpeedAttributeKey: 'as', attackSpeedInputMax: 5 } as const } : {}) },
    stopPolicy: { durationMs: 1000, stopOnTargetDeath: false, stopWhenNoEvents: false }, sampling: { disabled: true, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 0 } };
  const origins: OperationOrigin[] = [{ abilityRef: ref('mark', 'consume'), operationRef: damageRef, skillKey: 'mark', effectKey: 'burst', resultKey: 'magic',
    providerDefinitionRef: 'mark_def', compiledPaths: [damagePath] }];
  if (!basic) origins.push({ ...origins[0]!, operationRef: restoreRef, resultKey: 'mana', compiledPaths: [`${path}.targetMark.restore`] });
  const markRoot = damage(3, ref('mark', 'hit'), 'application', 'sharedProviders[0].abilities[1].operations[0].skillHit.candidates[0].operations[0]', 0, 1000, 'skill:mark:1');
  markRoot.timeMs = 250; markRoot.castInstanceId = 1;
  const rootRow = damage(1, triggerRef, 'root', 'sharedProviders[1].abilities[1].operations[0].skillHit.candidates[0].operations[0]', 20, 1000, use, `${triggerProvider}_def`);
  const markRow = damage(2, origins[0]!.abilityRef, damageRef, damagePath, 10, 980, use);
  function contact(timeMs: number, abilityRef: string, skill: string, useRef: string, occurrenceId: number): EvidenceItem {
    return { timeMs, kind: 'skill_hit', ref: abilityRef, data: { occurrenceId, skillKey: skill, source: 'source', target: 'target',
      blocked: 0, reused: false, useRef, blockScope: 'SKILL', candidateKey: 'root', effectOccurrenceKey: 'root', resultKey: 'root' } };
  }
  const ownContact = contact(250, ref('mark', 'hit'), 'mark', 'skill:mark:1', 1), triggerContact = contact(500, triggerRef, triggerSkill, use, 2);
  const damageFact = (row: DamageRecord): EvidenceItem => ({ timeMs: row.timeMs, kind: 'damage', ref: row.abilityRef, data: {
    damageId: row.damageId, source: row.source, target: row.target, abilityRef: row.abilityRef, operationRef: row.operationRef,
    castInstanceId: row.castInstanceId, rawAmount: row.rawAmount, postDefenseDamage: row.postDefenseDamage } });
  const restore: EvidenceItem = { timeMs: 500, kind: 'resource_restore', ref: restoreRef, data: { owner: 'source', source: 'source', target: 'source',
    providerRef: 'mark', providerDefinitionRef: 'mark_def', abilityRef: origins[0]!.abilityRef, operationRef: restoreRef,
    operationPath: `${path}.targetMark.restore`, useRef: use, resourceKey: 'mana', requestedAmount: 60, currentBefore: 80, currentAfter: 100, actualDelta: 20, overflow: 40 } };
  const consumed: EvidenceItem = { timeMs: 500, kind: 'target_mark_consumed', ref: consumeRef, path, data: { owner: 'source', providerRef: 'mark',
    definitionRef: 'mark_def', stateKey: 'mark', target: 'target', triggerKind, triggerAbilityRef: triggerRef, useRef: use, useSource: 'source',
    useSkillKey: triggerSkill, castInstanceId: 2, stateBefore: 1, stateAfter: 0, deadlineBefore: 4250, damageBlocked: false, damageId: 2 } };
  const items: EvidenceItem[] = [ownContact, { ...ownContact, kind: 'emitted_event', ref: 'event/skill_hit', data: { ...ownContact.data, eventType: 'event/skill_hit' } }, damageFact(markRoot),
    triggerContact, { ...triggerContact, kind: 'emitted_event', ref: triggerKind, data: { ...triggerContact.data, eventType: triggerKind } }, damageFact(rootRow),
    damageFact(markRow), ...(basic ? [] : [restore]), consumed];
  const final = structuredClone(request.initialSnapshot);
  final.timeMs = 1000;
  final.combatants[0]!.resources.mana!.current = basic ? 80 : 100;
  final.combatants[0]!.providerState.mark = { state: {}, expireAt: {}, targetState: { target: 'target', values: { mark: 0 }, expireAt: {} } };
  final.processInstances = [process('mark', 'mark', 'skill:mark:1', 0, 250), process(triggerProvider, triggerSkill, use, 250, 500)];
  final.combatants[1]!.attributes.hp!.current = 970;
  const done: DoneResult = { ok: true, targetMarkSummary: { consumedCount: 1, attackCount: basic ? 1 : 0, skillCount: basic ? 0 : 1, damageBlockedCount: 0 },
    summary: { durationMs: 1000, stopReason: 'duration_reached', sourceFinalHp: 500, targetFinalHp: 970, sourceDamageDealt: 30, sourceDamageTaken: 0,
      targetDamageDealt: 0, targetDamageTaken: 30, abilityAttemptCount: 2, abilityCastCount: 2, attemptSkippedCount: 0, warningCount: 0,
      evidenceTruncated: false, seriesDownsampled: false, abilityStats: [] }, finalSnapshot: final, warnings: [], series: [],
    evidence: { items, truncated: false, truncatedEvidenceCount: 0, countsByKind: {} }, seriesSamplingEvidence: { requestedSampleEveryMs: 100,
      effectiveSampleEveryMs: 0, requestedPointCount: 0, finalPointCount: 0, maxSeriesPoints: 0, downsampled: false, method: 'disabled' },
    damageRecords: [markRoot, rootRow, markRow], attackRecords: basic ? [{ planKey: 'plan', attackIndex: 1, useRef: use, source: 'source', target: 'target',
      skillKey: triggerSkill, startAtMs: 250, hitAtMs: 500, readyAtMs: 1250, finalReadyAtMs: 1250, nextStartAtMs: null, mechanicReadyAtMs: null,
      actionReadyAtMs: null, attackSpeed: 1, postDefenseDamage: 30, actualHpLoss: 30, sourceHpAfter: 500, targetHpAfter: 970, completed: true }] : [],
    skillUseRecords: basic ? [] : [{ kind: 'HIT', instructionKey: 'bolt', timeMs: 500, source: 'source', target: 'target', skillKey: triggerSkill,
      providerRef: triggerProvider, processKey: 'cast', useRef: use, hitRef: 'hit:bolt', reason: null, stepKey: 'hit', stepVersion: 1, executionIndex: 0 }] };
  for (const item of items) done.evidence.countsByKind[item.kind] = (done.evidence.countsByKind[item.kind] ?? 0) + 1;
  return { compile, request, done, origins, consumed, restore, ownContact, triggerContact, markRow, rootRow, markRoot, consumer, writer };
}
type Fixture = ReturnType<typeof fixture>;
const inspect = (value: Fixture) => inspectTargetMarkResult(value.compile, value.request, value.done, value.origins);

function automaticFixture() {
  const value = fixture();
  delete value.request.driverPlan.skillActions;
  value.request.driverPlan.automaticSkills = { rules: value.compile.rules.skillActionBindings!.map((binding, index) => ({
    ruleKey: `auto_${binding.skillKey}`, bindingKey: binding.bindingKey, sortOrder: index, target: 'target',
    hitBindings: [{ hitBindingKey: 'contact', preset: 'TARGET_HIT' }], waitForCooldowns: [], releaseAfterRuleKey: null
  })) };
  for (const binding of value.compile.rules.skillActionBindings!) binding.hitBindings[0]!.moment = { momentType: 'PROCESS_COMPLETE', stepKey: null };
  delete value.done.skillUseRecords;
  value.done.automaticSkillRecords = [
    { sequence: 1, timeMs: 0, kind: 'STARTED', ruleKey: 'auto_mark', useRef: 'skill:mark:1', relatedRuleKey: null, relatedUseRef: null, reason: null, nextCheckAtMs: null },
    { sequence: 2, timeMs: 250, kind: 'STARTED', ruleKey: 'auto_bolt', useRef: 'skill:bolt:1', relatedRuleKey: null, relatedUseRef: null, reason: null, nextCheckAtMs: null }
  ];
  value.done.automaticSkillRecording = { totalCount: 2, returnedCount: 2, omittedCount: 0, droppedCount: 0, truncated: false };
  return value;
}

describe('自动目标标记消费的真实原使用', () => {
  it('用实际自动规则、STARTED及完成过程闭合，不索取手动HIT明细', () => {
    expect(inspect(automaticFixture())).toEqual({ issues: [], identityGaps: [] });
  });
  it('分阶段命中仍要求同一已释放、接触和完成的实际阶段', () => {
    const value = automaticFixture();
    value.compile.rules.skillActionBindings![1]!.hitBindings[0]!.moment = { momentType: 'STEP_EXECUTION', stepKey: 'hit' };
    value.done.finalSnapshot.processInstances![1]!.skillHitStages = [{ hitBindingKey: 'contact', stepKey: 'hit', timeMs: 500, released: true, contact: true, completed: true }];
    expect(inspect(value)).toEqual({ issues: [], identityGaps: [] });
    value.done.finalSnapshot.processInstances![1]!.skillHitStages![0]!.contact = false;
    expect(inspect(value).issues.length).toBeGreaterThan(0);
  });
  it.each([
    ['外来规则', (f: Fixture) => { f.done.automaticSkillRecords![1]!.ruleKey = 'foreign'; }],
    ['错已知规则', (f: Fixture) => { f.done.automaticSkillRecords![1]!.ruleKey = 'auto_mark'; }],
    ['错原使用', (f: Fixture) => { f.done.automaticSkillRecords![1]!.useRef = 'skill:other'; }],
    ['错开始时刻', (f: Fixture) => { f.done.automaticSkillRecords![1]!.timeMs = 251; }],
    ['错开始资格', (f: Fixture) => { f.done.automaticSkillRecords![1]!.reason = 'invented'; }],
    ['伪重复开始', (f: Fixture) => { f.done.automaticSkillRecords!.push({ ...f.done.automaticSkillRecords![1]!, sequence: 3 }); Object.assign(f.done.automaticSkillRecording!, { totalCount: 3, returnedCount: 3 }); }],
    ['非连续前缀', (f: Fixture) => { f.done.automaticSkillRecords![1]!.sequence = 3; }],
    ['错误保留统计', (f: Fixture) => { f.done.automaticSkillRecording!.returnedCount = 1; }],
    ['多余记录字段', (f: Fixture) => { Object.assign(f.done.automaticSkillRecords![1]!, { invented: true }); }],
    ['错误真实挂载', (f: Fixture) => { f.done.finalSnapshot.processInstances![1]!.providerRef = 'foreign'; }],
    ['错命中预设', (f: Fixture) => { f.request.driverPlan.automaticSkills!.rules[1]!.hitBindings[0]!.preset = 'MISS'; }],
    ['缺实际规则', (f: Fixture) => { f.request.driverPlan.automaticSkills!.rules.pop(); }],
    ['错规则目标', (f: Fixture) => { f.request.driverPlan.automaticSkills!.rules[1]!.target = 'source'; }],
    ['错过程终点', (f: Fixture) => { f.done.finalSnapshot.processInstances![1]!.finishedAtMs = 501; }],
    ['没有真实接触', (f: Fixture) => { f.done.evidence.items = f.done.evidence.items.filter(item => item !== f.triggerContact); }],
    ['夹带手动命中', (f: Fixture) => { f.done.skillUseRecords = []; }],
    ['完整流却缺开始', (f: Fixture) => { f.done.automaticSkillRecords!.pop(); Object.assign(f.done.automaticSkillRecording!, { totalCount: 1, returnedCount: 1 }); }]
  ] as const)('保留的%s必须硬拒', (_label, mutate) => {
    const value = automaticFixture(); mutate(value);
    expect(inspect(value).issues.length).toBeGreaterThan(0);
  });
  it.each([0, 1])('合法截断预算%s只报身份缺口，不冒称全部可独立复核', maximum => {
    const value = automaticFixture(); value.request.recordBudget = { maxAutomaticSkillRecords: maximum };
    value.done.automaticSkillRecords!.splice(maximum);
    value.done.automaticSkillRecording = { totalCount: 2, returnedCount: maximum, omittedCount: 0, droppedCount: 2 - maximum, truncated: true };
    const result = inspect(value);
    expect(result.issues).toEqual([]); expect(result.identityGaps.some(gap => gap.includes('自动消费缺少原技能真实开始'))).toBe(true);
  });
  it('汇总模式省略自动明细是缺身份，不能补造开始记录', () => {
    const value = automaticFixture(); value.request.outputMode = 'summary'; value.done.automaticSkillRecords = [];
    value.done.automaticSkillRecording = { totalCount: 2, returnedCount: 0, omittedCount: 2, droppedCount: 0, truncated: false };
    const result = inspect(value);
    expect(result.issues).toEqual([]); expect(result.identityGaps.length).toBeGreaterThan(0);
  });
  it('截断说明不能掩盖已保留的矛盾开始身份', () => {
    const value = automaticFixture(); value.request.recordBudget = { maxAutomaticSkillRecords: 2 };
    value.done.automaticSkillRecords![1]!.useRef = 'skill:foreign';
    value.done.automaticSkillRecording = { totalCount: 3, returnedCount: 2, omittedCount: 0, droppedCount: 1, truncated: true };
    expect(inspect(value).issues.length).toBeGreaterThan(0);
  });
});

describe('targetMarkResultContract', () => {
  it('静态监听省略重复definitionRef时，仍由真实挂载与消费事实核定；出现则须相等', () => {
    const value = fixture(); delete value.markRow.providerDefinitionRef;
    expect(inspect(value)).toEqual({ issues: [], identityGaps: [] });
    for (const wrong of ['foreign_definition', null]) {
      Object.assign(value.markRow, { providerDefinitionRef: wrong });
      expect(inspect(value).issues.some(issue => issue.includes('W作者与路径'))).toBe(true);
    }
  });
  it.each([false, true])('接受独立合成真实技能/普攻接触：basic=%s', basic => {
    const value = fixture(basic);
    expect(targetMarkDamageOriginMatches(value.compile, value.origins[0]!, damagePath)).toBe(true);
    expect(inspect(value)).toEqual({ issues: [], identityGaps: [] });
  });
  it.each([
    ['错原use', (f: Fixture) => { f.consumed.data!.useRef = 'forged'; }],
    ['错原技能', (f: Fixture) => { f.consumed.data!.useSkillKey = 'mark'; }],
    ['错事件类型', (f: Fixture) => { f.consumed.data!.triggerKind = 'event/basic_attack_hit'; }],
    ['错真实能力', (f: Fixture) => { f.consumed.data!.triggerAbilityRef = ref('mark', 'hit'); }],
    ['错目标', (f: Fixture) => { f.consumed.data!.target = 'source'; }],
    ['错拥有者', (f: Fixture) => { f.consumed.data!.owner = 'target'; }],
    ['错父挂载', (f: Fixture) => { f.consumed.data!.providerRef = 'other'; }],
    ['错编译路径', (f: Fixture) => { f.consumed.path = path.replace('[2]', '[1]'); }],
    ['错施放身份', (f: Fixture) => { f.consumed.data!.castInstanceId = 100; }],
    ['错实际过程', (f: Fixture) => { f.done.finalSnapshot.processInstances![1]!.processKey = 'other'; }],
    ['改写截止', (f: Fixture) => { f.consumed.data!.deadlineBefore = 4251; }],
    ['精确到期', (f: Fixture) => { f.consumed.data!.deadlineBefore = 500; }],
    ['状态未清零', (f: Fixture) => { f.consumed.data!.stateAfter = 1; }],
    ['重复消费', (f: Fixture) => { f.done.evidence.items.push(structuredClone(f.consumed)); }],
    ['根伤id复用', (f: Fixture) => { f.consumed.data!.damageId = 1; }],
    ['错伤害路径', (f: Fixture) => { f.markRow.operationPath = 'rules.operations[0]'; }],
    ['伤害冒充触发技能', (f: Fixture) => { f.markRow.abilityRef = f.rootRow.abilityRef; }],
    ['伤害错原use', (f: Fixture) => { f.markRow.useRef = 'mark:new-use'; }],
    ['错伤害金额', (f: Fixture) => { f.markRow.rawAmount = 11; }],
    ['错伤害证据金额', (f: Fixture) => { f.done.evidence.items.find(item => item.kind === 'damage' && item.data?.damageId === 2)!.data!.rawAmount = 11; }],
    ['技能被阻挡还消费', (f: Fixture) => { f.triggerContact.data!.blocked = 1; }],
    ['没有真实原命中', (f: Fixture) => { f.done.evidence.items = f.done.evidence.items.filter(item => item !== f.triggerContact); }],
    ['没有原命中发出事件', (f: Fixture) => { f.done.evidence.items = f.done.evidence.items.filter(item => item.kind !== 'emitted_event' || item.timeMs !== 500); }],
    ['没有本W挂标', (f: Fixture) => { f.ownContact.data!.blocked = 1; }],
    ['缺提交统计', (f: Fixture) => { delete f.done.targetMarkSummary; }],
    ['摘要多余字段', (f: Fixture) => { Object.assign(f.done.targetMarkSummary!, { invented: 0 }); }],
    ['摘要不守恒', (f: Fixture) => { f.done.targetMarkSummary!.attackCount = 1; }],
    ['恢复改写W作者', (f: Fixture) => { f.restore.data!.providerRef = 'spell'; }],
    ['恢复错原use', (f: Fixture) => { f.restore.data!.useRef = 'other'; }],
    ['恢复金额变造', (f: Fixture) => { f.restore.data!.requestedAmount = 70; }],
    ['恢复夹取错误', (f: Fixture) => { f.restore.data!.actualDelta = 60; }],
    ['恢复溢出错误', (f: Fixture) => { f.restore.data!.overflow = 0; }],
    ['恢复早于伤害提交', (f: Fixture) => {
      f.done.evidence.items = f.done.evidence.items.filter(item => item !== f.restore);
      f.done.evidence.items.splice(5, 0, f.restore);
    }],
    ['重复恢复', (f: Fixture) => { f.done.evidence.items.splice(-1, 0, structuredClone(f.restore)); }],
    ['最终资源账不合', (f: Fixture) => { f.done.finalSnapshot.combatants[0]!.resources.mana!.current = 99; }],
    ['清零仍留旧期限', (f: Fixture) => { (f.done.finalSnapshot.combatants[0]!.providerState.mark as { targetState: { expireAt: Row } }).targetState.expireAt.mark = 4250; }]
  ] as const)('拒绝%s', (_label, mutate) => {
    const value = fixture(); mutate(value);
    expect(inspect(value).issues.length).toBeGreaterThan(0);
  });
  it.each([
    (f: Fixture) => { f.origins[0]!.abilityRef = ref('spell', 'hit'); },
    (f: Fixture) => { f.origins[0]!.providerDefinitionRef = 'spell_def'; },
    (f: Fixture) => { f.origins[0]!.skillKey = 'bolt'; },
    (f: Fixture) => { f.compile.combatants[1]!.providers.push({ providerRef: 'foreign', definitionRef: 'mark_def' }); },
    (f: Fixture) => { f.consumer.listenerSpec!.operations!.push({ operation: 'damage', target: 'target', amount: constant(1) }); },
    (f: Fixture) => { f.consumer.listenerSpec!.oncePerUse = { groupKey: 'invented', scope: 'provider' }; },
    (f: Fixture) => { f.consumer.listenerSpec!.abilityRef = ref('spell', 'hit'); },
    (f: Fixture) => { f.writer.listenerSpec!.condition = constant(1); },
    (f: Fixture) => { f.compile.sharedProviders![0]!.initialStateSchema!.mark = { valueType: 'integer', defaultValue: 0, maxValue: 1, durationMs: 0 }; }
  ])('来源匹配器不授权错作者、旁路或无期字段 %#', mutate => {
    const value = fixture(); mutate(value);
    expect(targetMarkDamageOriginMatches(value.compile, value.origins[0]!, damagePath)).toBe(false);
    expect(inspect(value).issues.length).toBeGreaterThan(0);
  });
  it('没有新增功能的旧场景不要求统计，也不能伪造新统计', () => {
    const value = fixture();
    value.consumer.listenerSpec!.operations = [];
    value.done.evidence.items = [];
    value.done.evidence.countsByKind = {};
    delete value.done.targetMarkSummary;
    expect(inspect(value)).toEqual({ issues: [], identityGaps: [] });
    value.done.targetMarkSummary = { consumedCount: 0, attackCount: 0, skillCount: 0, damageBlockedCount: 0 };
    expect(inspect(value).issues).toHaveLength(1);
  });
  it('独立法盾消费标记、保留技能返还，不制造0伤害行', () => {
    const value = fixture();
    value.consumed.data!.damageBlocked = true; value.consumed.data!.damageId = null;
    value.done.targetMarkSummary!.damageBlockedCount = 1;
    value.done.damageRecords = [value.markRoot, value.rootRow];
    value.done.evidence.items = value.done.evidence.items.filter(item => item.kind !== 'damage' || item.data?.damageId !== 2);
    value.done.evidence.items.splice(-2, 0, { timeMs: 500, kind: 'emitted_event', ref: 'event/spell_shield_blocked', data: {
      source: 'source', target: 'target', useRef: value.consumed.data!.useRef, skillKey: 'mark', blocked: 1, blockScope: 'DAMAGE_INSTANCE',
      candidateKey: consumeRef, effectOccurrenceKey: consumeRef, resultKey: damageRef, shieldProviderRef: 'shield', shieldDefinitionRef: 'shield_def', shieldOwner: 'target' } });
    expect(inspect(value)).toEqual({ issues: [], identityGaps: [] });
    value.done.damageRecords.push({ ...value.markRow, rawAmount: 0, postDefenseDamage: 0, actualHpLoss: 0 });
    expect(inspect(value).issues.length).toBeGreaterThan(0);
  });
  it('伤害明细截断只缺原伤害身份，不能宣称完整通过', () => {
    const value = fixture(); value.request.outputMode = 'summary'; value.done.damageRecords = [];
    value.done.skillUseRecords = [];
    const result = inspect(value);
    expect(result.issues).toEqual([]);
    expect(result.identityGaps.length).toBeGreaterThan(0);
  });
  it('消费事实截断为缺证据，保留的后续消费不能掩盖缺失的早先原事件', () => {
    const value = fixture();
    value.done.evidence.items = value.done.evidence.items.slice(0, 6);
    value.done.evidence.truncated = true; value.done.evidence.truncatedEvidenceCount = 3;
    value.done.damageRecords = [value.markRoot, value.rootRow];
    const result = inspect(value);
    expect(result.issues).toEqual([]); expect(result.identityGaps.length).toBeGreaterThan(0);
    value.done.evidence.items = [value.consumed];
    expect(inspect(value).issues.length).toBeGreaterThan(0);
  });
  it('完整0次消费仍必须有明确0统计并保留存活标记', () => {
    const value = fixture();
    value.done.evidence.items = value.done.evidence.items.slice(0, 3);
    value.done.evidence.countsByKind = { damage: 1, skill_hit: 1, emitted_event: 1 };
    value.done.targetMarkSummary = { consumedCount: 0, attackCount: 0, skillCount: 0, damageBlockedCount: 0 };
    value.done.damageRecords = [value.markRoot];
    value.done.finalSnapshot.combatants[0]!.resources.mana!.current = 80;
    value.done.finalSnapshot.combatants[0]!.providerState.mark = { state: {}, expireAt: {}, targetState: { target: 'target', values: { mark: 1 }, expireAt: { mark: 4250 } } };
    expect(inspect(value)).toEqual({ issues: [], identityGaps: [] });
    delete value.done.targetMarkSummary;
    expect(inspect(value).issues.length).toBeGreaterThan(0);
  });
  it.each([true, false])('汇总0消费且活动标记=%s，省略证据不能当完整时间线', active => {
    const value = fixture(); value.request.outputMode = 'summary';
    value.done.evidence.items = []; value.done.evidence.truncated = false;
    value.done.evidence.countsByKind = { damage: 1, skill_hit: 1, emitted_event: 1 };
    value.done.targetMarkSummary = { consumedCount: 0, attackCount: 0, skillCount: 0, damageBlockedCount: 0 };
    value.done.damageRecords = []; value.done.skillUseRecords = [];
    value.done.finalSnapshot.combatants[0]!.resources.mana!.current = 80;
    value.done.finalSnapshot.combatants[0]!.providerState.mark = { state: {}, expireAt: {}, targetState: { target: 'target',
      values: active ? { mark: 1 } : {}, expireAt: active ? { mark: 4250 } : {} } };
    const result = inspect(value);
    expect(result.issues).toEqual([]);
    expect(result.identityGaps.some(gap => gap.includes('完整挂标时间线'))).toBe(true);
  });
  it('完整实际费用与夹取后的恢复差值闭合最终资源账', () => {
    const value = fixture();
    value.done.finalSnapshot.processInstances![1]!.actualCosts.mana = 30;
    Object.assign(value.restore.data!, { currentBefore: 50, currentAfter: 100, actualDelta: 50, overflow: 10 });
    expect(inspect(value)).toEqual({ issues: [], identityGaps: [] });
  });
  it('资源容量可为有限小数，按实际容量夹取', () => {
    const value = fixture();
    value.request.initialSnapshot.combatants[0]!.resources.mana!.max = 100.5;
    value.done.finalSnapshot.combatants[0]!.resources.mana = { current: 100.5, max: 100.5 };
    Object.assign(value.restore.data!, { currentAfter: 100.5, actualDelta: 20.5, overflow: 39.5 });
    expect(inspect(value)).toEqual({ issues: [], identityGaps: [] });
  });
  it('汇总缺全部逐笔事实仍保留提交统计，明确返回身份缺口', () => {
    const value = fixture(); value.request.outputMode = 'summary';
    value.done.evidence.items = []; value.done.damageRecords = []; value.done.skillUseRecords = [];
    const result = inspect(value);
    expect(result.issues).toEqual([]); expect(result.identityGaps.length).toBeGreaterThan(0);
  });
  it('来源在原命中尾部已死，不恢复资源也不复活', () => {
    const value = fixture();
    value.rootRow.sourceHpAfter = 0; value.markRow.sourceHpBefore = 0; value.markRow.sourceHpAfter = 0;
    value.done.evidence.items = value.done.evidence.items.filter(item => item !== value.restore);
    value.done.finalSnapshot.combatants[0]!.resources.mana!.current = 80;
    expect(inspect(value)).toEqual({ issues: [], identityGaps: [] });
    value.done.evidence.items.splice(-1, 0, value.restore);
    expect(inspect(value).issues.length).toBeGreaterThan(0);
  });
  it('根伤已致死仍结算独立过量附伤，存活来源照常恢复', () => {
    const value = fixture();
    value.rootRow.hpBefore = 20; value.rootRow.hpAfter = 0;
    Object.assign(value.markRow, { hpBefore: 0, hpAfter: 0, actualHpLoss: 0, overkillDamage: 10 });
    expect(inspect(value)).toEqual({ issues: [], identityGaps: [] });
  });
  it('明确永假挂标条件不从空接触补造标记', () => {
    const value = fixture();
    value.writer.listenerSpec!.condition = { op: 'min', args: [value.writer.listenerSpec!.condition!, constant(0)] };
    value.done.evidence.items = value.done.evidence.items.slice(0, 2);
    value.done.evidence.countsByKind = { skill_hit: 1, emitted_event: 1 };
    value.done.targetMarkSummary = { consumedCount: 0, attackCount: 0, skillCount: 0, damageBlockedCount: 0 };
    value.done.damageRecords = []; value.done.finalSnapshot.combatants[0]!.resources.mana!.current = 80;
    expect(inspect(value)).toEqual({ issues: [], identityGaps: [] });
  });
  it('未逐笔运输的其它资源写入只能报无法证明，不擅自补0', () => {
    const value = fixture();
    value.compile.rules.operations = [{ operation: 'resource_change', target: 'source', resourceKey: 'mana', amount: constant(-1) }];
    const result = inspect(value);
    expect(result.issues).toEqual([]); expect(result.identityGaps.some(gap => gap.includes('资源写入'))).toBe(true);
  });
});

type Row = Record<string, unknown>;
