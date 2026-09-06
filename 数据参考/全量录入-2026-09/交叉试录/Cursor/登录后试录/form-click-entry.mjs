import { chromium } from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(await readFile(path.join(here, '..', 'champions-entry-plan.json'), 'utf8'));
const pageUrl = 'http://127.0.0.1:5173/#/characters';
const startedAt = new Date().toISOString();
const localPlaceholderToken = 'local-entry';


const evidence = {
  executor: 'Cursor',
  startedAt,
  finishedAt: null,
  browserConnection: {
    catalogBrowserTools: false,
    independentPlaywrightPage: false,
    headless: false,
    waitedForUserLogin: false
  },
  login: {
    tokenConfiguredVisible: null,
    gameIdVisible: null,
    tokenWarningVisible: null,
    queryAvailable: null,
    canWrite: false,
    waitStartedAt: null,
    loggedInAt: null,
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

function characterRow(page, characterKey) {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: characterKey, exact: true })
  });
}

function attributeRow(page, scope, attributeKey) {
  return scope.getByRole('row').filter({
    has: page.getByText(attributeKey, { exact: true })
  });
}

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
  await page.screenshot({ path: file, fullPage: true });
  evidence.screenshots.push(name);
  await restoreTokenField(page);
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
  const queryButton = page.getByRole('button', { name: '查询', exact: true });
  const queryAvailable = (await queryButton.count()) > 0 && await queryButton.isEnabled();
  evidence.login.tokenConfiguredVisible = tokenConfiguredVisible;
  evidence.login.gameIdVisible = gameLine;
  evidence.login.tokenWarningVisible = tokenWarningVisible;
  evidence.login.queryAvailable = queryAvailable;
  evidence.login.canWrite = tokenConfiguredVisible && !tokenWarningVisible && gameLine.includes('lol') && queryAvailable;
  return evidence.login;
}

async function bindVisibleDialog(locator) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  return {
    locator,
    labelledBy: await locator.getAttribute('aria-labelledby')
  };
}

async function waitDialogHidden(page, bound, timeout = 15_000) {
  if (bound.labelledBy) {
    await page.locator(`[role="dialog"][aria-labelledby="${bound.labelledBy}"]`).waitFor({
      state: 'hidden',
      timeout
    });
    return;
  }
  await bound.locator.waitFor({ state: 'hidden', timeout });
}

async function searchCharacters(page, keyword) {
  await page.getByLabel('角色关键词', { exact: true }).fill(keyword);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.waitForTimeout(600);
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

async function updateExistingCharacter(page, champion) {
  const existing = characterRow(page, champion.characterKey);
  await existing.getByRole('button', { name: '编辑', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑角色' });
  const bound = await bindVisibleDialog(edit);
  await edit.getByLabel('角色名称', { exact: true }).fill(champion.name);
  await edit.getByLabel('说明', { exact: true }).fill(champion.description);
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  const error = edit.locator('.arco-alert-error');
  if (await error.isVisible().catch(() => false)) {
    const message = (await error.innerText()).trim();
    evidence.failures.push({
      object: champion.characterKey,
      step: '更新已有角色主体',
      expected: '保存成功',
      actual: message
    });
    await edit.getByRole('button', { name: '取消', exact: true }).click();
    await waitDialogHidden(page, bound);
    throw new Error(`更新 ${champion.characterKey} 失败：${message}`);
  }
  await page.getByText(`角色「${champion.name}」已保存。`).waitFor({ timeout: 15_000 });
  await waitDialogHidden(page, bound);
  evidence.writes.push({ object: champion.characterKey, action: 'update-character', name: champion.name });
}

async function ensureCharacter(page, champion) {
  const existing = characterRow(page, champion.characterKey);
  if (await existing.count()) {
    evidence.writes.push({
      object: champion.characterKey,
      action: 'skip-create-already-exists',
      name: (await existing.locator('td').nth(1).innerText()).trim()
    });
    await updateExistingCharacter(page, champion);
    return;
  }

  await page.getByRole('button', { name: '新增角色', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增角色' });
  const bound = await bindVisibleDialog(create);
  await create.getByLabel('角色标识', { exact: true }).fill(champion.characterKey);
  await create.getByLabel('角色名称', { exact: true }).fill(champion.name);
  await create.getByLabel('说明', { exact: true }).fill(champion.description);
  await create.getByRole('button', { name: '保存', exact: true }).click();
  const error = create.locator('.arco-alert-error');
  if (await error.isVisible().catch(() => false)) {
    const message = (await error.innerText()).trim();
    await create.getByRole('button', { name: '取消', exact: true }).click();
    await waitDialogHidden(page, bound).catch(() => {});
    const after = await searchCharacters(page, champion.characterKey);
    evidence.duplicateChecks.push({ ...after, afterCreateError: message });
    if (after.keys.includes(champion.characterKey)) {
      evidence.writes.push({
        object: champion.characterKey,
        action: 'skip-create-found-after-uncertain-save',
        name: after.names[after.keys.indexOf(champion.characterKey)] ?? champion.name,
        createError: message
      });
      await updateExistingCharacter(page, champion);
      return;
    }
    evidence.failures.push({
      object: champion.characterKey,
      step: '保存角色主体',
      expected: '新建成功或查到已有主体后核对，不重放新增',
      actual: message
    });
    throw new Error(`创建 ${champion.characterKey} 失败：${message}`);
  }

  const savedToast = page.getByText(`角色「${champion.name}」已保存。`);
  try {
    await savedToast.waitFor({ timeout: 15_000 });
    await waitDialogHidden(page, bound);
    evidence.writes.push({ object: champion.characterKey, action: 'create-character', name: champion.name });
  } catch (error) {
    const after = await searchCharacters(page, champion.characterKey);
    evidence.duplicateChecks.push({ ...after, afterUncertainCreate: true });
    if (after.keys.includes(champion.characterKey)) {
      evidence.writes.push({
        object: champion.characterKey,
        action: 'skip-create-found-after-uncertain-save',
        name: after.names[after.keys.indexOf(champion.characterKey)] ?? champion.name
      });
      return;
    }
    evidence.failures.push({
      object: champion.characterKey,
      step: '保存角色主体',
      expected: '可见保存成功或列表已有该标识',
      actual: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function applyAttribute(page, modal, attribute) {
  await modal.getByLabel('搜索属性', { exact: true }).fill(attribute.system);
  const row = attributeRow(page, modal, attribute.system);
  await row.waitFor({ timeout: 10_000 });
  const setup = row.getByRole('button', { name: '设置', exact: true });
  const edit = row.getByRole('button', { name: '编辑', exact: true });
  if (await setup.count()) await setup.click();
  else await edit.click();
  const editor = page.getByRole('dialog').filter({ has: page.getByLabel('属性录入方式', { exact: true }) });
  const bound = await bindVisibleDialog(editor);
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
    await waitDialogHidden(page, bound).catch(() => {});
    throw new Error(`应用 ${attribute.system} 失败：${message}`);
  }
  await waitDialogHidden(page, bound, 10_000);
  evidence.writes.push({
    object: attribute.system,
    action: 'apply-attribute',
    mode: attribute.mode,
    levels: attribute.values.length
  });
  await modal.getByLabel('搜索属性', { exact: true }).fill('');
}

async function readAttributeValues(page, modal, attribute) {
  await modal.getByLabel('搜索属性', { exact: true }).fill(attribute.system);
  const row = attributeRow(page, modal, attribute.system);
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

async function readbackAttributes(page, champion, modalBound) {
  if (modalBound) {
    const stillVisible = await page.locator(`[role="dialog"][aria-labelledby="${modalBound.labelledBy}"]`).isVisible().catch(() => false);
    if (stillVisible) {
      await modalBound.locator.getByRole('button', { name: '取消', exact: true }).click();
      await waitDialogHidden(page, modalBound).catch(() => {});
    }
  }
  const row = characterRow(page, champion.characterKey);
  await row.getByRole('button', { name: '等级属性', exact: true }).click();
  const again = page.getByRole('dialog').filter({ has: page.getByLabel('搜索属性', { exact: true }) }).first();
  const againBound = await bindVisibleDialog(again);
  await again.locator('.arco-spin-loading').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  const readback = { object: champion.characterKey, attributes: [] };
  for (const attribute of champion.attributes) {
    const result = await readAttributeValues(page, again, attribute);
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
  await waitDialogHidden(page, againBound, 10_000);
}

async function saveAndReadbackAttributes(page, champion) {
  const row = characterRow(page, champion.characterKey);
  await row.getByRole('button', { name: '等级属性', exact: true }).click();
  const modal = page.getByRole('dialog').filter({ has: page.getByLabel('搜索属性', { exact: true }) }).first();
  const bound = await bindVisibleDialog(modal);
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
  const savedToast = page.getByText(`角色「${champion.name}」的等级属性已保存。`);
  const saveError = modal.locator('.arco-alert-error');
  try {
    await savedToast.waitFor({ timeout: 20_000 });
    evidence.writes.push({ object: champion.characterKey, action: 'save-parent-attributes' });
    await waitDialogHidden(page, bound, 15_000);
  } catch (error) {
    const message = (await saveError.innerText().catch(() => '')) || (error instanceof Error ? error.message : String(error));
    evidence.failures.push({
      object: champion.characterKey,
      step: '保存父级等级属性',
      expected: '可见保存成功后关闭父弹窗',
      actual: message
    });
    await readbackAttributes(page, champion, bound);
    throw new Error(`保存 ${champion.characterKey} 等级属性不明确，已改为核对已写内容，未重放新增：${message}`);
  }

  await row.getByRole('button', { name: '等级属性', exact: true }).click();
  const again = page.getByRole('dialog').filter({ has: page.getByLabel('搜索属性', { exact: true }) }).first();
  const againBound = await bindVisibleDialog(again);
  await again.locator('.arco-spin-loading').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  const readback = { object: champion.characterKey, attributes: [] };
  for (const attribute of champion.attributes) {
    const result = await readAttributeValues(page, again, attribute);
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
  await waitDialogHidden(page, againBound, 10_000);
}

async function waitVisibleWritableSession(page, timeout = 20_000) {
  await page.locator('.sidebar-status-line').filter({ hasText: /^Token / }).filter({ hasText: '已本地保存' }).waitFor({
    timeout
  });
  await page.locator('.sidebar-status-line').filter({ hasText: /^GameId / }).filter({ hasText: 'lol' }).waitFor({
    timeout
  });
  const queryButton = page.getByRole('button', { name: '查询', exact: true });
  await queryButton.waitFor({ state: 'visible', timeout });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await queryButton.isEnabled()) break;
    await page.waitForTimeout(200);
  }
  return readVisibleSession(page);
}

async function ensureLocalPlaceholderSession(page) {
  evidence.browserConnection.waitedForUserLogin = false;
  evidence.login.waitStartedAt = new Date().toISOString();
  const current = await readVisibleSession(page);
  if (current.canWrite) {
    evidence.login.loggedInAt = new Date().toISOString();
    console.log('LOCAL_PLACEHOLDER_ALREADY_READY');
    return true;
  }

  if (!current.tokenConfiguredVisible) {
    const tokenBox = page.getByRole('textbox', { name: '粘贴 Admin JWT' });
    await tokenBox.waitFor({ state: 'visible', timeout: 15_000 });
    await tokenBox.fill(localPlaceholderToken);
    await page.getByRole('button', { name: '应用', exact: true }).click();
    console.log('LOCAL_PLACEHOLDER_APPLIED');
  }

  try {
    const now = await waitVisibleWritableSession(page);
    if (now.canWrite) {
      evidence.login.loggedInAt = new Date().toISOString();
      console.log('LOCAL_PLACEHOLDER_READY');
      return true;
    }
  } catch (error) {
    evidence.login.stopReason = `未见 Token已本地保存、GameId lol 且查询可用，已停止。未读取令牌或存储，未写入业务数据。${
      error instanceof Error ? error.message : String(error)
    }`;
    console.log('LOCAL_PLACEHOLDER_NOT_READY');
    return false;
  }

  evidence.login.stopReason = '未见 Token已本地保存、GameId lol 且查询可用，已停止。未读取令牌或存储，未写入业务数据。';
  console.log('LOCAL_PLACEHOLDER_NOT_READY');
  return false;
}

await mkdir(here, { recursive: true });

let browser;
try {
  browser = await chromium.launch({
    headless: false,
    slowMo: 80,
    args: ['--start-maximized']
  });
  const context = await browser.newContext({ viewport: null });
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
  await page.bringToFront();

  const sessionReady = await ensureLocalPlaceholderSession(page);
  if (!sessionReady) {
    await saveEvidence();
    await browser.close();
    process.exit(0);
  }

  console.log('ENTRY_STARTED');
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
    await saveEvidence();
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await page.getByLabel('角色关键词', { exact: true }).fill(champion.characterKey);
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await characterRow(page, champion.characterKey).waitFor({ timeout: 10_000 });
    await saveAndReadbackAttributes(page, champion);
  }

  await page.getByRole('button', { name: '重置', exact: true }).click();
  await screenshot(page, 'characters-page-after-entry.png');
  await saveEvidence();
  console.log('ENTRY_COMPLETE');
  await browser.close();
} catch (error) {
  evidence.failures.push({
    object: 'runner',
    step: '表单点击自动化',
    expected: '完成两名英雄的页面保存与回读',
    actual: error instanceof Error ? error.message : String(error)
  });
  await saveEvidence();
  console.log('ENTRY_FAILED');
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
}
