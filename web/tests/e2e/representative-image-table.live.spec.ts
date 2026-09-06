/**
 * 六类业务表格最左侧代表图片的真实浏览器验收，无接口替身。
 * 手动：STAGE9_TABLE_LIVE_ACCEPTANCE=1 后运行专用 playwright.image-table-live.config.ts。
 * 只创建可通过 API 删除的测试对象，复用已有图片。属性只读，不新增图片/属性，不全量同步缓存。
 */
import { expect, request as playwrightRequest, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const API = 'http://127.0.0.1:8080';
const GAME = 'lol';
const ADMIN = `${API}/api/admin/games/${GAME}`;
const PREFIX = 'stage9_table_20260906';
const DESCRIPTION = '阶段九业务表格图片真实验收临时对象';
const keys = { character: `${PREFIX}_character`, equipment: `${PREFIX}_equipment`, skill: `${PREFIX}_skill`,
  effect: `${PREFIX}_effect`, status: `${PREFIX}_status` };
const names = { character: '阶段九表格实测角色', equipment: '阶段九表格实测装备', skill: '阶段九表格实测技能',
  effect: '阶段九表格实测效果', status: '阶段九表格实测状态' };
const sources = [
  { route: 'characters', key: keys.character, name: names.character, label: '角色', path: `characters/${keys.character}` },
  { route: 'equipment', key: keys.equipment, name: names.equipment, label: '装备', path: `equipment/${keys.equipment}` },
  { route: 'skills', key: keys.skill, name: names.skill, label: '技能', path: `skills/${keys.skill}` },
  { route: 'statuses', key: keys.status, name: names.status, label: '状态', path: `statuses/${keys.status}` },
  { route: 'skills', key: keys.effect, name: names.effect, label: '技能效果', path: `skills/${keys.skill}/effects/${keys.effect}` }
];
const IMAGE_KEYS = ['attribute_ad', 'attribute_attack_speed'];
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
function row(scope: Page | Locator, key: string) {
  const page = 'page' in scope ? scope.page() : scope;
  return scope.getByRole('row').filter({ has: page.getByRole('cell', { name: key, exact: true }) });
}
function modal(page: Page, title: string) {
  return page.locator('.arco-modal:visible').filter({ has: page.locator('.arco-modal-title', { hasText: title }) });
}
async function navigate(page: Page, route: string) {
  await page.evaluate(route => { window.location.hash = `#/${route}`; }, route);
  await expect(page).toHaveURL(new RegExp(`#/${route}$`));
}
async function close(dialog: Locator) {
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function centerIsUncovered(locator: Locator): Promise<boolean> {
  return locator.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return hit === element || element.contains(hit);
  });
}

test('live: six tables show representative images in the first column and refresh after saving', async ({ page, request }, testInfo) => {
  test.skip(process.env.STAGE9_TABLE_LIVE_ACCEPTANCE !== '1', '仅显式启用时访问本地实库。');
  await mkdir(testInfo.outputDir, { recursive: true });
  const owned: string[] = [];
  const milestones: string[] = [];
  const requests: Array<{ method: string; path: string; status: number }> = [];
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  const cleanup: Array<{ path: string; status: number }> = [];
  const cleanupProblems: string[] = [];
  const existingImages: Array<{ imageKey: string; imageBase64Sha256: string }> = [];
  const layoutChecks: Array<{ source: string; viewportWidth: number; imageCenterUncovered: boolean; nameCenterUncovered: boolean; buttonRows: number; buttonsOverlap: boolean }> = [];
  let attributeCoverage = '尚未检查';
  let primaryFailure: string | null = null;
  const evidence = () => ({ api: API, gameId: GAME, prefix: PREFIX, owned, milestones, attributeCoverage,
    requests, requestCount: requests.length, browserWriteCount: requests.filter(item => item.method !== 'GET').length,
    errors, consoleErrors, requestFailures, existingImages, layoutChecks, cleanup, cleanupProblems, primaryFailure });
  const checkpoint = () => writeFile(testInfo.outputPath('acceptance-summary.json'), JSON.stringify(evidence(), null, 2));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => requestFailures.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) requests.push({ method: response.request().method(), path: url.pathname + url.search, status: response.status() });
  });
  const common = { description: DESCRIPTION, status: 'ENABLED', sortOrder: 0 };
  const fixtures = [
    { path: 'characters', key: keys.character, body: { characterKey: keys.character, name: names.character, description: DESCRIPTION } },
    { path: 'equipment', key: keys.equipment, body: { equipmentKey: keys.equipment, name: names.equipment, description: DESCRIPTION } },
    { path: 'statuses', key: keys.status, body: { statusKey: keys.status, name: names.status, ...common } },
    { path: 'skills', key: keys.skill, body: { skillKey: keys.skill, name: names.skill, maxLevel: 1, skillCategoryKeys: [], ...common } },
    { path: `skills/${keys.skill}/effects`, key: keys.effect, body: { effectKey: keys.effect, name: names.effect,
      description: DESCRIPTION, sortOrder: 0, lifecycle: null, results: [{ resultKey: `${PREFIX}_result`, name: '表格验收状态移除',
        target: 'SOURCE', description: null, sortOrder: 0, lifecycleBehavior: null, spellShieldBlockScope: null,
        resultType: 'STATUS_OPERATION', valueRule: null, detail: { statusKey: keys.status, operation: 'REMOVE' } }] } }
  ];
  try {
    const imageData = await Promise.all(IMAGE_KEYS.map(async key => {
      const response = await request.get(`${ADMIN}/images/${key}`);
      expect(response.status()).toBe(200);
      const image = await response.json();
      expect(image.gameId).toBe(GAME);
      expect(image.enabled).toBe(true);
      existingImages.push({ imageKey: key, imageBase64Sha256: sha256(image.imageBase64) });
      return image;
    }));
    const attributesResponse = await request.get(`${ADMIN}/attributes`);
    expect(attributesResponse.status()).toBe(200);
    const attributes = (await attributesResponse.json()).items as Array<{ attributeKey: string; name: string }>;
    expect(attributes.length).toBeGreaterThan(0);
    let attribute = attributes[0];
    let attributeImage: string | null = null;
    for (const candidate of attributes) {
      const response = await request.get(`${ADMIN}/attributes/${encodeURIComponent(candidate.attributeKey)}/representative-image`);
      expect(response.status()).toBe(200);
      const image = (await response.json()).image;
      if (image?.enabled) { attribute = candidate; attributeImage = image.imageKey; break; }
    }
    if (attributeImage && !imageData.some(image => image.imageKey === attributeImage)) {
      const response = await request.get(`${ADMIN}/images/${encodeURIComponent(attributeImage)}`);
      expect(response.status()).toBe(200);
      imageData.push(await response.json());
    }
    attributeCoverage = attributeImage ? `只读已有关联：${attribute.attributeKey}/${attributeImage}`
      : `现有 ${attributes.length} 个属性均无启用代表图片，只读验证 ${attribute.attributeKey} 的首列与未设置占位`;
    for (const fixture of fixtures) expect((await request.get(`${ADMIN}/${fixture.path}/${fixture.key}`)).status()).toBe(404);
    for (const fixture of fixtures) {
      owned.push(`${fixture.path}/${fixture.key}`);
      await checkpoint();
      const response = await request.post(`${ADMIN}/${fixture.path}`, { data: fixture.body });
      expect(response.status(), `创建 ${fixture.path}: ${await response.text()}`).toBe(201);
    }
    await page.addInitScript(apiBase => {
      localStorage.setItem('damage-viewer.web.api-base-url', apiBase);
      localStorage.setItem('damage-viewer.web.admin-token', 'local-stage9-table-placeholder');
    }, API);
    await page.goto('/#/characters');
    await expect(page.locator('.app-toolbar-field--game')).toContainText(GAME);
    // 只缓存上面从真实接口读回的图片，不改变服务器响应，也不读取全量图片。
    await page.evaluate(async images => {
      await new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open('image_db', 2);
        opening.onerror = () => reject(opening.error);
        opening.onupgradeneeded = () => {
          const database = opening.result;
          if (!database.objectStoreNames.contains('images')) {
            const store = database.createObjectStore('images', { keyPath: 'cacheKey' });
            store.createIndex('gameId', 'gameId', { unique: false });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        };
        opening.onsuccess = () => {
          const database = opening.result;
          const transaction = database.transaction('images', 'readwrite');
          const store = transaction.objectStore('images');
          for (const image of images) store.put({ cacheKey: `${image.gameId}:${image.imageKey}`, gameId: image.gameId,
            imageKey: image.imageKey, enabled: image.enabled, imageBase64: image.imageBase64, updatedAt: image.updatedAt });
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onerror = () => { database.close(); reject(transaction.error); };
        };
      });
    }, imageData);

    await navigate(page, 'attributes');
    await expect(page.getByRole('columnheader').first()).toHaveText('图片');
    const attributeCell = row(page, attribute.attributeKey).getByRole('cell').first();
    if (attributeImage) await expect(attributeCell.getByRole('img', { name: `${attribute.name}代表图片`, exact: true })).toBeVisible();
    else await expect(attributeCell).toHaveText('未设置');
    await expect.poll(() => centerIsUncovered(attributeCell.locator('.resource-image-thumb'))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('0-属性首列.png') });
    milestones.push(`属性：${attributeCoverage}`);
    for (const [index, source] of sources.entries()) {
      await navigate(page, source.route);
      const searchLabel = source.label === '技能效果' ? '技能' : source.label;
      await page.getByLabel(`${searchLabel}关键词`, { exact: true }).fill(source.label === '技能效果' ? keys.skill : source.key);
      await page.getByRole('button', { name: '查询', exact: true }).click();
      let scope: Page | Locator = page;
      if (source.label === '技能效果') {
        await row(page, keys.skill).getByRole('button', { name: '效果与结果', exact: true }).click();
        scope = modal(page, `效果与结果 - ${names.skill}`);
      }
      await expect(scope.getByRole('columnheader').first()).toHaveText('图片');
      const targetRow = row(scope, source.key);
      const firstCell = targetRow.getByRole('cell').first();
      await expect(firstCell).toHaveText('未设置');
      for (const image of imageData.slice(0, 2)) {
        await targetRow.getByRole('button', { name: '代表图片', exact: true }).click();
        const dialog = modal(page, `${source.name} · 代表图片`);
        await dialog.getByText('选择已有图片', { exact: true }).click();
        await dialog.getByLabel('搜索代表图片', { exact: true }).fill(image.imageKey);
        await dialog.getByRole('button', { name: '搜索图片', exact: true }).click();
        await dialog.getByLabel('选择代表图片', { exact: true }).click();
        await page.locator('.arco-select-option:visible').filter({ hasText: `（${image.imageKey}）` }).click();
        await dialog.getByRole('button', { name: '保存代表图片', exact: true }).click();
        await expect(dialog.getByText('代表图片已保存。', { exact: true })).toBeVisible();
        await close(dialog);
        const thumbnail = firstCell.getByRole('img', { name: `${source.name}代表图片`, exact: true });
        await expect(thumbnail).toBeVisible();
        await expect.poll(async () => sha256(await thumbnail.getAttribute('src') ?? '')).toBe(sha256(image.imageBase64));
        expect(await thumbnail.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await expect.poll(() => centerIsUncovered(thumbnail), `${source.label}图片中心不被固定操作列遮挡`).toBe(true);
      }
      const nameCell = targetRow.getByRole('cell').nth(1);
      await expect.poll(() => centerIsUncovered(nameCell), `${source.label}名称中心不被固定操作列遮挡`).toBe(true);
      const buttonLayout = await targetRow.getByRole('button').evaluateAll(buttons => {
        const boxes = buttons.map(button => button.getBoundingClientRect()).filter(box => box.width > 0 && box.height > 0);
        const rows = new Set(boxes.map(box => Math.round(box.top)));
        const overlap = boxes.some((box, index) => boxes.slice(index + 1).some(other =>
          Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1
          && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1));
        return { rows: rows.size, overlap };
      });
      expect(buttonLayout.overlap, `${source.label}操作按钮互不重叠`).toBe(false);
      if (source.label === '技能') expect(buttonLayout.rows).toBeGreaterThanOrEqual(2);
      layoutChecks.push({ source: source.label, viewportWidth: page.viewportSize()!.width,
        imageCenterUncovered: true, nameCenterUncovered: true, buttonRows: buttonLayout.rows, buttonsOverlap: buttonLayout.overlap });
      await page.screenshot({ path: testInfo.outputPath(`${index + 1}-${source.label}真实图片首列.png`) });
      await targetRow.getByRole('button', { name: '代表图片', exact: true }).click();
      const dialog = modal(page, `${source.name} · 代表图片`);
      page.once('dialog', prompt => prompt.accept());
      await dialog.getByRole('button', { name: '移除代表图片', exact: true }).click();
      await expect(dialog.getByText('尚未设置代表图片', { exact: true })).toBeVisible();
      await close(dialog);
      await expect(firstCell).toHaveText('未设置');
      if (source.label === '技能效果') await close(scope as Locator);
      milestones.push(`${source.label}首列真实图片显示；保存、替换、移除后无需刷新页面立即更新`);
      await checkpoint();
    }
    expect(errors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(requestFailures).toEqual([]);
    expect(requests.filter(item => item.status >= 400)).toEqual([]);
    expect(requests.filter(item => item.path === `/api/games/${GAME}/images`)).toEqual([]);
    expect(requests.filter(item => item.method !== 'GET' && /\/images(?:\/|$)/.test(item.path))).toEqual([]);
  } catch (cause) {
    primaryFailure = String(cause);
    throw cause;
  } finally {
    testInfo.setTimeout(testInfo.timeout + 60_000);
    const cleanupRequest = await playwrightRequest.newContext({ timeout: 10_000 });
    try {
      for (const source of sources) {
        if (!owned.includes(source.path)) continue;
        try {
          const response = await cleanupRequest.get(`${ADMIN}/${source.path}/representative-image`);
          if (response.status() === 404) continue;
          expect(response.status()).toBe(200);
          const image = (await response.json()).image;
          if (image) {
            expect(IMAGE_KEYS).toContain(image.imageKey);
            const deleted = await cleanupRequest.delete(`${ADMIN}/${source.path}/representative-image`);
            cleanup.push({ path: `${source.path}/representative-image`, status: deleted.status() });
            expect(deleted.status()).toBe(204);
          }
        } catch (cause) { cleanupProblems.push(`${source.path}: ${String(cause)}`); }
      }
      for (const path of [owned[0], owned[1], ...owned.slice(2).reverse()].filter(Boolean)) {
        try {
          const response = await cleanupRequest.get(`${ADMIN}/${path}`);
          if (response.status() === 404) continue;
          expect(response.status()).toBe(200);
          expect((await response.json()).description).toBe(DESCRIPTION);
          const deleted = await cleanupRequest.delete(`${ADMIN}/${path}`);
          cleanup.push({ path, status: deleted.status() });
          expect(deleted.status()).toBe(204);
          expect((await cleanupRequest.get(`${ADMIN}/${path}`)).status()).toBe(404);
        } catch (cause) { cleanupProblems.push(`${path}: ${String(cause)}`); }
      }
      for (const image of existingImages) {
        const response = await cleanupRequest.get(`${ADMIN}/images/${image.imageKey}`);
        expect(response.status()).toBe(200);
        expect(sha256((await response.json()).imageBase64)).toBe(image.imageBase64Sha256);
      }
    } finally {
      await cleanupRequest.dispose();
      await checkpoint();
    }
    await testInfo.attach('表格首列图片真实验收记录', { body: JSON.stringify(evidence(), null, 2), contentType: 'application/json' });
    console.log(JSON.stringify({ output: testInfo.outputPath('acceptance-summary.json'), requestCount: requests.length,
      browserWriteCount: requests.filter(item => item.method !== 'GET').length, milestones, errors, consoleErrors, requestFailures,
      cleanupProblems, primaryFailure }));
    if (!primaryFailure) expect(cleanupProblems).toEqual([]);
  }
});
