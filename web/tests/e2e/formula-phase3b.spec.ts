import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Locator } from '@playwright/test';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { readIsolatedSimulationSnapshot, simulationComparisonSelection } from '../fixtures/simulationSnapshotRequests';
import type { Expression } from '../../src/types/formulaContract.generated';
import type { SkillConfiguration } from '../../src/types/skillConfiguration';

const apiBase = process.env.SIMULATION_LIVE_API_BASE_URL || 'http://127.0.0.1:18081';
const headers = {  };
const builderUrl = pathToFileURL('../wasm/tinygo_engine_v2/scripts/formula-phase3b-input.mjs').href;

test.beforeEach(async ({ page }) => {
  expect(process.env.SIMULATION_LIVE_API, '本专项必须启用真实服务').toBe('1');
  await page.addInitScript(({ apiBase }) => {
  }, { apiBase });
});

async function browserIdentity(page: Page): Promise<void> {
  const bytes = await page.evaluate(async () => [...new Uint8Array(await (await fetch('/src/engine/wasm/tinygo_engine_v2.wasm')).arrayBuffer())]);
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(Uint8Array.from(bytes)).digest('hex')).toBe(WASM_IDENTITY.sha256);
}

function archive(testInfo: TestInfo, name: string, value: unknown) {
  const path = testInfo.outputPath(name); writeFileSync(path, JSON.stringify(value, null, 2));
  return testInfo.attach(name, { path, contentType: 'application/json' });
}

test('真实共享普攻完整技能共同定义经原生静态核定、最终场景与Worker二十次一致', async ({ page, request }, testInfo) => {
  const { snapshot } = await readIsolatedSimulationSnapshot(request, apiBase, simulationComparisonSelection());
  const skill = snapshot.skillConfigurations.find(row => row.skill.skillKey === snapshot.selection.basicAttackSkillKey)!;
  expect(skill.formulas.length).toBeGreaterThan(0);
  for (const row of skill.formulas) {
    expect(row.expression).toMatchObject({ inputs: expect.any(Array), stages: expect.any(Array), outputStageKey: expect.any(String) });
    expect(row.expression).not.toHaveProperty('nodeType');
  }
  await page.goto('/#/simulation/basic-attack');
  await browserIdentity(page);
  const workers: string[] = []; page.on('worker', worker => workers.push(worker.url()));
  const result = await page.evaluate(async (snapshot) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const preflightPath = '/src/engine/skillFormulaPreflight.ts';
    const proofPath = '/src/engine/approvedFormulaValues.ts';
    const { inspectSimulationSnapshot, prepareSimulation, singleAttackRequest } = await import(adapterPath);
    const { GenericEngineClient } = await import(clientPath);
    const { preflightSkillFormulas } = await import(preflightPath);
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(proofPath);
    const client = new GenericEngineClient();
    const preflight = await preflightSkillFormulas(snapshot, client);
    const requirements = inspectSimulationSnapshot(snapshot).requirements;
    const values: { source: Record<string, number>; target: Record<string, number> } = { source: {}, target: {} };
    for (const row of requirements) if (row.storedValue === undefined) values[row.side as 'source' | 'target'][row.attribute.attributeKey] = 0;
    const prepared = await prepareSimulation(snapshot, values, {
      source: snapshot.source.selectedLevelValues.hp, target: snapshot.target.selectedLevelValues.hp
    });
    try {
      const compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      const request = singleAttackRequest(prepared.compileRequest, compiled.sessionId);
      const runs = [];
      for (let index = 0; index < 20; index++) runs.push((await client.run(request)).summary);
      const released = await client.release(compiled.sessionId, compiled.rulesHash);
      return { preflight, prepared, compiled, runs, released };
    } finally { client.terminate(); }
  }, snapshot);
  expect(workers.some(url => url.includes('genericEngineWorker'))).toBe(true);
  expect(result.preflight).toMatchObject({ compileCount: 1, released: true });
  const expected = snapshot.source.selectedLevelValues.attack_damage! * 100 / (100 + snapshot.target.selectedLevelValues.armor!);
  for (const summary of result.runs) {
    expect(summary).toEqual(result.runs[0]);
    expect(summary.sourceDamageDealt).toBeCloseTo(expected, 8);
    expect(summary.targetFinalHp).toBeCloseTo(snapshot.target.selectedLevelValues.hp! - expected, 8);
  }
  expect(result.released.released).toBe(true);
  await archive(testInfo, '真实共同技能快照与静态编译运行.json', { snapshot, ...result, workers, wasm: WASM_IDENTITY });
});

async function selectOption(page: Page, dialog: Locator, label: string, value: string) {
  await dialog.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: value, exact: true }).last().click();
}

async function fillExpression(page: Page, dialog: Locator, label: string, expression: Expression): Promise<void> {
  const names: Record<string, string> = { const: '固定值', read: '输入值', ref: '结果引用', mul: '乘', div: '除', if: '条件选择' };
  await selectOption(page, dialog, `${label}节点类型`, names[expression.op]!);
  if (expression.op === 'const') await dialog.getByLabel(`${label}固定值`, { exact: true }).fill(expression.value);
  else if (expression.op === 'read') await selectOption(page, dialog, `${label}输入值`, expression.inputKey);
  else if (expression.op === 'ref') {
    const resultNames: Record<string, string> = { scaled: '等级数值', unused_zero: '未用动态结果', zero: '明确零' };
    await selectOption(page, dialog, `${label}结果引用`, `${resultNames[expression.stageKey]}（${expression.stageKey}）`);
  } else if ('args' in expression) for (const [index, argument] of expression.args.entries()) {
    await fillExpression(page, dialog, `${label}第${index + 1}项`, argument);
  }
}

test('真实统一页面同次保存等级参数和二结果公式，扩为六结果后双身份Worker二十次一致', async ({ page, request }, testInfo) => {
  const { createFormulaPhase3BDefinition, createFormulaPhase3BTwoInstances } = await import(builderUrl);
  const key = `formula_phase3b_${Date.now().toString(36)}`;
  const writes: string[] = [];
  page.on('request', request => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.goto('/#/skills');
  await browserIdentity(page);
  await page.getByRole('button', { name: '新增技能', exact: true }).click();
  const workspace = page.locator('[aria-label="技能统一编辑工作区"]');
  await workspace.getByLabel('技能标识').fill(key);
  await workspace.getByLabel('技能名称').fill('技能共同公式第三B浏览器验收');
  await workspace.getByLabel('最高等级').fill('2');
  await workspace.getByRole('navigation', { name: '技能配置模块' }).getByRole('button', { name: '参数与公式' }).click();
  await workspace.getByRole('button', { name: '新增参数', exact: true }).click();
  const parameterDialog = page.getByRole('dialog', { name: '新增参数' });
  await parameterDialog.getByLabel('稳定标识', { exact: true }).fill('basis');
  await parameterDialog.getByLabel('参数名称', { exact: true }).fill('基础值');
  await parameterDialog.getByText('小数', { exact: true }).click();
  await parameterDialog.getByText('按技能等级', { exact: true }).click();
  await parameterDialog.getByLabel('等级1数值').fill('100');
  await parameterDialog.getByLabel('等级2数值').fill('200');
  await parameterDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  await workspace.getByRole('button', { name: '新增公式', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新增公式' });
  await dialog.getByLabel('公式稳定标识').fill('output');
  await dialog.getByLabel('公式名称', { exact: true }).fill('共同等级公式');
  await dialog.getByRole('button', { name: '添加公式输入', exact: true }).click();
  await dialog.getByLabel('公式输入1标识').fill('basis');
  await selectOption(page, dialog, '公式输入1技能参数', '基础值（basis）');
  const initial = createFormulaPhase3BDefinition({ skillKey: key, stages: 2 });
  for (const [index, stage] of initial.stages.entries()) {
    await dialog.getByRole('button', { name: '添加公式结果', exact: true }).click();
    await dialog.getByLabel(`公式结果${index + 1}标识`).fill(stage.key);
    await dialog.getByLabel(`公式结果${index + 1}名称`).fill(stage.name);
    await fillExpression(page, dialog, `公式结果${index + 1}`, stage.expression);
  }
  await selectOption(page, dialog, '公式最终输出', '输出（output）');
  await dialog.getByRole('button', { name: '确认到技能草稿' }).click();
  expect(writes).toEqual([]);
  await workspace.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  const path = `/api/admin/games/lol/skills/${key}/configuration`;
  const beforeResponse = await request.get(apiBase + path, { headers });
  expect(beforeResponse.status()).toBe(200);
  const before = await beforeResponse.json() as SkillConfiguration;
  expect(before.parameters[0]).toMatchObject({ parameterKey: 'basis', valueMode: 'SKILL_LEVEL', valueType: 'DECIMAL', levelValues: { '1': 100, '2': 200 } });
  expect(before.formulas[0]!.expression).toEqual(initial);
  expect(writes).toEqual([`POST ${path}`]);
  await archive(testInfo, '真实同次保存参数和二结果.json', { key, before, writes: [...writes], initial });
  await expect(workspace.getByRole('button', { name: '编辑', exact: true })).toHaveCount(2);
  await workspace.getByRole('button', { name: '编辑', exact: true }).nth(1).click();
  dialog = page.getByRole('dialog', { name: '编辑公式' });
  const expanded = createFormulaPhase3BDefinition({ skillKey: key, stages: 6 });
  for (const [index, stage] of expanded.stages.entries()) {
    if (index < 2) continue;
    await dialog.getByRole('button', { name: '添加公式结果', exact: true }).click();
    await dialog.getByLabel(`公式结果${index + 1}标识`).fill(stage.key);
    await dialog.getByLabel(`公式结果${index + 1}名称`).fill(stage.name);
    await fillExpression(page, dialog, `公式结果${index + 1}`, stage.expression);
  }
  await dialog.getByRole('button', { name: '确认到技能草稿' }).click();
  await workspace.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  const afterResponse = await request.get(apiBase + path, { headers });
  expect(afterResponse.status()).toBe(200);
  const after = await afterResponse.json() as SkillConfiguration;
  expect(after.parameters).toEqual(before.parameters);
  expect(after.formulas[0]!.expression).toEqual(expanded);
  for (const field of ['effects', 'internalStates', 'processes', 'triggerRules'] as const) expect(after[field]).toEqual(before[field]);
  const defenseResponse = await request.get(`${apiBase}/api/admin/games/lol/damage-types/heat/formula`, { headers });
  expect(defenseResponse.status()).toBe(200);
  const defense = await defenseResponse.json();
  const parameter = after.parameters[0]!;
  const input = createFormulaPhase3BTwoInstances({ skillKey: key, expression: after.formulas[0]!.expression,
    parameters: [{ parameterKey: parameter.parameterKey, valueType: parameter.valueType, valueMode: parameter.valueMode, value: parameter.levelValues!['1'] }],
    damageFormula: defense.formula });
  input.compileRequest.formulas[1].parameters[0].value = parameter.levelValues!['2'];
  const workers: string[] = []; page.on('worker', worker => workers.push(worker.url()));
  const result = await page.evaluate(async input => {
    const path = '/src/engine/genericEngineClient.ts'; const { GenericEngineClient } = await import(path);
    const client = new GenericEngineClient();
    try {
      const compiled = await client.compile(input.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      input.runRequest.sessionId = compiled.sessionId;
      const runs = [];
      for (let index = 0; index < 20; index++) runs.push(await client.run(input.runRequest));
      const released = await client.release(compiled.sessionId, compiled.rulesHash);
      return { compiled, runs, released };
    } finally { client.terminate(); }
  }, input);
  expect(result.compiled.metadata.approvedStaticValues).toMatchObject({ [input.programKey]: 120, [input.secondProgramKey]: 240 });
  for (const run of result.runs) {
    expect(run.summary).toEqual(result.runs[0].summary);
    expect(run.summary).toMatchObject({ targetFinalHp: 950, sourceFinalHp: 870, sourceDamageDealt: 80, targetDamageDealt: 160 });
  }
  expect(result.released.released).toBe(true);
  expect(workers.some(url => url.includes('genericEngineWorker'))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('真实技能共同公式六结果.png'), fullPage: true });
  await archive(testInfo, '真实同写参数公式六结果双等级工作线程.json', { key, before, after, defense, input, ...result, workers, writes, wasm: WASM_IDENTITY });
});
