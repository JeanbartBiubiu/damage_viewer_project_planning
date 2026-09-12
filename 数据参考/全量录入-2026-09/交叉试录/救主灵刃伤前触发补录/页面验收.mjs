import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(currentDir, '页面截图');
const reportPath = path.join(currentDir, '08-页面验收.json');
const baseUrl = 'http://127.0.0.1:5173';
const skillKey = 'item_3040_passive';
const skillName = '炽天使之拥·敬畏与救主灵刃';

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

fs.mkdirSync(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const diagnostics = {
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  errorResponses: [],
  expectedCancelledImageReads: []
};
const methods = {};

page.on('console', (message) => {
  if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
});
page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error)));
page.on('requestfailed', (request) => {
  const failure = {
    method: request.method(),
    url: request.url(),
    error: request.failure()?.errorText ?? null
  };
  if (failure.method === 'GET' && failure.error === 'net::ERR_ABORTED'
    && failure.url.endsWith('/representative-image')) {
    diagnostics.expectedCancelledImageReads.push(failure);
  } else {
    diagnostics.requestFailures.push(failure);
  }
});
page.on('response', (response) => {
  if (response.status() >= 400) diagnostics.errorResponses.push({
    status: response.status(),
    url: response.url()
  });
});
page.on('request', (request) => {
  methods[request.method()] = (methods[request.method()] ?? 0) + 1;
});

await page.addInitScript(() => {
  localStorage.setItem('damage-viewer.web.api-base-url', 'http://127.0.0.1:8080');
  localStorage.setItem('damage-viewer.web.admin-token', 'local-browser-entry');
});

const checks = [];
try {
  await page.goto(`${baseUrl}/#/images`, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-toolbar').getByText('就绪', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '全量同步', exact: true }).click();
  const syncMessage = page.getByText(/全量同步完成，本次接收 \d+ 条变化。/).first();
  await syncMessage.waitFor({ timeout: 90_000 });
  checks.push({ area: '本地图片缓存', passed: true, observed: await syncMessage.innerText() });

  await page.goto(`${baseUrl}/#/skills`, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-toolbar').getByText('就绪', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByLabel('技能关键词', { exact: true }).fill(skillKey);
  await page.locator('.app-main').getByRole('button', { name: '查询', exact: true }).click();
  const row = page.locator('tr', { hasText: skillKey }).first();
  await row.waitFor({ timeout: 30_000 });

  const listImage = row.locator('img').first();
  await listImage.waitFor({ timeout: 30_000 });
  const imageState = await listImage.evaluate((node) => ({
    alt: node.getAttribute('alt'),
    complete: node.complete,
    naturalWidth: node.naturalWidth,
    naturalHeight: node.naturalHeight
  }));
  assert.equal(imageState.alt, `${skillName}代表图片`);
  assert(imageState.complete && imageState.naturalWidth > 0 && imageState.naturalHeight > 0,
    '技能主表左侧代表图片未完成加载');
  await page.screenshot({ path: path.join(screenshotDir, '技能主表左侧图片.png'), fullPage: true });
  checks.push({ area: '技能主表', passed: true, representativeImage: imageState });

  await row.getByRole('button', { name: '参数与公式', exact: true }).click();
  const parameterShell = page.getByRole('dialog', { name: `参数与公式 - ${skillName}` });
  await parameterShell.waitFor({ timeout: 30_000 });
  const parameterText = await parameterShell.innerText();
  requireText(parameterText, [
    'bonus_ap_from_max_mana_ratio',
    'lifeline_health_threshold_ratio',
    '0.3',
    'lifeline_shield_duration_ms',
    '3000',
    'lifeline_cooldown_ms',
    '90000',
    'lifeline_shield_resource_ratio',
    '0.18',
    '计算时传入'
  ], '参数窗口');
  assert(!parameterText.includes('lifeline_shield_resource_input'), '旧运行时输入仍出现在参数窗口');
  await page.screenshot({ path: path.join(screenshotDir, '五项固定参数.png'), fullPage: true });

  await parameterShell.getByRole('tab', { name: '技能公式', exact: true }).click();
  const formulaText = await parameterShell.innerText();
  requireText(formulaText, [
    'bonus_ap_from_max_mana',
    'lifeline_shield_value',
    'lifeline_health_threshold_value'
  ], '公式列表');
  const shieldFormulaRow = parameterShell.locator('tr', { hasText: 'lifeline_shield_value' }).first();
  await shieldFormulaRow.getByRole('button', { name: '查看', exact: true }).click();
  const formulaDialog = page.getByRole('dialog', { name: '查看公式' });
  await formulaDialog.waitFor({ timeout: 30_000 });
  const shieldFormulaText = await formulaDialog.innerText();
  requireText(shieldFormulaText, [
    'lifeline_shield_resource_ratio',
    '法力值（mana）',
    '最终值',
    '救主灵刃护盾资源系数 × 施法者.法力值.最终值'
  ], '护盾公式详情');
  await page.screenshot({ path: path.join(screenshotDir, '最大法力护盾公式.png'), fullPage: true });
  await closeDialog(formulaDialog);

  const thresholdFormulaRow = parameterShell.locator('tr', { hasText: 'lifeline_health_threshold_value' }).first();
  await thresholdFormulaRow.getByRole('button', { name: '查看', exact: true }).click();
  const thresholdDialog = page.getByRole('dialog', { name: '查看公式' });
  await thresholdDialog.waitFor({ timeout: 30_000 });
  await waitInputValue(
    page,
    thresholdDialog.getByLabel('稳定标识', { exact: true }),
    'lifeline_health_threshold_value',
    '生命阈值公式'
  );
  const thresholdFormulaText = await thresholdDialog.innerText();
  requireText(thresholdFormulaText, [
    'lifeline_health_threshold_ratio',
    '生命值（hp）',
    '最终值',
    '救主灵刃生命值阈值 × 施法者.生命值.最终值'
  ], '生命阈值公式详情');
  await closeDialog(thresholdDialog);
  await closeDialog(parameterShell);
  checks.push({
    area: '参数与公式',
    passed: true,
    fixedParameterCount: 5,
    runtimeParameterCount: 0,
    formulaCount: 3,
    shieldFormulaObserved: true,
    thresholdFormulaObserved: true
  });

  await row.getByRole('button', { name: '效果与结果', exact: true }).click();
  const effectShell = page.getByRole('dialog', { name: `效果与结果 - ${skillName}` });
  await effectShell.waitFor({ timeout: 30_000 });
  const effectRow = effectShell.locator('tr', { hasText: 'lifeline_shield' }).first();
  await effectRow.waitFor({ timeout: 30_000 });
  const effectRowText = await effectRow.innerText();
  requireText(effectRowText, ['lifeline_shield', '有生命周期'], '效果列表');
  const effectImageCount = await effectRow.locator('img').count();
  const effectImageStatus = effectImageCount > 0 ? '已设置' : '未设置';
  await effectRow.getByRole('button', { name: '查看', exact: true }).click();
  const effectDialog = page.getByRole('dialog', { name: '查看效果' });
  await effectDialog.waitFor({ timeout: 30_000 });
  await waitInputValue(
    page,
    effectDialog.getByLabel('效果标识', { exact: true }),
    'lifeline_shield',
    '救主灵刃效果'
  );
  const effectText = await effectDialog.innerText();
  requireText(effectText, [
    'lifeline_shield_duration_ms',
    '普通护盾',
    '施法者',
    '持续生效',
    '施加时留存',
    '整个实例共享数值',
    '救主灵刃护盾值',
    '全部伤害 / 不衰减'
  ], '效果详情');
  await page.screenshot({ path: path.join(screenshotDir, '三秒普通护盾结果.png'), fullPage: true });
  await closeDialog(effectDialog);
  await closeDialog(effectShell);
  checks.push({
    area: '效果与结果',
    passed: true,
    effectKey: 'lifeline_shield',
    resultType: 'NORMAL_SHIELD',
    effectRepresentativeImage: effectImageStatus,
    knownUsabilityIssue: effectImageStatus === '未设置'
      ? '效果子表有图片列，但该效果没有代表图片，页面显示未设置。'
      : null
  });

  await row.getByRole('button', { name: '条件与触发', exact: true }).click();
  const triggerShell = page.getByRole('dialog', { name: `条件与触发 - ${skillName}` });
  await triggerShell.waitFor({ timeout: 30_000 });
  const triggerRow = triggerShell.locator('tr', { hasText: 'on_damage_cross_below_lifeline_threshold' }).first();
  await triggerRow.waitFor({ timeout: 30_000 });
  requireText(await triggerRow.innerText(), ['即将受到伤害', '1', '已配置'], '触发规则列表');
  await triggerRow.getByRole('button', { name: '编辑', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: '编辑规则' });
  await editDialog.waitFor({ timeout: 30_000 });
  await waitInputValue(
    page,
    editDialog.getByLabel('规则标识', { exact: true }),
    'on_damage_cross_below_lifeline_threshold',
    '救主灵刃触发规则'
  );
  const triggerText = await editDialog.innerText();
  requireText(triggerText, [
    '即将受到伤害',
    '事件值比较 / 受伤前生命 / 大于等于 / lifeline_health_threshold_value',
    '并且',
    '事件值比较 / 预计受伤后生命 / 小于 / lifeline_health_threshold_value',
    '执行效果 / 当前目标 / lifeline_shield / 绑定 0 / 修正 0',
    '救主灵刃冷却（lifeline_cooldown_ms）',
    '目标对象',
    '当前目标'
  ], '触发规则详情');
  await page.screenshot({ path: path.join(screenshotDir, '伤前双条件与冷却.png'), fullPage: true });
  await editDialog.getByRole('button', { name: '取消', exact: true }).click();
  await editDialog.waitFor({ state: 'hidden' });
  await closeDialog(triggerShell);
  checks.push({
    area: '条件与触发',
    passed: true,
    eventType: 'DAMAGE_PENDING',
    conditionSummary: 'HEALTH_BEFORE GTE 阈值，并且 PROJECTED_HEALTH_AFTER LT 阈值',
    actionTarget: 'CURRENT_TARGET',
    runtimeInputBindings: 0,
    cooldown: 'lifeline_cooldown_ms / CURRENT_TARGET'
  });

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
    complementaryAcceptance: 'Codex 内置浏览器也已实际查看同一技能、公式、效果和触发规则。',
    methodPolicy: 'BROWSER_READ_ONLY',
    authorizationValueRecorded: false,
    cacheSyncIsLocalOnly: true,
    methods,
    businessWrites,
    checks,
    screenshots: fs.readdirSync(screenshotDir).sort(),
    diagnostics,
    runtimeValidation: '未执行战斗运行；本报告证明管理页面展示与只读交互。',
    scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({
    passed: true,
    checks: checks.length,
    methods,
    businessWrites,
    screenshots: report.screenshots,
    usabilityIssue: checks.find((check) => check.area === '效果与结果')?.knownUsabilityIssue ?? null
  }));
} finally {
  await browser.close();
}
