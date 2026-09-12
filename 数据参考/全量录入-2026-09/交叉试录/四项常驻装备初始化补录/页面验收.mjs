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

const subjects = [
  {
    skillKey: 'item_2422_passive',
    skillName: '有点神奇之鞋·额外移速',
    effectKey: 'magical_footwear_additional_speed',
    resultKey: 'attribute_bonus',
    ruleKey: 'initialize_magical_footwear_additional_speed',
    actionName: '执行有点神奇之鞋额外移速',
    detailTexts: ['additional_move_speed', '移动速度', '固定加算', '施法者', '持续生效']
  },
  {
    skillKey: 'item_3742_passive',
    skillName: '亡者的板甲·沉船者',
    effectKey: 'unsinkable_slow_resist',
    resultKey: 'slow_resist',
    ruleKey: 'initialize_unsinkable_slow_resist',
    actionName: '执行不沉减速抗性',
    detailTexts: ['slow_resist_ratio', '减速抗性比例', '固定加算', '施法者', '持续生效']
  },
  {
    skillKey: 'item_3042_passive',
    skillName: '魔切·敬畏与冲击',
    effectKey: 'bonus_attack_damage_from_max_mana',
    resultKey: 'bonus_attack_damage',
    ruleKey: 'initialize_bonus_attack_damage_from_max_mana',
    actionName: '执行敬畏额外攻击力',
    detailTexts: ['bonus_attack_damage_from_max_mana', '攻击力', '固定加算', '施法者', '持续生效', '到当前时点重新读取']
  },
  {
    skillKey: 'item_3040_passive',
    skillName: '炽天使之拥·敬畏与救主灵刃',
    effectKey: 'ap_from_bonus_mana',
    resultKey: 'ap_from_bonus_mana',
    ruleKey: 'initialize_ap_from_bonus_mana',
    actionName: '执行敬畏法术强度',
    detailTexts: ['ap_from_bonus_mana', '法术强度', '固定加算', '施法者', '持续生效', '到当前时点重新读取'],
    parameterKey: 'ap_from_bonus_mana_ratio',
    formulaKey: 'ap_from_bonus_mana'
  }
];

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

async function openSkill(page, subject) {
  await page.goto(`${baseUrl}/#/skills`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const main = page.locator('.app-main');
  await main.getByRole('button', { name: '重置', exact: true }).first().click();
  await page.getByLabel('技能关键词', { exact: true }).fill(subject.skillKey);
  await main.getByRole('button', { name: '查询', exact: true }).click();
  const row = page.locator('tr', { hasText: subject.skillKey }).first();
  await row.waitFor({ timeout: 30_000 });
  requireText(await row.innerText(), [subject.skillName, subject.skillKey, '被动技能', '启用'], `${subject.skillKey} 列表行`);
  const image = row.locator('img').first();
  await image.waitFor({ timeout: 30_000 });
  await page.waitForFunction(node => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0, await image.elementHandle());
  const imageState = await image.evaluate(node => ({
    alt: node.getAttribute('alt'),
    complete: node.complete,
    naturalWidth: node.naturalWidth,
    naturalHeight: node.naturalHeight
  }));
  assert.equal(imageState.alt, `${subject.skillName}代表图片`);
  assert.deepEqual([imageState.complete, imageState.naturalWidth, imageState.naturalHeight], [true, 64, 64]);
  return { row, imageState };
}

async function inspectSeraphFormula(page, subject, row) {
  if (!subject.formulaKey) return null;
  await row.getByRole('button', { name: '参数与公式', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `参数与公式 - ${subject.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  await shell.locator('tr', { hasText: subject.parameterKey }).first().waitFor({ timeout: 30_000 });
  const parameterText = await shell.innerText();
  requireText(parameterText, [subject.parameterKey, '0.02'], '炽天使敬畏参数');
  assert(!parameterText.includes('bonus_ap_from_max_mana_ratio'), '炽天使旧错误参数仍在页面');
  await shell.getByRole('tab', { name: '技能公式', exact: true }).click();
  const formulaKeyCell = shell.getByText(subject.formulaKey, { exact: true }).last();
  await formulaKeyCell.waitFor({ timeout: 30_000 });
  const formulaRow = formulaKeyCell.locator('xpath=ancestor::tr');
  assert(!((await shell.innerText()).includes('bonus_ap_from_max_mana')), '炽天使旧错误公式仍在页面');
  await formulaRow.getByRole('button', { name: '查看', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '查看公式' });
  await dialog.waitFor({ timeout: 30_000 });
  await waitInputValue(page, dialog.getByLabel('稳定标识', { exact: true }), subject.formulaKey, '炽天使敬畏公式');
  const text = await dialog.innerText();
  requireText(text, ['法力值', '施法者', '加成值', 'ap_from_bonus_mana_ratio', '乘'], '炽天使敬畏公式详情');
  assert(!text.includes('最终值'), '炽天使敬畏公式不应读取总法力值');
  await page.screenshot({ path: path.join(screenshotDir, 'item_3040_passive-额外法力公式.png'), fullPage: true });
  await closeDialog(dialog);
  await closeDialog(shell);
  return { parameterKey: subject.parameterKey, formulaKey: subject.formulaKey, bonusManaVisible: true, oldKeysAbsent: true };
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
  requireText(await resultRow.innerText(), [subject.resultKey, '属性变化', '施法者', '持续生效'], `${subject.skillKey} 结果摘要`);
  await resultRow.getByRole('button', { name: '查看', exact: true }).click();
  const resultDialog = page.getByRole('dialog', { name: '查看结果' });
  await resultDialog.waitFor({ timeout: 30_000 });
  await resultDialog.getByText('目录不完整，无法保存未知引用。', { exact: true })
    .waitFor({ state: 'hidden', timeout: 30_000 });
  const resultText = await resultDialog.innerText();
  requireText(resultText, subject.detailTexts, `${subject.skillKey} 结果详情`);
  await page.screenshot({ path: path.join(screenshotDir, `${subject.skillKey}-结果详情.png`), fullPage: true });
  await closeDialog(resultDialog);
  await closeDialog(effectDialog);
  await closeDialog(shell);
  return { effectKey: subject.effectKey, resultKey: subject.resultKey, detailObserved: true };
}

async function inspectTrigger(page, subject, row) {
  await row.getByRole('button', { name: '条件与触发', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `条件与触发 - ${subject.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  const ruleRow = shell.locator('tr', { hasText: subject.ruleKey }).first();
  await ruleRow.waitFor({ timeout: 30_000 });
  requireText(await ruleRow.innerText(), [subject.ruleKey, '来源对象初始化完成', '1'], `${subject.skillKey} 规则行`);
  await ruleRow.getByRole('button', { name: '编辑', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑规则' });
  await dialog.waitFor({ timeout: 30_000 });
  await waitInputValue(page, dialog.getByLabel('规则标识', { exact: true }), subject.ruleKey, `${subject.skillKey} 规则`);
  const text = await dialog.innerText();
  requireText(text, ['来源对象初始化完成', subject.actionName, '执行效果', '事件来源对象', subject.effectKey], `${subject.skillKey} 规则详情`);
  await page.screenshot({ path: path.join(screenshotDir, `${subject.skillKey}-初始化规则.png`), fullPage: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await closeDialog(shell);
  return { ruleKey: subject.ruleKey, eventLabel: '来源对象初始化完成', actionName: subject.actionName };
}

fs.mkdirSync(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const methods = {};
const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [], errorResponses: [], expectedCancelledImageReads: [] };
page.on('console', message => { if (message.type() === 'error') diagnostics.consoleErrors.push(message.text()); });
page.on('pageerror', error => diagnostics.pageErrors.push(String(error)));
page.on('request', request => { methods[request.method()] = (methods[request.method()] ?? 0) + 1; });
page.on('requestfailed', request => {
  const failure = { method: request.method(), url: request.url(), error: request.failure()?.errorText ?? null };
  if (failure.method === 'GET' && failure.error === 'net::ERR_ABORTED' && failure.url.endsWith('/representative-image')) {
    diagnostics.expectedCancelledImageReads.push(failure);
  } else diagnostics.requestFailures.push(failure);
});
page.on('response', response => {
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

  for (const subject of subjects) {
    const { row, imageState } = await openSkill(page, subject);
    await page.screenshot({ path: path.join(screenshotDir, `${subject.skillKey}-列表图片.png`), fullPage: true });
    const formula = await inspectSeraphFormula(page, subject, row);
    const effect = await inspectEffect(page, subject, row);
    const trigger = await inspectTrigger(page, subject, row);
    checks.push({ area: subject.skillKey, passed: true, representativeImage: imageState, formula, effect, trigger });
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
    visibleCodexBrowserControl: '更新后仍缺少 Codex 浏览器授权令牌，改由同机真实 Chromium 完成验收。',
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
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: true, checks: checks.length, methods, businessWrites, screenshots: report.screenshots }));
} finally {
  await browser.close();
}
