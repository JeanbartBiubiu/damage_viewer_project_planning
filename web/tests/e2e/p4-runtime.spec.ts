import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import type { CompileRequest, DoneResult, InitialSnapshot, ProcessControlAction } from '../../src/types/genericEngine';
import type { AuthoredProcessProgram } from '../../src/engine/processAdapter';
import type { AuthoredTriggerProgram } from '../../src/engine/triggerAdapter';
import type { AuthoredHitProgram } from '../../src/engine/hitAdapter';
import type { SkillEffect, SkillEffectResult } from '../../src/types/skillEffect';
import type { SkillProcessMoment, SkillProcessStep } from '../../src/types/skillProcess';
import type { SkillTriggerRuleDetail } from '../../src/types/skillTriggerRule';
import type { NumericValue } from '../../src/types/numericValue';
import { fixedValue, parameterValue } from '../../src/types/numericValue';

const key = 'cast_skill';
test('施放阶段验收使用最终Wasm产物', () => {
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(bytes.length).toBe(976767);
  expect(createHash('sha256').update(bytes).digest('hex').toUpperCase()).toBe('0FD141CE054160F765E0DA176F43EE0E6866177C805576EF5D7FD04ADA11CD3C');
});
const moment = (momentType: SkillProcessMoment['momentType'], stepKey: string | null = null,
  failureReason: SkillProcessMoment['failureReason'] = null): SkillProcessMoment => ({ momentType, stepKey, failureReason } as SkillProcessMoment);
const rule = (input: Pick<SkillTriggerRuleDetail, 'ruleKey' | 'eventSource' | 'actions'> & Partial<SkillTriggerRuleDetail>): SkillTriggerRuleDetail => ({
  name: input.ruleKey, description: null, sortOrder: 10, conditionGroups: [],
  perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null, ...input
});
function initial(skillKey = key): SkillTriggerRuleDetail {
  return rule({ ruleKey: 'initial', eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
    actions: [{ actionKey: 'cast_initial', name: '首次', actionType: 'START_PROCESS', sortOrder: 10, targetContext: 'CURRENT_TARGET',
      detail: { processKey: 'cast' }, runtimeInputBindings: [], resultModifiers: [] }] });
}
function resource(effectKey: string, operation: 'CONSUME' | 'RESTORE' | 'REFUND', value: NumericValue, attributeKey = 'mana'): SkillEffect {
  return { gameId: 'lol', skillKey: key, effectKey, name: effectKey, description: null, sortOrder: 10, lifecycle: null, createdAt: '', updatedAt: '',
    results: [{ resultKey: effectKey, name: effectKey, resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: 10,
      lifecycleBehavior: null, spellShieldBlockScope: null,
      valueRule: { value, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null }, detail: { attributeKey, operation } }] };
}
function setCooldown(effectKey: string, value: number): SkillEffect {
  const row = resource(effectKey, 'RESTORE', fixedValue(value));
  row.results = [{ ...row.results[0]!, resultType: 'COOLDOWN_CHANGE', detail: {
    operation: 'SET_REMAINING', affectedSkillScope: { mode: 'SKILLS', skillKeys: [key], skillCategoryKeys: [] }
  } } as SkillEffectResult];
  return row;
}
function execute(effectKey: string, actionKey = effectKey): SkillTriggerRuleDetail['actions'][number] {
  return { actionKey, name: actionKey, actionType: 'EXECUTE_EFFECT', sortOrder: 10,
    targetContext: 'CURRENT_TARGET', detail: { effectKey }, runtimeInputBindings: [], resultModifiers: [] };
}
function program(kind: 'CHARGE' | 'RECAST' | 'DELAY' = 'CHARGE', autoRelease = false): AuthoredProcessProgram {
  const step: SkillProcessStep = kind === 'CHARGE'
    ? { stepKey: 'wait', stepType: 'CHARGE', name: '等待', description: null, sortOrder: 10, detail: { minimumChargeValue: fixedValue(100), maximumChargeValue: fixedValue(1000), releaseAtMaximum: autoRelease } }
    : kind === 'RECAST'
      ? { stepKey: 'wait', stepType: 'RECAST', name: '等待', description: null, sortOrder: 10, detail: { windowValue: fixedValue(1000), maximumRecastCountValue: fixedValue(1) } }
      : { stepKey: 'wait', stepType: 'DELAY', name: '等待', description: null, sortOrder: 10, detail: { delayValue: fixedValue(1000) } };
  const rules = [initial()];
  if (kind !== 'DELAY') rules.push(rule({ ruleKey: 'advance', sortOrder: 20,
    eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: key, useKind: 'ACTIVE', castPhase: kind === 'CHARGE' ? 'CHARGE_RELEASE' : 'RECAST' } },
    actions: [{ actionKey: 'cast_advance', name: '推进', actionType: 'ADVANCE_PROCESS', sortOrder: 10, targetContext: null,
      detail: { processKey: 'cast', stepKey: 'wait' }, runtimeInputBindings: [], resultModifiers: [] }] }));
  rules.push(rule({ ruleKey: 'cancel', sortOrder: 30, eventSource: { eventType: 'PROCESS_CANCEL_REQUESTED', detail: { processKey: 'cast' } },
    actions: [{ actionKey: 'cast_cancel', name: '取消', actionType: 'FAIL_PROCESS', sortOrder: 10, targetContext: null,
      detail: { processKey: 'cast', failureReason: 'ACTIVE_CANCELLED' }, runtimeInputBindings: [], resultModifiers: [] }] }));
  return { gameId: 'lol', skillKey: key, skillLevel: 1, characterLevel: 1, owner: 'source', rules,
    process: { gameId: 'lol', skillKey: key, processKey: 'cast', name: '合成施放', activationType: 'ACTIVE', description: '机制专项，非英雄正式流程', sortOrder: 10,
      cooldown: { durationValue: fixedValue(2000), startMoment: moment('PROCESS_COMPLETE') }, steps: [step], stateOperations: [], createdAt: '', updatedAt: '',
      effectBindings: [
        { bindingKey: 'pay', effectKey: 'pay', moment: moment('PROCESS_START'), sortOrder: 10 },
        { bindingKey: 'execute', effectKey: 'executed', moment: moment('STEP_EXECUTION', 'wait'), sortOrder: 20 },
        { bindingKey: 'timeout', effectKey: 'expired', moment: moment('STEP_TIMEOUT', 'wait'), sortOrder: 30 }
      ] },
    effects: [resource('pay', 'CONSUME', fixedValue(60)), resource('executed', 'RESTORE', fixedValue(7), 'energy'), resource('expired', 'RESTORE', fixedValue(11), 'energy')],
    parameters: [], formulas: [], castCosts: [{ bindingKey: 'pay', effectKey: 'pay', resultKey: 'pay' }]
  };
}
function refundProgram(): AuthoredProcessProgram {
  const p = program();
  p.formulas = [{ gameId: 'lol', skillKey: key, formulaKey: 'cost', name: '当前力量', description: null, createdAt: '', updatedAt: '',
    expression: { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'power', attributeValueKind: 'TOTAL' } }];
  p.effects[0]!.results[0]!.valueRule!.value = { kind: 'FORMULA', formulaKey: 'cost' };
  const refund = resource('refund', 'REFUND', parameterValue('paid'));
  refund.results[0]!.valueRule!.fixedMultiplier = 0.5;
  p.effects.push(refund, setCooldown('cancel_cd', 1500));
  p.parameters = [{ gameId: 'lol', skillKey: key, parameterKey: 'paid', name: '实际成本', valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT',
    fixedValue: null, levelValues: null, description: null, sortOrder: 10, createdAt: '', updatedAt: '' }];
  p.process.cooldown = { durationValue: fixedValue(9000), startMoment: moment('PROCESS_FAILURE') };
  const refundAction = execute('refund');
  if (refundAction.actionType !== 'EXECUTE_EFFECT') throw new Error('fixture');
  refundAction.runtimeInputBindings = [{ bindingKey: 'paid', parameterKey: 'paid', sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: { attributeKey: 'mana' } }];
  p.rules = [...p.rules, rule({ ruleKey: 'refund', sortOrder: 40,
    eventSource: { eventType: 'PROCESS_MOMENT', detail: { processKey: 'cast', moment: moment('PROCESS_FAILURE', null, 'ACTIVE_CANCELLED') } },
    actions: [refundAction, { ...execute('cancel_cd'), sortOrder: 20 }] })];
  return p;
}

function bladeProbe(): AuthoredTriggerProgram {
  const skillKey = 'probe_blade';
  const icd = { conditionKey: 'icd', conditionType: 'INTERNAL_STATE_CHECK' as const, sortOrder: 20,
    detail: { stateKey: 'icd', valueKind: 'REMAINING_MS' as const, optionKey: null, expectedBoolean: null, comparator: 'EQ' as const, comparisonValue: fixedValue(0) } };
  const group = (enabled: boolean) => ({ groupKey: enabled ? 'armed' : 'idle', name: '待命', sortOrder: enabled ? 20 : 10, conditions: [
    { conditionKey: 'flag', conditionType: 'INTERNAL_STATE_CHECK' as const, sortOrder: 10,
      detail: { stateKey: 'ready', valueKind: 'ENABLED' as const, optionKey: null, expectedBoolean: enabled, comparator: null, comparisonValue: null } }, icd
  ] });
  const effect = resource('bonus', 'RESTORE', fixedValue(1)); effect.skillKey = skillKey;
  return { gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
    statuses: [], modifierZones: [], skillCategoryKeys: [], vampRules: [],
    internalStates: [
      { gameId: 'lol', skillKey, stateKey: 'ready', name: '待命', scope: 'SKILL', description: null, sortOrder: 10, stateType: 'FLAG', detail: { initialEnabled: false }, createdAt: '', updatedAt: '' },
      { gameId: 'lol', skillKey, stateKey: 'icd', name: '冷却', scope: 'SKILL', description: null, sortOrder: 20, stateType: 'INTERNAL_COOLDOWN', detail: { durationValue: fixedValue(1500) }, createdAt: '', updatedAt: '' }
    ], effects: [effect],
    processes: [{ gameId: 'lol', skillKey, processKey: 'blade', name: '待击', activationType: 'ACTIVE', description: null, sortOrder: 10, cooldown: null,
      steps: [{ stepKey: 'aa', name: '待击', description: null, sortOrder: 10, stepType: 'EMPOWERED_BASIC_ATTACK', detail: { windowValue: fixedValue(400), consumeMoment: 'ATTACK_HIT' } }],
      effectBindings: [{ bindingKey: 'bonus', effectKey: 'bonus', moment: moment('STEP_EXECUTION', 'aa'), sortOrder: 10 }],
      stateOperations: [
        { operationKey: 'arm', name: '开启', stateKey: 'ready', moment: moment('PROCESS_START'), sortOrder: 10, operation: 'ENABLE', value: null, optionKey: null },
        { operationKey: 'consume', name: '消费', stateKey: 'ready', moment: moment('STEP_EXECUTION', 'aa'), sortOrder: 20, operation: 'DISABLE', value: null, optionKey: null },
        { operationKey: 'icd', name: '冷却', stateKey: 'icd', moment: moment('STEP_EXECUTION', 'aa'), sortOrder: 30, operation: 'START', value: null, optionKey: null },
        { operationKey: 'expire', name: '到期', stateKey: 'ready', moment: moment('STEP_TIMEOUT', 'aa'), sortOrder: 40, operation: 'DISABLE', value: null, optionKey: null }
      ], createdAt: '', updatedAt: '' }],
    rules: [
      rule({ ruleKey: 'arm', eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: null, useKind: 'ACTIVE', castPhase: 'INITIAL' } }, conditionGroups: [group(false), group(true)],
        actions: [{ actionKey: 'arm', name: '启动', actionType: 'START_PROCESS', sortOrder: 10, targetContext: 'CURRENT_TARGET', detail: { processKey: 'blade' }, runtimeInputBindings: [], resultModifiers: [] }] }),
      rule({ ruleKey: 'consume', sortOrder: 20, eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }, conditionGroups: [group(true)], actions: [execute('bonus')], oncePerUse: { groupKey: 'consume', scope: 'SKILL' } })
    ] };
}
function hitProbe(): AuthoredHitProgram {
  const damage = resource('hit', 'RESTORE', fixedValue(10));
  damage.results = [{ ...damage.results[0]!, resultType: 'DAMAGE', target: 'TARGET', detail: { damageTypeKey: 'physical', deliveryKind: 'SKILL', originKind: 'DIRECT',
    critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: [] } } as SkillEffectResult];
  return { gameId: 'lol', skillKey: key, skillLevel: 1, characterLevel: 1,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
    statuses: [], modifierZones: [], skillCategoryKeys: ['common'], effects: [damage],
    vampRules: [{ vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1, deliveryKinds: ['SKILL'], originKinds: ['DIRECT'], skillCategoryKeys: ['common'] }],
    rules: [rule({ ruleKey: 'hit', eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: key } }, actions: [execute('hit')] })] };
}

type Command = { action: ProcessControlAction | 'MUTATE' | 'KILL' | 'HIT'; at: number; useRef?: string; providerRef?: string };
type Payload = { program: AuthoredProcessProgram; commands: Command[]; durationMs: number; initialMana?: number; initialEnergy?: number;
  extraMount?: boolean; blade?: boolean; hit?: boolean; resume?: { commands: Command[]; durationMs: number; corrupt?: 'past_driver' | 'negative_cost' | 'past_expiry' }; budget?: number };
type Result = { done?: DoneResult; resumed?: DoneResult; runError?: string; resumeError?: string; compileErrors?: unknown; adapterError?: string; released?: boolean };
async function run(page: Page, payload: Payload): Promise<Result> {
  await page.route('**/p4-browser-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>施放阶段运行验收</title>' }));
  await page.goto('/p4-browser-harness');
  return page.evaluate(async data => {
    const { adaptProcessProgram, withProcessProgram, processCommandFact, explicitProcessInterrupt } = await import(/* @vite-ignore */ '/src/engine/processAdapter.ts');
    const { withTriggerProgram } = await import(/* @vite-ignore */ '/src/engine/triggerAdapter.ts');
    const { withHitProgram, provenSkillUseFact, skillHitFact } = await import(/* @vite-ignore */ '/src/engine/hitAdapter.ts');
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const owner = data.program.owner ?? 'source'; const other = owner === 'source' ? 'target' : 'source';
    const slot = (value: number, max = value) => ({ base: value, current: value, max, resolved: value });
    let request: CompileRequest = { schemaVersion: 'generic-p0', schemaHash: 'p4-browser-v1', rulesHash: 'before-p4',
      typeCatalog: { types: [{ key: 'damage/physical', domain: 'damage' }, { key: 'ability/spell', domain: 'ability' },
        { key: 'damage_trait/delivery_skill', domain: 'damage_trait' }, { key: 'damage_trait/origin_direct', domain: 'damage_trait' }], relations: [] }, rules: {},
      combatants: (['source', 'target'] as const).map(actor => ({ key: actor,
        attributes: { hp: slot(1000), power: slot(60, 200), armor: slot(0), omnivamp_percent: slot(0) },
        resources: { mana: { current: data.initialMana ?? 100, max: 200 }, energy: { current: data.initialEnergy ?? 0, max: 200 } },
        providers: [{ providerRef: 'harness', definitionRef: 'harness' }, ...(actor === 'source' && data.hit ? [{ providerRef: 'hit', definitionRef: 'hit' }] : [])] })),
      sharedProviders: [{ providerKey: 'harness', kind: 'champion', stableId: 'harness', abilities: [
        { abilityKey: 'mutate', kind: 'active', operations: [{ operation: 'attribute_change', target: 'source', attributeKey: 'power', valuePolicy: 'set', amount: { op: 'const', value: 160 } }] },
        { abilityKey: 'kill', kind: 'active', types: ['ability/spell'], operations: [{ operation: 'damage', target: 'target', damageType: 'damage/physical', amount: { op: 'const', value: 5000 },
          vampQualification: data.hit ? 'RESOLVED' : undefined, types: ['damage_trait/delivery_skill', 'damage_trait/origin_direct'] }] }
      ] }, ...(data.hit ? [{ providerKey: 'hit', kind: 'champion', stableId: 'hit', abilities: [{ abilityKey: 'hit', kind: 'active', operations: [] }] }] : [])] };
    const client = new GenericEngineClient(); let sessionId: string | undefined;
    const result: Result = {};
    try {
      const adapted = adaptProcessProgram(data.program);
      request = withProcessProgram(request, { processProviderKey: 'casting', authored: data.program }, { rulesHash: 'p4-casting' });
      if (data.extraMount) request = withProcessProgram(request, { processProviderKey: 'other_casting', authored: data.program }, { rulesHash: 'p4-two' });
      const mount = request.combatants.find(actor => actor.key === owner)!.providers.find(provider => provider.providerRef === 'casting')!;
      request.sharedProviders!.find(provider => provider.providerKey === mount.definitionRef)!.abilities!.push(explicitProcessInterrupt({ abilityKey: 'interrupt', processKey: 'cast', skillKey: data.program.skillKey, failureReason: 'CONTROLLED' }));
      if (data.blade) request = withTriggerProgram(request, { triggerProviderKey: 'probe_blade', authored: data.probeBlade,
        initialCastAbilities: [{ providerRef: 'casting', abilityKey: adapted.initialAbilityKey }] }, { rulesHash: 'p4-blade' });
      if (data.hit) request = withHitProgram(request, { hitProviderKey: 'hit', hitAbilityKey: 'hit', authored: data.probeHit }, { rulesHash: 'p4-hit' });
      const compiled = await client.compile(request);
      if (!compiled.ok) { result.compileErrors = compiled.errors; return result; }
      sessionId = compiled.sessionId;
      const initialSnapshot: InitialSnapshot = { schemaHash: request.schemaHash, rulesHash: request.rulesHash, timeMs: 0, combatants: request.combatants.map(actor => ({
        key: actor.key, attributes: structuredClone(actor.attributes), resources: structuredClone(actor.resources), cooldowns: {}, shields: [], abilityState: {}, providerState: {}, vars: {}, effectiveStatuses: [],
        providers: actor.providers.map(provider => ({ providerRef: provider.providerRef, definitionRef: provider.definitionRef, source: actor.key, owner: actor.key, stacks: 1, expireAt: null, state: {} }))
      })), processInstances: [] };
      const doRun = (commands: Command[], durationMs: number, snapshot: InitialSnapshot) => {
        const facts: ReturnType<typeof processCommandFact>[] = []; const hits: ReturnType<typeof skillHitFact>[] = [];
        const uses = new Map<string, ReturnType<typeof provenSkillUseFact>>();
        const entries = commands.map((command, index) => {
          const entryKey = `cmd_${index}`; const useRef = command.useRef ?? 'use_one';
          if (command.action === 'MUTATE') return { entryKey, abilityRef: `${owner}.provider[harness].ability[mutate]`, source: owner, target: other, firstAtMs: command.at };
          if (command.action === 'KILL') return { entryKey, abilityRef: `${other}.provider[harness].ability[kill]`, source: other, target: owner, firstAtMs: command.at };
          uses.set(useRef, provenSkillUseFact({ useKey: useRef, source: owner, skillKey: data.program.skillKey }));
          if (command.action === 'HIT') { hits.push(skillHitFact(entryKey, useRef)); return { entryKey, abilityRef: `${owner}.provider[hit].ability[hit]`, source: owner, target: other, firstAtMs: command.at }; }
          const ability = command.action === 'INTERRUPT' ? 'interrupt' : adapted.controls.find(control => control.action === command.action)?.abilityKey;
          if (!ability) throw new Error(`fixture missing control ${command.action}`);
          facts.push(processCommandFact(entryKey, useRef));
          return { entryKey, abilityRef: `${owner}.provider[${command.providerRef ?? 'casting'}].ability[${ability}]`, source: owner, target: other, firstAtMs: command.at };
        });
        return client.run({ sessionId: compiled.sessionId, expectedRulesHash: request.rulesHash, schemaVersion: request.schemaVersion, schemaHash: request.schemaHash, rulesHash: request.rulesHash,
          initialSnapshot: snapshot, driverPlan: { entries, conditionRecheckIntervalMs: 10 }, stopPolicy: { durationMs, stopOnTargetDeath: false, stopWhenNoEvents: false },
          sampling: { sampleEveryMs: 50, dpsWindowMs: 100, maxSeriesPoints: 100 }, safetyBudget: { maxProcessInstances: data.budget ?? 10000 },
          skillUses: [...uses.values()], processCommandFacts: facts, skillHitFacts: hits });
      };
      try { result.done = await doRun(data.commands, data.durationMs, initialSnapshot); } catch (error) { result.runError = String(error); }
      if (result.done && data.resume) {
        const snapshot = structuredClone(result.done.finalSnapshot);
        if (data.resume.corrupt === 'negative_cost') snapshot.processInstances![0]!.actualCosts.mana = -1;
        if (data.resume.corrupt === 'past_expiry') snapshot.processInstances![0]!.expiresAtMs = snapshot.timeMs - 1;
        try { result.resumed = await doRun(data.resume.commands, data.resume.durationMs, snapshot); } catch (error) { result.resumeError = String(error); }
      }
    } catch (error) { result.adapterError = String(error); }
    finally { if (sessionId) result.released = (await client.release(sessionId, request.rulesHash)).released; client.terminate(); }
    return result;
  }, { ...payload, probeBlade: bladeProbe(), probeHit: hitProbe() });
}
async function passed(result: Result, info: TestInfo): Promise<DoneResult> {
  if (!result.done || result.runError || result.adapterError || result.compileErrors) await info.attach('p4-failure', { contentType: 'application/json', body: Buffer.from(JSON.stringify(result, null, 2)) });
  expect(result.adapterError).toBeUndefined(); expect(result.compileErrors).toBeUndefined(); expect(result.runError).toBeUndefined(); expect(result.done).toBeDefined(); expect(result.released).toBe(true);
  return result.done!;
}
const actor = (done: DoneResult, owner: 'source' | 'target' = 'source') => done.finalSnapshot.combatants.find(row => row.key === owner)!;
const instance = (done: DoneResult) => done.finalSnapshot.processInstances![0]!;
const cooldown = (done: DoneResult, owner: 'source' | 'target' = 'source') => actor(done, owner).cooldowns[`${owner}.provider[casting].ability[cast_initial]`]?.readyAtMs;

test('真实Worker：同次首次不重付，太早释放无副作用，正常释放只结算一次', async ({ page }, info) => {
  const done = await passed(await run(page, { program: program(), durationMs: 450, commands: [
    { action: 'INITIAL', at: 0 }, { action: 'INITIAL', at: 10 }, { action: 'CHARGE_RELEASE', at: 50 }, { action: 'CHARGE_RELEASE', at: 300 }, { action: 'CHARGE_RELEASE', at: 350 }
  ] }), info);
  expect(actor(done).resources.mana.current).toBe(40); expect(actor(done).resources.energy.current).toBe(7);
  expect(instance(done)).toMatchObject({ status: 'complete', finishedAtMs: 300, actualCosts: { mana: 60 }, cooldownStarted: true });
  expect(cooldown(done)).toBe(2300);
});

test('真实Worker：重施到期优先，蓄力最大值两种明确分支', async ({ page }, info) => {
  for (const [p, commands, energy] of [
    [program('RECAST'), [{ action: 'INITIAL', at: 0 }, { action: 'RECAST', at: 1000 }], 11],
    [program('CHARGE', false), [{ action: 'INITIAL', at: 0 }], 11],
    [program('CHARGE', true), [{ action: 'INITIAL', at: 0 }], 18]
  ] as [AuthoredProcessProgram, Command[], number][]) {
    const done = await passed(await run(page, { program: p, commands, durationMs: 1100 }), info);
    expect(actor(done).resources.mana.current).toBe(40); expect(actor(done).resources.energy.current).toBe(energy);
    expect(instance(done)).toMatchObject({ status: 'complete', finishedAtMs: 1000 }); expect(cooldown(done)).toBe(3000);
  }
});

test('真实Worker：退款读实际60成本，属性变化不重算，反向拥有者保持', async ({ page }, info) => {
  for (const owner of ['source', 'target'] as const) {
    const p = refundProgram(); p.owner = owner;
    const done = await passed(await run(page, { program: p, durationMs: 400, commands: [
      { action: 'INITIAL', at: 0 }, { action: 'MUTATE', at: 100 }, { action: 'CANCEL', at: 200 }, { action: 'CANCEL', at: 300 }
    ] }), info);
    expect(actor(done, owner).attributes.power.resolved).toBe(160); expect(actor(done, owner).resources.mana.current).toBe(70);
    expect(instance(done)).toMatchObject({ owner, status: 'failed', failureReason: 'ACTIVE_CANCELLED', actualCosts: { mana: 60 } }); expect(cooldown(done, owner)).toBe(1700);
  }
});

test('真实Worker：受控失败不借用主动取消退款，死亡停机前终结', async ({ page }, info) => {
  const controlled = await passed(await run(page, { program: refundProgram(), durationMs: 400, commands: [{ action: 'INITIAL', at: 0 }, { action: 'INTERRUPT', at: 200 }] }), info);
  expect(instance(controlled)).toMatchObject({ status: 'failed', failureReason: 'CONTROLLED' }); expect(actor(controlled).resources.mana.current).toBe(40); expect(cooldown(controlled)).toBe(9200);
  const killed = await passed(await run(page, { program: refundProgram(), durationMs: 400, commands: [{ action: 'INITIAL', at: 0 }, { action: 'KILL', at: 200 }] }), info);
  expect(instance(killed)).toMatchObject({ status: 'failed', failureReason: 'SOURCE_DIED', finishedAtMs: 200 }); expect(killed.summary.stopReason).toBe('source_dead');
});

test('真实Worker：活动及终结快照恢复不会重复扣费、退款或冷却', async ({ page }, info) => {
  const active = await run(page, { program: refundProgram(), durationMs: 100, commands: [{ action: 'INITIAL', at: 0 }],
    resume: { commands: [{ action: 'CANCEL', at: 200 }], durationMs: 200 } });
  await passed(active, info); expect(active.resumeError).toBeUndefined(); expect(active.resumed).toBeDefined();
  expect(actor(active.resumed!).resources.mana.current).toBe(70); expect(cooldown(active.resumed!)).toBe(1700);
  const terminal = await run(page, { program: refundProgram(), durationMs: 300, commands: [{ action: 'INITIAL', at: 0 }, { action: 'CANCEL', at: 200 }],
    resume: { commands: [{ action: 'CANCEL', at: 400 }], durationMs: 200 } });
  await passed(terminal, info); expect(terminal.resumeError).toBeUndefined(); expect(actor(terminal.resumed!).resources.mana.current).toBe(70); expect(cooldown(terminal.resumed!)).toBe(1700);
});

test('真实Worker：损坏恢复与混入过去普通驱动均明确失败', async ({ page }, info) => {
  for (const corrupt of ['past_driver', 'negative_cost', 'past_expiry'] as const) {
    const value = await run(page, { program: program(), commands: [{ action: 'INITIAL', at: 0 }], durationMs: 100,
      resume: { commands: corrupt === 'past_driver' ? [{ action: 'MUTATE', at: 50 }] : [{ action: 'CHARGE_RELEASE', at: 300 }], durationMs: 400, corrupt } });
    await passed(value, info); expect(value.resumed).toBeUndefined(); expect(value.resumeError).toBeTruthy();
  }
});

test('真实Worker：多挂载独立；多资源不足时原子拒绝', async ({ page }, info) => {
  const p = program(); p.effects[0]!.results[0]!.valueRule!.value = fixedValue(20);
  const done = await passed(await run(page, { program: p, extraMount: true, durationMs: 400, commands: [
    { action: 'INITIAL', at: 0, useRef: 'use_a' }, { action: 'INITIAL', at: 10, useRef: 'use_b', providerRef: 'other_casting' }, { action: 'CHARGE_RELEASE', at: 300, useRef: 'use_b', providerRef: 'other_casting' }
  ] }), info);
  expect(actor(done).resources.mana.current).toBe(60); expect(done.finalSnapshot.processInstances!.map(row => row.status).sort()).toEqual(['active', 'complete']);
  const multi = program(); multi.effects.push(resource('energy_cost', 'CONSUME', fixedValue(30), 'energy'));
  multi.process.effectBindings.push({ bindingKey: 'energy_cost', effectKey: 'energy_cost', moment: moment('PROCESS_START'), sortOrder: 15 });
  multi.castCosts = [...multi.castCosts, { bindingKey: 'energy_cost', effectKey: 'energy_cost', resultKey: 'energy_cost' }];
  const rejected = await passed(await run(page, { program: multi, initialEnergy: 20, commands: [{ action: 'INITIAL', at: 0 }], durationMs: 100 }), info);
  expect(actor(rejected).resources.mana.current).toBe(100); expect(actor(rejected).resources.energy.current).toBe(20); expect(rejected.finalSnapshot.processInstances ?? []).toHaveLength(0);
});

test('真实Worker：失败绑定和规则保持作者顺序，最后设置为3000毫秒', async ({ page }, info) => {
  const p = program(); p.effects.push(setCooldown('a', 1000), setCooldown('b', 2000), setCooldown('c', 3000));
  p.process.effectBindings.push({ bindingKey: 'a', effectKey: 'a', moment: moment('PROCESS_FAILURE'), sortOrder: 40 },
    { bindingKey: 'b', effectKey: 'b', moment: moment('PROCESS_FAILURE', null, 'ACTIVE_CANCELLED'), sortOrder: 50 });
  p.rules = [...p.rules, rule({ ruleKey: 'c', sortOrder: 40, eventSource: { eventType: 'PROCESS_MOMENT', detail: { processKey: 'cast', moment: moment('PROCESS_FAILURE') } }, actions: [execute('c')] })];
  const done = await passed(await run(page, { program: p, commands: [{ action: 'INITIAL', at: 0 }, { action: 'CANCEL', at: 100 }], durationMs: 200 }), info);
  expect(cooldown(done)).toBe(3100);
});

test('真实Worker：过程首次接第6项待击，重施与同use第5项命中不重发首次事件', async ({ page }, info) => {
  const done = await passed(await run(page, { program: program('RECAST'), blade: true, hit: true, durationMs: 450,
    commands: [{ action: 'INITIAL', at: 0 }, { action: 'RECAST', at: 300 }, { action: 'HIT', at: 350 }] }), info);
  expect(actor(done).providerState.probe_blade).toMatchObject({ state: { ready: 0, icd: 0 } });
  expect(actor(done, 'target').attributes.hp.current).toBe(990);
  expect(done.evidence.items.filter(item => item.kind === 'emitted_event' && item.ref === 'event/ability_started')).toHaveLength(1);
  expect(done.evidence.items.filter(item => item.kind === 'emitted_event' && item.ref === 'event/skill_hit')).toHaveLength(1);
});

test('真实API三名代表的原成本、已挂冷却及延时进入Worker，原规则不补写', async ({ page, request }, info) => {
  test.skip(process.env.P4_LIVE_API !== '1', '显式启用实际服务的只读回查');
  const records: unknown[] = [];
  for (const [skillKey, remaining, readyAt] of [['vi_q', 50, null], ['lux_e', 30, 10000], ['jax_e', 50, 17000]] as const) {
    const read = async (path: string) => { const response = await request.get(`http://127.0.0.1:8080/api/admin/games/lol/skills/${skillKey}${path}`, { headers: { Authorization: `Bearer ${process.env.DAMAGE_ADMIN_TOKEN || 'test'}` } }); expect(response.status()).toBe(200); return response.json(); };
    const [savedProcess, costEffect, parameters, rules] = await Promise.all([read('/processes/cast'), read('/effects/mana_cost'), read('/parameters'), read('/trigger-rules')]);
    expect(rules).toEqual([]);
    const before = JSON.stringify(savedProcess);
    const p: AuthoredProcessProgram = { gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1, process: structuredClone(savedProcess), effects: [costEffect], parameters, formulas: [],
      rules: [initial(skillKey)], castCosts: [{ bindingKey: 'mana_cost', effectKey: 'mana_cost', resultKey: 'consume_mana' }] };
    for (const binding of p.process.effectBindings) binding.moment.failureReason ??= null;
    if (p.process.cooldown) p.process.cooldown.startMoment.failureReason ??= null;
    const value = await run(page, { program: p, commands: [{ action: 'INITIAL', at: 0 }], durationMs: skillKey === 'lux_e' ? 249 : 300,
      ...(skillKey === 'lux_e' ? { resume: { commands: [], durationMs: 50 } } : {}) });
    const done = await passed(value, info); expect(actor(done).resources.mana.current).toBe(remaining);
    if (readyAt === null) expect(Object.keys(actor(done).cooldowns)).toHaveLength(0); else expect(cooldown(done)).toBe(readyAt);
    if (skillKey === 'lux_e') { expect(instance(done).status).toBe('active'); expect(value.resumeError).toBeUndefined(); expect(instance(value.resumed!)).toMatchObject({ status: 'complete', finishedAtMs: 250 }); expect(cooldown(value.resumed!)).toBe(10000); }
    expect(JSON.stringify(savedProcess)).toBe(before);
    expect(await read('/processes/cast')).toEqual(savedProcess); expect(await read('/trigger-rules')).toEqual([]);
    records.push({ skillKey, mana: actor(done).resources.mana.current, readyAt, process: savedProcess, costEffect, parameters });
  }
  await info.attach('原成本冷却组成与合成首次入口', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ records, businessWrites: 0,
    boundary: '原过程、成本及明确冷却真实GET；初始100法力及INITIAL入口为合成验收接线，不表示完整英雄阶段与伤害已装配。' }, null, 2)) });
});
