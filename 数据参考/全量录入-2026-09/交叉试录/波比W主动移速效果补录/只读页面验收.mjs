import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';
import { target } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(here, '页面截图');
const reportPath = path.join(here, '08-页面验收.json');
const baseUrl = 'http://127.0.0.1:5173';
if (fs.existsSync(reportPath)) throw new Error('08-页面验收.json 已存在，拒绝覆盖。');

const pageTarget = {
  skillKey: target.skillKey,
  skillName: target.skillName,
  effectKey: target.effectKey,
  resultKey: target.resultKey,
  effectRowTexts: ['坚定风采主动移动速度', target.effectKey],
  effectTexts: [target.durationParameterKey],
  resultRowTexts: ['坚定风采主动移动速度', target.resultKey, '属性变化', '施法者'],
  resultTexts: ['属性变化', '施法者', target.valueParameterKey, '移动速度加成比例', '属性固定加算']
};

function requireText(actual, expected, context) {
  for (const text of expected) assert(actual.includes(text), context + ' 缺少“' + text + '”；实际内容：' + actual);
}
async function closeDialog(dialog) {
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await dialog.waitFor({ state: 'hidden' });
}
async function waitForTexts(page, locator, expected, context) {
  const deadline = Date.now() + 30_000;
  let actual = '';
  while (Date.now() < deadline) {
    actual = await locator.innerText();
    if (expected.every(text => actual.includes(text))) return actual;
    await page.waitForTimeout(100);
  }
  requireText(actual, expected, context);
  return actual;
}
async function waitInputValue(page, locator, expected, context) {
  const deadline = Date.now() + 30_000;
  let actual = '';
  while (Date.now() < deadline) {
    actual = await locator.inputValue();
    if (actual === expected) return actual;
    await page.waitForTimeout(100);
  }
  assert.equal(actual, expected, context + ' 控件值不符');
  return actual;
}
async function waitReady(page) {
  await page.locator('.app-toolbar').getByText('就绪', { exact: true }).waitFor({ timeout: 30_000 });
}

fs.mkdirSync(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const methods = {};
const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [], errorResponses: [], expectedCancelledImageReads: [] };
page.on('console', message => { if (message.type() === 'error') diagnostics.consoleErrors.push(message.text()); });
page.on('pageerror', error => diagnostics.pageErrors.push(String(error)));
page.on('request', request => { methods[request.method()] = (methods[request.method()] || 0) + 1; });
page.on('requestfailed', request => {
  const failure = { method: request.method(), url: request.url(), error: request.failure()?.errorText || null };
  if (failure.method === 'GET' && failure.error === 'net::ERR_ABORTED' && failure.url.endsWith('/representative-image')) diagnostics.expectedCancelledImageReads.push(failure);
  else diagnostics.requestFailures.push(failure);
});
page.on('response', response => { if (response.status() >= 400) diagnostics.errorResponses.push({ status: response.status(), url: response.url() }); });
await page.addInitScript(value => {
  localStorage.setItem('damage-viewer.web.api-base-url', 'http://127.0.0.1:8080');
  localStorage.setItem('damage-viewer.web.admin-token', value);
}, crypto.randomUUID());

try {
  await page.goto(baseUrl + '/#/images', { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.getByRole('button', { name: '全量同步', exact: true }).click();
  const syncMessage = page.getByText(/全量同步完成，本次接收 \d+ 条变化。/).first();
  await syncMessage.waitFor({ timeout: 90_000 });
  const syncText = await syncMessage.innerText();

  await page.goto(baseUrl + '/#/skills', { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const main = page.locator('.app-main');
  await main.getByRole('button', { name: '重置', exact: true }).first().click();
  await page.getByLabel('技能关键词', { exact: true }).fill(pageTarget.skillKey);
  await main.getByRole('button', { name: '查询', exact: true }).click();
  const keyCell = page.getByRole('cell', { name: pageTarget.skillKey, exact: true }).last();
  await keyCell.waitFor({ timeout: 30_000 });
  const row = keyCell.locator('xpath=ancestor::tr');
  requireText(await row.innerText(), [pageTarget.skillName, pageTarget.skillKey, '启用'], '技能列表行');
  const image = row.locator('img').first();
  await image.waitFor({ timeout: 30_000 });
  const handle = await image.elementHandle();
  assert(handle, '技能代表图节点不存在');
  await page.waitForFunction(node => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0, handle);
  const imageState = await image.evaluate(node => ({ alt: node.getAttribute('alt'), complete: node.complete, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight }));
  assert.deepEqual([imageState.complete, imageState.naturalWidth, imageState.naturalHeight], [true, 64, 64]);
  await page.screenshot({ path: path.join(screenshotDir, 'poppy_w-列表图片.png'), fullPage: true });

  await row.getByRole('button', { name: '效果与结果', exact: true }).click();
  const shell = page.getByRole('dialog', { name: '效果与结果 - ' + pageTarget.skillName });
  await shell.waitFor({ timeout: 30_000 });
  const effectCell = shell.getByText(pageTarget.effectKey, { exact: true }).last();
  await effectCell.waitFor({ timeout: 30_000 });
  const effectRow = effectCell.locator('xpath=ancestor::tr');
  requireText(await effectRow.innerText(), pageTarget.effectRowTexts, '效果行');
  await effectRow.getByRole('button', { name: '查看', exact: true }).click();
  const effectDialog = page.getByRole('dialog', { name: '查看效果' });
  await effectDialog.waitFor({ timeout: 30_000 });
  const effectText = await waitForTexts(page, effectDialog, pageTarget.effectTexts, '效果详情');
  const resultCell = effectDialog.getByText(pageTarget.resultKey, { exact: true }).last();
  await resultCell.waitFor({ timeout: 30_000 });
  const resultRow = resultCell.locator('xpath=ancestor::tr');
  requireText(await resultRow.innerText(), pageTarget.resultRowTexts, '结果行');
  await resultRow.getByRole('button', { name: '查看', exact: true }).click();
  const resultDialog = page.getByRole('dialog', { name: '查看结果' });
  await resultDialog.waitFor({ timeout: 30_000 });
  const resultText = await waitForTexts(page, resultDialog, pageTarget.resultTexts, '结果详情');
  const resultControlValues = {
    fixedMultiplier: await waitInputValue(page, resultDialog.getByLabel('固定倍率', { exact: true }), '0.01', '固定倍率')
  };
  await page.screenshot({ path: path.join(screenshotDir, 'poppy_w-active_move_speed-move_speed_gain.png'), fullPage: true });
  await closeDialog(resultDialog);
  await closeDialog(effectDialog);
  await closeDialog(shell);

  const businessWrites = Object.entries(methods).filter(([method]) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)).reduce((sum, [, count]) => sum + count, 0);
  assert.equal(businessWrites, 0, '页面只读验收不得写入');
  assert.deepEqual({ consoleErrors: diagnostics.consoleErrors, pageErrors: diagnostics.pageErrors, requestFailures: diagnostics.requestFailures, errorResponses: diagnostics.errorResponses }, { consoleErrors: [], pageErrors: [], requestFailures: [], errorResponses: [] });
  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    passed: true,
    browser: 'Playwright Chromium 真实页面',
    url: baseUrl,
    methodPolicy: 'BROWSER_READ_ONLY',
    authorizationValueRecorded: false,
    cacheSyncIsLocalOnly: true,
    target: { skillKey: target.skillKey, effectKey: target.effectKey, resultKey: target.resultKey },
    methods,
    businessWrites,
    checks: {
      cacheSync: syncText,
      representativeImage: imageState,
      effectTextsVisible: pageTarget.effectTexts.every(text => effectText.includes(text)),
      resultTextsVisible: pageTarget.resultTexts.every(text => resultText.includes(text)),
      resultControlValues
    },
    screenshots: fs.readdirSync(screenshotDir).sort(),
    diagnostics,
    runtimeValidation: '未执行战斗运行；本报告只证明管理页面、图片与效果结果只读展示。',
    scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ passed: true, methods, businessWrites, screenshots: report.screenshots.length }, null, 2));
} finally {
  await browser.close();
}
