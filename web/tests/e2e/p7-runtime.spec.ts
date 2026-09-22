import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { CompileRequest, DoneResult, RunRequest } from '../../src/types/genericEngine';
import type { AuthoredPersistentResult, PersistentResultBinding } from '../../src/engine/persistentResultAdapter';
import { fixedValue, parameterValue } from '../../src/types/numericValue';
import type { SkillParameter } from '../../src/types/skillParameter';
import type { GameVampRule } from '../../src/types/gameVamp';
import type { AuthoredVampDamage } from '../../src/engine/vampAdapter';

const WASM_PATH = resolve('src/engine/wasm/tinygo_engine_v2.wasm');
const WASM_SHA256 = '1434E7D212D8CA0F8A6139C70B47CD098A774D2EC0A78BC424617B0CA9637F61';
const WASM_BYTES = 888566;

function slot(value: number, max = value) {
  return { base: value, current: value, max, resolved: value };
}

function lifecycle(duration: number) {
  return {
    durationValue: fixedValue(duration), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
    instanceScope: 'SOURCE_TARGET' as const, reapplicationStackMode: 'KEEP' as const,
    reapplicationDurationMode: 'REFRESH_ALL' as const, expiryMode: 'ALL_AT_ONCE' as const,
    periodicIntervalValue: null, firstPeriodicExecution: null
  };
}

function slowAuthored(skillKey: string, resultKey: string, statusKey: string, strength: number, duration: number, parameter?: SkillParameter): AuthoredPersistentResult {
  return {
    gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1, effectKey: `${resultKey}_effect`,
    lifecycle: lifecycle(duration), source: 'source', target: 'target',
    statuses: [{ statusKey, statusKind: 'MOVEMENT_SLOW', status: 'ENABLED' }],
    modifierZones: [], parameters: parameter ? [parameter] : undefined,
    result: {
      resultKey, name: '普通减速', resultType: 'STATUS_OPERATION', target: 'TARGET', description: null, sortOrder: 0,
      spellShieldBlockScope: null,
      valueRule: {
        value: parameter ? parameterValue(parameter.parameterKey) : fixedValue(strength),
        fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: 1
      },
      detail: { statusKey, operation: 'APPLY' },
      lifecycleBehavior: {
        moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
        reapplicationValueMode: 'REPLACE', periodicExecutionMode: null
      }
    }
  };
}

function woundAuthored(skillKey: string, resultKey: string, ratio: number, duration: number, healingKind: 'ANY' | 'DIRECT' | 'VAMP' = 'ANY'): AuthoredPersistentResult {
  return {
    gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1, effectKey: `${resultKey}_effect`,
    lifecycle: lifecycle(duration), source: 'source', target: 'target',
    statuses: [],
    modifierZones: [{ modifierZoneKey: 'grievous', domain: 'HEALING', calculationMode: 'RATIO_MAX', status: 'ENABLED' }],
    result: {
      resultKey, name: '受到治疗降低', resultType: 'HEALING_MODIFIER', target: 'TARGET', description: null, sortOrder: 0,
      spellShieldBlockScope: null,
      valueRule: { value: fixedValue(ratio), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      detail: { modifierZoneKey: 'grievous', direction: 'RECEIVED', operation: 'DECREASE', healingKind },
      lifecycleBehavior: {
        moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
        reapplicationValueMode: 'KEEP', periodicExecutionMode: null
      }
    }
  };
}

function strengthParam(value: number): SkillParameter {
  return {
    gameId: 'lol', skillKey: 'urgot_q', parameterKey: 'strength', name: '强度', valueType: 'DECIMAL',
    valueMode: 'FIXED', fixedValue: value, levelValues: null, description: null, sortOrder: 0, createdAt: '', updatedAt: ''
  };
}

function baseRequest(): CompileRequest {
  return {
    schemaVersion: 'generic-p0', schemaHash: 'schema.p7.browser', rulesHash: 'before-p7',
    typeCatalog: { types: [{ key: 'damage/physical', domain: 'damage' }], relations: [] }, rules: {},
    combatants: [
      {
        key: 'source',
        attributes: { hp: slot(500, 1000), life_steal_percent: slot(0.1), omnivamp_percent: slot(0.2), heal_shield_power_percent: slot(0) },
        resources: {}, providers: [{ providerRef: 'champion', definitionRef: 'champion' }]
      },
      {
        key: 'target',
        attributes: { hp: slot(100, 1000), armor: slot(0), life_steal_percent: slot(0), omnivamp_percent: slot(0) },
        resources: {}, providers: []
      }
    ],
    sharedProviders: [{
      providerKey: 'champion', stableId: 'champion', kind: 'champion',
      abilities: [
        { abilityKey: 'apply', kind: 'active', operations: [] },
        { abilityKey: 'apply_strong', kind: 'active', operations: [] },
        { abilityKey: 'apply_weak', kind: 'active', operations: [] },
        { abilityKey: 'heal', kind: 'active', operations: [{ operation: 'heal', target: 'target', amount: { op: 'const', value: 100 } }] },
        { abilityKey: 'hit', kind: 'active', operations: [{ operation: 'damage', target: 'target', damageType: 'damage/physical', amount: { op: 'const', value: 100 }, ref: 'damage-result' }] }
      ]
    }]
  };
}

function abilityRef(abilityKey: string): string {
  return `source.provider[champion].ability[${abilityKey}]`;
}

async function runBindings(
  page: Page,
  bindings: PersistentResultBinding[],
  entries: RunRequest['driverPlan']['entries'],
  durationMs: number,
  extra?: { vamp?: { rules: GameVampRule[]; damage: AuthoredVampDamage }; targetHp?: number; targetCanApply?: boolean }
) {
  await page.route('**/p7-browser-harness', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>第7项运行验证</title>'
  }));
  await page.goto('/p7-browser-harness');
  const input = baseRequest();
  if (extra?.targetCanApply) {
    input.combatants[1]!.providers.push({ providerRef: 'champion', definitionRef: 'champion' });
  }
  if (extra?.targetHp !== undefined) {
    input.combatants[1]!.attributes.hp = slot(extra.targetHp, 1000);
  }
  return page.evaluate(async (data) => {
    const { withPersistentResults } = await import(/* @vite-ignore */ '/src/engine/persistentResultAdapter.ts');
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const client = new GenericEngineClient();
    try {
      let request = data.input;
      request = withPersistentResults(request, data.bindings, { rulesHash: 'with-p7' });
      let rulesHash = 'with-p7';
      if (data.vamp) {
        const { withVampConfiguration } = await import(/* @vite-ignore */ '/src/engine/vampAdapter.ts');
        request = withVampConfiguration(request, data.vamp.rules, [{
          providerKey: 'champion', abilityKey: 'hit', operationIndex: 0, damage: data.vamp.damage
        }], { combatantKinds: { source: 'CHAMPION', target: 'CHAMPION' }, rulesHash: 'with-p7-vamp' });
        rulesHash = 'with-p7-vamp';
      }
      const compiled = await client.compile(request);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
      const done = await client.run({
        sessionId: compiled.sessionId, expectedRulesHash: rulesHash, schemaVersion: request.schemaVersion,
        schemaHash: request.schemaHash, rulesHash,
        initialSnapshot: {
          schemaHash: request.schemaHash, rulesHash, timeMs: 0,
          combatants: request.combatants.map((actor) => ({
            key: actor.key, attributes: structuredClone(actor.attributes), resources: {}, cooldowns: {},
            providers: actor.providers.map((provider) => ({
              providerRef: provider.providerRef, definitionRef: provider.definitionRef,
              source: actor.key, owner: actor.key, stacks: 1, expireAt: null, state: {}
            })),
            shields: [], abilityState: {}, providerState: {}, vars: {}, effectiveStatuses: []
          }))
        },
        driverPlan: { entries: data.entries, conditionRecheckIntervalMs: 100 },
        stopPolicy: { durationMs: data.durationMs, stopOnTargetDeath: false, stopWhenNoEvents: false },
        sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 100 }
      });
      const released = await client.release(compiled.sessionId, rulesHash);
      return { done, released, rulesHash, wasmNote: 'web/src/engine/wasm/tinygo_engine_v2.wasm' };
    } finally {
      client.terminate();
    }
  }, { input, bindings, entries, durationMs, vamp: extra?.vamp ?? null });
}

function targetCombatant(done: DoneResult) {
  return done.finalSnapshot.combatants.find((row) => row.key === 'target')!;
}

test('正式 Wasm 产物身份', () => {
  const bytes = readFileSync(WASM_PATH);
  expect(bytes.length).toBe(WASM_BYTES);
  expect(createHash('sha256').update(bytes).digest('hex').toUpperCase()).toBe(WASM_SHA256);
});

test('实际 Worker：30% 与 70% 两个效果，强者结束恢复弱者', async ({ page }) => {
  const result = await runBindings(page, [
    { providerKey: 'status:slow30', applyProviderKey: 'champion', applyAbilityKey: 'apply', authored: slowAuthored('urgot_q', 'slow30', 'slow_a', 0.3, 3000) },
    { providerKey: 'status:slow70', applyProviderKey: 'champion', applyAbilityKey: 'apply', authored: slowAuthored('nasus_w', 'slow70', 'slow_b', 0.7, 1000) }
  ], [{ entryKey: 'apply', abilityRef: abilityRef('apply'), source: 'source', target: 'target', firstAtMs: 0 }], 1500);
  expect(result.released.released).toBe(true);
  const status = targetCombatant(result.done).effectiveStatuses?.[0];
  expect(status?.strength).toBeCloseTo(0.3, 9);
  expect(status?.contributions).toHaveLength(1);
  expect(status?.contributions[0]).toMatchObject({
    providerRef: expect.any(String), resultRef: 'slow30', statusKey: 'slow_a', source: 'source', strength: 0.3
  });
  expect(status?.contributions[0]?.expireAt).toBe(3000);
  const evidence = result.done.evidence.items.filter((item) => item.kind.startsWith('provider_'));
  expect(evidence.filter((item) => item.kind === 'provider_apply').map((item) => item.timeMs)).toEqual([0, 0]);
  expect(evidence.some((item) => item.kind === 'provider_expire' && item.timeMs === 1000)).toBe(true);
});

test('实际 Worker：同来源更弱重施与旧到期事件', async ({ page }) => {
  const result = await runBindings(page, [
    { providerKey: 'status:slow', applyProviderKey: 'champion', applyAbilityKey: 'apply_strong', authored: slowAuthored('urgot_q', 'slow', 'slow_q', 0.7, 1000, strengthParam(0.7)) },
    { providerKey: 'status:slow', applyProviderKey: 'champion', applyAbilityKey: 'apply_weak', authored: slowAuthored('urgot_q', 'slow', 'slow_q', 0.3, 1000, strengthParam(0.3)) }
  ], [
    { entryKey: 'strong', abilityRef: abilityRef('apply_strong'), source: 'source', target: 'target', firstAtMs: 0 },
    { entryKey: 'weak', abilityRef: abilityRef('apply_weak'), source: 'source', target: 'target', firstAtMs: 500 }
  ], 1200);
  expect(result.released.released).toBe(true);
  const target = targetCombatant(result.done);
  expect(target.providers).toHaveLength(1);
  expect(target.providers[0]?.expireAt).toBe(1500);
  expect(target.providers[0]?.source).toBe('source');
  expect(target.providers[0]?.owner).toBe('target');
  expect(target.providers[0]?.stacks).toBe(1);
  expect(target.effectiveStatuses?.[0]?.strength).toBeCloseTo(0.3, 9);
  const evidence = result.done.evidence.items.filter((item) => item.kind.startsWith('provider_'));
  expect(evidence.some((item) => item.kind === 'provider_apply' && item.timeMs === 0)).toBe(true);
  expect(evidence.some((item) => item.kind === 'provider_refresh' && item.timeMs === 500)).toBe(true);
  expect(evidence.filter((item) => item.kind === 'provider_expire' && item.timeMs === 1000)).toEqual([]);
});

test('实际 Worker：同一减速定义由两个实际来源施加，分别保留期限', async ({ page }) => {
  const bindings: PersistentResultBinding[] = [
    { providerKey: 'status:slow', applyProviderKey: 'champion', applyAbilityKey: 'apply_strong', authored: slowAuthored('urgot_q', 'slow', 'slow_q', 0.7, 1000, strengthParam(0.7)) },
    { providerKey: 'status:slow', applyProviderKey: 'champion', applyAbilityKey: 'apply_weak', authored: slowAuthored('urgot_q', 'slow', 'slow_q', 0.3, 1000, strengthParam(0.3)) }
  ];
  const entries = [
    { entryKey: 'strong', abilityRef: abilityRef('apply_strong'), source: 'source', target: 'target', firstAtMs: 0 },
    { entryKey: 'weak', abilityRef: 'target.provider[champion].ability[apply_weak]', source: 'target', target: 'target', firstAtMs: 500 }
  ];
  // 两个战斗对象的合成机制样例；自施只用于核对真实来源身份，不声称该英雄可自我施加此技能。
  const overlap = await runBindings(page, bindings, entries, 700, { targetCanApply: true });
  const simultaneous = targetCombatant(overlap.done).effectiveStatuses?.[0];
  expect(simultaneous?.strength).toBeCloseTo(0.7, 9);
  expect(simultaneous?.contributions).toHaveLength(2);
  expect(simultaneous?.contributions.map(row => row.source).sort()).toEqual(['source', 'target']);
  expect(new Set(simultaneous?.contributions.map(row => row.providerRef)).size).toBe(2);
  expect(simultaneous?.contributions.map(row => row.expireAt).sort()).toEqual([1000, 1500]);
  expect(overlap.released.released).toBe(true);
  const recovered = await runBindings(page, bindings, entries, 1200, { targetCanApply: true });
  const effective = targetCombatant(recovered.done).effectiveStatuses?.[0];
  expect(effective?.strength).toBeCloseTo(0.3, 9);
  expect(effective?.contributions).toHaveLength(1);
  expect(effective?.contributions[0]).toMatchObject({ source: 'target', expireAt: 1500 });
  expect(recovered.released.released).toBe(true);
});

test('实际 Worker：两个 40% 受到治疗降低 100→60，强 60% 结束后弱 40% 恢复', async ({ page }) => {
  const twoForty = await runBindings(page, [
    { providerKey: 'status:wound40a', applyProviderKey: 'champion', applyAbilityKey: 'apply', authored: woundAuthored('morellonomicon', 'wound40a', 0.4, 3000) },
    { providerKey: 'status:wound40b', applyProviderKey: 'champion', applyAbilityKey: 'apply', authored: woundAuthored('executioners', 'wound40b', 0.4, 3000) }
  ], [
    { entryKey: 'apply', abilityRef: abilityRef('apply'), source: 'source', target: 'target', firstAtMs: 0 },
    { entryKey: 'heal', abilityRef: abilityRef('heal'), source: 'source', target: 'target', firstAtMs: 10 }
  ], 100, { targetHp: 100 });
  expect(twoForty.released.released).toBe(true);
  const firstHeals = twoForty.done.evidence.items.filter((item) => item.kind === 'heal');
  expect(firstHeals).toHaveLength(1);
  expect(firstHeals[0]?.timeMs).toBe(10);
  expect(firstHeals[0]?.data?.actualHealing).toBeCloseTo(60, 9);
  expect(twoForty.done.summary.targetFinalHp).toBeCloseTo(160, 9);

  const recover = await runBindings(page, [
    { providerKey: 'status:wound40', applyProviderKey: 'champion', applyAbilityKey: 'apply', authored: woundAuthored('morellonomicon', 'wound40', 0.4, 3000) },
    { providerKey: 'status:wound60', applyProviderKey: 'champion', applyAbilityKey: 'apply', authored: woundAuthored('synthetic_60', 'wound60', 0.6, 1000) }
  ], [
    { entryKey: 'apply', abilityRef: abilityRef('apply'), source: 'source', target: 'target', firstAtMs: 0 },
    { entryKey: 'heal_strong', abilityRef: abilityRef('heal'), source: 'source', target: 'target', firstAtMs: 100 },
    { entryKey: 'heal_recover', abilityRef: abilityRef('heal'), source: 'source', target: 'target', firstAtMs: 1100 }
  ], 1200, { targetHp: 100 });
  expect(recover.released.released).toBe(true);
  const heals = recover.done.evidence.items.filter((item) => item.kind === 'heal');
  expect(heals.map((item) => item.timeMs)).toEqual([100, 1100]);
  expect(heals[0]?.data?.actualHealing).toBeCloseTo(40, 9);
  expect(heals[1]?.data?.actualHealing).toBeCloseTo(60, 9);
});

test('实际 Worker：直接治疗与吸血走同一取强乘区', async ({ page }) => {
  const vampRules: GameVampRule[] = [
    { vampType: 'LIFE_STEAL', sourceAttributeKey: 'life_steal_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE',
      defaultEfficiency: 1, deliveryKinds: ['BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['basic_attack'] }
  ];
  const damage: AuthoredVampDamage = {
    gameId: 'lol', skillKey: 'shared_basic_attack', skillCategoryKeys: ['basic_attack'], skillLevel: 1, characterLevel: 1,
    detail: { damageTypeKey: 'physical', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: [] }
  };
  const result = await runBindings(page, [
    { providerKey: 'status:wound', applyProviderKey: 'champion', applyAbilityKey: 'apply', authored: woundAuthored('morellonomicon', 'wound', 0.4, 3000, 'ANY') }
  ], [
    { entryKey: 'apply_target', abilityRef: abilityRef('apply'), source: 'source', target: 'target', firstAtMs: 0 },
    { entryKey: 'apply_source', abilityRef: abilityRef('apply'), source: 'source', target: 'source', firstAtMs: 0 },
    { entryKey: 'heal', abilityRef: abilityRef('heal'), source: 'source', target: 'target', firstAtMs: 10 },
    { entryKey: 'hit', abilityRef: abilityRef('hit'), source: 'source', target: 'target', firstAtMs: 20 }
  ], 80, { vamp: { rules: vampRules, damage }, targetHp: 100 });
  expect(result.released.released).toBe(true);
  const heal = result.done.evidence.items.find((item) => item.kind === 'heal');
  const vamp = result.done.evidence.items.find((item) => item.kind === 'vamp');
  expect(heal?.data?.actualHealing).toBeCloseTo(60, 9);
  expect(vamp).toBeTruthy();
  expect(Number(vamp?.data?.healingAfterModifiers)).toBeLessThan(10);
});

test('原库乌尔加特配置保留命中要求，独立结果入口拒绝绕过', async ({ page, request }, testInfo) => {
  test.skip(process.env.P7_LIVE_API !== '1', '显式启用后只读本地实际服务');
  const api = 'http://127.0.0.1:8080/api/admin/games/lol';
  const headers = { Authorization: `Bearer ${process.env.DAMAGE_ADMIN_TOKEN || 'test'}` };
  const read = async (path: string) => {
    const response = await request.get(api + path, { headers });
    expect(response.status(), path).toBe(200);
    return response.json();
  };
  const [effect, parameters, formulas, status] = await Promise.all([
    read('/skills/urgot_q/effects/corrosive_charge_slow'), read('/skills/urgot_q/parameters'),
    read('/skills/urgot_q/formulas'), read('/statuses/movement_slow')
  ]);
  expect(effect.results).toHaveLength(1);
  expect(effect.results[0].spellShieldBlockScope).toBe('RESULT');
  const authored: AuthoredPersistentResult = {
    gameId: effect.gameId, skillKey: effect.skillKey, effectKey: effect.effectKey,
    skillLevel: 1, characterLevel: 1, source: 'source', target: 'target',
    lifecycle: effect.lifecycle, result: effect.results[0], parameters, formulas,
    statuses: [status], modifierZones: []
  };
  await page.route('**/p7-live-read-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>正式配置适配边界</title>' }));
  await page.goto('/p7-live-read-harness');
  const rejected = await page.evaluate(async data => {
    const { adaptPersistentResult } = await import(/* @vite-ignore */ '/src/engine/persistentResultAdapter.ts');
    try { adaptPersistentResult(data, 'status:urgot_q'); return null; }
    catch (failure) { return { path: (failure as { path?: string }).path, message: String(failure) }; }
  }, authored);
  expect(rejected?.path).toBe('skills.urgot_q.effects.corrosive_charge_slow.results.slow.spellShieldBlockScope');
  expect(rejected?.message).toContain('必须经命中处理入口执行');
  await testInfo.attach('真实配置与适配边界', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    effect, rejected, runtimeExecuted: false, note: '真实命中处理由第5项负责，未移除配置粒度或用布尔开关绕过'
  }, null, 2)) });
});

test('真实页面保存的两项重伤→GET→Worker，同组40%取强且各自到期', async ({ page, request }, testInfo) => {
  test.skip(process.env.P7_LIVE_API !== '1', '显式启用后只读本地实际服务');
  const api = 'http://127.0.0.1:8080/api/admin/games/lol';
  const headers = { Authorization: `Bearer ${process.env.DAMAGE_ADMIN_TOKEN || 'test'}` };
  const read = async (path: string) => {
    const response = await request.get(api + path, { headers });
    expect(response.status(), path).toBe(200);
    return response.json();
  };
  const zone = await read('/modifier-zones/grievous_wounds');
  const keys = ['item_3123_passive', 'item_3916_passive'];
  const originals = await Promise.all(keys.map(async skillKey => ({
    effect: await read(`/skills/${skillKey}/effects/grievous_wounds`),
    parameters: await read(`/skills/${skillKey}/parameters`)
  })));
  const bindings: PersistentResultBinding[] = originals.map(({ effect, parameters }, index) => ({
    providerKey: `status:${effect.skillKey}:${effect.effectKey}`,
    applyProviderKey: 'champion', applyAbilityKey: index === 0 ? 'apply' : 'apply_strong',
    authored: {
      gameId: effect.gameId, skillKey: effect.skillKey, effectKey: effect.effectKey,
      skillLevel: 1, characterLevel: 1, source: 'source', target: 'target',
      lifecycle: effect.lifecycle, result: effect.results[0], parameters, statuses: [], modifierZones: [zone]
    }
  }));
  const result = await runBindings(page, bindings, [
    { entryKey: 'first', abilityRef: abilityRef('apply'), source: 'source', target: 'target', firstAtMs: 0 },
    { entryKey: 'second', abilityRef: abilityRef('apply_strong'), source: 'source', target: 'target', firstAtMs: 1000 },
    { entryKey: 'both', abilityRef: abilityRef('heal'), source: 'source', target: 'target', firstAtMs: 1100 },
    { entryKey: 'one', abilityRef: abilityRef('heal'), source: 'source', target: 'target', firstAtMs: 3100 },
    { entryKey: 'none', abilityRef: abilityRef('heal'), source: 'source', target: 'target', firstAtMs: 4100 }
  ], 4200, { targetHp: 100 });
  const heals = result.done.evidence.items.filter(item => item.kind === 'heal');
  expect(heals.map(item => item.timeMs)).toEqual([1100, 3100, 4100]);
  expect(heals.map(item => item.data?.actualHealing)).toEqual([60, 60, 100]);
  expect(targetCombatant(result.done).attributes.hp.current).toBe(320);
  expect(result.released.released).toBe(true);
  const after = await Promise.all(keys.map(skillKey => read(`/skills/${skillKey}/effects/grievous_wounds`)));
  expect(after).toEqual(originals.map(row => row.effect));
  await testInfo.attach('真实重伤效果运行回读', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    skillKeys: keys, result: result.done, note: '实际保存的效果与参数直接编译；这里只显式施加结果，不证明装备伤害触发或生命回复覆盖。'
  }, null, 2)) });
});
