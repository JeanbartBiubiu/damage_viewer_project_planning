import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { ContinuousAttackArchive } from '../../src/pages/simulation/SimulationScenarioPanel';
import type { FrozenCombatAnalysis } from '../fixtures/combatAnalysisPage';
import {
  combatAnalysisOutput, combatAnalysisWorkers, chooseCombatAnalysisOption, downloadCombatAnalysis,
  holdNextCombatAnalysisResult, installCombatAnalysisApi, openCombatAnalysisAdvanced, openCombatAnalysisPage,
  prepareCombatAnalysisPage, resumeCombatAnalysis, runCombatAnalysisPage, selectCombatAnalysisCharacters,
  setCombatAnalysisCheckbox, setCombatAnalysisSkill, waitForHeldCombatAnalysis
} from '../fixtures/combatAnalysisPage';
import { simulationAutomaticSample } from '../fixtures/simulationAutomaticSkills';
import { simulationDefaultSourcesSample } from '../fixtures/simulationSnapshot';
import { chooseSimulationEntity, chooseSimulationLevel } from '../fixtures/simulationSelection';
import { confirmSimulationConfiguration } from '../fixtures/simulationSnapshotRequests';

// 独立作者构造，只隔离 HTTP。每份计算均由实际页面配置和正式 Wasm Worker 执行；不代表实库英雄验收。
const resultRegion = (page: Page) => page.getByRole('region', { name: '自动技能结果', exact: true });
const runButton = (page: Page) => page.getByRole('button', { name: '开始计算', exact: true });

test('独立构造页面：角色绑定直接呈现，技能不需二次选择，被动不进入自动施放，窄屏无横向溢出', async ({ page }) => {
  const sample = simulationAutomaticSample(true);
  const natural = simulationDefaultSourcesSample();
  // 复用已有独立作者的真实配置和绑定；该分支尚未配置完整，仅核对分类及入口，不伪造可执行主动。
  sample.skillConfigurations.push(structuredClone(natural.skillConfigurations.find(configuration => configuration.skill.skillKey === 'sample_natural')!));
  for (const side of ['source', 'target'] as const) {
    sample[side].attachedSkills.push(structuredClone(natural[side].attachedSkills.find(relation => relation.skillKey === 'sample_natural')!));
    sample[side].skillSources.push(structuredClone(natural[side].skillSources.find(source => source.skillKey === 'sample_natural')!));
  }
  const diagnostics = await installCombatAnalysisApi(page, sample);
  await openCombatAnalysisPage(page);
  await selectCombatAnalysisCharacters(page);
  const passive = page.getByRole('group', { name: '攻击方技能 sample_natural', exact: true });
  await expect(passive).toContainText('被动');
  await expect(page.getByRole('switch', { name: '攻击方技能 sample_natural 启用', exact: true })).toBeChecked();
  await expect(page.locator('.simulation-level-select[aria-label="攻击方技能 sample_natural 等级"]')).toContainText('3');
  const source = await page.getByRole('region', { name: '攻击方配置', exact: true }).boundingBox();
  const target = await page.getByRole('region', { name: '目标配置', exact: true }).boundingBox();
  expect(target!.x, '桌面第一屏双方并排').toBeGreaterThan(source!.x);
  const extras = page.locator('summary').filter({ hasText: /^构筑与其他来源$/ });
  await expect(extras).toHaveCount(2);
  for (const extra of await extras.all()) expect(await extra.locator('..').getAttribute('open')).toBeNull();
  await openCombatAnalysisAdvanced(page);
  await expect(page.locator('.arco-select[aria-label^="自动技能目标 "]')).toHaveCount(2);
  await expect(page.locator('.arco-select[aria-label^="自动技能等级 "]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^删除自动规则 / })).toHaveCount(0);
  await setCombatAnalysisSkill(page, '攻击方', 'sample_natural', false);
  await page.setViewportSize({ width: 390, height: 844 });
  const narrowSource = await page.getByRole('region', { name: '攻击方配置', exact: true }).boundingBox();
  const narrowTarget = await page.getByRole('region', { name: '目标配置', exact: true }).boundingBox();
  expect(narrowTarget!.y).toBeGreaterThan(narrowSource!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '窄屏无横向溢出').toBe(true);
  mkdirSync(combatAnalysisOutput, { recursive: true });
  await page.screenshot({ path: resolve(combatAnalysisOutput, 'compact-setup-mobile.png'), fullPage: true });
  diagnostics.assertClean(false);
});

test('独立构造页面：自动最高等级后，等级0、关闭和清空在重新读取时保留', async ({ page }) => {
  const sample = simulationAutomaticSample(true);
  sample.skillConfigurations.find(configuration => configuration.skill.skillKey === 'sample_active')!.skill.maxLevel = 3;
  const diagnostics = await installCombatAnalysisApi(page, sample);
  await openCombatAnalysisPage(page);
  await selectCombatAnalysisCharacters(page, { sample_active: 3 });
  await chooseCombatAnalysisOption(page, '攻击方技能 sample_active 等级', '0（未学）');
  await setCombatAnalysisSkill(page, '攻击方', 'sample_second', false);
  const cleared = page.locator('.simulation-level-select[aria-label="攻击方技能 sample_second 等级"]');
  await cleared.hover();
  await cleared.locator('.arco-select-clear-icon').click();
  await expect(cleared).toContainText('等级');
  await expect(cleared).not.toContainText('1');
  await openCombatAnalysisAdvanced(page);
  await expect(page.locator('.arco-select[aria-label^="自动技能目标 "]')).toHaveCount(0);
  const requested = page.waitForRequest(request => request.url().endsWith('/simulation-snapshot') && request.method() === 'POST');
  await page.getByRole('button', { name: '准备计算', exact: true }).click();
  const selection = (await requested).postDataJSON();
  expect(selection.basicAttackSkillKey).toBe('sample_basic_attack');
  expect(selection.basicAttackLevel).toBe(1);
  expect(selection.plannedSkills).toEqual([]);
  expect(selection.sourceSkillSettings).toContainEqual({ origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey: 'sample_active', enabled: true, skillLevel: 0 });
  expect(selection.sourceSkillSettings).toContainEqual({ origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey: 'sample_second', enabled: false });
  await expect(page.getByRole('button', { name: '准备计算', exact: true })).toBeEnabled();
  await confirmSimulationConfiguration(page);
  await expect(page.locator('.simulation-level-select[aria-label="攻击方技能 sample_active 等级"]')).toContainText('0（未学）');
  await expect(page.getByRole('switch', { name: '攻击方技能 sample_second 启用', exact: true })).not.toBeChecked();
  await expect(cleared).toContainText('等级');
  await expect(cleared).not.toContainText('1');
  await setCombatAnalysisSkill(page, '攻击方', 'sample_second', true);
  await expect(page.getByRole('button', { name: '准备计算', exact: true })).toBeDisabled();
  await expect(cleared).toContainText('等级');
  await expect(cleared).not.toContainText('1');
  diagnostics.assertClean();
});

test('独立构造页面：关闭全部主动后直接运行真实普攻，原生请求不包含自动技能', async ({ page }, testInfo) => {
  const diagnostics = await installCombatAnalysisApi(page);
  await openCombatAnalysisPage(page);
  await selectCombatAnalysisCharacters(page);
  await setCombatAnalysisSkill(page, '攻击方', 'sample_active', false);
  await setCombatAnalysisSkill(page, '攻击方', 'sample_second', false);
  await page.getByRole('button', { name: '准备计算', exact: true }).click();
  await confirmSimulationConfiguration(page);
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByLabel('攻击方初始当前生命', { exact: true }).fill('300');
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('5000');
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('2600');
  await page.getByLabel('攻速输入上界', { exact: true }).fill('10');
  await runButton(page).click();
  const result = page.getByRole('region', { name: '连续普攻结果', exact: true });
  await expect(result).toBeVisible();
  await expect(result).toContainText('完整观察，目标未被击杀');
  const pending = page.waitForEvent('download');
  await result.getByRole('button', { name: '下载连续运行档案', exact: true }).click();
  const download = await pending;
  const file = await download.path();
  const archive = JSON.parse(readFileSync(file!, 'utf8')) as ContinuousAttackArchive;
  expect(archive.taskKind).toBe('continuous_attack');
  expect(archive.cleanup).toBe('released');
  expect(archive.runRequest!.driverPlan.basicAttack).toBeDefined();
  expect(archive.runRequest!.driverPlan.automaticSkills).toBeUndefined();
  expect(archive.snapshot.selection.plannedSkills).toEqual([]);
  expect(archive.runResult!.summary.basicAttack!.startedCount).toBeGreaterThan(0);
  expect(archive.runResult!.automaticSkillSummary).toBeUndefined();
  await testInfo.attach('纯普攻实际冻结档案', { body: JSON.stringify(archive), contentType: 'application/json' });
  diagnostics.assertClean();
});

test('独立构造页面：换角色立即清除旧规则，迟到作者配置不会重新带回旧技能', async ({ page }) => {
  const diagnostics = await installCombatAnalysisApi(page);
  await openCombatAnalysisPage(page);
  const held = diagnostics.holdNextConfiguration('sample_active');
  try {
    await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
    await held.started;
    await chooseSimulationEntity(page, '攻击方角色', 'actor_b');
    await expect(page.getByRole('switch', { name: '攻击方技能 sample_basic_attack 启用', exact: true })).toBeChecked();
    await expect(page.getByRole('group', { name: '攻击方技能 sample_active', exact: true })).toHaveCount(0);
  } finally {
    held.release();
  }
  await openCombatAnalysisAdvanced(page);
  await expect(page.locator('.arco-select[aria-label^="自动技能目标 "]')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '攻击方技能 sample_active', exact: true })).toHaveCount(0);
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await expect(page.getByRole('switch', { name: '攻击方技能 sample_active 启用', exact: true })).toBeChecked();
  await expect(page.locator('.arco-select[aria-label^="自动技能目标 "]')).toHaveCount(2);
  await chooseCombatAnalysisOption(page, '关联冷却 auto_rule_1', '独立单段主动');
  await chooseCombatAnalysisOption(page, '前置资格 auto_rule_2', '独立单段主动');
  await chooseSimulationEntity(page, '攻击方角色', 'actor_b');
  await expect(page.locator('.arco-select[aria-label^="自动技能目标 "]')).toHaveCount(0);
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await expect(page.locator('.arco-select[aria-label^="自动技能目标 "]')).toHaveCount(2);
  await expect(page.locator('.arco-select[aria-label="关联冷却 auto_rule_1"]')).toContainText('不额外等待');
  await expect(page.locator('.arco-select[aria-label="前置资格 auto_rule_2"]')).toContainText('独立施放');
  diagnostics.assertClean(false);
});

for (const basicBinding of ['missing', 'ambiguous'] as const) {
  test(`独立构造页面：${basicBinding === 'missing' ? '缺少' : '多份'}普通攻击绑定不自动挑选，关闭普攻后可准备并运行纯主动`, async ({ page }, testInfo) => {
    const sample = simulationAutomaticSample(true);
    if (basicBinding === 'missing') {
      sample.source.attachedSkills = sample.source.attachedSkills.filter(relation => relation.skillKey !== 'sample_basic_attack');
      sample.source.skillSources = sample.source.skillSources.filter(source => source.skillKey !== 'sample_basic_attack');
    } else {
      const original = sample.skillConfigurations.find(configuration => configuration.skill.skillKey === 'sample_basic_attack')!;
      // 第二份是完整的独立作者配置及挂载，不只向候选表塞一个未定义的名称。
      const additional = JSON.parse(JSON.stringify(original).replaceAll('sample_basic_attack', 'sample_basic_second')) as typeof original;
      additional.skill.name = '独立第二普通攻击';
      sample.skillConfigurations.push(additional);
      sample.source.attachedSkills.push({ ...sample.source.attachedSkills.find(relation => relation.skillKey === original.skill.skillKey)!,
        skillKey: additional.skill.skillKey, skillName: additional.skill.name, sortOrder: 3 });
      sample.source.skillSources.push({ ...sample.source.skillSources.find(source => source.skillKey === original.skill.skillKey)!,
        skillKey: additional.skill.skillKey, skillName: additional.skill.name });
    }
    const diagnostics = await installCombatAnalysisApi(page, sample);
    await openCombatAnalysisPage(page);
    await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
    await chooseSimulationLevel(page, '攻击方等级', 1);
    await chooseSimulationEntity(page, '目标角色', 'actor_b');
    await chooseSimulationLevel(page, '目标等级', 1);
    const fallback = page.getByRole('switch', { name: '开启背景普攻', exact: true });
    await expect(fallback).toBeChecked();
    await expect(page.getByRole('button', { name: '准备计算', exact: true })).toBeDisabled();
    await expect(page.getByRole('alert', { name: '场景配置问题', exact: true })).toContainText(basicBinding === 'missing' ? '没有真实已启用的普通攻击绑定' : '有2份普通攻击绑定');
    await expect(page.locator('.arco-select[aria-label="普攻技能"]')).toHaveCount(0);
    if (basicBinding === 'ambiguous') {
      for (const skillKey of ['sample_basic_attack', 'sample_basic_second']) {
        await expect(page.getByRole('switch', { name: `攻击方技能 ${skillKey} 启用`, exact: true })).toBeDisabled();
      }
    }
    await fallback.click();
    await expect(fallback).not.toBeChecked();
    await expect(page.getByRole('button', { name: '准备计算', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '准备计算', exact: true }).click();
    await confirmSimulationConfiguration(page);
    await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
    await page.getByLabel('攻击方初始当前生命', { exact: true }).fill('300');
    await page.getByLabel('目标初始当前生命', { exact: true }).fill('5000');
    await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('1600');
    await runCombatAnalysisPage(page);
    const archive = await downloadCombatAnalysis(page, `pure-${basicBinding}-basic-binding`, testInfo);
    expect(archive.snapshot.selection.basicAttackSkillKey).toBeNull();
    expect(archive.snapshot.selection.basicAttackLevel).toBeNull();
    expect(archive.snapshot.selection.plannedSkills.map(plan => plan.skillKey)).toEqual(['sample_active', 'sample_second']);
    expect(archive.runRequest!.driverPlan.basicAttack).toBeUndefined();
    expect(archive.runRequest!.driverPlan.automaticSkills!.rules).toHaveLength(2);
    expect(archive.runResult!.summary.basicAttack).toBeUndefined();
    expect(archive.runResult!.attackRecords ?? []).toEqual([]);
    expect(archive.runResult!.summary.sourceDamageDealt).toBeGreaterThan(0);
    diagnostics.assertClean();
  });
}

function assertRulesAndQualification(archive: FrozenCombatAnalysis, mixed: boolean) {
  const request = archive.runRequest!;
  const done = archive.runResult!;
  const automatic = done.automaticSkillSummary!;
  expect(request.driverPlan.automaticSkills!.rules).toMatchObject([
    { ruleKey: 'auto_rule_1', sortOrder: 0, target: 'target', waitForCooldowns: ['auto_rule_2'], releaseAfterRuleKey: null },
    { ruleKey: 'auto_rule_2', sortOrder: 1, target: 'source', waitForCooldowns: [], releaseAfterRuleKey: 'auto_rule_1' }
  ]);
  expect(archive.initialHealth).toEqual({ source: 300, target: 5000 });
  expect(archive.snapshot.selection.plannedSkills.map(plan => plan.skillKey)).toEqual(['sample_active', 'sample_second']);
  expect(automatic.ruleCount).toBe(2);
  expect(automatic.startedCount).toBeGreaterThanOrEqual(2);
  expect(automatic.qualifications).toHaveLength(1);
  const qualification = automatic.qualifications[0]!;
  expect(qualification).toMatchObject({ grantorRuleKey: 'auto_rule_1', consumerRuleKey: 'auto_rule_2' });
  expect(qualification.grantedCount).toBe(qualification.consumedCount + qualification.remainingCount);
  expect(qualification.remainingCount).toBeLessThanOrEqual(1);
  expect(qualification.consumedCount).toBe(automatic.rules.find(rule => rule.ruleKey === 'auto_rule_2')!.startedCount);
  expect(qualification.consumedCount).toBeGreaterThan(0);
  if (mixed) {
    expect(request.driverPlan.basicAttack).toBeDefined();
    expect(done.summary.basicAttack!.startedCount).toBeGreaterThan(0);
  } else {
    expect(request.driverPlan.basicAttack).toBeUndefined();
    expect(done.summary.basicAttack).toBeUndefined();
    expect(done.attackRecords ?? []).toEqual([]);
  }
  expect(done.summary.sourceDamageDealt).toBeGreaterThan(0);
  expect(done.summary.sourceDirectHealing).toBeGreaterThan(0);
}

test('独立构造页面：混合自动连招的曲线、真实使用与伤害联动、冻结来源和过期', async ({ page }, testInfo) => {
  const diagnostics = await installCombatAnalysisApi(page);
  await prepareCombatAnalysisPage(page);
  await runCombatAnalysisPage(page);
  const result = resultRegion(page);
  await expect(result.getByRole('region', { name: '混合战斗曲线', exact: true })).toBeVisible();
  await expect(result.getByTestId('continuous-attack-charts').locator('svg')).toBeVisible();
  await expect(result.getByRole('heading', { name: '一次释放资格账本', exact: true })).toBeVisible();
  const baseline = await downloadCombatAnalysis(page, 'mixed-detailed', testInfo);
  assertRulesAndQualification(baseline, true);
  const done = baseline.runResult!;
  expect(done.series.length).toBeGreaterThan(1);
  expect(done.series[done.series.length - 1]).toMatchObject({ timeMs: done.summary.durationMs,
    sourceHp: done.summary.sourceFinalHp, targetHp: done.summary.targetFinalHp,
    sourceDamageDealt: done.summary.sourceDamageDealt, targetDamageDealt: done.summary.targetDamageDealt });
  const started = done.automaticSkillRecords!.find(row => row.kind === 'STARTED' && row.ruleKey === 'auto_rule_1')!;
  const damage = done.damageRecords!.find(row => row.attackIndex === null && row.useRef === started.useRef)!;
  expect(damage, '主动伤害按真实使用身份关联，不要求普攻刀号').toBeDefined();
  const details = result.getByRole('region', { name: '自动选中项详情', exact: true });
  await result.getByRole('button', { name: `查看自动事实${started.sequence}`, exact: true }).click();
  await expect(details).toContainText(started.useRef!);
  await expect(details).toContainText('同次使用上下文的已返回结算');
  await result.getByRole('button', { name: `查看伤害${damage.damageId}`, exact: true }).click();
  await expect(details).toContainText(String(damage.damageId));
  await expect(details).toContainText(damage.operationRef);
  await details.getByRole('button', { name: '定位冻结作者与编译节点', exact: true }).click();
  await expect(details).toContainText(damage.operationPath);
  await expect(details.getByRole('region', { name: '自动冻结作者来源', exact: true })).toContainText('仅来自本次冻结档案');
  const consumed = done.automaticSkillRecords!.find(row => row.kind === 'QUALIFICATION_CONSUMED')!;
  const qualificationMarker = result.getByRole('img', { name: '实际混合战斗时间轴', exact: true })
    .locator(`[role="button"][aria-label*="（自动序号${consumed.sequence}）"]`);
  await qualificationMarker.focus();
  await page.keyboard.press('Enter');
  await expect(details).toContainText('消费者使用');
  await expect(details).toContainText(consumed.useRef!);
  await expect(details).toContainText(consumed.relatedUseRef!);
  const attack = done.attackRecords![0]!;
  await result.getByRole('button', { name: `查看第${attack.attackIndex}刀`, exact: true }).click();
  await expect(details).toContainText(attack.useRef);
  await result.getByRole('button', { name: `查看伤害${damage.damageId}`, exact: true }).click();
  // 筛选改变视图，完整累计与下载的原始事实保持。
  const totals = await result.getByTestId('automatic-skill-totals').innerText();
  const fullBreakdown = await result.getByTestId('automatic-breakdown-subtotal').innerText();
  const reads = diagnostics.snapshotReads;
  await result.getByLabel('自动时间轴起点', { exact: true }).fill('100');
  await result.getByLabel('自动时间轴终点', { exact: true }).fill('1500');
  await expect(result.getByTestId('automatic-skill-totals')).toHaveText(totals);
  await expect(result.getByTestId('automatic-breakdown-subtotal')).toHaveText(fullBreakdown);
  await chooseCombatAnalysisOption(page, '自动伤害来源筛选', /^样例普攻 \/ hit\.damage/);
  await chooseCombatAnalysisOption(page, '自动伤害类型筛选', '物理');
  await chooseCombatAnalysisOption(page, '自动伤害率模式', '滚动窗口伤害率');
  await chooseCombatAnalysisOption(page, '自动来源拆分方式', '按伤害类型拆分');
  await chooseCombatAnalysisOption(page, '自动来源金额指标', '实际扣血');
  await expect(result.getByRole('button', { name: `查看伤害${damage.damageId}`, exact: true })).toHaveCount(0);
  await expect(details).toContainText(damage.operationRef);
  await expect(details).toContainText('主表已隐藏');
  expect(diagnostics.snapshotReads, '视图操作不重新读取场景').toBe(reads);
  const filtered = await downloadCombatAnalysis(page, 'mixed-filtered', testInfo);
  expect(filtered.view.timeRangeMs).toEqual([100, 1500]);
  expect(filtered.runResult).toEqual(baseline.runResult);
  expect(filtered.runRequest).toEqual(baseline.runRequest);
  expect(filtered.view).toMatchObject({ dpsMode: 'window', breakdownMode: 'type', amountMetric: 'actualHpLoss', damageTypes: ['physics'],
    selection: { kind: 'damage', damageId: damage.damageId } });
  expect(filtered.view.sourceKeys).toHaveLength(1);
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('2700');
  await expect(result).toContainText('输入已变化，当前是已过期的冻结结果');
  await expect(result.getByTestId('automatic-skill-totals')).toHaveText(totals);
  expect(diagnostics.snapshotReads).toBe(reads);
  await page.screenshot({ path: resolve(combatAnalysisOutput, 'mixed-page.png'), fullPage: true });
  expect((await combatAnalysisWorkers(page)).messages.filter(type => type === 'run')).toHaveLength(1);
  diagnostics.assertClean();
});

test('独立构造页面：纯主动曲线和直接治疗，关闭采样与零记录预算保留完整累计', async ({ page }, testInfo) => {
  const diagnostics = await installCombatAnalysisApi(page);
  await prepareCombatAnalysisPage(page, false);
  await runCombatAnalysisPage(page);
  const result = resultRegion(page);
  await expect(result.getByTestId('continuous-attack-charts').locator('svg')).toBeVisible();
  const baseline = await downloadCombatAnalysis(page, 'pure-detailed', testInfo);
  assertRulesAndQualification(baseline, false);
  const done = baseline.runResult!;
  const healing = done.healingRecords![0]!;
  expect(healing).toBeDefined();
  await result.getByRole('button', { name: '查看治疗1', exact: true }).click();
  const details = result.getByRole('region', { name: '自动选中项详情', exact: true });
  await expect(details).toContainText(healing.operationRef);
  if (healing.useRef) await expect(details).toContainText(healing.useRef);
  await expect(result.getByRole('button', { name: /查看第\d+刀/ })).toHaveCount(0);
  await page.getByLabel('maxAutomaticSkillRecords', { exact: true }).fill('0');
  await page.getByLabel('自动治疗记录上限', { exact: true }).fill('0');
  await setCombatAnalysisCheckbox(page, '记录时间序列', false);
  await expect(result).toContainText('输入已变化，当前是已过期的冻结结果');
  await runCombatAnalysisPage(page);
  await expect(result).toContainText('未记录时间序列');
  await expect(result.getByTestId('continuous-attack-charts')).toHaveCount(0);
  await expect(result.getByRole('button', { name: /查看自动事实\d+/ })).toHaveCount(0);
  await expect(result.getByRole('button', { name: /查看治疗\d+/ })).toHaveCount(0);
  await expect(result.getByRole('button', { name: /查看伤害/ }).first()).toBeVisible();
  const limited = await downloadCombatAnalysis(page, 'pure-zero-records-no-sampling', testInfo);
  assertRulesAndQualification(limited, false);
  expect(limited.runRequest).toMatchObject({ sampling: { disabled: true }, recordBudget: { maxAutomaticSkillRecords: 0, maxHealingRecords: 0 } });
  expect(limited.runResult!.series).toEqual([]);
  expect(limited.runResult!.automaticSkillRecords ?? []).toEqual([]);
  expect(limited.runResult!.healingRecords ?? []).toEqual([]);
  expect(limited.runResult!.automaticSkillRecording).toMatchObject({ returnedCount: 0, truncated: true });
  expect(limited.runResult!.summary).toMatchObject({ sourceDamageDealt: done.summary.sourceDamageDealt,
    sourceDirectHealing: done.summary.sourceDirectHealing, sourceFinalHp: done.summary.sourceFinalHp, targetFinalHp: done.summary.targetFinalHp });
  expect(limited.runResult!.automaticSkillSummary!.startedCount).toBe(done.automaticSkillSummary!.startedCount);
  await page.screenshot({ path: resolve(combatAnalysisOutput, 'pure-no-sampling-page.png'), fullPage: true });
  diagnostics.assertClean();
});

test('独立构造页面：明确未命中的真实使用仍能定位冻结技能与编译过程，不补造伤害', async ({ page }, testInfo) => {
  const diagnostics = await installCombatAnalysisApi(page);
  await prepareCombatAnalysisPage(page, false);
  await chooseCombatAnalysisOption(page, '自动技能命中预设 auto_rule_1', '明确未命中');
  await runCombatAnalysisPage(page);
  const archive = await downloadCombatAnalysis(page, 'pure-miss-use-origin', testInfo);
  const done = archive.runResult!;
  expect(archive.runRequest!.driverPlan.automaticSkills!.rules[0]!.hitBindings).toEqual([
    expect.objectContaining({ preset: 'MISS' })
  ]);
  const started = done.automaticSkillRecords!.find(row => row.kind === 'STARTED' && row.ruleKey === 'auto_rule_1')!;
  expect(started?.useRef, '未命中也有真实开始使用').toBeTruthy();
  expect(done.damageRecords ?? [], '未命中不能产生伤害明细').toEqual([]);
  expect(done.summary.sourceDamageDealt).toBe(0);
  expect(done.healingRecords!.filter(row => row.useRef === started.useRef)).toEqual([]);
  expect(done.summary.sourceDirectHealing, '另一项自身治疗保持真实执行').toBeGreaterThan(0);
  const result = resultRegion(page);
  await result.getByRole('button', { name: `查看自动事实${started.sequence}`, exact: true }).click();
  const details = result.getByRole('region', { name: '自动选中项详情', exact: true });
  await expect(details).toContainText(started.useRef!);
  await expect(details.getByRole('region', { name: '自动同次使用上下文', exact: true })).toContainText('伤害0笔，直接治疗0笔');
  await expect(details.getByRole('region', { name: '自动伤害结算详情', exact: true })).toHaveCount(0);
  await expect(details.getByRole('region', { name: '自动冻结作者来源', exact: true })).toHaveCount(0);
  const source = details.getByRole('region', { name: '自动使用作者来源', exact: true });
  await expect(source).toContainText('sample_active');
  await expect(source).toContainText('auto_rule_1');
  const reads = diagnostics.snapshotReads;
  await source.getByRole('button', { name: '定位冻结技能与编译过程', exact: true }).click();
  await expect(source).toContainText('cast');
  expect(diagnostics.snapshotReads, '使用来源只读冻结档案，不重读作者配置').toBe(reads);
  await expect(result.getByRole('button', { name: /查看伤害/ })).toHaveCount(0);
  const afterSelection = await downloadCombatAnalysis(page, 'pure-miss-selected-use-origin', testInfo);
  expect(afterSelection.runResult).toEqual(archive.runResult);
  expect(afterSelection.view.selection).toEqual({ kind: 'automatic', sequence: started.sequence });
  diagnostics.assertClean();
});

test('独立构造页面：汇总与采样独立，开启和关闭采样都保留规则及资格', async ({ page }, testInfo) => {
  const diagnostics = await installCombatAnalysisApi(page);
  await prepareCombatAnalysisPage(page, false);
  await chooseCombatAnalysisOption(page, '自动结果明细', '只返回汇总');
  await runCombatAnalysisPage(page);
  const result = resultRegion(page);
  await expect(result.getByTestId('continuous-attack-charts').locator('svg')).toBeVisible();
  await expect(result).toContainText('汇总模式未请求');
  await expect(result.getByRole('button', { name: /查看自动事实|查看伤害|查看治疗|查看第\d+刀/ })).toHaveCount(0);
  const sampled = await downloadCombatAnalysis(page, 'pure-summary-sampled', testInfo);
  assertRulesAndQualification(sampled, false);
  expect(sampled.runRequest).toMatchObject({ outputMode: 'summary', sampling: { disabled: false } });
  expect(sampled.runResult!.series.length).toBeGreaterThan(1);
  expect(sampled.runResult!.automaticSkillRecords ?? []).toEqual([]);
  expect(sampled.runResult!.damageRecords ?? []).toEqual([]);
  expect(sampled.runResult!.healingRecords ?? []).toEqual([]);
  await setCombatAnalysisCheckbox(page, '记录时间序列', false);
  await runCombatAnalysisPage(page);
  await expect(result).toContainText('未记录时间序列');
  await expect(result.getByTestId('continuous-attack-charts')).toHaveCount(0);
  await expect(result).toContainText('汇总模式未请求');
  const noSampling = await downloadCombatAnalysis(page, 'pure-summary-no-sampling', testInfo);
  assertRulesAndQualification(noSampling, false);
  expect(noSampling.runResult!.series).toEqual([]);
  expect(noSampling.runResult!.summary.sourceDamageDealt).toBe(sampled.runResult!.summary.sourceDamageDealt);
  expect(noSampling.runResult!.automaticSkillSummary!.startedCount).toBe(sampled.runResult!.automaticSkillSummary!.startedCount);
  diagnostics.assertClean();
});

test('独立构造页面：真实 Worker 运行中拒绝离开保留，确认后旧结果不进入新页面', async ({ page }, testInfo) => {
  const diagnostics = await installCombatAnalysisApi(page);
  await prepareCombatAnalysisPage(page);
  await holdNextCombatAnalysisResult(page);
  await runButton(page).click();
  await waitForHeldCombatAnalysis(page);
  const before = await combatAnalysisWorkers(page);
  const link = page.getByRole('link', { name: '普攻模拟', exact: false });
  const rejected = page.waitForEvent('dialog').then(async dialog => {
    expect(dialog.message()).toContain('当前计算尚未完成');
    await dialog.dismiss();
  });
  await link.click();
  await rejected;
  await expect(page).toHaveURL(/#\/simulation\/combat-analysis$/);
  await expect(runButton(page)).toBeDisabled();
  expect((await combatAnalysisWorkers(page)).terminated).toBe(before.terminated);
  const accepted = page.waitForEvent('dialog').then(dialog => dialog.accept());
  await link.click();
  await accepted;
  await expect(page).toHaveURL(/#\/simulation\/basic-attack$/);
  await expect.poll(async () => (await combatAnalysisWorkers(page)).terminated).toBeGreaterThan(before.terminated);
  await resumeCombatAnalysis(page);
  await expect(resultRegion(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '普攻模拟', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '进入混合战斗分析（自动循环）', exact: true }).click();
  await expect(page).toHaveURL(/#\/simulation\/combat-analysis$/);
  await expect(resultRegion(page)).toHaveCount(0);
  await expect(page.locator('.simulation-entity-select[aria-label="攻击方角色"] input')).toHaveValue('');
  await testInfo.attach('离开取消实际Worker轨迹', { body: JSON.stringify(await combatAnalysisWorkers(page)), contentType: 'application/json' });
  diagnostics.assertClean();
});

test('独立构造页面：取消真实计算后重跑，迟到的旧结果不能覆盖新冻结档案', async ({ page }, testInfo) => {
  const diagnostics = await installCombatAnalysisApi(page);
  await prepareCombatAnalysisPage(page, false);
  await holdNextCombatAnalysisResult(page);
  await runButton(page).click();
  await waitForHeldCombatAnalysis(page);
  const before = await combatAnalysisWorkers(page);
  await page.getByRole('button', { name: '取消当前请求', exact: true }).click();
  await expect(runButton(page)).toBeEnabled();
  await expect.poll(async () => (await combatAnalysisWorkers(page)).terminated).toBeGreaterThan(before.terminated);
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('1700');
  await runCombatAnalysisPage(page);
  const current = await downloadCombatAnalysis(page, 'cancelled-then-rerun', testInfo);
  expect(current.runRequest!.stopPolicy.durationMs).toBe(1700);
  await resumeCombatAnalysis(page);
  const afterLate = await downloadCombatAnalysis(page, 'after-late-old-result', testInfo);
  expect(afterLate.runRequest).toEqual(current.runRequest);
  expect(afterLate.runResult).toEqual(current.runResult);
  expect((await combatAnalysisWorkers(page)).messages.filter(type => type === 'run')).toHaveLength(2);
  diagnostics.assertClean();
});
