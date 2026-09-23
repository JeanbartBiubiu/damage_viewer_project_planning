import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { CompileRequest, DoneResult, DriverEntry, RunRequest } from '../../src/types/genericEngine';
import type { AuthoredHitProgram } from '../../src/engine/hitAdapter';
import { fixedValue } from '../../src/types/numericValue';
import type { SkillEffect, SkillEffectResult } from '../../src/types/skillEffect';
import type { SkillTriggerRuleDetail } from '../../src/types/skillTriggerRule';

const WASM_PATH = resolve('src/engine/wasm/tinygo_engine_v2.wasm');
const WASM_SHA256 = '620763FCE922E91E3A33F6B8A1597FF528FFCF7A53200CABECF50F548EE3415B';
const WASM_BYTES = 895683;

function slot(value: number, max = value) {
  return { base: value, current: value, max, resolved: value };
}

function lifecycle(scope: 'SOURCE' | 'SOURCE_TARGET' = 'SOURCE_TARGET', duration = 1000) {
  return {
    durationValue: fixedValue(duration), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
    instanceScope: scope, reapplicationStackMode: 'KEEP' as const, reapplicationDurationMode: 'REFRESH_ALL' as const,
    expiryMode: 'ALL_AT_ONCE' as const, periodicIntervalValue: null, firstPeriodicExecution: null
  };
}

function damageResult(scope: SkillEffectResult['spellShieldBlockScope'], amount = 100): SkillEffectResult {
  return {
    resultKey: 'damage', name: '伤害', resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 10,
    spellShieldBlockScope: scope, lifecycleBehavior: null,
    valueRule: { value: fixedValue(amount), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: {
      damageTypeKey: 'physical', deliveryKind: 'SKILL', originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: []
    }
  };
}

function stunResult(): SkillEffectResult {
  return {
    resultKey: 'stun', name: '眩晕', resultType: 'STATUS_OPERATION', target: 'TARGET', description: null, sortOrder: 20,
    spellShieldBlockScope: 'RESULT', valueRule: null, detail: { statusKey: 'stun_q', operation: 'APPLY' },
    lifecycleBehavior: { moment: 'INSTANT', valueReadMode: null, stackValueMode: null, reapplicationValueMode: null, periodicExecutionMode: null }
  };
}

function nullBuff(): SkillEffectResult {
  return {
    resultKey: 'buff', name: '加攻', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description: null, sortOrder: 30,
    spellShieldBlockScope: null,
    valueRule: { value: fixedValue(3), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
    detail: { attributeKey: 'attack_damage', operation: 'INCREASE', modifierZoneKey: null }, lifecycleBehavior: null
  };
}

function effect(effectKey: string, results: SkillEffectResult[], extra: Partial<SkillEffect> = {}): SkillEffect {
  return {
    gameId: extra.gameId ?? 'lol',
    skillKey: extra.skillKey ?? 'author_q',
    effectKey,
    name: extra.name ?? effectKey,
    description: extra.description ?? null,
    sortOrder: extra.sortOrder ?? 0,
    lifecycle: extra.lifecycle ?? null,
    results,
    createdAt: extra.createdAt ?? '',
    updatedAt: extra.updatedAt ?? ''
  };
}

function execute(ruleKey: string, effectKey: string, sortOrder: number, groups: SkillTriggerRuleDetail['conditionGroups'], skillKey = 'author_q'): SkillTriggerRuleDetail {
  return {
    ruleKey, name: ruleKey, description: null, sortOrder,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: skillKey, useKind: null } },
    conditionGroups: groups,
    actions: [{
      actionKey: `do_${effectKey}`, name: effectKey, actionType: 'EXECUTE_EFFECT', sortOrder: 10,
      targetContext: 'CURRENT_TARGET', detail: { effectKey }, runtimeInputBindings: [], resultModifiers: []
    }],
    perTargetCooldown: null, maxTriggersPerProcess: null
  };
}

function blockedZero() {
  return [{
    groupKey: 'notblocked', name: 'notblocked', sortOrder: 10,
    conditions: [{
      conditionKey: 'notblocked', conditionType: 'EVENT_VALUE_COMPARE' as const, sortOrder: 10,
      detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED' as const, comparator: 'EQ' as const, comparisonValue: fixedValue(0) }
    }]
  }];
}

function authoredHit(options: {
  damageScope?: SkillEffectResult['spellShieldBlockScope'];
  includeDamage?: boolean;
  amount?: number;
  stun?: boolean;
  nullBuff?: boolean;
  shield?: boolean;
  threshold?: number;
}): AuthoredHitProgram {
  const results: SkillEffectResult[] = [];
  if (options.includeDamage !== false) {
    results.push(damageResult(options.damageScope === undefined ? 'SKILL' : options.damageScope, options.amount ?? 100));
  }
  const extra = options.threshold !== undefined ? [{
    groupKey: 'half', name: 'half', sortOrder: 10,
    conditions: [{
      conditionKey: 'half', conditionType: 'EVENT_VALUE_COMPARE' as const, sortOrder: 10,
      detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED' as const, comparator: 'LTE' as const, comparisonValue: fixedValue(options.threshold) }
    }]
  }] : (options.damageScope || options.stun ? blockedZero() : []);
  const effects: SkillEffect[] = [];
  const rules: SkillTriggerRuleDetail[] = [];
  if (results.length) {
    effects.push(effect('primary_hit', results));
    rules.push(execute('actual_hit', 'primary_hit', 10, extra));
  }
  if (options.nullBuff) {
    effects.push(effect('self_buff', [nullBuff()]));
    rules.push(execute('apply_buff', 'self_buff', 40, []));
  }
  if (options.stun) {
    effects.push(effect('control', [stunResult()], { lifecycle: lifecycle() }));
    rules.push(execute('apply_stun', 'control', 20, blockedZero()));
  }
  if (options.shield) {
    effects.push(effect('spell_shield', [{
      resultKey: 'shield', name: '盾', resultType: 'SPELL_SHIELD', target: 'SOURCE', description: null, sortOrder: 10,
      spellShieldBlockScope: null, valueRule: null, detail: {},
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: null, stackValueMode: null, reapplicationValueMode: null, periodicExecutionMode: null }
    }], { lifecycle: lifecycle('SOURCE', 5000) }));
    effects.push(effect('block_heal', [
      {
        resultKey: 'heal', name: '治疗', resultType: 'DIRECT_HEAL', target: 'SOURCE', description: null, sortOrder: 10,
        spellShieldBlockScope: null, detail: {}, lifecycleBehavior: null,
        valueRule: { value: fixedValue(40), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }
      },
      {
        resultKey: 'remove_spell_shield', name: '移除', resultType: 'LIFECYCLE_OPERATION', target: 'SOURCE',
        description: null, sortOrder: 20, spellShieldBlockScope: null, valueRule: null,
        detail: { operation: 'REMOVE', targetEffectKey: 'spell_shield' }, lifecycleBehavior: null
      }
    ]));
    rules.push({
      ruleKey: 'successful_spell_block', name: '格挡', description: null, sortOrder: 20,
      eventSource: { eventType: 'SPELL_SHIELD_BLOCKED', detail: { shieldEffectKey: 'spell_shield' } },
      conditionGroups: [],
      actions: [{
        actionKey: 'consume', name: 'consume', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
        targetContext: 'CURRENT_TARGET', detail: { effectKey: 'block_heal' }, runtimeInputBindings: [], resultModifiers: []
      }],
      perTargetCooldown: null, maxTriggersPerProcess: null
    });
  }
  return {
    gameId: 'lol', skillKey: 'author_q', skillLevel: 1, characterLevel: 1,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
    statuses: [{ statusKey: 'stun_q', statusKind: 'STUN', status: 'ENABLED' }],
    modifierZones: [], effects, rules,
    skillCategoryKeys: ['common'],
    vampRules: [{ vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1, deliveryKinds: ['SKILL'], originKinds: ['DIRECT'], skillCategoryKeys: ['common'] }]
  };
}

function baseRequest(grantShield = false): CompileRequest {
  const abilities: NonNullable<CompileRequest['sharedProviders']>[number]['abilities'] = [
    { abilityKey: 'skill_hit', kind: 'active', operations: [] }
  ];
  if (grantShield) {
    abilities.push({
      abilityKey: 'grant', kind: 'active',
      operations: [{ operation: 'apply_provider', target: 'self', providerDefinitionRef: 'shield:author_q:spell_shield' }]
    });
  }
  return {
    schemaVersion: 'generic-p0', schemaHash: 'schema.p5.browser', rulesHash: 'before-p5',
    typeCatalog: { types: [{ key: 'damage/physical', domain: 'damage' }], relations: [] }, rules: {},
    combatants: [
      {
        key: 'source',
        attributes: { hp: slot(1000, 2000), attack_damage: slot(100, 200), armor: slot(0), omnivamp_percent: slot(0, 1) },
        resources: {}, providers: [{ providerRef: 'champion', definitionRef: 'champion' }]
      },
      {
        key: 'target',
        attributes: { hp: slot(1000, 2000), attack_damage: slot(100, 200), armor: slot(0), omnivamp_percent: slot(0, 1) },
        resources: {}, providers: grantShield ? [{ providerRef: 'champion', definitionRef: 'champion' }] : []
      }
    ],
    sharedProviders: [{ providerKey: 'champion', stableId: 'champion', kind: 'champion', abilities }]
  };
}

function abilityRef(abilityKey: string, owner: 'source' | 'target' = 'source'): string {
  return `${owner}.provider[champion].ability[${abilityKey}]`;
}

type HitRunInput = {
  authored: AuthoredHitProgram;
  entries: DriverEntry[];
  uses: RunRequest['skillUses'];
  facts: RunRequest['skillHitFacts'];
  durationMs: number;
  grantShield?: boolean;
  restoreShield?: boolean;
  repeatRun?: boolean;
  input?: CompileRequest;
};

async function runHit(page: Page, data: HitRunInput) {
  await page.route('**/p5-browser-harness', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>第5项运行验证</title>'
  }));
  await page.goto('/p5-browser-harness');
  return page.evaluate(async (payload) => {
    const { withHitProgram, provenSkillUseFact, unknownSkillUseFact, skillHitFact } = await import(/* @vite-ignore */ '/src/engine/hitAdapter.ts');
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const client = new GenericEngineClient();
    try {
      const request = withHitProgram(payload.input, {
        hitProviderKey: 'champion', hitAbilityKey: 'skill_hit', authored: payload.authored
      }, { rulesHash: 'with-p5' });
      const compiled = await client.compile(request);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
      const runOnce = async () => client.run({
        sessionId: compiled.sessionId, expectedRulesHash: 'with-p5', schemaVersion: request.schemaVersion,
        schemaHash: request.schemaHash, rulesHash: 'with-p5',
        initialSnapshot: {
          schemaHash: request.schemaHash, rulesHash: 'with-p5', timeMs: 0,
          combatants: request.combatants.map((actor) => ({
            key: actor.key, attributes: structuredClone(actor.attributes), resources: {}, cooldowns: {},
            providers: [
              ...actor.providers.map((provider) => ({
                providerRef: provider.providerRef, definitionRef: provider.definitionRef,
                source: actor.key, owner: actor.key, stacks: 1, expireAt: null as number | null, state: {}
              })),
              ...(payload.restoreShield && actor.key === 'target' ? [{
                providerRef: 'shield:author_q:spell_shield#restored', definitionRef: 'shield:author_q:spell_shield',
                source: 'target' as const, owner: 'target' as const, stacks: 1, expireAt: 5000, state: {}
              }] : [])
            ],
            shields: [], abilityState: {}, providerState: {}, vars: {}, effectiveStatuses: []
          }))
        },
        driverPlan: { entries: payload.entries, conditionRecheckIntervalMs: 100 },
        stopPolicy: { durationMs: payload.durationMs, stopOnTargetDeath: false, stopWhenNoEvents: false },
        sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 100 },
        skillUses: payload.uses, skillHitFacts: payload.facts
      });
      const done = await runOnce();
      const second = payload.repeatRun ? await runOnce() : null;
      const released = await client.release(compiled.sessionId, 'with-p5');
      return { done, second, released, helpers: { provenSkillUseFact, unknownSkillUseFact, skillHitFact } };
    } finally {
      client.terminate();
    }
  }, { input: data.input ?? baseRequest(data.grantShield), ...data });
}

function hits(done: DoneResult) {
  return done.evidence.items.filter((item) => item.kind === 'skill_hit');
}

function targetOf(done: DoneResult) {
  return done.finalSnapshot.combatants.find((row) => row.key === 'target')!;
}

function sourceOf(done: DoneResult) {
  return done.finalSnapshot.combatants.find((row) => row.key === 'source')!;
}

const useU1 = [{ useKey: 'u1', source: 'source', skillKey: 'author_q', historyState: 'complete' as const }];
const hitH1 = [{ driverEntryKey: 'h1', useRef: 'u1', sequence: null }];

test('正式 Wasm 产物身份', () => {
  const bytes = readFileSync(WASM_PATH);
  expect(bytes.length).toBe(WASM_BYTES);
  expect(createHash('sha256').update(bytes).digest('hex').toUpperCase()).toBe(WASM_SHA256);
});

test('实际 Worker：无盾时伤害与控制都生效，明确零吸血仍经过共性规则', async ({ page }) => {
  const result = await runHit(page, {
    authored: authoredHit({ damageScope: 'SKILL', stun: true }),
    entries: [{ entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 0 }],
    uses: useU1, facts: hitH1, durationMs: 200
  });
  expect(result.released.released).toBe(true);
  expect(targetOf(result.done).attributes.hp.current).toBe(900);
  expect(targetOf(result.done).providers.some((row) => row.definitionRef.startsWith('status:author_q:control:stun'))).toBe(true);
  expect(hits(result.done)[0]?.data?.blocked).toBe(0);
  expect(result.done.evidence.items.find((item) => item.kind === 'vamp')?.data?.actualHealing).toBe(0);
});

test('实际 Worker：命中伤害继承游戏吸血，规则及能力分类实际参与计算', async ({ page }) => {
  const input = baseRequest();
  input.combatants[0]!.attributes.omnivamp_percent = slot(0.2, 1);
  const result = await runHit(page, {
    input, authored: authoredHit({}),
    entries: [{ entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 0 }],
    uses: useU1, facts: hitH1, durationMs: 100
  });
  expect(targetOf(result.done).attributes.hp.current).toBe(900);
  expect(sourceOf(result.done).attributes.hp.current).toBe(1020);
  expect(result.done.evidence.items.find((item) => item.kind === 'vamp')?.data?.actualHealing).toBe(20);
});

test('实际 Worker：有盾时伤害与控制同挡，显式消费正确实例并治疗 owner', async ({ page }) => {
  const result = await runHit(page, {
    authored: authoredHit({ damageScope: 'SKILL', stun: true, shield: true }),
    entries: [
      { entryKey: 'grant', abilityRef: abilityRef('grant', 'target'), source: 'target', target: 'target', firstAtMs: 0 },
      { entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 10 }
    ],
    uses: useU1, facts: hitH1, durationMs: 100, grantShield: true
  });
  expect(result.released.released).toBe(true);
  expect(hits(result.done)[0]?.data?.blocked).toBe(1);
  expect(targetOf(result.done).attributes.hp.current).toBe(1040);
  expect(targetOf(result.done).providers.some((row) => row.definitionRef.startsWith('status:author_q:control:stun'))).toBe(false);
  expect(targetOf(result.done).providers.some((row) => row.definitionRef === 'shield:author_q:spell_shield')).toBe(false);
  expect(result.done.evidence.items.some((item) => item.kind === 'heal' && item.data?.actualHealing === 40)).toBe(true);
  expect(result.done.evidence.items.some((item) => item.kind === 'skill_hit_skip')).toBe(true);
});

test('实际 Worker：null 仍执行，只有 null 不消盾', async ({ page }) => {
  const onlyNull = await runHit(page, {
    authored: authoredHit({ includeDamage: false, nullBuff: true, shield: true }),
    entries: [
      { entryKey: 'grant', abilityRef: abilityRef('grant', 'target'), source: 'target', target: 'target', firstAtMs: 0 },
      { entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 10 }
    ],
    uses: useU1, facts: hitH1, durationMs: 100, grantShield: true
  });
  expect(hits(onlyNull.done)[0]?.data?.blocked).toBe(0);
  expect(sourceOf(onlyNull.done).attributes.attack_damage.base).toBe(103);
  expect(targetOf(onlyNull.done).providers.some((row) => row.definitionRef === 'shield:author_q:spell_shield' || row.providerRef.includes('spell_shield'))).toBe(true);

  const withDamage = await runHit(page, {
    authored: authoredHit({ damageScope: 'SKILL', nullBuff: true, shield: true }),
    entries: [
      { entryKey: 'grant', abilityRef: abilityRef('grant', 'target'), source: 'target', target: 'target', firstAtMs: 0 },
      { entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 10 }
    ],
    uses: useU1, facts: hitH1, durationMs: 80, grantShield: true
  });
  expect(sourceOf(withDamage.done).attributes.attack_damage.base).toBe(103);
  expect(withDamage.done.evidence.items.some((item) => item.kind === 'skill_hit_skip')).toBe(true);
});

test('实际 Worker：EFFECT/RESULT/DAMAGE_INSTANCE 不连带下一次发生', async ({ page }) => {
  for (const scope of ['EFFECT', 'RESULT', 'DAMAGE_INSTANCE'] as const) {
    const result = await runHit(page, {
      authored: authoredHit({ damageScope: scope, shield: true }),
      entries: [
        { entryKey: 'grant', abilityRef: abilityRef('grant', 'target'), source: 'target', target: 'target', firstAtMs: 0 },
        { entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 10 },
        { entryKey: 'h2', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 20 }
      ],
      uses: useU1,
      facts: [{ driverEntryKey: 'h1', useRef: 'u1', sequence: null }, { driverEntryKey: 'h2', useRef: 'u1', sequence: null }],
      durationMs: 80, grantShield: true
    });
    expect(hits(result.done)[0]?.data?.blocked, scope).toBe(1);
    expect(hits(result.done)[1]?.data?.blocked, scope).toBe(0);
  }
});

test('实际 Worker：SKILL 旧使用复用、新使用独立', async ({ page }) => {
  const result = await runHit(page, {
    authored: authoredHit({ damageScope: 'SKILL', shield: true }),
    entries: [
      { entryKey: 'grant', abilityRef: abilityRef('grant', 'target'), source: 'target', target: 'target', firstAtMs: 0 },
      { entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 10 },
      { entryKey: 'h2', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 20 },
      { entryKey: 'h3', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 30 }
    ],
    uses: [
      { useKey: 'u1', source: 'source', skillKey: 'author_q', historyState: 'complete' },
      { useKey: 'u2', source: 'source', skillKey: 'author_q', historyState: 'complete' }
    ],
    facts: [
      { driverEntryKey: 'h1', useRef: 'u1', sequence: null },
      { driverEntryKey: 'h2', useRef: 'u1', sequence: null },
      { driverEntryKey: 'h3', useRef: 'u2', sequence: null }
    ],
    durationMs: 80, grantShield: true
  });
  expect(hits(result.done)[0]?.data?.blocked).toBe(1);
  expect(hits(result.done)[1]?.data?.blocked).toBe(1);
  expect(hits(result.done)[1]?.data?.reused).toBe(true);
  expect(hits(result.done)[2]?.data?.blocked).toBe(0);
});

test('实际 Worker：首次/历史/零伤挡/同刻未知与已证明非首次0', async ({ page }) => {
  const first = await runHit(page, {
    authored: authoredHit({ amount: 100 }),
    entries: [
      { entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 0 },
      { entryKey: 'h2', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 100 }
    ],
    uses: useU1,
    facts: [{ driverEntryKey: 'h1', useRef: 'u1', sequence: null }, { driverEntryKey: 'h2', useRef: 'u1', sequence: null }],
    durationMs: 200
  });
  expect(hits(first.done)[0]?.data?.firstContact).toBe(1);
  expect(hits(first.done)[1]?.data?.firstContact).toBe(0);

  const history = await runHit(page, {
    authored: authoredHit({ amount: 0 }),
    entries: [
      { entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 0, priority: 1 },
      { entryKey: 'h2', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 0, priority: 0 }
    ],
    uses: [{ useKey: 'u1', source: 'source', skillKey: 'author_q', historyState: 'complete', priorQualifiedContacts: ['target'] }],
    facts: [{ driverEntryKey: 'h1', useRef: 'u1', sequence: null }, { driverEntryKey: 'h2', useRef: 'u1', sequence: null }],
    durationMs: 50
  });
  expect(hits(history.done).every((item) => item.data?.firstContact === 0)).toBe(true);

  const unknownTick = await runHit(page, {
    authored: authoredHit({}),
    entries: [
      { entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 0, priority: 1 },
      { entryKey: 'h2', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 0, priority: 0 }
    ],
    uses: useU1,
    facts: [{ driverEntryKey: 'h1', useRef: 'u1', sequence: null }, { driverEntryKey: 'h2', useRef: 'u1', sequence: null }],
    durationMs: 50
  });
  expect(hits(unknownTick.done).every((item) => !('firstContact' in (item.data ?? {})))).toBe(true);

  const unknownHistory = await runHit(page, {
    authored: authoredHit({}),
    entries: [{ entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 0 }],
    uses: [{ useKey: 'u1', source: 'source', skillKey: 'author_q', historyState: 'unknown', priorQualifiedContacts: ['target'] }],
    facts: hitH1, durationMs: 50
  });
  expect(hits(unknownHistory.done)[0]?.data?.firstContact).toBeUndefined();
});

test('实际 Worker：阈值小数、缺事实错误、同会话重跑不泄漏、恢复实例被消费', async ({ page }) => {
  const half = await runHit(page, {
    authored: authoredHit({ threshold: 0.5 }),
    entries: [{ entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 0 }],
    uses: useU1, facts: hitH1, durationMs: 50
  });
  expect(targetOf(half.done).attributes.hp.current).toBe(900);

  await page.route('**/p5-browser-harness', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>第5项运行验证</title>'
  }));
  await page.goto('/p5-browser-harness');
  const missing = await page.evaluate(async (data) => {
    const { withHitProgram } = await import(/* @vite-ignore */ '/src/engine/hitAdapter.ts');
    const { GenericEngineClient, GenericEngineClientError } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const client = new GenericEngineClient();
    try {
      const request = withHitProgram(data.request, { hitProviderKey: 'champion', hitAbilityKey: 'skill_hit', authored: data.authored }, { rulesHash: 'with-p5' });
      const compiled = await client.compile(request);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
      try {
        await client.run({
          sessionId: compiled.sessionId, expectedRulesHash: 'with-p5', schemaVersion: request.schemaVersion,
          schemaHash: request.schemaHash, rulesHash: 'with-p5',
          initialSnapshot: {
            schemaHash: request.schemaHash, rulesHash: 'with-p5', timeMs: 0,
            combatants: request.combatants.map((actor) => ({
              key: actor.key, attributes: structuredClone(actor.attributes), resources: {}, cooldowns: {},
              providers: actor.providers.map((provider) => ({
                providerRef: provider.providerRef, definitionRef: provider.definitionRef,
                source: actor.key, owner: actor.key, stacks: 1, expireAt: null, state: {}
              })),
              shields: [], abilityState: {}, providerState: {}, vars: {}
            }))
          },
          driverPlan: { entries: [{ entryKey: 'h1', abilityRef: 'source.provider[champion].ability[skill_hit]', source: 'source', target: 'target', firstAtMs: 0 }], conditionRecheckIntervalMs: 100 },
          stopPolicy: { durationMs: 50, stopOnTargetDeath: false, stopWhenNoEvents: false },
          sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 100 }
        });
        return { failed: false };
      } catch (error) {
        return { failed: true, message: error instanceof GenericEngineClientError ? `${error.engineError?.path ?? ''} ${error.message}` : String(error) };
      }
    } finally {
      client.terminate();
    }
  }, { request: baseRequest(), authored: authoredHit({ damageScope: null }) });
  expect(missing.failed).toBe(true);
  expect(missing.message?.toLowerCase()).toMatch(/fact|skillhitfacts/);

  const repeat = await runHit(page, {
    authored: authoredHit({}),
    entries: [{ entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 0 }],
    uses: useU1, facts: hitH1, durationMs: 50, repeatRun: true
  });
  expect(hits(repeat.done)[0]?.data?.firstContact).toBe(1);
  expect(hits(repeat.second!)[0]?.data?.firstContact).toBe(1);

  const restored = await runHit(page, {
    authored: authoredHit({ damageScope: 'RESULT', shield: true }),
    entries: [{ entryKey: 'h1', abilityRef: abilityRef('skill_hit'), source: 'source', target: 'target', firstAtMs: 0 }],
    uses: useU1, facts: hitH1, durationMs: 50, restoreShield: true
  });
  expect(targetOf(restored.done).attributes.hp.current).toBe(1040);
  expect(targetOf(restored.done).providers.some((row) => row.providerRef === 'shield:author_q:spell_shield#restored')).toBe(false);
});

test('真实 API GET→adapter→Worker 或明确错误，404 不算通过', async ({ page, request }, testInfo) => {
  test.skip(process.env.P5_LIVE_API !== '1', '显式启用后只读本地实际服务');
  const api = 'http://127.0.0.1:8080/api/admin/games/lol';
  const headers = { Authorization: `Bearer ${process.env.DAMAGE_ADMIN_TOKEN || 'test'}` };
  const read = async (path: string) => {
    const response = await request.get(api + path, { headers });
    expect(response.status(), path).toBe(200);
    return response.json();
  };
  const [damage, slow, parameters, formulas, formula, hitRule, slowRule, status, shield, heal, consume, shieldParams, healFormula] = await Promise.all([
    read('/skills/urgot_q/effects/primary_hit'),
    read('/skills/urgot_q/effects/corrosive_charge_slow'),
    read('/skills/urgot_q/parameters'),
    read('/skills/urgot_q/formulas'),
    read('/skills/urgot_q/formulas/physical_damage'),
    read('/skills/urgot_q/trigger-rules/actual_hit'),
    read('/skills/urgot_q/trigger-rules/apply_slow_on_unblocked_hit'),
    read('/statuses/movement_slow'),
    read('/skills/sivir_e/effects/spell_shield'),
    read('/skills/sivir_e/effects/block_heal'),
    read('/skills/sivir_e/trigger-rules/successful_spell_block'),
    read('/skills/sivir_e/parameters'),
    read('/skills/sivir_e/formulas/block_heal')
  ]);
  expect(damage.results[0].spellShieldBlockScope).toBe('SKILL');
  expect(damage.results[0].detail.vampQualification).toBe('UNRESOLVED');
  expect(slow.results[0].spellShieldBlockScope).toBe('RESULT');
  expect(slowRule.conditionGroups[0].conditions.some((row: { conditionKey: string }) => row.conditionKey === 'not_spell_shield_blocked')).toBe(true);
  expect(consume.eventSource.detail.shieldEffectKey).toBe('spell_shield');

  await page.route('**/p5-live-read-harness', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>真实配置命中适配</title>'
  }));
  await page.goto('/p5-live-read-harness');
  const live = await page.evaluate(async (data) => {
    const { adaptHitProgram, withHitProgram } = await import(/* @vite-ignore */ '/src/engine/hitAdapter.ts');
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const urgot = {
      gameId: 'lol', skillKey: 'urgot_q', skillLevel: 1, characterLevel: 1,
      identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
      statuses: [data.status], modifierZones: [], parameters: data.parameters,
      formulas: [data.formula], effects: [data.damage, data.slow], rules: [data.hitRule, data.slowRule],
      skillCategoryKeys: ['common'],
      vampRules: [{
        vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE',
        defaultEfficiency: 1, deliveryKinds: ['SKILL'], originKinds: ['DIRECT'], skillCategoryKeys: ['common']
      }]
    };
    let urgotVampError: string | null = null;
    try { adaptHitProgram(urgot); } catch (error) { urgotVampError = String(error); }
    let withoutRulesError: string | null = null;
    try { adaptHitProgram({ ...urgot, vampRules: undefined }); } catch (error) { withoutRulesError = String(error); }
    const slowOnly = { ...urgot, effects: [data.slow], rules: [data.slowRule], vampRules: undefined }; 
    const adapted = adaptHitProgram(slowOnly);
    const sivirAuthored = {
      gameId: 'lol', skillKey: 'sivir_e', skillLevel: 1, characterLevel: 1,
      identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
      statuses: [], modifierZones: [], parameters: data.shieldParams, formulas: [data.healFormula],
      effects: [data.shield, data.heal], rules: [data.consume]
    };
    const sivir = adaptHitProgram(sivirAuthored);
    const client = new GenericEngineClient();
    try {
      let request = withHitProgram({
        schemaVersion: 'generic-p0', schemaHash: 'schema.p5.live', rulesHash: 'before-live',
        typeCatalog: { types: [{ key: `damage/${data.damage.results[0].detail.damageTypeKey}`, domain: 'damage' }], relations: [] },
        rules: {},
        combatants: [
          { key: 'source', attributes: { hp: { base: 1000, current: 1000, max: 2000, resolved: 1000 }, attack_damage: { base: 100, current: 100, max: 200, resolved: 100 } }, resources: {}, providers: [{ providerRef: 'champion', definitionRef: 'champion' }] },
          { key: 'target', attributes: { hp: { base: 1000, current: 1000, max: 2000, resolved: 1000 }, attack_damage: { base: 100, current: 100, max: 200, resolved: 100 } }, resources: {}, providers: [] }
        ],
        sharedProviders: [{ providerKey: 'champion', stableId: 'champion', kind: 'champion', abilities: [{ abilityKey: 'skill_hit', kind: 'active', operations: [] }] }]
      }, { hitProviderKey: 'champion', hitAbilityKey: 'skill_hit', authored: slowOnly }, { rulesHash: 'with-p5-live' });
      const compiled = await client.compile(request);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
      const done = await client.run({
        sessionId: compiled.sessionId, expectedRulesHash: 'with-p5-live', schemaVersion: request.schemaVersion,
        schemaHash: request.schemaHash, rulesHash: 'with-p5-live',
        initialSnapshot: {
          schemaHash: request.schemaHash, rulesHash: 'with-p5-live', timeMs: 0,
          combatants: request.combatants.map((actor) => ({
            key: actor.key, attributes: structuredClone(actor.attributes), resources: {}, cooldowns: {},
            providers: actor.providers.map((provider) => ({
              providerRef: provider.providerRef, definitionRef: provider.definitionRef,
              source: actor.key, owner: actor.key, stacks: 1, expireAt: null, state: {}
            })),
            shields: [], abilityState: {}, providerState: {}, vars: {}
          }))
        },
        driverPlan: { entries: [{ entryKey: 'h1', abilityRef: 'source.provider[champion].ability[skill_hit]', source: 'source', target: 'target', firstAtMs: 0 }], conditionRecheckIntervalMs: 100 },
        stopPolicy: { durationMs: 200, stopOnTargetDeath: false, stopWhenNoEvents: false },
        sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 100 },
        skillUses: [{ useKey: 'u1', source: 'source', skillKey: 'urgot_q', historyState: 'complete' }],
        skillHitFacts: [{ driverEntryKey: 'h1', useRef: 'u1', sequence: null }]
      });
      await client.release(compiled.sessionId, 'with-p5-live');
      for (const actor of request.combatants) {
        actor.attributes.attack_damage = { base: actor.key === 'target' ? 200 : 100, current: actor.key === 'target' ? 200 : 100, max: 300, resolved: actor.key === 'target' ? 200 : 100 };
        actor.attributes.ability_power = { base: actor.key === 'target' ? 100 : 0, current: actor.key === 'target' ? 100 : 0, max: 300, resolved: actor.key === 'target' ? 100 : 0 };
      }
      request = withHitProgram(request, { hitProviderKey: 'champion', hitAbilityKey: 'skill_hit', authored: sivirAuthored }, { rulesHash: 'with-live-shield' });
      const shieldSession = await client.compile(request);
      if (!shieldSession.ok) throw new Error(JSON.stringify(shieldSession.errors));
      const blockedRun = await client.run({
        sessionId: shieldSession.sessionId, expectedRulesHash: request.rulesHash, schemaVersion: request.schemaVersion,
        schemaHash: request.schemaHash, rulesHash: request.rulesHash,
        initialSnapshot: {
          schemaHash: request.schemaHash, rulesHash: request.rulesHash, timeMs: 0,
          combatants: request.combatants.map((actor) => ({
            key: actor.key, attributes: actor.attributes, resources: {}, cooldowns: {},
            providers: [
              ...actor.providers.map((provider) => ({ providerRef: provider.providerRef, definitionRef: provider.definitionRef, source: actor.key, owner: actor.key, stacks: 1, expireAt: null, state: {} })),
              ...(actor.key === 'target' ? [{ providerRef: 'real-sivir-shield', definitionRef: sivir.providers[0].providerKey, source: 'target', owner: 'target', stacks: 1, expireAt: 1500, state: {} }] : [])
            ], shields: [], abilityState: {}, providerState: {}, vars: {}
          }))
        },
        driverPlan: { entries: [{ entryKey: 'h1', abilityRef: 'source.provider[champion].ability[skill_hit]', source: 'source', target: 'target', firstAtMs: 0 }], conditionRecheckIntervalMs: 100 },
        stopPolicy: { durationMs: 200, stopOnTargetDeath: false, stopWhenNoEvents: false },
        sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 100 },
        skillUses: [{ useKey: 'u1', source: 'source', skillKey: 'urgot_q', historyState: 'complete' }],
        skillHitFacts: [{ driverEntryKey: 'h1', useRef: 'u1', sequence: null }]
      });
      const target = blockedRun.finalSnapshot.combatants.find((row) => row.key === 'target');
      const source = blockedRun.finalSnapshot.combatants.find((row) => row.key === 'source');
      await client.release(shieldSession.sessionId, request.rulesHash);

      return {
        urgotVampError, withoutRulesError,
        shieldTargetHp: target.attributes.hp.current, shieldSourceHp: source.attributes.hp.current,
        shieldRemains: target.providers.some((row) => row.providerRef === 'real-sivir-shield'),
        shieldSlowStrength: target.effectiveStatuses?.[0]?.strength ?? 0,
        shieldBlocked: blockedRun.evidence.items.find((row) => row.kind === 'skill_hit')?.data?.blocked,
        damageQualification: data.damage.results[0].detail.vampQualification,
        slowScope: adapted.skillHit.candidates.find((row) => row.resultKey === 'slow')?.spellShieldBlockScope,
        sivirOps: sivir.providers[0]?.listeners?.[0]?.operations?.map((item) => item.operation),
        sivirDuration: sivir.providers[0]?.lifecycle?.durationMs,
        targetHp: done.finalSnapshot.combatants.find((row) => row.key === 'target')?.attributes.hp.current,
        slowStrength: done.finalSnapshot.combatants.find((row) => row.key === 'target')?.effectiveStatuses?.[0]?.strength,
        blocked: done.evidence.items.find((item) => item.kind === 'skill_hit')?.data?.blocked
      };
    } finally {
      client.terminate();
    }
  }, { damage, slow, parameters, formulas, formula, hitRule, slowRule, status, shield, heal, consume, shieldParams, healFormula });
  expect(live.urgotVampError).toContain('尚未核定');
  expect(damage.results[0].detail.vampQualification).toBe('UNRESOLVED');
  expect(live.withoutRulesError).toContain('尚未核定');
  expect(live.slowScope).toBe('RESULT');
  expect(live.sivirOps).toEqual(['heal', 'expire_provider']);
  expect(live.sivirDuration).toEqual({ op: 'const', value: 1500 });
  expect(live.blocked).toBe(0);
  expect(live.targetHp).toBe(1000);
  expect(live.slowStrength).toBeCloseTo(0.45, 6);
  expect(live.shieldBlocked).toBe(1);
  expect(live.shieldRemains).toBe(false);
  expect(live.shieldSlowStrength).toBe(0);
  expect(live.shieldSourceHp).toBe(1000);
  expect(live.shieldTargetHp).toBe(1170); // 实际等级1参数：200 AD × 0.6 + 100 AP × 0.5。
  await testInfo.attach('真实GET适配运行', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    live, notes: '真实伤害在有无游戏规则时均明确拒绝未核定资格；Worker 仅运行所选真实减速规则，未执行伤害，不表示整技能完成'
  }, null, 2)) });
});
