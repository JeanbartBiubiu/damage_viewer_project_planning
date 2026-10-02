import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { simulationSample } from '../fixtures/simulationSnapshot';
import { chooseSimulationEntity, chooseSimulationLevel, installSimulationSelectionApi } from '../fixtures/simulationSelection';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import type { RecordBudget, SafetyBudget, SamplingConfig } from '../../src/types/genericEngine';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { continuousExpectation } from '../fixtures/continuousExpectation';

test.beforeEach(async ({ page }) => {
  const wasm = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(wasm.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(wasm).digest('hex')).toBe(WASM_IDENTITY.sha256);
  await page.route('**/api/games', route => route.fulfill({ json: [{ gameId: 'demo', gameName: '独立连续用例', representativeImageKey: null }] }));
  await installSimulationSelectionApi(page, '**', 'demo');
  await page.goto('/#/simulation/basic-attack');
});

function sample(damage = 100, armor = 0, speed = 1) {
  const snapshot = simulationSample();
  Object.assign(snapshot.source.selectedLevelValues, { attack_damage: damage, attack_speed: speed });
  Object.assign(snapshot.source.attributes.levelValues['1']!, { attack_damage: damage, attack_speed: speed });
  snapshot.target.selectedLevelValues.armor = armor;
  snapshot.target.attributes.levelValues['1']!.armor = armor;
  return snapshot;
}
type RunOptions = { durationMs?: number; targetHp?: number; sourceHp?: number; crit?: number; inputMax?: number;
  sourceInputs?: Record<string, number>; recordBudget?: RecordBudget; safetyBudget?: SafetyBudget; sampling?: SamplingConfig };

async function runSnapshot(page: Page, snapshot: SimulationSnapshot, testInfo: TestInfo, options: RunOptions = {}, name = 'continuous-run') {
  const result = await page.evaluate(async ({ snapshot, options }) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const requestPath = '/src/engine/continuousAttackRequest.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const resultPath = '/src/engine/continuousAttackResult.ts';
    const { inspectSimulationSnapshot, prepareSimulation } = await import(adapterPath);
    const { continuousAttackRequest, continuousAttackRunInputHash } = await import(requestPath);
    const { GenericEngineClient } = await import(clientPath);
    const { assessContinuousAttackResult } = await import(resultPath);
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side as 'source' | 'target'][row.attribute.attributeKey] = 0;
    if (options.crit !== undefined) inputs.source.critical_strike_chance = options.crit;
    Object.assign(inputs.source, options.sourceInputs);
    const prepared = await prepareSimulation(snapshot, inputs, { source: options.sourceHp ?? snapshot.source.selectedLevelValues.hp,
      target: options.targetHp ?? snapshot.target.selectedLevelValues.hp });
    const continuous = await continuousAttackRequest(prepared, snapshot,
      { durationMs: options.durationMs ?? 30000, attackSpeedInputMax: options.inputMax ?? snapshot.source.selectedLevelValues.attack_speed });
    if (options.recordBudget) continuous.runRequest.recordBudget = options.recordBudget;
    if (options.safetyBudget) Object.assign(continuous.runRequest.safetyBudget, options.safetyBudget);
    if (options.sampling) continuous.runRequest.sampling = options.sampling;
    continuous.runInputHash = await continuousAttackRunInputHash(continuous.runRequest, continuous.attackSpeedAdmission);
    const client = new GenericEngineClient();
    let compileResult, runRequest, done, assessment, error, releaseResult;
    try {
      compileResult = await client.compile(prepared.compileRequest);
      if (!compileResult.ok || !compileResult.sessionId) throw new Error(JSON.stringify(compileResult.errors));
      runRequest = { ...continuous.runRequest, sessionId: compileResult.sessionId };
      done = await client.run(runRequest);
      assessment = assessContinuousAttackResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins);
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally {
      if (compileResult?.sessionId && client.hasLiveWorker) releaseResult = await client.release(compileResult.sessionId, prepared.compileRequest.rulesHash);
      client.terminate();
    }
    return { prepared, continuous, compileResult, runRequest, done, assessment, error, releaseResult, liveWorker: client.hasLiveWorker };
  }, { snapshot, options });
  const path = testInfo.outputPath(`${name}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ snapshot, ...result, wasm: WASM_IDENTITY }, null, 2));
  await testInfo.attach(`${name}.json`, { path, contentType: 'application/json' });
  expect(result.error, JSON.stringify(result.done)).toBeUndefined();
  expect(result.assessment?.issues).toEqual([]);
  expect(result.releaseResult).toMatchObject({ released: true, sessionId: result.compileResult.sessionId });
  expect(result.liveWorker).toBe(false);
  return result;
}

for (const row of [
  { name: '基础三刀击杀', damage: 100, armor: 0, speed: 1, hp: 250, duration: 30000, crit: 0, count: 3, amount: 300, killedAt: 2000 },
  { name: '期望暴击与防御', damage: 100, armor: 100, speed: 1, hp: 300, duration: 30000, crit: 0.25, count: 5, amount: 312.5, killedAt: 4000 },
  { name: '首刀0毫秒击杀', damage: 100, armor: 0, speed: 1, hp: 20, duration: 30000, crit: 0, count: 1, amount: 100, killedAt: 0 },
  { name: '0.8攻速观察2499', damage: 10, armor: 0, speed: 0.8, hp: 590, duration: 2499, crit: 0, count: 2, amount: 20, killedAt: null },
  { name: '0.8攻速闭区间2500', damage: 10, armor: 0, speed: 0.8, hp: 590, duration: 2500, crit: 0, count: 3, amount: 30, killedAt: null },
  { name: '明确零伤害完整观察', damage: 0, armor: 0, speed: 1, hp: 590, duration: 2000, crit: 0, count: 3, amount: 0, killedAt: null }
]) test(`${row.name}：实际Worker与完整作者配置`, async ({ page }, testInfo) => {
  const result = await runSnapshot(page, sample(row.damage, row.armor, row.speed), testInfo,
    { durationMs: row.duration, targetHp: row.hp, crit: row.crit });
  expect(result.assessment).toMatchObject({ complete: true, completedCount: row.count, damageDealt: row.amount,
    hpLoss: Math.min(row.amount, row.hp), durationMs: row.killedAt ?? row.duration,
    execution: { targetKilled: row.killedAt !== null, targetKilledAtMs: row.killedAt } });
  expect(result.done.attackRecords.map((attack: { startAtMs: number }) => attack.startAtMs))
    .toEqual(Array.from({ length: row.count }, (_, index) => index * Math.round(1000 / row.speed)));
  expect(result.done.series).toEqual([]);
});

test('事件预算恰达上限但已完整观察999毫秒，结果仍完整', async ({ page }, testInfo) => {
  const result = await runSnapshot(page, sample(), testInfo, { durationMs: 999, safetyBudget: { maxEvents: 1 } });
  expect(result.assessment).toMatchObject({ complete: true, completedCount: 1, durationMs: 999, execution: { targetKilled: false, incompleteReason: null } });
});

test('执行预算部分结果与致死事实分开，攻击预算不影响记录预算', async ({ page }, testInfo) => {
  const result = await runSnapshot(page, sample(), testInfo, { targetHp: 590, safetyBudget: { maxBasicAttacks: 2 } });
  expect(result.assessment).toMatchObject({ complete: false, completedCount: 2, damageDealt: 200,
    execution: { targetKilled: false, budgetCause: 'max_basic_attacks', incompleteReason: 'budget_exceeded' } });
});

test('致死伤害已提交但同步尾部超预算，击杀与不完整事实分开', async ({ page }, testInfo) => {
  const result = await runSnapshot(page, sample(), testInfo, { targetHp: 20, crit: 0, safetyBudget: { maxCommandsPerEvent: 4 } });
  expect(result.assessment).toMatchObject({ complete: false, startedCount: 1, hitCount: 1, completedCount: 0, damageDealt: 100, hpLoss: 20,
    execution: { targetKilled: true, targetKilledAtMs: 0, incompleteReason: 'unfinished_tail', budgetCause: 'max_commands_per_event' } });
  expect(result.done.summary.stopReason).toBe('budget_exceeded');
  expect(result.done.attackRecords[0].completed).toBe(false);
});

test('明细预算0、小值和足够值，调试证据截断后完整累计保持一致', async ({ page }, testInfo) => {
  const outputs = [];
  for (const max of [0, 3, 1000]) outputs.push(await runSnapshot(page, sample(0), testInfo,
    { durationMs: 150000, recordBudget: { maxAttackRecords: max, maxDamageRecords: max } }, `record-${max}`));
  for (const output of outputs) {
    expect(output.assessment).toMatchObject({ complete: true, completedCount: 151, damageDealt: 0, hpLoss: 0, targetFinalHp: 590 });
    expect(output.done.summary.evidenceTruncated).toBe(true);
    expect(output.done.summary.damageBreakdown).toEqual(outputs[0].done.summary.damageBreakdown);
    expect(output.done.recording.attackRecordCount).toBe(151);
    expect(output.done.recording.damageRecordCount).toBe(151);
  }
});

test('只读采样频率改变不影响攻击顺序、金额、时刻和停止结论', async ({ page }, testInfo) => {
  const off = await runSnapshot(page, sample(100, 100), testInfo, {}, 'sampling-off');
  for (const sampleEveryMs of [1, 733]) {
    const on = await runSnapshot(page, sample(100, 100), testInfo,
      { sampling: { sampleEveryMs, dpsWindowMs: 1000, maxSeriesPoints: 20, disabled: false } }, `sampling-${sampleEveryMs}`);
    expect(on.done.attackRecords).toEqual(off.done.attackRecords);
    expect(on.done.damageRecords).toEqual(off.done.damageRecords);
    expect(on.done.summary.execution).toEqual(off.done.summary.execution);
    expect(on.done.summary.basicAttack).toEqual(off.done.summary.basicAttack);
    expect(on.done.summary.abilityAttemptCount).toBe(off.done.summary.abilityAttemptCount);
    expect(on.done.series.length).toBeLessThanOrEqual(20);
  }
});

test('同名结果及多次挂接的完整作者路径逐笔可追溯，独立重跑确定', async ({ page }, testInfo) => {
  const snapshot = sample(20);
  const config = snapshot.skillConfigurations[0]!;
  config.effects.push({ ...structuredClone(config.effects[1]!), effectKey: 'second_hit', sortOrder: 2 });
  config.triggerRules[1]!.actions.push({ ...structuredClone(config.triggerRules[1]!.actions[0]!), actionKey: 'repeat_hit', sortOrder: 1 },
    { ...structuredClone(config.triggerRules[1]!.actions[0]!), actionKey: 'second_hit', sortOrder: 2, detail: { effectKey: 'second_hit' } });
  const one = await runSnapshot(page, snapshot, testInfo, { durationMs: 1000 }, 'first-run');
  const two = await runSnapshot(page, snapshot, testInfo, { durationMs: 1000 }, 'second-run');
  expect(one.done.damageRecords).toHaveLength(6);
  expect(new Set(one.done.damageRecords.map((row: { operationRef: string }) => row.operationRef)).size).toBe(2);
  expect(two.assessment).toEqual(one.assessment);
  expect(two.continuous.runInputHash).toBe(one.continuous.runInputHash);
});

async function preparePage(page: Page, snapshot = sample()) {
  await page.route('**/api/admin/games/demo/simulation-snapshot?**', route => route.fulfill({ json: snapshot }));
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a'); await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'actor_b'); await chooseSimulationLevel(page, '目标等级', 1);
  await chooseSimulationEntity(page, '普攻技能', 'sample_basic_attack'); await chooseSimulationLevel(page, '普攻技能等级', 1);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
}
const runButton = (page: Page) => page.getByRole('button', { name: '连续普攻', exact: true });

test('页面显式上界与生命准入、完整击杀、白名单档案及输入失效', async ({ page }) => {
  let workers = 0; page.on('worker', () => workers++);
  await preparePage(page);
  await expect(page.getByLabel('观察时长（毫秒）', { exact: true })).toHaveValue('30000');
  await runButton(page).click();
  await expect(page.getByText(/属性目录未提供上界，请明确填写/)).toBeVisible();
  expect(workers).toBe(0);
  await page.getByLabel('攻速输入上界', { exact: true }).fill('1');
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('0');
  await runButton(page).click();
  await expect(page.getByText(/目标初始已死亡，不能执行本阶段连续普攻/)).toBeVisible();
  expect(workers).toBe(0);
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('250');
  await runButton(page).click();
  await expect(page.getByText('连续普攻已完成击杀，会话正常释放。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('continuous-attack-completed-count')).toHaveText('3');
  await expect(page.getByTestId('continuous-attack-damage-dealt')).toHaveText('300');
  await expect(page.getByTestId('continuous-attack-hp-loss')).toHaveText('250');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载连续运行档案', exact: true }).click();
  const archive = JSON.parse(readFileSync((await (await pending).path())!, 'utf8'));
  expect(archive).toMatchObject({ taskKind: 'continuous_attack', outcome: 'passed', cleanup: 'released',
    attackSpeedAdmission: { source: 'scenario_input', inputMax: 1 }, assessment: { complete: true, completedCount: 3 } });
  expect(archive.runInputHash).toMatch(/^[a-f0-9]{64}$/);
  expect(archive.operationOrigins.length).toBeGreaterThan(0);
  expect(JSON.stringify(archive)).not.toMatch(/adminToken|apiBaseUrl|Authorization|Bearer|Cookie|AbortController/);
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('999');
  await expect(page.getByRole('region', { name: '连续普攻结果', exact: true })).toHaveCount(0);
  await runButton(page).click();
  await expect(page.getByText('连续普攻已完成观察，目标未被击杀，会话正常释放。', { exact: true })).toBeVisible();
});

type Diagnostics = { created: number; terminated: number; messages: string[] };
/** 只在异常页面用例注入故障；正常数值场景均直接使用原生Worker。 */
async function fault(page: Page, mode: 'record' | 'stall' | 'crash' | 'release_fail') {
  await page.evaluate(mode => {
    const NativeWorker = window.Worker;
    const state = { created: 0, terminated: 0, messages: [] as string[] };
    (window as unknown as { continuousWorkers: Diagnostics }).continuousWorkers = state;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); state.created++; }
      postMessage(message: { type: string; id?: string; sessionId?: string }) {
        state.messages.push(message.type);
        if (message.type === 'run' && (mode === 'stall' || mode === 'crash')) {
          if (mode === 'crash') queueMicrotask(() => this.onerror?.call(this, new ErrorEvent('error', { message: '专项线程崩溃' })));
          return;
        }
        if (message.type === 'release' && mode === 'release_fail') {
          queueMicrotask(() => this.onmessage?.call(this, new MessageEvent('message', { data: { type: 'releaseResult', id: message.id,
            frames: [{ kind: 214, schemaVersion: 1, flags: 0, payload: Array.from(new TextEncoder().encode(JSON.stringify({ ok: false, released: false, sessionId: message.sessionId }))) }] } })));
          return;
        }
        super.postMessage(message);
      }
      terminate() { state.terminated++; super.terminate(); }
    };
  }, mode);
}
const diagnostics = (page: Page) => page.evaluate(() => (window as unknown as { continuousWorkers: Diagnostics }).continuousWorkers);
for (const mode of ['stall', 'crash', 'release_fail'] as const) test(`连续${mode}异常收尾不重建线程或报整体成功`, async ({ page }) => {
  await preparePage(page); await page.getByLabel('攻速输入上界', { exact: true }).fill('1');
  await fault(page, mode);
  if (mode === 'stall') await page.clock.install();
  await runButton(page).click();
  if (mode === 'stall') { await expect(page.getByText('正在执行连续普攻', { exact: true })).toBeVisible(); await page.clock.fastForward(30001); }
  await expect(runButton(page)).toBeEnabled();
  await expect(page.getByText('连续普攻已完成击杀，会话正常释放。', { exact: true })).toHaveCount(0);
  if (mode === 'release_fail') {
    await expect(page.getByTestId('continuous-attack-completed-count')).toHaveText('6');
    await expect(page.getByRole('region', { name: '连续普攻结果', exact: true })).toContainText('会话释放失败');
  } else await expect(page.getByRole('region', { name: '连续普攻结果', exact: true })).toContainText('线程已销毁');
  expect((await diagnostics(page)).created).toBe(1);
  expect((await diagnostics(page)).terminated).toBe(1);
  expect((await diagnostics(page)).messages.filter(row => row === 'release')).toHaveLength(mode === 'release_fail' ? 1 : 0);
});

async function holdResult(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/engine/genericEngineClient.ts'; const { GenericEngineClient } = await import(path);
    const original = GenericEngineClient.prototype.run; let calls = 0;
    GenericEngineClient.prototype.run = async function(request: unknown) {
      const result = await original.call(this, request);
      if (++calls !== 1) return result;
      return new Promise(resolve => { (window as unknown as { resumeContinuous: () => void }).resumeContinuous = () => resolve(result); });
    };
  });
}
test('同步双击互斥、输入冻结、取消重跑及迟到结果守卫', async ({ page }) => {
  await preparePage(page); await page.getByLabel('攻速输入上界', { exact: true }).fill('1');
  await fault(page, 'record'); await holdResult(page);
  await runButton(page).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { resumeContinuous: () => void }).resumeContinuous)).toBe('function');
  await expect(page.getByLabel('观察时长（毫秒）', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('攻速输入上界', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '执行一次普攻', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '编译验证', exact: true })).toBeDisabled();
  expect((await diagnostics(page)).created).toBe(1);
  await page.getByRole('button', { name: '取消当前请求', exact: true }).click();
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('999'); await runButton(page).click();
  await expect(page.getByTestId('continuous-attack-completed-count')).toHaveText('1');
  await page.evaluate(() => (window as unknown as { resumeContinuous: () => void }).resumeContinuous());
  await expect(page.getByTestId('continuous-attack-completed-count')).toHaveText('1');
  expect((await diagnostics(page)).created).toBe(2);
  expect((await diagnostics(page)).messages.filter(row => row === 'release')).toHaveLength(1);
});

test('连续运行拒绝离开保留任务，确认离开销毁工作线程', async ({ page }) => {
  await preparePage(page); await page.getByLabel('攻速输入上界', { exact: true }).fill('1');
  await fault(page, 'record'); await holdResult(page); await runButton(page).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { resumeContinuous: () => void }).resumeContinuous)).toBe('function');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '切换到数据管理', exact: true }).click();
  expect((await diagnostics(page)).terminated).toBe(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '切换到数据管理', exact: true }).click();
  await expect(page).toHaveURL(/#\/attributes$/);
  await expect.poll(async () => (await diagnostics(page)).terminated).toBe(1);
  await page.evaluate(() => (window as unknown as { resumeContinuous: () => void }).resumeContinuous());
  await expect(page.getByRole('region', { name: '连续普攻结果', exact: true })).toHaveCount(0);
});

test('连接变更确认后旧连续任务与输入失效，迟到结果不能回流', async ({ page }) => {
  await preparePage(page); await page.getByLabel('攻速输入上界', { exact: true }).fill('1');
  await fault(page, 'record'); await holdResult(page); await runButton(page).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { resumeContinuous: () => void }).resumeContinuous)).toBe('function');
  await page.locator('.app-toolbar-field--api input').fill('http://127.0.0.1:19199');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '应用', exact: true }).click();
  expect((await diagnostics(page)).terminated).toBe(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).terminated).toBe(1);
  await page.evaluate(() => (window as unknown as { resumeContinuous: () => void }).resumeContinuous());
  await expect(page.getByRole('region', { name: '连续普攻结果', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('攻速输入上界', { exact: true })).toHaveCount(0);
  expect((await diagnostics(page)).messages.filter(row => row === 'release')).toHaveLength(0);
});

test('真实只读接口亚托克斯对阿狸：最新原配置经实际页面与最终Wasm连续击杀', async ({ page, request }, testInfo) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实服务专项需显式启用，跳过不算通过');
  const apiBase = process.env.SIMULATION_LIVE_API_BASE_URL || 'http://127.0.0.1:8080';
  const token = process.env.SIMULATION_LIVE_ADMIN_TOKEN;
  const path = '/api/admin/games/lol/simulation-snapshot?' + new URLSearchParams({ sourceCharacterKey: 'champion_aatrox', sourceLevel: '1',
    targetCharacterKey: 'champion_ahri', targetLevel: '1', basicAttackSkillKey: 'shared_basic_attack', basicAttackLevel: '1' });
  const response = await request.get(apiBase + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  expect(response.status()).toBe(200);
  const snapshot = await response.json() as SimulationSnapshot;
  const result = await runSnapshot(page, snapshot, testInfo, {}, 'actual-continuous-run');
  const expected = continuousExpectation(snapshot, result.prepared.attributeInputs);
  const count = expected.count;
  expect(result.assessment).toMatchObject({ complete: true, completedCount: count, durationMs: expected.killedAtMs,
    execution: { targetKilled: true, targetKilledAtMs: expected.killedAtMs } });
  expect(result.assessment.damageDealt).toBeCloseTo(expected.damageTotal, 8);
  expect(result.assessment.hpLoss).toBe(snapshot.target.selectedLevelValues.hp);
  expect(result.done.attackRecords.map((row: { startAtMs: number }) => row.startAtMs)).toEqual(Array.from({ length: count }, (_, index) => index * expected.interval));
  for (const row of result.done.damageRecords) {
    expect(row.postDefenseDamage).toBeCloseTo(expected.resultAmounts.find(value => value.operationRef === row.operationRef)!.amount, 8);
  }
  const expectedPath = testInfo.outputPath('independent-expectation.json');
  writeFileSync(expectedPath, JSON.stringify(expected, null, 2));
  await testInfo.attach('原作者树独立期望.json', { path: expectedPath, contentType: 'application/json' });
  await page.unroute('**/api/games');
  await page.addInitScript(({ apiBase, token }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', apiBase);
    localStorage.setItem('damage-viewer.web.admin-token', token || 'local-readonly-check');
  }, { apiBase, token });
  const methods: string[] = [];
  page.on('request', request => { if (new URL(request.url()).origin === apiBase && request.method() !== 'OPTIONS') methods.push(request.method()); });
  await page.reload();
  await chooseSimulationEntity(page, '攻击方角色', 'champion_aatrox'); await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'champion_ahri'); await chooseSimulationLevel(page, '目标等级', 1);
  await chooseSimulationEntity(page, '普攻技能', 'shared_basic_attack'); await chooseSimulationLevel(page, '普攻技能等级', 1);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  if (snapshot.catalogs.attributes.find(row => row.attributeKey === 'attack_speed')!.maxValue === null) {
    await page.getByLabel('攻速输入上界', { exact: true }).fill(String(snapshot.source.selectedLevelValues.attack_speed));
  }
  await runButton(page).click();
  await expect(page.getByText('连续普攻已完成击杀，会话正常释放。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('continuous-attack-completed-count')).toHaveText(String(count));
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '下载连续运行档案', exact: true }).click();
  const archive = JSON.parse(readFileSync((await (await pending).path())!, 'utf8'));
  expect(archive).toMatchObject({ taskKind: 'continuous_attack', outcome: 'passed', cleanup: 'released', assessment: { complete: true, completedCount: count } });
  expect(archive.assessment.damageDealt).toBeCloseTo(expected.damageTotal, 8);
  expect(JSON.stringify(archive)).not.toMatch(/adminToken|apiBaseUrl|Authorization|Bearer|Cookie|AbortController/);
  const archivePath = testInfo.outputPath('actual-page-continuous-archive.json'); writeFileSync(archivePath, JSON.stringify(archive, null, 2));
  await testInfo.attach('真实页面连续运行档案.json', { path: archivePath, contentType: 'application/json' });
  await page.getByRole('region', { name: '连续普攻结果', exact: true }).screenshot({ path: testInfo.outputPath('真实页面连续普攻结果.png') });
  expect(methods.length).toBeGreaterThan(0); expect(methods.every(method => method === 'GET')).toBe(true);
});
