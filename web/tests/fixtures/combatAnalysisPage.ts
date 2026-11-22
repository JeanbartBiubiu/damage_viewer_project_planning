import { fulfillAuthSession } from './authSession';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { AutomaticSkillView } from '../../src/engine/automaticSkillPresentation';
import type { AutomaticSkillArchive } from '../../src/pages/simulation/SimulationScenarioPanel';
import type { SimulationSelection, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import type { SimulationAvailabilityResponse } from '../../src/types/simulationAvailability';
import type { Equipment } from '../../src/types/equipment';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { SIMULATION_ADAPTER_VERSION } from '../../src/engine/simulationAdapter';
import { simulationHash } from '../../src/engine/simulationHash';
import { simulationAutomaticSample } from './simulationAutomaticSkills';
import { simulationAvailabilitySample } from './simulationAvailability';
import { chooseSimulationEntity, chooseSimulationLevel } from './simulationSelection';
import { syncSimulationSkillSources } from './simulationSkillSources';

export const combatAnalysisOutput = resolve('output/combat-analysis/skill-roster-layout');
export type FrozenCombatAnalysis = AutomaticSkillArchive & { displayDefinitionVersion: 2; view: AutomaticSkillView };
type WorkerObservation = { messages: string[]; terminated: number };
type HeldResponse = { started: Promise<void>; release: () => void };
type ResponseGate = { requested: () => void; wait: Promise<void> };

function holdResponse() {
  let release!: () => void;
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { started, release, requested, wait };
}

export function combatAnalysisSample(): SimulationSnapshot {
  const snapshot = simulationAutomaticSample(true);
  for (const side of ['source', 'target'] as const) {
    const actor = snapshot[side];
    // 本合成作者样本的暴击、穿透及吸血都取明确的零值。
    Object.assign(actor.selectedLevelValues, { critical_strike_chance: 0, critical_strike_damage_bonus_percent: 0,
      armor_pen_percent: 0, armor_pen_flat: 0, life_steal_percent: 0 });
    actor.attributes.levelValues['1'] = { ...actor.selectedLevelValues };
  }
  return snapshot;
}

/** 仅隔离 HTTP；页面、适配器、正式 Worker 和 Wasm 都保持真实运行，不写业务数据。 */
export async function installCombatAnalysisApi(page: Page, sample: SimulationSnapshot = combatAnalysisSample(), options: {
  availability?: SimulationAvailabilityResponse; equipmentCatalog?: Equipment[];
  snapshotForSelection?: (selection: SimulationSelection) => SimulationSnapshot;
} = {}) {
  const requests: Array<{ method: string; path: string }> = [];
  const pageErrors: string[] = [];
  const workers: string[] = [];
  let snapshotReads = 0;
  let availabilityReads = 0;
  let availability = structuredClone(options.availability ?? simulationAvailabilitySample(sample));
  let availabilityUnavailable = false;
  let nextAvailability: ResponseGate | null = null;
  const heldConfigurations = new Map<string, ResponseGate>();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  await page.addInitScript(() => {
    const state: WorkerObservation = { messages: [], terminated: 0 };
    (window as typeof window & { combatAnalysisWorkers: WorkerObservation }).combatAnalysisWorkers = state;
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...options) {
      if (message && typeof message === 'object' && typeof message.type === 'string') state.messages.push(message.type);
      return Reflect.apply(postMessage, this, [message, ...options]);
    };
    const terminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function() { state.terminated++; return terminate.call(this); };
  });
  await page.route('**/api/auth/me', route => fulfillAuthSession(route, false).then(() => undefined));
  await page.route('**/api/**', async route => {
    if (await fulfillAuthSession(route, false)) return;
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    } });
    const { origin, pathname, searchParams } = new URL(request.url());
    requests.push({ method: request.method(), path: pathname });
    expect(origin, '专项请求保持同源').toBe(new URL(page.url()).origin);
    const reply = (body: unknown) => route.fulfill({ json: body, headers: { 'Access-Control-Allow-Origin': '*' } });
    if (pathname === '/api/games') return reply([{ gameId: sample.gameId, gameName: '混合分析独立作者构造', representativeImageKey: null }]);
    expect(request.headers().authorization, '公开读取不附带凭据').toBeUndefined();
    const resource = pathname.replace(/^\/api\/admin\/games\/[^/]+\//, '');
    if (resource === 'simulation-snapshot') {
      expect(request.method(), 'POST 仅用于只读场景快照').toBe('POST');
      snapshotReads++;
      const selection: SimulationSelection = request.postDataJSON();
      const snapshot = structuredClone(options.snapshotForSelection?.(structuredClone(selection)) ?? sample);
      snapshot.selection = selection;
      syncSimulationSkillSources(snapshot);
      if (options.snapshotForSelection) {
        const { snapshotDigest: _digest, readAt: _readAt, ...frozen } = snapshot;
        snapshot.snapshotDigest = await simulationHash(frozen);
      } else snapshot.snapshotDigest = '9'.repeat(64);
      return reply(snapshot);
    }
    expect(request.method(), '不得新增或修改业务配置').toBe('GET');
    if (resource === 'simulation-availability') {
      availabilityReads++;
      expect(searchParams.get('wasmSha256')).toBe(WASM_IDENTITY.sha256);
      expect(searchParams.get('adapterVersion')).toBe(SIMULATION_ADAPTER_VERSION);
      const response = availability;
      const unavailable = availabilityUnavailable;
      const held = nextAvailability;
      nextAvailability = null;
      if (held) {
        held.requested();
        await held.wait;
      }
      if (unavailable) return route.fulfill({ status: 503, json: { error: {
        code: '503.INDEPENDENT_AVAILABILITY', message: '独立构造目录暂时不可用', details: {}
      } }, headers: { 'Access-Control-Allow-Origin': '*' } });
      return reply(response);
    }
    if (resource === 'level-config') return reply(sample.catalogs.levelConfig);
    if (resource === 'characters') return reply({ items: [sample.source.character, sample.target.character], total: 2 });
    if (resource === 'equipment') return reply({ items: options.equipmentCatalog ?? [], total: options.equipmentCatalog?.length ?? 0 });
    if (resource === 'build-systems') return reply({ items: [], total: 0 });
    if (resource === 'attributes') return reply({ items: sample.catalogs.attributes, total: sample.catalogs.attributes.length });
    if (resource === 'calculation-rules') return reply(sample.catalogs.calculationRules);
    if (resource === 'skill-categories') return reply({ items: sample.catalogs.skillCategories, total: sample.catalogs.skillCategories.length });
    if (resource === 'character-skill-relations') {
      const actor = searchParams.get('characterKey') === sample.source.character.characterKey ? sample.source : sample.target;
      return reply({ items: actor.attachedSkills, total: actor.attachedSkills.length });
    }
    if (/^skills\/[^/]+(?:\/configuration)?$/.test(resource)) {
      const configuration = sample.skillConfigurations.find(item => item.skill.skillKey === resource.split('/')[1]);
      expect(configuration, `目录技能 ${resource}`).toBeDefined();
      if (resource.endsWith('/configuration')) {
        const held = heldConfigurations.get(configuration!.skill.skillKey);
        if (held) {
          heldConfigurations.delete(configuration!.skill.skillKey);
          held.requested();
          await held.wait;
        }
        return reply(configuration);
      }
      return reply(configuration!.skill);
    }
    if (resource.endsWith('/representative-image')) return reply({ image: null });
    throw new Error(`混合分析未定义目录请求 ${request.method()} ${resource}`);
  });
  return {
    get snapshotReads() { return snapshotReads; },
    get availabilityReads() { return availabilityReads; },
    get workerCount() { return workers.length; },
    requests,
    setAvailability(next: SimulationAvailabilityResponse) { availability = structuredClone(next); },
    setAvailabilityUnavailable(unavailable: boolean) { availabilityUnavailable = unavailable; },
    holdNextAvailability(): HeldResponse {
      if (nextAvailability) throw new Error('已有目录响应等待拦截');
      const { started, release, requested, wait } = holdResponse();
      nextAvailability = { requested, wait };
      return { started, release };
    },
    holdNextConfiguration(skillKey: string): HeldResponse {
      const { started, release, requested, wait } = holdResponse();
      heldConfigurations.set(skillKey, { requested, wait });
      return { started, release };
    },
    assertClean(requireWorker = true) {
      expect(pageErrors, '真实页面无异常').toEqual([]);
      expect(requests.every(row => row.method === 'GET' || row.method === 'POST' && row.path.endsWith('/simulation-snapshot')),
        '只读取作者配置与场景，不写业务数据').toBe(true);
      if (requireWorker) expect(workers.some(url => url.includes('genericEngineWorker')), '实际正式计算 Worker 已建立').toBe(true);
    }
  };
}

export async function chooseCombatAnalysisOption(page: Page, label: string, option: string | RegExp) {
  const select = page.locator(`.arco-select[aria-label="${label}"]`);
  await select.click();
  const popup = page.locator(`#${await select.getAttribute('aria-controls')}`);
  await popup.getByRole('option', { name: option, exact: true }).click();
  if (await popup.isVisible()) await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
}

export async function setCombatAnalysisCheckbox(page: Page, label: string, checked: boolean) {
  const checkbox = page.getByRole('checkbox', { name: label, exact: true });
  if (await checkbox.isChecked() !== checked) await checkbox.locator('xpath=ancestor::label').click();
  await expect(checkbox).toBeChecked({ checked });
}

export async function setCombatAnalysisSkill(page: Page, side: '攻击方' | '目标', skillKey: string, enabled: boolean) {
  const control = page.getByRole('switch', { name: `${side}技能 ${skillKey} 启用`, exact: true });
  await expect(control).toBeEnabled();
  if (await control.isChecked() !== enabled) await control.click();
  await expect(control).toBeChecked({ checked: enabled });
}

export async function openCombatAnalysisAdvanced(page: Page) {
  const summary = page.locator('summary').filter({ hasText: /^高级施放设置$/ });
  if (!await summary.locator('..').getAttribute('open').then(value => value !== null)) await summary.click();
  await expect(page.getByRole('region', { name: '主动技能自动循环计划', exact: true })).toBeVisible();
}

export async function openCombatAnalysisPage(page: Page) {
  await page.goto('/#/simulation/combat-analysis');
  await expect(page.getByRole('heading', { name: '混合战斗分析', exact: true })).toBeVisible();
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  const observedWasm = await page.evaluate(async () => {
    const response = await fetch('/src/engine/wasm/tinygo_engine_v2.wasm');
    if (!response.ok) throw new Error(`正式 Wasm 请求失败 ${response.status}`);
    const data = await response.arrayBuffer();
    return { bytes: data.byteLength, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
      .map(value => value.toString(16).padStart(2, '0')).join('') };
  });
  expect(observedWasm).toEqual({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  await expect(page.getByRole('checkbox', { name: '指定技能行动计划', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '开启背景普攻', exact: true })).toHaveCount(0);
  await expect(page.locator('.arco-select[aria-label="普攻技能"]')).toHaveCount(0);
  await expect(page.locator('.arco-select[aria-label="攻击方主动技能候选"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '添加自动技能', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '准备计算', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '将缺失属性填写为0', exact: true })).toHaveCount(0);
}

export async function selectCombatAnalysisCharacters(page: Page, expectedLevels: Record<string, number> = {}) {
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'actor_b');
  await chooseSimulationLevel(page, '目标等级', 1);
  for (const skillKey of ['sample_basic_attack', 'sample_active', 'sample_second']) {
    await expect(page.getByRole('switch', { name: `攻击方技能 ${skillKey} 启用`, exact: true })).toBeChecked();
    await expect(page.locator(`.simulation-level-select[aria-label="攻击方技能 ${skillKey} 等级"]`)).toContainText(String(expectedLevels[skillKey] ?? 1));
  }
}

export async function setCombatAnalysisInitialHealth(page: Page, source: number, target: number) {
  await chooseCombatAnalysisOption(page, '初始生命规则', '手动指定初始当前生命');
  await page.getByLabel('攻击方初始当前生命', { exact: true }).fill(String(source));
  await page.getByLabel('目标初始当前生命', { exact: true }).fill(String(target));
}

/** 从实际页面控件配置真实绑定、双方、命中与关系。 */
export async function configureCombatAnalysisPage(page: Page, backgroundAttack = true) {
  await openCombatAnalysisPage(page);
  await selectCombatAnalysisCharacters(page);
  await setCombatAnalysisSkill(page, '攻击方', 'sample_basic_attack', backgroundAttack);
  await openCombatAnalysisAdvanced(page);
  // 命中目标及自身治疗来自作者入口，不再二次选择技能或目标。
  await expect(page.locator('.arco-select[aria-label="自动技能命中预设 auto_rule_1"]')).toContainText('尝试命中目标');
  await expect(page.locator('.arco-select[aria-label="自动技能目标 auto_rule_2"]')).toContainText('攻击方自身');
  // 实际调整优先级再恢复，确认标识不随排序改变。
  await page.getByRole('button', { name: '下移自动规则 auto_rule_1', exact: true }).click();
  await page.getByRole('button', { name: '上移自动规则 auto_rule_1', exact: true }).click();
  await chooseCombatAnalysisOption(page, '关联冷却 auto_rule_1', '独立单段主动');
  await chooseCombatAnalysisOption(page, '前置资格 auto_rule_2', '独立单段主动');
  await setCombatAnalysisInitialHealth(page, 300, 5000);
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('2600');
  await expect(page.getByRole('button', { name: '开始计算', exact: true })).toBeEnabled();
}

export async function runCombatAnalysisPage(page: Page) {
  await page.getByRole('button', { name: '开始计算', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /^计算完成。$/ })).toBeVisible();
  await expect(page.getByRole('region', { name: '自动技能结果', exact: true })).toContainText('观察完整核对');
}

export async function downloadCombatAnalysis(page: Page, label: string, testInfo: TestInfo): Promise<FrozenCombatAnalysis> {
  mkdirSync(combatAnalysisOutput, { recursive: true });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载自动冻结档案', exact: true }).click();
  const download = await pending;
  const path = resolve(combatAnalysisOutput, `${label}.json`);
  await download.saveAs(path);
  const text = readFileSync(path, 'utf8');
  const archive = JSON.parse(text) as FrozenCombatAnalysis;
  await testInfo.attach(`混合分析页面冻结档案-${label}`, { body: text, contentType: 'application/json' });
  expect(archive).toMatchObject({ taskKind: 'automatic_skill', outcome: 'passed', cleanup: 'released', displayDefinitionVersion: 2,
    assessment: { complete: true, factsValid: true }, releaseResult: { ok: true, released: true } });
  expect(text).not.toMatch(/adminToken|apiBaseUrl|Authorization|Bearer|Cookie|AbortController|combat-analysis-readonly-fixture/);
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  expect(archive.wasm).toMatchObject({ bytes: bytes.length, sha256 });
  if (process.env.SIMULATION_EXPECTED_WASM_SHA256) expect(sha256).toBe(process.env.SIMULATION_EXPECTED_WASM_SHA256.toLowerCase());
  return archive;
}

export const combatAnalysisWorkers = (page: Page) => page.evaluate(() =>
  (window as typeof window & { combatAnalysisWorkers: WorkerObservation }).combatAnalysisWorkers);

/** 原生 Worker 完成后只延迟客户端 Promise 的交付，结果本身不替换。 */
export async function holdNextCombatAnalysisResult(page: Page) {
  await page.evaluate(async () => {
    const clientPath = '/src/engine/genericEngineClient.ts';
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const original = GenericEngineClient.prototype.run;
    GenericEngineClient.prototype.run = async function(request) {
      GenericEngineClient.prototype.run = original;
      const result = await original.call(this, request);
      return new Promise(resolve => {
        (window as typeof window & { resumeCombatAnalysis: () => void }).resumeCombatAnalysis = () => resolve(result);
      });
    };
  });
}

export async function waitForHeldCombatAnalysis(page: Page) {
  await expect.poll(() => page.evaluate(() => typeof (window as typeof window & { resumeCombatAnalysis?: () => void }).resumeCombatAnalysis)).toBe('function');
  await expect(page.getByRole('alert').filter({ hasText: /^正在执行(?:主动技能自动循环|连续普攻)$/ })).toBeVisible();
}

export const resumeCombatAnalysis = (page: Page) => page.evaluate(() => {
  const observer = window as typeof window & { resumeCombatAnalysis?: () => void };
  const resume = observer.resumeCombatAnalysis;
  if (!resume) throw new Error('没有等待交付的混合战斗结果。');
  delete observer.resumeCombatAnalysis;
  resume();
});
