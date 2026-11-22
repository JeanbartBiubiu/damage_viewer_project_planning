import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { CombatComparisonAssessment } from '../../src/engine/combatComparison';
import type { ContinuousAttackArchive } from '../../src/pages/simulation/SimulationScenarioPanel';
import type { SimulationSelection } from '../../src/types/simulationSnapshot';
import {
  combatAnalysisWorkers, chooseCombatAnalysisOption, holdNextCombatAnalysisResult, installCombatAnalysisApi,
  openCombatAnalysisPage, resumeCombatAnalysis, setCombatAnalysisCheckbox, waitForHeldCombatAnalysis
} from '../fixtures/combatAnalysisPage';
import { simulationAvailabilitySample } from '../fixtures/simulationAvailability';
import { chooseSimulationEntity, chooseSimulationLevel } from '../fixtures/simulationSelection';
import { triggeredEquipmentSimulationSample } from '../fixtures/simulationTriggeredEquipment';

const healthItem = 'item_1028';
const damageItem = 'item_1036';
const passiveItem = 'item_1043';
const result = (page: Page) => page.getByRole('region', { name: '出装比较结果', exact: true });
const compare = (page: Page) => page.getByRole('button', { name: '开始比较', exact: true });
const start = (page: Page) => page.getByRole('button', { name: '开始计算', exact: true });
const continuous = (page: Page) => page.getByRole('region', { name: '连续普攻结果', exact: true });
const equipLabel = { A: '攻击方装备', B: '攻击方装备（方案 B）' };
type FrozenComparison = { a: ContinuousAttackArchive; b: ContinuousAttackArchive; assessment: CombatComparisonAssessment };

function sample(keys: string[], missingSpeedRatio = false, attackDamageMax?: number) {
  const snapshot = triggeredEquipmentSimulationSample(keys);
  Object.assign(snapshot.source.selectedLevelValues, {
    attack_speed: 1, attack_speed_ratio: 1, bonus_attack_speed_percent: 0,
    critical_strike_chance: .5, critical_strike_damage_bonus_percent: 0,
    armor_pen_percent: 0, armor_pen_flat: 0, life_steal_percent: 0
  });
  if (missingSpeedRatio) delete snapshot.source.selectedLevelValues.attack_speed_ratio;
  snapshot.source.attributes.levelValues['1'] = { ...snapshot.source.selectedLevelValues };
  if (attackDamageMax !== undefined) snapshot.catalogs.attributes.find(row => row.attributeKey === 'attack_damage')!.maxValue = attackDamageMax;
  return snapshot;
}

async function open(page: Page, missingSpeedRatio = false, attackDamageMax?: number) {
  const directory = sample([healthItem, damageItem, passiveItem], missingSpeedRatio, attackDamageMax);
  const diagnostics = await installCombatAnalysisApi(page, directory, {
    availability: simulationAvailabilitySample(directory),
    equipmentCatalog: directory.source.selectedEquipment.map(item => item.equipment),
    snapshotForSelection: (selection: SimulationSelection) => sample(selection.sourceEquipmentKeys, missingSpeedRatio, attackDamageMax)
  });
  await openCombatAnalysisPage(page);
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'actor_b');
  await chooseSimulationLevel(page, '目标等级', 1);
  return diagnostics;
}

async function equip(page: Page, side: 'A' | 'B', key: string | null, previous?: string) {
  const selector = page.locator(`.simulation-equipment-select[aria-label="${equipLabel[side]}"]`);
  const choose = async (value: string) => {
    if (!(await selector.getAttribute('aria-expanded') === 'true')) await selector.click();
    await selector.locator('input').fill(value);
    const options = page.locator(`#${await selector.getAttribute('aria-controls')}`);
    await options.getByRole('option').filter({ has: page.getByText(value, { exact: true }) }).click();
  };
  if (previous) await selector.getByRole('button', { name: 'Close', exact: true }).click();
  if (key) await choose(key);
  await page.keyboard.press('Escape');
}

async function runCount(page: Page) {
  return (await combatAnalysisWorkers(page)).messages.filter(message => message === 'run').length;
}

async function download(page: Page) {
  await expect(result(page)).toBeVisible();
  const pending = page.waitForEvent('download');
  await result(page).getByRole('button', { name: '下载出装比较档案', exact: true }).click();
  const path = await (await pending).path();
  return JSON.parse(readFileSync(path!, 'utf8')) as FrozenComparison;
}

test('一键计算并比较纯属性与被动换装，A 结果可复用', async ({ page }) => {
  const diagnostics = await open(page);
  await expect(page.getByRole('button', { name: '准备计算', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('观察时长（毫秒）', { exact: true })).toHaveValue('30000');
  await expect(page.getByLabel('攻速输入上界', { exact: true })).toHaveValue('10');
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('800');
  await equip(page, 'A', healthItem);
  await start(page).click();
  await expect(continuous(page)).toContainText('完整观察，目标未被击杀');
  expect(await runCount(page)).toBe(1);
  await expect(page.getByRole('region', { name: '必要属性', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '复制为方案 B 比较' }).click();
  await compare(page).click();
  const identical = await download(page);
  expect(identical.a.cleanup).toBe('released');
  expect(identical.b.cleanup).toBe('released');
  expect(identical.a.initialHealth).toEqual({ source: 800, target: 590 });
  expect(identical.assessment.metrics.every(row => row.delta === 0 || row.delta === null)).toBe(true);
  expect(identical.assessment.sources.every(row => row.kind === 'paired' && row.delta === 0)).toBe(true);
  expect(await runCount(page)).toBe(2);
  expect(identical.a.runResult!.summary.sourceDamageDealt).toBeCloseTo(60 * 1.5 * 100 / 121, 9);

  await equip(page, 'B', damageItem, healthItem);
  await expect(result(page)).toHaveCount(0);
  await expect(continuous(page)).toBeVisible();
  const before = diagnostics.snapshotReads;
  await compare(page).click();
  const attribute = await download(page);
  expect(diagnostics.snapshotReads - before).toBe(1);
  expect(await runCount(page)).toBe(3);
  expect(attribute.b.initialHealth.source).toBe(650);
  expect(attribute.b.runResult!.summary.sourceDamageDealt).toBeCloseTo(70 * 1.5 * 100 / 121, 9);
  expect(attribute.b.runResult!.summary.stopReason).toBe('duration_reached');
  expect(attribute.assessment.sources.map(row => row.kind)).toEqual(['paired']);

  await equip(page, 'A', damageItem, healthItem);
  await equip(page, 'B', passiveItem, damageItem);
  await compare(page).click();
  const passive = await download(page);
  expect(passive.a.runResult!.summary.sourceDamageDealt).toBeCloseTo(70 * 1.5 * 100 / 121, 9);
  expect(passive.b.runResult!.summary.sourceDamageDealt).toBeCloseTo((60 * 1.5 + 15) * 100 / 121, 9);
  expect(passive.assessment.sources.find(row => row.kind === 'only_b')?.amountB).toBeCloseTo(15 * 100 / 121, 9);
  expect(passive.assessment.sources.some(row => row.kind === 'paired')).toBe(true);
  await expect(result(page).getByRole('img', { name: /目标剩余生命.*采样图/ })).toBeVisible();
  await setCombatAnalysisCheckbox(page, '记录时间序列', false);
  await expect(result(page)).toHaveCount(0);
  await expect(continuous(page)).toContainText('上一份冻结输入的结果');
  diagnostics.assertClean();
});

test('只有 B 缺少属性或手填生命越界时，双方案都先暂停等待补值', async ({ page }) => {
  const diagnostics = await open(page, true);
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('800');
  await equip(page, 'A', healthItem);
  await page.getByRole('button', { name: '复制为方案 B 比较' }).click();
  await equip(page, 'B', passiveItem, healthItem);
  await chooseCombatAnalysisOption(page, '初始生命规则', '手动指定初始当前生命');
  await page.getByLabel('攻击方初始当前生命', { exact: true }).fill('700');
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('590');
  await compare(page).click();
  await expect(page.getByRole('alert').filter({ hasText: '方案 B：攻击方补充属性' })).toContainText('方案 B：攻击方初始当前生命');
  expect(await runCount(page)).toBe(0);
  const missing = page.getByLabel('攻击方补充属性 attack_speed_ratio', { exact: true });
  await expect(missing).toHaveValue('');
  await missing.fill('1');
  await chooseCombatAnalysisOption(page, '初始生命规则', '双方各自按面板满血开始');
  await compare(page).click();
  const completed = await download(page);
  expect(completed.a.attributeInputs.source).toEqual({});
  expect(completed.b.attributeInputs.source).toEqual({ attack_speed_ratio: 1 });
  expect(completed.assessment.stopCategory).toBe('both_full_duration');
  expect(await runCount(page)).toBe(2);
  diagnostics.assertClean();
});

test('取消目录刷新可立即重试，取消只重算 B 保留 A 且迟到结果不回写', async ({ page }) => {
  const diagnostics = await open(page);
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('800');
  await equip(page, 'A', damageItem);
  const held = diagnostics.holdNextAvailability();
  await start(page).click();
  await held.started;
  await page.getByRole('button', { name: '取消当前请求', exact: true }).click();
  await expect(start(page)).toBeEnabled();
  await start(page).click();
  await expect(continuous(page)).toBeVisible();
  held.release();

  await page.getByRole('button', { name: '复制为方案 B 比较' }).click();
  await equip(page, 'B', passiveItem, damageItem);
  await holdNextCombatAnalysisResult(page);
  await compare(page).click();
  await waitForHeldCombatAnalysis(page);
  await page.getByRole('button', { name: '取消当前请求', exact: true }).click();
  await expect(compare(page)).toBeEnabled();
  await expect(continuous(page)).toBeVisible();
  await expect(continuous(page)).not.toContainText('上一份冻结输入的结果');
  await expect(result(page)).toHaveCount(0);
  await resumeCombatAnalysis(page);
  await compare(page).click();
  const final = await download(page);
  expect(final.b.cleanup).toBe('released');
  expect(final.assessment.stopCategory).toBe('both_full_duration');
  expect(await runCount(page)).toBe(3);

  const sync = page.getByRole('button', { name: '同步方案 A 装备', exact: true });
  const oldB = page.getByText('方案 B 已有结果', { exact: true });
  await sync.click();
  await expect(oldB).toHaveCount(0);
  await compare(page).click();
  const matching = await download(page);
  expect(matching.b.snapshot.selection.sourceEquipmentKeys).toEqual(matching.a.snapshot.selection.sourceEquipmentKeys);
  await sync.click();
  await expect(result(page)).toHaveCount(0);
  await expect(oldB).toBeVisible();

  await holdNextCombatAnalysisResult(page);
  await compare(page).click();
  await waitForHeldCombatAnalysis(page);
  expect(await runCount(page)).toBe(5);
  await page.getByRole('button', { name: '取消当前请求', exact: true }).click();
  await expect(result(page)).toHaveCount(0);
  const retained = page.locator('details').filter({ has: oldB });
  await oldB.click();
  await expect(retained.getByRole('region', { name: '连续普攻结果', exact: true })).toBeVisible();
  await resumeCombatAnalysis(page);
  await expect(result(page)).toHaveCount(0);
  diagnostics.assertClean();
});


test('共有装备的关闭设置随持有方双向移交', async ({ page }) => {
  const diagnostics = await open(page);
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('800');
  await equip(page, 'A', passiveItem);
  await page.getByRole('button', { name: '复制为方案 B 比较' }).click();
  await compare(page).click();
  await expect(result(page)).toBeVisible();
  const attacker = page.getByRole('region', { name: '攻击方配置', exact: true });
  await attacker.locator('summary').filter({ hasText: '构筑与其他来源' }).click();
  const passive = '攻击方来源 ["EQUIPMENT","item_1043","item_1043_passive"] 开启';
  await setCombatAnalysisCheckbox(page, passive, false);
  await expect(result(page)).toHaveCount(0);
  await compare(page).click();
  const disabledBoth = await download(page);
  const disabled = { origin: { kind: 'EQUIPMENT', equipmentKey: passiveItem }, skillKey: 'item_1043_passive', enabled: false };
  expect(disabledBoth.a.snapshot.selection.sourceSkillSettings).toContainEqual(disabled);
  expect(disabledBoth.b.snapshot.selection.sourceSkillSettings).toContainEqual(disabled);

  await equip(page, 'A', null, passiveItem);
  await expect(page.getByRole('checkbox', {
    name: '方案 B 攻击方来源 ["EQUIPMENT","item_1043","item_1043_passive"] 开启', exact: true
  })).not.toBeChecked();
  await expect(page.getByText('方案 B 已有结果', { exact: true })).toBeVisible();
  await compare(page).click();
  expect((await download(page)).b.snapshot.selection.sourceSkillSettings).toContainEqual(disabled);

  await equip(page, 'A', passiveItem);
  await expect(page.getByRole('checkbox', { name: passive, exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: '同步方案 A 装备', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: passive, exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: '关闭方案 B', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: passive, exact: true })).not.toBeChecked();
  await setCombatAnalysisCheckbox(page, passive, true);
  await page.getByRole('button', { name: '复制为方案 B 比较', exact: true }).click();
  await expect(page.getByText('方案 B 已有结果', { exact: true })).toHaveCount(0);
  await setCombatAnalysisCheckbox(page, passive, false);
  await compare(page).click();
  expect((await download(page)).a.snapshot.selection.sourceSkillSettings).toContainEqual(disabled);
  const before = await runCount(page);
  await equip(page, 'B', null, passiveItem);
  await compare(page).click();
  expect((await download(page)).a.snapshot.selection.sourceSkillSettings).toContainEqual(disabled);
  expect(await runCount(page)).toBe(before + 1);
  await page.getByRole('button', { name: '关闭方案 B', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: passive, exact: true })).not.toBeChecked();
  await expect(continuous(page)).not.toContainText('已过期');
  diagnostics.assertClean();
});


test('B 装备平加越界会在任一正式运行前报告', async ({ page }) => {
  const diagnostics = await open(page, false, 65);
  await page.getByRole('button', { name: '复制为方案 B 比较' }).click();
  await equip(page, 'B', damageItem);
  await compare(page).click();
  await expect(page.getByRole('alert').filter({ hasText: '装备平加后的属性违反真实范围' }))
    .toContainText('方案 B：攻击方属性');
  expect(await runCount(page)).toBe(0);
  await expect(result(page)).toHaveCount(0);
  diagnostics.assertClean();
});

test('方案 A 的目录摘要变化后，比较重新运行 A 和 B', async ({ page }) => {
  const diagnostics = await open(page);
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('800');
  await equip(page, 'A', healthItem);
  await start(page).click();
  await expect(continuous(page)).toBeVisible();
  expect(await runCount(page)).toBe(1);

  await page.getByRole('button', { name: '复制为方案 B 比较' }).click();
  await equip(page, 'B', damageItem, healthItem);
  const directory = simulationAvailabilitySample(sample([healthItem, damageItem, passiveItem]));
  directory.characters[0]!.contentDigest = 'f'.repeat(64);
  diagnostics.setAvailability(directory);

  const reads = diagnostics.snapshotReads;
  await compare(page).click();
  const archive = await download(page);
  expect(await runCount(page)).toBe(3);
  expect(diagnostics.snapshotReads - reads).toBe(2);
  expect(archive.a.cleanup).toBe('released');
  expect(archive.b.cleanup).toBe('released');
  diagnostics.assertClean();
});
