import { fulfillAuthSession } from '../fixtures/authSession';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { simulationSample } from '../fixtures/simulationSnapshot';
import { chooseSimulationEntity, chooseSimulationLevel, installSimulationSelectionApi } from '../fixtures/simulationSelection';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import type { RecordBudget, SafetyBudget, SamplingConfig } from '../../src/types/genericEngine';
import type { NumericValue } from '../../src/types/numericValue';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { expectSimulationConfigurationReady, isolateCharacterSourcesOnPage, readIsolatedSimulationSnapshot, simulationComparisonSelection, simulationSnapshotWithSelection } from '../fixtures/simulationSnapshotRequests';
import { continuousExpectation } from '../fixtures/continuousExpectation';

test.beforeEach(async ({ page }) => {
  const wasm = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(wasm.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(wasm).digest('hex')).toBe(WASM_IDENTITY.sha256);
  await page.route('**/api/auth/me', route => fulfillAuthSession(route, false).then(() => undefined));
  await page.route('**/api/games', route => route.fulfill({ json: [{ gameId: 'demo', gameName: '独立连续用例', representativeImageKey: null }] }));
  await installSimulationSelectionApi(page, '**', 'demo');
  await page.goto('/#/simulation/basic-attack');
});

test('有限共同普攻独立期望核对原关系，保留倍率夹取暴击且拒绝未知作者结构', () => {
  const snapshot = simulationSample('lol');
  const configuration = snapshot.skillConfigurations[0]!;
  const skillKey = 'shared_basic_attack';
  const formulaKeys: Record<string, string> = { raw: 'attack_damage', interval: 'attack_interval_ms', multiplier: 'critical_multiplier' };
  const parameterKeys: Record<string, string> = { milliseconds: 'milliseconds_per_second', base_multiplier: 'base_critical_multiplier' };
  configuration.skill.skillKey = skillKey;
  snapshot.selection.basicAttackSkillKey = skillKey;
  for (const row of configuration.parameters) { row.skillKey = skillKey; row.parameterKey = parameterKeys[row.parameterKey]!; }
  for (const row of configuration.formulas) {
    row.skillKey = skillKey; row.formulaKey = formulaKeys[row.formulaKey]!;
    for (const input of row.expression.inputs) if (input.binding.kind === 'parameter') {
      input.binding.skillKey = skillKey; input.binding.parameterKey = parameterKeys[input.binding.parameterKey]!;
    }
  }
  const renameNumeric = (value: NumericValue) => {
    if (value.kind === 'FORMULA') value.formulaKey = formulaKeys[value.formulaKey]!;
    else if (value.kind === 'PARAMETER') value.parameterKey = parameterKeys[value.parameterKey]!;
  };
  for (const effect of configuration.effects) {
    effect.skillKey = skillKey;
    for (const result of effect.results) {
      if (result.valueRule) renameNumeric(result.valueRule.value);
      if (result.resultType === 'DAMAGE' && result.detail.critical.multiplierValue) renameNumeric(result.detail.critical.multiplierValue);
    }
  }
  for (const process of configuration.processes) { process.skillKey = skillKey; if (process.cooldown) renameNumeric(process.cooldown.durationValue); }
  Object.assign(snapshot.source.selectedLevelValues, { attack_damage: 100, attack_speed: .8 });
  snapshot.target.selectedLevelValues.armor = 100;
  const inputs = { source: { critical_strike_chance: .25, critical_strike_damage_bonus_percent: .5 }, target: { armor_pen_flat: 0 } };
  expect(continuousExpectation(snapshot, inputs)).toMatchObject({ rawInterval: 1250, interval: 1250, count: 9,
    damagePerAttack: 68.75, damageTotal: 618.75, killedAtMs: 10000 });
  const result = configuration.effects[1]!.results[0]!;
  if (result.resultType !== 'DAMAGE') throw new Error('明确样例缺少原伤害结果。');
  result.valueRule!.fixedMultiplier = 2;
  result.valueRule!.fixedMinValue = 50;
  result.valueRule!.fixedMaxValue = 150;
  expect(continuousExpectation(snapshot, inputs)).toMatchObject({ count: 6, damagePerAttack: 103.125, damageTotal: 618.75, killedAtMs: 6250 });
  result.valueRule!.fixedMultiplier = 1;
  result.valueRule!.fixedMinValue = 200;
  result.valueRule!.fixedMaxValue = null;
  expect(continuousExpectation(snapshot, inputs)).toMatchObject({ count: 5, damagePerAttack: 137.5, damageTotal: 687.5, killedAtMs: 5000 });
  const changed = structuredClone(snapshot);
  changed.skillConfigurations[0]!.formulas[0]!.expression.stages[0]!.expression = { op: 'const', value: '100' };
  expect(() => continuousExpectation(changed, inputs)).toThrow(/运算关系/);
  const foreign = structuredClone(snapshot);
  const binding = foreign.skillConfigurations[0]!.formulas[1]!.expression.inputs.find(input => input.binding.kind === 'parameter')!.binding;
  if (binding.kind === 'parameter') binding.skillKey = 'different_skill';
  expect(() => continuousExpectation(foreign, inputs)).toThrow(/绑定/);
  const dynamic = structuredClone(snapshot);
  dynamic.skillConfigurations[0]!.parameters[0]!.valueMode = 'RUNTIME_INPUT';
  dynamic.skillConfigurations[0]!.parameters[0]!.fixedValue = null;
  expect(() => continuousExpectation(dynamic, inputs)).toThrow(/固定参数目录/);
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
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { preflightSkillFormulas } = await import(preflightPath);
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(proofPath);
    const client = new GenericEngineClient();
    const formulaPreflight = await preflightSkillFormulas(snapshot, client);
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side as 'source' | 'target'][row.attribute.attributeKey] = 0;
    if (options.crit !== undefined) inputs.source.critical_strike_chance = options.crit;
    Object.assign(inputs.source, options.sourceInputs);
    const prepared = await prepareSimulation(snapshot, inputs, { source: options.sourceHp ?? snapshot.source.selectedLevelValues.hp,
      target: options.targetHp ?? snapshot.target.selectedLevelValues.hp });
    const continuous = await continuousAttackRequest(prepared, snapshot,
      { durationMs: options.durationMs ?? 30000, attackSpeedInputMax: options.inputMax ?? snapshot.source.selectedLevelValues.attack_speed, recordTimeSeries: false });
    if (options.recordBudget) continuous.runRequest.recordBudget = options.recordBudget;
    if (options.safetyBudget) Object.assign(continuous.runRequest.safetyBudget, options.safetyBudget);
    if (options.sampling) continuous.runRequest.sampling = options.sampling;
    continuous.runInputHash = await continuousAttackRunInputHash(continuous.runRequest, continuous.attackSpeedAdmission);
    let compileResult, runRequest, done, assessment, error, releaseResult;
    try {
      compileResult = await client.compile(prepared.compileRequest);
      if (!compileResult.ok || !compileResult.sessionId) throw new Error(JSON.stringify(compileResult.errors));
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compileResult.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compileResult.metadata?.approvedStaticValues ?? {});
      runRequest = { ...continuous.runRequest, sessionId: compileResult.sessionId };
      done = await client.run(runRequest);
      assessment = assessContinuousAttackResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins);
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally {
      if (compileResult?.sessionId && client.hasLiveWorker) releaseResult = await client.release(compileResult.sessionId, prepared.compileRequest.rulesHash);
      client.terminate();
    }
    return { prepared, formulaPreflight, continuous, compileResult, runRequest, done, assessment, error, releaseResult, liveWorker: client.hasLiveWorker };
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
  const action = config.triggerRules[1]!.actions[0]!;
  if (action.actionType !== 'EXECUTE_EFFECT') throw new Error('独立命中样例必须为效果执行动作');
  config.triggerRules[1]!.actions.push({ ...structuredClone(action), actionKey: 'repeat_hit', sortOrder: 1 },
    { ...structuredClone(action), actionKey: 'second_hit', sortOrder: 2, detail: { effectKey: 'second_hit' } });
  const one = await runSnapshot(page, snapshot, testInfo, { durationMs: 1000 }, 'first-run');
  const two = await runSnapshot(page, snapshot, testInfo, { durationMs: 1000 }, 'second-run');
  expect(one.done.damageRecords).toHaveLength(6);
  expect(new Set(one.done.damageRecords.map((row: { operationRef: string }) => row.operationRef)).size).toBe(2);
  expect(two.assessment).toEqual(one.assessment);
  expect(two.continuous.runInputHash).toBe(one.continuous.runInputHash);
});

async function preparePage(page: Page, snapshot = sample()) {
  let loaded: SimulationSnapshot | undefined;
  await page.route('**/api/admin/games/demo/simulation-snapshot', route => {
    expect(route.request().method()).toBe('POST');
    loaded = simulationSnapshotWithSelection(snapshot, route.request().postDataJSON());
    return route.fulfill({ json: loaded });
  });
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a'); await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'actor_b'); await chooseSimulationLevel(page, '目标等级', 1);
  await chooseSimulationEntity(page, '普攻技能', 'sample_basic_attack'); await chooseSimulationLevel(page, '普攻技能等级', 1);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expectSimulationConfigurationReady(page);
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  if (!loaded) throw new Error('页面没有实际读取快照。');
  return loaded;
}
async function hasFormulaProof(page: Page, snapshot: SimulationSnapshot) {
  return page.evaluate(async snapshot => {
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { snapshotFormulaProofIdentity } = await import(preflightPath);
    const { matchesFormulaProofScope } = await import(proofPath);
    return matchesFormulaProofScope(snapshotFormulaProofIdentity(snapshot));
  }, snapshot);
}
const runButton = (page: Page) => page.getByRole('button', { name: '连续普攻', exact: true });

test('页面显式上界与生命准入、完整击杀、白名单档案及输入失效', async ({ page }) => {
  let workers = 0; page.on('worker', () => workers++);
  await preparePage(page);
  await expect(page.getByLabel('观察时长（毫秒）', { exact: true })).toHaveValue('30000');
  await runButton(page).click();
  await expect(page.getByText(/属性目录未提供上界，请明确填写/)).toBeVisible();
  expect(workers).toBe(2); // 读取预检与执行准入预检均正常释放，尚未正式运行。
  await page.getByLabel('攻速输入上界', { exact: true }).fill('1');
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('0');
  await runButton(page).click();
  await expect(page.getByText(/目标初始已死亡，不能执行本阶段连续普攻/)).toBeVisible();
  expect(workers).toBe(2);
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
  await expect(page.getByText('输入已修改或正在重新计算；当前显示上一份冻结输入的结果。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('continuous-attack-damage-dealt')).toHaveText('300');
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
      private hasRun = false;
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); state.created++; }
      postMessage(message: { type: string; id?: string; sessionId?: string }) {
        state.messages.push(message.type);
        if (message.type === 'run') this.hasRun = true;
        if (message.type === 'run' && (mode === 'stall' || mode === 'crash')) {
          if (mode === 'crash') queueMicrotask(() => this.onerror?.call(this, new ErrorEvent('error', { message: '专项线程崩溃' })));
          return;
        }
        if (message.type === 'release' && mode === 'release_fail' && this.hasRun) {
          queueMicrotask(() => this.onmessage?.call(this, new MessageEvent('message', { data: { type: 'releaseResult', id: message.id,
            frames: [{ kind: 214, schemaVersion: 1, flags: 0, payload: new TextEncoder().encode(JSON.stringify({ ok: false, released: false, sessionId: message.sessionId })).buffer }] } })));
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
  const snapshot = await preparePage(page); await page.getByLabel('攻速输入上界', { exact: true }).fill('1');
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
  expect((await diagnostics(page)).messages.filter(row => row === 'release')).toHaveLength(mode === 'release_fail' ? 2 : 1);
  expect(await hasFormulaProof(page, snapshot)).toBe(false);
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
  expect((await diagnostics(page)).terminated).toBe(1);
  expect((await diagnostics(page)).messages.filter(row => row === 'release')).toHaveLength(3);
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

test('游戏变更确认后旧连续任务与输入失效，迟到结果不能回流', async ({ page }) => {
  const snapshot = await preparePage(page); await page.getByLabel('攻速输入上界', { exact: true }).fill('1');
  await fault(page, 'record'); await holdResult(page); await runButton(page).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { resumeContinuous: () => void }).resumeContinuous)).toBe('function');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.app-toolbar-field--game .arco-select').click();
  await page.getByRole('option', { name: '未选择', exact: true }).click();
  expect((await diagnostics(page)).terminated).toBe(0);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.app-toolbar-field--game .arco-select').click();
  await page.getByRole('option', { name: '未选择', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).terminated).toBe(1);
  await page.evaluate(() => (window as unknown as { resumeContinuous: () => void }).resumeContinuous());
  await expect(page.getByRole('region', { name: '连续普攻结果', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('攻速输入上界', { exact: true })).toHaveCount(0);
  expect((await diagnostics(page)).messages.filter(row => row === 'release')).toHaveLength(1);
  expect(await hasFormulaProof(page, snapshot)).toBe(false);
});

test('真实只读接口亚托克斯对阿狸：最新原配置经实际页面与最终Wasm连续击杀', async ({ page, request }, testInfo) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实服务专项需显式启用，跳过不算通过');
  const apiBase = process.env.SIMULATION_LIVE_API_BASE_URL || 'http://127.0.0.1:8080';
  const { snapshot, response, path } = await readIsolatedSimulationSnapshot(request, apiBase, simulationComparisonSelection());
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
  await page.unrouteAll({ behavior: 'wait' });
  await page.addInitScript(({ apiBase }) => {
  }, { apiBase });
  const methods: { path: string; method: string }[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === apiBase && request.method() !== 'OPTIONS') methods.push({ path: url.pathname, method: request.method() });
  });
  const httpReads: { method: string; path: string; status: number }[] = [];
  const pageSnapshotReads: Promise<SimulationSnapshot>[] = [];
  page.on('response', response => {
    const url = new URL(response.url());
    const method = response.request().method();
    if (url.origin === apiBase && method !== 'OPTIONS') httpReads.push({ method, path: url.pathname, status: response.status() });
    if (response.url() === apiBase + path && method === 'POST' && response.status() === 200) {
      pageSnapshotReads.push(response.json() as Promise<SimulationSnapshot>);
    }
  });
  await page.reload();
  await chooseSimulationEntity(page, '攻击方角色', 'champion_aatrox'); await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'champion_ahri'); await chooseSimulationLevel(page, '目标等级', 1);
  await chooseSimulationEntity(page, '普攻技能', 'shared_basic_attack'); await chooseSimulationLevel(page, '普攻技能等级', 1);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await isolateCharacterSourcesOnPage(page, snapshot);
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
  // 页面明确保留来源等级；摘要必须对应本次页面实际读取，不能与另一组选项请求混比。
  const pageSnapshots = await Promise.all(pageSnapshotReads);
  expect(pageSnapshots.length).toBeGreaterThanOrEqual(2);
  const pageSnapshot = pageSnapshots[pageSnapshots.length - 1]!;
  expect(archive.snapshotDigest).toBe(pageSnapshot.snapshotDigest);
  expect(archive.runRequest.sampling.disabled).toBe(false);
  expect(archive.assessment.factsValid).toBe(true);
  expect(archive.runResult.seriesSamplingEvidence).toMatchObject({ method: 'uniform_time', requestedSampleEveryMs: 100,
    effectiveSampleEveryMs: 100, maxSeriesPoints: 5000, downsampled: false });
  const points = archive.runResult.series;
  const finalPoint = points[points.length - 1];
  expect(points.length).toBe(Math.floor(expected.killedAtMs / 100) + 1 + (expected.killedAtMs % 100 === 0 ? 0 : 1));
  expect(points[0].timeMs).toBe(0);
  expect(points[0].targetHp).toBeCloseTo(Math.max(0, snapshot.target.selectedLevelValues.hp! - expected.damagePerAttack), 8);
  expect(points[0].sourceDamageDealt).toBeCloseTo(expected.damagePerAttack, 8);
  expect(finalPoint.timeMs).toBe(expected.killedAtMs);
  expect(finalPoint.targetHp).toBe(0);
  expect(finalPoint.sourceDamageDealt).toBeCloseTo(expected.damageTotal, 8);
  expect(finalPoint.sourceCumulativeDps).toBeCloseTo(expected.damageTotal * 1000 / expected.killedAtMs, 8);
  const finalWindowDamage = archive.runResult.damageRecords.filter((row: { source: string; timeMs: number }) =>
    row.source === 'source' && row.timeMs >= Math.max(0, expected.killedAtMs - 1000) && row.timeMs <= expected.killedAtMs)
    .reduce((amount: number, row: { postDefenseDamage: number }) => amount + row.postDefenseDamage, 0);
  expect(finalPoint.sourceWindowDps).toBeCloseTo(finalWindowDamage * 1000 / Math.min(1000, expected.killedAtMs), 8);
  await expect(page.getByTestId('continuous-attack-charts').locator('svg')).toBeVisible();
  await expect(page.getByTestId('continuous-sampling-evidence')).toContainText('返回' + points.length + '／候选' + points.length + '点');
  expect(JSON.stringify(archive)).not.toMatch(/adminToken|apiBaseUrl|Authorization|Bearer|Cookie|AbortController/);
  const archivePath = testInfo.outputPath('actual-page-continuous-archive.json'); writeFileSync(archivePath, JSON.stringify(archive, null, 2));
  await testInfo.attach('真实页面连续运行档案.json', { path: archivePath, contentType: 'application/json' });
  await page.getByRole('region', { name: '连续普攻结果', exact: true }).screenshot({ path: testInfo.outputPath('真实页面连续普攻结果.png') });
  const secondAttack = archive.runResult.attackRecords[1];
  expect(secondAttack).toBeDefined();
  expect(secondAttack.hitAtMs).toBe(expected.interval);
  const chartBounds = await page.getByTestId('continuous-attack-charts').boundingBox();
  await page.getByTestId('continuous-attack-charts').click({ position: {
    x: 70 + (chartBounds!.width - 100) * secondAttack.hitAtMs / expected.killedAtMs, y: 171
  } });
  await expect(page.getByRole('region', { name: '逐刀详情', exact: true })).toContainText(secondAttack.useRef);
  const secondDamage = archive.runResult.damageRecords.find((row: { useRef: string }) => row.useRef === secondAttack.useRef);
  await page.getByRole('button', { name: '结算编号' + secondDamage.damageId, exact: true }).click();
  await expect(page.getByRole('region', { name: '伤害结算详情', exact: true })).toContainText(secondDamage.operationPath);
  await page.getByRole('button', { name: '定位冻结作者与编译节点', exact: true }).click();
  await expect(page.getByText('以下内容来自本次冻结档案，不读取最新管理数据。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭详情', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '逐刀详情', exact: true })).not.toBeVisible();
  await page.getByLabel('伤害率模式', { exact: true }).click();
  await page.getByRole('option', { name: '滚动窗口伤害率', exact: true }).click();
  await page.getByLabel('可见起点（毫秒）', { exact: true }).fill(String(secondAttack.startAtMs));
  const displayedDamage = Number((await page.getByTestId('continuous-attack-damage-dealt').innerText()).replaceAll(',', ''));
  expect(displayedDamage).toBeCloseTo(expected.damageTotal, 5);
  const csvPending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前伤害表CSV', exact: true }).click();
  const csvFile = await csvPending;
  await csvFile.saveAs(testInfo.outputPath('actual-page-filtered-damage.csv'));
  const csvText = readFileSync((await csvFile.path())!, 'utf8');
  const filteredRecords = archive.runResult.damageRecords.filter((row: { timeMs: number }) => row.timeMs >= secondAttack.startAtMs);
  expect(csvText.split('\r\n')).toHaveLength(filteredRecords.length + 1);
  expect(csvText).toContain('已返回伤害记录的当前筛选');
  const filtered = await downloadStage3Archive(page, testInfo.outputPath('actual-page-filtered-archive.json'));
  expect(filtered.runResult).toEqual(archive.runResult);
  expect(filtered.view).toMatchObject({ dpsMode: 'window', timeRangeMs: [secondAttack.startAtMs, expected.killedAtMs] });
  await page.getByRole('region', { name: '连续普攻结果', exact: true }).screenshot({ path: testInfo.outputPath('真实页面窗口伤害率与筛选.png') });
  const readBack = await request.post(apiBase + path, { headers: {  }, data: snapshot.selection });
  expect(readBack.status()).toBe(200);
  expect((await readBack.json()).snapshotDigest).toBe(snapshot.snapshotDigest);
  writeFileSync(testInfo.outputPath('actual-http-readonly-evidence.json'), JSON.stringify({ at: new Date().toISOString(),
    snapshotDigest: snapshot.snapshotDigest, snapshotStatus: response.status(), readBackStatus: readBack.status(), requests: httpReads }, null, 2));
  expect(methods.length).toBeGreaterThan(0); expect(methods.every(row => row.method === (row.path.endsWith('/simulation-snapshot') ? 'POST' : 'GET'))).toBe(true);
  expect(httpReads.length).toBeGreaterThan(0); expect(httpReads.every(row => row.method === (row.path.endsWith('/simulation-snapshot') ? 'POST' : 'GET') && row.status === 200)).toBe(true);
});


async function downloadStage3Archive(page: Page, destination?: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载连续运行档案', exact: true }).click();
  const downloaded = await pending;
  if (destination) await downloaded.saveAs(destination);
  return JSON.parse(readFileSync((await downloaded.path())!, 'utf8'));
}
async function startStage3Page(page: Page, targetHp = 250) {
  const snapshot = sample();
  if (targetHp > snapshot.target.selectedLevelValues.hp!) {
    snapshot.target.selectedLevelValues.hp = targetHp;
    snapshot.target.attributes.levelValues['1']!.hp = targetHp;
  }
  await preparePage(page, snapshot);
  await page.getByLabel('攻速输入上界', { exact: true }).fill('1');
  await page.getByLabel('目标初始当前生命', { exact: true }).fill(String(targetHp));
  await runButton(page).click();
  await expect(page.getByText('连续普攻已完成击杀，会话正常释放。', { exact: true })).toBeVisible();
}

test('阶段3真实Wasm：采样图、真实身份联动、时间筛选、当前表导出和冻结输入', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await startStage3Page(page);
  await expect(page.getByTestId('continuous-attack-charts').locator('svg')).toBeVisible();
  await expect(page.getByTestId('continuous-sampling-evidence')).toContainText('返回21／候选21点');
  const first = await downloadStage3Archive(page, testInfo.outputPath('阶段3完整击杀运行档案.json'));
  expect(first).toMatchObject({ displayDefinitionVersion: 1, outcome: 'passed', assessment: { factsValid: true, complete: true }, view: { dpsMode: 'cumulative' } });
  expect(first.runResult.series[0]).toMatchObject({ timeMs: 0, targetHp: 150, sourceDamageDealt: 100, sourceCumulativeDps: 0 });
  expect(first.runResult.series[first.runResult.series.length - 1]).toMatchObject({ timeMs: 2000, targetHp: 0, sourceDamageDealt: 300, sourceCumulativeDps: 150, sourceWindowDps: 200 });
  const layout = await page.getByRole('region', { name: '连续普攻结果', exact: true }).evaluate(element => {
    const result = element.getBoundingClientRect();
    const chart = element.querySelector('[data-testid="continuous-attack-charts"]')!.getBoundingClientRect();
    const ancestors = [];
    let parent: HTMLElement | null = element as HTMLElement;
    while (parent) {
      const rect = parent.getBoundingClientRect();
      const style = getComputedStyle(parent);
      ancestors.push({ className: parent.className, left: rect.left, right: rect.right, width: rect.width,
        minWidth: style.minWidth, display: style.display, alignItems: style.alignItems });
      parent = parent.parentElement;
    }
    return { viewportWidth: window.innerWidth, resultLeft: result.left, resultRight: result.right, chartRight: chart.right, ancestors };
  });
  await testInfo.attach('阶段3布局边界.json', { body: Buffer.from(JSON.stringify(layout)), contentType: 'application/json' });
  expect(layout.resultRight, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.chartRight).toBeLessThanOrEqual(layout.viewportWidth);
  await page.getByRole('region', { name: '连续普攻结果', exact: true }).screenshot({ path: testInfo.outputPath('阶段3完整击杀图表.png') });
  const chartBounds = await page.getByTestId('continuous-attack-charts').boundingBox();
  await page.getByTestId('continuous-attack-charts').click({ position: { x: 70 + (chartBounds!.width - 100) / 2, y: 171 } });
  await expect(page.getByRole('region', { name: '逐刀详情', exact: true })).toContainText(first.runResult.attackRecords[1].useRef);
  await page.getByRole('button', { name: '关闭详情', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '逐刀详情', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: '查看第2刀', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: '逐刀详情', exact: true })).toContainText(first.runResult.attackRecords[1].useRef);
  await page.getByRole('button', { name: '结算编号2', exact: true }).click();
  await expect(page.getByRole('region', { name: '伤害结算详情', exact: true })).toContainText(first.runResult.damageRecords[1].operationRef);
  await page.getByRole('button', { name: '定位冻结作者与编译节点', exact: true }).click();
  await expect(page.getByText('以下内容来自本次冻结档案，不读取最新管理数据。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByLabel('可见起点（毫秒）', { exact: true }).fill('1000');
  await expect(page.getByTestId('continuous-attack-damage-dealt')).toHaveText('300');
  await expect(page.getByTestId('continuous-breakdown-subtotal')).toHaveText('300');
  await expect(page.getByTestId('continuous-record-subtotal')).toHaveText('200');
  const csvDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '导出当前伤害表CSV', exact: true }).click();
  const downloadedCsv = await csvDownload;
  await downloadedCsv.saveAs(testInfo.outputPath('阶段3时间筛选伤害表.csv'));
  const csvText = readFileSync((await downloadedCsv.path())!, 'utf8');
  expect(csvText.split('\r\n')).toHaveLength(3); expect(csvText).toContain('已返回伤害记录的当前筛选');
  const filtered = await downloadStage3Archive(page, testInfo.outputPath('阶段3时间筛选运行档案.json'));
  expect(filtered.view.timeRangeMs).toEqual([1000, 2000]); expect(filtered.runResult).toEqual(first.runResult);
  await page.getByLabel('A剩余生命', { exact: true }).uncheck();
  expect((await downloadStage3Archive(page)).view.visibleCurves).not.toContain('sourceHp');
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('999');
  await expect(page.getByText('输入已修改或正在重新计算；当前显示上一份冻结输入的结果。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('continuous-attack-damage-dealt')).toHaveText('300');
  await runButton(page).click();
  await expect(page.getByText('连续普攻已完成观察，目标未被击杀，会话正常释放。', { exact: true })).toBeVisible();
  expect((await downloadStage3Archive(page)).view).toMatchObject({ timeRangeMs: [0, 999], sourceKeys: [], selectedAttack: null });
  await page.getByRole('region', { name: '连续普攻结果', exact: true }).screenshot({ path: testInfo.outputPath('阶段3结果与图表.png') });
  expect(errors).toEqual([]);
});

test('阶段3导出全部筛选行而非当前分页，来源筛选不改变总量曲线', async ({ page }) => {
  await startStage3Page(page, 2500);
  await expect(page.getByTestId('continuous-attack-completed-count')).toHaveText('25');
  const baseline = await downloadStage3Archive(page);
  await page.locator('.continuous-source-bar').first().click();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '导出当前攻击表CSV', exact: true }).click();
  expect(readFileSync((await (await pending).path())!, 'utf8').split('\r\n')).toHaveLength(26);
  const filtered = await downloadStage3Archive(page);
  expect(filtered.view.sourceKeys).toHaveLength(1); expect(filtered.runResult).toEqual(baseline.runResult);
  await page.getByLabel('攻击序号筛选', { exact: true }).fill('2');
  await expect(page.getByTestId('continuous-record-subtotal')).toHaveText('100');
  await page.getByRole('button', { name: '清除来源与明细筛选', exact: true }).click();
  await expect(page.getByTestId('continuous-record-subtotal')).toHaveText('2,500');
});

test('阶段3：关闭和开启采样不改变战斗，0毫秒击杀单点不制造伤害率', async ({ page }) => {
  await preparePage(page); await page.getByLabel('攻速输入上界', { exact: true }).fill('1');
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('100');
  await page.getByLabel('记录时间序列', { exact: true }).uncheck(); await runButton(page).click();
  await expect(page.getByText('连续普攻已完成击杀，会话正常释放。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('continuous-attack-charts')).toHaveCount(0);
  const off = await downloadStage3Archive(page);
  expect(off.runResult.series).toEqual([]); expect(off.runResult.summary.execution.targetKilledAtMs).toBe(0);
  await page.getByLabel('记录时间序列', { exact: true }).check(); await runButton(page).click();
  await expect(page.getByTestId('continuous-attack-charts').locator('svg')).toBeVisible();
  const on = await downloadStage3Archive(page);
  expect(on.runResult.series).toHaveLength(1); expect(on.runResult.series[0].sourceCumulativeDps).toBe(0);
  expect(on.runInputHash).not.toBe(off.runInputHash); expect(on.runResult.summary.execution).toEqual(off.runResult.summary.execution);
  expect(on.runResult.attackRecords).toEqual(off.runResult.attackRecords); expect(on.runResult.damageRecords).toEqual(off.runResult.damageRecords);
});

test('阶段3：真实Wasm降采样及攻击记录0预算，击杀与孤立伤害详情仍真实', async ({ page }) => {
  let changedBuilder = false;
  await page.route('**/src/engine/continuousAttackRequest.ts*', async route => {
    if (await fulfillAuthSession(route, false)) return;
    const response = await route.fetch(); const code = await response.text();
    const altered = code.replace(/maxAttackRecords:\s*(?:1000|1e3)/g, 'maxAttackRecords: 0').replace(/maxSeriesPoints:\s*(?:5000|5e3)/g, 'maxSeriesPoints: 10');
    changedBuilder = altered !== code;
    await route.fulfill({ response, body: altered });
  });
  await page.reload(); await startStage3Page(page);
  expect(changedBuilder).toBe(true);
  await expect(page.getByTestId('continuous-sampling-evidence')).toContainText('有效间隔3334毫秒');
  await expect(page.getByTestId('continuous-sampling-evidence')).toContainText('返回2／候选21点');
  const archive = await downloadStage3Archive(page);
  expect(archive.assessment.complete).toBe(true); expect(archive.runResult.attackRecords).toEqual([]);
  expect(archive.runResult.recording.attackRecordsTruncated).toBe(true); expect(archive.runResult.damageRecords).toHaveLength(3);
  expect(archive.runResult.series.map((point: { timeMs: number }) => point.timeMs)).toEqual([0, 2000]);
  await page.getByRole('button', { name: '查看伤害3', exact: true }).click();
  await expect(page.getByRole('region', { name: '逐刀详情', exact: true })).toContainText('该刀攻击记录未保留');
  await expect(page.getByRole('region', { name: '伤害结算详情', exact: true })).toContainText('伤害编号3');
  await expect(page.getByTestId('continuous-attack-killed-at')).toHaveText('2000 毫秒');
});
