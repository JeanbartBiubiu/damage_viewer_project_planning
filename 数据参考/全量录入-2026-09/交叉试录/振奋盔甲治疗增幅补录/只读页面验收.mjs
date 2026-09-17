import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';
import { batchConfig } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(here, '页面截图');
const reportPath = path.join(here, '09-页面验收.json');
const baseUrl = 'http://127.0.0.1:5173';
if (fs.existsSync(reportPath)) throw new Error('页面报告已存在，拒绝覆盖。');

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
async function waitReady(page) {
  await page.locator('.app-toolbar').getByText('就绪', { exact: true }).waitFor({ timeout: 30_000 });
}

fs.mkdirSync(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const methods = {};
const diagnostics = { consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [], errorResponses: [], expectedCancelledImageReads: [] };
page.on('console', (message) => {
  if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
});
page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error)));
page.on('request', (request) => { methods[request.method()] = (methods[request.method()] ?? 0) + 1; });
page.on('requestfailed', (request) => {
  const failure = { method: request.method(), url: request.url(), error: request.failure()?.errorText ?? null };
  if (failure.method === 'GET' && failure.error === 'net::ERR_ABORTED' && failure.url.endsWith('/representative-image')) diagnostics.expectedCancelledImageReads.push(failure);
  else diagnostics.requestFailures.push(failure);
});
page.on('response', (response) => { if (response.status() >= 400) diagnostics.errorResponses.push({ status: response.status(), url: response.url() }); });
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
  checks.push({ area: '本地图片缓存', passed: true, observed: await syncMessage.innerText() });

  await page.goto(`${baseUrl}/#/modifier-zones`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const main = page.locator('.app-main');
  await main.getByRole('button', { name: '刷新', exact: true }).first().click();
  const zoneCell = page.getByRole('cell', { name: batchConfig.modifierZone.modifierZoneKey, exact: true }).first();
  await zoneCell.waitFor({ timeout: 30_000 });
  const zoneRow = zoneCell.locator('xpath=ancestor::tr');
  requireText(await zoneRow.innerText(), [batchConfig.modifierZone.name, '治疗', '比例加算', '治疗结果', '启用'], '治疗乘区列表行');
  await zoneRow.getByRole('button', { name: '查看', exact: true }).click();
  const zoneDialog = page.getByRole('dialog', { name: '查看乘区' });
  await zoneDialog.waitFor({ timeout: 30_000 });
  assert.equal(await zoneDialog.getByLabel('乘区标识', { exact: true }).inputValue(), batchConfig.modifierZone.modifierZoneKey);
  assert.equal(await zoneDialog.getByLabel('乘区名称', { exact: true }).inputValue(), batchConfig.modifierZone.name);
  requireText(await zoneDialog.innerText(), ['治疗', '比例加算', '治疗结果', '状态：启用'], '治疗乘区详情');
  await page.screenshot({ path: path.join(screenshotDir, '振奋盔甲治疗乘区.png'), fullPage: true });
  await closeDialog(zoneDialog);
  checks.push({ area: '治疗乘区', passed: true, key: batchConfig.modifierZone.modifierZoneKey });

  await page.goto(`${baseUrl}/#/skills`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await main.getByRole('button', { name: '重置', exact: true }).first().click();
  await page.getByLabel('技能关键词', { exact: true }).fill('item_3065_passive');
  await main.getByRole('button', { name: '查询', exact: true }).click();
  const skillCell = page.getByRole('cell', { name: 'item_3065_passive', exact: true }).last();
  await skillCell.waitFor({ timeout: 30_000 });
  const skillRow = skillCell.locator('xpath=ancestor::tr');
  requireText(await skillRow.innerText(), [batchConfig.updatedSkill.name, 'item_3065_passive', '启用'], '振奋盔甲技能列表行');
  const image = skillRow.locator('img').first();
  await image.waitFor({ timeout: 30_000 });
  const handle = await image.elementHandle();
  assert(handle, '振奋盔甲图片节点不存在');
  await page.waitForFunction((node) => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0, handle);
  const imageState = await image.evaluate((node) => ({ alt: node.getAttribute('alt'), complete: node.complete, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight }));
  assert.equal(imageState.alt, `${batchConfig.updatedSkill.name}代表图片`);
  assert.deepEqual([imageState.complete, imageState.naturalWidth, imageState.naturalHeight], [true, 64, 64]);
  await page.screenshot({ path: path.join(screenshotDir, '振奋盔甲技能列表.png'), fullPage: true });

  await skillRow.getByRole('button', { name: '效果与结果', exact: true }).click();
  const effectShell = page.getByRole('dialog', { name: `效果与结果 - ${batchConfig.updatedSkill.name}` });
  await effectShell.waitFor({ timeout: 30_000 });
  const effectRow = effectShell.locator('tr', { hasText: batchConfig.effect.effectKey }).first();
  await effectRow.waitFor({ timeout: 30_000 });
  requireText(await effectRow.innerText(), [batchConfig.effect.name, batchConfig.effect.effectKey, '有生命周期'], '振奋盔甲效果行');
  await effectRow.getByRole('button', { name: '查看', exact: true }).click();
  const effectDialog = page.getByRole('dialog', { name: '查看效果' });
  await effectDialog.waitFor({ timeout: 30_000 });
  const resultRow = effectDialog.locator('tr', { hasText: 'healing_received' }).first();
  await resultRow.waitFor({ timeout: 30_000 });
  requireText(await resultRow.innerText(), ['healing_received', '治疗修正', '施法者'], '受到治疗增幅结果行');
  await resultRow.getByRole('button', { name: '查看', exact: true }).click();
  const resultDialog = page.getByRole('dialog', { name: '查看结果' });
  await resultDialog.waitFor({ timeout: 30_000 });
  await resultDialog.getByText('目录不完整，无法保存未知引用。', { exact: true }).waitFor({ state: 'hidden', timeout: 30_000 });
  const resultText = await resultDialog.innerText();
  requireText(resultText, ['无拘活力受到治疗护盾增幅', 'heal_shield_power_bonus', batchConfig.modifierZone.name, '治疗修正', '施法者', '受到的治疗', '提高', '全部', '持续生效', '施加时留存', '整个实例共享数值', '覆盖'], '受到治疗增幅结果详情');
  const checkedValue = async (label) => resultDialog.getByLabel(label, { exact: true }).locator('input:checked').getAttribute('value');
  assert.equal(await checkedValue('作用对象'), 'SOURCE');
  assert.equal(await checkedValue('治疗修正作用方向'), 'RECEIVED');
  assert.equal(await checkedValue('治疗修正方式'), 'INCREASE');
  assert.equal(await checkedValue('治疗种类'), 'ANY');
  await page.screenshot({ path: path.join(screenshotDir, '振奋盔甲受到治疗结果.png'), fullPage: true });
  await closeDialog(resultDialog);
  await closeDialog(effectDialog);
  await closeDialog(effectShell);

  await skillRow.getByRole('button', { name: '条件与触发', exact: true }).click();
  const ruleShell = page.getByRole('dialog', { name: `条件与触发 - ${batchConfig.updatedSkill.name}` });
  await ruleShell.waitFor({ timeout: 30_000 });
  const ruleRow = ruleShell.locator('tr', { hasText: batchConfig.rule.ruleKey }).first();
  await ruleRow.waitFor({ timeout: 30_000 });
  requireText(await ruleRow.innerText(), [batchConfig.rule.ruleKey, '来源对象初始化完成', '1'], '振奋盔甲规则行');
  await ruleRow.getByRole('button', { name: '编辑', exact: true }).click();
  const ruleDialog = page.getByRole('dialog', { name: '编辑规则' });
  await ruleDialog.waitFor({ timeout: 30_000 });
  await waitInputValue(page, ruleDialog.getByLabel('规则标识', { exact: true }), batchConfig.rule.ruleKey, '振奋盔甲规则');
  const ruleText = await ruleDialog.innerText();
  requireText(ruleText, ['来源对象初始化完成', '执行无拘活力受到治疗增幅', '执行效果', '事件来源对象', batchConfig.effect.effectKey], '振奋盔甲规则详情');
  await page.screenshot({ path: path.join(screenshotDir, '振奋盔甲初始化规则.png'), fullPage: true });
  await ruleDialog.getByRole('button', { name: '取消', exact: true }).click();
  await ruleDialog.waitFor({ state: 'hidden' });
  await closeDialog(ruleShell);
  checks.push({ area: 'item_3065_passive', passed: true, representativeImage: imageState, effectKey: batchConfig.effect.effectKey, resultKey: 'healing_received', ruleKey: batchConfig.rule.ruleKey, resultDetailObserved: true, triggerDetailObserved: true });

  const businessWrites = Object.entries(methods).filter(([method]) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)).reduce((sum, [, count]) => sum + count, 0);
  const nonGetRequests = Object.entries(methods).filter(([method]) => method !== 'GET').reduce((sum, [, count]) => sum + count, 0);
  assert.equal(businessWrites, 0, '页面只读验收不得发出业务写入');
  assert.equal(nonGetRequests, 0, '页面只读验收不得发出非GET请求');
  assert.deepEqual({ consoleErrors: diagnostics.consoleErrors, consoleWarnings: diagnostics.consoleWarnings, pageErrors: diagnostics.pageErrors, requestFailures: diagnostics.requestFailures, errorResponses: diagnostics.errorResponses }, { consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [], errorResponses: [] });

  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    targetSource: '08-页面目标.json',
    targetCount: 1,
    url: baseUrl,
    browser: 'Playwright Chromium 真实页面',
    methodPolicy: 'BROWSER_READ_ONLY',
    authorizationValueRecorded: false,
    cacheSyncIsLocalOnly: true,
    methods,
    businessWrites,
    nonGetRequests,
    getRequests: methods.GET ?? 0,
    consoleErrors: diagnostics.consoleErrors.length,
    consoleWarnings: diagnostics.consoleWarnings.length,
    pageErrors: diagnostics.pageErrors.length,
    failedRequests: diagnostics.requestFailures.length,
    errorResponses: diagnostics.errorResponses.length,
    checks,
    targets: [{ skillKey: 'item_3065_passive', matched: true, representativeImage: imageState, modifierZoneKey: batchConfig.modifierZone.modifierZoneKey, effectKey: batchConfig.effect.effectKey, resultKey: 'healing_received', ruleKey: batchConfig.rule.ruleKey }],
    screenshots: fs.readdirSync(screenshotDir).sort(),
    diagnostics,
    runtimeValidation: batchConfig.runtimeBoundary,
    scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, targetCount: report.targetCount, methods, businessWrites, screenshots: report.screenshots }, null, 2));
} finally {
  await browser.close();
}
