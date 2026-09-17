import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(here, '页面截图');
const reportPath = path.join(here, '08-页面验收.json');
const baseUrl = 'http://127.0.0.1:5173';
if (fs.existsSync(reportPath)) throw new Error('页面报告已存在，拒绝覆盖');

const skills = {
  olaf: {
    skillKey: 'olaf_w',
    skillName: '奥拉夫·挺过去',
    ruleKey: 'on_used'
  },
  garen: {
    skillKey: 'garen_r',
    skillName: '盖伦·德玛西亚正义',
    formulaKey: 'damage',
    effectKey: 'justice_damage',
    resultKey: 'damage',
    ruleKey: 'on_hit'
  }
};

function requireText(actual, expected, context) {
  for (const text of expected) {
    assert(actual.includes(text), `${context} 缺少“${text}”；实际内容：${actual}`);
  }
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
    if (expected.every((text) => actual.includes(text))) return actual;
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

async function openSkill(page, subject) {
  await page.goto(`${baseUrl}/#/skills`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const main = page.locator('.app-main');
  await main.getByRole('button', { name: '重置', exact: true }).first().click();
  await page.getByLabel('技能关键词', { exact: true }).fill(subject.skillKey);
  await main.getByRole('button', { name: '查询', exact: true }).click();
  const keyCell = page.getByRole('cell', { name: subject.skillKey, exact: true }).last();
  await keyCell.waitFor({ timeout: 30_000 });
  const row = keyCell.locator('xpath=ancestor::tr');
  requireText(await row.innerText(), [subject.skillName, subject.skillKey, '启用'], `${subject.skillKey} 列表行`);
  const image = row.locator('img').first();
  await image.waitFor({ timeout: 30_000 });
  await page.waitForFunction((node) => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0, await image.elementHandle());
  const imageState = await image.evaluate((node) => ({
    alt: node.getAttribute('alt'),
    complete: node.complete,
    naturalWidth: node.naturalWidth,
    naturalHeight: node.naturalHeight
  }));
  assert.equal(imageState.alt, `${subject.skillName}代表图片`);
  assert.deepEqual([imageState.complete, imageState.naturalWidth, imageState.naturalHeight], [true, 64, 64]);
  await page.screenshot({ path: path.join(screenshotDir, `${subject.skillKey}-列表图片.png`), fullPage: true });
  return { row, imageState };
}

async function inspectOlafProcess(page, row) {
  await row.getByRole('button', { name: '过程与内部状态', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `过程与内部状态 - ${skills.olaf.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  const processCell = shell.getByRole('cell', { name: 'cast', exact: true }).last();
  await processCell.waitFor({ timeout: 30_000 });
  const processRow = processCell.locator('xpath=ancestor::tr');
  requireText(await processRow.innerText(), ['施放挺过去', 'cast', '主动', '1', '3'], '奥拉夫W过程行');
  await processRow.getByRole('button', { name: '查看', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '查看过程' });
  await dialog.waitFor({ timeout: 30_000 });
  await waitInputValue(page, dialog.getByLabel('过程标识', { exact: true }), 'cast', '奥拉夫W过程');
  await waitInputValue(page, dialog.getByLabel('过程名称', { exact: true }), '施放挺过去', '奥拉夫W过程名称');
  const detailText = await waitForTexts(page, dialog, [
    '启动方式',
    '配置普通冷却',
    '基础冷却时间（毫秒）',
    '施放开始',
    'mana_cost',
    'cast_shield',
    'attack_speed'
  ], '奥拉夫W过程详情');
  const activationType = await selectedOptionText(dialog, '启动方式');
  assert.equal(activationType, '主动', '奥拉夫W过程启动方式不符');
  await page.screenshot({ path: path.join(screenshotDir, 'olaf_w-cast过程.png'), fullPage: true });
  await closeDialog(dialog);
  await closeDialog(shell);
  return {
    processKey: 'cast',
    activationType,
    cooldownVisible: detailText.includes('基础冷却时间（毫秒）'),
    bindingsVisible: ['mana_cost', 'cast_shield', 'attack_speed'].every((key) => detailText.includes(key))
  };
}

async function inspectGarenFormula(page, row) {
  await row.getByRole('button', { name: '参数与公式', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `参数与公式 - ${skills.garen.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  await shell.getByRole('tab', { name: '技能公式', exact: true }).click();
  const formulaCell = shell.getByText(skills.garen.formulaKey, { exact: true }).last();
  await formulaCell.waitFor({ timeout: 30_000 });
  const formulaRow = formulaCell.locator('xpath=ancestor::tr');
  requireText(await formulaRow.innerText(), ['德玛西亚正义真实伤害', 'damage'], '盖伦R公式行');
  await formulaRow.getByRole('button', { name: '查看', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '查看公式' });
  await dialog.waitFor({ timeout: 30_000 });
  await waitInputValue(page, dialog.getByLabel('稳定标识', { exact: true }), 'damage', '盖伦R公式');
  const detailText = await waitForTexts(page, dialog, [
    '基础真实伤害',
    '目标已损失生命系数',
    '生命值',
    '目标',
    '已损失值',
    '乘',
    '加'
  ], '盖伦R公式详情');
  await page.screenshot({ path: path.join(screenshotDir, 'garen_r-伤害公式.png'), fullPage: true });
  await closeDialog(dialog);
  await closeDialog(shell);
  return { formulaKey: 'damage', targetMissingHealthVisible: detailText.includes('已损失值') };
}

async function inspectGarenEffect(page, row) {
  await row.getByRole('button', { name: '效果与结果', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `效果与结果 - ${skills.garen.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  const effectCell = shell.getByText(skills.garen.effectKey, { exact: true }).last();
  await effectCell.waitFor({ timeout: 30_000 });
  const effectRow = effectCell.locator('xpath=ancestor::tr');
  requireText(await effectRow.innerText(), ['德玛西亚正义命中伤害', 'justice_damage'], '盖伦R效果行');
  await effectRow.getByRole('button', { name: '查看', exact: true }).click();
  const effectDialog = page.getByRole('dialog', { name: '查看效果' });
  await effectDialog.waitFor({ timeout: 30_000 });
  const resultCell = effectDialog.getByText(skills.garen.resultKey, { exact: true }).last();
  await resultCell.waitFor({ timeout: 30_000 });
  const resultRow = resultCell.locator('xpath=ancestor::tr');
  requireText(await resultRow.innerText(), ['真实伤害', 'damage', '目标'], '盖伦R结果行');
  await resultRow.getByRole('button', { name: '查看', exact: true }).click();
  const resultDialog = page.getByRole('dialog', { name: '查看结果' });
  await resultDialog.waitFor({ timeout: 30_000 });
  const resultText = await waitForTexts(page, resultDialog, [
    '德玛西亚正义真实伤害',
    '真实伤害',
    '技能',
    '直接伤害',
    '目标',
    'damage'
  ], '盖伦R结果详情');
  await page.screenshot({ path: path.join(screenshotDir, 'garen_r-结果详情.png'), fullPage: true });
  await closeDialog(resultDialog);
  await closeDialog(effectDialog);
  await closeDialog(shell);
  return { effectKey: 'justice_damage', resultKey: 'damage', trueDamageVisible: resultText.includes('真实伤害') };
}

async function inspectTrigger(page, subject, row, expectedTexts, expectedUseKind = null) {
  await row.getByRole('button', { name: '条件与触发', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `条件与触发 - ${subject.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  const ruleCell = shell.getByText(subject.ruleKey, { exact: true }).last();
  await ruleCell.waitFor({ timeout: 30_000 });
  const ruleRow = ruleCell.locator('xpath=ancestor::tr');
  requireText(await ruleRow.innerText(), [subject.ruleKey, '1'], `${subject.skillKey} 规则行`);
  await ruleRow.getByRole('button', { name: '编辑', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑规则' });
  await dialog.waitFor({ timeout: 30_000 });
  await waitInputValue(page, dialog.getByLabel('规则标识', { exact: true }), subject.ruleKey, `${subject.skillKey} 规则`);
  const detailText = await waitForTexts(page, dialog, expectedTexts, `${subject.skillKey} 规则详情`);
  let useKind = null;
  if (expectedUseKind !== null) {
    useKind = await selectedOptionText(dialog, '使用种类');
    assert.equal(useKind, expectedUseKind, `${subject.skillKey} 使用种类不符`);
  }
  await page.screenshot({ path: path.join(screenshotDir, `${subject.skillKey}-${subject.ruleKey}规则.png`), fullPage: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await closeDialog(shell);
  return {
    ruleKey: subject.ruleKey,
    expectedTextsVisible: expectedTexts.every((text) => detailText.includes(text)),
    ...(useKind === null ? {} : { useKind })
  };
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
  if (failure.method === 'GET' && failure.error === 'net::ERR_ABORTED' && failure.url.endsWith('/representative-image')) {
    diagnostics.expectedCancelledImageReads.push(failure);
  } else {
    diagnostics.requestFailures.push(failure);
  }
});
page.on('response', (response) => {
  if (response.status() >= 400) diagnostics.errorResponses.push({ status: response.status(), url: response.url() });
});
await page.addInitScript(() => {
  localStorage.setItem('damage-viewer.web.api-base-url', 'http://127.0.0.1:8080');
  localStorage.setItem('damage-viewer.web.admin-token', 'local-entry');
});

const checks = [];
try {
  await page.goto(`${baseUrl}/#/images`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.getByRole('button', { name: '全量同步', exact: true }).click();
  const syncMessage = page.getByText(/全量同步完成，本次接收 \d+ 条变化。/).first();
  await syncMessage.waitFor({ timeout: 90_000 });
  checks.push({ area: '本地图片缓存', observed: await syncMessage.innerText(), passed: true });

  const olaf = await openSkill(page, skills.olaf);
  const olafProcess = await inspectOlafProcess(page, olaf.row);
  const olafRule = await inspectTrigger(page, skills.olaf, olaf.row, [
    '技能被主动或消耗使用',
    'olaf_w',
    '启动挺过去过程',
    '启动过程',
    '当前目标',
    'cast'
  ], '主动');
  checks.push({ area: 'olaf_w', passed: true, representativeImage: olaf.imageState, process: olafProcess, trigger: olafRule });

  const garen = await openSkill(page, skills.garen);
  const garenFormula = await inspectGarenFormula(page, garen.row);
  const garenEffect = await inspectGarenEffect(page, garen.row);
  const garenRule = await inspectTrigger(page, skills.garen, garen.row, [
    '技能命中',
    'garen_r',
    '事件对方类别',
    '英雄',
    '执行效果',
    '当前目标',
    'justice_damage'
  ]);
  checks.push({ area: 'garen_r', passed: true, representativeImage: garen.imageState, formula: garenFormula, effect: garenEffect, trigger: garenRule });

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
