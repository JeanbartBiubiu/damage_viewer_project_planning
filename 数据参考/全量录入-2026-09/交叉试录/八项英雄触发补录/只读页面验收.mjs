import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';
import { targetConfigs } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(here, '页面截图');
const reportPath = path.join(here, '10-页面验收.json');
const baseUrl = 'http://127.0.0.1:5173';
if (fs.existsSync(reportPath)) throw new Error('页面报告已存在，拒绝覆盖。');

const targetCatalog = [
  {
    id: 'kaisa', skillKey: 'kaisa_r', skillName: '卡莎·猎手本能',
    formulaKey: 'shield_value', formulaRowTexts: ['猎手本能自身护盾值', 'shield_value'],
    formulaTexts: ['攻击力', '施法者', '最终值', 'shield_base_value', 'total_attack_damage_ratio', 'ability_power_ratio', '乘', '加'],
    effectKey: 'self_shield', resultKey: 'shield', effectRowTexts: ['猎手本能自身护盾', 'self_shield'], effectTexts: ['shield_duration_ms'],
    resultRowTexts: ['自身护盾', 'shield', '普通护盾', '施法者'],
    resultTexts: ['普通护盾', '施法者', 'shield_value', '全部伤害', '不衰减'],
    ruleKey: 'on_used', actionCount: 1,
    triggerTexts: ['技能被主动或消耗使用', 'kaisa_r', '主动', '执行效果', '当前目标', 'self_shield']
  },
  {
    id: 'annie', skillKey: 'annie_e', skillName: '安妮·熔岩护盾',
    formulaKey: 'shield', formulaRowTexts: ['熔岩自护盾', 'shield'],
    formulaTexts: ['法术强度', '施法者', '最终值', 'base_shield', 'shield_ap_ratio', '乘', '加'],
    effectKey: 'molten_shield', resultKey: 'shield', effectRowTexts: ['熔岩自护盾', 'molten_shield'], effectTexts: ['shield_duration_ms'],
    resultRowTexts: ['普通护盾', 'shield', '普通护盾', '施法者'],
    resultTexts: ['普通护盾', '施法者', 'shield', '全部伤害', '不衰减'],
    ruleKey: 'on_used', actionCount: 1,
    triggerTexts: ['技能被主动或消耗使用', 'annie_e', '主动', '执行效果', '当前目标', 'molten_shield']
  },
  {
    id: 'garen', skillKey: 'garen_w', skillName: '盖伦·勇气',
    formulaKey: 'shield', formulaRowTexts: ['W 护盾量', 'shield'],
    formulaTexts: ['生命值', '施法者', '加成值', 'base_shield', 'bonus_hp_ratio', '乘', '加'],
    effectKey: 'upfront_shield', resultKey: 'shield', effectRowTexts: ['勇气短时护盾', 'upfront_shield'], effectTexts: ['upfront_duration_ms'],
    resultRowTexts: ['勇气护盾', 'shield', '普通护盾', '施法者'],
    resultTexts: ['普通护盾', '施法者', 'shield', '全部伤害', '不衰减'],
    ruleKey: 'on_used', actionCount: 2,
    triggerTexts: ['技能被主动或消耗使用', 'garen_w', '主动', '执行效果', '当前目标', 'upfront_shield', 'upfront_tenacity']
  },
  {
    id: 'vex', skillKey: 'vex_w', skillName: '薇古丝·生人勿近',
    formulaKey: 'shield_value', formulaRowTexts: ['生人勿近自身护盾值', 'shield_value'],
    formulaTexts: ['法术强度', '施法者', '最终值', 'base_shield', 'shield_ap_ratio', '乘', '加'],
    effectKey: 'self_shield', resultKey: 'shield', effectRowTexts: ['生人勿近自身护盾', 'self_shield'], effectTexts: ['shield_duration_ms'],
    resultRowTexts: ['生人勿近自身护盾', 'shield', '普通护盾', '施法者'],
    resultTexts: ['普通护盾', '施法者', 'shield_value', '全部伤害', '不衰减'],
    ruleKey: 'on_used', actionCount: 1,
    triggerTexts: ['技能被主动或消耗使用', 'vex_w', '主动', '执行效果', '当前目标', 'self_shield']
  },
  {
    id: 'kassadin', skillKey: 'kassadin_q', skillName: '卡萨丁·虚无法球',
    formulaKey: 'magic_shield_amount', formulaRowTexts: ['魔法护盾数值', 'magic_shield_amount'],
    formulaTexts: ['法术强度', '施法者', '最终值', 'base_magic_shield', 'calculation_constant_2', '乘', '加'],
    effectKey: 'magic_shield', resultKey: 'shield', effectRowTexts: ['虚无法球自身魔法护盾', 'magic_shield'], effectTexts: ['shield_duration_ms'],
    resultRowTexts: ['魔法护盾', 'shield', '普通护盾', '施法者'],
    resultTexts: ['普通护盾', '施法者', 'magic_shield_amount', '魔法伤害', '不衰减'],
    ruleKey: 'on_used', actionCount: 1,
    triggerTexts: ['技能被主动或消耗使用', 'kassadin_q', '主动', '执行效果', '当前目标', 'magic_shield']
  },
  {
    id: 'ashe', skillKey: 'ashe_w', skillName: '艾希·万箭齐发',
    formulaKey: 'hit_damage', formulaRowTexts: ['W 一次命中物理伤害', 'hit_damage'],
    formulaTexts: ['攻击力', '施法者', '加成值', 'base_damage', 'bonus_ad_ratio', '乘', '加'],
    effectKey: 'hit_damage', resultKey: 'damage', effectRowTexts: ['W 一次命中物理伤害', 'hit_damage'],
    resultRowTexts: ['一次命中伤害', 'damage', 'physics', '当前目标'],
    resultTexts: ['物理伤害', '技能', '直接伤害', '施法者', '当前目标', 'hit_damage'],
    ruleKey: 'actual_hit', actionCount: 1,
    triggerTexts: ['技能命中', 'ashe_w', '事件对方类别', '英雄', '执行效果', '当前目标', 'hit_damage']
  },
  {
    id: 'ivern', skillKey: 'ivern_q', skillName: '艾翁·根深敌固',
    formulaKey: 'magic_damage', formulaRowTexts: ['根深敌固魔法伤害', 'magic_damage'],
    formulaTexts: ['法术强度', '施法者', '最终值', 'base_damage', 'ap_ratio', '乘', '加'],
    effectKey: 'damage', resultKey: 'damage', effectRowTexts: ['根深敌固魔法伤害', 'damage'],
    resultRowTexts: ['根深敌固魔法伤害', 'damage', 'magic', '当前目标'],
    resultTexts: ['魔法伤害', '技能', '直接伤害', '施法者', '当前目标', 'magic_damage'],
    ruleKey: 'actual_hit', actionCount: 1,
    triggerTexts: ['技能命中', 'ivern_q', '事件对方类别', '英雄', '执行效果', '当前目标', 'damage']
  },
  {
    id: 'nocturne', skillKey: 'nocturne_r', skillName: '魔腾·鬼影重重',
    formulaKey: 'arrival_damage', formulaRowTexts: ['再次施放实际抵达伤害', 'arrival_damage'],
    formulaTexts: ['攻击力', '施法者', '加成值', 'base_damage', 'bonus_ad_ratio', '乘', '加'],
    effectKey: 'arrival_damage', resultKey: 'damage', effectRowTexts: ['鬼影重重抵达物理伤害', 'arrival_damage'],
    resultRowTexts: ['鬼影重重抵达物理伤害', 'damage', 'physics', '当前目标'],
    resultTexts: ['物理伤害', '技能', '直接伤害', '施法者', '当前目标', 'arrival_damage'],
    ruleKey: 'actual_hit', actionCount: 1,
    triggerTexts: ['技能命中', 'nocturne_r', '事件对方类别', '英雄', '执行效果', '当前目标', 'arrival_damage']
  }
];
const targetIds = new Set(targetConfigs.map((target) => target.id));
const targets = targetCatalog.filter((target) => targetIds.has(target.id));
assert.deepEqual(targets.map((target) => target.id), targetConfigs.map((target) => target.id), '页面目标与冻结写入集合不一致');

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
  if (!target.formulaKey) return null;
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
  const effectText = target.effectTexts
    ? await waitForTexts(page, effectDialog, target.effectTexts, `${target.skillKey} 效果详情`)
    : await effectDialog.innerText();
  const resultCell = effectDialog.getByText(target.resultKey, { exact: true }).last();
  await resultCell.waitFor({ timeout: 30_000 });
  const resultRow = resultCell.locator('xpath=ancestor::tr');
  requireText(await resultRow.innerText(), target.resultRowTexts, `${target.skillKey} 结果行`);
  await resultRow.getByRole('button', { name: '查看', exact: true }).click();
  const resultDialog = page.getByRole('dialog', { name: '查看结果' });
  await resultDialog.waitFor({ timeout: 30_000 });
  const text = await waitForTexts(page, resultDialog, target.resultTexts, `${target.skillKey} 结果详情`);
  await page.screenshot({ path: path.join(screenshotDir, `${target.skillKey}-${target.resultKey}结果.png`), fullPage: true });
  await closeDialog(resultDialog);
  await closeDialog(effectDialog);
  await closeDialog(shell);
  return {
    effectKey: target.effectKey,
    resultKey: target.resultKey,
    effectExpectedTextsVisible: !target.effectTexts || target.effectTexts.every((item) => effectText.includes(item)),
    expectedTextsVisible: target.resultTexts.every((item) => text.includes(item))
  };
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
  if (failure.method === 'GET' && failure.error === 'net::ERR_ABORTED' && failure.url.endsWith('/representative-image')) {
    diagnostics.expectedCancelledImageReads.push(failure);
  } else {
    diagnostics.requestFailures.push(failure);
  }
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
    checks.push({
      area: target.skillKey,
      passed: true,
      representativeImage: opened.imageState,
      formula,
      effect,
      trigger
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
    schemaVersion: 2,
    revision: 'rev4',
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
