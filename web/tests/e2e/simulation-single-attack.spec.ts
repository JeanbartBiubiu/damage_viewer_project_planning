import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { simulationSample } from '../fixtures/simulationSnapshot';
import { chooseSimulationEntity, chooseSimulationLevel, installSimulationSelectionApi } from '../fixtures/simulationSelection';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';

test.beforeEach(async ({ page }) => {
  const wasm = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(wasm.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(wasm).digest('hex')).toBe(WASM_IDENTITY.sha256);
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
    const client = new GenericEngineClient();
    let compileResult, runRequest, done, assessment, error;
    let releaseResult;
    try {
      compileResult = await client.compile(prepared.compileRequest);
      if (!compileResult.ok || !compileResult.sessionId) throw new Error(JSON.stringify(compileResult.errors));
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
    return { prepared, compileResult, runRequest, done, assessment, error, releaseResult, liveWorker: client.hasLiveWorker };
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

test('五阶段穿甲保持作者公式：100护甲乘80%再减20，最终60护甲', async ({ page }, testInfo) => {
  const snapshot = sampleWithDamage();
  snapshot.catalogs.damageTypes[0]!.formula!.formula.effectiveResistance = {
    nodeType: 'OPERATION', operation: 'SUBTRACT', operands: [
      { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
        { nodeType: 'STAGE_RESULT', stageKey: 'RESISTANCE_BEFORE_PENETRATION' },
        { nodeType: 'OPERATION', operation: 'SUBTRACT', operands: [
          { nodeType: 'FIXED', value: 1 }, { nodeType: 'STAGE_RESULT', stageKey: 'PENETRATION_PERCENT' }
        ] }
      ] },
      { nodeType: 'STAGE_RESULT', stageKey: 'PENETRATION_FLAT' }
    ]
  };
  const result = await runSnapshot(page, snapshot, testInfo, { source: { armor_pen_percent: 0.2, armor_pen_flat: 20 } });
  expect(result.assessment.damageDealt).toBe(62.5);
  const damage = result.done.evidence.items.find((item: { kind: string }) => item.kind === 'damage');
  expect(damage.data).toMatchObject({ resistanceBeforePenetration: 100, penetrationPercent: 0.2,
    penetrationFlat: 20, effectiveResistance: 60, resistanceFactor: 0.625 });
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

async function preparePage(page: Page, snapshot = sampleWithDamage()) {
  await page.route('**/api/admin/games/demo/simulation-snapshot?**', route => route.fulfill({ json: snapshot }));
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'actor_b');
  await chooseSimulationLevel(page, '目标等级', 1);
  await chooseSimulationEntity(page, '普攻技能', 'sample_basic_attack');
  await chooseSimulationLevel(page, '普攻技能等级', 1);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
}

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
  expect(workers).toHaveLength(0);
  await page.getByRole('button', { name: '编译验证', exact: true }).click();
  await expect(page.getByText('仅编译验证通过，不代表单次/连续计算通过。', { exact: true })).toBeVisible();
});

type WorkerMode = 'record' | 'stall' | 'crash' | 'run_error' | 'release_fail' | 'missing_warnings' | 'truncated' | 'budget';
type WorkerDiagnostics = { created: number; terminated: number; messages: string[] };

/** 错误注入只用于页面收尾验证；初始化与编译仍由真正Worker/Wasm完成。 */
async function instrumentWorker(page: Page, mode: WorkerMode) {
  await page.evaluate(mode => {
    const NativeWorker = window.Worker;
    const state = { created: 0, terminated: 0, messages: [] as string[] };
    (window as unknown as { singleAttackWorkers: WorkerDiagnostics }).singleAttackWorkers = state;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        state.created += 1;
        this.addEventListener('message', event => {
          if (event.data.type !== 'runResult') return;
          const frame = event.data.frames.find((row: { kind: number }) => row.kind === 211);
          if (!frame || !['missing_warnings', 'truncated', 'budget'].includes(mode)) return;
          const done = JSON.parse(new TextDecoder().decode(new Uint8Array(frame.payload)));
          if (mode === 'missing_warnings') delete done.warnings;
          if (mode === 'truncated') { done.summary.evidenceTruncated = true; done.evidence.truncated = true; }
          if (mode === 'budget') done.summary.stopReason = 'budget_exceeded';
          frame.payload = Array.from(new TextEncoder().encode(JSON.stringify(done)));
        });
      }
      postMessage(message: { type: string; id?: string; sessionId?: string }) {
        state.messages.push(message.type);
        if (message.type === 'run' && ['stall', 'crash', 'run_error'].includes(mode)) {
          if (mode === 'crash') queueMicrotask(() => this.onerror?.call(this, new ErrorEvent('error', { message: '专项线程崩溃' })));
          if (mode === 'run_error') queueMicrotask(() => this.onmessage?.call(this, new MessageEvent('message', {
            data: { type: 'error', id: message.id, message: '专项运行错误' }
          })));
          return;
        }
        if (message.type === 'release' && mode === 'release_fail') {
          queueMicrotask(() => this.onmessage?.call(this, new MessageEvent('message', { data: {
            type: 'releaseResult', id: message.id, frames: [{ schemaVersion: 1, kind: 214, flags: 0,
              payload: Array.from(new TextEncoder().encode(JSON.stringify({ ok: false, released: false, sessionId: message.sessionId }))) }]
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
    await preparePage(page);
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
    expect(state.created).toBe(1);
    expect(state.terminated).toBe(1);
    expect(state.messages.filter(item => item === 'run')).toHaveLength(1);
    expect(state.messages.filter(item => item === 'release')).toHaveLength(['crash', 'stall'].includes(mode) ? 0 : 1);
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
  await preparePage(page);
  await instrumentWorker(page, 'record');
  await holdFirstRunResponse(page);
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { resumeOldRun: () => void }).resumeOldRun)).toBe('function');
  expect((await workerDiagnostics(page)).created).toBe(1);
  await expect(page.getByLabel('目标初始当前生命', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '取消当前请求', exact: true }).click();
  await expect(page.getByText('当前任务已取消，未完成单次运行验证。', { exact: true })).toBeVisible();
  await expect(page.getByLabel('目标初始当前生命', { exact: true })).toHaveValue('590');
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('500');
  await page.getByRole('button', { name: '执行一次普攻', exact: true }).click();
  await expect(page.getByTestId('single-attack-target-final-hp')).toHaveText('450');
  await page.evaluate(() => (window as unknown as { resumeOldRun: () => void }).resumeOldRun());
  await expect(page.getByTestId('single-attack-target-final-hp')).toHaveText('450');
  await expect(page.getByText('单次普攻运行通过，不代表连续攻击通过。', { exact: true })).toBeVisible();
  const state = await workerDiagnostics(page);
  expect(state.created).toBe(2);
  expect(state.terminated).toBe(2);
  expect(state.messages.filter(item => item === 'run')).toHaveLength(2);
  expect(state.messages.filter(item => item === 'release')).toHaveLength(1);
});

test('运行中拒绝离开保留任务，确认切模式后终止线程且旧结果不会回流', async ({ page }) => {
  await preparePage(page);
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
  expect((await workerDiagnostics(page)).messages.filter(item => item === 'release')).toHaveLength(0);
});

test('重新读场景失败或取消保留既有补充值和初始生命', async ({ page }) => {
  await preparePage(page);
  await page.getByLabel('攻击方补充属性 critical_strike_chance', { exact: true }).fill('0.25');
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('500');
  await page.route('**/api/admin/games/demo/simulation-snapshot?**', route => route.fulfill({ status: 500, json: { error: { code: 'READ_FAILED', message: '本次场景读取失败' } } }));
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await expect(page.getByText(/本次场景读取失败/)).toBeVisible();
  await expect(page.getByLabel('攻击方补充属性 critical_strike_chance', { exact: true })).toHaveValue('0.25');
  await expect(page.getByLabel('目标初始当前生命', { exact: true })).toHaveValue('500');
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/admin/games/demo/simulation-snapshot?**', async route => {
    await gate;
    await route.fulfill({ json: sampleWithDamage() }).catch(() => undefined);
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
  const token = process.env.SIMULATION_LIVE_ADMIN_TOKEN;
  const path = '/api/admin/games/lol/simulation-snapshot?' + new URLSearchParams({
    sourceCharacterKey: 'champion_aatrox', sourceLevel: '1', targetCharacterKey: 'champion_ahri', targetLevel: '1',
    basicAttackSkillKey: 'shared_basic_attack', basicAttackLevel: '1'
  });
  const response = await request.get(apiBase + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  expect(response.status()).toBe(200);
  const snapshot = await response.json() as SimulationSnapshot;
  expect(snapshot.skillConfigurations[0]!.effects).toHaveLength(2);
  expect(snapshot.skillConfigurations[0]!.triggerRules).toHaveLength(2);
  const result = await runSnapshot(page, snapshot, testInfo);
  const expectedDamage = snapshot.source.selectedLevelValues.attack_damage! * 100 / (100 + snapshot.target.selectedLevelValues.armor!);
  expect(result.assessment.damageDealt).toBeCloseTo(expectedDamage, 8);
  expect(result.assessment.hpLoss).toBeCloseTo(expectedDamage, 8);
  expect(result.assessment.sourceFinalHp).toBe(snapshot.source.selectedLevelValues.hp);
  expect(result.assessment.targetFinalHp).toBeCloseTo(snapshot.target.selectedLevelValues.hp! - expectedDamage, 8);
  const multiplier = snapshot.skillConfigurations[0]!.parameters.find(row => row.parameterKey === 'base_critical_multiplier');
  expect(multiplier?.valueMode).toBe('FIXED');
  expect(typeof multiplier?.fixedValue).toBe('number');
  const crit = await runSnapshot(page, snapshot, testInfo, { source: { critical_strike_chance: 0.25 } }, 'actual-25pct-crit-archive.json');
  expect(crit.assessment.damageDealt).toBeCloseTo(expectedDamage * (1 + 0.25 * (multiplier!.fixedValue! - 1)), 8);
  // 同时走正式页面的真实目录、头像及快照读取，不拦截Wasm消息或伪造运行结果。
  await page.unroute('**/api/games');
  await page.addInitScript(({ apiBase, token }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', apiBase);
    localStorage.setItem('damage-viewer.web.admin-token', token || 'local-readonly-check');
  }, { apiBase, token });
  const methods: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).origin === apiBase && request.method() !== 'OPTIONS') methods.push(request.method());
  });
  await page.reload();
  await chooseSimulationEntity(page, '攻击方角色', 'champion_aatrox');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'champion_ahri');
  await chooseSimulationLevel(page, '目标等级', 1);
  await chooseSimulationEntity(page, '普攻技能', 'shared_basic_attack');
  await chooseSimulationLevel(page, '普攻技能等级', 1);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
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
  expect(methods.every(method => method === 'GET')).toBe(true);
});
