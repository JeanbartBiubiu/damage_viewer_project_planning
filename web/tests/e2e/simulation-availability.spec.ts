import { expect, test, type Page } from '@playwright/test';
import { combatAnalysisWorkers, configureCombatAnalysisPage, installCombatAnalysisApi, openCombatAnalysisPage } from '../fixtures/combatAnalysisPage';
import { simulationAutomaticSample } from '../fixtures/simulationAutomaticSkills';
import { chooseSimulationEntity, chooseSimulationLevel } from '../fixtures/simulationSelection';
import { simulationAvailabilityEntry, simulationAvailabilitySample, unavailableSimulationEntry } from '../fixtures/simulationAvailability';

const runButton = (page: Page) => page.getByRole('button', { name: '开始计算', exact: true });

// READY 与核验引用完全为本专项独立构造；这些用例不证明真实英雄、装备或实库录入已经可用。
async function showOption(page: Page, label: string, key: string) {
  const select = page.locator(`.arco-select[aria-label="${label}"]`);
  await expect(select).not.toHaveClass(/arco-select-disabled/);
  await select.click();
  await select.locator('input').fill(key);
  const popup = page.locator(`#${await select.getAttribute('aria-controls')}`);
  const option = popup.getByRole('option').filter({ has: page.getByText(key, { exact: true }) });
  await expect(option).toHaveCount(1);
  return { select, popup, option };
}

test('独立可用目录：角色和装备只有READY可选，未就绪原因保留在选项', async ({ page }) => {
  const sample = simulationAutomaticSample(true);
  const availability = simulationAvailabilitySample(sample);
  availability.characters[1] = unavailableSimulationEntry(availability.characters[1]!, 'CONFIGURATION_INCOMPLETE',
    '独立目标缺少完整主动配置', 'skills.target_required.processes', 'sample_basic_attack');
  availability.equipment = [simulationAvailabilityEntry('fixture_ready_blade', { equipment: true }),
    unavailableSimulationEntry(simulationAvailabilityEntry('fixture_unready_blade', { equipment: true }), 'UNVERIFIED',
      '独立装备尚无完整运行证明', 'verification.evidenceRefs')];
  const equipmentCatalog = availability.equipment.map(item => ({ gameId: sample.gameId, equipmentKey: item.key,
    name: item.status === 'READY' ? '独立可选装备' : '独立未核验装备', description: null, createdAt: '', updatedAt: '' }));
  const diagnostics = await installCombatAnalysisApi(page, sample, { availability, equipmentCatalog });
  await openCombatAnalysisPage(page);
  const blockedTarget = await showOption(page, '目标角色', 'actor_b');
  await expect(blockedTarget.option).toHaveClass(/arco-select-option-disabled/);
  await expect(blockedTarget.option).toContainText('配置未完整：独立目标缺少完整主动配置');
  await blockedTarget.option.click();
  await expect(page.locator('.simulation-level-select[aria-label="目标等级"]')).toHaveClass(/arco-select-disabled/);
  await page.keyboard.press('Escape');
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  const blockedEquipment = await showOption(page, '攻击方装备', 'fixture_unready_blade');
  await expect(blockedEquipment.option).toHaveClass(/arco-select-option(?:-wrapper)?-disabled/);
  await expect(blockedEquipment.option).toContainText('完整计算待核验：独立装备尚无完整运行证明');
  await blockedEquipment.option.click();
  await expect(blockedEquipment.option).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Escape');
  const allowedEquipment = await showOption(page, '攻击方装备', 'fixture_ready_blade');
  await expect(allowedEquipment.option).not.toHaveClass(/arco-select-option(?:-wrapper)?-disabled/);
  await allowedEquipment.option.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.simulation-equipment-select[aria-label="攻击方装备"]')).toContainText('独立可选装备');
  await expect(runButton(page)).toBeDisabled();
  expect(diagnostics.snapshotReads).toBe(0);
  expect(diagnostics.workerCount).toBe(0);
  diagnostics.assertClean(false);
});

test('独立可用目录：读取失败时没有可选角色，明确重试成功后才开放', async ({ page }) => {
  const diagnostics = await installCombatAnalysisApi(page);
  diagnostics.setAvailabilityUnavailable(true);
  await openCombatAnalysisPage(page);
  await expect(page.getByRole('alert').filter({ hasText: '计算可用目录读取失败' })).toContainText('独立构造目录暂时不可用');
  const failedOption = await showOption(page, '攻击方角色', 'actor_a');
  await expect(failedOption.option).toHaveClass(/arco-select-option-disabled/);
  await expect(failedOption.option).toContainText('计算可用性目录读取失败，请重试');
  await failedOption.option.click();
  await expect(page.locator('.simulation-level-select[aria-label="攻击方等级"]')).toHaveClass(/arco-select-disabled/);
  await page.keyboard.press('Escape');
  await expect(runButton(page)).toBeDisabled();
  const reads = diagnostics.availabilityReads;
  diagnostics.setAvailabilityUnavailable(false);
  await page.getByRole('button', { name: '重试计算可用目录', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '计算可用目录读取失败' })).toHaveCount(0);
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await expect(page.getByRole('switch', { name: '攻击方技能 sample_active 启用', exact: true })).toBeChecked();
  expect(diagnostics.availabilityReads).toBe(reads + 1);
  expect(diagnostics.snapshotReads).toBe(0);
  expect(diagnostics.workerCount).toBe(0);
  diagnostics.assertClean(false);
});

test('独立可用目录：开始计算时重读发现角色未就绪，阻断快照与 Worker 并保留选择草稿', async ({ page }) => {
  const sample = simulationAutomaticSample(true);
  const diagnostics = await installCombatAnalysisApi(page, sample);
  await openCombatAnalysisPage(page);
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'actor_b');
  await chooseSimulationLevel(page, '目标等级', 1);
  const start = runButton(page);
  await expect(start).toBeEnabled();
  const changed = simulationAvailabilitySample(sample);
  changed.characters[0] = unavailableSimulationEntry(changed.characters[0]!, 'UNVERIFIED', '独立作者摘要已改变，整英雄证明失效');
  diagnostics.setAvailability(changed);
  const reads = diagnostics.availabilityReads;
  await start.click();
  await expect(page.getByRole('alert', { name: '场景配置问题', exact: true })).toContainText('独立作者摘要已改变，整英雄证明失效');
  await expect(start).toBeDisabled();
  await expect(page.locator('.simulation-entity-select[aria-label="攻击方角色"]')).toContainText('样例A');
  await expect(page.locator('.simulation-level-select[aria-label="攻击方等级"]')).toContainText('1');
  await expect(page.getByRole('switch', { name: '攻击方技能 sample_active 启用', exact: true })).toBeChecked();
  expect(diagnostics.availabilityReads).toBe(reads + 1);
  expect(diagnostics.snapshotReads).toBe(0);
  expect(diagnostics.workerCount).toBe(0);
  diagnostics.assertClean(false);
});

test('独立可用目录：取消读取后可立即重试，目标未就绪时阻断运行并保留计算条件', async ({ page }) => {
  const sample = simulationAutomaticSample(true);
  const diagnostics = await installCombatAnalysisApi(page, sample);
  await configureCombatAnalysisPage(page);
  const beforeWorkers = await combatAnalysisWorkers(page);
  const snapshots = diagnostics.snapshotReads;
  const reads = diagnostics.availabilityReads;
  const changed = simulationAvailabilitySample(sample);
  changed.characters[1] = unavailableSimulationEntry(changed.characters[1]!, 'ENGINE_UNSUPPORTED', '独立目标新增未支持机制');
  const held = diagnostics.holdNextAvailability();
  const problems = page.getByRole('alert', { name: '场景配置问题', exact: true });
  try {
    await runButton(page).click();
    await held.started;
    await page.getByRole('button', { name: '取消当前请求', exact: true }).click();
    await expect(runButton(page)).toBeEnabled();
    diagnostics.setAvailability(changed);
    await runButton(page).click();
    await expect(problems).toContainText('独立目标新增未支持机制');
  } finally {
    held.release();
  }
  await expect(problems).toContainText('独立目标新增未支持机制');
  await expect(runButton(page)).toBeDisabled();
  await expect(page.getByLabel('攻击方初始当前生命', { exact: true })).toHaveValue('300');
  await expect(page.getByLabel('目标初始当前生命', { exact: true })).toHaveValue('5000');
  await expect(page.getByLabel('观察时长（毫秒）', { exact: true })).toHaveValue('2600');
  await expect(page.getByRole('switch', { name: '攻击方技能 sample_active 启用', exact: true })).toBeChecked();
  expect(diagnostics.availabilityReads).toBe(reads + 2);
  expect(diagnostics.snapshotReads).toBe(snapshots);
  const afterWorkers = await combatAnalysisWorkers(page);
  expect(afterWorkers.messages.filter(type => type === 'compile' || type === 'run'))
    .toEqual(beforeWorkers.messages.filter(type => type === 'compile' || type === 'run'));
  diagnostics.assertClean(false);
});

test('独立可用目录：已批准排除的来源自动关闭并锁定原因，必需技能保持开启', async ({ page }) => {
  const sample = simulationAutomaticSample(true);
  const availability = simulationAvailabilitySample(sample);
  const source = availability.characters.find(entry => entry.key === 'actor_a')!;
  source.excludedSkillSources = [{ skillKey: 'sample_second', reason: '独立构造：本轮明确排除的非必需来源' }];
  source.verification.requiredCoverage!.skills = source.verification.requiredCoverage!.skills.filter(skill => skill.skillKey !== 'sample_second');
  const diagnostics = await installCombatAnalysisApi(page, sample, { availability });
  await openCombatAnalysisPage(page);
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  const excluded = page.getByRole('switch', { name: '攻击方技能 sample_second 启用', exact: true });
  await expect(excluded).not.toBeChecked();
  await expect(excluded).toBeDisabled();
  await expect(page.getByRole('group', { name: '攻击方技能 sample_second', exact: true })).toContainText('独立构造：本轮明确排除的非必需来源');
  await expect(page.getByRole('switch', { name: '攻击方技能 sample_active 启用', exact: true })).toBeChecked();
  await expect(page.getByRole('switch', { name: '攻击方技能 sample_active 启用', exact: true })).toBeEnabled();
  await expect(page.getByRole('switch', { name: '攻击方技能 sample_basic_attack 启用', exact: true })).toBeChecked();
  expect(diagnostics.snapshotReads).toBe(0);
  expect(diagnostics.workerCount).toBe(0);
  diagnostics.assertClean(false);
});
