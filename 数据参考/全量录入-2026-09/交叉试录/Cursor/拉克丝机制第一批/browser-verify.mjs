import { chromium } from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 第一批 lux_q 浏览器试录脚本。当前 P/W 回读请用 browser-verify-read.mjs。不要重跑本文件来恢复已纠正的 P/W/R。

throw new Error('首次页面试录已完成，本文件仅作历史执行证据，禁止重跑写入。页面只读复核请运行 browser-verify-read.mjs。');

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = 'http://127.0.0.1:5173/#/skills';
const localPlaceholderToken = 'local-entry';
const startedAt = new Date().toISOString();

const evidence = {
  executor: 'Cursor',
  startedAt,
  finishedAt: null,
  browserConnection: {
    catalogBrowserTools: false,
    independentPlaywrightPage: false,
    headless: null,
    stopReason: null
  },
  login: {
    tokenConfiguredVisible: null,
    gameIdVisible: null,
    tokenWarningVisible: null,
    canWrite: false
  },
  writes: [],
  readbacks: [],
  failures: [],
  screenshots: [],
  network: {
    note: '只记录方法、路径和状态码，不记录请求头、Cookie 或令牌。',
    apiCalls: []
  },
  pageErrors: []
};

async function hideTokenField(page) {
  const field = page.locator('.app-toolbar-field--token');
  if (await field.count()) {
    await field.evaluate((el) => {
      el.style.visibility = 'hidden';
    });
  }
}

async function restoreTokenField(page) {
  const field = page.locator('.app-toolbar-field--token');
  if (await field.count()) {
    await field.evaluate((el) => {
      el.style.visibility = '';
    });
  }
}

async function screenshot(page, name) {
  await hideTokenField(page);
  const file = path.join(here, name);
  await page.screenshot({ path: file, fullPage: false });
  evidence.screenshots.push(name);
  await restoreTokenField(page);
}

async function saveEvidence() {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(here, '浏览器验证证据.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

async function readVisibleSession(page) {
  const tokenLine = (await page.locator('.sidebar-status-line').filter({ hasText: /^Token / }).innerText()).trim();
  const gameLine = (await page.locator('.sidebar-status-line').filter({ hasText: /^GameId / }).innerText()).trim();
  const tokenConfiguredVisible = tokenLine.includes('已本地保存');
  const tokenWarningVisible = await page.getByText('请先在顶部配置 Admin Token。', { exact: true }).isVisible().catch(() => false);
  const queryButton = page.getByRole('button', { name: '查询', exact: true });
  const queryAvailable = (await queryButton.count()) > 0 && await queryButton.isEnabled();
  evidence.login.tokenConfiguredVisible = tokenConfiguredVisible;
  evidence.login.gameIdVisible = gameLine;
  evidence.login.tokenWarningVisible = tokenWarningVisible;
  evidence.login.canWrite = tokenConfiguredVisible && !tokenWarningVisible && gameLine.includes('lol') && queryAvailable;
  return evidence.login;
}

async function selectOption(scope, ariaLabel, optionName) {
  await scope.getByLabel(ariaLabel, { exact: true }).click();
  const option = scope.page().getByRole('option', { name: optionName, exact: true });
  await option.waitFor({ state: 'visible', timeout: 10_000 });
  await option.click();
}

async function clickRadio(scope, groupLabel, optionName) {
  const group = scope.getByLabel(groupLabel, { exact: true });
  const visible = group.locator('.arco-radio').filter({ hasText: optionName }).first();
  if (await visible.count()) {
    await visible.click();
    return;
  }
  await scope.locator('.arco-radio').filter({ hasText: optionName }).first().click();
}

async function fillNumber(scope, label, value) {
  const field = scope.getByRole('spinbutton', { name: label, exact: true });
  await field.click();
  await field.fill(String(value));
}

function skillRow(page) {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: 'lux_q', exact: true })
  });
}

async function waitParamsLoaded(paramsModal) {
  await paramsModal.getByRole('button', { name: '新增参数', exact: true }).waitFor({ timeout: 10_000 });
  await paramsModal.locator('.arco-spin').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  await paramsModal.page().waitForTimeout(400);
}

async function closeEditor(dialog) {
  const cancel = dialog.getByRole('button', { name: '取消', exact: true });
  if (await cancel.count()) {
    await cancel.click();
  } else {
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
}

async function fillTokenAndApply(page) {
  const apiInput = page.locator('.app-toolbar-field--api input');
  const currentApi = await apiInput.inputValue();
  if (currentApi.trim() !== 'http://127.0.0.1:8080' && currentApi.trim() !== 'http://localhost:8080') {
    await apiInput.fill('http://127.0.0.1:8080');
  }
  const tokenInput = page.locator('.app-toolbar-field--token input');
  await tokenInput.fill(localPlaceholderToken);
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await page.locator('.sidebar-status-line').filter({ hasText: /^Token 已本地保存$/ }).waitFor({ timeout: 20_000 });
  await page.locator('.sidebar-status-line').filter({ hasText: /^GameId lol$/ }).waitFor({ timeout: 20_000 });
}

async function dialogAlertText(dialog) {
  const alert = dialog.locator('.arco-alert-error');
  if (await alert.isVisible().catch(() => false)) {
    return (await alert.innerText()).trim();
  }
  return null;
}

async function createParameter(page, paramsModal) {
  await waitParamsLoaded(paramsModal);
  if (await paramsModal.getByText('base_damage', { exact: true }).count()) {
    evidence.writes.push({ kind: 'parameter', id: 'base_damage', via: 'browser', action: 'already-present' });
    return;
  }
  await paramsModal.getByRole('button', { name: '新增参数', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增参数' });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  await dialog.getByLabel('稳定标识', { exact: true }).fill('base_damage');
  await dialog.getByLabel('参数名称', { exact: true }).fill('基础魔法伤害');
  await clickRadio(dialog, '数值类型', '整数');
  await clickRadio(dialog, '取值方式', '按技能等级');
  const values = [80, 120, 160, 200, 240];
  for (let i = 0; i < values.length; i += 1) {
    await fillNumber(dialog, `等级${i + 1}数值`, values[i]);
  }
  await dialog.getByLabel('说明', { exact: true }).fill('浏览器试录：客户端 BaseDamage 跳过 rank0 后 80/120/160/200/240。');
  await fillNumber(dialog, '排序', 10);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  const error = await dialogAlertText(dialog);
  if (error && error.includes('已存在')) {
    evidence.writes.push({ kind: 'parameter', id: 'base_damage', via: 'browser', action: 'already-present-409' });
    await closeEditor(dialog);
    return;
  }
  if (error) {
    evidence.failures.push({ object: 'lux_q/base_damage', step: '保存参数', actual: error });
    throw new Error(error);
  }
  await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
  evidence.writes.push({ kind: 'parameter', id: 'base_damage', via: 'browser' });
}

async function createApRatio(page, paramsModal) {
  await waitParamsLoaded(paramsModal);
  if (await paramsModal.getByText('ap_ratio', { exact: true }).count()) {
    evidence.writes.push({ kind: 'parameter', id: 'ap_ratio', via: 'browser', action: 'already-present' });
    return;
  }
  await paramsModal.getByRole('button', { name: '新增参数', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增参数' });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  await dialog.getByLabel('稳定标识', { exact: true }).fill('ap_ratio');
  await dialog.getByLabel('参数名称', { exact: true }).fill('法术强度倍率');
  await clickRadio(dialog, '数值类型', '小数');
  await clickRadio(dialog, '取值方式', '固定值');
  await fillNumber(dialog, '固定值', 0.75);
  await dialog.getByLabel('说明', { exact: true }).fill('浏览器试录：APRatio=0.75，比例 1=100%。');
  await fillNumber(dialog, '排序', 20);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  const error = await dialogAlertText(dialog);
  if (error && error.includes('已存在')) {
    evidence.writes.push({ kind: 'parameter', id: 'ap_ratio', via: 'browser', action: 'already-present-409' });
    await closeEditor(dialog);
    return;
  }
  if (error) {
    evidence.failures.push({ object: 'lux_q/ap_ratio', step: '保存参数', actual: error });
    throw new Error(error);
  }
  await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
  evidence.writes.push({ kind: 'parameter', id: 'ap_ratio', via: 'browser' });
}

async function createFormula(page, paramsModal) {
  await paramsModal.getByRole('tab', { name: '技能公式', exact: true }).click();
  await paramsModal.page().waitForTimeout(400);
  if (await paramsModal.getByText('damage', { exact: true }).count()) {
    evidence.writes.push({ kind: 'formula', id: 'damage', via: 'browser', action: 'already-present' });
    return;
  }
  await paramsModal.getByRole('button', { name: '新增公式', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增公式' });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await dialog.getByLabel('稳定标识', { exact: true }).fill('damage');
  await dialog.getByLabel('公式名称', { exact: true }).fill('光之束缚魔法伤害');
  await dialog.getByLabel('说明', { exact: true }).fill('浏览器试录：BaseDamage + 法术强度×0.75。');
  await fillNumber(dialog, '排序', 10);
  await clickRadio(dialog, 'expression节点类型', '运算');
  await selectOption(dialog, 'expression运算', '加');
  await clickRadio(dialog, 'expression.operands[0]节点类型', '技能参数');
  await selectOption(dialog, 'expression.operands[0]技能参数', '基础魔法伤害（base_damage）');
  await clickRadio(dialog, 'expression.operands[1]节点类型', '运算');
  await selectOption(dialog, 'expression.operands[1]运算', '乘');
  await clickRadio(dialog, 'expression.operands[1].operands[0]节点类型', '技能参数');
  await selectOption(dialog, 'expression.operands[1].operands[0]技能参数', '法术强度倍率（ap_ratio）');
  await clickRadio(dialog, 'expression.operands[1].operands[1]节点类型', '属性');
  await clickRadio(dialog, 'expression.operands[1].operands[1]属性对象', '施法者');
  await selectOption(dialog, 'expression.operands[1].operands[1]属性', '法术强度（ability_power）');
  await selectOption(dialog, 'expression.operands[1].operands[1]属性取值方式', '最终值');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  const error = await dialogAlertText(dialog);
  if (error && error.includes('已存在')) {
    evidence.writes.push({ kind: 'formula', id: 'damage', via: 'browser', action: 'already-present-409' });
    await closeEditor(dialog);
    return;
  }
  if (error) {
    evidence.failures.push({ object: 'lux_q/damage', step: '保存公式', actual: error });
    throw new Error(error);
  }
  await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
  evidence.writes.push({ kind: 'formula', id: 'damage', via: 'browser' });
}

async function createEffect(page) {
  await skillRow(page).getByRole('button', { name: '效果与结果', exact: true }).click();
  const listModal = page.getByRole('dialog', { name: '效果与结果 - 拉克丝·光之束缚' });
  await listModal.waitFor({ state: 'visible', timeout: 15_000 });
  if (await listModal.getByRole('row').filter({ hasText: 'light_binding_hit' }).count()) {
    evidence.writes.push({ kind: 'effect', id: 'light_binding_hit', via: 'browser', action: 'already-present' });
    await screenshot(page, 'lux-q-effect-saved.png');
    await listModal.getByRole('button', { name: '关闭', exact: true }).click();
    await listModal.waitFor({ state: 'hidden', timeout: 10_000 });
    return;
  }
  await listModal.getByRole('button', { name: '新增效果', exact: true }).click();
  const effect = page.getByRole('dialog', { name: '新增效果' });
  await effect.waitFor({ state: 'visible', timeout: 15_000 });
  await effect.getByLabel('效果标识', { exact: true }).fill('light_binding_hit');
  await effect.getByLabel('效果名称', { exact: true }).fill('光球命中');
  await effect.getByLabel('说明', { exact: true }).fill('浏览器试录：独立魔法伤害结果。');
  await fillNumber(effect, '排序', 20);
  await effect.getByRole('button', { name: '新增结果', exact: true }).click();
  const result = page.getByRole('dialog', { name: '新增结果' });
  await result.waitFor({ state: 'visible', timeout: 15_000 });
  await result.getByLabel('结果标识', { exact: true }).fill('magic_damage');
  await result.getByLabel('结果名称', { exact: true }).fill('魔法伤害');
  await result.getByLabel('结果种类', { exact: true }).click();
  await page.getByRole('option', { name: '伤害', exact: true }).click();
  await clickRadio(result, '作用对象', '当前目标');
  await fillNumber(result, '排序', 10);
  await clickRadio(result, '数值取值来源', '技能公式');
  await selectOption(result, '数值技能公式', '光之束缚魔法伤害（damage）');
  await fillNumber(result, '固定倍率', 1);
  await fillNumber(result, '固定最小值', 0);
  await selectOption(result, '伤害类型', '魔法伤害');
  await clickRadio(result, '伤害产生方式', '技能');
  await clickRadio(result, '伤害来源性质', '直接伤害');
  await clickRadio(result, '暴击方式', '不允许暴击');
  if (await result.getByLabel('法术护盾阻挡粒度', { exact: true }).count()) {
    await selectOption(result, '法术护盾阻挡粒度', '当前结果');
  }
  await result.getByRole('button', { name: '保存', exact: true }).click();
  const resultError = await dialogAlertText(result);
  if (resultError) {
    evidence.failures.push({ object: 'lux_q/light_binding_hit/magic_damage', step: '保存结果', actual: resultError });
    throw new Error(resultError);
  }
  await result.waitFor({ state: 'hidden', timeout: 15_000 });
  await effect.getByRole('button', { name: '保存', exact: true }).click();
  const effectError = await dialogAlertText(effect);
  if (effectError) {
    evidence.failures.push({ object: 'lux_q/light_binding_hit', step: '保存效果', actual: effectError });
    throw new Error(effectError);
  }
  await effect.waitFor({ state: 'hidden', timeout: 15_000 });
  evidence.writes.push({ kind: 'effect', id: 'light_binding_hit', via: 'browser' });
  await screenshot(page, 'lux-q-effect-saved.png');
  await listModal.getByRole('button', { name: '关闭', exact: true }).click();
  await listModal.waitFor({ state: 'hidden', timeout: 10_000 });
}

async function rereadParameter(page) {
  await skillRow(page).getByRole('button', { name: '参数与公式', exact: true }).click();
  const paramsModal = page.getByRole('dialog', { name: '参数与公式 - 拉克丝·光之束缚' });
  await paramsModal.waitFor({ state: 'visible', timeout: 15_000 });
  const row = paramsModal.getByRole('row').filter({ hasText: 'base_damage' }).first();
  await row.getByRole('button', { name: '查看', exact: true }).click();
  const view = page.getByRole('dialog', { name: '查看参数' });
  await view.waitFor({ state: 'visible', timeout: 10_000 });
  const key = await view.getByLabel('稳定标识', { exact: true }).inputValue();
  const name = await view.getByLabel('参数名称', { exact: true }).inputValue();
  const lv1 = await view.getByRole('spinbutton', { name: '等级1数值', exact: true }).inputValue();
  const lv5 = await view.getByRole('spinbutton', { name: '等级5数值', exact: true }).inputValue();
  evidence.readbacks.push({
    object: 'lux_q/base_damage',
    via: 'browser-view',
    actual: { key, name, lv1, lv5 },
    expected: { key: 'base_damage', name: '基础魔法伤害', lv1: '80', lv5: '240' },
    match: key === 'base_damage' && name === '基础魔法伤害' && lv1 === '80' && lv5 === '240'
  });
  await screenshot(page, 'lux-q-parameter-view.png');
  await view.getByRole('button', { name: '关闭', exact: true }).click();
  await view.waitFor({ state: 'hidden', timeout: 10_000 });
  return paramsModal;
}

async function run(headless) {
  evidence.browserConnection.headless = headless;
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  evidence.browserConnection.independentPlaywrightPage = true;
  page.on('pageerror', (error) => {
    evidence.pageErrors.push(error.message);
  });
  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('127.0.0.1:8080') && !url.includes('localhost:8080')) return;
    const parsed = new URL(url);
    evidence.network.apiCalls.push({
      method: response.request().method(),
      path: parsed.pathname,
      status: response.status()
    });
  });
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText('技能管理', { exact: true }).first().waitFor({ timeout: 20_000 });
    await fillTokenAndApply(page);
    await page.waitForTimeout(500);
    const login = await readVisibleSession(page);
    await screenshot(page, 'skills-page-ready.png');
    if (!login.canWrite) {
      evidence.browserConnection.stopReason = '独立 Playwright 页面未能进入可写会话。';
      await browser.close();
      return false;
    }
    await page.getByLabel('技能关键词', { exact: true }).fill('lux_q');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await skillRow(page).waitFor({ timeout: 15_000 });
    await skillRow(page).getByRole('button', { name: '参数与公式', exact: true }).click();
    const paramsModal = page.getByRole('dialog', { name: '参数与公式 - 拉克丝·光之束缚' });
    await paramsModal.waitFor({ state: 'visible', timeout: 15_000 });
    await createParameter(page, paramsModal);
    await createApRatio(page, paramsModal);
    await createFormula(page, paramsModal);
    await screenshot(page, 'lux-q-formula-saved.png');
    await paramsModal.getByRole('button', { name: '关闭', exact: true }).click();
    await paramsModal.waitFor({ state: 'hidden', timeout: 10_000 });
    await createEffect(page);
    const again = await rereadParameter(page);
    await again.getByRole('button', { name: '关闭', exact: true }).click();
    await browser.close();
    return true;
  } catch (error) {
    evidence.failures.push({ step: 'browser-flow', actual: String(error && error.stack ? error.stack : error) });
    await screenshot(page, 'browser-failure.png').catch(() => {});
    await browser.close().catch(() => {});
    return false;
  }
}

await mkdir(here, { recursive: true });
let ok = false;
try {
  ok = await run(false);
} catch (error) {
  evidence.failures.push({ step: 'headed-launch', actual: String(error) });
}
if (!ok && evidence.failures.some((item) => String(item.actual).includes('launch'))) {
  ok = await run(true);
}
if (!evidence.browserConnection.independentPlaywrightPage) {
  evidence.browserConnection.stopReason = '独立 Playwright 页面未能启动，请父任务接手浏览器体验，不把 API 写入假称为页面体验。';
}
await saveEvidence();
process.exit(ok ? 0 : 1);
