import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chooseSimulationEntity, chooseSimulationLevel, installSimulationSelectionApi } from '../fixtures/simulationSelection';
import { simulationDefaultSourcesSample, simulationSample } from '../fixtures/simulationSnapshot';
import { simulationSkillSourceIdentity } from '../../src/services/simulationSkillSourceIdentity';
import type { SimulationSelection, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import type { BuildDefinition } from '../../src/types/build';
import { equipmentSimulationSample } from '../fixtures/simulationEquipment';
import { permanentEquipmentSimulationSample } from '../fixtures/simulationPermanentEquipment';
import { triggeredEquipmentSimulationSample } from '../fixtures/simulationTriggeredEquipment';
import { isolatedSimulationSelection, syncSimulationSkillSources } from '../fixtures/simulationSkillSources';
import { validateSimulationSnapshot } from '../../src/services/simulationSnapshotClient';
import { SKILL_TRIGGER_EVENT_TYPE_LABELS } from '../../src/types/skillSystemEnums.generated';

test.use({ trace: 'off' });

test('系统枚举专项：模拟来源初始化使用完整公共中文标签', async ({ page }) => {
  const sample = simulationDefaultSourcesSample();
  // 仅检查明确初始化入口的来源显示；保持已有准入失败样例，不证明编译或运行。
  sample.skillConfigurations[0]!.triggerRules.unshift({
    ...structuredClone(sample.skillConfigurations[0]!.triggerRules[0]!),
    ruleKey: 'initialize_display', name: '初始化显示', eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }
  });
  sample.skillConfigurations[0]!.processes = [];
  const diagnostics = await installSnapshotStructureApi(page, sample);
  await selectStructureScene(page);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  const sources = page.getByRole('region', { name: '攻击方角色技能来源', exact: true });
  await expect(sources).toContainText(SKILL_TRIGGER_EVENT_TYPE_LABELS.SOURCE_INITIALIZED);
  await expect(sources).not.toContainText('角色初始化');
  diagnostics.assertClean();
});

test('5A测试样例同步：装备默认来源完整、双方独立，关闭英雄不丢关系或固定属性', () => {
  const samples = [equipmentSimulationSample(['item_1042'], ['item_1036']),
    permanentEquipmentSimulationSample(['item_3065', 'item_3110'], ['item_3065', 'item_3110']),
    triggeredEquipmentSimulationSample(['item_1043'], ['item_1043'])];
  for (const snapshot of samples) {
    expect(validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection)).toBe(snapshot);
    const firstManifest = structuredClone([snapshot.source.skillSources, snapshot.target.skillSources]);
    syncSimulationSkillSources(snapshot);
    expect([snapshot.source.skillSources, snapshot.target.skillSources]).toEqual(firstManifest);
    for (const side of ['source', 'target'] as const) {
      const relations = snapshot[side].selectedEquipment.flatMap(item => item.attachedSkills);
      const equipmentSources = snapshot[side].skillSources.filter(source => source.origin.kind === 'EQUIPMENT');
      expect(equipmentSources).toHaveLength(relations.length);
      expect(equipmentSources.every(source => source.enabled && source.skillLevel === 1)).toBe(true);
    }
    const before = structuredClone({ source: snapshot.source.attachedSkills, target: snapshot.target.attachedSkills,
      equipment: snapshot.source.selectedEquipment });
    snapshot.selection = isolatedSimulationSelection(snapshot);
    syncSimulationSkillSources(snapshot);
    expect(validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection)).toBe(snapshot);
    expect(snapshot.source.attachedSkills).toEqual(before.source);
    expect(snapshot.target.attachedSkills).toEqual(before.target);
    expect(snapshot.source.selectedEquipment).toEqual(before.equipment);
    expect(snapshot.target.skillSources.filter(source => source.origin.kind === 'CHARACTER').every(source => !source.enabled)).toBe(true);
    expect(snapshot.source.skillSources.find(source => source.origin.kind === 'CHARACTER' && source.skillKey === snapshot.selection.basicAttackSkillKey)!.enabled).toBe(true);
  }
  const defaults = simulationDefaultSourcesSample();
  defaults.selection = isolatedSimulationSelection(defaults);
  syncSimulationSkillSources(defaults);
  expect(validateSimulationSnapshot(defaults, defaults.gameId, defaults.selection)).toBe(defaults);
  expect(defaults.selection.sourceSkillSettings).toEqual([{ origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey: 'sample_natural', enabled: false }]);
  expect(defaults.source.skillSources.filter(source => source.origin.kind === 'BUILD_OPTION').every(source => source.enabled)).toBe(true);
  expect(defaults.source.skillSources.find(source => source.skillKey === 'sample_disabled')).toMatchObject({ enabled: true, inactiveReason: 'GLOBAL_DISABLED' });
});

const API = 'http://127.0.0.1:19106';
const TOKEN = 'selection-fixture-only';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=';
const select = (page: Page, label: string) => page.locator(`.simulation-entity-select[aria-label="${label}"]`);
const levelSelect = (page: Page, label: string) => page.locator(`.simulation-level-select[aria-label="${label}"]`);
const options = (page: Page) => page.locator('.arco-select-option:visible');

async function installApi(page: Page) {
  const reads: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ api, token }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', token);
  }, { api: API, token: TOKEN });
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    expect(request.method(), '选择框不得写入管理数据').toBe('GET');
    const url = new URL(request.url());
    reads.push(`${url.pathname}${url.search}`);
    const reply = (data: unknown) => route.fulfill({ json: data });
    if (url.pathname === '/api/games') return reply([
      { gameId: 'demo', gameName: '下拉测试', representativeImageKey: null },
      { gameId: 'other', gameName: '其他游戏', representativeImageKey: null }
    ]);
    expect(request.headers().authorization).toBe(`Bearer ${TOKEN}`);
    const resource = url.pathname.replace(/^\/api\/admin\/games\/[^/]+\//, '');
    const gameId = url.pathname.split('/')[4]!;
    if (resource === 'calculation-rules') return reply(simulationSample(gameId).catalogs.calculationRules);
    if (resource === 'skill-categories') {
      const items = simulationSample(gameId).catalogs.skillCategories;
      return reply({ items, total: items.length });
    }
    if (resource === 'level-config') return reply({ gameId, minLevel: 1, maxLevel: 18 });
    if (resource === 'equipment') return reply({ items: [], total: 0 });
    if (resource === 'build-systems') return reply({ items: [], total: 0 });
    if (resource === 'characters') {
      const items = [
        { characterKey: 'hero_alpha', name: gameId === 'demo' ? '英雄甲' : '其他甲' },
        { characterKey: 'hero_beta', name: gameId === 'demo' ? '英雄乙' : '其他乙' },
        ...Array.from({ length: 60 }, (_, index) => ({ characterKey: `extra_${index}`, name: `候选角色${index}` }))
      ].map(row => ({ ...row, gameId, description: null, createdAt: '', updatedAt: '' }));
      return reply({ items, total: items.length });
    }
    if (resource === 'character-skill-relations') {
      const characterKey = url.searchParams.get('characterKey')!;
      const keys = characterKey === 'hero_alpha' ? ['attack_alpha', 'spell', 'disabled'] : ['attack_beta'];
      const items = keys.map((skillKey, index) => ({ gameId, characterKey, characterName: '英雄', skillKey,
        skillName: skillKey, skillStatus: skillKey === 'disabled' ? 'DISABLED' : 'ENABLED', sortOrder: index }));
      return reply({ items, total: items.length });
    }
    if (/^skills\/[^/]+$/.test(resource)) {
      const skillKey = resource.split('/')[1]!;
      return reply({ gameId, skillKey, name: skillKey === 'spell' ? '主动技能' : `普通攻击${skillKey === 'attack_alpha' ? '甲' : '乙'}`,
        description: null, maxLevel: 1, status: 'ENABLED', sortOrder: 0,
        skillCategoryKeys: [skillKey === 'spell' ? 'active' : 'basic_attack'], createdAt: '', updatedAt: '' });
    }
    if (resource.endsWith('representative-image')) {
      const key = resource.split('/')[1];
      return reply({ image: key?.startsWith('hero_') || key?.startsWith('attack_')
        ? { imageKey: `${key}_portrait`, name: '图标', enabled: true } : null });
    }
    if (/^images\/[^/]+$/.test(resource)) return reply({
      gameId, imageKey: resource.split('/')[1], name: '图标', description: null, imageBase64: PNG,
      mimeType: 'image/png', byteSize: 68, width: 1, height: 1, enabled: true,
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z'
    });
    throw new Error(`未定义只读接口 ${resource}`);
  });
  return { reads, assertClean: () => expect(errors).toEqual([]) };
}

test('双方配置桌面各一栏，普攻归攻击方，窄屏按整组排列且没有横向溢出', async ({ page }) => {
  const diagnostics = await installApi(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/#/simulation/basic-attack');
  const source = page.getByRole('region', { name: '攻击方配置', exact: true });
  const target = page.getByRole('region', { name: '目标方配置', exact: true });
  for (const label of ['攻击方角色', '攻击方等级', '普攻技能', '普攻技能等级', '攻击方装备']) {
    await expect(source.getByRole('combobox', { name: label, exact: true })).toBeVisible();
  }
  for (const label of ['目标角色', '目标等级', '目标装备']) {
    await expect(target.getByRole('combobox', { name: label, exact: true })).toBeVisible();
  }
  await expect(target.getByRole('combobox', { name: '普攻技能', exact: true })).toHaveCount(0);
  const sourceDesktop = await source.boundingBox();
  const targetDesktop = await target.boundingBox();
  expect(sourceDesktop).not.toBeNull();
  expect(targetDesktop).not.toBeNull();
  expect(sourceDesktop!.x + sourceDesktop!.width).toBeLessThanOrEqual(targetDesktop!.x);
  expect(sourceDesktop!.y).toBe(targetDesktop!.y);
  await page.setViewportSize({ width: 375, height: 1000 });
  const sourceMobile = await source.boundingBox();
  const targetMobile = await target.boundingBox();
  expect(sourceMobile).not.toBeNull();
  expect(targetMobile).not.toBeNull();
  expect(targetMobile!.y).toBeGreaterThanOrEqual(sourceMobile!.y + sourceMobile!.height);
  expect(targetMobile!.x).toBe(sourceMobile!.x);
  const widths = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
  diagnostics.assertClean();
});

async function installSnapshotStructureApi(page: Page, sample: SimulationSnapshot) {
  const requests: SimulationSelection[] = [];
  const errors: string[] = [];
  let candidate = sample;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ api, token }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', token);
  }, { api: API, token: TOKEN });
  await page.route(`${API}/api/games`, route => route.fulfill({ json: [{ gameId: sample.gameId, gameName: '独立来源结构', representativeImageKey: null }] }));
  await installSimulationSelectionApi(page, API, sample.gameId, sample);
  const definitions = [...sample.source.selectedBuilds, ...sample.target.selectedBuilds].map(build => build.definition);
  await page.route(`${API}/api/admin/games/${sample.gameId}/build-systems`, route => route.fulfill({ json: {
    items: definitions.map(definition => definition.system), total: definitions.length
  } }));
  for (const definition of definitions) await page.route(`${API}/api/admin/games/${sample.gameId}/build-systems/${definition.system.systemKey}/definition`,
    route => route.fulfill({ json: definition }));
  await page.route(`${API}/api/admin/games/${sample.gameId}/simulation-snapshot`, async route => {
    expect(route.request().method(), '独立接口结构用例：只读快照也必须使用POST').toBe('POST');
    const selection = route.request().postDataJSON() as SimulationSelection;
    requests.push(selection);
    const snapshot = structuredClone(candidate);
    snapshot.selection = selection;
    for (const side of ['source', 'target'] as const) {
      snapshot[side].selectedBuilds = snapshot[side].selectedBuilds.filter(build => selection[`${side}BuildConfigurations`].some(configuration => configuration.systemKey === build.configuration.systemKey));
      snapshot[side].skillSources = snapshot[side].skillSources.filter(source => {
        const origin = source.origin;
        return origin.kind !== 'BUILD_OPTION' || selection[`${side}BuildConfigurations`].some(configuration => configuration.systemKey === origin.systemKey
          && configuration.selections.some(item => item.roleKey === origin.roleKey && item.groupKey === origin.groupKey
            && item.slotKey === origin.slotKey && item.optionKey === origin.optionKey));
      });
      for (const source of snapshot[side].skillSources) {
        const setting = selection[`${side}SkillSettings`].find(item => simulationSkillSourceIdentity(item.origin, item.skillKey) === simulationSkillSourceIdentity(source.origin, source.skillKey));
        if (setting) {
          source.enabled = setting.enabled;
          if (setting.skillLevel !== undefined) source.skillLevel = setting.skillLevel;
          if (!setting.enabled) source.inactiveReason = 'SCENE_DISABLED';
          else if (source.skillLevel === 0) source.inactiveReason = 'UNLEARNED';
        }
      }
    }
    syncSimulationSkillSources(snapshot);
    snapshot.snapshotDigest = createHash('sha256').update(JSON.stringify([selection, snapshot.skillConfigurations.map(configuration => configuration.baseDigest)])).digest('hex');
    await route.fulfill({ json: snapshot });
  });
  return { requests, changeCandidate: (next: SimulationSnapshot) => { candidate = next; }, assertClean: () => expect(errors).toEqual([]) };
}

async function selectStructureScene(page: Page) {
  await page.goto('/#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await chooseSimulationEntity(page, '目标角色', 'actor_b');
  await chooseSimulationEntity(page, '普攻技能', 'sample_basic_attack');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationLevel(page, '目标等级', 1);
  await chooseSimulationLevel(page, '普攻技能等级', 1);
}

test('5A独立页面结构：准入失败仍可关闭原始来源，双方等级及全局停用不会串改', async ({ page }) => {
  const sample = simulationDefaultSourcesSample();
  sample.skillConfigurations[0]!.processes = [];
  const diagnostics = await installSnapshotStructureApi(page, sample);
  await selectStructureScene(page);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  const admissionError = page.getByRole('alert').filter({ hasText: '快照已读取，但编译准入检查未通过' });
  await expect(admissionError).toBeVisible();
  const selectionBounds = await page.getByRole('form', { name: '普攻场景选择', exact: true }).boundingBox();
  const errorBounds = await admissionError.boundingBox();
  expect(selectionBounds).not.toBeNull();
  expect(errorBounds).not.toBeNull();
  expect(errorBounds!.y).toBeGreaterThanOrEqual(selectionBounds!.y + selectionBounds!.height);
  const sourceOrigin = { kind: 'CHARACTER' as const, characterKey: 'actor_a' };
  const targetOrigin = { kind: 'CHARACTER' as const, characterKey: 'actor_b' };
  const sourceKey = simulationSkillSourceIdentity(sourceOrigin, 'sample_natural');
  const targetKey = simulationSkillSourceIdentity(targetOrigin, 'sample_natural');
  const sourceSwitch = page.getByRole('checkbox', { name: `攻击方来源 ${sourceKey} 开启`, exact: true });
  const targetSwitch = page.getByRole('checkbox', { name: `目标来源 ${targetKey} 开启`, exact: true });
  await expect(sourceSwitch).toBeChecked();
  await expect(targetSwitch).toBeChecked();
  const globalSwitch = page.getByRole('checkbox', { name: `攻击方来源 ${simulationSkillSourceIdentity(sourceOrigin, 'sample_disabled')} 开启`, exact: true });
  await expect(globalSwitch).toBeDisabled();
  await sourceSwitch.locator('xpath=ancestor::label').click();
  await expect(admissionError).toHaveCount(0);
  await expect(targetSwitch).toBeChecked();
  await expect(page.getByRole('region', { name: '场景快照', exact: true })).toHaveCount(0);
  const level = page.getByRole('combobox', { name: `攻击方来源 ${sourceKey} 等级`, exact: true });
  await expect(level).toContainText('3');
  await expect(page.getByRole('combobox', { name: `目标来源 ${targetKey} 等级`, exact: true })).toContainText('3');
  await level.click();
  await page.locator('.arco-select-option:visible').filter({ hasText: '0（未学）' }).click();
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expect(sourceSwitch).not.toBeChecked();
  const request = diagnostics.requests.at(-1)!;
  expect(request.sourceSkillSettings).toEqual([{ origin: sourceOrigin, skillKey: 'sample_natural', enabled: false, skillLevel: 0 }]);
  expect(request.targetSkillSettings).toContainEqual({ origin: targetOrigin, skillKey: 'sample_natural', enabled: true, skillLevel: 3 });
  expect(request.sourceBuildConfigurations).toEqual([]);
  await expect(page.getByRole('combobox', { name: `攻击方来源 ${simulationSkillSourceIdentity(sourceOrigin, 'sample_basic_attack')} 等级`, exact: true })).toHaveCount(0);
  for (const side of ['攻击方', '目标']) {
    const placeholder = page.getByRole('region', { name: `${side}额外技能与强化`, exact: true });
    await expect(placeholder).toContainText('未开放');
    await expect(placeholder.getByRole('combobox')).toHaveCount(0);
  }
  diagnostics.assertClean();
});

test('角色来源默认最高并写入实际快照，手动低等级、0及清空不被覆盖', async ({ page }) => {
  const diagnostics = await installSnapshotStructureApi(page, simulationDefaultSourcesSample());
  await selectStructureScene(page);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  const identity = simulationSkillSourceIdentity({ kind: 'CHARACTER', characterKey: 'actor_a' }, 'sample_natural');
  const level = page.getByRole('combobox', { name: `攻击方来源 ${identity} 等级`, exact: true });
  const setting = () => diagnostics.requests.at(-1)!.sourceSkillSettings.find(source => source.skillKey === 'sample_natural');
  await expect(level).toContainText('3');
  await expect(page.getByRole('button', { name: '读取场景快照', exact: true })).toBeEnabled();
  expect(setting()!.skillLevel).toBe(3);
  for (const rank of [1, 0]) {
    await level.click();
    await page.getByRole('option', { name: rank === 0 ? '0（未学）' : '1', exact: true }).click();
    await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
    await expect(page.getByRole('button', { name: '读取场景快照', exact: true })).toBeEnabled();
    expect(setting()!.skillLevel).toBe(rank);
  }
  await level.hover();
  await level.locator('.arco-select-clear-icon').click();
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expect(page.getByRole('button', { name: '读取场景快照', exact: true })).toBeEnabled();
  await expect(level).toContainText('需明确供值');
  expect(setting()!.skillLevel).toBeUndefined();
  diagnostics.assertClean();
});

test('5A独立页面结构：来源调整使快照失效，但生命及属性草稿保留且不删除关系', async ({ page }) => {
  const diagnostics = await installSnapshotStructureApi(page, simulationSample());
  await selectStructureScene(page);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await page.getByRole('spinbutton', { name: '攻击方初始当前生命', exact: true }).fill('600');
  await page.getByRole('spinbutton', { name: '目标初始当前生命', exact: true }).fill('500');
  await page.getByRole('spinbutton', { name: '攻击方补充属性 critical_strike_chance', exact: true }).fill('0.25');
  const identity = simulationSkillSourceIdentity({ kind: 'CHARACTER', characterKey: 'actor_b' }, 'sample_basic_attack');
  const sourceSwitch = page.getByRole('checkbox', { name: `目标来源 ${identity} 开启`, exact: true });
  await sourceSwitch.locator('xpath=ancestor::label').click();
  await expect(page.getByRole('region', { name: '场景快照', exact: true })).toHaveCount(0);
  await expect(sourceSwitch).not.toBeChecked();
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '攻击方初始当前生命', exact: true })).toHaveValue('600');
  await expect(page.getByRole('spinbutton', { name: '目标初始当前生命', exact: true })).toHaveValue('500');
  await expect(page.getByRole('spinbutton', { name: '攻击方补充属性 critical_strike_chance', exact: true })).toHaveValue('0.25');
  expect(diagnostics.requests.at(-1)!.targetSkillSettings).toEqual([{ origin: { kind: 'CHARACTER', characterKey: 'actor_b' }, skillKey: 'sample_basic_attack', enabled: false, skillLevel: 1 }]);
  await expect(page.getByRole('region', { name: '目标角色技能来源', exact: true })).toContainText('sample_basic_attack');
  diagnostics.assertClean();
});

test('5A独立页面结构：执行前重读摘要变化仅做公式预检，须确认后再提交场景', async ({ page }) => {
  const sample = simulationSample();
  const diagnostics = await installSnapshotStructureApi(page, sample);
  await page.addInitScript(() => {
    const scope = window as typeof window & { reconfirmPreflightMessages: Array<{ type: string; rulesHash: string | null }> };
    scope.reconfirmPreflightMessages = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...options) {
      if (message && typeof message === 'object' && ['compile', 'run', 'release'].includes(message.type)) {
        scope.reconfirmPreflightMessages.push({ type: message.type, rulesHash: message.request?.rulesHash ?? message.expectedRulesHash ?? null });
      }
      return Reflect.apply(original, this, [message, ...options]);
    };
  });
  await selectStructureScene(page);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  await expect(page.getByRole('button', { name: '编译验证', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '确认最新技能配置', exact: true }).click();
  await expect(page.getByRole('button', { name: '编译验证', exact: true })).toBeEnabled();
  const changed = structuredClone(sample);
  changed.skillConfigurations[0]!.baseDigest = 'independent_changed_same_rules';
  changed.skillConfigurations[0]!.parameters[0]!.fixedValue = 3;
  diagnostics.changeCandidate(changed);
  await page.getByRole('button', { name: '编译验证', exact: true }).click();
  await expect(page.getByText(/最新配置已完成共同公式预检，请核对并明确确认后重新执行本次场景/)).toBeVisible();
  await expect(page.getByRole('button', { name: '编译验证', exact: true })).toBeDisabled();
  await expect(page.getByRole('spinbutton', { name: '攻击方初始当前生命', exact: true })).toHaveValue('650');
  await expect(page.getByRole('spinbutton', { name: '攻击方补充属性 critical_strike_chance', exact: true })).toHaveValue('0');
  expect(diagnostics.requests).toHaveLength(3);
  const preflightMessages = await page.evaluate(() => (window as typeof window & {
    reconfirmPreflightMessages: Array<{ type: string; rulesHash: string | null }>
  }).reconfirmPreflightMessages);
  expect(preflightMessages, '只有已释放的公式预检，没有最终场景编译或运行').toEqual([
    { type: 'compile', rulesHash: 'skill-formula-preflight' }, { type: 'release', rulesHash: 'skill-formula-preflight' },
    { type: 'compile', rulesHash: 'skill-formula-preflight' }, { type: 'release', rulesHash: 'skill-formula-preflight' }
  ]);
  await page.getByRole('button', { name: '确认最新技能配置', exact: true }).click();
  await expect(page.getByRole('button', { name: '编译验证', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as typeof window & {
    reconfirmPreflightMessages: Array<{ type: string; rulesHash: string | null }>
  }).reconfirmPreflightMessages)).toEqual(preflightMessages);
  diagnostics.assertClean();
});

test('5A独立构筑结构：无默认推荐，同选项不同位置保留实例并分别关闭', async ({ page }) => {
  const sample = simulationDefaultSourcesSample();
  const diagnostics = await installSnapshotStructureApi(page, sample);
  await selectStructureScene(page);
  const builds = page.getByRole('combobox', { name: '攻击方构筑系统', exact: true });
  await expect(builds).not.toContainText('独立结构构筑');
  await builds.click();
  await page.locator('.arco-select-option:visible').filter({ hasText: '独立结构构筑' }).click();
  await builds.click();
  const groups = page.getByRole('combobox', { name: '攻击方独立结构构筑主要分组', exact: true });
  await expect(groups).not.toContainText('样例分组');
  await groups.click();
  await page.locator('.arco-select-option:visible').filter({ hasText: '样例分组' }).click();
  await groups.click();
  const section = page.getByRole('region', { name: '攻击方构筑 独立结构构筑', exact: true });
  await expect(page.getByRole('button', { name: '读取场景快照', exact: true })).toBeDisabled();
  for (const slot of ['first', 'second']) {
    const slotSection = section.locator('.simulation-build-slot').filter({ hasText: `／${slot}：` });
    await slotSection.getByRole('button', { name: '添加选择', exact: true }).click();
    await slotSection.getByRole('combobox').click();
    await page.locator('.arco-select-option:visible').filter({ hasText: '样例选项' }).click();
  }
  await page.getByRole('button', { name: '确认攻击方完整构筑', exact: true }).click();
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  const first = sample.source.skillSources.find(source => source.origin.kind === 'BUILD_OPTION' && source.origin.slotKey === 'first')!;
  const second = sample.source.skillSources.find(source => source.origin.kind === 'BUILD_OPTION' && source.origin.slotKey === 'second')!;
  const firstSwitch = page.getByRole('checkbox', { name: `攻击方来源 ${simulationSkillSourceIdentity(first.origin, first.skillKey)} 开启`, exact: true });
  const secondSwitch = page.getByRole('checkbox', { name: `攻击方来源 ${simulationSkillSourceIdentity(second.origin, second.skillKey)} 开启`, exact: true });
  await firstSwitch.locator('xpath=ancestor::label').click();
  await expect(secondSwitch).toBeChecked();
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  expect(diagnostics.requests.at(-1)!.sourceBuildConfigurations[0]!.selections).toHaveLength(2);
  expect(diagnostics.requests.at(-1)!.sourceSkillSettings.filter(setting => setting.origin.kind === 'BUILD_OPTION'))
    .toEqual([{ origin: first.origin, skillKey: first.skillKey, enabled: false }]);
  await expect(firstSwitch).not.toBeChecked();
  await expect(secondSwitch).toBeChecked();
  diagnostics.assertClean();
});

test('5A独立构筑结构：空分组角色规则不猜非空选择，也不宣称真实构筑已验收', async ({ page }) => {
  const sample = simulationDefaultSourcesSample();
  sample.source.selectedBuilds[0]!.definition.system.selectionRules.groupRoles = [];
  sample.source.selectedBuilds[0]!.configuration.groupAssignments = [];
  sample.source.selectedBuilds[0]!.configuration.selections = [];
  sample.source.skillSources = sample.source.skillSources.filter(source => source.origin.kind !== 'BUILD_OPTION');
  const diagnostics = await installSnapshotStructureApi(page, sample);
  await selectStructureScene(page);
  const builds = page.getByRole('combobox', { name: '攻击方构筑系统', exact: true });
  await builds.click();
  await page.locator('.arco-select-option:visible').filter({ hasText: '独立结构构筑' }).click();
  await builds.click();
  await expect(page.getByRole('button', { name: '添加选择', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '确认攻击方完整构筑', exact: true }).click();
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  expect(diagnostics.requests.at(-1)!.sourceBuildConfigurations[0]).toMatchObject({ groupAssignments: [], selections: [], budgets: {} });
  await expect(page.getByRole('region', { name: '攻击方构筑技能来源', exact: true })).toContainText('尚无此类来源');
  diagnostics.assertClean();
});

test('名称和标识均可搜索，候选与选中项带头像，普攻按挂载和分类筛选', async ({ page }) => {
  const diagnostics = await installApi(page);
  await page.goto('/#/simulation/basic-attack');
  await expect(select(page, '攻击方角色')).not.toHaveClass(/arco-select-disabled/);
  await select(page, '攻击方角色').click();
  await select(page, '攻击方角色').locator('input').fill('英雄甲');
  await expect(options(page)).toHaveCount(1);
  const avatar = options(page).getByRole('img', { name: '英雄甲', exact: true });
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
  await options(page).click();
  await expect(options(page)).toHaveCount(0);
  await expect(select(page, '攻击方角色').getByRole('img', { name: '英雄甲', exact: true })).toBeVisible();
  const rosterReads = diagnostics.reads.filter(path => path === '/api/admin/games/demo/characters').length;
  await chooseSimulationEntity(page, '目标角色', 'hero_beta');
  await select(page, '普攻技能').click();
  await expect(options(page)).toHaveCount(1);
  await expect(options(page)).toContainText('普通攻击甲');
  await expect(options(page).getByRole('img', { name: '普通攻击甲', exact: true })).toBeVisible();
  await options(page).click();
  await expect(options(page)).toHaveCount(0);
  await expect(select(page, '普攻技能').locator('img[alt]')).toBeVisible();
  await chooseSimulationLevel(page, '普攻技能等级', 1);
  await chooseSimulationEntity(page, '攻击方角色', 'hero_beta');
  await expect(select(page, '普攻技能')).not.toContainText('普通攻击甲');
  await expect(page.locator('.simulation-level-select[aria-label="普攻技能等级"]')).not.toContainText('1');
  await chooseSimulationEntity(page, '普攻技能', 'attack_beta');
  expect(diagnostics.reads.filter(path => path === '/api/admin/games/demo/characters')).toHaveLength(rosterReads);
  await select(page, '攻击方角色').hover();
  await select(page, '攻击方角色').locator('.arco-select-clear-icon').click();
  await expect(select(page, '普攻技能')).toHaveClass(/arco-select-disabled/);
  await expect(select(page, '攻击方角色')).not.toContainText('英雄乙');
  await select(page, '攻击方角色').click();
  await select(page, '攻击方角色').locator('input').fill(' HERO_ALPHA ');
  await expect(options(page)).toHaveCount(1);
  await select(page, '攻击方角色').locator('input').press('ArrowDown');
  await select(page, '攻击方角色').locator('input').press('Enter');
  await expect(select(page, '攻击方角色')).toContainText('英雄甲');
  expect(diagnostics.reads.some(path => /\/images$/.test(path))).toBe(false);
  expect(diagnostics.reads.some(path => /\/skills$/.test(path))).toBe(false);
  expect(diagnostics.reads.some(path => /\/skills\/disabled$/.test(path))).toBe(false);
  diagnostics.assertClean();
});

test.describe('真实只读目录', () => {
  test('真实角色头像与共享普攻由现有接口进入选择框，无全量图片读取', async ({ page }, testInfo) => {
    test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实服务检查需显式启用。');
    const api = process.env.SIMULATION_LIVE_API_BASE_URL || 'http://127.0.0.1:8080';
    const token = process.env.SIMULATION_LIVE_ADMIN_TOKEN || 'local-readonly-check';
    await page.addInitScript(({ api, token }) => {
      localStorage.setItem('damage-viewer.web.api-base-url', api);
      localStorage.setItem('damage-viewer.web.admin-token', token);
    }, { api, token });
    const paths: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === api && request.method() !== 'OPTIONS') {
        expect(request.method()).toBe('GET');
        paths.push(url.pathname);
      }
    });
    await page.goto('/#/simulation/basic-attack');
    await chooseSimulationEntity(page, '攻击方角色', 'champion_aatrox');
    const sourceAvatar = select(page, '攻击方角色').locator('img[alt]');
    await expect(sourceAvatar).toBeVisible();
    await expect.poll(() => sourceAvatar.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    await chooseSimulationEntity(page, '目标角色', 'champion_ahri');
    await expect(select(page, '目标角色').locator('img[alt]')).toBeVisible();
    await chooseSimulationEntity(page, '普攻技能', 'shared_basic_attack');
    await expect(select(page, '普攻技能')).toContainText('普通攻击·共享');
    expect(paths.some(path => /\/images$/.test(path))).toBe(false);
    await page.getByRole('region', { name: '普攻模拟', exact: true }).screenshot({ path: testInfo.outputPath('实际下拉选择.png') });
  });

  test('真实页面Kog/Ahri搜索与九项符文录入保持角色和等级', async ({ page, request }, testInfo) => {
    test.skip(process.env.SIMULATION_LIVE_API !== '1', '角色与符文稳定性检查需真实只读服务。');
    const api = process.env.SIMULATION_LIVE_API_BASE_URL || 'http://127.0.0.1:8080';
    const token = process.env.SIMULATION_LIVE_ADMIN_TOKEN || 'local-readonly-check';
    const preview = process.env.SIMULATION_SELECTION_PREVIEW_URL;
    const response = await request.get(`${api}/api/admin/games/lol/build-systems/runes/definition`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status()).toBe(200);
    const definition = await response.json() as BuildDefinition;
    const checkpoints: Array<{ phase: string; source: string; target: string; sourceLevel: string; targetLevel: string; attackDisabled: boolean }> = [];
    const selections: SimulationSelection[] = [];
    const errors: string[] = [];
    const sockets: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => sockets.push(new URL(socket.url()).pathname));
    page.on('request', request => {
      if (new URL(request.url()).pathname.endsWith('/simulation-snapshot') && request.method() === 'POST') selections.push(request.postDataJSON() as SimulationSelection);
    });
    await page.addInitScript(({ api, token }) => {
      localStorage.setItem('damage-viewer.web.api-base-url', api);
      localStorage.setItem('damage-viewer.web.admin-token', token);
    }, { api, token });
    const readState = async (phase: string) => {
      const state = { phase, source: await select(page, '攻击方角色').innerText(), target: await select(page, '目标角色').innerText(),
        sourceLevel: await levelSelect(page, '攻击方等级').innerText(), targetLevel: await levelSelect(page, '目标等级').innerText(),
        attackDisabled: (await select(page, '普攻技能').getAttribute('class'))?.includes('arco-select-disabled') ?? false };
      checkpoints.push(state);
      return state;
    };
    try {
      await page.goto(preview ? `${preview.replace(/\/$/, '')}/#/simulation/basic-attack` : '/#/simulation/basic-attack');
      await chooseSimulationEntity(page, '攻击方角色', 'champion_kogmaw');
      await chooseSimulationEntity(page, '目标角色', 'champion_ahri');
      await chooseSimulationLevel(page, '攻击方等级', 3);
      await chooseSimulationLevel(page, '目标等级', 3);
      await chooseSimulationEntity(page, '普攻技能', 'shared_basic_attack');
      await chooseSimulationLevel(page, '普攻技能等级', 1);
      const initial = await readState('双方及等级已选择');
      const unchanged = async (phase: string) => {
        const state = await readState(phase);
        expect(state.source, phase).toBe(initial.source);
        expect(state.target, phase).toBe(initial.target);
        expect(state.sourceLevel, phase).toBe(initial.sourceLevel);
        expect(state.targetLevel, phase).toBe(initial.targetLevel);
        expect(state.attackDisabled, phase).toBe(false);
      };
      for (const [label, keyword] of [['攻击方角色', 'champion_ahri'], ['目标角色', 'champion_kogmaw']] as const) {
        const control = select(page, label);
        await control.click();
        await control.locator('input').fill(keyword);
        await expect(options(page)).toHaveCount(1);
        await control.locator('input').fill('没有此候选');
        await expect(options(page)).toHaveCount(0);
        await control.locator('input').fill('');
        await page.keyboard.press('Escape');
        await readState(`${label}搜索取消但尚未失焦`);
        await page.getByRole('heading', { name: '攻击方配置', exact: true }).click();
        await unchanged(`${label}搜索取消后`);
      }
      const system = page.getByRole('combobox', { name: '攻击方构筑系统', exact: true });
      await system.click();
      const systemPopup = page.locator(`#${await system.getAttribute('aria-controls')}`);
      await systemPopup.getByRole('option').filter({ hasText: 'runes' }).click();
      await page.keyboard.press('Escape');
      await expect(systemPopup).toBeHidden();
      const editor = page.getByRole('region', { name: `攻击方构筑 ${definition.system.name}`, exact: true });
      const assignments = [
        { roleKey: 'primary', groupKey: 'rune_path_8000', slots: ['keystone', 'minor_1', 'minor_2', 'minor_3'] },
        { roleKey: 'secondary', groupKey: 'rune_path_8400', slots: ['minor_1', 'minor_2'] },
        { roleKey: 'shards', groupKey: 'rune_shards', slots: ['offense', 'flex', 'defense'] }
      ];
      for (const assignment of assignments) {
        const role = definition.system.selectionRules.groupRoles.find(item => item.roleKey === assignment.roleKey)!;
        const group = definition.groups.find(item => item.groupKey === assignment.groupKey)!;
        const groupControl = editor.getByRole('combobox', { name: `攻击方${definition.system.name}${role.name}分组`, exact: true });
        await groupControl.click();
        const groupPopup = page.locator(`#${await groupControl.getAttribute('aria-controls')}`);
        await groupPopup.getByRole('option').filter({ hasText: group.groupKey }).click();
        await page.keyboard.press('Escape');
        await expect(groupPopup).toBeHidden();
        for (const slotKey of assignment.slots) {
          const slot = group.slots.find(item => item.slotKey === slotKey)!;
          const slotSection = editor.locator('.simulation-build-slot').filter({ hasText: `${group.name}／${slot.name}：` });
          await slotSection.getByRole('button', { name: '添加选择', exact: true }).click();
          const choice = slotSection.getByRole('combobox', { name: `攻击方${role.name}${group.name}${slot.name}选择1`, exact: true });
          const optionKey = slotKey === 'offense' ? 'rune_5005' : slot.optionKeys[0]!;
          expect(slot.optionKeys).toContain(optionKey);
          await choice.click();
          const choicePopup = page.locator(`#${await choice.getAttribute('aria-controls')}`);
          await choicePopup.getByRole('option').filter({ hasText: optionKey }).click();
          await expect(choicePopup).toBeHidden();
          await unchanged(`符文${assignment.roleKey}/${group.groupKey}/${slotKey}填写后`);
        }
      }
      await page.getByRole('button', { name: '确认攻击方完整构筑', exact: true }).click();
      await unchanged('完整构筑确认后');
      await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
      await expect.poll(() => selections.length).toBe(1);
      expect(selections[0]).toMatchObject({ sourceCharacterKey: 'champion_kogmaw', targetCharacterKey: 'champion_ahri', sourceLevel: 3,
        targetLevel: 3, basicAttackSkillKey: 'shared_basic_attack', basicAttackLevel: 1 });
      expect(selections[0]!.sourceBuildConfigurations[0]!.selections).toHaveLength(9);
      await expect(page.getByRole('button', { name: '读取场景快照', exact: true })).toBeEnabled();
      await unchanged('真实POST返回后');
      expect(errors).toEqual([]);
      if (preview) expect(sockets).toEqual([]);
    } finally {
      const evidencePath = testInfo.outputPath('角色与九项符文选择稳定性.json');
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, JSON.stringify({ scope: '真实页面选择稳定性，不是技能运行验收',
        preview: Boolean(preview), checkpoints, selections, errors, sockets }, null, 2));
      await testInfo.attach('角色与九项符文选择稳定性', { path: evidencePath, contentType: 'application/json' });
    }
  });
});

test('虚拟列表按可见候选加载，缓存命中不再次下载，缺头像使用占位', async ({ page }) => {
  const diagnostics = await installApi(page);
  await page.goto('/#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', 'hero_alpha');
  await expect(select(page, '攻击方角色').locator('img[alt]')).toBeVisible();
  await chooseSimulationEntity(page, '目标角色', 'hero_alpha');
  await expect(select(page, '目标角色').locator('img[alt]')).toBeVisible();
  expect(diagnostics.reads.filter(path => path.endsWith('/images/hero_alpha_portrait'))).toHaveLength(1);
  await page.reload();
  await chooseSimulationEntity(page, '攻击方角色', 'hero_alpha');
  await expect(select(page, '攻击方角色').locator('img[alt]')).toBeVisible();
  expect(diagnostics.reads.filter(path => path.endsWith('/images/hero_alpha_portrait'))).toHaveLength(1);
  await chooseSimulationEntity(page, '目标角色', 'extra_59');
  await expect(select(page, '目标角色').getByLabel('候选角色59 未上传图片')).toBeVisible();
  expect(diagnostics.reads.filter(path => /characters\/extra_\d+\/representative-image$/.test(path)).length).toBeLessThan(60);
  diagnostics.assertClean();
});

test('目录失败有重试，技能失败不伪装成没有普攻，输入不丢失', async ({ page }) => {
  const diagnostics = await installApi(page);
  let failing = true;
  await page.route(`${API}/api/admin/games/demo/characters`, async route => {
    if (failing) await route.fulfill({ status: 500, json: { error: { message: '目录失败' } } });
    else await route.fallback();
  });
  await page.goto('/#/simulation/basic-attack');
  await expect(page.getByText(/角色列表读取失败/)).toBeVisible();
  failing = false;
  await page.getByRole('button', { name: '重试角色列表' }).click();
  await page.route(`${API}/api/admin/games/demo/character-skill-relations?**`, route => route.fulfill({ status: 500, json: { error: { message: '技能失败' } } }));
  await chooseSimulationEntity(page, '攻击方角色', 'hero_alpha');
  await expect(page.getByText(/普攻列表读取失败/)).toBeVisible();
  await expect(select(page, '攻击方角色')).toContainText('英雄甲');
  await expect(page.getByRole('button', { name: '读取场景快照' })).toBeDisabled();
  await page.unroute(`${API}/api/admin/games/demo/character-skill-relations?**`);
  await page.getByRole('button', { name: '重试普攻列表' }).click();
  await chooseSimulationEntity(page, '普攻技能', 'attack_alpha');
  diagnostics.assertClean();
});

test('攻击方和游戏切换后迟到目录不覆盖新选项', async ({ page }) => {
  const diagnostics = await installApi(page);
  let release!: () => void;
  let started = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${API}/api/admin/games/demo/character-skill-relations?characterKey=hero_alpha`, async route => {
    started = true;
    await gate;
    try { await route.fulfill({ status: 500, json: { message: '旧目录迟到错误' } }); } catch { /* 已取消。 */ }
  });
  await page.goto('/#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', 'hero_alpha');
  await expect.poll(() => started).toBe(true);
  await chooseSimulationEntity(page, '攻击方角色', 'hero_beta');
  await chooseSimulationEntity(page, '普攻技能', 'attack_beta');
  release();
  await expect(page.getByText(/旧目录迟到错误/)).toHaveCount(0);
  await expect(select(page, '普攻技能')).toContainText('普通攻击乙');
  await page.locator('.app-toolbar-field--game .arco-select').click();
  await options(page).filter({ hasText: 'other /' }).click();
  await expect(select(page, '攻击方角色')).not.toContainText('英雄乙');
  await expect(select(page, '普攻技能')).toHaveClass(/arco-select-disabled/);
  await chooseSimulationEntity(page, '攻击方角色', 'hero_alpha');
  await expect(select(page, '攻击方角色')).toContainText('其他甲');
  diagnostics.assertClean();
});

test('三个等级下拉仅提供实际范围，切换普攻清空旧等级且没有手写输入', async ({ page }) => {
  const diagnostics = await installApi(page);
  await page.route(`${API}/api/admin/games/demo/level-config`, route => route.fulfill({ json: { gameId: 'demo', minLevel: 2, maxLevel: 4 } }));
  await page.route(`${API}/api/admin/games/demo/skills/attack_alpha`, async route => {
    // 本专项采用独立目录数据，不访问正式后端。
    await route.fulfill({ json: { gameId: 'demo', skillKey: 'attack_alpha', name: '普通攻击甲', description: null,
      maxLevel: 3, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['basic_attack'], createdAt: '', updatedAt: '' } });
  });
  await page.goto('/#/simulation/basic-attack');
  for (const label of ['攻击方等级', '目标等级']) {
    await expect(page.getByRole('spinbutton', { name: label, exact: true })).toHaveCount(0);
    await levelSelect(page, label).click();
    const popup = page.locator(`#${await levelSelect(page, label).getAttribute('aria-controls')}`);
    await expect(popup.getByRole('option')).toHaveText(['2', '3', '4']);
    await popup.getByRole('option', { name: '2', exact: true }).click();
    await expect(popup).toBeHidden();
  }
  await chooseSimulationEntity(page, '攻击方角色', 'hero_alpha');
  await chooseSimulationEntity(page, '目标角色', 'hero_beta');
  await chooseSimulationEntity(page, '普攻技能', 'attack_alpha');
  await levelSelect(page, '普攻技能等级').click();
  const popup = page.locator(`#${await levelSelect(page, '普攻技能等级').getAttribute('aria-controls')}`);
  await expect(popup.getByRole('option')).toHaveText(['1', '2', '3']);
  await popup.getByRole('option', { name: '3', exact: true }).click();
  await expect(popup).toBeHidden();
  await expect(page.getByRole('button', { name: '读取场景快照', exact: true })).toBeEnabled();
  await chooseSimulationEntity(page, '攻击方角色', 'hero_beta');
  await chooseSimulationEntity(page, '普攻技能', 'attack_beta');
  await expect(levelSelect(page, '普攻技能等级')).not.toContainText('3');
  await expect(page.getByRole('button', { name: '读取场景快照', exact: true })).toBeDisabled();
  await levelSelect(page, '普攻技能等级').click();
  const nextPopup = page.locator(`#${await levelSelect(page, '普攻技能等级').getAttribute('aria-controls')}`);
  await expect(nextPopup.getByRole('option')).toHaveText(['1']);
  await nextPopup.getByRole('option', { name: '1', exact: true }).click();
  await expect(nextPopup).toBeHidden();
  await expect(page.getByRole('button', { name: '读取场景快照', exact: true })).toBeEnabled();
  expect(diagnostics.reads.filter(path => path === '/api/admin/games/demo/level-config').length).toBeLessThanOrEqual(1);
  diagnostics.assertClean();
});

test('等级范围失败禁用选择和读取，重试后按真实最小等级恢复', async ({ page }) => {
  const diagnostics = await installApi(page);
  let failed = true;
  await page.route(`${API}/api/admin/games/demo/level-config`, route => route.fulfill(failed
    ? { status: 500, json: { error: { message: '等级配置读取失败' } } }
    : { json: { gameId: 'demo', minLevel: 3, maxLevel: 5 } }));
  await page.goto('/#/simulation/basic-attack');
  await expect(page.getByText(/角色等级范围读取失败/)).toBeVisible();
  await expect(levelSelect(page, '攻击方等级')).toHaveClass(/arco-select-disabled/);
  await expect(levelSelect(page, '目标等级')).toHaveClass(/arco-select-disabled/);
  await expect(page.getByRole('button', { name: '读取场景快照', exact: true })).toBeDisabled();
  failed = false;
  await page.getByRole('button', { name: '重试等级范围', exact: true }).click();
  await chooseSimulationLevel(page, '攻击方等级', 3);
  await expect(levelSelect(page, '目标等级')).not.toHaveClass(/arco-select-disabled/);
  await levelSelect(page, '目标等级').click();
  const popup = page.locator(`#${await levelSelect(page, '目标等级').getAttribute('aria-controls')}`);
  await expect(popup.getByRole('option')).toHaveText(['3', '4', '5']);
  await popup.getByRole('option', { name: '5', exact: true }).click();
  await expect(popup).toBeHidden();
  diagnostics.assertClean();
});

test('切换游戏时丢弃迟到等级范围，旧等级选择不会带入新游戏', async ({ page }) => {
  const diagnostics = await installApi(page);
  let release!: () => void;
  let started = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${API}/api/admin/games/demo/level-config`, async route => {
    started = true;
    await gate;
    await route.fulfill({ json: { gameId: 'demo', minLevel: 1, maxLevel: 18 } }).catch(() => undefined);
  });
  await page.route(`${API}/api/admin/games/other/level-config`, route => route.fulfill({ json: { gameId: 'other', minLevel: 2, maxLevel: 3 } }));
  await page.goto('/#/simulation/basic-attack');
  await expect.poll(() => started).toBe(true);
  await expect(levelSelect(page, '攻击方等级')).toHaveClass(/arco-select-disabled/);
  await page.locator('.app-toolbar-field--game .arco-select').click();
  await options(page).filter({ hasText: 'other /' }).click();
  await chooseSimulationLevel(page, '攻击方等级', 2);
  release();
  await levelSelect(page, '目标等级').click();
  const popup = page.locator(`#${await levelSelect(page, '目标等级').getAttribute('aria-controls')}`);
  await expect(popup.getByRole('option')).toHaveText(['2', '3']);
  await popup.getByRole('option', { name: '3', exact: true }).click();
  await expect(popup).toBeHidden();
  await expect(levelSelect(page, '攻击方等级')).toContainText('2');
  diagnostics.assertClean();
});
