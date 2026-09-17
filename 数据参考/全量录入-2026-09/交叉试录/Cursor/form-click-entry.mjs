import { chromium } from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(await readFile(path.join(here, 'champions-entry-plan.json'), 'utf8'));
const pageUrl = 'http://127.0.0.1:5173/#/characters';
const startedAt = new Date().toISOString();

const evidence = {
  executor: 'Cursor',
  startedAt,
  finishedAt: null,
  browserConnection: {
    catalogBrowserTools: false,
    cdpPortsTried: [9222, 9229, 9223, 9224, 9333, 9334, 18800],
    cdpConnected: false,
    independentPlaywrightPage: false,
    headless: false
  },
  login: {
    tokenConfiguredVisible: null,
    gameIdVisible: null,
    tokenWarningVisible: null,
    canWrite: false,
    stopReason: null
  },
  duplicateChecks: [],
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

function formatExpected(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(8)));
}

function visibleModal(page, title) {
  return page.getByRole('dialog', { name: title });
}

function characterRow(page, characterKey) {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: characterKey, exact: true })
  });
}

function attributeRow(scope, attributeKey) {
  return scope.getByRole('row').filter({ hasText: attributeKey });
}

async function hideTokenField(page) {
  const field = page.locator('.app-toolbar-field--token');
  if (await field.count()) {
    await field.evaluate((el) => {
      el.style.visibility = 'hidden';
    });
  }
}

async function screenshot(page, name) {
  await hideTokenField(page);
  const file = path.join(here, name);
  await page.screenshot({ path: file, fullPage: true });
  evidence.screenshots.push(name);
}

async function saveEvidence() {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(here, '实录证据.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

async function readVisibleSession(page) {
  const tokenLine = (await page.locator('.sidebar-status-line').filter({ hasText: /^Token / }).innerText()).trim();
  const gameLine = (await page.locator('.sidebar-status-line').filter({ hasText: /^GameId / }).innerText()).trim();
  const tokenConfiguredVisible = tokenLine.includes('已本地保存');
  const tokenWarningVisible = await page.getByText('请先在顶部配置 Admin Token。', { exact: true }).isVisible().catch(() => false);
  evidence.login.tokenConfiguredVisible = tokenConfiguredVisible;
  evidence.login.gameIdVisible = gameLine;
  evidence.login.tokenWarningVisible = tokenWarningVisible;
  evidence.login.canWrite = tokenConfiguredVisible && !tokenWarningVisible && gameLine.includes('lol');
  return evidence.login;
}

async function searchCharacters(page, keyword) {
  await page.getByLabel('角色关键词', { exact: true }).fill(keyword);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.waitForTimeout(400);
  const empty = await page.getByText('暂无角色', { exact: true }).isVisible().catch(() => false);
  const keys = [];
  const names = [];
  const rows = page.locator('.app-main table tbody tr');
  const count = empty ? 0 : await rows.count();
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    names.push((await row.locator('td').nth(1).innerText()).trim());
    keys.push((await row.locator('td').nth(2).innerText()).trim());
  }
  return { keyword, empty, count, keys, names };
}

async function ensureCharacter(page, champion) {
  const existing = characterRow(page, champion.characterKey);
  if (await existing.count()) {
    evidence.writes.push({
      object: champion.characterKey,
      action: 'skip-create-already-exists',
      name: (await existing.locator('td').nth(1).innerText()).trim()
    });
    await existing.getByRole('button', { name: '编辑', exact: true }).click();
    const edit = visibleModal(page, '编辑角色');
    await edit.getByLabel('角色名称', { exact: true }).fill(champion.name);
    await edit.getByLabel('说明', { exact: true }).fill(champion.description);
    await edit.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText(`角色「${champion.name}」已保存。`).waitFor({ timeout: 15_000 });
    evidence.writes.push({ object: champion.characterKey, action: 'update-character', name: champion.name });
    return;
  }
  await page.getByRole('button', { name: '新增角色', exact: true }).click();
  const create = visibleModal(page, '新增角色');
  await create.getByLabel('角色标识', { exact: true }).fill(champion.characterKey);
  await create.getByLabel('角色名称', { exact: true }).fill(champion.name);
  await create.getByLabel('说明', { exact: true }).fill(champion.description);
  await create.getByRole('button', { name: '保存', exact: true }).click();
  const error = create.locator('.arco-alert-error');
  if (await error.isVisible().catch(() => false)) {
    const message = (await error.innerText()).trim();
    evidence.failures.push({
      object: champion.characterKey,
      step: '保存角色主体',
      expected: '新建成功',
      actual: message
    });
    await create.getByRole('button', { name: '取消', exact: true }).click();
    throw new Error(`创建 ${champion.characterKey} 失败：${message}`);
  }
  await page.getByText(`角色「${champion.name}」已保存。`).waitFor({ timeout: 15_000 });
  evidence.writes.push({ object: champion.characterKey, action: 'create-character', name: champion.name });
}

async function applyAttribute(page, modal, attribute) {
  await modal.getByLabel('搜索属性', { exact: true }).fill(attribute.system);
  const row = attributeRow(modal, attribute.system);
  await row.waitFor({ timeout: 10_000 });
  const setup = row.getByRole('button', { name: '设置', exact: true });
  const edit = row.getByRole('button', { name: '编辑', exact: true });
  if (await setup.count()) await setup.click();
  else await edit.click();
  const editor = page.getByRole('dialog').filter({ has: page.getByLabel('属性录入方式', { exact: true }) });
  await editor.waitFor({ timeout: 10_000 });
  if (attribute.mode === 'fixed') {
    await editor.getByText('固定', { exact: true }).click();
    await editor.getByLabel('Lv1 数值', { exact: true }).fill(String(attribute.values[0]));
  } else {
    await editor.getByText('逐级录入', { exact: true }).click();
    await editor.getByLabel('各级数值', { exact: true }).fill(attribute.values.join('\n'));
  }
  await editor.getByRole('button', { name: '应用', exact: true }).click();
  const applyError = editor.locator('.arco-alert-error');
  if (await applyError.isVisible().catch(() => false)) {
    const message = (await applyError.innerText()).trim();
    evidence.failures.push({
      object: attribute.system,
      step: `应用属性 ${attribute.system}`,
      expected: '应用成功并关闭子弹窗',
      actual: message
    });
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    throw new Error(`应用 ${attribute.system} 失败：${message}`);
  }
  await editor.waitFor({ state: 'hidden', timeout: 10_000 });
  evidence.writes.push({
    object: attribute.system,
    action: 'apply-attribute',
    mode: attribute.mode,
    levels: attribute.values.length
  });
  await modal.getByLabel('搜索属性', { exact: true }).fill('');
}

async function readAttributeValues(modal, attribute) {
  await modal.getByLabel('搜索属性', { exact: true }).fill(attribute.system);
  const row = attributeRow(modal, attribute.system);
  await row.waitFor({ timeout: 10_000 });
  const cells = row.locator('td');
  const count = await cells.count();
  const actual = [];
  for (let i = 1; i <= 18 && i < count - 1; i += 1) {
    actual.push((await cells.nth(i).innerText()).trim());
  }
  const expected = attribute.values.map(formatExpected);
  const mismatches = [];
  for (let i = 0; i < 18; i += 1) {
    if (actual[i] !== expected[i]) {
      mismatches.push({ level: i + 1, expected: expected[i], actual: actual[i] ?? null });
    }
  }
  await modal.getByLabel('搜索属性', { exact: true }).fill('');
  return { expected, actual, mismatches };
}

async function saveAndReadbackAttributes(page, champion) {
  const row = characterRow(page, champion.characterKey);
  await row.getByRole('button', { name: '等级属性', exact: true }).click();
  const modal = visibleModal(page, `等级属性 - ${champion.name}`);
  await modal.waitFor({ timeout: 15_000 });
  await modal.locator('.arco-spin-loading').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  const loadError = modal.locator('.arco-alert-error');
  if (await loadError.isVisible().catch(() => false)) {
    const message = (await loadError.innerText()).trim();
    evidence.failures.push({
      object: champion.characterKey,
      step: '打开等级属性',
      expected: '属性表加载成功',
      actual: message
    });
    throw new Error(message);
  }
  for (const attribute of champion.attributes) {
    await applyAttribute(page, modal, attribute);
  }
  await screenshot(page, `${champion.characterKey}-attributes-before-save.png`);
  await modal.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText(`角色「${champion.name}」的等级属性已保存。`).waitFor({ timeout: 20_000 });
  evidence.writes.push({ object: champion.characterKey, action: 'save-parent-attributes' });
  await modal.waitFor({ state: 'hidden', timeout: 15_000 });

  await row.getByRole('button', { name: '等级属性', exact: true }).click();
  const again = visibleModal(page, `等级属性 - ${champion.name}`);
  await again.waitFor({ timeout: 15_000 });
  await again.locator('.arco-spin-loading').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  const readback = { object: champion.characterKey, attributes: [] };
  for (const attribute of champion.attributes) {
    const result = await readAttributeValues(again, attribute);
    readback.attributes.push({
      system: attribute.system,
      mismatchCount: result.mismatches.length,
      mismatches: result.mismatches,
      actual: result.actual
    });
    if (result.mismatches.length) {
      evidence.failures.push({
        object: `${champion.characterKey}/${attribute.system}`,
        step: '关闭后重开逐项回读',
        expected: result.expected,
        actual: result.actual
      });
    }
  }
  evidence.readbacks.push(readback);
  await screenshot(page, `${champion.characterKey}-attributes-reread.png`);
  await again.getByRole('button', { name: '取消', exact: true }).click();
  await again.waitFor({ state: 'hidden', timeout: 10_000 });
}

await mkdir(here, { recursive: true });

let browser;
try {
  browser = await chromium.launch({ headless: false });
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

  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('角色管理', { exact: true }).first().waitFor({ timeout: 20_000 });
  const apiInput = page.locator('.app-toolbar-field--api input');
  const currentApi = await apiInput.inputValue();
  if (currentApi.trim() !== 'http://127.0.0.1:8080' && currentApi.trim() !== 'http://localhost:8080') {
    await apiInput.fill('http://127.0.0.1:8080');
    await page.getByRole('button', { name: '应用', exact: true }).click();
  }
  await page.locator('.sidebar-status-line').filter({ hasText: /^GameId / }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  const login = await readVisibleSession(page);
  await screenshot(page, 'characters-page-login-probe.png');

  if (!login.canWrite) {
    evidence.login.stopReason = login.tokenConfiguredVisible
      ? '独立页面已显示令牌已保存，但游戏不是 lol 或仍有令牌警告，已停止写入。'
      : '当前会话没有可用的已授权浏览器连接；独立 Playwright 页面侧栏显示 Token 未配置，不能填写或生成管理凭据，已停止业务写入。';
    await saveEvidence();
    await browser.close();
    process.exit(0);
  }

  for (const champion of plan.champions) {
    const queries = plan.duplicateQueries[champion.characterKey];
    for (const keyword of queries) {
      const result = await searchCharacters(page, keyword);
      evidence.duplicateChecks.push(result);
    }
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await page.waitForTimeout(400);
    await searchCharacters(page, champion.characterKey);
    await ensureCharacter(page, champion);
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await page.getByLabel('角色关键词', { exact: true }).fill(champion.characterKey);
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await characterRow(page, champion.characterKey).waitFor({ timeout: 10_000 });
    await saveAndReadbackAttributes(page, champion);
  }

  await page.getByRole('button', { name: '重置', exact: true }).click();
  await screenshot(page, 'characters-page-after-entry.png');
  await saveEvidence();
  await browser.close();
} catch (error) {
  evidence.failures.push({
    object: 'runner',
    step: '表单点击自动化',
    expected: '完成两名英雄的页面保存与回读',
    actual: error instanceof Error ? error.message : String(error)
  });
  await saveEvidence();
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
}
