import { test, expect, type Page } from '@playwright/test';
import type { CompileRequest, RunRequest } from '../../src/types/genericEngine';
import type { GameVampRule } from '../../src/types/gameVamp';
import type { AuthoredVampDamage } from '../../src/engine/vampAdapter';

// 明确构造代表输入；验证真实浏览器 Worker/最终 Wasm，不代表完整英雄数据装配。
function sample(kind: 'attack' | 'skill' | 'disabled' | 'override' = 'attack') {
  const slot = (value: number, max = value) => ({ base: value, current: value, max, resolved: value });
  const input: CompileRequest = {
    schemaVersion: 'generic-p0', schemaHash: 'schema.vamp.browser', rulesHash: 'before-vamp',
    typeCatalog: { types: [{ key: 'damage/physical', domain: 'damage' }], relations: [] }, rules: {},
    combatants: [
      { key: 'source', attributes: { hp: slot(kind === 'attack' ? 95 : 50, 100), life_steal_percent: slot(0.1), omnivamp_percent: slot(0.2),
        heal_shield_power_percent: slot(9) }, resources: {}, providers: [{ providerRef: 'champion', definitionRef: 'sample' }] },
      { key: 'target', attributes: { hp: slot(20, 100), armor: slot(100), life_steal_percent: slot(0), omnivamp_percent: slot(0) },
        resources: {}, providers: [] }
    ],
    sharedProviders: [{ providerKey: 'sample', stableId: 'sample', kind: 'champion', abilities: [{
      abilityKey: 'hit', kind: 'active', operations: [{ operation: 'damage', target: 'target', damageType: 'damage/physical',
        amount: { op: 'const', value: 100 }, ref: 'damage-result' }]
    }], modifiers: [
      { modifierKey: 'done', kind: 'pipeline', command: 'heal', healDirection: 'DONE', healCategory: 'ANY',
        healGroupKey: 'general', valuePolicy: 'add_percent', value: { op: 'const', value: 0.2 } },
      { modifierKey: 'received', kind: 'pipeline', command: 'heal', healDirection: 'RECEIVED', healCategory: 'VAMP',
        healGroupKey: 'general', valuePolicy: 'add_percent', value: { op: 'const', value: -0.4 } },
      { modifierKey: 'direct-only', kind: 'pipeline', command: 'heal', healDirection: 'DONE', healCategory: 'DIRECT',
        healGroupKey: 'general', valuePolicy: 'add_percent', value: { op: 'const', value: 9 } }
    ] }]
  };
  const rules: GameVampRule[] = [
    { vampType: 'LIFE_STEAL', sourceAttributeKey: 'life_steal_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE',
      defaultEfficiency: 1, deliveryKinds: ['BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['basic_attack'] },
    { vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE',
      defaultEfficiency: 1, deliveryKinds: ['SKILL', 'BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['common', 'basic_attack'] }
  ];
  const damage: AuthoredVampDamage = {
    gameId: 'lol', skillKey: kind === 'skill' ? 'ordinary_q' : 'shared_basic_attack',
    skillCategoryKeys: [kind === 'skill' ? 'common' : 'basic_attack'], skillLevel: 1, characterLevel: 1,
    detail: { damageTypeKey: 'physical', deliveryKind: kind === 'skill' ? 'SKILL' : 'BASIC_ATTACK', originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: [] }
  };
  if (kind === 'disabled') damage.detail.vampOverrides = rules.map(rule => ({ vampType: rule.vampType, mode: 'DISABLED', basisOutputKind: null, efficiencyValue: null }));
  if (kind === 'override') {
    damage.detail.vampOverrides = [{ vampType: 'OMNIVAMP', mode: 'OVERRIDE', basisOutputKind: 'ACTUAL_HP_LOSS', efficiencyValue: { kind: 'PARAMETER', parameterKey: 'efficiency' } }];
    damage.parameters = [{ gameId: 'lol', skillKey: damage.skillKey, parameterKey: 'efficiency', name: '效率',
      valueMode: 'FIXED', valueType: 'DECIMAL', fixedValue: 0.5, levelValues: null, description: null,
      sortOrder: 0, createdAt: '', updatedAt: '' }];
  }
  const run: RunRequest = {
    sessionId: '', expectedRulesHash: 'with-vamp', schemaVersion: input.schemaVersion, schemaHash: input.schemaHash, rulesHash: 'with-vamp',
    initialSnapshot: { schemaHash: input.schemaHash, rulesHash: 'with-vamp', timeMs: 0, combatants: input.combatants.map(actor => ({
      key: actor.key, attributes: structuredClone(actor.attributes), resources: {}, cooldowns: {},
      providers: actor.providers.map(provider => ({ ...provider, source: actor.key, owner: actor.key, stacks: 1, expireAt: null, state: {} })),
      shields: actor.key === 'target' ? [{ shieldRef: 'sample_shield', source: 'target', owner: 'target', remaining: 20, priority: 0, expireAt: null, state: {} }] : [],
      abilityState: {}, providerState: {}, vars: {}
    })) },
    driverPlan: { entries: [{ entryKey: 'one-hit', abilityRef: 'source.provider[champion].ability[hit]', source: 'source', target: 'target', firstAtMs: 0 }], conditionRecheckIntervalMs: 100 },
    stopPolicy: { durationMs: 100, stopOnTargetDeath: false, stopWhenNoEvents: false },
    sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 100 }
  };
  return { input, rules, damage, run };
}

async function runSample(page: Page, payload: ReturnType<typeof sample>) {
  await page.route('**/vamp-browser-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>吸血运行验证</title>' }));
  await page.goto('/vamp-browser-harness');
  return page.evaluate(async data => {
    // 通过 Vite 加载真实宿主模块；未替换 Worker 或 Wasm。
    const adapterPath = '/src/engine/vampAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const { withVampConfiguration } = await import(/* @vite-ignore */ adapterPath);
    const { GenericEngineClient } = await import(/* @vite-ignore */ clientPath);
    const client = new GenericEngineClient();
    try {
      const request = withVampConfiguration(data.input, data.rules, [{ providerKey: 'sample', abilityKey: 'hit', operationIndex: 0, damage: data.damage }],
        { combatantKinds: { source: 'CHAMPION', target: 'CHAMPION' }, rulesHash: 'with-vamp' });
      const compiled = await client.compile(request);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
      const done = await client.run({ ...data.run, sessionId: compiled.sessionId });
      const released = await client.release(compiled.sessionId, request.rulesHash);
      return { done, released };
    } finally { client.terminate(); }
  }, payload);
}

for (const scenario of [
  { kind: 'attack', healing: 5, total: 15, modified: 10.8, types: ['LIFE_STEAL', 'OMNIVAMP'] },
  { kind: 'skill', healing: 7.2, total: 10, modified: 7.2, types: ['OMNIVAMP'] },
  { kind: 'disabled', healing: 0, total: 0, modified: 0, types: [] },
  { kind: 'override', healing: 5.04, total: 7, modified: 5.04, types: ['LIFE_STEAL', 'OMNIVAMP'] }
] as const) {
  test(`实际 Worker 编译运行释放：${scenario.kind}`, async ({ page }) => {
    const result = await runSample(page, sample(scenario.kind));
    expect(result.released.released).toBe(true);
    expect(result.done.summary.sourceFinalHp).toBeCloseTo((scenario.kind === 'attack' ? 95 : 50) + scenario.healing, 9);
    expect(result.done.summary.targetFinalHp).toBe(0);
    const vamp = result.done.evidence.items.filter((item: { kind: string }) => item.kind === 'vamp');
    expect(vamp).toHaveLength(1);
    const data = vamp[0].data;
    expect(data).toMatchObject({ postDefenseDamage: 50, shieldAbsorbed: 20, actualHpLoss: 20, overkillDamage: 10 });
    expect(data.actualHealing).toBeCloseTo(scenario.healing, 9);
    expect(data.healingBeforeModifiers).toBeCloseTo(scenario.total, 9);
    expect(data.healingAfterModifiers).toBeCloseTo(scenario.modified, 9);
    expect(data.contributions.map((item: { vampType: string }) => item.vampType)).toEqual(scenario.types);
  });
}

for (const representative of [
  { skillKey: 'shared_basic_attack', effectKey: 'attack_hit', kind: 'attack', healing: 5 },
  { skillKey: 'annie_q', effectKey: 'spell_hit', kind: 'skill', healing: 7.2 },
  { skillKey: 'annie_w', effectKey: 'spell_hit', kind: 'skill', healing: 7.2 }
] as const) {
  test(`原库配置进入实际 Worker：${representative.skillKey}`, async ({ page, request }, testInfo) => {
    test.skip(process.env.VAMP_LIVE_API !== '1', '显式启用后只读本地实际服务');
    const api = 'http://127.0.0.1:8080/api/admin/games/lol';
    const headers = { Authorization: `Bearer ${process.env.DAMAGE_ADMIN_TOKEN || 'test'}` };
    const read = async (path: string) => {
      const response = await request.get(api + path, { headers });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const gameRules = await read('/vamp-rules');
    const skill = await read(`/skills/${representative.skillKey}`);
    const effect = await read(`/skills/${representative.skillKey}/effects/${representative.effectKey}`);
    const damage = effect.results.find((result: { resultType: string }) => result.resultType === 'DAMAGE');
    expect(damage.detail.vampQualification).toBe('RESOLVED');
    expect(damage.detail.vampOverrides).toEqual([]);
    expect(damage.detail).not.toHaveProperty('vampRules');
    const payload = sample(representative.kind);
    payload.rules = gameRules.rules;
    payload.damage = { gameId: skill.gameId, skillKey: skill.skillKey, skillCategoryKeys: skill.skillCategoryKeys,
      skillLevel: 1, characterLevel: 1, detail: damage.detail };
    // 实库提供规则、资格、分类；本专项明确提供100伤害、100抗性、20护盾及生命值。
    const damageType = damage.detail.damageTypeKey === 'physics' ? 'damage/physical' : 'damage/magic';
    expect(['physics', 'magic']).toContain(damage.detail.damageTypeKey);
    payload.input.typeCatalog.types = [{ key: damageType, domain: 'damage' }];
    payload.input.sharedProviders![0]!.abilities![0]!.operations![0]!.damageType = damageType;
    const resistance = { base: 100, current: 100, max: 100, resolved: 100 };
    payload.input.combatants[1]!.attributes.magic_resist = resistance;
    payload.run.initialSnapshot.combatants[1]!.attributes.magic_resist = resistance;
    const result = await runSample(page, payload);
    expect(result.released.released).toBe(true);
    const vamp = result.done.evidence.items.find((item: { kind: string }) => item.kind === 'vamp');
    expect(vamp.data.actualHealing).toBeCloseTo(representative.healing, 9);
    await testInfo.attach('实际配置与运行证据', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
      skillKey: skill.skillKey, effectKey: effect.effectKey, rules: gameRules.rules, detail: damage.detail,
      suppliedScenario: '100伤害、100抗性、20护盾、20目标生命、造成治疗+20%、受到治疗-40%',
      summary: result.done.summary, vamp: vamp.data, released: result.released
    }, null, 2)) });
  });
}

test('实际页面读取游戏通用吸血规则', async ({ page }, testInfo) => {
  test.skip(process.env.VAMP_LIVE_API !== '1', '显式启用后只读本地实际服务');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(token => {
    localStorage.setItem('damage-viewer.web.api-base-url', 'http://127.0.0.1:8080');
    localStorage.setItem('damage-viewer.web.admin-token', token);
  }, process.env.DAMAGE_ADMIN_TOKEN || 'test');
  await page.goto('/#/game-settings');
  await expect(page.getByRole('spinbutton', { name: '生命偷取默认效率', exact: true })).toHaveValue('1');
  await expect(page.getByRole('spinbutton', { name: '全能吸血默认效率', exact: true })).toHaveValue('1');
  await expect(page.getByLabel('全能吸血来源比例属性', { exact: true })).toContainText('omnivamp_percent');
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('live-game-vamp-rules.png'), fullPage: true, mask: [page.locator('.app-toolbar')] });
});
