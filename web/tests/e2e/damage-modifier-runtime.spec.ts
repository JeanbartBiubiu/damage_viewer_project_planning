import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { AuthoredDamageModifierProgram, DamageModifierScenario } from '../../src/engine/damageModifierAdapter';
import type { SkillEffect, SkillEffectDamageModifierResult } from '../../src/types/skillEffect';
import type { SkillTriggerRuleDetail } from '../../src/types/skillTriggerRule';
import type { SkillParameter } from '../../src/types/skillParameter';
import type { SkillFormula } from '../../src/types/skillFormula';
import { fixedValue } from '../../src/types/numericValue';

function authored(comparator: 'LT' | 'GT' = 'LT'): AuthoredDamageModifierProgram {
  return {
    gameId: 'lol', skillKey: 'synthetic_health_bonus', skillLevel: 1, characterLevel: 1, owner: 'source',
    identity: { owner: { category: 'CHAMPION', hostility: 'SELF' }, opponent: { category: 'CHAMPION', hostility: 'ENEMY' } },
    modifierZones: [{ gameId: 'lol', modifierZoneKey: 'bonus', name: '合成独立增伤', domain: 'DAMAGE', calculationMode: 'RATIO_ADD',
      applicationStage: 'DAMAGE_PRE_DEFENSE', status: 'ENABLED', sortOrder: 10, description: null, createdAt: '', updatedAt: '' }],
    effects: [{ gameId: 'lol', skillKey: 'synthetic_health_bonus', effectKey: 'bonus', name: '合成门槛增伤', description: null,
      sortOrder: 10, createdAt: '', updatedAt: '', lifecycle: { instanceScope: 'SOURCE', durationValue: null,
        maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1), reapplicationStackMode: 'KEEP',
        reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY', periodicIntervalValue: null, firstPeriodicExecution: null },
      results: [{ resultKey: 'increase', name: '增加', resultType: 'DAMAGE_MODIFIER', target: 'SOURCE', description: null,
        sortOrder: 10, spellShieldBlockScope: null,
        valueRule: { value: fixedValue(0.08), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED',
          reapplicationValueMode: null, periodicExecutionMode: null },
        detail: { modifierZoneKey: 'bonus', direction: 'DEALT', operation: 'INCREASE', damageTypeKey: 'physics',
          deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT', criticalFilter: 'ANY',
          condition: { receiver: 'ENEMY_CHAMPION', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO', comparator,
            comparisonValue: fixedValue(comparator === 'LT' ? 0.4 : 0.6) } } }] }],
    rules: [{ ruleKey: 'initialize', name: '初始化', description: null, sortOrder: 10,
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, conditionGroups: [],
      actions: [{ actionKey: 'apply', name: '施加', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
        targetContext: 'CURRENT_TARGET', detail: { effectKey: 'bonus' }, runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null }]
  };
}
function scenario(hp: number, owner: 'source' | 'target' = 'source', options: { hits?: number; self?: boolean; type?: string; delivery?: string; origin?: string } = {}): DamageModifierScenario {
  const fixture = JSON.parse(readFileSync(resolve('../wasm/tinygo_engine_v2/internal/testkit/fixtures/generic_p0_basic_damage.json'), 'utf8')) as DamageModifierScenario;
  const { compileRequest: request, runRequest: run } = fixture;
  run.schemaVersion = request.schemaVersion; run.schemaHash = request.schemaHash; run.rulesHash = request.rulesHash;
  request.typeCatalog.types.push({ key: 'combatant/champion', domain: 'combatant' },
    { key: 'damage/magic', domain: 'damage' }, { key: 'damage/true', domain: 'damage' });
  for (const actor of request.combatants) {
    actor.types = ['combatant/champion']; actor.providers = [];
    actor.attributes.hp = { base: 1000, current: actor.key === owner && !options.self ? 900 : hp, max: 1000, resolved: 1000 };
  }
  for (const actor of run.initialSnapshot.combatants) {
    actor.providers = []; actor.attributes.hp = { base: 1000, current: actor.key === owner && !options.self ? 900 : hp, max: 1000, resolved: 1000 };
  }
  const provider = request.sharedProviders![0]!;
  const operation = provider.abilities![0]!.operations![0]!;
  operation.damageType = options.type ?? 'damage/physical'; operation.target = options.self ? 'self' : 'target';
  operation.types = [`damage_trait/${options.delivery ?? 'delivery_basic_attack'}`, `damage_trait/${options.origin ?? 'origin_direct'}`];
  provider.abilities![0]!.operations = Array.from({ length: options.hits ?? 1 }, () => structuredClone(operation));
  request.combatants.find(c => c.key === owner)!.providers.push({ providerRef: provider.providerKey, definitionRef: provider.providerKey });
  run.initialSnapshot.combatants.find(c => c.key === owner)!.providers.push({ providerRef: provider.providerKey,
    definitionRef: provider.providerKey, source: owner, owner, stacks: 1, expireAt: null, state: {} });
  const entry = run.driverPlan.entries[0]!;
  entry.source = owner; entry.target = owner === 'source' ? 'target' : 'source';
  entry.abilityRef = `${owner}.provider[${provider.providerKey}].ability[basic_attack]`;
  return { compileRequest: request, runRequest: run };
}
async function run(page: Page, input: DamageModifierScenario, program: AuthoredDamageModifierProgram, restore = false) {
  await page.route('**/damage-modifier-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>逐笔门槛运行核验</title>' }));
  await page.goto('/damage-modifier-harness');
  return page.evaluate(async ({ input, program, restore }) => {
    const { withDamageModifierPrograms } = await import(/* @vite-ignore */ '/src/engine/damageModifierAdapter.ts');
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const scenario = await withDamageModifierPrograms(input, [{ providerKey: 'rune:health_bonus', authored: program }]);
    const client = new GenericEngineClient();
    try {
      const compiled = await client.compile(scenario.compileRequest);
      if (!compiled.ok) return { compiled, scenario };
      scenario.runRequest.sessionId = compiled.sessionId!;
      const done = await client.run(scenario.runRequest);
      let resumed;
      if (restore) {
        const next = structuredClone(scenario.runRequest);
        next.initialSnapshot = done.finalSnapshot;
        next.driverPlan.entries[0]!.firstAtMs = done.finalSnapshot.timeMs + 1;
        next.stopPolicy.durationMs = done.finalSnapshot.timeMs + 100;
        resumed = await client.run(next);
      }
      const released = await client.release(compiled.sessionId!, scenario.compileRequest.rulesHash);
      return { compiled, scenario, done, resumed, released };
    } finally { client.terminate(); }
  }, { input, program, restore });
}

test('最终产物摘要记录与实际Worker严格生命边界', async ({ page }, info) => {
  const wasm = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(wasm.length).toBe(983981);
  expect(createHash('sha256').update(wasm).digest('hex')).toBe('25844991e66d5e189cee0b168869de07c265c5c3cc3336c7b1a9c793ac0d736d');
  await info.attach('wasm-identity', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ bytes: wasm.length,
    sha256: createHash('sha256').update(wasm).digest('hex') })) });
  for (const [comparison, hp, damage] of [['LT', 399, 108], ['LT', 400, 100], ['LT', 401, 100], ['GT', 601, 108], ['GT', 600, 100], ['GT', 599, 100]] as const) {
    const result = await run(page, scenario(hp), authored(comparison));
    await info.attach(`boundary-${comparison}-${hp}`, { contentType: 'application/json', body: Buffer.from(JSON.stringify(result)) });
    expect(result.compiled.ok, JSON.stringify(result.compiled)).toBe(true);
    expect(result.released?.released).toBe(true);
    expect(result.done!.summary.sourceDamageDealt).toBeCloseTo(damage, 8);
    expect(result.done!.summary.targetFinalHp).toBeCloseTo(hp - damage, 8);
    expect(result.done!.summary.sourceFinalHp).toBe(900);
  }
});
test('同一帧多笔与恢复后重新读取生命，反向拥有者与自伤资格正确', async ({ page }, info) => {
  const multiple = await run(page, scenario(450, 'source', { hits: 2 }), authored());
  expect(multiple.compiled.ok, JSON.stringify(multiple.compiled)).toBe(true);
  expect(multiple.done!.summary.sourceDamageDealt).toBe(208);
  const restored = await run(page, scenario(450), authored(), true);
  expect(restored.done!.summary.sourceDamageDealt).toBe(100);
  expect(restored.resumed!.summary.sourceDamageDealt).toBe(108);
  expect(restored.resumed!.summary.targetFinalHp).toBe(242);
  const reverse = authored(); reverse.owner = 'target';
  const reversed = await run(page, scenario(399, 'target'), reverse);
  expect(reversed.done!.summary.targetDamageDealt).toBe(108);
  expect(reversed.done!.summary.sourceFinalHp).toBe(291);
  expect(reversed.done!.summary.targetFinalHp).toBe(900);
  const self = await run(page, scenario(399, 'source', { self: true }), authored());
  expect(self.done!.summary.sourceFinalHp).toBe(299);
  await info.attach('multi-restore-reverse-self', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ multiple, restored, reversed, self })) });
});
test('实际Worker保持类型、产生方式与来源过滤，不合资格不增伤', async ({ page }, info) => {
  for (const variant of [{ type: 'damage/magic' }, { delivery: 'delivery_skill' }, { origin: 'origin_reflected' }]) {
    const result = await run(page, scenario(399, 'source', variant), authored());
    expect(result.compiled.ok, JSON.stringify(result.compiled)).toBe(true);
    expect(result.done!.summary.sourceDamageDealt).toBe(100);
  }
  const ally = authored(); ally.identity.opponent.hostility = 'ALLY';
  const result = await run(page, scenario(399), ally);
  expect(result.done!.summary.sourceDamageDealt).toBe(100);
  await info.attach('ally-not-eligible', { contentType: 'application/json', body: Buffer.from(JSON.stringify(result)) });
});
test('同区未命中动态金额不求值，独立乘区仍相乘', async ({ page }, info) => {
  const p = authored(), second = structuredClone(p.effects[0]!.results[0]!) as SkillEffectDamageModifierResult;
  second.resultKey = 'other'; second.detail.condition!.comparator = 'GT';
  second.valueRule.value = { kind: 'FORMULA', formulaKey: 'divide_by_current' }; second.valueRule.fixedMinValue = 0;
  p.formulas = [{ gameId: 'lol', skillKey: p.skillKey, formulaKey: 'divide_by_current', name: '合成动态比值', description: null,
    sortOrder: 10, createdAt: '', updatedAt: '', expression: { nodeType: 'OPERATION', operation: 'DIVIDE', operands: [
      { nodeType: 'ATTRIBUTE', attributeKey: 'power', attributeOwner: 'TARGET', attributeValueKind: 'BASE' },
      { nodeType: 'ATTRIBUTE', attributeKey: 'power', attributeOwner: 'TARGET', attributeValueKind: 'CURRENT' }] } }];
  p.effects[0]!.results.push(second);
  const input = scenario(399);
  input.compileRequest.combatants[1]!.attributes.power = { base: 1, current: 0, max: 1, resolved: 1 };
  input.runRequest.initialSnapshot.combatants[1]!.attributes.power = { base: 1, current: 0, max: 1, resolved: 1 };
  const lazy = await run(page, input, p);
  expect(lazy.compiled.ok, JSON.stringify(lazy.compiled)).toBe(true);
  expect(lazy.done!.summary.sourceDamageDealt).toBe(108);
  second.valueRule.value = fixedValue(0.1); second.detail.condition = null; second.detail.modifierZoneKey = 'separate';
  p.modifierZones = [...p.modifierZones, { ...p.modifierZones[0]!, modifierZoneKey: 'separate', sortOrder: 20 }];
  const multiplied = await run(page, scenario(399), p);
  expect(multiplied.done!.summary.sourceDamageDealt).toBeCloseTo(118.8, 8);
  await info.attach('short-circuit-and-zones', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ lazy, multiplied })) });
});
test('静态十进制公式与实际生命比例等值时不误触发严格门槛', async ({ page }, info) => {
  const p = authored();
  p.parameters = [['a', 0.1], ['b', 0.2]].map(([key, value]) => ({
    gameId: 'lol', skillKey: p.skillKey, parameterKey: String(key), name: String(key), description: null,
    sortOrder: 10, createdAt: '', updatedAt: '', valueMode: 'FIXED', valueType: 'DECIMAL', fixedValue: Number(value), levelValues: null
  }));
  p.formulas = [{ gameId: 'lol', skillKey: p.skillKey, formulaKey: 'sum', name: '十进制门槛', description: null,
    sortOrder: 10, createdAt: '', updatedAt: '', expression: { nodeType: 'OPERATION', operation: 'ADD', operands: [
      { nodeType: 'PARAMETER', parameterKey: 'a' }, { nodeType: 'PARAMETER', parameterKey: 'b' }] } }];
  (p.effects[0]!.results[0]! as SkillEffectDamageModifierResult).detail.condition!.comparisonValue = { kind: 'FORMULA', formulaKey: 'sum' };
  for (const [hp, expected] of [[300, 100], [299, 108]]) {
    const result = await run(page, scenario(hp!), p);
    expect(result.compiled.ok, JSON.stringify(result.compiled)).toBe(true);
    expect(result.done!.summary.sourceDamageDealt).toBe(expected);
    await info.attach(`decimal-boundary-${hp}`, { contentType: 'application/json', body: Buffer.from(JSON.stringify(result)) });
  }
});

for (const [id, name, comparator, threshold] of [[8014, '致命一击', 'LT', 0.4], [8017, '砍倒', 'GT', 0.6]] as const) {
  test(`正式页面组成只读进入Worker：${name}明确普通物理普攻输入的生命门槛`, async ({ page, request }, info) => {
    test.skip(process.env.DAMAGE_MODIFIER_LIVE_API !== '1', '仅页面保存重开及独立回读后启用；启用时缺组成必须失败');
    const skillKey = `rune_${id}_passive`, snapshots: Record<string, unknown> = {};
    const get = async <T,>(route: string): Promise<T> => {
      const response = await request.get(`http://127.0.0.1:8080/api/admin/games/lol${route}`,
        { headers: { Authorization: `Bearer ${process.env.DAMAGE_ADMIN_TOKEN || 'local-readonly-verification'}` } });
      expect(response.status(), route).toBe(200);
      const data = await response.json(); snapshots[route] = data; return data as T;
    };
    await get(`/runes/rune_${id}`);
    await get(`/skills/${skillKey}`);
    const relations = await get<{ items: Array<{ gameId: string; runeKey: string; skillKey: string }> }>(`/rune-skill-relations?runeKey=rune_${id}`);
    expect(relations.items.some(x => x.gameId === 'lol' && x.runeKey === `rune_${id}` && x.skillKey === skillKey)).toBe(true);
    const effect = await get<SkillEffect>(`/skills/${skillKey}/effects/basic_attack_health_bonus`);
    const rule = await get<SkillTriggerRuleDetail>(`/skills/${skillKey}/trigger-rules/initialize_basic_attack_bonus`);
    const parameters = await get<SkillParameter[]>(`/skills/${skillKey}/parameters`);
    const formulas: SkillFormula[] = [];
    for (const row of await get<Array<{ formulaKey: string }>>(`/skills/${skillKey}/formulas`)) {
      formulas.push(await get<SkillFormula>(`/skills/${skillKey}/formulas/${row.formulaKey}`));
    }
    const zones = await get<{ items: AuthoredDamageModifierProgram['modifierZones'] }>('/modifier-zones');
    expect(parameters.find(x => x.parameterKey === 'bonus_damage_ratio')?.fixedValue).toBe(0.08);
    expect(parameters.find(x => x.parameterKey === 'target_health_threshold_ratio')?.fixedValue).toBe(threshold);
    expect(parameters.find(x => x.parameterKey === 'confirmed_eligible_damage')).toMatchObject({ valueMode: 'RUNTIME_INPUT', fixedValue: null });
    expect(effect.results).toHaveLength(1);
    expect(effect.results[0]).toMatchObject({ resultType: 'DAMAGE_MODIFIER', target: 'SOURCE',
      valueRule: { value: { kind: 'PARAMETER', parameterKey: 'bonus_damage_ratio' } },
      detail: { direction: 'DEALT', operation: 'INCREASE', damageTypeKey: null, deliveryKind: 'ANY',
        originKind: 'DIRECT', criticalFilter: 'ANY', condition: { receiver: 'ENEMY_CHAMPION', attributeKey: 'hp',
          attributeValueKind: 'CURRENT_RATIO', comparator, comparisonValue: { kind: 'PARAMETER', parameterKey: 'target_health_threshold_ratio' } } } });
    const p: AuthoredDamageModifierProgram = { gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1,
      owner: 'source', identity: authored().identity, effects: [effect], rules: [rule], parameters, formulas, modifierZones: zones.items };
    const results = [];
    for (const delta of [-1, 0, 1]) {
      const hp = threshold * 1000 + delta;
      const result = await run(page, scenario(hp), p);
      const expected = (comparator === 'LT' ? delta < 0 : delta > 0) ? 108 : 100;
      expect(result.compiled.ok, JSON.stringify(result.compiled)).toBe(true);
      expect(result.done!.summary.sourceDamageDealt).toBe(expected);
      expect(result.done!.summary.sourceFinalHp).toBe(900);
      expect(result.released?.released).toBe(true); results.push(result);
    }
    const startHp = comparator === 'LT' ? 450 : 650;
    const restored = await run(page, scenario(startHp), p, true);
    expect(restored.done!.summary.sourceDamageDealt).toBe(comparator === 'LT' ? 100 : 108);
    expect(restored.resumed!.summary.sourceDamageDealt).toBe(comparator === 'LT' ? 108 : 100);
    const reverse = structuredClone(p); reverse.owner = 'target';
    const reversed = await run(page, scenario(threshold * 1000 + (comparator === 'LT' ? -1 : 1), 'target'), reverse);
    expect(reversed.done!.summary.targetDamageDealt).toBe(108);
    expect(reversed.done!.summary.targetFinalHp).toBe(900);
    await info.attach('formal-authoring-and-runs', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
      businessWrites: 0, snapshots, authored: p, results, restored, reversed,
      boundary: '已保存扩大过滤后的符文组成与明确普通直接物理普攻场景输入；实际共享普攻完整组成、其他伤害来源及整符文不由本用例证明' })) });
  });
}
