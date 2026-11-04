import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { simulationSkillSourceIdentity } from '../../src/services/simulationSkillSourceIdentity';
import type { SimulationSelection, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { isolatedSimulationSelection, syncSimulationSkillSources } from './simulationSkillSources';

export function simulationSnapshotWithSelection(snapshot: SimulationSnapshot, selection: SimulationSelection): SimulationSnapshot {
  const selected = structuredClone(snapshot);
  selected.selection = selection;
  return syncSimulationSkillSources(selected);
}

export function simulationComparisonSelection(patch: Partial<SimulationSelection> = {}): SimulationSelection {
  return { sourceCharacterKey: 'champion_aatrox', sourceLevel: 1, targetCharacterKey: 'champion_ahri', targetLevel: 1,
    basicAttackSkillKey: 'shared_basic_attack', basicAttackLevel: 1, plannedSkills: [], sourceEquipmentKeys: [], targetEquipmentKeys: [],
    sourceBuildConfigurations: [], targetBuildConfigurations: [], sourceSkillSettings: [], targetSkillSettings: [], ...patch };
}

export async function readIsolatedSimulationSnapshot(request: APIRequestContext, apiBase: string, selection: SimulationSelection,
  gameId = 'lol'): Promise<{ snapshot: SimulationSnapshot; response: APIResponse; path: string }> {
  const path = `/api/admin/games/${encodeURIComponent(gameId)}/simulation-snapshot`;
  const candidateResponse = await request.post(apiBase + path, { data: selection });
  expect(candidateResponse.status(), '真实默认来源候选POST').toBe(200);
  const candidate = await candidateResponse.json() as SimulationSnapshot;
  const response = await request.post(apiBase + path, { data: isolatedSimulationSelection(candidate) });
  expect(response.status(), '显式关闭附加英雄来源的真实快照POST').toBe(200);
  const snapshot = await response.json() as SimulationSnapshot;
  assertIsolatedCharacterSources(snapshot);
  return { snapshot, response, path };
}

export function assertIsolatedCharacterSources(snapshot: SimulationSnapshot): void {
  for (const side of ['source', 'target'] as const) {
    for (const source of snapshot[side].skillSources) {
      if (source.origin.kind !== 'CHARACTER') {
        expect(source.enabled, '隔离不关闭装备或构筑默认授予').toBe(true);
      } else if (side === 'source' && source.skillKey === snapshot.selection.basicAttackSkillKey) {
        expect(source.enabled, '实际普攻来源保持开启').toBe(true);
      } else if (source.skillStatus === 'DISABLED') {
        expect(source.inactiveReason).toBe('GLOBAL_DISABLED');
      } else {
        expect(source.enabled, `隔离英雄来源 ${side} ${simulationSkillSourceIdentity(source.origin, source.skillKey)}`).toBe(false);
        expect(snapshot.selection[`${side}SkillSettings`]).toContainEqual({ origin: source.origin, skillKey: source.skillKey, enabled: false });
      }
    }
  }
}

export async function expectSimulationConfigurationReady(page: Page): Promise<void> {
  await expect(page.locator('section[aria-label="场景快照"]')).toHaveCount(1);
  await expect(page.getByText('配置版本', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认最新技能配置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /^声明施法成本 / })).toHaveCount(0);
}

export async function isolateCharacterSourcesOnPage(page: Page, snapshot: SimulationSnapshot): Promise<void> {
  for (const side of ['source', 'target'] as const) {
    for (const source of snapshot[side].skillSources.filter(item => item.origin.kind === 'CHARACTER'
      && !(side === 'source' && item.skillKey === snapshot.selection.basicAttackSkillKey) && item.skillStatus === 'ENABLED')) {
      const checkbox = page.getByRole('checkbox', { name: `${side === 'source' ? '攻击方' : '目标'}来源 ${simulationSkillSourceIdentity(source.origin, source.skillKey)} 开启`, exact: true });
      if (await checkbox.isChecked()) await checkbox.locator('xpath=ancestor::label').click();
    }
  }
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expectSimulationConfigurationReady(page);
}
