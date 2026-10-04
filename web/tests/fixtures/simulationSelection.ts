import { expect, type Page } from '@playwright/test';
import { simulationSample } from './simulationSnapshot';

export async function chooseSimulationEntity(page: Page, label: string, key: string) {
  const select = page.locator(`.simulation-entity-select[aria-label="${label}"]`);
  await expect(select).not.toHaveClass(/arco-select-disabled/);
  await select.click();
  await select.locator('input').fill(key);
  const popup = page.locator(`#${await select.getAttribute('aria-controls')}`);
  await popup.getByRole('option').filter({ has: page.getByText(key, { exact: true }) }).click();
  await expect(popup).toBeHidden();
}

export async function chooseSimulationLevel(page: Page, label: string, level: number) {
  const select = page.locator(`.simulation-level-select[aria-label="${label}"]`);
  await expect(select).not.toHaveClass(/arco-select-disabled/);
  await select.click();
  const popup = page.locator(`#${await select.getAttribute('aria-controls')}`);
  await popup.getByRole('option', { name: String(level), exact: true }).click();
  await expect(popup).toBeHidden();
}

/** 只替换目录只读接口，场景读取与真实 Wasm 仍由各专项单独验证。 */
export async function installSimulationSelectionApi(page: Page, api: string, gameId: string, selectionSample?: ReturnType<typeof simulationSample>) {
  const sample = selectionSample ?? simulationSample();
  const sourceKey = selectionSample || gameId === 'demo' ? sample.selection.sourceCharacterKey : 'source_sample';
  const targetKey = selectionSample || gameId === 'demo' ? sample.selection.targetCharacterKey : 'target_sample';
  const skillKey = selectionSample || gameId === 'demo' ? sample.selection.basicAttackSkillKey : 'shared_basic_attack';
  await page.route(`${api}/api/admin/games/${gameId}/level-config`, route => route.fulfill({ json: {
    ...sample.catalogs.levelConfig, gameId
  } }));
  const characters = [sourceKey, targetKey].map((characterKey, index) => ({
    gameId, characterKey, name: index ? '目标角色' : '攻击方角色', description: null, createdAt: '', updatedAt: ''
  }));
  await page.route(`${api}/api/admin/games/${gameId}/characters`, route => route.fulfill({ json: { items: characters, total: 2 } }));
  await page.route(`${api}/api/admin/games/${gameId}/equipment`, route => route.fulfill({ json: { items: [], total: 0 } }));
  await page.route(`${api}/api/admin/games/${gameId}/character-skill-relations?**`, route => route.fulfill({ json: {
    items: [{ gameId, characterKey: sourceKey, characterName: '攻击方角色', skillKey, skillName: '普通攻击·共享', skillStatus: 'ENABLED', sortOrder: 0 }], total: 1
  } }));
  await page.route(`${api}/api/admin/games/${gameId}/skills/${skillKey}`, route => route.fulfill({ json: {
    ...sample.skillConfigurations[0]!.skill, gameId, skillKey, name: '普通攻击·共享'
  } }));
  await page.route(`${api}/api/admin/games/${gameId}/**/representative-image`, route => route.fulfill({ json: { image: null } }));
}
