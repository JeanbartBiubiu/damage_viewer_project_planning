import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { readIsolatedSimulationSnapshot, simulationComparisonSelection } from '../fixtures/simulationSnapshotRequests';
import type { Expression, FormulaDefinition } from '../../src/types/formulaContract.generated';

const apiBase = process.env.SIMULATION_LIVE_API_BASE_URL || 'http://127.0.0.1:8080';
const token = process.env.SIMULATION_LIVE_ADMIN_TOKEN || '';
const builderUrl = pathToFileURL('../wasm/tinygo_engine_v2/scripts/formula-phase3-input.mjs').href;

test.beforeEach(async ({ page }) => {
  expect(process.env.SIMULATION_LIVE_API, '本专项必须启用真实后端；不以跳过代替验收').toBe('1');
  await page.addInitScript(({ api, token }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', token || 'local-readonly-check');
  }, { api: apiBase, token });
});

async function assertBrowserWasm(page: Page): Promise<void> {
  const bytes = await page.evaluate(async () => [...new Uint8Array(await (await fetch('/src/engine/wasm/tinygo_engine_v2.wasm')).arrayBuffer())]);
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(Uint8Array.from(bytes)).digest('hex')).toBe(WASM_IDENTITY.sha256);
}

test('真实场景快照完整共同定义原样进入最终Worker物理伤害', async ({ page, request }, testInfo) => {
  const { snapshot } = await readIsolatedSimulationSnapshot(request, apiBase, simulationComparisonSelection(), token);
  const formulas = await request.get(`${apiBase}/api/admin/games/lol/damage-types/physics/formula`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  expect(formulas.status()).toBe(200);
  const physics = await formulas.json();
  expect(physics.formula).toMatchObject({ inputs: expect.any(Array), stages: expect.any(Array), outputStageKey: expect.any(String) });
  await page.goto('/#/simulation/basic-attack');
  await assertBrowserWasm(page);
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const result = await page.evaluate(async (snapshot) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const { inspectSimulationSnapshot, prepareSimulation, singleAttackRequest } = await import(adapterPath);
    const { GenericEngineClient } = await import(clientPath);
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { preflightSkillFormulas } = await import(preflightPath);
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(proofPath);
    const client = new GenericEngineClient();
    const formulaPreflight = await preflightSkillFormulas(snapshot, client);
    const inputs: { source: Record<string, number>; target: Record<string, number> } = { source: {}, target: {} };
    for (const requirement of inspectSimulationSnapshot(snapshot).requirements) {
      if (requirement.storedValue === undefined) inputs[requirement.side as 'source' | 'target'][requirement.attribute.attributeKey] = 0;
    }
    const prepared = await prepareSimulation(snapshot, inputs, {
      source: snapshot.source.selectedLevelValues.hp, target: snapshot.target.selectedLevelValues.hp
    });
    try {
      const compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      const runRequest = singleAttackRequest(prepared.compileRequest, compiled.sessionId);
      const runs = [];
      for (let i = 0; i < 20; i++) runs.push((await client.run(runRequest)).summary);
      const released = await client.release(compiled.sessionId, compiled.rulesHash);
      return { request: prepared.compileRequest, formulaPreflight, compiled, runs, released };
    } finally { client.terminate(); }
  }, snapshot);
  expect(workers.some(url => url.includes('genericEngineWorker'))).toBe(true);
  expect(result.request.typeCatalog.types.some((row: { key: string; domain: string }) => row.key === 'physics' && row.domain === 'damage')).toBe(true);
  expect(result.request.typeCatalog.types.some((row: { key: string; domain: string }) => row.key === 'armor' && row.domain === 'attribute')).toBe(true);
  expect(result.request.rules.damageTypeFormulas).toContainEqual({ damageType: 'physics', formula: physics.formula });
  const expectedDamage = snapshot.source.selectedLevelValues.attack_damage! * 100 / (100 + snapshot.target.selectedLevelValues.armor!);
  for (const summary of result.runs) {
    expect(summary).toEqual(result.runs[0]);
    expect(summary.sourceDamageDealt).toBeCloseTo(expectedDamage, 8);
    expect(summary.targetFinalHp).toBeCloseTo(snapshot.target.selectedLevelValues.hp! - expectedDamage, 8);
  }
  expect(result.released.released).toBe(true);
  const archivePath = testInfo.outputPath('实库快照与最终工作线程.json');
  writeFileSync(archivePath, JSON.stringify({ snapshot, physics, ...result, workers, wasm: WASM_IDENTITY }, null, 2));
  await testInfo.attach('实库快照与最终工作线程.json', { path: archivePath, contentType: 'application/json' });
});

const operationLabels: Record<string, string> = {
  const: '固定值', read: '输入值', ref: '结果引用', add: '加', sub: '减', mul: '乘', div: '除',
  min: '取较小值', max: '取较大值', eq: '等于', ne: '不等于', lt: '小于', lte: '小于或等于',
  gt: '大于', gte: '大于或等于', if: '条件选择', clamp: '范围夹取', floor: '向下取整',
  ceil: '向上取整', trunc: '截断小数', round: '四舍五入'
};

async function chooseOption(page: Page, label: string, option: string | RegExp): Promise<void> {
  await page.locator(`[aria-label="${label}"]`).click();
  await page.getByRole('option', { name: option, exact: typeof option === 'string' }).click();
}

async function editExpression(page: Page, label: string, expression: Expression): Promise<void> {
  await chooseOption(page, `${label}节点类型`, operationLabels[expression.op]!);
  if (expression.op === 'const') {
    await page.getByLabel(`${label}固定值`, { exact: true }).fill(expression.value);
  } else if (expression.op === 'read') {
    await chooseOption(page, `${label}输入值`, expression.inputKey);
  } else if (expression.op === 'ref') {
    await chooseOption(page, `${label}结果引用`, new RegExp(`（${expression.stageKey}）$`));
  } else if ('args' in expression) {
    for (const [index, argument] of expression.args.entries()) await editExpression(page, `${label}第${index + 1}项`, argument);
    if (expression.op === 'round') await page.getByLabel(`${label}小数位数`, { exact: true }).fill(String(expression.decimals));
  }
}

async function saveHeatFormulaInPage(page: Page, formula: FormulaDefinition): Promise<void> {
  const row = page.getByRole('row').filter({ has: page.getByText('heat', { exact: true }) });
  await row.getByRole('button', { name: '配置公式', exact: true }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('button', { name: '添加输入', exact: true })).toBeEnabled();
  while (await modal.getByRole('button', { name: /^删除输入\d+$/ }).count()) {
    await modal.getByRole('button', { name: /^删除输入\d+$/ }).last().click();
  }
  while (await modal.getByRole('button', { name: /^删除结果\d+$/ }).count()) {
    await modal.getByRole('button', { name: /^删除结果\d+$/ }).last().click();
  }
  for (const [index, input] of formula.inputs.entries()) {
    if (input.binding.kind !== 'attribute') throw new Error('专项只录入明确属性输入');
    await modal.getByRole('button', { name: '添加输入', exact: true }).click();
    await modal.getByLabel(`输入${index + 1}标识`, { exact: true }).fill(input.key);
    await modal.locator(`[aria-label="输入${index + 1}属性对象"]`).getByText(input.binding.object === 'source' ? '来源' : '目标', { exact: true }).click();
    await chooseOption(page, `输入${index + 1}属性`, new RegExp(`（${input.binding.attributeKey}）$`));
    await chooseOption(page, `输入${index + 1}属性取值方式`, input.binding.valueKind === 'BASE' ? '基础值' : input.binding.valueKind === 'BONUS' ? '加成值' : '最终值');
  }
  for (const [index, stage] of formula.stages.entries()) {
    await modal.getByRole('button', { name: '添加结果', exact: true }).click();
    await modal.getByLabel(`结果${index + 1}标识`, { exact: true }).fill(stage.key);
    await modal.getByLabel(`结果${index + 1}名称`, { exact: true }).fill(stage.name);
  }
  for (const [index, stage] of formula.stages.entries()) await editExpression(page, `结果${index + 1}表达式`, stage.expression);
  await chooseOption(page, '最终输出结果', new RegExp(`（${formula.outputStageKey}）$`));
  const saved = page.waitForResponse(response => response.url() === `${apiBase}/api/admin/games/lol/damage-types/heat/formula` && response.request().method() === 'PUT');
  await modal.getByRole('button', { name: '保存', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(modal).toBeHidden();
}

test('真实管理页录入灼热两／六结果，读回定义由正式Worker结算80伤害、30护盾、50生命损失', async ({ page, request }, testInfo) => {
  const { createFormulaPhase3Definition, createFormulaPhase3Input } = await import(builderUrl);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const typePath = `${apiBase}/api/admin/games/lol/damage-types/heat`;
  const existing = await request.get(typePath, { headers });
  expect([200, 404]).toContain(existing.status());
  if (existing.ok()) {
    const existingFormula = await request.get(`${typePath}/formula`, { headers });
    if (existingFormula.ok()) {
      const definition = (await existingFormula.json()).formula;
      expect([createFormulaPhase3Definition({ stages: 2 }), createFormulaPhase3Definition({ stages: 6 })], '保护既有非本任务灼热公式').toContainEqual(definition);
    }
  }
  await page.goto('/#/damage-types');
  await assertBrowserWasm(page);
  const gameSelect = page.locator('.app-toolbar-field--game .arco-select');
  await expect(gameSelect).not.toHaveClass(/arco-select-disabled/);
  await gameSelect.click();
  await page.getByRole('option', { name: /^lol \/ / }).click();
  if (!existing.ok()) {
    await page.getByRole('button', { name: '新增伤害类型', exact: true }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('伤害类型标识', { exact: true }).fill('heat');
    await modal.getByLabel('伤害类型名称', { exact: true }).fill('灼热');
    await modal.getByLabel('说明', { exact: true }).fill('共同公式第三阶段验收：作者定义防御倍率。');
    const created = page.waitForResponse(response => response.url() === `${apiBase}/api/admin/games/lol/damage-types` && response.request().method() === 'POST');
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    expect((await created).status()).toBe(201);
    await expect(modal).toBeHidden();
  }
  const records = [];
  for (const stages of [2, 6]) {
    const formula: FormulaDefinition = createFormulaPhase3Definition({ stages });
    await saveHeatFormulaInPage(page, formula);
    const readback = await request.get(`${typePath}/formula`, { headers });
    expect(readback.status()).toBe(200);
    const detail = await readback.json();
    expect(detail.formula).toEqual(formula);
    const actualType = await (await request.get(typePath, { headers })).json();
    const actualAttributes = await (await request.get(`${apiBase}/api/admin/games/lol/attributes`, { headers })).json();
    const input = createFormulaPhase3Input({ formula: detail.formula });
    const workers: string[] = [];
    page.on('worker', worker => workers.push(worker.url()));
    const runtime = await page.evaluate(async ({ input, detail, actualType, attributes }) => {
      const clientPath = '/src/engine/genericEngineClient.ts';
      const adapterPath = '/src/engine/simulation/compile/damageFormula.ts';
      const { GenericEngineClient } = await import(clientPath);
      const { compileSimulationDamageFormula } = await import(adapterPath);
      // 目录来自真实只读接口；此处只验证作者公式运输，独立伤害输入仍明确构造。
      const transported = compileSimulationDamageFormula({ gameId: 'lol', catalogs: {
        damageTypes: [{ type: actualType, formula: detail }], attributes
      } }, 'heat');
      input.compileRequest.rules.damageTypeFormulas[0] = transported;
      const client = new GenericEngineClient();
      try {
        const compiled = await client.compile(input.compileRequest);
        if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
        const runRequest = { ...input.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash };
        const runs = [];
        let first;
        for (let i = 0; i < 20; i++) { const done = await client.run(runRequest); first ??= done; runs.push(done.summary); }
        const released = await client.release(compiled.sessionId, compiled.rulesHash);
        return { transported, compiled, runs, first, released };
      } finally { client.terminate(); }
    }, { input, detail, actualType, attributes: actualAttributes.items });
    expect(runtime.transported).toEqual({ damageType: 'heat', formula: detail.formula });
    expect(workers.some(url => url.includes('genericEngineWorker'))).toBe(true);
    for (const summary of runtime.runs) {
      expect(summary).toEqual(runtime.runs[0]);
      expect(summary).toMatchObject(input.expectedSummarySubset);
    }
    const damage = runtime.first.evidence.items.find((row: { kind: string }) => row.kind === 'damage');
    expect(damage.data).toMatchObject({ rawAmount: 120, mitigatedAmount: 80, postDefenseDamage: 80, shieldAbsorbed: 30, actualHpLoss: 50 });
    expect(damage.data.resistanceFactor).toBeCloseTo(2 / 3, 12);
    for (const oldField of ['resistanceBeforePenetration', 'penetrationPercent', 'penetrationFlat', 'effectiveResistance']) expect(damage.data).not.toHaveProperty(oldField);
    expect(runtime.released.released).toBe(true);
    records.push({ stages, detail, input, ...runtime, workers });
  }
  await page.getByRole('row').filter({ has: page.getByText('heat', { exact: true }) }).getByRole('button', { name: '查看公式', exact: true }).click();
  await expect(page.getByLabel('结果6标识', { exact: true })).toHaveValue('ratio');
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('灼热六结果真实管理页.png') });
  const archivePath = testInfo.outputPath('真实管理保存与独立明确伤害输入.json');
  writeFileSync(archivePath, JSON.stringify({ evidenceBoundary: '公式为实库真实管理保存读回；伤害输入由独立明确构造，未冒称heat来自场景快照', records, wasm: WASM_IDENTITY }, null, 2));
  await testInfo.attach('真实管理保存与独立明确伤害输入.json', { path: archivePath, contentType: 'application/json' });
});
