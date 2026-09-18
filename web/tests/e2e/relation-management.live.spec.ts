/**
 * 真实服务验收，无接口替身。手动运行：
 * $env:STAGE9_LIVE_ACCEPTANCE='1'; node node_modules/@playwright/test/cli.js test --config playwright.relations-live.config.ts
 * 若对象侧已有最终代码的有效证据，可再设置 STAGE9_LIVE_PHASE=image-usages 聚焦图片用途侧，产物另存目录。
 * 固定访问本机 5173/8080，使用本机已关闭鉴权的服务和非秘密占位令牌。
 * 仅创建指定前缀对象，退出时删除本次创建的精确键；属性无删除接口，由主负责人用精确 SQL 清理。
 * 不更改已有图片内容或启停状态。
 */
import { expect, request as playwrightRequest, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const API = 'http://127.0.0.1:8080';
const GAME = 'lol';
const ADMIN = `${API}/api/admin/games/${GAME}`;
const PREFIX = 'stage9_live_20260906';
const keys = {
  character: `${PREFIX}_character`, equipment: `${PREFIX}_equipment`, skill: `${PREFIX}_skill`,
  effect: `${PREFIX}_effect`, attribute: `${PREFIX}_attribute`, status: `${PREFIX}_status`
};
const names = { character: '阶段九实测角色', equipment: '阶段九实测装备', skill: '阶段九实测技能',
  effect: '阶段九实测效果', attribute: '阶段九实测属性', status: '阶段九实测状态' };
const IMAGE_A = 'attribute_ad';
const IMAGE_B = 'attribute_attack_speed';
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
const imagePath = (source: Source) => `${ADMIN}/${source.path ? `${source.path}/` : ''}representative-image`;

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
async function choose(page: Page, scope: Locator, label: string, option: string) {
  await scope.getByLabel(label, { exact: true }).click();
  const search = scope.getByLabel(label, { exact: true }).locator('input');
  if (await search.count() && await search.isVisible() && await search.isEditable()) await search.fill(option);
  await page.locator('.arco-select-option:visible').filter({ hasText: option }).click();
}
async function close(dialog: Locator) {
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function openUsages(page: Page, imageKey: string) {
  await navigate(page, 'images');
  await page.getByLabel('图片标识关键词', { exact: true }).fill(imageKey);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await row(page, imageKey).getByRole('button', { name: '用途关系', exact: true }).click();
  return modal(page, '图片用途关系');
}
async function openImage(page: Page, source: Source) {
  await navigate(page, source.route);
  if (source.group === '游戏') await page.getByRole('button', { name: '设置代表图片', exact: true }).click();
  else {
    if (source.group === '技能效果') {
      await row(page, keys.skill).getByRole('button', { name: '效果与结果', exact: true }).click();
    }
    await row(page, source.key).getByRole('button', { name: '代表图片', exact: true }).click();
  }
  return modal(page, `${source.name} · 代表图片`);
}
async function closeImage(page: Page, dialog: Locator, source: Source) {
  await close(dialog);
  if (source.group === '技能效果') await close(page.locator('.arco-modal:visible'));
}
async function selectImage(page: Page, dialog: Locator, imageKey: string) {
  await dialog.getByLabel('搜索代表图片', { exact: true }).fill(imageKey);
  await dialog.getByRole('button', { name: '搜索图片', exact: true }).click();
  await choose(page, dialog, '选择代表图片', `${imageKey}（${imageKey}）`);
}
async function readImage(request: APIRequestContext, source: Source) {
  const response = await request.get(imagePath(source));
  expect(response.status()).toBe(200);
  return (await response.json()).image?.imageKey ?? null;
}

test('stage 9 live: bidirectional mounts and all seven image sources', async ({ page, request }, testInfo) => {
  test.skip(process.env.STAGE9_LIVE_ACCEPTANCE !== '1', '必须显式设置 STAGE9_LIVE_ACCEPTANCE=1 才可操作本地实库。');
  const usagesOnly = process.env.STAGE9_LIVE_PHASE === 'image-usages';
  const owned: string[] = [];
  const requests: Array<{ method: string; path: string; status: number }> = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const milestones: string[] = [];
  const cleanup: Array<{ path: string; status: number }> = [];
  let gameTouched = false;
  let primaryFailure: string | null = null;
  let reuseOwnAttribute = false;
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => requestFailures.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) requests.push({ method: response.request().method(), path: url.pathname + url.search, status: response.status() });
  });
  const skillBody = { name: names.skill, description: '阶段九真实浏览器验收临时对象', maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: [] };
  const common = { description: '阶段九真实浏览器验收临时对象', status: 'ENABLED', sortOrder: 0 };
  const fixtures = [
    { path: 'characters', key: keys.character, body: { characterKey: keys.character, name: names.character, description: common.description } },
    { path: 'equipment', key: keys.equipment, body: { equipmentKey: keys.equipment, name: names.equipment, description: common.description } },
    { path: 'attributes', key: keys.attribute, body: { attributeKey: keys.attribute, name: names.attribute, valueType: 'DECIMAL', minValue: null, maxValue: null, ...common } },
    { path: 'statuses', key: keys.status, body: { statusKey: keys.status, statusKind: 'STUN', name: names.status, ...common } },
    { path: 'skills', key: keys.skill, body: { skillKey: keys.skill, ...skillBody } },
    { path: `skills/${keys.skill}/effects`, key: keys.effect, body: { effectKey: keys.effect, name: names.effect, description: common.description, sortOrder: 0, lifecycle: null, results: [{
      resultKey: `${PREFIX}_result`, name: '阶段九实测状态移除', target: 'SOURCE', description: null, sortOrder: 0,
      lifecycleBehavior: null, spellShieldBlockScope: null, resultType: 'STATUS_OPERATION', valueRule: null,
      detail: { statusKey: keys.status, operation: 'REMOVE' }
    }] } }
  ];
  try {
    expect(await readImage(request, sources[0])).toBeNull();
    for (const imageKey of [IMAGE_A, IMAGE_B]) {
      const image = await request.get(`${ADMIN}/images/${imageKey}`);
      expect(image.status()).toBe(200);
      expect((await image.json()).enabled).toBe(true);
    }
    for (const fixture of fixtures) {
      const exactPath = `${fixture.path}/${fixture.key}`;
      const prior = await request.get(`${ADMIN}/${exactPath}`);
      if (fixture.path === 'attributes' && prior.status() === 200) {
        const priorAttribute = await prior.json();
        expect(priorAttribute.name).toBe(names.attribute);
        expect(priorAttribute.description).toBe(common.description);
        reuseOwnAttribute = true;
      } else expect(prior.status(), `预备对象必须不存在：${exactPath}`).toBe(404);
    }
    for (const fixture of fixtures) {
      if (fixture.path === 'attributes' && reuseOwnAttribute) continue;
      owned.push(`${fixture.path}/${fixture.key}`);
      const response = await request.post(`${ADMIN}/${fixture.path}`, { data: fixture.body });
      expect(response.status(), `创建 ${fixture.path}: ${await response.text()}`).toBe(201);
    }
    await page.addInitScript(apiBase => {
      localStorage.setItem('damage-viewer.web.api-base-url', apiBase);
      localStorage.setItem('damage-viewer.web.admin-token', 'local-stage9-acceptance-placeholder');
    }, API);
    await page.goto('/#/characters');
    await expect(page.locator('.app-toolbar-field--game')).toContainText(GAME);
    let dialog: Locator;
    if (!usagesOnly) {
    for (const [route, key, name, ownerLabel, order] of [
      ['characters', keys.character, names.character, '角色', '9'],
      ['equipment', keys.equipment, names.equipment, '装备', '4']
    ]) {
      await navigate(page, route);
      await row(page, key).getByRole('button', { name: '关联技能', exact: true }).click();
      const dialog = modal(page, `关联技能 · ${name}`);
      await choose(page, dialog, `选择${ownerLabel}技能`, names.skill);
      await dialog.getByLabel(`${ownerLabel}新增排序`, { exact: true }).fill(order);
      await dialog.getByRole('button', { name: `添加${ownerLabel}挂载`, exact: true }).click();
      await expect(dialog.getByLabel(`${names.skill}排序`, { exact: true })).toHaveValue(order);
      await close(dialog);
    }
    await navigate(page, 'skills');
    await row(page, keys.skill).getByRole('button', { name: '挂载对象', exact: true }).click();
    dialog = modal(page, `挂载对象 · ${names.skill}`);
    await expect(dialog.getByLabel(`${names.character}排序`, { exact: true })).toHaveValue('9');
    await expect(dialog.getByLabel(`${names.equipment}排序`, { exact: true })).toHaveValue('4');
    await dialog.getByLabel(`${names.character}排序`, { exact: true }).fill('2');
    await row(dialog, keys.character).getByRole('button', { name: '保存排序', exact: true }).click();
    await expect(dialog.getByText('挂载顺序已保存。', { exact: true })).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath('01-skill-mounts.png') });
    await close(dialog);
    expect((await request.put(`${ADMIN}/skills/${keys.skill}`, { data: { ...skillBody, status: 'DISABLED' } })).status()).toBe(200);
    await row(page, keys.skill).getByRole('button', { name: '挂载对象', exact: true }).click();
    dialog = modal(page, `挂载对象 · ${names.skill}`);
    await expect(dialog.getByText('当前技能已停用，已有挂载仍可调整顺序或移除，不能新增挂载。')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '添加角色挂载', exact: true })).toBeDisabled();
    await dialog.getByLabel(`${names.equipment}排序`, { exact: true }).fill('3');
    await row(dialog, keys.equipment).getByRole('button', { name: '保存排序', exact: true }).click();
    await expect(dialog.getByText('挂载顺序已保存。', { exact: true })).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath('02-disabled-skill-mounts.png') });
    await row(dialog, keys.equipment).getByRole('button', { name: '移除', exact: true }).click();
    await expect(row(dialog, keys.equipment)).toHaveCount(0);
    await row(dialog, keys.character).getByRole('button', { name: '移除', exact: true }).click();
    await expect(row(dialog, keys.character)).toHaveCount(0);
    await close(dialog);
    for (const owner of ['character', 'equipment']) {
      const response = await request.get(`${ADMIN}/${owner}-skill-relations?skillKey=${keys.skill}`);
      expect((await response.json()).items).toEqual([]);
    }
    expect((await request.put(`${ADMIN}/skills/${keys.skill}`, { data: skillBody })).status()).toBe(200);
    milestones.push('真实页面完成角色和装备挂载、技能反查、排序、停用回读与移除');
    }

    await navigate(page, 'images');
    await page.getByLabel('图片标识关键词', { exact: true }).fill('attribute_');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.getByRole('button', { name: '全量同步', exact: true }).click();
    await expect(page.getByText(/全量同步完成，本次接收/)).toBeVisible({ timeout: 90_000 });
    if (usagesOnly) {
      expect([null, IMAGE_A], '仅复用本次自建属性的原图片或已清理状态').toContain(await readImage(request, sources[2]));
      for (const source of sources) {
        if (source.group === '游戏') gameTouched = true;
        const response = await request.put(imagePath(source), { data: { imageKey: IMAGE_A } });
        expect(response.status()).toBe(200);
      }
      milestones.push('聚焦用途阶段：通过真实API预备七类关系；设置/替换/回读的页面证据沿用上一轮目录');
    } else {
    for (const source of sources) {
      dialog = await openImage(page, source);
      await expect(dialog.getByText('尚未设置代表图片', { exact: true })).toBeVisible();
      await selectImage(page, dialog, IMAGE_A);
      if (source.group === '游戏') gameTouched = true;
      await dialog.getByRole('button', { name: '保存代表图片', exact: true }).click();
      await expect(dialog.getByText('代表图片已保存。', { exact: true })).toBeVisible();
      expect(await readImage(request, source)).toBe(IMAGE_A);
      {
        await selectImage(page, dialog, IMAGE_B);
        await dialog.getByRole('button', { name: '保存代表图片', exact: true }).click();
        await expect(dialog.getByText(`${IMAGE_B}（${IMAGE_B}）`, { exact: true })).toBeVisible();
        expect(await readImage(request, source)).toBe(IMAGE_B);
        await selectImage(page, dialog, IMAGE_A);
        await dialog.getByRole('button', { name: '保存代表图片', exact: true }).click();
        await expect(dialog.getByText(`${IMAGE_A}（${IMAGE_A}）`, { exact: true })).toBeVisible();
      }
      await closeImage(page, dialog, source);
      dialog = await openImage(page, source);
      await expect(dialog.getByText(`${IMAGE_A}（${IMAGE_A}）`, { exact: true })).toBeVisible();
      if (source.group === '技能效果') await dialog.screenshot({ path: testInfo.outputPath('03-effect-representative-image.png') });
      await closeImage(page, dialog, source);
    }
    milestones.push('七类来源均通过真实页面设置、替换并重新打开回读');
    }
    dialog = await openUsages(page, IMAGE_A);
    for (const source of sources) await expect(dialog.getByRole('region', { name: `${source.group}图片用途`, exact: true })).toContainText(source.name);
    await dialog.screenshot({ path: testInfo.outputPath('04-seven-image-usages.png') });
    await close(dialog);
    dialog = await openUsages(page, IMAGE_B);
    await choose(page, dialog, '图片来源类别', '角色');
    await choose(page, dialog, '图片来源对象', names.character);
    page.once('dialog', prompt => prompt.accept());
    await dialog.getByRole('button', { name: '设置此图片', exact: true }).click();
    await expect(dialog.getByRole('region', { name: '角色图片用途', exact: true })).toContainText(names.character);
    expect(await readImage(request, sources[1])).toBe(IMAGE_B);
    await dialog.screenshot({ path: testInfo.outputPath('05-image-side-replacement.png') });
    page.once('dialog', prompt => prompt.accept());
    await dialog.getByRole('region', { name: '角色图片用途', exact: true }).getByRole('row').filter({ hasText: keys.character })
      .getByRole('button', { name: '移除关系', exact: true }).click();
    await expect.poll(() => readImage(request, sources[1])).toBeNull();
    await close(dialog);
    dialog = await openImage(page, sources[1]);
    await expect(dialog.getByText('尚未设置代表图片', { exact: true })).toBeVisible();
    await close(dialog);
    dialog = await openUsages(page, IMAGE_A);
    for (const source of sources.filter(item => item.group !== '角色')) {
      const group = dialog.getByRole('region', { name: `${source.group}图片用途`, exact: true });
      page.once('dialog', prompt => prompt.accept());
      await group.getByRole('row').filter({ hasText: source.key }).getByRole('button', { name: '移除关系', exact: true }).click();
      await expect.poll(() => readImage(request, source)).toBeNull();
    }
    await close(dialog);
    for (const source of sources) expect(await readImage(request, source)).toBeNull();
    const games = await request.get(`${API}/api/games`);
    expect((await games.json()).find((game: { gameId: string }) => game.gameId === GAME).representativeImageKey).toBeNull();
    milestones.push('图片侧七类反查、替换与逐类移除成立；来源侧回读为空，游戏封面恢复为空');
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(requestFailures).toEqual([]);
    expect(requests.filter(item => item.status >= 400)).toEqual([]);
    expect(requests.filter(item => /combat-data|skill-mounts|versions\/current/.test(item.path))).toEqual([]);
  } catch (cause) {
    primaryFailure = String(cause);
    throw cause;
  } finally {
    testInfo.setTimeout(testInfo.timeout + 60_000);
    const cleanupRequest = await playwrightRequest.newContext({ timeout: 10_000 });
    const cleanupProblems: string[] = [];
    try {
    if (gameTouched) {
      const current = await readImage(cleanupRequest, sources[0]);
      if (current === IMAGE_A || current === IMAGE_B) {
        const response = await cleanupRequest.delete(imagePath(sources[0]));
        cleanup.push({ path: 'representative-image', status: response.status() });
        expect(response.status()).toBe(204);
      } else expect(current, '游戏封面被其他会话改动时不可覆盖').toBeNull();
    }
    } catch (cause) { cleanupProblems.push(String(cause)); }
    try {
      const attributeImage = await readImage(cleanupRequest, sources[2]);
      if (attributeImage === IMAGE_A || attributeImage === IMAGE_B) {
        const response = await cleanupRequest.delete(imagePath(sources[2]));
        cleanup.push({ path: `${sources[2].path}/representative-image`, status: response.status() });
        expect(response.status()).toBe(204);
      } else expect(attributeImage).toBeNull();
    } catch (cause) { cleanupProblems.push(String(cause)); }
    // 先删除本次创建的角色和装备，使技能挂载按外键清理；再删效果与技能等对象。
    const cleanupOrder = [owned[0], owned[1], ...owned.slice(2).reverse()]
      .filter((path): path is string => Boolean(path) && !path.startsWith('attributes/'));
    for (const path of cleanupOrder) {
      try {
      const response = await cleanupRequest.delete(`${ADMIN}/${path}`);
      cleanup.push({ path, status: response.status() });
      expect([204, 404], `清理临时对象 ${path}`).toContain(response.status());
      expect((await cleanupRequest.get(`${ADMIN}/${path}`)).status()).toBe(404);
      } catch (cause) { cleanupProblems.push(`${path}: ${String(cause)}`); }
    }
    await cleanupRequest.dispose();
    const summary = { api: API, game: GAME, temporaryPrefix: PREFIX, phase: usagesOnly ? 'image-usages' : 'all', milestones,
      browserRequestCount: requests.length, browserWriteCount: requests.filter(item => item.method !== 'GET').length,
      consoleErrors, pageErrors, requestFailures, requests, cleanup, cleanupProblems, primaryFailure,
      attributeCleanup: { path: `attributes/${keys.attribute}`, action: '无删除接口，由主负责人精确 SQL 清理本次临时属性' } };
    await testInfo.attach('真实浏览器验收记录', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
    await mkdir(testInfo.outputDir, { recursive: true });
    await writeFile(testInfo.outputPath('acceptance-summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ ...summary, requests: undefined }));
    if (!primaryFailure) expect(cleanupProblems, '具有删除接口的本次临时对象均须清理').toEqual([]);
  }
});
