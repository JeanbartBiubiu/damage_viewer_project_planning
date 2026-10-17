import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type APIResponse, type Page } from '@playwright/test';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import type { SkillActionArchive } from '../../src/pages/simulation/SimulationScenarioPanel';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { simulationSkillSourceIdentity } from '../../src/services/simulationSkillSourceIdentity';
import { chooseSimulationEntity, chooseSimulationLevel } from '../fixtures/simulationSelection';
import { confirmSimulationConfiguration } from '../fixtures/simulationSnapshotRequests';

const apiBase = process.env.SIMULATION_LIVE_API_BASE_URL || 'http://127.0.0.1:18082';
const proofDirectory = resolve('output/formula-phase4-real-pages');
async function selectOption(page: Page, label: string, option: string) {
  const select = page.getByLabel(label, { exact: true });
  await select.click();
  await page.locator(`#${await select.getAttribute('aria-controls')}`).getByRole('option', { name: option, exact: true }).click();
}
async function readSnapshot(page: Page) {
  const responses: APIResponse[] = [];
  const isSnapshot = (response: APIResponse) => response.url().endsWith('/simulation-snapshot') && response.request().method() === 'POST';
  const observe = (response: APIResponse) => { if (isSnapshot(response)) responses.push(response); };
  page.on('response', observe);
  try {
    const receiving = page.waitForResponse(isSnapshot);
    const button = page.getByRole('button', { name: '读取场景快照', exact: true });
    await button.click();
    await receiving;
    await expect(button).toBeEnabled({ timeout: 30_000 });
    const received = responses[responses.length - 1]!;
    expect(received.status()).toBe(200);
    return received.json() as Promise<SimulationSnapshot>;
  } finally { page.off('response', observe); }
}

for (const sample of [
  { characterKey: 'champion_corki', skillKey: 'corki_q', damageType: 'magic', cost: 'mana_cost.consume_mana' },
  { characterKey: 'champion_garen', skillKey: 'garen_r', damageType: 'real', cost: null }
] as const) test(`第四阶段真实页面 ${sample.skillKey} 作者原键、明确计划、最终Worker与档案`, async ({ page }, info) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '须明确启用最终真实后端与Wasm');
  const writes: string[] = [], errors: string[] = [];
  page.on('request', request => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()) && !request.url().endsWith('/simulation-snapshot')) writes.push(request.method() + ' ' + new URL(request.url()).pathname);
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ apiBase, token }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', apiBase);
    localStorage.setItem('damage-viewer.web.admin-token', token || 'local-readonly-check');
  }, { apiBase, token: process.env.SIMULATION_LIVE_ADMIN_TOKEN || '' });
  await page.goto('/#/simulation/basic-attack');
  const bytes = await (await page.request.get('/src/engine/wasm/tinygo_engine_v2.wasm')).body();
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(WASM_IDENTITY.sha256);
  await chooseSimulationEntity(page, '攻击方角色', sample.characterKey);
  await chooseSimulationLevel(page, '攻击方等级', 18);
  await chooseSimulationEntity(page, '目标角色', 'champion_malphite');
  await chooseSimulationLevel(page, '目标等级', 18);
  const skillMode = page.getByRole('checkbox', { name: '指定技能行动计划', exact: true });
  await skillMode.locator('xpath=ancestor::label').click();
  await expect(skillMode).toBeChecked();
  await chooseSimulationEntity(page, '攻击方主动技能候选', sample.skillKey);
  await page.getByRole('button', { name: '添加首次尝试', exact: true }).click();
  await selectOption(page, '技能命中预设 skill_instruction_1', '释放后对唯一目标尝试命中');
  const candidate = await readSnapshot(page);
  for (const side of ['source', 'target'] as const) for (const source of candidate[side].skillSources) {
    if (source.origin.kind !== 'CHARACTER' || source.skillStatus !== 'ENABLED'
      || side === 'source' && source.skillKey === sample.skillKey) continue;
    const checkbox = page.getByRole('checkbox', { name: `${side === 'source' ? '攻击方' : '目标'}来源 ${simulationSkillSourceIdentity(source.origin, source.skillKey)} 开启`, exact: true });
    if (await checkbox.isChecked()) await checkbox.locator('xpath=ancestor::label').click();
  }
  await selectOption(page, `攻击方来源 ${simulationSkillSourceIdentity({ kind: 'CHARACTER', characterKey: sample.characterKey }, sample.skillKey)} 等级`, '1');
  const snapshot = await readSnapshot(page);
  await confirmSimulationConfiguration(page);
  if (sample.cost) await page.getByRole('checkbox', { name: `声明施法成本 ${sample.cost}`, exact: true }).locator('xpath=ancestor::label').click();
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  const sourceAp = page.getByRole('spinbutton', { name: '攻击方补充属性 ability_power', exact: true });
  if (await sourceAp.count()) await sourceAp.fill('100');
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  await page.getByRole('spinbutton', { name: '观察时长（毫秒）', exact: true }).fill('2000');
  await page.getByRole('button', { name: '执行指定技能计划', exact: true }).click();
  const result = page.getByRole('region', { name: '指定技能结果', exact: true });
  await expect(result.getByText(/观察完整；会话已释放/)).toBeVisible();
  const downloading = page.waitForEvent('download');
  await result.getByRole('button', { name: '下载主动冻结档案', exact: true }).click();
  const download = await downloading;
  mkdirSync(proofDirectory, { recursive: true });
  const artifactPath = resolve(proofDirectory, `${sample.skillKey}-page-archive.json`);
  await download.saveAs(artifactPath);
  const archive = JSON.parse(readFileSync(artifactPath, 'utf8')) as SkillActionArchive;
  expect(archive.wasm).toEqual(WASM_IDENTITY);
  expect(archive.cleanup).toBe('released');
  expect(archive.assessment?.complete).toBe(true);
  expect(archive.snapshot.selection).toEqual(snapshot.selection);
  expect(archive.runResult!.summary.skillActions).toMatchObject({ plannedCount: 1, acceptedCount: 1, rejectedCount: 0 });
  expect(archive.runResult!.summary.skillUses).toMatchObject({ completedCount: 1, hitCount: 1 });
  expect(archive.runResult!.damageRecords).toHaveLength(1);
  const damage = archive.runResult!.damageRecords![0]!;
  expect(damage.damageType).toBe(sample.damageType);
  expect(damage.postDefenseDamage).toBeGreaterThan(0);
  expect(archive.compileRequest!.rules.damageTypeFormulas).toContainEqual({ damageType: sample.damageType,
    formula: snapshot.catalogs.damageTypes.find(row => row.type.damageTypeKey === sample.damageType)!.formula.formula });
  for (const key of ['resistanceBeforePenetration', 'penetrationPercent', 'penetrationFlat', 'effectiveResistance']) expect(damage).not.toHaveProperty(key);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  await expect.poll(() => page.workers().length).toBe(0);
  writeFileSync(resolve(proofDirectory, `${sample.skillKey}-page-checks.json`), JSON.stringify({ wasm: WASM_IDENTITY,
    businessWrites: writes, errors, selection: snapshot.selection, summary: archive.runResult!.summary, cleanup: archive.cleanup }, null, 2));
  await info.attach('真实页面主动冻结档案', { path: artifactPath, contentType: 'application/json' });
  await page.screenshot({ path: resolve(proofDirectory, `${sample.skillKey}-page.png`), fullPage: true, mask: [page.locator('.app-toolbar')] });
});
