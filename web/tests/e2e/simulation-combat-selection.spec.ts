import { expect, test } from '@playwright/test';
import type { SimulationSelection, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { combatAnalysisSample, installCombatAnalysisApi, openCombatAnalysisPage } from '../fixtures/combatAnalysisPage';
import { chooseSimulationEntity, chooseSimulationLevel } from '../fixtures/simulationSelection';

test('角色新增已排除技能挂载时重新读取并保留条件，可直接重试', async ({ page }) => {
  // 沿用现有场景范围中的盖伦被动身份，技能内容仍为独立合成样例。
  const sample = combatAnalysisSample();
  const snapshot = JSON.parse(JSON.stringify(sample).replaceAll(`"${sample.gameId}"`, '"lol"')
    .replaceAll('actor_a', 'champion_garen').replaceAll('sample_second', 'garen_p')) as SimulationSnapshot;
  const relation = snapshot.source.attachedSkills.find(row => row.skillKey === 'garen_p')!;
  snapshot.source.attachedSkills = snapshot.source.attachedSkills.filter(row => row.skillKey !== 'garen_p');
  const diagnostics = await installCombatAnalysisApi(page, snapshot);
  await openCombatAnalysisPage(page);
  await chooseSimulationEntity(page, '攻击方角色', 'champion_garen');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'actor_b');
  await chooseSimulationLevel(page, '目标等级', 1);
  const excluded = page.getByRole('switch', { name: '攻击方技能 garen_p 启用', exact: true });
  const active = page.getByRole('switch', { name: '攻击方技能 sample_active 启用', exact: true });
  const duration = page.getByLabel('观察时长（毫秒）', { exact: true });
  const start = page.getByRole('button', { name: '开始计算', exact: true });
  await expect(active).toBeChecked();
  await expect(excluded).toHaveCount(0);
  await duration.fill('2600');
  snapshot.source.attachedSkills.push(relation);
  await start.click();
  await expect(page.getByRole('alert').filter({ hasText: '挂载已更新' })).toContainText('技能读取完成后可重试');
  expect(diagnostics.workerCount).toBe(0);
  await expect(excluded).toBeVisible();
  await expect(excluded).not.toBeChecked();
  await expect(excluded).toBeDisabled();
  await expect(page.getByRole('group', { name: '攻击方技能 garen_p', exact: true })).toContainText('脱战回复');
  await expect(active).toBeChecked();
  await expect(duration).toHaveValue('2600');
  const pending = page.waitForRequest('**/simulation-snapshot');
  await start.click();
  const selection = (await pending).postDataJSON() as SimulationSelection;
  expect(selection.sourceSkillSettings).toContainEqual(expect.objectContaining({ skillKey: 'garen_p', enabled: false }));
  expect(selection.plannedSkills.map(item => item.skillKey)).not.toContain('garen_p');
  await expect(page.getByRole('alert').filter({ hasText: /^计算完成。$/ })).toBeVisible();
  diagnostics.assertClean();
});
