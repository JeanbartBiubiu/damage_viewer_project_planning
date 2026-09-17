import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';
import { targetConfigs } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(here, '页面截图');
const reportPath = path.join(here, '07-页面验收.json');
const baseUrl = 'http://127.0.0.1:5173';
if (fs.existsSync(reportPath)) throw new Error('07-页面验收.json 已存在，拒绝覆盖。');

const targets = targetConfigs.map((config) => ({
  id: config.id,
  skillKey: config.skillKey,
  skillName: config.skillName,
  formulaKey: config.formulaKey,
  formulaRowTexts: config.formulaRowTexts,
  formulaTexts: config.formulaTexts,
  effectKey: config.effectKey,
  resultKey: config.resultKey,
  effectRowTexts: config.effectRowTexts,
  resultRowTexts: config.resultRowTexts,
  resultTexts: config.resultTexts,
  ruleKey: config.ruleKey,
  triggerTexts: ['技能命中', config.skillKey, '事件对方类别', '英雄', '执行效果', '当前目标', config.effectKey]
}));
assert.deepEqual(
  targets.map(({ id, skillKey, ruleKey, effectKey }) => ({ id, skillKey, ruleKey, effectKey })),
  targetConfigs.map(({ id, skillKey, ruleKey, effectKey }) => ({ id, skillKey, ruleKey, effectKey })),
  '页面目标与冻结配置不一致'
);

function requireText(actual, expected, context) {
  for (const text of expected) assert(actual.includes(text), `${context} 缺少“${text}”；实际内容：${actual}`);
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
async function inspectFormula(page, target, row) {
  await row.getByRole('button', { name: '参数与公式', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `参数与公式 - ${target.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  await shell.getByRole('tab', { name: '技能公式', exact: true }).click();
  const formulaCell = shell.getByText(target.formulaKey, { exact: true }).last();
  await formulaCell.waitFor({ timeout: 30_000 });
  const formulaRow = formulaCell.locator('xpath=ancestor::tr');
  requireText(await formulaRow.innerText(), target.formulaRowTexts, `${target.skillKey} 公式行`);
  await formulaRow.getByRole('button', { name: '查看', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '查看公式' });
  await dialog.waitFor({ timeout: 30_000 });
  await waitInputValue(page, dialog.getByLabel('稳定标识', { exact: true }), target.formulaKey, `${target.skillKey} 公式`);
  const text = await waitForTexts(page, dialog, target.formulaTexts, `${target.skillKey} 公式详情`);
  await page.screenshot({ path: path.join(screenshotDir, `${target.skillKey}-${target.formulaKey}公式.png`), fullPage: true });
  await closeDialog(dialog);
  await closeDialog(shell);
  return { formulaKey: target.formulaKey, expectedTextsVisible: target.formulaTexts.every((item) => text.includes(item)) };
}
async function inspectEffect(page, target, row) {
  await row.getByRole('button', { name: '效果与结果', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `效果与结果 - ${target.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  const effectCell = shell.getByText(target.effectKey, { exact: true }).last();
  await effectCell.waitFor({ timeout: 30_000 });
  const effectRow = effectCell.locator('xpath=ancestor::tr');
  requireText(await effectRow.innerText(), target.effectRowTexts, `${target.skillKey} 效果行`);
  await effectRow.getByRole('button', { name: '查看', exact: true }).click();
  const effectDialog = page.getByRole('dialog', { name: '查看效果' });
  await effectDialog.waitFor({ timeout: 30_000 });
  const resultCell = effectDialog.getByText(target.resultKey, { exact: true }).last();
  await resultCell.waitFor({ timeout: 30_000 });
  const resultRow = resultCell.locator('xpath=ancestor::tr');
  requireText(await resultRow.innerText(), target.resultRowTexts, `${target.skillKey} 结果行`);
  await resultRow.getByRole('button', { name: '查看', exact: true }).click();
  const resultDialog = page.getByRole('dialog', { name: '查看结果' });
  await resultDialog.waitFor({ timeout: 30_000 });
  const text = await waitForTexts(page, resultDialog, target.resultTexts, `${target.skillKey} 结果详情`);
  await page.screenshot({ path: path.join(screenshotDir, `${target.skillKey}-${target.effectKey}结果.png`), fullPage: true });
  await closeDialog(resultDialog);
  await closeDialog(effectDialog);
  await closeDialog(shell);
  return { effectKey: target.effectKey, resultKey: target.resultKey, expectedTextsVisible: target.resultTexts.every((item) => text.includes(item)) };
}
async function inspectTrigger(page, target, row) {
  await row.getByRole('button', { name: '条件与触发', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `条件与触发 - ${target.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  const ruleCell = shell.getByText(target.ruleKey, { exact: true }).last();
  await ruleCell.waitFor({ timeout: 30_000 });
  const ruleRow = ruleCell.locator('xpath=ancestor::tr');
  requireText(await ruleRow.innerText(), [target.ruleKey, '1'], `${target.skillKey} 规则行`);
  await ruleRow.getByRole('button', { name: '编辑', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑规则' });
  await dialog.waitFor({ timeout: 30_000 });
  await waitInputValue(page, dialog.getByLabel('规则标识', { exact: true }), target.ruleKey, `${target.skillKey} 规则`);
  const text = await waitForTexts(page, dialog, target.triggerTexts, `${target.skillKey} 规则详情`);
  await page.screenshot({ path: path.join(screenshotDir, `${target.skillKey}-${target.ruleKey}规则.png`), fullPage: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await closeDialog(shell);
  return { ruleKey: target.ruleKey, expectedTextsVisible: target.triggerTexts.every((item) => text.includes(item)) };
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
    const formula = await inspectFormula(page, target, opened.row);
    const effect = await inspectEffect(page, target, opened.row);
    const trigger = await inspectTrigger(page, target, opened.row);
    checks.push({ area: target.skillKey, passed: true, representativeImage: opened.imageState, formula, effect, trigger });
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
    schemaVersion: 1,
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
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ passed: true, checks: checks.length, methods, businessWrites, screenshots: report.screenshots.length }));
} finally {
  await browser.close();
}
