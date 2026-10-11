import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { AbilityDefinition, CompileRequest, DoneResult, DriverEntry, EngineError, InitialSnapshot, OncePerUseScope, OperationDefinition, ProviderDefinition, RunRequest, SkillUseFact, UseTriggerLedgerEntry } from '../../src/types/genericEngine';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { authoredResistanceDefense } from '../fixtures/authoredDamageFormula';
import { countWindowProvider, waitingAttackProvider, TRIGGER_RUNTIME_TYPES } from '../fixtures/triggerRuntimePrograms';

const WASM_PATH = resolve('src/engine/wasm/tinygo_engine_v2.wasm');
const WASM_SHA256 = WASM_IDENTITY.sha256.toUpperCase();
const WASM_BYTES = WASM_IDENTITY.bytes;
const CAST_TYPE = 'ability/p6_selected_cast';
function slot(value: number, max = value) { return { base: value, current: value, max, resolved: value }; }

// 只声明本专项的通用执行场景，不解释管理配置，也不代表实库录入。
function bonusDamage(delivery: 'delivery_skill' | 'delivery_basic_attack'): OperationDefinition {
  return { operation: 'damage', target: 'target', damageType: 'physics', amount: { op: 'const', value: 40 },
    critEligible: false, vampQualification: 'RESOLVED', vampOverrides: [],
    types: [`damage_trait/${delivery}`, 'damage_trait/origin_direct'] };
}
function syntheticWindow(scope: OncePerUseScope = 'provider', initialValue = 0,
  events = ['event/skill_hit'], reward = [bonusDamage('delivery_skill')]): ProviderDefinition {
  return countWindowProvider({ providerKey: 'item:synth_window', skillKey: 'synth_window', eventTypes: events,
    scope, initialValue, durationMs: 2000, cooldownMs: 6000, reward, abilityTypes: ['ability/skill_category/common'] });
}
function syntheticSpellblade(windowMs = 1500): ProviderDefinition {
  return waitingAttackProvider({ providerKey: 'item:synth_spellblade', skillKey: 'synth_spellblade', castType: CAST_TYPE,
    groupKey: 'spellblade', windowMs, cooldownMs: 1500, abilityTypes: ['ability/skill_category/common'], reward: [
      bonusDamage('delivery_basic_attack'),
      { operation: 'resource_change', target: 'source', resourceKey: 'mana', valuePolicy: 'add', amount: { op: 'mul', args: [
        { op: 'const', value: 0.5 }, { op: 'read', path: 'source.attr.attack_damage.resolved' }
      ] } }
    ] });
}
function dualEventWindow(): ProviderDefinition { return syntheticWindow('provider', 0, ['event/skill_hit', 'event/basic_attack_hit']); }
function refreshSpellblade(windowMs = 10000): ProviderDefinition { return syntheticSpellblade(windowMs); }
function shieldWindow(): ProviderDefinition {
  return syntheticWindow('provider', 0, ['event/skill_hit'], [{ operation: 'shield', target: 'source', shieldRef: 'window_reward',
    shieldDurationMs: { op: 'const', value: 2000 }, amount: { op: 'const', value: 150 } }]);
}

function baseRequest(): CompileRequest {
  return {
    schemaVersion: 'generic-p0', schemaHash: 'schema.p6.browser', rulesHash: 'before-p6',
    typeCatalog: { types: [{ key: 'damage/physical', domain: 'damage' }, { key: 'physics', domain: 'damage' },
      ...['hp', 'attack_damage', 'armor', 'omnivamp_percent', 'critical_strike_chance'].map(key => ({ key, domain: 'attribute' }))], relations: [] },
    rules: { damageTypeFormulas: [
      { damageType: 'damage/physical', formula: authoredResistanceDefense('armor') },
      { damageType: 'physics', formula: authoredResistanceDefense('armor') }
    ] },
    combatants: [
      {
        key: 'source',
        attributes: {
          hp: slot(1000, 2000), attack_damage: slot(100, 200), armor: slot(0), omnivamp_percent: slot(0.2, 1)
        },
        resources: { mana: { current: 0, max: 200 } },
        providers: [{ providerRef: 'champion', definitionRef: 'champion' }]
      },
      {
        key: 'target',
        attributes: {
          hp: slot(1000, 2000), attack_damage: slot(100, 200), armor: slot(0), omnivamp_percent: slot(0, 1)
        },
        resources: {},
        providers: []
      }
    ],
    sharedProviders: [{
      providerKey: 'champion', stableId: 'champion', kind: 'champion',
      abilities: [
        { abilityKey: 'skill_hit', kind: 'active', operations: [] }
      ]
    }]
  };
}

type Hit = { entryKey: string; at: number; useKey: string };
type Cast = { entryKey: string; abilityKey: string; at: number; skillKey: string; providerRef?: string; target?: 'source' | 'target' };
type Payload = {
  mode: 'window' | 'spellblade'; program?: ProviderDefinition; owner?: 'source' | 'target'; input?: CompileRequest;
  uses?: Array<{ useKey: string; skillKey: string }>; hits?: Hit[]; aaHits?: Hit[];
  durationMs?: number; startCost?: number; startOnly?: boolean; startAt?: number; hitAt?: number; omitAttackUse?: boolean;
  incoming?: Array<{ at: number; amount: number }>;
  restore?: { state: Record<string, number>; expireAt: Record<string, number>; ledger: Array<Omit<UseTriggerLedgerEntry, 'target'> & { target?: string | null }> };
  secondRun?: boolean; selectedCastAbilityKeys?: string[]; casts?: Cast[]; additionalChampionMount?: string;
  resumeEmpowered?: { startAt: number; hitAt: number; durationMs: number; restoreDurationMs: number; reopenAt: number };
  extraChampionAbilities?: AbilityDefinition[];
};
type WorkerResult = {
  compileRequest?: CompileRequest; runRequest?: RunRequest; compileOk?: boolean; compileErrors?: EngineError[];
  done?: DoneResult; secondDone?: DoneResult; resumedDone?: DoneResult; consumedRestoredDone?: DoneResult;
  runError?: string; released?: boolean;
};
async function runP6(page: Page, payload: Payload): Promise<WorkerResult> {
  await page.route('**/p6-browser-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>通用触发运行验证</title>' }));
  await page.goto('/p6-browser-harness');
  return page.evaluate(async data => {
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const request = structuredClone(data.input);
    const program = data.program;
    const owner = data.owner ?? 'source';
    const other = owner === 'source' ? 'target' : 'source';
    if (owner === 'target') for (const actor of request.combatants) actor.key = actor.key === 'source' ? 'target' : 'source';
    for (const actor of request.combatants) actor.types = ['combatant/champion'];
    request.typeCatalog.types.push(...data.types);
    request.rulesHash = 'p6-explicit-runtime';
    request.rules.vampRules = [{ vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1,
      targetMatcher: { all: ['combatant/champion'] }, abilityMatcher: { any: ['ability/skill_category/common'] },
      damageMatcher: { all: ['damage_trait/origin_direct'] } }];
    const isWindow = data.mode === 'window';
    const casts: Cast[] = isWindow ? [] : data.casts ?? [{ entryKey: 'cast', abilityKey: 'cast', at: 0, skillKey: 'champion_q' }];
    const selected = data.selectedCastAbilityKeys ?? [casts[0]?.abilityKey];
    const abilities: AbilityDefinition[] = [...new Map(casts.map(cast => [cast.abilityKey, {
      abilityKey: cast.abilityKey, kind: 'active', skillKey: cast.skillKey,
      types: selected.includes(cast.abilityKey) ? [data.castType] : [], operations: []
    }])).values(), ...(data.extraChampionAbilities ?? [])];
    abilities.push({ abilityKey: 'skill_hit', kind: 'active', skillKey: 'author_q',
      operations: [{ operation: 'resolve_skill_hit', target: 'target', skillHit: { skillKey: 'author_q', candidates: [] } }] },
      { abilityKey: 'aa_start', kind: 'active', skillKey: 'aa_basic', types: ['ability/basic_attack'], operations: [],
        ...(data.startCost === undefined ? {} : { cost: { resourceKey: 'mana', amount: { op: 'const', value: data.startCost } } }) },
      { abilityKey: 'aa_hit', kind: 'active', skillKey: 'aa_basic', types: ['ability/basic_attack'],
        operations: [{ operation: 'resolve_skill_hit', target: 'target', skillHit: { skillKey: 'aa_basic', candidates: [] } }] });
    const champion = request.sharedProviders![0]!;
    champion.abilities = abilities;
    if (data.additionalChampionMount) {
      const unselected = structuredClone(champion);
      unselected.providerKey = 'champion_unselected';
      for (const ability of unselected.abilities ?? []) ability.types = ability.types?.filter(type => type !== data.castType);
      request.sharedProviders!.push(unselected);
      request.combatants.find(actor => actor.key === owner)!.providers.push({ providerRef: data.additionalChampionMount, definitionRef: unselected.providerKey });
    }
    request.sharedProviders!.push(program);
    request.combatants.find(actor => actor.key === owner)!.providers.push({ providerRef: program.providerKey, definitionRef: program.providerKey });
    const entries: DriverEntry[] = casts.map(cast => ({ entryKey: cast.entryKey, abilityRef: `${owner}.provider[${cast.providerRef ?? 'champion'}].ability[${cast.abilityKey}]`,
      source: owner, target: cast.target ?? other, firstAtMs: cast.at }));
    const hits = isWindow ? [...(data.hits ?? []), ...(data.aaHits ?? [])] : data.startOnly ? [] : data.aaHits ?? [{ entryKey: 'hit', at: data.hitAt ?? 20, useKey: 'aa1' }];
    const uses = new Map<string, SkillUseFact>();
    const use = (useKey: string, skillKey: string) => uses.set(useKey, { useKey, source: owner, skillKey, historyState: 'complete' });
    for (const cast of casts) use(cast.entryKey, cast.skillKey);
    for (const fact of data.uses ?? []) use(fact.useKey, fact.skillKey);
    if (!isWindow) entries.push({ entryKey: 'start', abilityRef: `${owner}.provider[champion].ability[aa_start]`, source: owner, target: other, firstAtMs: data.startAt ?? 10 });
    for (const hit of hits) {
      const skillHit = isWindow && (data.hits ?? []).some(row => row.entryKey === hit.entryKey);
      const abilityKey = skillHit ? 'skill_hit' : 'aa_hit';
      entries.push({ entryKey: hit.entryKey, abilityRef: `${owner}.provider[champion].ability[${abilityKey}]`, source: owner, target: other, firstAtMs: hit.at });
      if (!skillHit && !data.omitAttackUse) use(hit.useKey, 'aa_basic');
    }
    if (!isWindow && !data.omitAttackUse) use('aa1', 'aa_basic');
    if (data.incoming?.length) {
      const incoming: ProviderDefinition = { providerKey: 'incoming', stableId: 'incoming', kind: 'champion', abilities: data.incoming.map((hit, index) => ({
        abilityKey: `hit_${index}`, kind: 'active', types: ['ability/skill_category/common'],
        operations: [{ operation: 'damage', target: 'target', damageType: 'damage/physical', amount: { op: 'const', value: hit.amount },
          vampQualification: 'RESOLVED', vampOverrides: [], types: ['damage_trait/delivery_skill', 'damage_trait/origin_direct'] }]
      })) };
      request.sharedProviders!.push(incoming);
      request.combatants.find(actor => actor.key === other)!.providers.push({ providerRef: incoming.providerKey, definitionRef: incoming.providerKey });
      entries.push(...data.incoming.map((hit, index) => ({ entryKey: `incoming_${index}`, abilityRef: `${other}.provider[incoming].ability[hit_${index}]`, source: other, target: owner, firstAtMs: hit.at })));
    }
    const initialSnapshot: InitialSnapshot = { schemaHash: request.schemaHash, rulesHash: request.rulesHash, timeMs: 0,
      useTriggerLedger: (data.restore?.ledger ?? []).map(row => ({ ...row, target: row.scope === 'provider_target' ? row.target! : null })),
      combatants: request.combatants.map(actor => ({ key: actor.key, attributes: structuredClone(actor.attributes), resources: structuredClone(actor.resources),
        cooldowns: {}, shields: [], abilityState: {}, vars: {}, effectiveStatuses: [],
        providers: actor.providers.map(provider => ({ ...provider, source: actor.key, owner: actor.key, stacks: 1, expireAt: null, state: {} })),
        providerState: actor.key === owner ? { [program.providerKey]: structuredClone(data.restore ? { state: data.restore.state, expireAt: data.restore.expireAt } : { state: {}, expireAt: {} }) } : {} })) };
    const client = new GenericEngineClient();
    const result: WorkerResult = { compileRequest: request };
    let sessionId: string | undefined;
    try {
      const compiled = await client.compile(request);
      result.compileOk = compiled.ok;
      if (!compiled.ok) { result.compileErrors = compiled.errors; return result; }
      sessionId = compiled.sessionId;
      const body: RunRequest = { sessionId, expectedRulesHash: request.rulesHash, schemaVersion: request.schemaVersion, schemaHash: request.schemaHash, rulesHash: request.rulesHash,
        initialSnapshot, driverPlan: { entries, conditionRecheckIntervalMs: 100 },
        stopPolicy: { durationMs: data.durationMs ?? 3000, stopOnTargetDeath: false, stopWhenNoEvents: false },
        sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 100 }, skillUses: [...uses.values()],
        skillHitFacts: hits.map(hit => ({ driverEntryKey: hit.entryKey, useRef: hit.useKey })),
        attackStartFacts: isWindow ? [] : [{ driverEntryKey: 'start', useRef: 'aa1' }] };
      result.runRequest = body;
      result.done = await client.run(body);
      if (data.secondRun) result.secondDone = await client.run(body);
      if (data.resumeEmpowered) {
        const resume = data.resumeEmpowered;
        result.resumedDone = await client.run({ ...body, initialSnapshot: result.done.finalSnapshot,
          driverPlan: { entries: [
            { entryKey: 'resume_start', abilityRef: `${owner}.provider[champion].ability[aa_start]`, source: owner, target: other, firstAtMs: resume.startAt },
            { entryKey: 'resume_hit', abilityRef: `${owner}.provider[champion].ability[aa_hit]`, source: owner, target: other, firstAtMs: resume.hitAt }
          ] }, stopPolicy: { ...body.stopPolicy, durationMs: resume.durationMs },
          skillUses: [{ useKey: 'resume_aa', source: owner, skillKey: 'aa_basic', historyState: 'complete' }],
          skillHitFacts: [{ driverEntryKey: 'resume_hit', useRef: 'resume_aa' }], attackStartFacts: [{ driverEntryKey: 'resume_start', useRef: 'resume_aa' }] });
        result.consumedRestoredDone = await client.run({ ...body, initialSnapshot: result.resumedDone.finalSnapshot,
          driverPlan: { entries: [
            { entryKey: 'restore_cast', abilityRef: `${owner}.provider[champion].ability[${casts[0]!.abilityKey}]`, source: owner, target: owner, firstAtMs: resume.reopenAt },
            { entryKey: 'old_hit', abilityRef: `${owner}.provider[champion].ability[aa_hit]`, source: owner, target: other, firstAtMs: resume.reopenAt + 1 }
          ] }, stopPolicy: { ...body.stopPolicy, durationMs: resume.restoreDurationMs },
          skillUses: [{ useKey: 'restore_cast', source: owner, skillKey: casts[0]!.skillKey, historyState: 'complete' },
            { useKey: 'resume_aa', source: owner, skillKey: 'aa_basic', historyState: 'complete' }],
          skillHitFacts: [{ driverEntryKey: 'old_hit', useRef: 'resume_aa' }], attackStartFacts: [] });
      }
    } catch (error) { result.runError = String(error); }
    finally {
      if (sessionId) result.released = (await client.release(sessionId, request.rulesHash)).released;
      client.terminate();
    }
    return result;
  }, { ...payload, input: payload.input ?? baseRequest(), program: payload.program ?? (payload.mode === 'window' ? syntheticWindow() : syntheticSpellblade()),
    types: TRIGGER_RUNTIME_TYPES, castType: CAST_TYPE });
}
function providerState(done: DoneResult, providerRef: string): Record<string, unknown> {
  return done.finalSnapshot.combatants.find(row => row.key === 'source')!.providerState[providerRef] as Record<string, unknown>;
}
async function assertNativeResult(result: WorkerResult, info: import('@playwright/test').TestInfo) {
  await info.attach(`p6-native-run-${info.attachments.length}`, { contentType: 'application/json', body: Buffer.from(JSON.stringify(result, null, 2)) });
  expect(result.compileOk, JSON.stringify(result.compileErrors)).toBe(true);
  expect(result.runError).toBeUndefined();
  expect(result.done).toBeDefined();
  expect(result.released).toBe(true);
}

test('最终Wasm产物身份', () => {
  const bytes = readFileSync(WASM_PATH);
  expect(bytes.length).toBe(WASM_BYTES);
  expect(createHash('sha256').update(bytes).digest('hex').toUpperCase()).toBe(WASM_SHA256);
});

test('实际 Worker：合成计数窗口同 use 多段只计一次，下一真实 use 触发奖励', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'window',
    uses: [
      { useKey: 'u1', skillKey: 'author_q' },
      { useKey: 'u2', skillKey: 'author_q' }
    ],
    hits: [
      { entryKey: 'h1', at: 0, useKey: 'u1' },
      { entryKey: 'h2', at: 50, useKey: 'u1' },
      { entryKey: 'h3', at: 100, useKey: 'u2' }
    ],
    secondRun: true
  });
  await assertNativeResult(result, testInfo);
  const bag = providerState(result.done!, 'item:synth_window');
  const state = (bag.state ?? {}) as Record<string, number>;
  expect(state.hits).toBe(0);
  expect(state.icd).toBe(1);
  expect(result.done!.finalSnapshot.useTriggerLedger?.length).toBe(2);
  expect(result.secondDone!.finalSnapshot.useTriggerLedger?.length).toBe(2);
  expect(result.released).toBe(true);
});

test('实际 Worker：固定窗口不续期，恰好到期后重开', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'window',
    durationMs: 2500,
    uses: [
      { useKey: 'u1', skillKey: 'author_q' },
      { useKey: 'u2', skillKey: 'author_q' }
    ],
    hits: [
      { entryKey: 'h1', at: 0, useKey: 'u1' },
      { entryKey: 'h2', at: 2000, useKey: 'u2' }
    ]
  });
  await assertNativeResult(result, testInfo);
  const bag = providerState(result.done!, 'item:synth_window');
  const state = (bag.state ?? {}) as Record<string, number>;
  expect(state.hits).toBe(1);
  expect(state.icd).toBe(0);
});

test('实际 Worker：快照恢复期限与历史 use 额度，新命中走下一真实 use', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'window',
    uses: [
      { useKey: 'hist1', skillKey: 'author_q' },
      { useKey: 'u2', skillKey: 'author_q' }
    ],
    hits: [
      { entryKey: 'h1', at: 0, useKey: 'hist1' },
      { entryKey: 'h2', at: 100, useKey: 'u2' }
    ],
    restore: {
      state: { hits: 1 }, expireAt: { hits: 2000 },
      ledger: [{
        owner: 'source', providerRef: 'item:synth_window', groupKey: 'proc', scope: 'provider',
        useSource: 'source', useSkillKey: 'author_q', useKey: 'hist1'
      }]
    }
  });
  await assertNativeResult(result, testInfo);
  const bag = providerState(result.done!, 'item:synth_window');
  const state = (bag.state ?? {}) as Record<string, number>;
  expect(state.hits).toBe(0);
  expect(state.icd).toBe(1);
  expect(result.done!.finalSnapshot.useTriggerLedger?.some((row) => row.useKey === 'hist1')).toBe(true);
  expect(result.done!.finalSnapshot.useTriggerLedger?.some((row) => row.useKey === 'u2')).toBe(true);
});

test('实际 Worker：合成待击消费开始与命中分开，伤害回蓝后清 ready 并开冷却', async ({ page }, testInfo) => {
  const result = await runP6(page, { mode: 'spellblade', durationMs: 100 });
  await assertNativeResult(result, testInfo);
  const bag = providerState(result.done!, 'item:synth_spellblade');
  const state = (bag.state ?? {}) as Record<string, number>;
  expect(state.ready).toBe(0);
  expect(state.icd).toBe(1);
  const source = result.done!.finalSnapshot.combatants.find((row) => row.key === 'source')!;
  expect(source.resources.mana.current).toBe(50);
  expect(result.done!.evidence.items.some((item) => item.kind === 'emitted_event' && item.ref === 'event/basic_attack_start')).toBe(true);
  expect(result.done!.evidence.items.some((item) => item.kind === 'emitted_event' && item.ref === 'event/basic_attack_hit')).toBe(true);
  expect(result.done!.evidence.items.some((item) => item.kind === 'emitted_event' && item.ref === 'event/skill_hit')).toBe(false);
});

test('实际 Worker：普攻开始门禁失败不消费 ready', async ({ page }, testInfo) => {
  const result = await runP6(page, { mode: 'spellblade', startCost: 50, startOnly: true, durationMs: 100 });
  await assertNativeResult(result, testInfo);
  const bag = providerState(result.done!, 'item:synth_spellblade');
  const state = (bag.state ?? {}) as Record<string, number>;
  expect(state.ready).toBe(1);
  expect(state.icd).toBe(0);
});

test('实际 Worker：内部冷却中不会重新开窗或重复奖励', async ({ page }, testInfo) => {
  const result = await runP6(page, { mode: 'window', durationMs: 400,
    uses: ['u1', 'u2', 'u3', 'u4'].map(useKey => ({ useKey, skillKey: 'author_q' })),
    hits: [0, 100, 200, 300].map((at, index) => ({ entryKey: `h${index}`, at, useKey: `u${index + 1}` }))
  });
  await assertNativeResult(result, testInfo);
  expect(result.done!.finalSnapshot.useTriggerLedger).toHaveLength(2);
  expect(result.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(960);
  expect(providerState(result.done!, 'item:synth_window').state).toMatchObject({ hits: 0, icd: 1 });
});

test('实际 Worker：普通攻击发起不得提前伤害或回蓝', async ({ page }, testInfo) => {
  const hit = await runP6(page, { mode: 'spellblade', durationMs: 15, startOnly: true });
  await assertNativeResult(hit, testInfo);
  expect(hit.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current).toBe(0);
  expect(hit.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(1000);
  expect(hit.done!.evidence.items.some(item => item.kind === 'damage')).toBe(false);
  expect(providerState(hit.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 1, icd: 0 });
});

test('实际 Worker：反向拥有者的回蓝、命中与同次使用账本归属一致', async ({ page }, testInfo) => {
  const program = syntheticSpellblade();
  const result = await runP6(page, { mode: 'spellblade', program, owner: 'target', durationMs: 100 });
  await assertNativeResult(result, testInfo);
  const owner = result.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!;
  expect(owner.resources.mana.current).toBe(50);
  expect(result.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.attributes.hp.current).toBe(960);
  expect(result.done!.finalSnapshot.useTriggerLedger).toEqual([expect.objectContaining({ owner: 'target', useSource: 'target', useKey: 'aa1', target: null })]);
});

test('实际 Worker：目标范围状态使用声明的非零初值，按原命中目标记录额度', async ({ page }, testInfo) => {
  const program = syntheticWindow('provider_target', 5);
  const result = await runP6(page, { mode: 'window', program, durationMs: 300,
    uses: [{ useKey: 'u1', skillKey: 'author_q' }, { useKey: 'u2', skillKey: 'author_q' }],
    hits: [{ entryKey: 'h1', at: 0, useKey: 'u1' }, { entryKey: 'h2', at: 100, useKey: 'u2' }]
  });
  await assertNativeResult(result, testInfo);
  expect(providerState(result.done!, 'item:synth_window').targetState).toMatchObject({ target: 'target', values: { hits: 5 } });
  expect(result.done!.finalSnapshot.useTriggerLedger).toHaveLength(2);
  expect(result.done!.finalSnapshot.useTriggerLedger!.every(row => row.scope === 'provider_target' && row.target === 'target')).toBe(true);
  expect(result.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(960);
});

test('实际 Worker：限时护盾在第二次独立使用生效，到期边界不再吸收', async ({ page }, testInfo) => {
  const program = shieldWindow();
  const payload = { mode: 'window' as const, program,
    uses: [{ useKey: 'u1', skillKey: 'author_q' }, { useKey: 'u2', skillKey: 'author_q' }],
    hits: [{ entryKey: 'h1', at: 0, useKey: 'u1' }, { entryKey: 'h2', at: 100, useKey: 'u2' }]
  };
  const active = await runP6(page, { ...payload, durationMs: 300, incoming: [{ at: 200, amount: 40 }] });
  await assertNativeResult(active, testInfo);
  const source = active.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!;
  expect(source.attributes.hp.current).toBe(1000);
  expect(source.shields).toEqual([expect.objectContaining({ remaining: 110, expireAt: 2100 })]);
  const expired = await runP6(page, { ...payload, durationMs: 2200, incoming: [{ at: 200, amount: 40 }, { at: 2100, amount: 40 }] });
  await assertNativeResult(expired, testInfo);
  const after = expired.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!;
  expect(after.attributes.hp.current).toBe(960);
  expect(after.shields).toEqual([]);
});

const twoSkills = {
  selectedCastAbilityKeys: ['q', 'w'],
  extraChampionAbilities: [{ abilityKey: 'e', kind: 'active', skillKey: 'champion_e', operations: [] }]
};

test('实际 Worker：技能与普攻四种命中组合，同 use 多段与跳伤只计一次', async ({ page }, testInfo) => {
  const program = dualEventWindow();
  const skillThenAa = await runP6(page, {
    mode: 'window', program,
    uses: [{ useKey: 'u1', skillKey: 'author_q' }],
    hits: [{ entryKey: 'h1', at: 0, useKey: 'u1' }],
    aaHits: [{ entryKey: 'aa1', at: 100, useKey: 'aa1' }]
  });
  await assertNativeResult(skillThenAa, testInfo);
  expect(providerState(skillThenAa.done!, 'item:synth_window').state).toMatchObject({ hits: 0, icd: 1 });
  expect(skillThenAa.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(960);

  const aaThenSkill = await runP6(page, {
    mode: 'window', program,
    uses: [{ useKey: 'u1', skillKey: 'author_q' }],
    aaHits: [{ entryKey: 'aa1', at: 0, useKey: 'aa1' }],
    hits: [{ entryKey: 'h1', at: 100, useKey: 'u1' }]
  });
  await assertNativeResult(aaThenSkill, testInfo);
  expect(providerState(aaThenSkill.done!, 'item:synth_window').state).toMatchObject({ hits: 0, icd: 1 });

  const multiThenAa = await runP6(page, {
    mode: 'window', program,
    uses: [{ useKey: 'u1', skillKey: 'author_q' }],
    hits: [
      { entryKey: 'h1', at: 0, useKey: 'u1' },
      { entryKey: 'h2', at: 40, useKey: 'u1' }
    ],
    aaHits: [{ entryKey: 'aa1', at: 100, useKey: 'aa1' }]
  });
  await assertNativeResult(multiThenAa, testInfo);
  expect(providerState(multiThenAa.done!, 'item:synth_window').state).toMatchObject({ hits: 0, icd: 1 });
  expect(multiThenAa.done!.finalSnapshot.useTriggerLedger?.filter(row => row.useKey === 'u1')).toHaveLength(1);

  const sameUseOnly = await runP6(page, {
    mode: 'window', program, durationMs: 300,
    uses: [{ useKey: 'dot1', skillKey: 'author_q' }],
    hits: [
      { entryKey: 'h1', at: 0, useKey: 'dot1' },
      { entryKey: 'h2', at: 50, useKey: 'dot1' }
    ]
  });
  await assertNativeResult(sameUseOnly, testInfo);
  expect(providerState(sameUseOnly.done!, 'item:synth_window').state).toMatchObject({ hits: 1, icd: 0 });
});

test('实际 Worker：单组启动在9000刷新，旧期限无效且19000到期', async ({ page }, testInfo) => {
  const armed = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 10000, startOnly: true,
    ...twoSkills,
    casts: [
      { entryKey: 'cast_q', abilityKey: 'q', at: 0, skillKey: 'champion_q' },
      { entryKey: 'cast_w', abilityKey: 'w', at: 9000, skillKey: 'champion_w' }
    ]
  });
  await assertNativeResult(armed, testInfo);
  const armedBag = providerState(armed.done!, 'item:synth_spellblade');
  expect(armedBag.state).toMatchObject({ ready: 1, icd: 0 });
  expect(armedBag.expireAt).toMatchObject({ ready: 19000 });

  const consumed = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 12000,
    startAt: 11000, hitAt: 11000,
    ...twoSkills,
    casts: [
      { entryKey: 'cast_q', abilityKey: 'q', at: 0, skillKey: 'champion_q' },
      { entryKey: 'cast_w', abilityKey: 'w', at: 9000, skillKey: 'champion_w' }
    ]
  });
  await assertNativeResult(consumed, testInfo);
  expect(providerState(consumed.done!, 'item:synth_spellblade')).toMatchObject({ state: { ready: 0, icd: 1 }, expireAt: { icd: 12500 } });
  expect(consumed.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current).toBe(50);
  expect(consumed.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(960);
  expect(consumed.done!.evidence.items.filter(item => item.kind === 'damage')).toHaveLength(1);

  const timeout = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 19000, startOnly: true,
    ...twoSkills,
    casts: [
      { entryKey: 'cast_q', abilityKey: 'q', at: 0, skillKey: 'champion_q' },
      { entryKey: 'cast_w', abilityKey: 'w', at: 9000, skillKey: 'champion_w' }
    ]
  });
  await assertNativeResult(timeout, testInfo);
  expect(providerState(timeout.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 0, icd: 0 });
});

test('实际 Worker：未绑定主动施法不刷新，真实 use 与 owner 保持', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 10500, startOnly: true,
    selectedCastAbilityKeys: ['q'],
    extraChampionAbilities: [{ abilityKey: 'e', kind: 'active', skillKey: 'champion_e', operations: [] }],
    casts: [
      { entryKey: 'cast_q', abilityKey: 'q', at: 0, skillKey: 'champion_q' },
      { entryKey: 'cast_e', abilityKey: 'e', at: 9000, skillKey: 'champion_e' }
    ]
  });
  await assertNativeResult(result, testInfo);
  expect(providerState(result.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 0, icd: 0 });
  expect(result.done!.finalSnapshot.useTriggerLedger ?? []).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ useSkillKey: 'item_passive' })])
  );
  const qUse = result.done!.evidence.items.some(item => item.kind === 'emitted_event' && item.ref === 'event/ability_started');
  expect(qUse).toBe(true);
});

test('实际 Worker：待命恢复可消费，消费后恢复重开仍拒绝旧命中', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 10500, startOnly: true,
    ...twoSkills,
    casts: [
      { entryKey: 'q0', abilityKey: 'q', at: 0, skillKey: 'champion_q' },
      { entryKey: 'w9', abilityKey: 'w', at: 9000, skillKey: 'champion_w' }
    ],
    resumeEmpowered: { startAt: 10900, hitAt: 11000, durationMs: 1000, restoreDurationMs: 2000, reopenAt: 12500 }
  });
  await assertNativeResult(result, testInfo);
  expect(providerState(result.done!, 'item:synth_spellblade')).toMatchObject({ state: { ready: 1, icd: 0 }, expireAt: { ready: 19000 } });
  expect(result.resumedDone).toBeDefined();
  const consumed = providerState(result.resumedDone!, 'item:synth_spellblade');
  expect(consumed).toMatchObject({ state: { ready: 0, icd: 1 }, expireAt: { icd: 12500 } });
  expect((consumed.expireAt as Record<string, number>).ready ?? 0).toBe(0);
  expect(result.consumedRestoredDone).toBeDefined();
  expect(providerState(result.consumedRestoredDone!, 'item:synth_spellblade')).toMatchObject({ state: { ready: 1, icd: 0 }, expireAt: { ready: 22500 } });
  expect(result.consumedRestoredDone!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current).toBe(50);
  expect(result.consumedRestoredDone!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(960);
  expect(result.consumedRestoredDone!.evidence.items.filter(item => item.kind === 'damage')).toHaveLength(0);
  expect(result.consumedRestoredDone!.finalSnapshot.useTriggerLedger).toEqual([
    expect.objectContaining({ owner: 'source', providerRef: 'item:synth_spellblade', groupKey: 'spellblade', useKey: 'resume_aa' })
  ]);
});

test('实际 Worker：实际普攻目标决定结算，同次重复及重开后的旧事件不能再消费', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(), durationMs: 13000, startAt: 10900,
    casts: [
      { entryKey: 'cast0', abilityKey: 'cast', at: 0, skillKey: 'champion_q', target: 'source' },
      { entryKey: 'cast9', abilityKey: 'cast', at: 9000, skillKey: 'champion_q', target: 'source' },
      { entryKey: 'reopen', abilityKey: 'cast', at: 12500, skillKey: 'champion_q', target: 'source' }
    ],
    aaHits: [
      { entryKey: 'hit', at: 11000, useKey: 'aa1' },
      { entryKey: 'same_time_repeat', at: 11000, useKey: 'aa1' },
      { entryKey: 'repeat', at: 11001, useKey: 'aa1' },
      { entryKey: 'old_after_reopen', at: 12501, useKey: 'aa1' }
    ]
  });
  await assertNativeResult(result, testInfo);
  expect(result.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current).toBe(50);
  expect(result.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(960);
  expect(result.done!.evidence.items.filter(item => item.kind === 'damage')).toHaveLength(1);
  expect(providerState(result.done!, 'item:synth_spellblade')).toMatchObject({ state: { ready: 1, icd: 0 }, expireAt: { ready: 22500 } });
  expect(result.done!.finalSnapshot.useTriggerLedger).toEqual([
    expect.objectContaining({ owner: 'source', providerRef: 'item:synth_spellblade', groupKey: 'spellblade', scope: 'provider', useKey: 'aa1' })
  ]);
});

test('实际 Worker：刷新期限同刻的普攻已过期，缺真实使用事实拒绝运行', async ({ page }, testInfo) => {
  const expired = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(), durationMs: 19000, startAt: 18900, hitAt: 19000,
    casts: [
      { entryKey: 'cast0', abilityKey: 'cast', at: 0, skillKey: 'champion_q' },
      { entryKey: 'cast9', abilityKey: 'cast', at: 9000, skillKey: 'champion_q' }
    ]
  });
  await assertNativeResult(expired, testInfo);
  expect(expired.done!.finalSnapshot.combatants.find(actor => actor.key === 'source')!.resources.mana.current).toBe(0);
  expect(expired.done!.finalSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp.current).toBe(1000);
  expect(providerState(expired.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 0, icd: 0 });
  const missing = await runP6(page, { mode: 'spellblade', durationMs: 100, omitAttackUse: true });
  expect(missing.compileOk).toBe(true);
  expect(missing.runError).toMatch(/useRef|使用|skillUses/);
  expect(missing.done).toBeUndefined();
});

test('实际 Worker：同定义另一个挂载未绑定时不能刷新窗口', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 10500, startOnly: true,
    additionalChampionMount: 'champion_alt',
    selectedCastAbilityKeys: ['q'],
    casts: [
      { entryKey: 'q0', abilityKey: 'q', at: 0, skillKey: 'champion_q' },
      { entryKey: 'other_q9', providerRef: 'champion_alt', abilityKey: 'q', at: 9000, skillKey: 'champion_q' }
    ]
  });
  await assertNativeResult(result, testInfo);
  expect(providerState(result.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 0, icd: 0 });
});

test('实际 Worker：明确选择W时，未选Q入口不能刷新窗口', async ({ page }, testInfo) => {
  const result = await runP6(page, {
    mode: 'spellblade', program: refreshSpellblade(10000), durationMs: 10500, startOnly: true,
    selectedCastAbilityKeys: ['w'],
    casts: [
      { entryKey: 'w0', abilityKey: 'w', at: 0, skillKey: 'champion_w' },
      { entryKey: 'q9', abilityKey: 'q', at: 9000, skillKey: 'champion_q' }
    ]
  });
  await assertNativeResult(result, testInfo);
  expect(providerState(result.done!, 'item:synth_spellblade').state).toMatchObject({ ready: 0, icd: 0 });
});
