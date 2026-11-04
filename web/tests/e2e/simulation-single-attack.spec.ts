import { fulfillAuthSession } from '../fixtures/authSession';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { simulationSample } from '../fixtures/simulationSnapshot';
import { skillFormulaDefinition } from '../fixtures/skillFormulaDefinition';
import { chooseSimulationEntity, chooseSimulationLevel, installSimulationSelectionApi } from '../fixtures/simulationSelection';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { expectSimulationConfigurationReady, isolateCharacterSourcesOnPage, readIsolatedSimulationSnapshot, simulationComparisonSelection, simulationSnapshotWithSelection } from '../fixtures/simulationSnapshotRequests';

test.beforeEach(async ({ page }) => {
  const wasm = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(wasm.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(wasm).digest('hex')).toBe(WASM_IDENTITY.sha256);
  await page.route('**/api/auth/me', route => fulfillAuthSession(route, false).then(() => undefined));
  await page.route('**/api/games', route => route.fulfill({ json: [{ gameId: 'demo', gameName: '独立单次用例', representativeImageKey: null }] }));
  await installSimulationSelectionApi(page, '**', 'demo');
  await page.goto('/#/simulation/basic-attack');
});

function sampleWithDamage(damage = 100, armor = 100) {
  const snapshot = simulationSample();
  snapshot.source.selectedLevelValues.attack_damage = damage;
  snapshot.source.attributes.levelValues['1']!.attack_damage = damage;
  snapshot.target.selectedLevelValues.armor = armor;
  snapshot.target.attributes.levelValues['1']!.armor = armor;
  return snapshot;
}
function sampleWithStaticProof() {
  const snapshot = sampleWithDamage();
  const configuration = snapshot.skillConfigurations[0]!;
  configuration.formulas.push({ ...configuration.formulas[0]!, formulaKey: 'static_factor',
    expression: skillFormulaDefinition(configuration.skill.skillKey, { nodeType: 'PARAMETER', parameterKey: 'base_multiplier' }) });
  return snapshot;
}
async function formulaProofState(page: Page, snapshot: SimulationSnapshot) {
  return page.evaluate(async snapshot => {
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { snapshotFormulaProofIdentity, skillFormulaPreflightRequest } = await import(preflightPath);
    const { matchesFormulaProofScope, registerFormulaForApprovedReads, approvedFormulaValue, collectedCommonFormulaDefinitions } = await import(proofPath);
    const active = matchesFormulaProofScope(snapshotFormulaProofIdentity(snapshot));
    const program = active ? skillFormulaPreflightRequest(snapshot).formulas.find((row: { key: string }) => row.key.endsWith('/static_factor')) : undefined;
    if (active && program) registerFormulaForApprovedReads(program);
    return { active, value: active && program ? approvedFormulaValue(program.key) : null, declarations: collectedCommonFormulaDefinitions().length };
  }, snapshot);
}

async function runSnapshot(page: Page, snapshot: SimulationSnapshot, testInfo: TestInfo,
  input: { source?: Record<string, number>; target?: Record<string, number>; sourceHp?: number; targetHp?: number } = {},
  archiveName = 'single-attack-archive.json') {
  const result = await page.evaluate(async ({ snapshot, input }) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const resultPath = '/src/engine/singleAttackResult.ts';
    const { inspectSimulationSnapshot, prepareSimulation, singleAttackRequest } = await import(adapterPath);
    const { GenericEngineClient } = await import(clientPath);
    const { assessSingleAttackResult } = await import(resultPath);
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { preflightSkillFormulas } = await import(preflightPath);
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(proofPath);
    const client = new GenericEngineClient();
    const formulaPreflight = await preflightSkillFormulas(snapshot, client);
    const inputs: { source: Record<string, number>; target: Record<string, number> } = { source: {}, target: {} };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) {
      if (row.storedValue === undefined) inputs[row.side as 'source' | 'target'][row.attribute.attributeKey] = 0;
    }
    Object.assign(inputs.source, input.source);
    Object.assign(inputs.target, input.target);
    const prepared = await prepareSimulation(snapshot, inputs, {
      source: input.sourceHp ?? snapshot.source.selectedLevelValues.hp,
      target: input.targetHp ?? snapshot.target.selectedLevelValues.hp
    });
    let compileResult, runRequest, done, assessment, error;
    let releaseResult;
    try {
      compileResult = await client.compile(prepared.compileRequest);
      if (!compileResult.ok || !compileResult.sessionId) throw new Error(JSON.stringify(compileResult.errors));
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compileResult.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compileResult.metadata?.approvedStaticValues ?? {});
      runRequest = singleAttackRequest(prepared.compileRequest, compileResult.sessionId);
      done = await client.run(runRequest);
      assessment = assessSingleAttackResult(prepared.compileRequest, runRequest, done);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (compileResult?.sessionId && client.hasLiveWorker) {
        releaseResult = await client.release(compileResult.sessionId, prepared.compileRequest.rulesHash);
      }
      client.terminate();
    }
    return { prepared, formulaPreflight, compileResult, runRequest, done, assessment, error, releaseResult, liveWorker: client.hasLiveWorker };
  }, { snapshot, input });
  const archivePath = testInfo.outputPath(archiveName);
  mkdirSync(dirname(archivePath), { recursive: true });
  writeFileSync(archivePath, JSON.stringify({ snapshot, ...result, wasm: WASM_IDENTITY }, null, 2));
  await testInfo.attach('真实单次运行档案.json', { path: archivePath, contentType: 'application/json' });
  expect(result.error, JSON.stringify(result.done)).toBeUndefined();
  expect(result.assessment?.complete, result.assessment?.issues.join('\n')).toBe(true);
  expect(result.releaseResult).toMatchObject({ released: true, sessionId: result.compileResult.sessionId });
  expect(result.liveWorker).toBe(false);
  return result;
}

for (const row of [
  { name: '基础物理伤害', damage: 100, crit: 0, targetHp: 300, amount: 50, hpLoss: 50, finalHp: 250 },
  { name: '25%期望暴击', damage: 100, crit: 0.25, targetHp: 300, amount: 62.5, hpLoss: 62.5, finalHp: 237.5 },
  { name: '致死与过量伤害', damage: 100, crit: 0, targetHp: 20, amount: 50, hpLoss: 20, finalHp: 0 },
  { name: '明确零伤害仍完成命中', damage: 0, crit: 0, targetHp: 590, amount: 0, hpLoss: 0, finalHp: 590 }
]) {
  test(`${row.name}：真实Worker执行完整作者普攻且正常释放`, async ({ page }, testInfo) => {
    const result = await runSnapshot(page, sampleWithDamage(row.damage), testInfo,
      { source: { critical_strike_chance: row.crit }, targetHp: row.targetHp });
    expect(result.assessment).toMatchObject({ damageDealt: row.amount, hpLoss: row.hpLoss,
      targetInitialHp: row.targetHp, targetFinalHp: row.finalHp, sourceInitialHp: 650, sourceFinalHp: 650, durationMs: 0 });
    expect(result.assessment.stopReason).toBe(row.finalHp === 0 ? 'target_dead' : 'no_events');
    const damage = result.done.evidence.items.find((item: { kind: string }) => item.kind === 'damage');
    expect(damage.data.postDefenseDamage).toBe(row.amount);
    expect(damage.data.actualHpLoss).toBe(row.hpLoss);
    expect(damage.data.overkillDamage).toBe(row.amount - row.hpLoss);
  });
}

test('共同穿甲公式保持作者表达式：100护甲乘80%再减20，最终60护甲', async ({ page }, testInfo) => {
  const snapshot = sampleWithDamage();
  snapshot.catalogs.damageTypes[0]!.formula.formula.stages.find(stage => stage.key === 'effective')!.expression = {
    op: 'sub', args: [
      { op: 'mul', args: [{ op: 'ref', stageKey: 'resistance' }, { op: 'sub', args: [
        { op: 'const', value: '1' }, { op: 'ref', stageKey: 'percent_pen' }
      ] }] }, { op: 'ref', stageKey: 'flat_pen' }
    ]
  };
  const result = await runSnapshot(page, snapshot, testInfo, { source: { armor_pen_percent: 0.2, armor_pen_flat: 20 } });
  expect(result.assessment.damageDealt).toBe(62.5);
  const damage = result.done.evidence.items.find((item: { kind: string }) => item.kind === 'damage');
  expect(damage.data).toMatchObject({ damageType: 'physics', resistanceFactor: 0.625 });
});

test('联动原生次数不是固定1，并保留同次使用和成功过程', async ({ page }, testInfo) => {
  const snapshot = sampleWithDamage();
  snapshot.skillConfigurations[0]!.effects[0]!.results[0]!.valueRule!.value = { kind: 'FIXED', value: 3 };
  snapshot.skillConfigurations[0]!.effects[1]!.results[1]!.valueRule!.value = { kind: 'FIXED', value: 2 };
  const result = await runSnapshot(page, snapshot, testInfo);
  const links = result.done.evidence.items.filter((item: { kind: string }) => item.kind === 'link_application');
  expect(links.map((item: { data: { count: number } }) => item.data.count)).toEqual([3, 2]);
  expect(result.done.finalSnapshot.processInstances).toHaveLength(1);
  expect(result.done.finalSnapshot.processInstances[0]).toMatchObject({ useKey: 'first_attack_use', status: 'complete' });
});

test('显式吸血补充值按实际运行治疗A，不把双方生命设成同值', async ({ page }, testInfo) => {
  const result = await runSnapshot(page, sampleWithDamage(), testInfo, { source: { life_steal_percent: 0.2 }, sourceHp: 600 });
  expect(result.assessment).toMatchObject({ damageDealt: 50, hpLoss: 50, sourceInitialHp: 600, sourceFinalHp: 610, targetFinalHp: 540 });
});

test('零联动仍保留原生应用证据，不制造联动事件', async ({ page }, testInfo) => {
  const snapshot = sampleWithDamage();
  snapshot.skillConfigurations[0]!.effects[0]!.results[0]!.valueRule!.value = { kind: 'FIXED', value: 0 };
  snapshot.skillConfigurations[0]!.effects[1]!.results[1]!.valueRule!.value = { kind: 'FIXED', value: 0 };
  const result = await runSnapshot(page, snapshot, testInfo);
  expect(result.done.evidence.items.filter((item: { kind: string; data: { count: number } }) => item.kind === 'link_application' && item.data.count === 0)).toHaveLength(2);
  expect(result.done.evidence.items.filter((item: { kind: string; ref: string }) => item.kind === 'emitted_event' && /link_applied/.test(item.ref))).toHaveLength(0);
});

test('独立重新编译与运行结果确定，不复用上一刀最终快照', async ({ page }, testInfo) => {
  const one = await runSnapshot(page, sampleWithDamage(), testInfo, { source: { critical_strike_chance: 0.25 } });
  const two = await runSnapshot(page, sampleWithDamage(), testInfo, { source: { critical_strike_chance: 0.25 } }, 'second-single-attack-archive.json');
  expect(two.assessment).toEqual(one.assessment);
});

async function preparePage(page: Page, snapshot = sampleWithDamage(), fillInputs = true) {
  let loaded: SimulationSnapshot | undefined;
  await page.route('**/api/admin/games/demo/simulation-snapshot', route => {
    expect(route.request().method()).toBe('POST');
    loaded = simulationSnapshotWithSelection(snapshot, route.request().postDataJSON());
    return route.fulfill({ json: loaded });
  });
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'actor_b');
  await chooseSimulationLevel(page, '目标等级', 1);
  await chooseSimulationEntity(page, '普攻技能', 'sample_basic_attack');
  await chooseSimulationLevel(page, '普攻技能等级', 1);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expectSimulationConfigurationReady(page);
  if (fillInputs) {
    await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
    await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  }
  if (!loaded) throw new Error('页面没有实际读取快照。');
  return loaded;
}

async function typeHealthWithoutRefocusing(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.click();
  await page.keyboard.press('Control+A');
  for (let index = 0; index < value.length; index++) {
    await page.keyboard.type(value[index]!);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(value.slice(0, index + 1));
  }
}

for (const row of [{ label: '攻击方初始当前生命', value: '420' }, { label: '目标初始当前生命', value: '230' }]) {
  test(`${row.label}逐字符输入、退格和清空不会因读取提示消失而丢焦点`, async ({ page }) => {
    await preparePage(page, sampleWithDamage(), false);
    await expect(page.getByText('已明确确认本次完整技能配置摘要；执行前仍重新读取并逐项核对。', { exact: true })).toBeVisible();
    await typeHealthWithoutRefocusing(page, row.label, row.value);
    const input = page.getByLabel(row.label, { exact: true });
    await page.keyboard.press('Backspace');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(row.value.slice(0, -1));
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await page.keyboard.type('0');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('0');
  });
}

test('已有单次结果时逐字符修改目标生命保留焦点，旧结果失效且零生命校验不变', async ({ page }) => {
  await preparePage(page);
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
  await typeHealthWithoutRefocusing(page, '目标初始当前生命', '230');
  await expect(page.getByRole('region', { name: '单次普攻结果', exact: true })).toHaveCount(0);
  await typeHealthWithoutRefocusing(page, '目标初始当前生命', '0');
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByText('initialHealth.target: 目标初始已死亡，不能执行本阶段单次普攻。', { exact: true })).toBeVisible();
  await typeHealthWithoutRefocusing(page, '目标初始当前生命', '230');
  await expect(page.getByText('initialHealth.target: 目标初始已死亡，不能执行本阶段单次普攻。', { exact: true })).toHaveCount(0);
});

test('页面一刀得到50伤害与590→540，下载档案不含连接或认证信息，改输入后旧结果失效', async ({ page }) => {
  await preparePage(page);
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('single-attack-damage-dealt')).toHaveText('50');
  await expect(page.getByTestId('single-attack-hp-loss')).toHaveText('50');
  await expect(page.getByTestId('single-attack-target-initial-hp')).toHaveText('590');
  await expect(page.getByTestId('single-attack-target-final-hp')).toHaveText('540');
  await expect(page.getByText('清理状态：会话已正常释放，线程已结束。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下载编译请求', exact: true })).toBeHidden();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载单次运行档案', exact: true }).click();
  const download = await downloadPromise;
  const archive = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(archive).toMatchObject({ taskKind: 'single_attack', outcome: 'passed', cleanup: 'released', assessment: { complete: true, damageDealt: 50 } });
  expect(JSON.stringify(archive)).not.toMatch(/adminToken|apiBaseUrl|Authorization|Bearer|Cookie|AbortController/);
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('500');
  await expect(page.getByRole('region', { name: '单次普攻结果', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByTestId('single-attack-target-final-hp')).toHaveText('450');
});

test('零生命仅拒绝阶段1运行，保留输入且现有编译验证仍可用', async ({ page }) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  await preparePage(page);
  for (const label of ['攻击方', '目标']) {
    await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
    await page.getByLabel(`${label}初始当前生命`, { exact: true }).fill('0');
    await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
    await expect(page.getByText(`${label === '攻击方' ? 'initialHealth.source' : 'initialHealth.target'}: ${label}初始已死亡，不能执行本阶段单次普攻。`, { exact: true })).toBeVisible();
    await expect(page.getByLabel(`${label}初始当前生命`, { exact: true })).toHaveValue('0');
    await expect(page.getByRole('region', { name: '单次普攻结果', exact: true })).toHaveCount(0);
  }
  expect(workers).toHaveLength(1); // 读取快照已完成真实公式预检；零生命没有新增运行线程。
  await page.getByRole('button', { name: '编译验证', exact: true }).click();
  await expect(page.getByText('仅编译验证通过，不代表单次/连续计算通过。', { exact: true })).toBeVisible();
});

type WorkerMode = 'record' | 'stall' | 'crash' | 'run_error' | 'release_fail' | 'release_fail_once' | 'missing_warnings' | 'truncated' | 'budget';
type WorkerDiagnostics = { created: number; terminated: number; messages: string[]; sessions: string[]; releasedSessions: string[] };

/** 错误注入只用于页面收尾验证；初始化与编译仍由真正Worker/Wasm完成。 */
async function instrumentWorker(page: Page, mode: WorkerMode) {
  await page.evaluate(mode => {
    const NativeWorker = window.Worker;
    const state = { created: 0, terminated: 0, messages: [] as string[], sessions: [] as string[], releasedSessions: [] as string[], releaseFaults: 0 };
    (window as unknown as { singleAttackWorkers: WorkerDiagnostics }).singleAttackWorkers = state;
    window.Worker = class extends NativeWorker {
      private hasRun = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        state.created += 1;
        this.addEventListener('message', event => {
          if (event.data.type === 'compileResult') {
            const resultFrame = event.data.frames.find((row: { kind: number }) => row.kind === 210);
            if (resultFrame) {
              const result = JSON.parse(new TextDecoder().decode(new Uint8Array(resultFrame.payload)));
              if (result.ok && result.sessionId) state.sessions.push(result.sessionId);
            }
          }
          if (event.data.type !== 'runResult') return;
          const frame = event.data.frames.find((row: { kind: number }) => row.kind === 211);
          if (!frame || !['missing_warnings', 'truncated', 'budget'].includes(mode)) return;
          const done = JSON.parse(new TextDecoder().decode(new Uint8Array(frame.payload)));
          if (mode === 'missing_warnings') delete done.warnings;
          if (mode === 'truncated') { done.summary.evidenceTruncated = true; done.evidence.truncated = true; }
          if (mode === 'budget') done.summary.stopReason = 'budget_exceeded';
          frame.payload = new TextEncoder().encode(JSON.stringify(done)).buffer;
        });
      }
      postMessage(message: { type: string; id?: string; sessionId?: string }) {
        state.messages.push(message.type);
        if (message.type === 'release' && message.sessionId) state.releasedSessions.push(message.sessionId);
        if (message.type === 'run') this.hasRun = true;
        if (message.type === 'run' && ['stall', 'crash', 'run_error'].includes(mode)) {
          if (mode === 'crash') queueMicrotask(() => this.onerror?.call(this, new ErrorEvent('error', { message: '专项线程崩溃' })));
          if (mode === 'run_error') queueMicrotask(() => this.onmessage?.call(this, new MessageEvent('message', {
            data: { type: 'error', id: message.id, message: '专项运行错误' }
          })));
          return;
        }
        if (message.type === 'release' && ['release_fail', 'release_fail_once'].includes(mode) && this.hasRun
          && (mode === 'release_fail' || state.releaseFaults === 0)) {
          state.releaseFaults++;
          queueMicrotask(() => this.onmessage?.call(this, new MessageEvent('message', { data: {
            type: 'releaseResult', id: message.id, frames: [{ schemaVersion: 1, kind: 214, flags: 0,
              payload: new TextEncoder().encode(JSON.stringify({ ok: false, released: false, sessionId: message.sessionId })).buffer }]
          } })));
          return;
        }
        super.postMessage(message);
      }
      terminate() { state.terminated += 1; super.terminate(); }
    };
  }, mode);
}

const workerDiagnostics = (page: Page) => page.evaluate(() =>
  (window as unknown as { singleAttackWorkers: WorkerDiagnostics }).singleAttackWorkers);

for (const mode of ['crash', 'stall', 'run_error', 'release_fail', 'missing_warnings', 'truncated', 'budget'] as const) {
  test(`${mode}故障：页面不误报通过，不重建空线程释放旧会话`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const snapshot = await preparePage(page);
    await instrumentWorker(page, mode);
    if (mode === 'stall') await page.clock.install();
    await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
    if (mode === 'stall') {
      await expect(page.getByText('正在执行一次普攻', { exact: true })).toBeVisible();
      await page.clock.fastForward(30_001);
    }
    await expect(page.getByRole('button', { name: '执行一次普攻', exact: true })).toBeEnabled();
    const region = page.getByRole('region', { name: '单次普攻结果', exact: true });
    await expect(region).toBeVisible();
    await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toHaveCount(0);
    if (['crash', 'stall'].includes(mode)) {
      await expect(region).toContainText('线程已销毁，未进行正常会话释放');
    } else if (mode === 'release_fail') {
      await expect(region).toContainText('会话释放失败，线程已结束');
      await expect(page.getByTestId('single-attack-damage-dealt')).toHaveText('50');
    } else if (['truncated', 'budget'].includes(mode)) {
      await expect(region).toContainText('单次执行未完整验证');
      await expect(page.getByTestId('single-attack-damage-dealt')).toHaveText('50');
    } else {
      await expect(region).toContainText('尚无有效运行结果');
      await expect(page.getByTestId('single-attack-damage-dealt')).toHaveCount(0);
    }
    const state = await workerDiagnostics(page);
    expect(state.created).toBe(1); // 真实预检和正式运行借用同一线程，各自重新编译释放。
    expect(state.terminated).toBe(['crash', 'stall', 'release_fail'].includes(mode) ? 1 : 0);
    expect(state.messages.filter(item => item === 'run')).toHaveLength(1);
    expect(state.messages.filter(item => item === 'release')).toHaveLength(['crash', 'stall'].includes(mode) ? 1 : 2);
    expect(await formulaProofState(page, snapshot)).toMatchObject({ active: false, value: null, declarations: 0 });
    expect(errors).toEqual([]);
  });
}

async function holdFirstRunResponse(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/engine/genericEngineClient.ts';
    const { GenericEngineClient } = await import(path);
    const original = GenericEngineClient.prototype.run;
    let calls = 0;
    GenericEngineClient.prototype.run = async function(request: unknown) {
      const result = await original.call(this, request);
      if (++calls !== 1) return result;
      return new Promise(resolve => {
        (window as unknown as { resumeOldRun: () => void }).resumeOldRun = () => resolve(result);
      });
    };
  });
}

test('取消后可重跑，重复点击只有一项运行，旧结果迟到不覆盖新结果', async ({ page }) => {
  const snapshot = await preparePage(page, sampleWithStaticProof());
  await instrumentWorker(page, 'record');
  await holdFirstRunResponse(page);
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { resumeOldRun: () => void }).resumeOldRun)).toBe('function');
  expect((await workerDiagnostics(page)).created).toBe(1);
  const originalProof = await formulaProofState(page, snapshot);
  expect(originalProof.active).toBe(true);
  expect(originalProof.value).not.toBeNull();
  await expect(page.getByLabel('目标初始当前生命', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '取消当前请求', exact: true }).click();
  await expect(page.getByText('当前任务已取消，未完成单次运行验证。', { exact: true })).toBeVisible();
  await expect(page.getByLabel('目标初始当前生命', { exact: true })).toHaveValue('590');
  expect(await formulaProofState(page, snapshot)).toMatchObject({ active: false, value: null, declarations: 0 });
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('500');
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByTestId('single-attack-target-final-hp')).toHaveText('450');
  await page.evaluate(() => (window as unknown as { resumeOldRun: () => void }).resumeOldRun());
  await expect(page.getByTestId('single-attack-target-final-hp')).toHaveText('450');
  await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
  expect(await formulaProofState(page, snapshot)).toMatchObject({ active: true, value: originalProof.value });
  const state = await workerDiagnostics(page);
  expect(state.created).toBe(2);
  expect(state.terminated).toBe(1);
  expect(state.messages.filter(item => item === 'run')).toHaveLength(2);
  expect(state.messages.filter(item => item === 'release')).toHaveLength(3);
});

test('运行中拒绝离开保留任务，确认切模式后终止线程且旧结果不会回流', async ({ page }) => {
  const snapshot = await preparePage(page);
  await instrumentWorker(page, 'record');
  await holdFirstRunResponse(page);
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { resumeOldRun: () => void }).resumeOldRun)).toBe('function');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '切换到数据管理', exact: true }).click();
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  expect((await workerDiagnostics(page)).terminated).toBe(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '切换到数据管理', exact: true }).click();
  await expect(page).toHaveURL(/#\/attributes$/);
  await expect.poll(async () => (await workerDiagnostics(page)).terminated).toBe(1);
  await page.evaluate(() => (window as unknown as { resumeOldRun: () => void }).resumeOldRun());
  await expect(page.getByRole('region', { name: '单次普攻结果', exact: true })).toHaveCount(0);
  expect((await workerDiagnostics(page)).messages.filter(item => item === 'release')).toHaveLength(1);
  expect(await formulaProofState(page, snapshot)).toMatchObject({ active: false, declarations: 0 });
});

test('正常跨任务只保留一个工作线程，每轮重新编译释放，空闲离开仍销毁', async ({ page }) => {
  await preparePage(page, sampleWithStaticProof());
  await instrumentWorker(page, 'record');
  const run = page.getByRole('button', { name: '执行一次普攻', exact: true });
  for (let iteration = 0; iteration < 2; iteration++) {
    await run.click();
    await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
    await expect(run).toBeEnabled();
    await expect(page.getByTestId('single-attack-target-final-hp')).toHaveText('540');
  }
  const state = await workerDiagnostics(page);
  expect(state.created).toBe(1);
  expect(state.terminated).toBe(0);
  expect(state.messages.filter(item => item === 'init')).toHaveLength(1);
  expect(state.messages.filter(item => item === 'compile')).toHaveLength(4);
  expect(state.messages.filter(item => item === 'run')).toHaveLength(2);
  expect(state.messages.filter(item => item === 'release')).toHaveLength(4);
  expect(state.sessions).toHaveLength(4);
  expect(new Set(state.sessions).size).toBe(4);
  expect(state.releasedSessions).toEqual(state.sessions);
  await page.getByRole('button', { name: '切换到数据管理', exact: true }).click();
  await expect(page).toHaveURL(/#\/attributes$/);
  await expect.poll(async () => (await workerDiagnostics(page)).terminated).toBe(1);
});

test('游戏变化清理已完成任务留下的空闲工作线程', async ({ page }) => {
  const snapshot = await preparePage(page, sampleWithStaticProof());
  await instrumentWorker(page, 'record');
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
  expect((await workerDiagnostics(page)).terminated).toBe(0);
  await page.locator('.app-toolbar-field--game .arco-select').click();
  await page.getByRole('option', { name: '未选择', exact: true }).click();
  await expect.poll(async () => (await workerDiagnostics(page)).terminated).toBe(1);
  expect(await formulaProofState(page, snapshot)).toMatchObject({ active: false, declarations: 0 });
});

test('释放失败废弃旧计算线程，下一项任务重新建线程并正常完成', async ({ page }, info) => {
  await preparePage(page, sampleWithStaticProof());
  await instrumentWorker(page, 'release_fail_once');
  const run = page.getByRole('button', { name: '执行一次普攻', exact: true });
  await run.click();
  await expect(run).toBeEnabled();
  await expect(page.getByRole('region', { name: '单次普攻结果', exact: true })).toContainText('会话释放失败');
  expect(await workerDiagnostics(page)).toMatchObject({ created: 1, terminated: 1 });
  await run.click();
  await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('single-attack-target-final-hp')).toHaveText('540');
  const state = await workerDiagnostics(page);
  expect(state).toMatchObject({ created: 2, terminated: 1 });
  expect(state.messages.filter(item => item === 'release')).toHaveLength(4);
  await info.attach('释放失败后新实例恢复.json', { body: JSON.stringify(state), contentType: 'application/json' });
});

test('桥接异常陷阱废弃实例，下一项任务可重新编译运行释放', async ({ page }, info) => {
  await preparePage(page, sampleWithStaticProof());
  await instrumentWorker(page, 'record');
  let inject = true;
  await page.route('**/src/workers/genericEngineWorker.ts*', async route => {
    if (await fulfillAuthSession(route, false)) return;
    const response = await route.fetch();
    if (!inject) { await route.fulfill({ response }); return; }
    inject = false;
    const fault = '\nTinyGoV2Bridge.prototype.run = function() { throw new WebAssembly.RuntimeError("专项Wasm异常陷阱"); };\n';
    await route.fulfill({ response, body: await response.text() + fault });
  });
  const run = page.getByRole('button', { name: '执行一次普攻', exact: true });
  await run.click();
  await expect(run).toBeEnabled();
  await expect(page.getByText(/专项Wasm异常陷阱/).first()).toBeVisible();
  await expect(page.getByRole('region', { name: '单次普攻结果', exact: true })).toContainText('线程已销毁');
  expect(await workerDiagnostics(page)).toMatchObject({ created: 1, terminated: 1 });
  await run.click();
  await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('single-attack-target-final-hp')).toHaveText('540');
  const state = await workerDiagnostics(page);
  expect(state).toMatchObject({ created: 2, terminated: 1 });
  expect(state.messages.filter(item => item === 'release')).toHaveLength(3);
  await info.attach('桥接陷阱后新实例恢复.json', { body: JSON.stringify(state), contentType: 'application/json' });
});

test('最终原生编译失败清除成功预检缓存，保留输入并在重试时重新核定', async ({ page }, info) => {
  const snapshot = await preparePage(page, sampleWithStaticProof());
  const initialProof = await formulaProofState(page, snapshot);
  expect(initialProof.active).toBe(true);
  expect(initialProof.value).not.toBeNull();
  await page.evaluate(async () => {
    const clientPath = '/src/engine/genericEngineClient.ts';
    const { GenericEngineClient } = await import(clientPath);
    const original = GenericEngineClient.prototype.compile;
    const trace = { preflights: [] as unknown[], finals: [] as unknown[] };
    (window as unknown as { formulaCleanupTrace: typeof trace }).formulaCleanupTrace = trace;
    let failFinal = true;
    GenericEngineClient.prototype.compile = async function(request: import('../../src/types/genericEngine').CompileRequest) {
      const isPreflight = request.rulesHash === 'skill-formula-preflight';
      let input = request;
      if (!isPreflight && failFinal) {
        failFinal = false;
        input = structuredClone(request);
        input.formulas![0]!.expression.outputStageKey = 'deliberate_missing_stage';
      }
      const result = await original.call(this, input);
      (isPreflight ? trace.preflights : trace.finals).push(result);
      return result;
    };
  });
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByText(/^\/formulas\/0\/expression\/outputStageKey: FORMULA_UNKNOWN_STAGE/)).toBeVisible();
  await expect(page.getByRole('button', { name: '执行一次普攻', exact: true })).toBeEnabled();
  expect(await formulaProofState(page, snapshot)).toMatchObject({ active: false, value: null, declarations: 0 });
  await expect(page.getByLabel('目标初始当前生命', { exact: true })).toHaveValue('590');
  await expect(page.getByLabel('攻击方补充属性 critical_strike_chance', { exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
  expect(await formulaProofState(page, snapshot)).toMatchObject({ active: true, value: initialProof.value });
  await expect(page.getByTestId('single-attack-target-final-hp')).toHaveText('540');
  const trace = await page.evaluate(() => (window as unknown as { formulaCleanupTrace: { preflights: Array<{ ok: boolean }>; finals: Array<{ ok: boolean }> } }).formulaCleanupTrace);
  expect(trace.preflights).toHaveLength(2);
  expect(trace.preflights.every(row => row.ok)).toBe(true);
  expect(trace.finals.map(row => row.ok)).toEqual([false, true]);
  await info.attach('失败清理与真实原生重新预检.json', { body: JSON.stringify({ initialProof, trace, wasm: WASM_IDENTITY }), contentType: 'application/json' });
});

test('成功预检的空闲场景在选择变更、卸载及游戏切换时清空所属缓存', async ({ page }) => {
  const fixture = sampleWithStaticProof();
  let snapshot = await preparePage(page, fixture);
  expect((await formulaProofState(page, snapshot)).value).not.toBeNull();
  await chooseSimulationEntity(page, '攻击方角色', 'actor_b');
  expect(await formulaProofState(page, snapshot)).toMatchObject({ active: false, declarations: 0 });
  snapshot = await preparePage(page, fixture, false);
  expect((await formulaProofState(page, snapshot)).value).not.toBeNull();
  await page.getByRole('button', { name: '切换到数据管理', exact: true }).click();
  await expect(page).toHaveURL(/#\/attributes$/);
  expect(await formulaProofState(page, snapshot)).toMatchObject({ active: false, declarations: 0 });
  await page.goto('/#/simulation/basic-attack');
  snapshot = await preparePage(page, fixture, false);
  expect((await formulaProofState(page, snapshot)).value).not.toBeNull();
  await page.locator('.app-toolbar-field--game .arco-select').click();
  await page.getByRole('option', { name: '未选择', exact: true }).click();
  expect(await formulaProofState(page, snapshot)).toMatchObject({ active: false, declarations: 0 });
});

test('重新读场景失败或取消保留既有补充值和初始生命', async ({ page }) => {
  await preparePage(page);
  await page.getByLabel('攻击方补充属性 critical_strike_chance', { exact: true }).fill('0.25');
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('500');
  await page.route('**/api/admin/games/demo/simulation-snapshot', route => route.fulfill({ status: 500, json: { error: { code: 'READ_FAILED', message: '本次场景读取失败' } } }));
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expect(page.getByText(/本次场景读取失败/)).toBeVisible();
  await expect(page.getByLabel('攻击方补充属性 critical_strike_chance', { exact: true })).toHaveValue('0.25');
  await expect(page.getByLabel('目标初始当前生命', { exact: true })).toHaveValue('500');
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/admin/games/demo/simulation-snapshot', async route => {
    if (await fulfillAuthSession(route, false)) return;
    await gate;
    await route.fulfill({ json: simulationSnapshotWithSelection(sampleWithDamage(), route.request().postDataJSON()) }).catch(() => undefined);
  });
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expect(page.getByText('正在读取场景快照', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消当前请求', exact: true }).click();
  finish();
  await expect(page.getByLabel('攻击方补充属性 critical_strike_chance', { exact: true })).toHaveValue('0.25');
  await expect(page.getByLabel('目标初始当前生命', { exact: true })).toHaveValue('500');
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByTestId('single-attack-target-final-hp')).toHaveText('437.5');
});

test('真实只读接口亚托克斯对阿狸的完整共享普攻进入最终Wasm单次运行', async ({ page, request }, testInfo) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实服务专项需显式启用，跳过不是运行通过证据');
  const apiBase = process.env.SIMULATION_LIVE_API_BASE_URL || 'http://127.0.0.1:8080';
  const { snapshot } = await readIsolatedSimulationSnapshot(request, apiBase, simulationComparisonSelection());
  const basicAttack = snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === snapshot.selection.basicAttackSkillKey)!;
  expect(basicAttack.effects).toHaveLength(2);
  expect(basicAttack.triggerRules).toHaveLength(2);
  const result = await runSnapshot(page, snapshot, testInfo);
  const expectedDamage = snapshot.source.selectedLevelValues.attack_damage! * 100 / (100 + snapshot.target.selectedLevelValues.armor!);
  expect(result.assessment.damageDealt).toBeCloseTo(expectedDamage, 8);
  expect(result.assessment.hpLoss).toBeCloseTo(expectedDamage, 8);
  expect(result.assessment.sourceFinalHp).toBe(snapshot.source.selectedLevelValues.hp);
  expect(result.assessment.targetFinalHp).toBeCloseTo(snapshot.target.selectedLevelValues.hp! - expectedDamage, 8);
  const multiplier = basicAttack.parameters.find(row => row.parameterKey === 'base_critical_multiplier');
  expect(multiplier?.valueMode).toBe('FIXED');
  expect(typeof multiplier?.fixedValue).toBe('number');
  const crit = await runSnapshot(page, snapshot, testInfo, { source: { critical_strike_chance: 0.25 } }, 'actual-25pct-crit-archive.json');
  expect(crit.assessment.damageDealt).toBeCloseTo(expectedDamage * (1 + 0.25 * (multiplier!.fixedValue! - 1)), 8);
  // 同时走正式页面的真实目录、头像及快照读取，不拦截Wasm消息或伪造运行结果。
  await page.unroute('**/api/games');
  await page.addInitScript(({ apiBase }) => {
  }, { apiBase });
  const methods: { path: string; method: string }[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === apiBase && request.method() !== 'OPTIONS') methods.push({ path: url.pathname, method: request.method() });
  });
  await page.reload();
  await chooseSimulationEntity(page, '攻击方角色', 'champion_aatrox');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'champion_ahri');
  await chooseSimulationLevel(page, '目标等级', 1);
  await chooseSimulationEntity(page, '普攻技能', 'shared_basic_attack');
  await chooseSimulationLevel(page, '普攻技能等级', 1);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await isolateCharacterSourcesOnPage(page, snapshot);
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
  expect(Number((await page.getByTestId('single-attack-damage-dealt').innerText()).replaceAll(',', ''))).toBeCloseTo(expectedDamage, 5);
  await page.getByRole('region', { name: '单次普攻结果', exact: true }).screenshot({ path: testInfo.outputPath('真实页面单次普攻结果.png') });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载单次运行档案', exact: true }).click();
  const archive = JSON.parse(readFileSync((await (await downloadPromise).path())!, 'utf8'));
  expect(archive).toMatchObject({ taskKind: 'single_attack', outcome: 'passed', cleanup: 'released', assessment: { complete: true } });
  expect(archive.assessment.damageDealt).toBeCloseTo(expectedDamage, 8);
  expect(JSON.stringify(archive)).not.toMatch(/adminToken|apiBaseUrl|Authorization|Bearer|Cookie|AbortController/);
  const archivePath = testInfo.outputPath('actual-page-single-attack-archive.json');
  writeFileSync(archivePath, JSON.stringify(archive, null, 2));
  await testInfo.attach('正式页面运行档案.json', { path: archivePath, contentType: 'application/json' });
  expect(methods.length).toBeGreaterThan(0);
  expect(methods.every(row => row.method === (row.path.endsWith('/simulation-snapshot') ? 'POST' : 'GET'))).toBe(true);
});
