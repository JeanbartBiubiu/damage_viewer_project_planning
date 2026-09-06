/**
 * 真实对象侧直接上传验收，不拦截或替代任何接口。
 * 手动执行：设置 STAGE9_UPLOAD_LIVE_ACCEPTANCE=1，随后
 * node node_modules/@playwright/test/cli.js test --config playwright.image-upload-live.config.ts
 * 本机 5173/8080；服务已关闭本地鉴权，只使用非秘密占位令牌。
 * 对象与关系由 finally 精确清理。图片和属性没有删除接口，主负责人按 assets-manifest.json 精确清理数据库。
 */
import { expect, request as playwrightRequest, test, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const API = 'http://127.0.0.1:8080';
const GAME = 'lol';
const ADMIN = `${API}/api/admin/games/${GAME}`;
const PREFIX = 'stage9_upload_20260906';
const DESCRIPTION = '阶段九对象侧直接上传真实验收临时对象';
const keys = {
  character: `${PREFIX}_character`, equipment: `${PREFIX}_equipment`, skill: `${PREFIX}_skill`,
  effect: `${PREFIX}_effect`, attribute: `${PREFIX}_attribute`, status: `${PREFIX}_status`
};
const names = {
  character: '阶段九上传实测角色', equipment: '阶段九上传实测装备', skill: '阶段九上传实测技能',
  effect: '阶段九上传实测效果', attribute: '阶段九上传实测属性', status: '阶段九上传实测状态'
};
type Source = { route: string; key: string; name: string; group: string; path: string };
const sources: Source[] = [
  { route: 'game-settings', key: GAME, name: GAME, group: '游戏', path: '' },
  { route: 'characters', key: keys.character, name: names.character, group: '角色', path: `characters/${keys.character}` },
  { route: 'attributes', key: keys.attribute, name: names.attribute, group: '属性', path: `attributes/${keys.attribute}` },
  { route: 'equipment', key: keys.equipment, name: names.equipment, group: '装备', path: `equipment/${keys.equipment}` },
  { route: 'skills', key: keys.skill, name: names.skill, group: '技能', path: `skills/${keys.skill}` },
  { route: 'skills', key: keys.effect, name: names.effect, group: '技能效果', path: `skills/${keys.skill}/effects/${keys.effect}` },
  { route: 'statuses', key: keys.status, name: names.status, group: '状态', path: `statuses/${keys.status}` }
];
type ImageAsset = { gameId: string; imageKey: string; name: string; createdAt: string; imageBase64Sha256: string; mimeType: string; source: string };
type ImageAttempt = { gameId: string; imageKey: string; name: string; imageBase64Sha256: string; source: string; status: number | null };
type RequestEvidence = { method: string; path: string; status: number };
const imagePath = (source: Source) => `${ADMIN}/${source.path ? `${source.path}/` : ''}representative-image`;
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function row(scope: Page | Locator, key: string) {
  const page = 'page' in scope ? scope.page() : scope;
  return scope.getByRole('row').filter({ has: page.getByRole('cell', { name: key, exact: true }) });
}
function modal(page: Page, title: string) {
  return page.locator('.arco-modal:visible').filter({ has: page.locator('.arco-modal-title', { hasText: title }) });
}
async function navigate(page: Page, route: string) {
  await page.evaluate(hash => { window.location.hash = `#/${hash}`; }, route);
  await expect(page).toHaveURL(new RegExp(`#/${route}$`));
}
async function close(dialog: Locator) {
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function openImage(page: Page, source: Source) {
  await navigate(page, source.route);
  if (source.group === '游戏') await page.getByRole('button', { name: '设置代表图片', exact: true }).click();
  else {
    if (source.group === '技能效果') await row(page, keys.skill).getByRole('button', { name: '效果与结果', exact: true }).click();
    await row(page, source.key).getByRole('button', { name: '代表图片', exact: true }).click();
  }
  return modal(page, `${source.name} · 代表图片`);
}
async function closeImage(page: Page, dialog: Locator, source: Source) {
  await close(dialog);
  if (source.group === '技能效果') await close(page.locator('.arco-modal:visible'));
}
async function readImageKey(request: APIRequestContext, source: Source) {
  const response = await request.get(imagePath(source));
  expect(response.status()).toBe(200);
  return (await response.json()).image?.imageKey ?? null;
}
async function pngOrJpegFile(page: Page, testInfo: TestInfo, seed: number) {
  const mimeType = seed % 2 === 0 ? 'image/png' : 'image/jpeg';
  const dataUrl = await page.evaluate(({ seed, mimeType }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d')!;
    context.fillStyle = `hsl(${seed * 43}, 70%, 45%)`;
    context.fillRect(0, 0, 32, 32);
    context.fillStyle = '#fff';
    context.fillRect(3 + seed % 7, 5, 7, 21);
    context.fillRect(5, 10 + seed % 5, 23, 4);
    return canvas.toDataURL(mimeType, 0.92);
  }, { seed, mimeType });
  const path = testInfo.outputPath(`source-${seed}.${mimeType === 'image/png' ? 'png' : 'jpg'}`);
  await writeFile(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  return { path, mimeType, imageBase64Sha256: sha256(dataUrl) };
}

test('live: upload and associate from seven object pages without editing image identity', async ({ page, request }, testInfo) => {
  test.skip(process.env.STAGE9_UPLOAD_LIVE_ACCEPTANCE !== '1', '必须显式设置 STAGE9_UPLOAD_LIVE_ACCEPTANCE=1 才操作本地实库。');
  const outputRoot = resolve('output/playwright-image-upload-live');
  await mkdir(outputRoot, { recursive: true });
  await mkdir(testInfo.outputDir, { recursive: true });
  const images: ImageAsset[] = [];
  const attempts: ImageAttempt[] = [];
  const requests: RequestEvidence[] = [];
  const ownedObjects: string[] = [];
  const cleanup: Array<{ path: string; status: number }> = [];
  const milestones: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const observerProblems: string[] = [];
  const cleanupProblems: string[] = [];
  const observerTasks: Promise<void>[] = [];
  let writeChain = Promise.resolve();
  let currentSource = '';
  let gameTouched = false;
  let reuseOwnAttribute = false;
  let primaryFailure: string | null = null;
  const manifest = () => ({
    api: API, gameId: GAME, temporaryPrefix: PREFIX, gameRepresentativeBaseline: null,
    attribute: { gameId: GAME, attributeKey: keys.attribute, name: names.attribute, description: DESCRIPTION },
    images, attempts, ownedObjects, cleanup, milestones, cleanupProblems, observerProblems, primaryFailure,
    browserRequestCount: requests.length, browserWriteCount: requests.filter(item => item.method !== 'GET').length,
    requests, consoleErrors, pageErrors, requestFailures
  });
  const checkpoint = () => {
    const body = JSON.stringify(manifest(), null, 2);
    writeChain = writeChain.then(async () => {
      await writeFile(resolve(outputRoot, 'assets-manifest.json'), body);
      await writeFile(testInfo.outputPath('assets-manifest.json'), body);
    });
    return writeChain;
  };
  const recordImage = (value: Record<string, unknown>, attempt: ImageAttempt) => {
    expect(value.gameId).toBe(GAME);
    expect(value.imageKey).toBe(attempt.imageKey);
    expect(value.name).toBe(attempt.name);
    expect(typeof value.imageBase64).toBe('string');
    expect(sha256(String(value.imageBase64))).toBe(attempt.imageBase64Sha256);
    expect(typeof value.createdAt).toBe('string');
    if (!images.some(item => item.imageKey === value.imageKey)) images.push({
      gameId: GAME, imageKey: String(value.imageKey), name: String(value.name), createdAt: String(value.createdAt),
      imageBase64Sha256: attempt.imageBase64Sha256, mimeType: String(value.mimeType), source: attempt.source
    });
  };
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => requestFailures.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on('request', request => {
    if (request.method() !== 'POST' || request.url() !== `${ADMIN}/images`) return;
    const body = request.postDataJSON();
    attempts.push({ gameId: GAME, imageKey: body.imageKey, name: body.name,
      imageBase64Sha256: sha256(body.imageBase64), source: currentSource, status: null });
    void checkpoint();
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/')) return;
    const method = response.request().method();
    requests.push({ method, path: url.pathname + url.search, status: response.status() });
    if (method !== 'POST' || response.url() !== `${ADMIN}/images`) return;
    const task = (async () => {
      const requestBody = response.request().postDataJSON();
      const attempt = attempts.find(item => item.imageKey === requestBody.imageKey)!;
      attempt.status = response.status();
      if (response.status() === 201) recordImage(await response.json(), attempt);
      await checkpoint();
    })().catch(cause => { observerProblems.push(String(cause)); });
    observerTasks.push(task);
  });
  await checkpoint();
  const common = { description: DESCRIPTION, status: 'ENABLED', sortOrder: 0 };
  const fixtures = [
    { path: 'characters', key: keys.character, body: { characterKey: keys.character, name: names.character, description: DESCRIPTION } },
    { path: 'equipment', key: keys.equipment, body: { equipmentKey: keys.equipment, name: names.equipment, description: DESCRIPTION } },
    { path: 'attributes', key: keys.attribute, body: { attributeKey: keys.attribute, name: names.attribute, valueType: 'DECIMAL', minValue: null, maxValue: null, ...common } },
    { path: 'statuses', key: keys.status, body: { statusKey: keys.status, name: names.status, ...common } },
    { path: 'skills', key: keys.skill, body: { skillKey: keys.skill, name: names.skill, maxLevel: 1, skillCategoryKeys: [], ...common } },
    { path: `skills/${keys.skill}/effects`, key: keys.effect, body: { effectKey: keys.effect, name: names.effect,
      description: DESCRIPTION, sortOrder: 0, lifecycle: null, results: [{ resultKey: `${PREFIX}_result`, name: '上传验收状态移除',
        target: 'SOURCE', description: null, sortOrder: 0, lifecycleBehavior: null, spellShieldBlockScope: null,
        resultType: 'STATUS_OPERATION', valueRule: null, detail: { statusKey: keys.status, operation: 'REMOVE' } }] } }
  ];
  const upload = async (source: Source, seed: number) => {
    const dialog = await openImage(page, source);
    await expect(dialog.getByRole('radio', { name: '上传新图片', exact: true })).toBeChecked();
    await expect(dialog.getByLabel('选择图片文件', { exact: true })).toBeEnabled();
    await expect(dialog.getByLabel('图片标识', { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel('图片名称', { exact: true })).toHaveCount(0);
    const assetFile = await pngOrJpegFile(page, testInfo, seed);
    currentSource = `${source.group}:${source.key}`;
    await dialog.getByLabel('选择图片文件', { exact: true }).setInputFiles(assetFile.path);
    await expect(dialog.getByRole('img', { name: `${source.name}待上传代表图片`, exact: true })).toBeVisible();
    const createResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${ADMIN}/images`);
    if (source.group === '游戏') gameTouched = true;
    await dialog.getByRole('button', { name: '上传并使用', exact: true }).click();
    const response = await createResponse;
    expect(response.status()).toBe(201);
    const created = await response.json();
    const attempt = attempts.find(item => item.imageKey === created.imageKey)!;
    recordImage(created, attempt);
    await checkpoint();
    expect(created.imageKey).toMatch(/^image_[0-9a-f-]{36}$/i);
    expect(created.name).toContain(`${source.name}代表图片`);
    expect(created.mimeType).toBe(assetFile.mimeType);
    expect(sha256(created.imageBase64)).toBe(assetFile.imageBase64Sha256);
    await expect(dialog.getByText('代表图片已上传并保存。', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('img', { name: `${source.name}代表图片`, exact: true })).toBeVisible();
    await expect(dialog.getByText(created.imageKey, { exact: false })).toHaveCount(0);
    expect(await readImageKey(request, source)).toBe(created.imageKey);
    await dialog.screenshot({ path: testInfo.outputPath(`${seed}-${source.group}-upload.png`) });
    await closeImage(page, dialog, source);
    const reopened = await openImage(page, source);
    await expect(reopened.getByRole('img', { name: `${source.name}代表图片`, exact: true })).toBeVisible();
    expect(await readImageKey(request, source)).toBe(created.imageKey);
    await closeImage(page, reopened, source);
    milestones.push(`${source.group}完成真实${assetFile.mimeType}直接上传、自动关联、缓存预览及重开回读`);
    await checkpoint();
    return images.find(item => item.imageKey === created.imageKey)!;
  };
  try {
    expect(await readImageKey(request, sources[0])).toBeNull();
    for (const fixture of fixtures) {
      const response = await request.get(`${ADMIN}/${fixture.path}/${fixture.key}`);
      if (fixture.path === 'attributes' && response.status() === 200) {
        const existing = await response.json();
        expect(existing.name).toBe(names.attribute);
        expect(existing.description).toBe(DESCRIPTION);
        reuseOwnAttribute = true;
      } else expect(response.status(), `预备对象必须不存在：${fixture.key}`).toBe(404);
    }
    for (const fixture of fixtures) {
      ownedObjects.push(`${fixture.path}/${fixture.key}`);
      await checkpoint();
      if (fixture.path === 'attributes' && reuseOwnAttribute) continue;
      const response = await request.post(`${ADMIN}/${fixture.path}`, { data: fixture.body });
      expect(response.status(), `创建 ${fixture.path}: ${await response.text()}`).toBe(201);
    }
    await page.addInitScript(apiBase => {
      localStorage.setItem('damage-viewer.web.api-base-url', apiBase);
      localStorage.setItem('damage-viewer.web.admin-token', 'local-stage9-upload-placeholder');
    }, API);
    await page.goto('/#/characters');
    await expect(page.locator('.app-toolbar-field--game')).toContainText(GAME);
    const uploaded = new Map<string, ImageAsset>();
    for (const [index, source] of sources.entries()) uploaded.set(source.key, await upload(source, index));

    const originalCharacterImage = uploaded.get(keys.character)!;
    expect((await request.put(imagePath(sources[3]), { data: { imageKey: originalCharacterImage.imageKey } })).status()).toBe(200);
    expect(await readImageKey(request, sources[3])).toBe(originalCharacterImage.imageKey);
    const replacement = await upload(sources[1], 8);
    expect(replacement.imageKey).not.toBe(originalCharacterImage.imageKey);
    expect(replacement.imageBase64Sha256).not.toBe(originalCharacterImage.imageBase64Sha256);
    expect(await readImageKey(request, sources[3])).toBe(originalCharacterImage.imageKey);
    const originalImage = await request.get(`${ADMIN}/images/${originalCharacterImage.imageKey}`);
    expect(originalImage.status()).toBe(200);
    expect(sha256((await originalImage.json()).imageBase64)).toBe(originalCharacterImage.imageBase64Sha256);
    const equipmentDialog = await openImage(page, sources[3]);
    await expect(equipmentDialog.getByRole('img', { name: `${names.equipment}代表图片`, exact: true })).toBeVisible();
    await close(equipmentDialog);
    milestones.push('共享旧图后角色再次上传创建新图，装备仍引用旧图，旧图内容哈希保持不变');

    await navigate(page, 'images');
    await expect(page.getByText(/共 8 条本地缓存图片/)).toBeVisible();
    await page.getByLabel('图片标识关键词', { exact: true }).fill(replacement.imageKey);
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await row(page, replacement.imageKey).getByRole('button', { name: '用途关系', exact: true }).click();
    let usages = modal(page, '图片用途关系');
    await expect(usages.getByRole('region', { name: '角色图片用途', exact: true })).toContainText(names.character);
    await expect(usages.getByRole('region', { name: '装备图片用途', exact: true })).not.toContainText(names.equipment);
    await usages.screenshot({ path: testInfo.outputPath('09-uploaded-image-usages.png') });
    await close(usages);
    await page.getByLabel('图片标识关键词', { exact: true }).fill(originalCharacterImage.imageKey);
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await row(page, originalCharacterImage.imageKey).getByRole('button', { name: '用途关系', exact: true }).click();
    usages = modal(page, '图片用途关系');
    await expect(usages.getByRole('region', { name: '装备图片用途', exact: true })).toContainText(names.equipment);
    await expect(usages.getByRole('region', { name: '角色图片用途', exact: true })).not.toContainText(names.character);
    await close(usages);
    milestones.push('无需全量同步，8张新图自动进入当前游戏缓存；图片侧反查新旧图用途一致');
    await Promise.all(observerTasks);
    expect(images).toHaveLength(8);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(requestFailures).toEqual([]);
    expect(observerProblems).toEqual([]);
    expect(requests.filter(item => item.status >= 400)).toEqual([]);
    expect(requests.filter(item => item.path === `/api/games/${GAME}/images`)).toEqual([]);
    expect(requests.filter(item => item.method === 'PUT' && new RegExp(`/images/[^/]+$`).test(item.path))).toEqual([]);
    expect(requests.filter(item => /combat-data|skill-mounts|versions\/current/.test(item.path))).toEqual([]);
  } catch (cause) {
    primaryFailure = String(cause);
    throw cause;
  } finally {
    testInfo.setTimeout(testInfo.timeout + 60_000);
    await Promise.allSettled(observerTasks);
    await checkpoint();
    const cleanupRequest = await playwrightRequest.newContext({ timeout: 10_000 });
    try {
      for (const attempt of attempts) {
        if (images.some(item => item.imageKey === attempt.imageKey)) continue;
        try {
          const response = await cleanupRequest.get(`${ADMIN}/images/${encodeURIComponent(attempt.imageKey)}`);
          if (response.status() === 200) recordImage(await response.json(), attempt);
          else expect(response.status()).toBe(404);
        } catch (cause) { cleanupProblems.push(`补查图片 ${attempt.imageKey}: ${String(cause)}`); }
        await checkpoint();
      }
      for (const source of sources) {
        if (source.group === '游戏' && !gameTouched) continue;
        if (source.group !== '游戏' && !ownedObjects.includes(source.path)) continue;
        try {
          const response = await cleanupRequest.get(imagePath(source));
          if (response.status() === 404) continue;
          expect(response.status()).toBe(200);
          const current = (await response.json()).image?.imageKey ?? null;
          if (current !== null) {
            expect(images.some(item => item.imageKey === current), `只能清理本次图片关系 ${source.path}`).toBe(true);
            const deleted = await cleanupRequest.delete(imagePath(source));
            cleanup.push({ path: `${source.path || GAME}/representative-image`, status: deleted.status() });
            expect(deleted.status()).toBe(204);
          }
          expect(await readImageKey(cleanupRequest, source)).toBeNull();
        } catch (cause) { cleanupProblems.push(`清理关系 ${source.path}: ${String(cause)}`); }
        await checkpoint();
      }
      const ordered = [ownedObjects[0], ownedObjects[1], ...ownedObjects.slice(2).reverse()]
        .filter((path): path is string => Boolean(path) && !path.startsWith('attributes/'));
      for (const path of ordered) {
        try {
          const current = await cleanupRequest.get(`${ADMIN}/${path}`);
          if (current.status() === 404) continue;
          expect(current.status()).toBe(200);
          expect((await current.json()).description).toBe(DESCRIPTION);
          const response = await cleanupRequest.delete(`${ADMIN}/${path}`);
          cleanup.push({ path, status: response.status() });
          expect(response.status()).toBe(204);
          expect((await cleanupRequest.get(`${ADMIN}/${path}`)).status()).toBe(404);
        } catch (cause) { cleanupProblems.push(`清理对象 ${path}: ${String(cause)}`); }
        await checkpoint();
      }
    } finally {
      await cleanupRequest.dispose();
      await checkpoint();
    }
    await testInfo.attach('直接上传真实验收与精确清理清单', { body: JSON.stringify(manifest(), null, 2), contentType: 'application/json' });
    console.log(JSON.stringify({ manifest: resolve(outputRoot, 'assets-manifest.json'), imageCount: images.length,
      browserRequestCount: requests.length, browserWriteCount: requests.filter(item => item.method !== 'GET').length,
      milestones, consoleErrors, pageErrors, requestFailures, observerProblems, cleanupProblems, primaryFailure }));
    if (!primaryFailure) expect(cleanupProblems, '本次关系与支持删除的临时对象均应清理').toEqual([]);
  }
});
