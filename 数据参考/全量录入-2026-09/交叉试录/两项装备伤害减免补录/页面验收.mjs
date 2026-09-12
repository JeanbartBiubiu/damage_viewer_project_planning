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

const subjects = [
  {
    skillKey: 'item_3047_passive',
    skillName: '铁板靴·镀板',
    effectKey: 'plating_basic_damage_reduction',
    resultKey: 'incoming_basic_damage_reduction',
    ruleKey: 'initialize_plating_basic_damage_reduction',
    actionName: '执行镀板伤害减免',
    parameterName: '镀板攻击伤害降低比例',
    parameterKey: 'incoming_attack_damage_reduction',
    zoneName: '铁板靴基础攻击伤害减免',
    zoneKey: 'item_3047_basic_damage_reduction',
    deliveryKind: 'BASIC_ATTACK',
    criticalFilter: 'ANY',
    resultText: ['受到的伤害', '降低', '全部伤害', '普通攻击']
  },
  {
    skillKey: 'item_3143_passive',
    skillName: '兰顿之兆·复原力',
    effectKey: 'resilience_critical_damage_reduction',
    resultKey: 'incoming_critical_damage_reduction',
    ruleKey: 'initialize_resilience_critical_damage_reduction',
    actionName: '执行复原力伤害减免',
    parameterName: '受到暴击伤害削减比例',
    parameterKey: 'critical_damage_reduction_ratio',
    zoneName: '兰顿暴击伤害减免',
    zoneKey: 'item_3143_critical_damage_reduction',
    deliveryKind: 'ANY',
    criticalFilter: 'CRITICAL_ONLY',
    resultText: ['受到的伤害', '降低', '全部伤害', '仅暴击']
  }
];

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

async function waitReadyAndRefresh(page, readyCell) {
  await page.locator('.app-toolbar').getByText('就绪', { exact: true }).waitFor({ timeout: 30_000 });
  const refresh = page.locator('.app-main').getByRole('button', { name: '刷新', exact: true }).first();
  await refresh.click();
  await page.getByRole('cell', { name: readyCell, exact: true }).first().waitFor({ timeout: 30_000 });
}

async function openSkills(page) {
  await page.goto(`${baseUrl}/#/skills`, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-toolbar').getByText('就绪', { exact: true }).waitFor({ timeout: 30_000 });
  const main = page.locator('.app-main');
  await main.getByRole('button', { name: '重置', exact: true }).first().click();
  await main.getByRole('button', { name: '刷新', exact: true }).first().click();
  await page.getByRole('cell', { name: 'aatrox_p', exact: true }).first().waitFor({ timeout: 30_000 });
}

async function selectOneSkill(page, subject) {
  await page.getByLabel('技能关键词', { exact: true }).fill(subject.skillKey);
  await page.locator('.app-main').getByRole('button', { name: '查询', exact: true }).click();
  const row = page.locator('tr', { hasText: subject.skillKey }).first();
  await row.waitFor({ timeout: 30_000 });
  assert((await row.locator('td').count()) > 0, `${subject.skillKey} 没有列表行`);
  const image = row.locator('img').first();
  await image.waitFor({ timeout: 30_000 });
  const imageState = await image.evaluate((node) => ({
    alt: node.getAttribute('alt'),
    complete: node.complete,
    naturalWidth: node.naturalWidth,
    naturalHeight: node.naturalHeight
  }));
  assert.equal(imageState.alt, `${subject.skillName}代表图片`);
  assert(imageState.complete && imageState.naturalWidth > 0 && imageState.naturalHeight > 0,
    `${subject.skillKey} 左侧代表图片未完成加载`);
  return { row, imageState };
}

async function inspectEffect(page, subject, row) {
  await row.getByRole('button', { name: '效果与结果', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `效果与结果 - ${subject.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  const effectRow = shell.locator('tr', { hasText: subject.effectKey }).first();
  await effectRow.waitFor({ timeout: 30_000 });
  requireText(await effectRow.innerText(), [subject.effectKey, '有生命周期'], `${subject.skillKey} 效果行`);
  await effectRow.getByRole('button', { name: '查看', exact: true }).click();

  const effectDialog = page.getByRole('dialog', { name: '查看效果' });
  await effectDialog.waitFor({ timeout: 30_000 });
  const resultRow = effectDialog.locator('tr', { hasText: subject.resultKey }).first();
  await resultRow.waitFor({ timeout: 30_000 });
  requireText(await resultRow.innerText(), [subject.resultKey, ...subject.resultText], `${subject.skillKey} 结果摘要`);
  const effectText = await effectDialog.innerText();
  requireText(effectText, ['生命周期', '持续生效', subject.resultKey], `${subject.skillKey} 效果详情`);
  await resultRow.getByRole('button', { name: '查看', exact: true }).click();

  const resultDialog = page.getByRole('dialog', { name: '查看结果' });
  await resultDialog.waitFor({ timeout: 30_000 });
  await resultDialog.getByText('目录不完整，无法保存未知引用。', { exact: true })
    .waitFor({ state: 'hidden', timeout: 30_000 });
  const resultText = await resultDialog.innerText();
  requireText(resultText, [
    subject.parameterName,
    subject.parameterKey,
    subject.zoneName,
    '伤害修正',
    '施法者',
    '受到的伤害',
    '降低',
    '持续生效',
    '施加时留存',
    '整个实例共享数值',
    '覆盖',
    ...subject.resultText.slice(2)
  ], `${subject.skillKey} 结果详情`);
  const checkedValue = async (label) => resultDialog.getByLabel(label, { exact: true })
    .locator('input:checked').getAttribute('value');
  assert.equal(await checkedValue('作用对象'), 'SOURCE');
  assert.equal(await checkedValue('伤害修正作用方向'), 'TAKEN');
  assert.equal(await checkedValue('伤害修正方式'), 'DECREASE');
  assert.equal(await checkedValue('伤害过滤产生方式'), subject.deliveryKind);
  assert.equal(await checkedValue('伤害过滤来源性质'), 'ANY');
  assert.equal(await checkedValue('暴击过滤'), subject.criticalFilter);
  await page.screenshot({
    path: path.join(screenshotDir, `${subject.skillKey}-结果详情.png`),
    fullPage: true
  });
  await closeDialog(resultDialog);
  await closeDialog(effectDialog);
  await closeDialog(shell);
  return { effectText, resultText };
}

async function inspectTrigger(page, subject, row) {
  await row.getByRole('button', { name: '条件与触发', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `条件与触发 - ${subject.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  const ruleRow = shell.locator('tr', { hasText: subject.ruleKey }).first();
  await ruleRow.waitFor({ timeout: 30_000 });
  requireText(await ruleRow.innerText(), [subject.ruleKey, '来源对象初始化完成', '1'], `${subject.skillKey} 规则行`);
  await ruleRow.getByRole('button', { name: '编辑', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: '编辑规则' });
  await editDialog.waitFor({ timeout: 30_000 });
  await waitInputValue(
    page,
    editDialog.getByLabel('规则标识', { exact: true }),
    subject.ruleKey,
    `${subject.skillKey} 规则`
  );
  const triggerText = await editDialog.innerText();
  requireText(triggerText, [
    '来源对象初始化完成',
    subject.actionName,
    '执行效果',
    '事件来源对象',
    subject.effectKey
  ], `${subject.skillKey} 触发详情`);
  await page.screenshot({
    path: path.join(screenshotDir, `${subject.skillKey}-触发详情.png`),
    fullPage: true
  });
  await editDialog.getByRole('button', { name: '取消', exact: true }).click();
  await editDialog.waitFor({ state: 'hidden' });
  await closeDialog(shell);
  return triggerText;
}

fs.mkdirSync(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const diagnostics = {
  consoleErrors: [], pageErrors: [], requestFailures: [], errorResponses: [], expectedCancelledImageReads: []
};
const methods = {};

page.on('console', (message) => {
  if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
});
page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error)));
page.on('requestfailed', (request) => {
  const failure = {
    method: request.method(), url: request.url(), error: request.failure()?.errorText ?? null
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
    status: response.status(), url: response.url()
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

  await page.goto(`${baseUrl}/#/modifier-zones`, { waitUntil: 'domcontentloaded' });
  await waitReadyAndRefresh(page, subjects[0].zoneKey);
  const totalText = await page.locator('.app-main').innerText();
  requireText(totalText, ['共 6 条乘区', subjects[0].zoneKey, subjects[1].zoneKey], '乘区列表');
  for (const subject of subjects) {
    const row = page.locator('tr', { hasText: subject.zoneKey }).first();
    const rowText = await row.innerText();
    requireText(rowText, [subject.zoneName, subject.zoneKey, '伤害', '比例加算', '防御计算前伤害', '启用'], `${subject.zoneKey} 列表行`);
    await row.getByRole('button', { name: '查看', exact: true }).click();
    const view = page.getByRole('dialog', { name: '查看乘区' });
    await view.waitFor({ timeout: 30_000 });
    assert.equal(await view.getByLabel('乘区标识', { exact: true }).inputValue(), subject.zoneKey);
    assert.equal(await view.getByLabel('乘区名称', { exact: true }).inputValue(), subject.zoneName);
    requireText(await view.getByLabel('乘区作用域', { exact: true }).innerText(), ['伤害'], `${subject.zoneKey} 作用域`);
    requireText(await view.getByLabel('乘区计算方式', { exact: true }).innerText(), ['比例加算'], `${subject.zoneKey} 计算方式`);
    requireText(await view.getByLabel('乘区应用阶段', { exact: true }).innerText(), ['防御计算前伤害'], `${subject.zoneKey} 应用阶段`);
    requireText(await view.innerText(), ['状态：启用'], `${subject.zoneKey} 详情`);
    await closeDialog(view);
  }
  await page.screenshot({ path: path.join(screenshotDir, '乘区列表.png'), fullPage: true });
  checks.push({ area: '伤害修正乘区', passed: true, total: 6, keys: subjects.map((item) => item.zoneKey) });

  for (const subject of subjects) {
    await openSkills(page);
    const { row, imageState } = await selectOneSkill(page, subject);
    await page.screenshot({
      path: path.join(screenshotDir, `${subject.skillKey}-列表图片.png`),
      fullPage: true
    });
    const effect = await inspectEffect(page, subject, row);
    const triggerText = await inspectTrigger(page, subject, row);
    checks.push({
      area: subject.skillKey,
      passed: true,
      representativeImage: imageState,
      effectKey: subject.effectKey,
      resultKey: subject.resultKey,
      ruleKey: subject.ruleKey,
      effectDetailObserved: effect.effectText.includes(subject.resultKey),
      resultDetailObserved: effect.resultText.includes(subject.parameterKey),
      triggerDetailObserved: triggerText.includes(subject.actionName)
    });
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
    runtimeValidation: '未执行战斗运行；本报告证明管理页面展示与只读交互。',
    scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ passed: true, checks: checks.length, methods, businessWrites, screenshots: report.screenshots }));
} finally {
  await browser.close();
}
