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
const subjects = [
  {
    skillKey: 'item_4629_passive',
    skillName: '星界驱驰·咒舞',
    parameterKeys: ['move_speed_bonus', 'move_speed_duration_ms'],
    effectKey: 'spelldance_move_speed',
    effectTexts: ['move_speed_duration_ms', 'move_speed', '施法者', '持续生效'],
    resultKey: 'move_speed',
    resultTexts: ['move_speed_bonus', '移动速度', '固定加算', '施法者'],
    rules: [
      {
        ruleKey: 'on_magic_damage_dealt_to_champion',
        eventLabel: '来源对象造成伤害',
        damageLabel: '魔法伤害',
        groupName: '伤害承受对象为英雄',
        actionSummary: '执行效果 / 当前目标 / spelldance_move_speed / 绑定 0 / 修正 0',
        directionHelp: '造成伤害事件读取本次伤害承受对象；匹配所选任一类别。'
      },
      {
        ruleKey: 'on_real_damage_dealt_to_champion',
        eventLabel: '来源对象造成伤害',
        damageLabel: '真实伤害',
        groupName: '伤害承受对象为英雄',
        actionSummary: '执行效果 / 当前目标 / spelldance_move_speed / 绑定 0 / 修正 0',
        directionHelp: '造成伤害事件读取本次伤害承受对象；匹配所选任一类别。'
      }
    ]
  },
  {
    skillKey: 'item_3803_passive',
    skillName: '万世催化石·永恒',
    parameterKeys: ['damage_input', 'mana_restore_ratio_from_damage'],
    formulaKey: 'mana_restore_from_damage',
    formulaTexts: ['damage_input', 'mana_restore_ratio_from_damage'],
    effectKey: 'mana_from_hero_damage',
    effectTexts: ['mana', '施法者', '恢复'],
    resultKey: 'mana_restore',
    resultTexts: ['mana_restore_from_damage', '法力值', '恢复', '施法者'],
    rules: [
      {
        ruleKey: 'on_damage_taken_from_champion_restore_mana',
        eventLabel: '来源对象受到伤害',
        damageLabel: '任意伤害类型',
        groupName: '伤害来源对象为英雄',
        actionSummary: '执行效果 / 当前目标 / mana_from_hero_damage / 绑定 1 / 修正 0',
        directionHelp: '受到伤害事件读取本次伤害来源对象；匹配所选任一类别。'
      }
    ]
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
  const image = row.locator('img').first();
  await image.waitFor({ timeout: 30_000 });
  await page.waitForFunction((node) => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0, await image.elementHandle());
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

async function inspectParametersAndFormula(page, subject, row) {
  await row.getByRole('button', { name: '参数与公式', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `参数与公式 - ${subject.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  await shell.locator('tr', { hasText: subject.parameterKeys[0] }).first().waitFor({ timeout: 30_000 });
  const parameterText = await shell.innerText();
  requireText(parameterText, subject.parameterKeys, `${subject.skillKey} 参数列表`);
  if (subject.skillKey === 'item_4629_passive') requireText(parameterText, ['20', '4000'], '星界驱驰参数列表');
  if (subject.skillKey === 'item_3803_passive') requireText(parameterText, ['运行时输入', '0.1'], '万世催化石参数列表');

  let formulaObserved = false;
  if (subject.formulaKey) {
    await shell.getByRole('tab', { name: '技能公式', exact: true }).click();
    const rowWithFormula = shell.locator('tr', { hasText: subject.formulaKey }).first();
    await rowWithFormula.waitFor({ timeout: 30_000 });
    await rowWithFormula.getByRole('button', { name: '查看', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '查看公式' });
    await dialog.waitFor({ timeout: 30_000 });
    await waitInputValue(page, dialog.getByLabel('稳定标识', { exact: true }), subject.formulaKey, `${subject.skillKey} 公式`);
    const formulaText = await dialog.innerText();
    requireText(formulaText, subject.formulaTexts, `${subject.skillKey} 公式详情`);
    await page.screenshot({ path: path.join(screenshotDir, `${subject.skillKey}-公式详情.png`), fullPage: true });
    await closeDialog(dialog);
    formulaObserved = true;
  }
  await closeDialog(shell);
  return { parameterKeys: subject.parameterKeys, formulaObserved };
}

async function inspectEffect(page, subject, row) {
  await row.getByRole('button', { name: '效果与结果', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `效果与结果 - ${subject.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  const effectRow = shell.locator('tr', { hasText: subject.effectKey }).first();
  await effectRow.waitFor({ timeout: 30_000 });
  await effectRow.getByRole('button', { name: '查看', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '查看效果' });
  await dialog.waitFor({ timeout: 30_000 });
  await waitInputValue(page, dialog.getByLabel('效果标识', { exact: true }), subject.effectKey, `${subject.skillKey} 效果`);
  const effectText = await dialog.innerText();
  requireText(effectText, subject.effectTexts, `${subject.skillKey} 效果详情`);
  const resultRow = dialog.locator('tr', { hasText: subject.resultKey }).first();
  await resultRow.waitFor({ timeout: 30_000 });
  await resultRow.getByRole('button', { name: '查看', exact: true }).click();
  const resultDialog = page.getByRole('dialog', { name: '查看结果' });
  await resultDialog.waitFor({ timeout: 30_000 });
  await resultDialog.getByText('目录不完整，无法保存未知引用。', { exact: true })
    .waitFor({ state: 'hidden', timeout: 30_000 });
  const resultText = await resultDialog.innerText();
  requireText(resultText, subject.resultTexts, `${subject.skillKey} 结果详情`);
  await page.screenshot({ path: path.join(screenshotDir, `${subject.skillKey}-结果详情.png`), fullPage: true });
  await closeDialog(resultDialog);
  await page.screenshot({ path: path.join(screenshotDir, `${subject.skillKey}-效果详情.png`), fullPage: true });
  await closeDialog(dialog);
  await closeDialog(shell);
  return { effectKey: subject.effectKey, resultKey: subject.resultKey, detailObserved: true, resultDetailObserved: true };
}

async function inspectTriggers(page, subject, row) {
  await row.getByRole('button', { name: '条件与触发', exact: true }).click();
  const shell = page.getByRole('dialog', { name: `条件与触发 - ${subject.skillName}` });
  await shell.waitFor({ timeout: 30_000 });
  const observations = [];
  for (const rule of subject.rules) {
    const ruleRow = shell.locator('tr', { hasText: rule.ruleKey }).first();
    await ruleRow.waitFor({ timeout: 30_000 });
    const rowText = await ruleRow.innerText();
    requireText(rowText, [rule.ruleKey, rule.eventLabel, '1'], `${rule.ruleKey} 规则行`);
    await ruleRow.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑规则' });
    await editor.waitFor({ timeout: 30_000 });
    await waitInputValue(page, editor.getByLabel('规则标识', { exact: true }), rule.ruleKey, `${rule.ruleKey} 规则`);
    const editorText = await editor.innerText();
    requireText(editorText, [
      rule.eventLabel,
      rule.damageLabel,
      rule.groupName,
      '事件对方类别 / 英雄',
      rule.actionSummary
    ], `${rule.ruleKey} 规则详情`);
    const groupCard = editor.locator('.arco-card').filter({ hasText: '事件对方类别 / 英雄' }).first();
    await groupCard.getByRole('button', { name: '编辑', exact: true }).click();
    const condition = page.getByRole('dialog', { name: '编辑条件' });
    await condition.waitFor({ timeout: 30_000 });
    const conditionText = await condition.innerText();
    requireText(conditionText, ['事件对方类别', '英雄', rule.directionHelp], `${rule.ruleKey} 类别条件`);
    assert.equal(await condition.locator('input[type="checkbox"]:checked').count(), 1, `${rule.ruleKey} 应仅勾选英雄类别`);
    await page.screenshot({ path: path.join(screenshotDir, `${rule.ruleKey}-事件对方类别.png`), fullPage: true });
    await condition.getByRole('button', { name: '取消', exact: true }).click();
    await condition.waitFor({ state: 'hidden' });
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    observations.push({
      ruleKey: rule.ruleKey,
      eventLabel: rule.eventLabel,
      damageLabel: rule.damageLabel,
      counterpartCategory: '英雄',
      directionHelp: rule.directionHelp,
      actionSummary: rule.actionSummary,
      cooldownShownInList: rowText.includes('—')
    });
  }
  await closeDialog(shell);
  return observations;
}

fs.mkdirSync(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const methods = {};
const diagnostics = {
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  errorResponses: [],
  expectedCancelledImageReads: []
};
page.on('console', message => {
  if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
});
page.on('pageerror', error => diagnostics.pageErrors.push(String(error)));
page.on('request', request => { methods[request.method()] = (methods[request.method()] ?? 0) + 1; });
page.on('requestfailed', request => {
  const failure = { method: request.method(), url: request.url(), error: request.failure()?.errorText ?? null };
  if (failure.method === 'GET' && failure.error === 'net::ERR_ABORTED'
    && failure.url.endsWith('/representative-image')) diagnostics.expectedCancelledImageReads.push(failure);
  else diagnostics.requestFailures.push(failure);
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
    await page.screenshot({ path: path.join(screenshotDir, `${subject.skillKey}-技能列表图片.png`), fullPage: true });
    const parameters = await inspectParametersAndFormula(page, subject, row);
    const effect = await inspectEffect(page, subject, row);
    const rules = await inspectTriggers(page, subject, row);
    checks.push({
      area: subject.skillKey,
      passed: true,
      representativeImage: imageState,
      parameters,
      effect,
      rules
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
    visibleCodexBrowserControl: '更新后缺少 Codex 浏览器授权令牌，改由同机真实 Chromium 完成验收。',
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
  console.log(JSON.stringify({
    passed: true,
    checks: checks.length,
    methods,
    businessWrites,
    screenshots: report.screenshots,
    diagnostics
  }));
} finally {
  await browser.close();
}
