import { chromium } from 'file:///C:/project/damage_web_dev/web/node_modules/playwright/index.mjs';
import { appendFile, copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(await readFile('C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/交叉试录/Cursor第四批输入/champions-entry-plan.json', 'utf8'));
const pageUrl = 'http://127.0.0.1:5173/#/characters';
const startedAt = new Date().toISOString();
const localPlaceholderToken = 'local-entry';
const totalPlanned = Array.isArray(plan.champions) ? plan.champions.length : 0;

const evidence = {
  executor: 'Cursor',
  batch: '第四批',
  startedAt,
  finishedAt: null,
  resumedAt: null,
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
  championSummaries: [],
  network: {
    note: '只记录方法、路径和状态码，不记录请求头、Cookie 或令牌。',
    apiCalls: []
  },
  pageErrors: [],
  toolErrors: []
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

function missingOf(champion) {
  return Array.isArray(champion.missingAttributes) ? champion.missingAttributes : [];
}

function plannedAttributesOf(champion) {
  return Array.isArray(champion.attributes) ? champion.attributes : [];
}

function latestReadback(characterKey) {
  for (let i = evidence.readbacks.length - 1; i >= 0; i -= 1) {
    if (evidence.readbacks[i].object === characterKey) return evidence.readbacks[i];
  }
  return null;
}

function latestSummary(characterKey) {
  for (let i = evidence.championSummaries.length - 1; i >= 0; i -= 1) {
    if (evidence.championSummaries[i].characterKey === characterKey) {
      return evidence.championSummaries[i];
    }
  }
  return null;
}

function isChampionComplete(champion) {
  const summary = latestSummary(champion.characterKey);
  if (summary?.ok === true) return true;
  const readback = latestReadback(champion.characterKey);
  const planned = plannedAttributesOf(champion);
  if (!readback || !Array.isArray(readback.attributes)) return false;
  if (readback.attributes.length !== planned.length) return false;
  return readback.attributes.every((item) => item.mismatchCount === 0);
}

function completedOkCount() {
  const keys = new Set();
  for (const summary of evidence.championSummaries) {
    if (summary.ok) keys.add(summary.characterKey);
  }
  for (const champion of plan.champions) {
    if (!keys.has(champion.characterKey) && isChampionComplete(champion)) {
      keys.add(champion.characterKey);
    }
  }
  return keys.size;
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

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await copyFile(tmp, file);
  await unlink(tmp).catch(() => {});
}

async function progressLog(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  await appendFile(path.join(here, 'run-progress.log'), line, 'utf8').catch(() => {});
  console.log(message);
}

function progressSnapshot(extra = {}) {
  const completed = [];
  const failed = [];
  for (const champion of plan.champions) {
    const summary = latestSummary(champion.characterKey);
    if (summary?.ok) completed.push(champion.characterKey);
    else if (summary && summary.ok === false) failed.push(champion.characterKey);
  }
  const next = plan.champions.find((champion) => !completed.includes(champion.characterKey) && !failed.includes(champion.characterKey));
  return {
    executor: 'Cursor',
    batch: '第四批',
    updatedAt: new Date().toISOString(),
    completedCount: completed.length,
    failedCount: failed.length,
    totalPlanned,
    lastChampion: extra.lastChampion ?? completed[completed.length - 1] ?? null,
    completedKeys: completed,
    failedKeys: failed,
    nextChampion: extra.nextChampion ?? next?.characterKey ?? null,
    imagesPending: true,
    skillsPending: true,
    ...extra
  };
}

async function saveProgress(extra = {}) {
  await writeJsonAtomic(path.join(here, '进度.json'), progressSnapshot(extra));
}

async function saveEvidence() {
  evidence.finishedAt = new Date().toISOString();
  evidence.completedOkCount = completedOkCount();
  evidence.totalPlanned = totalPlanned;
  await writeJsonAtomic(path.join(here, '实录证据.json'), evidence);
}

async function saveBatchHandoff(endIndexInclusive) {
  const startIndex = Math.floor(endIndexInclusive / 5) * 5;
  const slice = plan.champions.slice(startIndex, endIndexInclusive + 1);
  const batchIndex = Math.floor(startIndex / 5) + 1;
  const payload = {
    executor: 'Cursor',
    batch: '第四批',
    batchIndex,
    range: `${startIndex + 1}-${endIndexInclusive + 1}`,
    writtenAt: new Date().toISOString(),
    totalPlanned,
    completedOkCount: completedOkCount(),
    imagesPending: true,
    skillsPending: true,
    champions: slice.map((champion) => {
      const summary = latestSummary(champion.characterKey);
      const readback = latestReadback(champion.characterKey);
      return {
        characterKey: champion.characterKey,
        name: champion.name,
        plannedAttributeCount: plannedAttributesOf(champion).length,
        expectedAttributeCount: champion.expectedAttributeCount ?? plannedAttributesOf(champion).length,
        missingAttributes: missingOf(champion),
        readbackAttributeCount: readback?.attributes?.length ?? summary?.readbackAttributeCount ?? 0,
        mismatchTotal: summary?.mismatchTotal ?? null,
        ok: summary?.ok ?? false,
        completedAt: summary?.completedAt ?? null,
        note: summary?.note ?? null
      };
    })
  };
  const file = path.join(here, `小批-${String(batchIndex).padStart(2, '0')}.json`);
  await writeJsonAtomic(file, payload);
  await progressLog(`BATCH_HANDOFF ${payload.range} file=小批-${String(batchIndex).padStart(2, '0')}.json`);
}

function recordChampionSummary(champion, extra = {}) {
  const planned = plannedAttributesOf(champion);
  const readback = latestReadback(champion.characterKey);
  const mismatchTotal = Array.isArray(readback?.attributes)
    ? readback.attributes.reduce((sum, item) => sum + (item.mismatchCount || 0), 0)
    : extra.mismatchTotal ?? null;
  const readbackAttributeCount = Array.isArray(readback?.attributes)
    ? readback.attributes.length
    : extra.readbackAttributeCount ?? 0;
  const ok = extra.ok ?? (
    readbackAttributeCount === planned.length && mismatchTotal === 0
  );
  const summary = {
    characterKey: champion.characterKey,
    name: champion.name,
    completedAt: new Date().toISOString(),
    plannedAttributeCount: planned.length,
    expectedAttributeCount: champion.expectedAttributeCount ?? planned.length,
    readbackAttributeCount,
    mismatchTotal,
    missingAttributes: missingOf(champion),
    overallStatus: champion.overallStatus ?? null,
    imagesPending: true,
    skillsPending: true,
    ok,
    note: extra.note ?? null
  };
  evidence.championSummaries = evidence.championSummaries.filter((item) => item.characterKey !== champion.characterKey);
  evidence.championSummaries.push(summary);
  return summary;
}

async function persistAfterChampion(champion, index, extra = {}) {
  const summary = recordChampionSummary(champion, extra);
  await saveEvidence();
  await saveProgress({
    lastChampion: champion.characterKey,
    lastOk: summary.ok,
    completedCount: completedOkCount()
  });
  if ((index + 1) % 5 === 0 || index + 1 === totalPlanned) {
    await saveBatchHandoff(index);
  }
  await progressLog(
    `CHAMPION_DONE key=${champion.characterKey} index=${index + 1}/${totalPlanned} ok=${summary.ok} attrs=${summary.plannedAttributeCount} readbacks=${summary.readbackAttributeCount} missing=${summary.missingAttributes.join(',') || 'none'} mismatches=${summary.mismatchTotal} completedOk=${completedOkCount()}`
  );
  return summary;
}

async function loadExistingEvidence() {
  try {
    const raw = await readFile(path.join(here, '实录证据.json'), 'utf8');
    const prev = JSON.parse(raw);
    if (!prev || typeof prev !== 'object') return;
    evidence.startedAt = prev.startedAt || evidence.startedAt;
    evidence.resumedAt = new Date().toISOString();
    if (prev.login) evidence.login = { ...evidence.login, ...prev.login };
    evidence.duplicateChecks = Array.isArray(prev.duplicateChecks) ? prev.duplicateChecks : [];
    evidence.writes = Array.isArray(prev.writes) ? prev.writes : [];
    evidence.readbacks = Array.isArray(prev.readbacks) ? prev.readbacks : [];
    evidence.failures = Array.isArray(prev.failures) ? prev.failures : [];
    evidence.screenshots = Array.isArray(prev.screenshots) ? prev.screenshots : [];
    evidence.championSummaries = Array.isArray(prev.championSummaries) ? prev.championSummaries : [];
    evidence.pageErrors = Array.isArray(prev.pageErrors) ? prev.pageErrors : [];
    evidence.toolErrors = Array.isArray(prev.toolErrors) ? prev.toolErrors : [];
    if (prev.network?.apiCalls) evidence.network.apiCalls = prev.network.apiCalls;
    await progressLog(`RESUME_LOADED completedOk=${completedOkCount()} failures=${evidence.failures.length}`);
  } catch {
    await progressLog('FRESH_RUN');
  }
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
  await page.locator('.app-main .arco-spin-loading').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(600);
  const empty = await page.getByText('暂无角色', { exact: true }).isVisible().catch(() => false);
  if (empty) {
    return { keyword, empty: true, count: 0, keys: [], names: [] };
  }
  const parsed = await page.locator('.app-main table tbody tr').evaluateAll((trs) => trs.map((tr) => {
    const tds = tr.querySelectorAll('td');
    return {
      name: (tds[1]?.textContent ?? '').trim(),
      key: (tds[2]?.textContent ?? '').trim()
    };
  }));
  return {
    keyword,
    empty: false,
    count: parsed.length,
    keys: parsed.map((item) => item.key),
    names: parsed.map((item) => item.name)
  };
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
  for (const attribute of plannedAttributesOf(champion)) {
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
  evidence.readbacks = evidence.readbacks.filter((item) => item.object !== champion.characterKey);
  evidence.readbacks.push(readback);
  await screenshot(page, `${champion.characterKey}-attributes-reread.png`);
  await again.getByRole('button', { name: '取消', exact: true }).click();
  await waitDialogHidden(page, againBound, 10_000);
}

async function saveAndReadbackAttributes(page, champion) {
  const planned = plannedAttributesOf(champion);
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
  for (const attribute of planned) {
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
    await saveEvidence();
  } catch (error) {
    const message = (await saveError.innerText().catch(() => '')) || (error instanceof Error ? error.message : String(error));
    evidence.failures.push({
      object: champion.characterKey,
      step: '保存父级等级属性',
      expected: '可见保存成功后关闭父弹窗',
      actual: message
    });
    await readbackAttributes(page, champion, bound);
    await saveEvidence();
    throw new Error(`保存 ${champion.characterKey} 等级属性不明确，已改为核对已写内容，未重放新增：${message}`);
  }

  await row.getByRole('button', { name: '等级属性', exact: true }).click();
  const again = page.getByRole('dialog').filter({ has: page.getByLabel('搜索属性', { exact: true }) }).first();
  const againBound = await bindVisibleDialog(again);
  await again.locator('.arco-spin-loading').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  const readback = { object: champion.characterKey, attributes: [] };
  for (const attribute of planned) {
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
  evidence.readbacks = evidence.readbacks.filter((item) => item.object !== champion.characterKey);
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
    await progressLog('LOCAL_PLACEHOLDER_ALREADY_READY');
    return true;
  }

  if (!current.tokenConfiguredVisible) {
    const tokenBox = page.getByRole('textbox', { name: '粘贴 Admin JWT' });
    await tokenBox.waitFor({ state: 'visible', timeout: 15_000 });
    await tokenBox.fill(localPlaceholderToken);
    await page.getByRole('button', { name: '应用', exact: true }).click();
    await progressLog('LOCAL_PLACEHOLDER_APPLIED');
  }

  try {
    const now = await waitVisibleWritableSession(page);
    if (now.canWrite) {
      evidence.login.loggedInAt = new Date().toISOString();
      await progressLog('LOCAL_PLACEHOLDER_READY');
      return true;
    }
  } catch (error) {
    evidence.login.stopReason = `未见 Token已本地保存、GameId lol 且查询可用，已停止。未读取令牌或存储，未写入业务数据。${
      error instanceof Error ? error.message : String(error)
    }`;
    await progressLog('LOCAL_PLACEHOLDER_NOT_READY');
    return false;
  }

  evidence.login.stopReason = '未见 Token已本地保存、GameId lol 且查询可用，已停止。未读取令牌或存储，未写入业务数据。';
  await progressLog('LOCAL_PLACEHOLDER_NOT_READY');
  return false;
}

function isBrowserDeadError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Target page, context or browser has been closed|browser has been closed|Connection closed|ECONNRESET|Protocol error/i.test(message);
}

await mkdir(here, { recursive: true });
await loadExistingEvidence();
await saveEvidence();
await saveProgress();

let browser;
let stopping = false;

async function persistCrash(error, step) {
  const message = error instanceof Error ? error.message : String(error);
  evidence.failures.push({
    object: 'runner',
    step,
    expected: '完成本批55名英雄的页面保存与回读，或在已保存状态上继续缺项',
    actual: message
  });
  evidence.toolErrors.push({
    at: new Date().toISOString(),
    step,
    message
  });
  await saveEvidence().catch(() => {});
  await saveProgress({ lastError: message }).catch(() => {});
  await progressLog(`ENTRY_FAILED ${message}`).catch(() => {});
}

process.on('SIGINT', () => {
  stopping = true;
});

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
    await saveProgress({ nextChampion: plan.champions[0]?.characterKey ?? null });
    await browser.close();
    process.exit(0);
  }

  await progressLog(`ENTRY_STARTED total=${totalPlanned} completedOk=${completedOkCount()}`);
  for (let index = 0; index < plan.champions.length; index += 1) {
    if (stopping) break;
    const champion = plan.champions[index];
    const planned = plannedAttributesOf(champion);
    const missing = missingOf(champion);
    await progressLog(
      `CHAMPION_START key=${champion.characterKey} index=${index + 1}/${totalPlanned} attrs=${planned.length} expected=${champion.expectedAttributeCount ?? planned.length} missing=${missing.join(',') || 'none'}`
    );
    if (isChampionComplete(champion)) {
      await progressLog(`CHAMPION_SKIP_COMPLETE key=${champion.characterKey}`);
      if ((index + 1) % 5 === 0 || index + 1 === totalPlanned) await saveBatchHandoff(index);
      continue;
    }
    try {
      const queries = (plan.duplicateQueries?.[champion.characterKey] ?? [champion.characterKey])
        .filter((keyword) => typeof keyword === 'string' && keyword.length > 0);
      for (const keyword of queries) {
        const result = await searchCharacters(page, keyword);
        evidence.duplicateChecks.push(result);
      }
      await page.getByRole('button', { name: '重置', exact: true }).click();
      await page.waitForTimeout(400);
      await searchCharacters(page, champion.characterKey);
      await ensureCharacter(page, champion);
      await saveEvidence();
      await saveProgress({ lastChampion: champion.characterKey, phase: 'character-saved' });
      await page.getByRole('button', { name: '重置', exact: true }).click();
      await page.getByLabel('角色关键词', { exact: true }).fill(champion.characterKey);
      await page.getByRole('button', { name: '查询', exact: true }).click();
      await characterRow(page, champion.characterKey).waitFor({ timeout: 10_000 });
      await saveAndReadbackAttributes(page, champion);
      await persistAfterChampion(champion, index);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!evidence.failures.some((item) => item.object === champion.characterKey && item.actual === message)) {
        evidence.failures.push({
          object: champion.characterKey,
          step: '单英雄录入',
          expected: '保存主体与计划内属性后关闭重开回读一致',
          actual: message
        });
      }
      recordChampionSummary(champion, {
        ok: false,
        note: message
      });
      await saveEvidence();
      await saveProgress({
        lastChampion: champion.characterKey,
        lastError: message
      });
      if ((index + 1) % 5 === 0 || index + 1 === totalPlanned) {
        await saveBatchHandoff(index).catch(() => {});
      }
      await progressLog(`CHAMPION_FAILED key=${champion.characterKey} ${message}`);
      if (isBrowserDeadError(error)) {
        evidence.toolErrors.push({
          at: new Date().toISOString(),
          step: `browser-dead-after-${champion.characterKey}`,
          message
        });
        await saveEvidence();
        throw error;
      }
    }
  }

  await page.getByRole('button', { name: '重置', exact: true }).click();
  await screenshot(page, 'characters-page-after-entry.png');
  await saveEvidence();
  await saveProgress({ nextChampion: null });
  const okCount = completedOkCount();
  await progressLog(`ENTRY_COMPLETE completedOk=${okCount}/${totalPlanned} failures=${evidence.failures.length}`);
  await browser.close();
  process.exit(okCount === totalPlanned && evidence.failures.length === 0 ? 0 : 1);
} catch (error) {
  await persistCrash(error, '表单点击自动化');
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
}
