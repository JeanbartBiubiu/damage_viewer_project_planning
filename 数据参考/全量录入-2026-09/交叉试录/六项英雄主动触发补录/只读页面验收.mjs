import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';
import { targetConfigs } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(here, '页面截图');
const reportPath = path.join(here, '08-页面验收.json');
const baseUrl = 'http://127.0.0.1:5173';
if (fs.existsSync(reportPath)) throw new Error('页面报告已存在，拒绝覆盖。');

const targets = [
  {
    id: 'tristana', skillKey: 'tristana_q', skillName: '崔丝塔娜·急速射击', ruleKey: 'active', actionCount: 1,
    process: { processKey: 'cast', processName: '施放急速射击', bindingKeys: ['mana_cost', 'rapid_fire'] },
    triggerTexts: ['技能被主动或消耗使用', 'tristana_q', '主动', '启动过程', '当前目标', 'cast']
  },
  {
    id: 'twitch', skillKey: 'twitch_r', skillName: '图奇·火力全开', ruleKey: 'on_used', actionCount: 1,
    process: { processKey: 'cast', processName: '施放火力全开', bindingKeys: ['mana_cost', 'bonus_ad', 'bonus_range'] },
    triggerTexts: ['技能被主动或消耗使用', 'twitch_r', '主动', '启动过程', '当前目标', 'cast']
  },
  {
    id: 'vayne', skillKey: 'vayne_r', skillName: '薇恩·终极时刻', ruleKey: 'on_used', actionCount: 1,
    process: { processKey: 'cast', processName: '施放终极时刻', bindingKeys: ['mana_cost', 'bonus_attack_damage'] },
    triggerTexts: ['技能被主动或消耗使用', 'vayne_r', '主动', '启动过程', '当前目标', 'cast']
  },
  {
    id: 'masteryi', skillKey: 'masteryi_r', skillName: '易·高原血统', ruleKey: 'on_used', actionCount: 2,
    effects: [
      {
        effectKey: 'attack_speed', resultKey: 'attribute',
        effectRowTexts: ['高原血统额外攻击速度', 'attack_speed'], effectTexts: ['duration_ms'],
        resultRowTexts: ['高原血统额外攻击速度', 'attribute', '属性变化', '施法者'],
        resultTexts: ['属性变化', '施法者', 'attack_speed_ratio']
      },
      {
        effectKey: 'move_speed', resultKey: 'attribute',
        effectRowTexts: ['高原血统额外移动速度', 'move_speed'], effectTexts: ['duration_ms'],
        resultRowTexts: ['高原血统额外移动速度', 'attribute', '属性变化', '施法者'],
        resultTexts: ['属性变化', '施法者', 'move_speed_ratio']
      }
    ],
    triggerTexts: ['技能被主动或消耗使用', 'masteryi_r', '主动', '执行效果', '当前目标', 'attack_speed', 'move_speed']
  },
  {
    id: 'skarner', skillKey: 'skarner_w', skillName: '斯卡纳·震地壁垒', ruleKey: 'on_used', actionCount: 1,
    formula: {
      formulaKey: 'shield_value', formulaRowTexts: ['震地壁垒自身护盾值', 'shield_value'],
      formulaTexts: ['生命值', '施法者', '最终值', 'shield_stat12_ratio', '乘']
    },
    effects: [{
      effectKey: 'self_shield', resultKey: 'shield',
      effectRowTexts: ['震地壁垒自身普通护盾', 'self_shield'], effectTexts: ['shield_duration_ms'],
      resultRowTexts: ['震地壁垒自身普通护盾', 'shield', '普通护盾', '施法者'],
      resultTexts: ['普通护盾', '施法者', 'shield_value', '全部伤害', '不衰减']
    }],
    triggerTexts: ['技能被主动或消耗使用', 'skarner_w', '主动', '执行效果', '当前目标', 'self_shield']
  },
  {
    id: 'diana', skillKey: 'diana_w', skillName: '黛安娜·苍白之瀑', ruleKey: 'on_used', actionCount: 1,
    process: { processKey: 'cast', processName: '施放苍白之瀑', bindingKeys: ['mana_cost', 'pale_cascade_shield'] },
    triggerTexts: ['技能被主动或消耗使用', 'diana_w', '主动', '启动过程', '当前目标', 'cast']
  }
];
assert.deepEqual(targets.map((target) => target.id), targetConfigs.map((target) => target.id), '页面目标与冻结写入集合不一致');

function requireText(actual, expected, context) {
  for (const item of expected) assert(actual.includes(item), `${context} 缺少“${item}”；实际内容：${actual}`);
}

async function closeDialog(dialog) {
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await dialog.waitFor({ state: 'hidden' });
}

async function waitInputValue(page, locator, expected, context) {
  const deadline = Date.now() + 30_000;
  let actual = '';
  while (Date.now() < deadline) {
    actual = await locator.inputValue();
    if (actual === expected) return;
    await page.waitForTimeout(100);
  }
  assert.equal(actual, expected, `${context} 未加载最终详情`);
}

async function waitForTexts(page, locator, expected, context) {
  const deadline = Date.now() + 30_000;
  let actual = '';
  while (Date.now() < deadline) {
    actual = await locator.innerText();
    if (expected.every((item) => actual.includes(item))) return actual;
    await page.waitForTimeout(100);
  }
  requireText(actual, expected, context);
  return actual;
}

async function selectedOptionText(dialog, label) {
  const control = dialog.getByRole('combobox', { name: label, exact: true });
  await control.waitFor({ timeout: 30_000 });
  return (await control.textContent())?.trim() ?? '';
}

async function waitReady(page) {
  await page.locator('.app-toolbar').getByText('就绪', { exact: true }).waitFor({ timeout: 30_000 });
}

async function openSkill(page, target) {
  await page.goto(`${baseUrl}/#/skills`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const main = page.locator('.app-main');
  await main.getByRole('button', { name: '重置', exact: true }).first().click();
  await page.getByLabel('技能关键词', { exact: true }).fill(target.skillKey);
  await main.getByRole('button', { name: '查询', exact: true }).click();
  const keyCell = page.getByRole('cell', { name: target.skillKey, exact: true }).last();
  await keyCell.waitFor({ timeout: 30_000 });
  const row = keyCell.locator('xpath=ancestor::tr');
  requireText(await row.innerText(), [target.skillName, target.skillKey, '启用'], `${target.skillKey} 列表行`);
  const image = row.locator('img').first();
  await image.waitFor({ timeout: 30_000 });
  const handle = await image.elementHandle();
  assert(handle, `${target.skillKey} 图片节点不存在`);
  await page.waitForFunction((node) => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0, handle);
  const imageState = await image.evaluate((node) => ({
    alt: node.getAttribute('alt'),
    complete: node.complete,
    naturalWidth: node.naturalWidth,
    naturalHeight: node.naturalHeight
  }));
  assert.equal(imageState.alt, `${target.skillName}代表图片`);
  assert.deepEqual([imageState.complete, imageState.naturalWidth, imageState.naturalHeight], [true, 64, 64]);
  await page.screenshot({ path: path.join(screenshotDir, `${target.skillKey}-列表图片.png`), fullPage: true });
  return { row, imageState };
}

async function inspectProcess(page, target, row) {
  if (!target.process) return null;
  await row.getByRole('button', { name: '过程与内部状态', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `过程与内部状态 - ${target.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  const processCell = shell.getByRole('cell', { name: target.process.processKey, exact: true }).last();
  await processCell.waitFor({ timeout: 30_000 });
  const processRow = processCell.locator('xpath=ancestor::tr');
  requireText(await processRow.innerText(), [target.process.processName, target.process.processKey, '主动'], `${target.skillKey} 过程行`);
  await processRow.getByRole('button', { name: '查看', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '查看过程' });
  await dialog.waitFor({ timeout: 30_000 });
  await waitInputValue(page, dialog.getByLabel('过程标识', { exact: true }), target.process.processKey, `${target.skillKey} 过程`);
  await waitInputValue(page, dialog.getByLabel('过程名称', { exact: true }), target.process.processName, `${target.skillKey} 过程名称`);
  const expectedTexts = ['启动方式', '配置普通冷却', '基础冷却时间（毫秒）', ...target.process.bindingKeys];
  const detailText = await waitForTexts(page, dialog, expectedTexts, `${target.skillKey} 过程详情`);
  const activationType = await selectedOptionText(dialog, '启动方式');
  assert.equal(activationType, '主动', `${target.skillKey} 过程启动方式不符`);
  await page.screenshot({ path: path.join(screenshotDir, `${target.skillKey}-cast过程.png`), fullPage: true });
  await closeDialog(dialog);
  await closeDialog(shell);
  return {
    processKey: target.process.processKey,
    activationType,
    cooldownVisible: detailText.includes('基础冷却时间（毫秒）'),
    bindingsVisible: target.process.bindingKeys.every((key) => detailText.includes(key))
  };
}

async function inspectFormula(page, target, row) {
  if (!target.formula) return null;
  await row.getByRole('button', { name: '参数与公式', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `参数与公式 - ${target.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  await shell.getByRole('tab', { name: '技能公式', exact: true }).click();
  const formulaCell = shell.getByText(target.formula.formulaKey, { exact: true }).last();
  await formulaCell.waitFor({ timeout: 30_000 });
  const formulaRow = formulaCell.locator('xpath=ancestor::tr');
  requireText(await formulaRow.innerText(), target.formula.formulaRowTexts, `${target.skillKey} 公式行`);
  await formulaRow.getByRole('button', { name: '查看', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '查看公式' });
  await dialog.waitFor({ timeout: 30_000 });
  await waitInputValue(page, dialog.getByLabel('稳定标识', { exact: true }), target.formula.formulaKey, `${target.skillKey} 公式`);
  const detailText = await waitForTexts(page, dialog, target.formula.formulaTexts, `${target.skillKey} 公式详情`);
  await page.screenshot({ path: path.join(screenshotDir, `${target.skillKey}-${target.formula.formulaKey}公式.png`), fullPage: true });
  await closeDialog(dialog);
  await closeDialog(shell);
  return { formulaKey: target.formula.formulaKey, expectedTextsVisible: target.formula.formulaTexts.every((item) => detailText.includes(item)) };
}

async function inspectEffects(page, target, row) {
  if (!target.effects?.length) return [];
  const results = [];
  for (const effect of target.effects) {
    await row.getByRole('button', { name: '效果与结果', exact: true }).click();
    const shell = page.getByRole('dialog', { name: `效果与结果 - ${target.skillName}` });
    await shell.waitFor({ timeout: 30_000 });
    const effectCell = shell.getByText(effect.effectKey, { exact: true }).last();
    await effectCell.waitFor({ timeout: 30_000 });
    const effectRow = effectCell.locator('xpath=ancestor::tr');
    requireText(await effectRow.innerText(), effect.effectRowTexts, `${target.skillKey} 效果行`);
    await effectRow.getByRole('button', { name: '查看', exact: true }).click();
    const effectDialog = page.getByRole('dialog', { name: '查看效果' });
    await effectDialog.waitFor({ timeout: 30_000 });
    const effectText = await waitForTexts(page, effectDialog, effect.effectTexts || [], `${target.skillKey} 效果详情`);
    const resultCell = effectDialog.getByText(effect.resultKey, { exact: true }).last();
    await resultCell.waitFor({ timeout: 30_000 });
    const resultRow = resultCell.locator('xpath=ancestor::tr');
    requireText(await resultRow.innerText(), effect.resultRowTexts, `${target.skillKey} 结果行`);
    await resultRow.getByRole('button', { name: '查看', exact: true }).click();
    const resultDialog = page.getByRole('dialog', { name: '查看结果' });
    await resultDialog.waitFor({ timeout: 30_000 });
    const resultText = await waitForTexts(page, resultDialog, effect.resultTexts, `${target.skillKey} 结果详情`);
    await page.screenshot({ path: path.join(screenshotDir, `${target.skillKey}-${effect.effectKey}结果.png`), fullPage: true });
    await closeDialog(resultDialog);
    await closeDialog(effectDialog);
    await closeDialog(shell);
    results.push({
      effectKey: effect.effectKey,
      resultKey: effect.resultKey,
      effectExpectedTextsVisible: (effect.effectTexts || []).every((item) => effectText.includes(item)),
      resultExpectedTextsVisible: effect.resultTexts.every((item) => resultText.includes(item))
    });
  }
  return results;
}

async function inspectTrigger(page, target, row) {
  await row.getByRole('button', { name: '条件与触发', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `条件与触发 - ${target.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  const ruleCell = shell.getByText(target.ruleKey, { exact: true }).last();
  await ruleCell.waitFor({ timeout: 30_000 });
  const ruleRow = ruleCell.locator('xpath=ancestor::tr');
  requireText(await ruleRow.innerText(), [target.ruleKey, String(target.actionCount)], `${target.skillKey} 规则行`);
  await ruleRow.getByRole('button', { name: '编辑', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑规则' });
  await dialog.waitFor({ timeout: 30_000 });
  await waitInputValue(page, dialog.getByLabel('规则标识', { exact: true }), target.ruleKey, `${target.skillKey} 规则`);
  const detailText = await waitForTexts(page, dialog, target.triggerTexts, `${target.skillKey} 规则详情`);
  const useKind = await selectedOptionText(dialog, '使用种类');
  assert.equal(useKind, '主动', `${target.skillKey} 使用种类不符`);
  await page.screenshot({ path: path.join(screenshotDir, `${target.skillKey}-${target.ruleKey}规则.png`), fullPage: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await closeDialog(shell);
  return { ruleKey: target.ruleKey, useKind, expectedTextsVisible: target.triggerTexts.every((item) => detailText.includes(item)) };
}

fs.mkdirSync(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const methods = {};
const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [], errorResponses: [], expectedCancelledImageReads: [] };
page.on('console', (message) => { if (message.type() === 'error') diagnostics.consoleErrors.push(message.text()); });
page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error)));
page.on('request', (request) => { methods[request.method()] = (methods[request.method()] ?? 0) + 1; });
page.on('requestfailed', (request) => {
  const failure = { method: request.method(), url: request.url(), error: request.failure()?.errorText ?? null };
  if (failure.method === 'GET' && failure.error === 'net::ERR_ABORTED' && failure.url.endsWith('/representative-image')) diagnostics.expectedCancelledImageReads.push(failure);
  else diagnostics.requestFailures.push(failure);
});
page.on('response', (response) => {
  if (response.status() >= 400) diagnostics.errorResponses.push({ status: response.status(), url: response.url() });
});
await page.addInitScript(({ token }) => {
  localStorage.setItem('damage-viewer.web.api-base-url', 'http://127.0.0.1:8080');
  localStorage.setItem('damage-viewer.web.admin-token', token);
}, { token: crypto.randomUUID() });

const checks = [];
try {
  await page.goto(`${baseUrl}/#/images`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.getByRole('button', { name: '全量同步', exact: true }).click();
  const syncMessage = page.getByText(/全量同步完成，本次接收 \d+ 条变化。/).first();
  await syncMessage.waitFor({ timeout: 90_000 });
  checks.push({ area: '本地图片缓存', observed: await syncMessage.innerText(), passed: true });

  for (const target of targets) {
    const opened = await openSkill(page, target);
    const process = await inspectProcess(page, target, opened.row);
    const formula = await inspectFormula(page, target, opened.row);
    const effects = await inspectEffects(page, target, opened.row);
    const trigger = await inspectTrigger(page, target, opened.row);
    checks.push({ area: target.skillKey, passed: true, representativeImage: opened.imageState, process, formula, effects, trigger });
  }

  const businessWrites = Object.entries(methods)
    .filter(([method]) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
    .reduce((sum, [, count]) => sum + count, 0);
  assert.equal(businessWrites, 0, '页面只读验收不得发出业务写入');
  assert.deepEqual({
    consoleErrors: diagnostics.consoleErrors,
    pageErrors: diagnostics.pageErrors,
    requestFailures: diagnostics.requestFailures,
    errorResponses: diagnostics.errorResponses
  }, { consoleErrors: [], pageErrors: [], requestFailures: [], errorResponses: [] });

  const report = {
    schemaVersion: 2,
    revision: 'rev1',
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    passed: true,
    url: baseUrl,
    browser: 'Playwright Chromium 真实页面',
    methodPolicy: 'BROWSER_READ_ONLY',
    authorizationValueRecorded: false,
    cacheSyncIsLocalOnly: true,
    methods,
    businessWrites,
    checks,
    screenshots: fs.readdirSync(screenshotDir).sort(),
    diagnostics,
    runtimeValidation: '未执行战斗运行；本报告证明管理页面展示、图片加载和只读交互。',
    scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ passed: true, checks: checks.length, methods, businessWrites, screenshots: report.screenshots }));
} finally {
  await browser.close();
}
