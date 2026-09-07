import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = 'http://127.0.0.1:5173/#/skills';
const localPlaceholderToken = 'local-entry';

const evidence = {
  executor: 'Cursor',
  purpose: 'independent-readback-P-W-only',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  login: {},
  readbacks: [],
  failures: [],
  screenshots: []
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
  await page.screenshot({ path: path.join(here, name), fullPage: false });
  evidence.screenshots.push(name);
  await restoreTokenField(page);
}

function skillRow(page, skillKey) {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: skillKey, exact: true })
  });
}

async function searchSkill(page, skillKey) {
  await page.getByLabel('技能关键词', { exact: true }).fill(skillKey);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await skillRow(page, skillKey).waitFor({ state: 'visible', timeout: 20_000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const apiInput = page.locator('.app-toolbar-field--api input');
    const currentApi = await apiInput.inputValue();
    if (currentApi.trim() !== 'http://127.0.0.1:8080' && currentApi.trim() !== 'http://localhost:8080') {
      await apiInput.fill('http://127.0.0.1:8080');
    }
    await page.locator('.app-toolbar-field--token input').fill(localPlaceholderToken);
    await page.getByRole('button', { name: '应用', exact: true }).click();
    await page.locator('.sidebar-status-line').filter({ hasText: /^Token 已本地保存$/ }).waitFor({ timeout: 20_000 });
    await page.locator('.sidebar-status-line').filter({ hasText: /^GameId lol$/ }).waitFor({ timeout: 20_000 });
    evidence.login = {
      tokenConfiguredVisible: true,
      gameIdVisible: 'GameId lol',
      canWrite: true
    };
    await screenshot(page, 'skills-page-ready.png');

    await searchSkill(page, 'lux_p');
    await skillRow(page, 'lux_p').getByRole('button', { name: '参数与公式', exact: true }).click();
    const pModal = page.getByRole('dialog').filter({ hasText: '参数与公式' }).first();
    await pModal.waitFor({ state: 'visible', timeout: 15_000 });
    const pRow = pModal.getByRole('row').filter({ hasText: 'base_damage' }).first();
    await pRow.getByRole('button', { name: '查看', exact: true }).click();
    const pView = page.getByRole('dialog', { name: '查看参数' });
    await pView.waitFor({ state: 'visible', timeout: 10_000 });
    const pLv1 = await pView.getByRole('spinbutton', { name: '等级1数值', exact: true }).inputValue();
    const pLv18 = await pView.getByRole('spinbutton', { name: '等级18数值', exact: true }).inputValue();
    evidence.readbacks.push({
      object: 'lux_p/base_damage',
      via: 'browser-view',
      actual: { lv1: pLv1, lv18: pLv18 },
      expected: { lv1: '30', lv18: '200' },
      match: pLv1 === '30' && pLv18 === '200'
    });
    if (pLv1 !== '30' || pLv18 !== '200') {
      evidence.failures.push({ object: 'lux_p/base_damage', actual: { pLv1, pLv18 } });
    }
    await screenshot(page, 'lux-p-base-damage-view.png');
    await pView.getByRole('button', { name: '关闭', exact: true }).click();
    await pView.waitFor({ state: 'hidden', timeout: 10_000 });
    await pModal.getByRole('button', { name: '关闭', exact: true }).click();
    await pModal.waitFor({ state: 'hidden', timeout: 10_000 });

    await searchSkill(page, 'lux_w');
    await skillRow(page, 'lux_w').getByRole('button', { name: '效果与结果', exact: true }).click();
    const wList = page.getByRole('dialog').filter({ hasText: '效果与结果' }).first();
    await wList.waitFor({ state: 'visible', timeout: 15_000 });
    const wRow = wList.getByRole('row').filter({ hasText: 'prismatic_shield' }).first();
    await wRow.getByRole('button', { name: '查看', exact: true }).click();
    const wView = page.getByRole('dialog', { name: '查看效果' });
    await wView.waitFor({ state: 'visible', timeout: 10_000 });
    const instanceScope = (await wView.getByLabel('实例范围', { exact: true }).innerText()).trim();
    const resultRow = wView.getByRole('row').filter({ hasText: 'shield' }).first();
    const resultTarget = (await resultRow.innerText()).trim();
    const match = instanceScope.includes('按来源对象') && resultTarget.includes('施法者');
    evidence.readbacks.push({
      object: 'lux_w/prismatic_shield',
      via: 'browser-view',
      actual: { instanceScope, resultTarget },
      expected: { instanceScope: '按来源对象', resultTarget: '施法者' },
      match
    });
    if (!match) {
      evidence.failures.push({ object: 'lux_w/prismatic_shield', actual: { instanceScope, resultTarget } });
    }
    await screenshot(page, 'lux-w-self-shield-view.png');
    await wView.getByRole('button', { name: '关闭', exact: true }).click();
    await wView.waitFor({ state: 'hidden', timeout: 10_000 });
    await wList.getByRole('button', { name: '关闭', exact: true }).click();
    await wList.waitFor({ state: 'hidden', timeout: 10_000 });
  } catch (error) {
    evidence.failures.push({ step: 'browser', actual: String(error) });
    throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    await writeFile(path.join(here, '浏览器验证证据.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    await browser.close();
  }
}

await main();
