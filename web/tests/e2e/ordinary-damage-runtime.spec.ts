import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type { AuthoredHitProgram } from '../../src/engine/hitAdapter';
import type { AuthoredDamageModifierProgram, DamageModifierScenario } from '../../src/engine/damageModifierAdapter';
import type { OrdinaryDamageSourceAuditInput } from '../../src/engine/ordinaryDamageSourceAudit';
import type { GameVampRulesResponse } from '../../src/types/gameVamp';
import type { Skill } from '../../src/types/skill';
import type { CharacterSkillRelation } from '../../src/types/skillRelation';
import type { SkillEffect, SkillEffectDamageModifierResult } from '../../src/types/skillEffect';
import type { SkillFormula } from '../../src/types/skillFormula';
import type { SkillParameter } from '../../src/types/skillParameter';
import type { SkillTriggerRuleDetail } from '../../src/types/skillTriggerRule';

const candidate = process.env.DAMAGE_SOURCE_CANDIDATE === '1';
const catalogSha = 'e4ab45d130c6f97828ca929e3866624726ed77bf17f4093e507c16cfee467803';
const identity: AuthoredHitProgram['identity'] = {
  source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' }
};
function reader(request: APIRequestContext) {
  const snapshots: Record<string, unknown> = {};
  return {
    snapshots,
    async get<T>(route: string): Promise<T> {
      const response = await request.get(`http://127.0.0.1:8080/api/admin/games/lol${route}`, {
        headers: { Authorization: `Bearer ${process.env.DAMAGE_ADMIN_TOKEN || 'local-readonly-verification'}` }
      });
      expect(response.status(), route).toBe(200);
      const value = await response.json(); snapshots[route] = value; return value as T;
    }
  };
}
type Reader = ReturnType<typeof reader>;
async function numeric(get: Reader['get'], skillKey: string) {
  const parameters = await get<SkillParameter[]>(`/skills/${skillKey}/parameters`);
  const formulas: SkillFormula[] = [];
  for (const row of await get<Array<{ formulaKey: string }>>(`/skills/${skillKey}/formulas`)) {
    formulas.push(await get<SkillFormula>(`/skills/${skillKey}/formulas/${row.formulaKey}`));
  }
  return { parameters, formulas };
}
async function loadSource(get: Reader['get'], key: 'annie_q' | 'garen_r') {
  const skill = await get<Skill>(`/skills/${key}`);
  const owner = key === 'annie_q' ? 'champion_annie' : 'champion_garen';
  const relations = await get<{ items: CharacterSkillRelation[] }>(`/character-skill-relations?skillKey=${key}`);
  const relation = relations.items.find(row => row.characterKey === owner)!;
  expect(relation).toMatchObject({ gameId: 'lol', skillKey: key, skillStatus: 'ENABLED' });
  const rule = await get<SkillTriggerRuleDetail>(`/skills/${key}/trigger-rules/${key === 'annie_q' ? 'actual_hit' : 'on_hit'}`);
  const effect = await get<SkillEffect>(`/skills/${key}/effects/${key === 'annie_q' ? 'spell_hit' : 'justice_damage'}`);
  const values = await numeric(get, key);
  const vamp = await get<GameVampRulesResponse>('/vamp-rules');
  // 本场景明确两项吸血属性为0；陌生属性不能自动补0。
  expect(new Set(vamp.rules.map(rule => rule.sourceAttributeKey))).toEqual(new Set(['life_steal_percent', 'omnivamp_percent']));
  const authored: AuthoredHitProgram = {
    gameId: 'lol', skillKey: key, skillLevel: 1, characterLevel: 6, rules: [rule], effects: [effect],
    ...values, statuses: [], identity, skillCategoryKeys: skill.skillCategoryKeys, vampRules: vamp.rules
  };
  return { skill, relation, authored };
}
async function loadModifier(get: Reader['get'], id: 8014 | 8017) {
  const skillKey = `rune_${id}_passive`;
  await get(`/runes/rune_${id}`);
  await get(`/skills/${skillKey}`);
  const relations = await get<{ items: Array<{ runeKey: string; skillKey: string }> }>(`/rune-skill-relations?runeKey=rune_${id}`);
  expect(relations.items.some(row => row.runeKey === `rune_${id}` && row.skillKey === skillKey)).toBe(true);
  const savedEffect = await get<SkillEffect>(`/skills/${skillKey}/effects/basic_attack_health_bonus`);
  const rule = await get<SkillTriggerRuleDetail>(`/skills/${skillKey}/trigger-rules/initialize_basic_attack_bonus`);
  const values = await numeric(get, skillKey);
  const zones = await get<{ items: AuthoredDamageModifierProgram['modifierZones'] }>('/modifier-zones');
  expect(savedEffect.results).toHaveLength(1);
  expect(savedEffect.results[0]!.resultType).toBe('DAMAGE_MODIFIER');
  const effect = structuredClone(savedEffect), result = effect.results[0]! as SkillEffectDamageModifierResult;
  if (candidate) {
    // 仅候选接线验证，原GET快照保留；不是正式保存或完整符文运行证据。
    expect(result.detail).toMatchObject({ damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT' });
    result.detail.damageTypeKey = null; result.detail.deliveryKind = 'ANY';
  } else {
    expect(result.detail).toMatchObject({ damageTypeKey: null, deliveryKind: 'ANY', originKind: 'DIRECT' });
  }
  const authored: AuthoredDamageModifierProgram = {
    gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 6, effects: [effect], rules: [rule], ...values,
    modifierZones: zones.items, owner: 'source', identity: { owner: identity.source, opponent: identity.target }
  };
  return authored;
}
function scene(hp: number, characterKey: string, owner: 'source' | 'target'): DamageModifierScenario {
  const input = JSON.parse(readFileSync(resolve('../wasm/tinygo_engine_v2/internal/testkit/fixtures/generic_p0_basic_damage.json'), 'utf8')) as DamageModifierScenario;
  const request = input.compileRequest, run = input.runRequest;
  const providerKey = `champion:${characterKey}`;
  const slot = (n: number) => ({ base: n, current: n, max: n, resolved: n });
  request.typeCatalog.types = [{ key: 'combatant/champion', domain: 'combatant' }];
  request.sharedProviders = [{ providerKey, kind: 'champion', stableId: characterKey,
    abilities: [{ abilityKey: 'hit', kind: 'active', operations: [] }] }];
  for (const actor of request.combatants) {
    actor.types = ['combatant/champion'];
    actor.attributes = { hp: { ...slot(1000), current: actor.key === owner ? 900 : hp },
      ability_power: slot(100), armor: slot(100), magic_resist: slot(100),
      life_steal_percent: slot(0), omnivamp_percent: slot(0) };
    actor.providers = actor.key === owner ? [{ providerRef: providerKey, definitionRef: providerKey }] : [];
  }
  for (const actor of run.initialSnapshot.combatants) {
    actor.attributes = structuredClone(request.combatants.find(row => row.key === actor.key)!.attributes);
    actor.providers = actor.key === owner ? [{ providerRef: providerKey, definitionRef: providerKey,
      source: owner, owner, stacks: 1, expireAt: null, state: {} }] : [];
  }
  run.schemaVersion = request.schemaVersion; run.schemaHash = request.schemaHash; run.rulesHash = request.rulesHash;
  run.driverPlan.entries = [{ entryKey: 'actual_hit', abilityRef: `${owner}.provider[${providerKey}].ability[hit]`,
    source: owner, target: owner === 'source' ? 'target' : 'source', firstAtMs: 0 }];
  return input;
}

for (const key of ['annie_q', 'garen_r'] as const) for (const id of [8014, 8017] as const) {
  test(`${candidate ? '候选扩大范围' : '正式保存范围'}：${key}完整伤害组成与符文${id}来源核对后运行`, async ({ page, request }, info) => {
    test.skip(process.env.DAMAGE_SOURCE_LIVE_API !== '1', '显式开启实际GET；缺少正式资料、核定目录或保存范围时失败');
    const catalogPath = process.env.DAMAGE_SOURCE_REVIEW_CATALOG;
    expect(catalogPath, '必须提供主负责人冻结的来源目录路径').toBeTruthy();
    const bytes = readFileSync(catalogPath!);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(catalogSha);
    const catalog = JSON.parse(bytes.toString('utf8')) as OrdinaryDamageSourceAuditInput['catalog'];
    const { get, snapshots } = reader(request), source = await loadSource(get, key), modifier = await loadModifier(get, id);
    const review = catalog.reviews.find(row => row.skillKey === key)!;
    expect(review).toBeTruthy();
    const hps = id === 8014 ? [399, 400, 401] : [599, 600, 601];
    const runs = [];
    await page.route('**/ordinary-damage-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>普通伤害来源核对</title>' }));
    await page.goto('/ordinary-damage-harness');
    const variants = [...hps.map(hp => ({ hp, owner: 'source' as const })),
      { hp: id === 8014 ? 399 : 601, owner: 'target' as const }];
    for (const { hp, owner } of variants) {
      const input = scene(hp, source.relation.characterKey, owner);
      const activeModifier = structuredClone(modifier); activeModifier.owner = owner;
      const data = await page.evaluate(async ({ input, source, modifier, catalog, reviewKey, owner }) => {
        const { withHitProgram, provenSkillUseFact, skillHitFact } = await import(/* @vite-ignore */ '/src/engine/hitAdapter.ts');
        const { withAuthoredOrdinaryDamageModifiers } = await import(/* @vite-ignore */ '/src/engine/damageModifierAdapter.ts');
        const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
        const providerRef = `champion:${source.relation.characterKey}`;
        const hitBinding = { hitProviderKey: providerRef, hitAbilityKey: 'hit', authored: source.authored };
        input.compileRequest = withHitProgram(input.compileRequest, hitBinding, { rulesHash: 'rules.authored_source_preparation' });
        input.runRequest.rulesHash = input.compileRequest.rulesHash;
        input.runRequest.expectedRulesHash = input.compileRequest.rulesHash;
        input.runRequest.initialSnapshot.rulesHash = input.compileRequest.rulesHash;
        input.runRequest.skillUses = [provenSkillUseFact({ useKey: 'one_use', source: owner, skillKey: source.skill.skillKey })];
        input.runRequest.skillHitFacts = [skillHitFact('actual_hit', 'one_use', 1)];
        const sources = { gameId: 'lol', catalog,
          combatants: {
            source: { characterKey: owner === 'source' ? source.relation.characterKey : 'champion_target_scenario' },
            target: { characterKey: owner === 'target' ? source.relation.characterKey : 'champion_target_scenario' }
          },
          sources: [{ reviewKey, owner, providerRef, hitBinding, skill: source.skill, relation: source.relation }] };
        const hidden = structuredClone(input);
        hidden.compileRequest.rules.operations.push({ operation: 'damage', target: 'target',
          damageType: 'damage/true', amount: { op: 'const', value: 100 }, ref: 'unreviewed_special_source' });
        let hiddenDamageRejection: string | null = null;
        try { await withAuthoredOrdinaryDamageModifiers(hidden, [{ providerKey: 'rune:health_bonus', authored: modifier }], sources); }
        catch (error) { hiddenDamageRejection = error instanceof Error ? error.message : String(error); }
        if (!hiddenDamageRejection) throw new Error('未核定的全局真实伤害被错误放行');
        const scenario = await withAuthoredOrdinaryDamageModifiers(input, [{ providerKey: 'rune:health_bonus', authored: modifier }], sources);
        const client = new GenericEngineClient();
        try {
          const compiled = await client.compile(scenario.compileRequest);
          if (!compiled.ok) return { compiled, scenario, hiddenDamageRejection };
          scenario.runRequest.sessionId = compiled.sessionId!;
          const done = await client.run(scenario.runRequest);
          const released = await client.release(compiled.sessionId!, scenario.compileRequest.rulesHash);
          return { compiled, scenario, done, released, hiddenDamageRejection };
        } finally { client.terminate(); }
      }, { input, source, modifier: activeModifier, catalog, reviewKey: review.reviewKey, owner });
      expect(data.compiled.ok, JSON.stringify(data.compiled)).toBe(true);
      expect(data.released?.released).toBe(true);
      // 与来源公式独立的算术：安妮Q一级80+0.8×100，100魔抗减半；盖伦R一级125+25%缺失生命，真实伤害不受100双抗影响。
      const raw = key === 'annie_q' ? 160 : 125 + (1000 - hp) * 0.25;
      const multiplier = (id === 8014 ? hp < 400 : hp > 600) ? 1.08 : 1;
      const damage = raw * multiplier / (key === 'annie_q' ? 2 : 1);
      expect(data.done!.summary[owner === 'source' ? 'sourceDamageDealt' : 'targetDamageDealt']).toBeCloseTo(damage, 8);
      expect(data.done!.summary[owner === 'source' ? 'targetFinalHp' : 'sourceFinalHp']).toBeCloseTo(hp - damage, 8);
      expect(data.done!.summary[owner === 'source' ? 'sourceFinalHp' : 'targetFinalHp']).toBe(900);
      expect(data.done!.evidence.items.filter(row => row.kind === 'damage')).toHaveLength(1);
      expect(data.scenario.sourceAudit.facts).toHaveLength(1);
      expect(data.scenario.sourceAudit.facts[0]!.owner).toBe(owner);
      expect(data.hiddenDamageRejection).toContain('rules.operations');
      runs.push({ hp, owner, raw, multiplier, expectedDamage: damage, ...data });
    }
    await info.attach('source-reviewed-authoring-and-runs', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
      scope: candidate ? '真实伤害来源与未保存的符文过滤候选接线；不是正式符文扩大范围' : '已保存普通来源与符文条件组成；不是整技能或整符文完成',
      candidate, businessWrites: 0, catalogSha, snapshots, source, modifier, runs
    })) });
  });
}
