import { describe, expect, it } from 'vitest';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { fixedValue } from '../types/numericValue';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { skillActionRequest } from './skillActionRequest';
import { automaticSkillRequest } from './automaticSkillRequest';
import { empoweredAttackBinding, empoweredAttackIdentityGaps, inspectEmpoweredAttackFacts, inspectEmpoweredPredecessors } from './empoweredAttackContract';
import { describeCombatSkill } from '../pages/simulation/combatSkillRoster';
import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import type { DamageRecord, DoneResult, ProcessInstanceSnapshot } from '../types/genericEngine';
import { inspectSimulationHealthLedger } from './simulationHealthLedger';
import { basicAttackPrimaryBinding, inspectPrimaryReplacements, replacementPayloadBinding } from './primaryAttackReplacementContract';
import { sameEmpoweredAttack } from './empoweredAttackContract';

function sample(skillKey = 'empower_alpha', basicAttack = true) {
  const snapshot = simulationActiveSample();
  const original = snapshot.selection.plannedSkills[0]!.skillKey;
  const renamed = JSON.parse(JSON.stringify(snapshot).replaceAll(original, skillKey)) as typeof snapshot;
  const configuration = renamed.skillConfigurations.find(row => row.skill.skillKey === skillKey)!;
  configuration.triggerRules = [configuration.triggerRules[0]!];
  configuration.triggerRules[0]!.conditionGroups = [{ groupKey: 'self', name: '显式自身激活', sortOrder: 0,
    conditions: [{ conditionKey: 'self', conditionType: 'EXPLICIT_TARGET_IS_SOURCE', detail: {}, sortOrder: 0 }] }];
  const process = configuration.processes[0]!;
  process.steps = [{ stepKey: 'attack_window', name: '等待真实命中', description: null, sortOrder: 0,
    stepType: 'EMPOWERED_BASIC_ATTACK', occupiesAction: false, detail: { windowValue: fixedValue(500), consumeMoment: 'ATTACK_HIT' } }];
  process.effectBindings = [{ bindingKey: 'payload', effectKey: configuration.effects[0]!.effectKey, sortOrder: 0,
    moment: { momentType: 'STEP_EXECUTION', stepKey: 'attack_window', failureReason: null } }];
  if (basicAttack) { renamed.selection.basicAttackSkillKey = renamed.skillConfigurations[0]!.skill.skillKey; renamed.selection.basicAttackLevel = 1; }
  return syncSimulationSkillSources(renamed);
}
function prepare(snapshot: ReturnType<typeof sample>) {
  approveSnapshotFixture(snapshot);
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(snapshot, inputs, { source: 250, target: 500 });
}
const input = (snapshot: ReturnType<typeof sample>) => ({ ...snapshot.selection.plannedSkills[0]!, instructionKey: 'activate', atMs: 100, sortOrder: 0,
  targetSide: 'source' as const, phaseKind: 'INITIAL' as const, parentInstructionKey: null, hitPreset: null });

async function consumptionFacts(replacement = false) {
  const snapshot = sample();
  if (replacement) {
    const primary = snapshot.skillConfigurations[0]!.effects.flatMap(effect => effect.results).find(result => result.resultType === 'DAMAGE')!;
    if (primary.resultType === 'DAMAGE') primary.detail.attackDamageRole = 'PRIMARY';
    const payload = snapshot.skillConfigurations[1]!.effects[0]!.results[0]!;
    if (payload.resultType === 'DAMAGE') { payload.detail.attackDamageRole = 'REPLACE_PRIMARY'; payload.detail.deliveryKind = 'BASIC_ATTACK'; }
  }
  const prepared = prepare(snapshot);
  const request = (await skillActionRequest(prepared, snapshot, { actions: [input(snapshot)], durationMs: 600, attackSpeedInputMax: 5,
    recordTimeSeries: false, maxSkillActionRecords: 64, maxSkillUseRecords: 64, maxHealingRecords: 0 })).runRequest;
  const binding = prepared.compileRequest.rules.skillActionBindings![0]!, plan = request.driverPlan.basicAttack!;
  const match = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(plan.initialControlAbilityRef)!;
  const mount = prepared.compileRequest.combatants[0]!.providers.find(row => row.providerRef === match[1])!;
  const initial = prepared.compileRequest.sharedProviders!.find(row => row.providerKey === mount.definitionRef)!.abilities!.find(row => row.abilityKey === match[2])!;
  const association = { useRef: 'actual_basic_use', hitRef: 'actual_basic_hit', target: 'target' };
  const process: ProcessInstanceSnapshot = { owner: 'source', target: 'source', providerRef: binding.providerRef, processKey: binding.controls[0]!.processKey,
    skillKey: binding.skillKey, useKey: 'actual_activation', stepKey: 'attack_window', stepVersion: 1, stepExecutionIndex: 1,
    lastExecutionAtMs: 200, stepCompletedAtMs: 200, startedAtMs: 100, stepStartedAtMs: 100, advanceAtMs: 100, expiresAtMs: 600,
    actualCosts: {}, cooldownStarted: true, status: 'complete', failureReason: null, finishedAtMs: 200, repeat: null, actionOccupancies: [], empoweredAttack: association };
  const basic: ProcessInstanceSnapshot = { ...structuredClone(process), providerRef: match[1]!, processKey: initial.processControl!.processKey,
    skillKey: plan.skillKey, useKey: association.useRef, target: 'target', startedAtMs: 200, stepStartedAtMs: 200,
    advanceAtMs: 200, expiresAtMs: null, empoweredAttack: undefined };
  const done = { finalSnapshot: { ...request.initialSnapshot, timeMs: 600, processInstances: [process, basic] },
    attackRecords: [{ attackIndex: 1, source: 'source', target: 'target', skillKey: plan.skillKey, useRef: association.useRef, hitAtMs: 200, completed: true }],
    damageRecords: [
      { damageId: 1, abilityRef: plan.hitAbilityRef, useRef: association.useRef, hitRef: association.hitRef, timeMs: 200, source: 'source', target: 'target', attackIndex: 1 },
      { damageId: 2, abilityRef: binding.hitBindings[0]!.hitAbilityRef, useRef: process.useKey, hitRef: association.hitRef, timeMs: 200,
        source: 'source', target: 'target', attackIndex: 1, empoweredAttack: structuredClone(association) }
    ] as DamageRecord[],
    skillUseRecords: (['STARTED', 'STEP_ENTERED', 'STEP_EXECUTED', 'RELEASED', 'STEP_COMPLETED', 'HIT', 'COMPLETED'] as const).map(kind => {
      const consumed = kind !== 'STARTED' && kind !== 'STEP_ENTERED';
      return { instructionKey: 'activate', timeMs: consumed ? 200 : 100, kind, source: 'source', target: consumed ? 'target' : 'source',
        skillKey: binding.skillKey, providerRef: binding.providerRef, processKey: process.processKey, useRef: process.useKey,
        stepKey: process.stepKey, stepVersion: 1, executionIndex: consumed ? 1 : 0, hitRef: kind === 'HIT' ? association.hitRef : null,
        reason: null, ...(consumed ? { empoweredAttack: structuredClone(association) } : {}) };
    }), recording: { attackRecordsTruncated: false, damageRecordsTruncated: false } } as unknown as DoneResult;
  return { prepared, request, done, process, basic };
}
async function healthLedgerFacts() {
  const result = await consumptionFacts(), { done } = result;
  Object.assign(done.damageRecords![0]!, { sourceHpBefore: 250, sourceHpAfter: 250, hpBefore: 500, hpAfter: 400 });
  Object.assign(done.damageRecords![1]!, { sourceHpBefore: 250, sourceHpAfter: 260, hpBefore: 400, hpAfter: 300 });
  Object.assign(done.attackRecords![0]!, { sourceHpAfter: 260, targetHpAfter: 300 });
  done.healingRecords = []; done.summary = { durationMs: 600, sourceFinalHp: 260, targetFinalHp: 300 } as DoneResult['summary'];
  done.recording!.healingRecordsTruncated = false;
  return result;
}

async function primaryReplacementFacts(blocked = false, amount = 100) {
  const result = await consumptionFacts(true), { prepared, request, done, process } = result;
  const primary = basicAttackPrimaryBinding(prepared.compileRequest, request.driverPlan.basicAttack!)!;
  const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
  const payload = replacementPayloadBinding(prepared.compileRequest, binding)!;
  if (blocked) payload.candidate.spellShieldBlockScope = 'SKILL';
  const association = { ...process.empoweredAttack!, replacedPrimary: primary.identity };
  process.empoweredAttack = association;
  done.skillUseRecords!.forEach(row => { if (row.empoweredAttack) row.empoweredAttack = structuredClone(association); });
  const damage = { ...done.damageRecords![1]!, owner: 'source', operationPath: payload.operationPath,
    operationRef: payload.operation.ref!, damageType: payload.operation.damageType!, empoweredAttack: structuredClone(association),
    postDefenseDamage: amount, shieldAbsorbed: 0, actualHpLoss: amount, overkillDamage: 0 };
  done.damageRecords = blocked ? [] : [damage];
  done.summary = { durationMs: 600, basicAttack: { planKey: request.driverPlan.basicAttack!.planKey, startedCount: 1, hitCount: 1,
    completedCount: 1, initialActionReadyAtMs: null, primaryReplacements: [{ primary: primary.identity, replacement: payload.identity,
      target: 'target', count: 1, blockedCount: blocked ? 1 : 0, postDefenseDamage: blocked ? 0 : amount,
      shieldAbsorbed: 0, actualHpLoss: blocked ? 0 : amount }] }, damageBreakdown: blocked ? [] : [{ owner: 'source', source: 'source', target: 'target',
    abilityRef: binding.hitBindings[0]!.hitAbilityRef, operationRef: payload.operation.ref!, damageType: payload.operation.damageType!,
    damageCount: 1, postDefenseDamage: amount, shieldAbsorbed: 0, actualHpLoss: amount, overkillDamage: 0 }] } as DoneResult['summary'];
  return { ...result, primary, payload };
}

describe('通用普攻主体替换宿主契约', () => {
  it('显式作者角色落到各自候选，真实普攻其它联动保持原序', async () => {
    const { prepared, request, primary, payload } = await primaryReplacementFacts();
    expect(primary.identity).toEqual({ owner: 'source', providerRef: 'selected_basic_attack', definitionRef: prepared.compileRequest.sharedProviders![0]!.providerKey,
      startAbilityRef: request.driverPlan.basicAttack!.startAbilityRef, initialControlAbilityRef: request.driverPlan.basicAttack!.initialControlAbilityRef,
      hitAbilityRef: request.driverPlan.basicAttack!.hitAbilityRef, candidateKey: primary.candidate.candidateKey,
      effectOccurrenceKey: primary.candidate.effectOccurrenceKey, effectKey: primary.candidate.effectKey, resultKey: primary.candidate.resultKey });
    expect(primary.candidate.attackDamageRole).toBe('PRIMARY'); expect(payload.candidate.attackDamageRole).toBe('REPLACE_PRIMARY');
    expect(prepared.compileRequest.sharedProviders![0]!.abilities![2]!.operations![0]!.skillHit!.candidates.map(row => row.semantic.resultType))
      .toEqual(['DAMAGE', 'HIT_LINK_APPLICATION']);
  });

  it.each([['detailed', false, 100], ['summary', false, 100], ['detailed', false, 0], ['summary', true, 0]] as const)(
    '%s 保留完整可靠替换累计，阻挡=%s、伤害=%s', async (mode, blocked, amount) => {
      const { prepared, request, done } = await primaryReplacementFacts(blocked, amount);
      if (mode === 'summary') { request.outputMode = done.outputMode = 'summary'; done.damageRecords = []; done.attackRecords = []; done.skillUseRecords = []; }
      expect(inspectEmpoweredAttackFacts(prepared.compileRequest, request, done)).toEqual([]);
    });

  it('零明细和截断仍校验累计及完整过程，不要求被替换的物理主伤', async () => {
    const { prepared, request, done } = await primaryReplacementFacts();
    done.damageRecords = []; done.attackRecords = []; done.skillUseRecords = [];
    done.recording!.damageRecordsTruncated = done.recording!.attackRecordsTruncated = true;
    expect(inspectEmpoweredAttackFacts(prepared.compileRequest, request, done)).toEqual([]);
    done.summary.basicAttack!.primaryReplacements![0]!.count = 2;
    expect(inspectEmpoweredAttackFacts(prepared.compileRequest, request, done).length).toBeGreaterThan(0);
  });

  it('精确关联包含完整十字段，额外键、空值或任何字段漂移均拒绝', async () => {
    const { process } = await primaryReplacementFacts();
    expect(sameEmpoweredAttack(process.empoweredAttack, structuredClone(process.empoweredAttack))).toBe(true);
    for (const key of Object.keys(process.empoweredAttack!.replacedPrimary!)) {
      const bad = structuredClone(process.empoweredAttack!);
      (bad.replacedPrimary as unknown as Record<string, unknown>)[key] = 'forged';
      expect(sameEmpoweredAttack(process.empoweredAttack, bad)).toBe(false);
    }
    for (const patch of [{ replacedPrimary: null }, { extra: 'forged' }, { replacedPrimary: { ...process.empoweredAttack!.replacedPrimary, extra: true } }]) {
      expect(sameEmpoweredAttack(process.empoweredAttack, { ...process.empoweredAttack, ...patch })).toBe(false);
    }
  });

  it.each(['missing', 'extra', 'duplicate', 'empty', 'null', 'primary_owner', 'primary_definition', 'primary_control', 'primary_candidate',
    'replacement_provider', 'replacement_definition', 'replacement_skill', 'replacement_process', 'replacement_hit', 'target', 'count',
    'fractional', 'blocked', 'negative', 'infinite', 'amount', 'unconsumed', 'double_primary'] as const)(
    '汇总或零日志拒绝篡改 %s', async variant => {
      const { prepared, request, done, process, primary } = await primaryReplacementFacts();
      const rows = done.summary.basicAttack!.primaryReplacements!, row = rows[0]!;
      if (variant === 'missing') delete done.summary.basicAttack!.primaryReplacements;
      if (variant === 'extra') Object.assign(row, { extra: true });
      if (variant === 'duplicate') rows.push(structuredClone(row));
      if (variant === 'empty') rows.splice(0);
      if (variant === 'null') Object.assign(done.summary.basicAttack!, { primaryReplacements: null });
      if (variant === 'primary_owner') row.primary = { ...row.primary, owner: 'target' };
      if (variant === 'primary_definition') row.primary = { ...row.primary, definitionRef: 'another' };
      if (variant === 'primary_control') row.primary = { ...row.primary, initialControlAbilityRef: row.primary.startAbilityRef };
      if (variant === 'primary_candidate') row.primary = { ...row.primary, candidateKey: 'another' };
      if (variant === 'replacement_provider') row.replacement.providerRef = 'another';
      if (variant === 'replacement_definition') row.replacement.definitionRef = 'another';
      if (variant === 'replacement_skill') row.replacement.skillKey = 'another';
      if (variant === 'replacement_process') row.replacement.processKey = 'another';
      if (variant === 'replacement_hit') row.replacement.hitAbilityRef = request.driverPlan.basicAttack!.hitAbilityRef;
      if (variant === 'target') row.target = 'source';
      if (variant === 'count') row.count = 2;
      if (variant === 'fractional') row.count = 1.5;
      if (variant === 'blocked') row.blockedCount = 2;
      if (variant === 'negative') row.postDefenseDamage = -1;
      if (variant === 'infinite') row.actualHpLoss = Infinity;
      if (variant === 'amount') row.actualHpLoss++;
      if (variant === 'unconsumed') process.status = 'active';
      if (variant === 'double_primary') done.damageRecords!.push({ ...done.damageRecords![0]!, useRef: process.empoweredAttack!.useRef,
        operationPath: primary.operationPath, operationRef: primary.operation.ref!, abilityRef: request.driverPlan.basicAttack!.hitAbilityRef,
        empoweredAttack: undefined });
      expect(inspectPrimaryReplacements(prepared.compileRequest, request, done).length, variant).toBeGreaterThan(0);
    });

  it.each(['scope', 'sibling_scope', 'condition', 'participation', 'repeat', 'double_primary', 'hit_identity'] as const)(
    '真实普攻主体拒绝 %s 的编译绑定', async variant => {
      const { prepared, request, primary } = await primaryReplacementFacts();
      if (variant === 'scope') primary.candidate.spellShieldBlockScope = 'SKILL';
      if (variant === 'sibling_scope') prepared.compileRequest.sharedProviders![0]!.abilities![2]!.operations![0]!.skillHit!.candidates[1]!.spellShieldBlockScope = 'RESULT';
      if (variant === 'condition') primary.operation.condition = { op: 'const', value: 1 };
      if (variant === 'participation') primary.candidate.participationCondition = { op: 'const', value: 1 };
      if (variant === 'repeat') primary.operation.repeatCount = 2;
      if (variant === 'double_primary') prepared.compileRequest.sharedProviders![0]!.abilities![2]!.operations![0]!.skillHit!.candidates.push(structuredClone(primary.candidate));
      if (variant === 'hit_identity') request.driverPlan.basicAttack!.startAbilityRef = request.driverPlan.basicAttack!.hitAbilityRef;
      expect(() => basicAttackPrimaryBinding(prepared.compileRequest, request.driverPlan.basicAttack!)).toThrow(/主体/);
    });

  it.each(['participation', 'event_value', 'condition', 'repeat', 'second_result', 'wrong_role'] as const)(
    '替换负载不能筛空或重复：%s', async variant => {
      const { prepared, payload } = await primaryReplacementFacts(), binding = prepared.compileRequest.rules.skillActionBindings![0]!;
      if (variant === 'participation') payload.candidate.participationCondition = { op: 'const', value: 0 };
      if (variant === 'event_value') payload.candidate.eventValueConditions = [{ key: 'first_contact', comparator: 'eq', value: { op: 'const', value: 0 } }];
      if (variant === 'condition') payload.operation.condition = { op: 'const', value: 0 };
      if (variant === 'repeat') payload.operation.repeatCount = 2;
      if (variant === 'second_result') payload.candidate.operations.push(structuredClone(payload.operation));
      if (variant === 'wrong_role') payload.candidate.attackDamageRole = 'PRIMARY';
      expect(() => replacementPayloadBinding(prepared.compileRequest, binding)).toThrow(/替换/);
    });

  it('普通附加强化可与替换同刀共存，不要求旧主体作为关联证据', async () => {
    const { prepared, request, done, process } = await primaryReplacementFacts();
    const original = prepared.compileRequest.rules.skillActionBindings![0]!;
    const definition = prepared.compileRequest.sharedProviders!.find(row => row.providerKey === original.providerDefinitionRef)!;
    const copy = JSON.parse(JSON.stringify({ definition, binding: original }).replaceAll(original.providerRef, 'independent_additive')
      .replaceAll(original.providerDefinitionRef, 'independent_additive_definition')) as { definition: typeof definition; binding: typeof original };
    copy.definition.providerKey = 'independent_additive_definition'; copy.binding.providerDefinitionRef = copy.definition.providerKey;
    copy.definition.abilities!.forEach(ability => ability.operations?.forEach(operation => operation.skillHit?.candidates.forEach(candidate => delete candidate.attackDamageRole)));
    prepared.compileRequest.sharedProviders!.push(copy.definition); prepared.compileRequest.rules.skillActionBindings!.push(copy.binding);
    prepared.compileRequest.combatants[0]!.providers.push({ providerRef: copy.binding.providerRef, definitionRef: copy.definition.providerKey });
    const additive: ProcessInstanceSnapshot = { ...structuredClone(process), providerRef: copy.binding.providerRef, useKey: 'additive_activation',
      empoweredAttack: { useRef: process.empoweredAttack!.useRef, hitRef: process.empoweredAttack!.hitRef, target: 'target' } };
    done.finalSnapshot.processInstances!.push(additive);
    expect(inspectEmpoweredAttackFacts(prepared.compileRequest, request, done)).toEqual([]);
  });
});
async function successorFacts(chain = false) {
  const result = await consumptionFacts(), { prepared, request, done, process: root } = result;
  request.driverPlan.skillActions = [];
  const rootBinding = prepared.compileRequest.rules.skillActionBindings![0]!;
  request.driverPlan.automaticSkills = { rules: [{ ruleKey: 'first', bindingKey: rootBinding.bindingKey, sortOrder: 0, target: 'source', hitBindings: [], waitForCooldowns: [], releaseAfterRuleKey: null }] };
  done.automaticSkillRecords = [];
  done.automaticSkillRecording = { totalCount: 0, returnedCount: 0, omittedCount: 0, droppedCount: 0, truncated: false };
  const add = (key: string, parent: ProcessInstanceSnapshot, parentRule: string, immediate: boolean) => {
    const provider = { providerKey: key, stableId: key, kind: 'character', skillKey: key, abilities: [{ abilityKey: 'start', kind: 'active' as const,
      skillKey: key, processControl: { action: 'INITIAL' as const, processKey: 'cast' } }], processes: [{ processKey: 'cast', skillKey: key,
      steps: [{ stepKey: 'step', stepType: immediate ? 'IMMEDIATE' as const : 'DELAY' as const, occupiesAction: !immediate,
        ...(immediate ? {} : { delayMs: { op: 'const' as const, value: 100 } }) }], cooldown: null, costs: [], momentOperations: [] }] };
    prepared.compileRequest.sharedProviders!.push(provider);
    prepared.compileRequest.combatants[0]!.providers.push({ providerRef: key, definitionRef: key });
    const binding = { bindingKey: key, source: 'source' as const, providerRef: key, providerDefinitionRef: key, skillKey: key,
      controls: [{ action: 'INITIAL' as const, processKey: 'cast', abilityRef: `source.provider[${key}].ability[start]` }], hitBindings: [] };
    prepared.compileRequest.rules.skillActionBindings!.push(binding);
    request.driverPlan.automaticSkills!.rules.push({ ruleKey: key, bindingKey: key, sortOrder: request.driverPlan.automaticSkills!.rules.length,
      target: 'source', hitBindings: [], waitForCooldowns: [], releaseAfterRuleKey: parentRule });
    const startedAt = parent.finishedAtMs!;
    const process: ProcessInstanceSnapshot = { ...structuredClone(parent), owner: 'source', target: 'source', providerRef: key, skillKey: key, processKey: 'cast',
      useKey: key + '_actual_use', startedAtMs: startedAt, stepStartedAtMs: startedAt, advanceAtMs: immediate ? startedAt : startedAt + 100,
      expiresAtMs: immediate ? null : startedAt + 100, stepKey: 'step', lastExecutionAtMs: immediate ? startedAt : startedAt + 100,
      stepCompletedAtMs: immediate ? startedAt : startedAt + 100, finishedAtMs: immediate ? startedAt : startedAt + 100,
      empoweredAttack: undefined, empoweredPredecessorUseRef: parent.useKey, actionOccupancies: immediate ? [] : [{ stepKey: 'step', stepVersion: 1,
        startedAtMs: startedAt, expectedEndAtMs: startedAt + 100, finishedAtMs: startedAt + 100 }] };
    done.finalSnapshot.processInstances!.push(process);
    const sequence = done.automaticSkillRecords!.length;
    for (const [index, kind] of (['QUALIFICATION_GRANTED', 'QUALIFICATION_CONSUMED', 'STARTED'] as const).entries()) done.automaticSkillRecords!.push({
      sequence: sequence + index + 1, timeMs: startedAt, kind, ruleKey: kind === 'QUALIFICATION_GRANTED' ? parentRule : key,
      useRef: kind === 'QUALIFICATION_GRANTED' ? parent.useKey : process.useKey, relatedRuleKey: kind === 'QUALIFICATION_GRANTED' ? key : kind === 'QUALIFICATION_CONSUMED' ? parentRule : null,
      relatedUseRef: kind === 'QUALIFICATION_CONSUMED' ? parent.useKey : null, reason: null, nextCheckAtMs: null });
    return process;
  };
  const second = add('following', root, 'first', chain);
  const consumer = chain ? add('last_following', second, 'following', false) : second;
  return { ...result, second, consumer };
}

describe('通用强化下一次真实普攻宿主装配', () => {
  it.each(['empower_alpha', 'different_charge'])('%s 直接编译作者步骤挂接，不伪造技能命中规则', skillKey => {
    const snapshot = sample(skillKey), prepared = prepare(snapshot);
    const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
    const contract = empoweredAttackBinding(prepared.compileRequest, binding)!;
    expect(contract.step).toMatchObject({ stepKey: 'attack_window', stepType: 'EMPOWERED_BASIC_ATTACK', consumeMoment: 'ATTACK_HIT', occupiesAction: false });
    expect(contract.hit.moment).toEqual({ momentType: 'STEP_EXECUTION', stepKey: 'attack_window', failureReason: null });
    expect(snapshot.skillConfigurations[1]!.triggerRules.some(row => row.eventSource.eventType === 'SKILL_HIT')).toBe(false);
    expect(contract.payload.operations![0]!.skillHit!.candidates).toHaveLength(1);
    expect(prepared.compileRequest.typeCatalog.types).toContainEqual({ key: 'event/skill_hit', domain: 'event' });
    expect(prepared.operationOrigins.filter(row => row.skillKey === skillKey)).toMatchObject([{ abilityRef: contract.hit.hitAbilityRef,
      effectKey: snapshot.skillConfigurations[1]!.effects[0]!.effectKey, resultKey: 'damage' }]);
    expect(describeCombatSkill(snapshot.skillConfigurations[1]!, false)).toMatchObject({ targetSide: 'source', hitPreset: null, issue: null });
  });

  it('手动及自动请求保留编译负载，但运行预设为空且激活自身', async () => {
    const snapshot = sample(), prepared = prepare(snapshot);
    const manual = await skillActionRequest(prepared, snapshot, { actions: [input(snapshot)], durationMs: 600, attackSpeedInputMax: 5,
      recordTimeSeries: false, maxSkillActionRecords: 64, maxSkillUseRecords: 64, maxHealingRecords: 0 });
    expect(manual.runRequest.driverPlan.skillActions![0]).toMatchObject({ target: 'source', hitBindings: [] });
    expect(manual.runRequest.driverPlan.basicAttack).toBeDefined();
    const automatic = await automaticSkillRequest(prepared, snapshot, { rules: [{ ...snapshot.selection.plannedSkills[0]!,
      ruleKey: 'charge', sortOrder: 0, targetSide: 'source', hitPreset: null, waitForCooldowns: [], releaseAfterRuleKey: null }],
      durationMs: 600, attackSpeedInputMax: 5, recordTimeSeries: false, maxAutomaticSkillRecords: 64, maxHealingRecords: 0, outputMode: 'detailed' });
    expect(automatic.runRequest.driverPlan.automaticSkills!.rules[0]).toMatchObject({ target: 'source', hitBindings: [] });
    expect(automatic.runRequest.driverPlan.basicAttack).toBeDefined();
    expect(prepared.compileRequest.rules.skillActionBindings![0]!.hitBindings).toHaveLength(1);
  });

  it('缺真实普攻不把必要附伤静默省略', () => { expect(() => prepare(sample('without_basic', false))).toThrow(/普攻/); });
  it.each(['prefix', 'suffix', 'wrong_consume', 'occupied', 'zero_window', 'missing_payload', 'own_hit_rule', 'state_at_execution', 'moment_rule_at_execution'] as const)('拒绝未接入组合 %s', kind => {
    const snapshot = sample(), configuration = snapshot.skillConfigurations[1]!, process = configuration.processes[0]!;
    if (kind === 'prefix') process.steps.unshift({ stepKey: 'before', name: '前缀', sortOrder: -1, description: null, occupiesAction: false, stepType: 'IMMEDIATE', detail: {} });
    if (kind === 'suffix') process.steps.push({ stepKey: 'after', name: '后缀', sortOrder: 1, description: null, occupiesAction: false, stepType: 'IMMEDIATE', detail: {} });
    if (kind === 'wrong_consume' && process.steps[0]!.stepType === 'EMPOWERED_BASIC_ATTACK') process.steps[0]!.detail.consumeMoment = 'ATTACK_START';
    if (kind === 'occupied') process.steps[0]!.occupiesAction = true;
    if (kind === 'zero_window' && process.steps[0]!.stepType === 'EMPOWERED_BASIC_ATTACK') process.steps[0]!.detail.windowValue = fixedValue(0);
    if (kind === 'missing_payload') process.effectBindings = [];
    if (kind === 'own_hit_rule') {
      const rule = structuredClone(simulationActiveSample().skillConfigurations[1]!.triggerRules[1]!);
      if (rule.eventSource.eventType === 'SKILL_HIT') rule.eventSource.detail.sourceSkillKey = configuration.skill.skillKey;
      configuration.triggerRules.push(rule);
    }
    if (kind === 'state_at_execution') process.stateOperations.push({ operationKey: 'other', name: '额外写入', stateSkillKey: configuration.skill.skillKey,
      stateKey: 'not_guessed', operation: 'SET', value: fixedValue(0), optionKey: null, sortOrder: 1,
      moment: { momentType: 'STEP_EXECUTION', stepKey: 'attack_window', failureReason: null } });
    if (kind === 'moment_rule_at_execution') configuration.triggerRules.push({ ...structuredClone(configuration.triggerRules[0]!), ruleKey: 'extra_moment',
      conditionGroups: [], eventSource: { eventType: 'PROCESS_MOMENT', detail: { sourceSkillKey: configuration.skill.skillKey, processKey: process.processKey,
        moment: { momentType: 'STEP_EXECUTION', stepKey: 'attack_window', failureReason: null } } }, actions: [{
          actionKey: 'payload', name: '额外执行', actionType: 'EXECUTE_EFFECT', targetContext: 'CURRENT_TARGET', sortOrder: 1, detail: { effectKey: configuration.effects[0]!.effectKey }, runtimeInputBindings: [], resultModifiers: [] }] });
    syncSimulationSkillSources(snapshot);
    expect(() => prepare(snapshot)).toThrow();
  });
  it('不能通过手填目标或命中预设提前消费', async () => {
    const snapshot = sample(), prepared = prepare(snapshot);
    await expect(skillActionRequest(prepared, snapshot, { actions: [{ ...input(snapshot), targetSide: 'target', hitPreset: 'TARGET_HIT' }], durationMs: 600,
      attackSpeedInputMax: 5, recordTimeSeries: false, maxSkillActionRecords: 64, maxSkillUseRecords: 64, maxHealingRecords: 0 })).rejects.toThrow(/自身|预设/);
  });
  it('完整数值、属性依赖和吸血覆盖属于真实负载能力，多来源不借普攻参数', () => {
    const snapshot = sample(), configuration = snapshot.skillConfigurations[1]!;
    const result = configuration.effects[0]!.results[0]!;
    if (result.resultType !== 'DAMAGE') throw new Error('需要真实伤害结果');
    configuration.parameters = [{ ...snapshot.skillConfigurations[0]!.parameters[0]!, gameId: snapshot.gameId, skillKey: configuration.skill.skillKey,
      parameterKey: 'ratio', valueMode: 'FIXED', fixedValue: .5, levelValues: null }];
    configuration.formulas = [{ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, formulaKey: 'bonus', name: '实际属性附伤',
      description: null, sortOrder: 0, createdAt: '', updatedAt: '', expression: skillFormulaDefinition(configuration.skill.skillKey, { nodeType: 'OPERATION', operation: 'MULTIPLY',
        operands: [{ nodeType: 'PARAMETER', parameterKey: 'ratio' }, { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'attack_damage', attributeValueKind: 'TOTAL' }] }) }];
    result.valueRule!.value = { kind: 'FORMULA', formulaKey: 'bonus' };
    result.detail.vampOverrides = [{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE', basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiencyValue: fixedValue(1) }];
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'omnivamp_percent', name: '全能吸血' });
    snapshot.catalogs.vampRules.rules.push({ vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE',
      defaultEfficiency: 1, deliveryKinds: ['SKILL', 'BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['active', 'basic_attack'] });
    const prepared = prepare(snapshot), binding = prepared.compileRequest.rules.skillActionBindings![0]!;
    const contract = empoweredAttackBinding(prepared.compileRequest, binding)!;
    expect(contract.payload.operations![0]!.skillHit!.candidates[0]!.operations[0]).toMatchObject({ amount: { op: 'ref' },
      vampOverrides: [{ vampType: 'LIFE_STEAL', basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiency: { op: 'const', value: 1 } }] });
    expect(prepared.compileRequest.formulas?.find(row => row.skillKey === configuration.skill.skillKey)?.expression).toEqual(configuration.formulas[0]!.expression);
    expect(prepared.compileRequest.formulas?.find(row => row.skillKey === configuration.skill.skillKey)?.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ parameterKey: 'ratio', value: .5 })]));
    const attributes = inspectSimulationSnapshot(snapshot).requirements.filter(row => row.side === 'source').map(row => row.attribute.attributeKey);
    expect(attributes).toEqual(expect.arrayContaining(['attack_damage', 'life_steal_percent', 'omnivamp_percent']));
    const second = JSON.parse(JSON.stringify(configuration).replaceAll(configuration.skill.skillKey, 'empower_peer')) as typeof configuration;
    second.parameters[0]!.fixedValue = .25;
    snapshot.skillConfigurations.push(second);
    snapshot.selection.plannedSkills.push({ ...snapshot.selection.plannedSkills[0]!, skillKey: second.skill.skillKey });
    snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills.find(row => row.skillKey === configuration.skill.skillKey)!, skillKey: second.skill.skillKey });
    snapshot.source.skillSources.push({ ...snapshot.source.skillSources.find(row => row.skillKey === configuration.skill.skillKey)!, skillKey: second.skill.skillKey });
    snapshot.selection.sourceSkillSettings.push({ ...snapshot.selection.sourceSkillSettings.find(row => row.skillKey === configuration.skill.skillKey)!, skillKey: second.skill.skillKey });
    syncSimulationSkillSources(snapshot);
    const both = prepare(snapshot);
    expect(both.compileRequest.formulas!.filter(formula => ['empower_alpha', 'empower_peer'].includes(formula.skillKey!))
      .map(formula => formula.parameters!.find(parameter => parameter.parameterKey === 'ratio')!.value).sort()).toEqual([.25, .5]);
  });
  it.each([false, true])('消费双身份基于完整过程，明细全部截断%s不重建或改写身份', async truncated => {
    const { prepared, request, done } = await consumptionFacts();
    if (truncated) { done.damageRecords = []; done.attackRecords = []; done.skillUseRecords = []; done.recording!.attackRecordsTruncated = true; done.recording!.damageRecordsTruncated = true; }
    expect(inspectEmpoweredAttackFacts(prepared.compileRequest, request, done)).toEqual([]);
    expect(empoweredAttackIdentityGaps(request, done)).toHaveLength(truncated ? 1 : 0);
  });
  it('仅截断伤害也不能因保留使用或普攻记录而签命中标识已独立核实', async () => {
    const { prepared, request, done } = await consumptionFacts();
    done.damageRecords = []; done.recording!.damageRecordsTruncated = true;
    expect(done.skillUseRecords!.length).toBeGreaterThan(0); expect(done.attackRecords!.length).toBeGreaterThan(0);
    expect(inspectEmpoweredAttackFacts(prepared.compileRequest, request, done)).toEqual([]);
    expect(empoweredAttackIdentityGaps(request, done)).toEqual([expect.stringContaining('无法独立核实命中标识')]);
  });
  it.each([true, false])('汇总只有双方输出模式均明确%s才允许未请求明细，完整消费过程仍核对', async requested => {
    const { prepared, request, done } = await consumptionFacts();
    if (requested) request.outputMode = 'summary';
    done.outputMode = 'summary'; done.attackRecords = []; done.damageRecords = []; done.skillUseRecords = [];
    expect(inspectEmpoweredAttackFacts(prepared.compileRequest, request, done).length === 0).toBe(requested);
    expect(empoweredAttackIdentityGaps(request, done)).toHaveLength(1);
  });
  it.each(['missing', 'unknown_field', 'activation_as_attack', 'wrong_hit', 'wrong_target', 'expiry_equal', 'early', 'wrong_owner',
    'wrong_mount', 'wrong_process', 'different_attack_time', 'not_completed', 'double_consume', 'record_swapped_use', 'record_missing_association',
    'record_wrong_hit', 'record_wrong_attack_index', 'start_with_consumption', 'ordinary_with_consumption'] as const)('拒绝伪造消费关联 %s', async variant => {
    const { prepared, request, done, process, basic } = await consumptionFacts();
    if (variant === 'missing') delete process.empoweredAttack;
    if (variant === 'unknown_field') Object.assign(process.empoweredAttack!, { extra: 'unknown' });
    if (variant === 'activation_as_attack') process.empoweredAttack!.useRef = process.useKey;
    if (variant === 'wrong_hit') process.empoweredAttack!.hitRef = 'invented_hit';
    if (variant === 'wrong_target') process.empoweredAttack!.target = 'source';
    if (variant === 'expiry_equal') process.lastExecutionAtMs = process.stepCompletedAtMs = process.finishedAtMs = 600;
    if (variant === 'early') process.lastExecutionAtMs = process.stepCompletedAtMs = process.finishedAtMs = 99;
    if (variant === 'wrong_owner') basic.owner = 'target';
    if (variant === 'wrong_mount') basic.providerRef = 'unknown';
    if (variant === 'wrong_process') basic.processKey = 'unknown';
    if (variant === 'different_attack_time') basic.finishedAtMs = 199;
    if (variant === 'not_completed') process.status = 'active';
    if (variant === 'double_consume') done.finalSnapshot.processInstances!.push({ ...structuredClone(process), useKey: 'other_activation' });
    if (variant === 'record_swapped_use') done.damageRecords![1]!.useRef = basic.useKey;
    if (variant === 'record_missing_association') delete done.damageRecords![1]!.empoweredAttack;
    if (variant === 'record_wrong_hit') done.damageRecords![1]!.hitRef = 'other_hit';
    if (variant === 'record_wrong_attack_index') done.damageRecords![1]!.attackIndex = 0;
    if (variant === 'start_with_consumption') done.skillUseRecords![0]!.empoweredAttack = structuredClone(process.empoweredAttack!);
    if (variant === 'ordinary_with_consumption') done.damageRecords![0]!.empoweredAttack = structuredClone(process.empoweredAttack!);
    expect(inspectEmpoweredAttackFacts(prepared.compileRequest, request, done).length).toBeGreaterThan(0);
  });
  it('生命账保留附伤和普攻两份使用，显式关联原刀尾部生命与吸血', async () => {
    const { prepared, request, done } = await healthLedgerFacts();
    expect(inspectSimulationHealthLedger(prepared.compileRequest, request, done)).toEqual([]);
    expect(done.damageRecords![0]!.useRef).not.toBe(done.damageRecords![1]!.useRef);
  });
  it('明确关联使用的直接治疗仍进入原刀同步尾部，不改写治疗原使用', async () => {
    const { prepared, request, done, process } = await healthLedgerFacts();
    done.healingRecords!.push({ timeMs: 200, source: 'source', target: 'source', abilityRef: 'source.provider[healer].ability[react]',
      operationRef: 'known_heal', useRef: process.useKey, instructionKey: 'activate', rawAmount: 15, healingAfterDone: 15, healingAfterModifiers: 15,
      actualHealing: 15, overheal: 0, hpBefore: 260, hpAfter: 275 });
    done.summary.sourceFinalHp = done.attackRecords![0]!.sourceHpAfter = 275;
    expect(inspectSimulationHealthLedger(prepared.compileRequest, request, done)).toEqual([]);
  });
  it('普通盾全吸收仍保留防御后吸血检查点', async () => {
    const { prepared, request, done } = await healthLedgerFacts();
    done.damageRecords![0]!.hpAfter = done.damageRecords![1]!.hpBefore = done.damageRecords![1]!.hpAfter = 500;
    done.summary.targetFinalHp = done.attackRecords![0]!.targetHpAfter = 500;
    expect(inspectSimulationHealthLedger(prepared.compileRequest, request, done)).toEqual([]);
  });
  it('同毫秒的独立伤害及治疗不能并入原刀检查点', async () => {
    const { prepared, request, done } = await healthLedgerFacts();
    done.damageRecords!.push({ ...structuredClone(done.damageRecords![0]!), damageId: 3, useRef: 'independent_damage', timeMs: 200,
      abilityRef: 'target.provider[independent].ability[hit]', source: 'target', target: 'source', sourceHpBefore: 300, sourceHpAfter: 300, hpBefore: 260, hpAfter: 240 });
    done.healingRecords!.push({ timeMs: 200, source: 'source', target: 'source', abilityRef: 'source.provider[independent].ability[heal]',
      operationRef: 'other_heal', useRef: 'independent_heal', instructionKey: null, rawAmount: 5, healingAfterDone: 5, healingAfterModifiers: 5,
      actualHealing: 5, overheal: 0, hpBefore: 240, hpAfter: 245 });
    done.summary.sourceFinalHp = 245;
    expect(inspectSimulationHealthLedger(prepared.compileRequest, request, done)).toEqual([]);
    expect(done.attackRecords![0]!.sourceHpAfter).toBe(260);
  });
  it.each(['useRef', 'target', 'hitRef', 'timeMs'] as const)('错误附伤%s不能伪造原刀生命检查点', async field => {
    const { prepared, request, done } = await healthLedgerFacts();
    const damage = done.damageRecords![1]!;
    if (field === 'timeMs') damage.timeMs = 201;
    else damage[field] = 'unknown';
    expect(inspectSimulationHealthLedger(prepared.compileRequest, request, done).length).toBeGreaterThan(0);
  });
  it.each([false, true])('实际资格引用逐跳证明强化→后项，占用链传递%s不靠同毫秒猜测', async chain => {
    const { prepared, request, done, consumer, basic } = await successorFacts(chain);
    const facts = inspectEmpoweredPredecessors(prepared.compileRequest, request, done);
    expect(facts.issues).toEqual([]);
    expect(facts.successions.get(consumer.useKey)).toEqual({ attack: { useRef: basic.useKey, hitRef: 'actual_basic_hit', target: 'target' }, timeMs: 200 });
  });
  it.each(['zero', 'summary'] as const)('完整因果引用在%s中仍可回溯，不从有限明细重建', async mode => {
    const { prepared, request, done, consumer } = await successorFacts(true);
    done.automaticSkillRecords = []; done.skillUseRecords = []; done.attackRecords = []; done.damageRecords = [];
    if (mode === 'zero') { done.automaticSkillRecording!.truncated = true; done.recording!.attackRecordsTruncated = done.recording!.damageRecordsTruncated = true; }
    else { request.outputMode = done.outputMode = 'summary'; }
    const facts = inspectEmpoweredPredecessors(prepared.compileRequest, request, done);
    expect(facts.issues).toEqual([]); expect(facts.successions.has(consumer.useKey)).toBe(true);
  });
  it('多轮后项各保留自己的前项，不借只剩最后一份的资格汇总', async () => {
    const { prepared, request, done, consumer, process: root, basic } = await successorFacts();
    const nextRoot = { ...structuredClone(root), useKey: 'later_activation', startedAtMs: 1100, stepStartedAtMs: 1100, advanceAtMs: 1100,
      expiresAtMs: 1600, lastExecutionAtMs: 1200, stepCompletedAtMs: 1200, finishedAtMs: 1200,
      empoweredAttack: { useRef: 'later_basic', hitRef: 'later_hit', target: 'target' } };
    const nextBasic = { ...structuredClone(basic), useKey: 'later_basic', startedAtMs: 1200, stepStartedAtMs: 1200, advanceAtMs: 1200,
      lastExecutionAtMs: 1200, stepCompletedAtMs: 1200, finishedAtMs: 1200 };
    const nextConsumer = { ...structuredClone(consumer), useKey: 'later_consumer', startedAtMs: 1200, stepStartedAtMs: 1200, advanceAtMs: 1300,
      expiresAtMs: 1300, lastExecutionAtMs: 1300, stepCompletedAtMs: 1300, finishedAtMs: 1300, empoweredPredecessorUseRef: nextRoot.useKey,
      actionOccupancies: [{ stepKey: 'step', stepVersion: 1, startedAtMs: 1200, expectedEndAtMs: 1300, finishedAtMs: 1300 }] };
    done.finalSnapshot.processInstances!.push(nextRoot, nextBasic, nextConsumer);
    done.recording!.attackRecordsTruncated = done.recording!.damageRecordsTruncated = true;
    done.automaticSkillRecording!.truncated = true; done.automaticSkillRecords = []; done.skillUseRecords = []; done.attackRecords = []; done.damageRecords = [];
    const facts = inspectEmpoweredPredecessors(prepared.compileRequest, request, done);
    expect(facts.issues).toEqual([]);
    expect(facts.successions.get(consumer.useKey)?.attack.useRef).toBe(basic.useKey);
    expect(facts.successions.get(nextConsumer.useKey)?.attack.useRef).toBe(nextBasic.useKey);
  });
  it.each(['missing', 'unknown', 'self_cycle', 'wrong_owner', 'wrong_binding', 'future_parent', 'fake_basic', 'unrelated',
    'record_ref', 'record_sequence', 'record_missing', 'manual', 'broken_middle'] as const)('不能以错误资格因果%s豁免同刻占用', async variant => {
    const { prepared, request, done, consumer, second, process: root } = await successorFacts(variant === 'broken_middle');
    if (variant === 'missing') delete consumer.empoweredPredecessorUseRef;
    if (variant === 'unknown') consumer.empoweredPredecessorUseRef = 'unknown';
    if (variant === 'self_cycle') consumer.empoweredPredecessorUseRef = consumer.useKey;
    if (variant === 'wrong_owner') consumer.owner = 'target';
    if (variant === 'wrong_binding') root.providerRef = 'unknown';
    if (variant === 'future_parent') consumer.startedAtMs = 199;
    if (variant === 'fake_basic') root.empoweredAttack!.useRef = 'unknown_basic';
    if (variant === 'unrelated') request.driverPlan.automaticSkills!.rules[1]!.releaseAfterRuleKey = null;
    if (variant === 'record_ref') done.automaticSkillRecords![1]!.relatedUseRef = 'unknown';
    if (variant === 'record_sequence') done.automaticSkillRecords![0]!.sequence = 20;
    if (variant === 'record_missing') done.automaticSkillRecords = [];
    if (variant === 'manual') delete request.driverPlan.automaticSkills;
    if (variant === 'broken_middle') delete second.empoweredPredecessorUseRef;
    const facts = inspectEmpoweredPredecessors(prepared.compileRequest, request, done);
    expect(facts.issues.length).toBeGreaterThan(0); expect(facts.successions.size).toBe(0);
  });
  it('真实后项晚于该刀完成仍保留因果，但不能把不同毫秒的占用当作该刀同刻之后', async () => {
    const { prepared, request, done, consumer } = await successorFacts();
    consumer.startedAtMs = consumer.stepStartedAtMs = 201;
    consumer.advanceAtMs = consumer.expiresAtMs = consumer.lastExecutionAtMs = consumer.stepCompletedAtMs = consumer.finishedAtMs = 301;
    consumer.actionOccupancies[0] = { stepKey: 'step', stepVersion: 1, startedAtMs: 201, expectedEndAtMs: 301, finishedAtMs: 301 };
    done.automaticSkillRecords![1]!.timeMs = done.automaticSkillRecords![2]!.timeMs = 201;
    const facts = inspectEmpoweredPredecessors(prepared.compileRequest, request, done);
    expect(facts.issues).toEqual([]); expect(facts.successions.size).toBe(0);
  });
  it.each(['older_round', 'unrelated', 'second_step', 'preexisting'] as const)('汇总也以完整过程拒绝%s的占用伪因果，不能依赖明细解释器', async variant => {
    const { prepared, request, done, consumer, process: root, basic } = await successorFacts();
    request.outputMode = done.outputMode = 'summary'; done.automaticSkillRecords = []; done.skillUseRecords = []; done.damageRecords = []; done.attackRecords = [];
    if (variant === 'older_round') {
      const previousRoot = { ...structuredClone(root), useKey: 'earlier_activation', startedAtMs: 0, stepStartedAtMs: 0, advanceAtMs: 0,
        expiresAtMs: 500, lastExecutionAtMs: 0, stepCompletedAtMs: 0, finishedAtMs: 0,
        empoweredAttack: { useRef: 'earlier_basic', hitRef: 'earlier_hit', target: 'target' } };
      const previousBasic = { ...structuredClone(basic), useKey: 'earlier_basic', startedAtMs: 0, stepStartedAtMs: 0, advanceAtMs: 0,
        lastExecutionAtMs: 0, stepCompletedAtMs: 0, finishedAtMs: 0 };
      done.finalSnapshot.processInstances!.push(previousRoot, previousBasic);
      consumer.empoweredPredecessorUseRef = previousRoot.useKey;
    }
    if (variant === 'unrelated') { request.driverPlan.automaticSkills!.rules[1]!.releaseAfterRuleKey = null; delete consumer.empoweredPredecessorUseRef; }
    if (variant === 'second_step') consumer.actionOccupancies[0]!.stepVersion = 2;
    if (variant === 'preexisting') consumer.actionOccupancies[0]!.startedAtMs = 199;
    const facts = inspectEmpoweredPredecessors(prepared.compileRequest, request, done);
    expect(facts.issues.some(issue => issue.includes('占用'))).toBe(true); expect(facts.successions.size).toBe(0);
  });
});
