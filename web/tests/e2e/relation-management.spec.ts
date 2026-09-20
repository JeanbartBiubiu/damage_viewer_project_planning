/**
 * 阶段 9 的有状态桌面浏览器回归。接口全部由当前文件替代，不能作为实库验收证据。
 * 两端入口共享同一份替身状态，验证的是页面请求、交互、回读与游戏隔离。
 */
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const API = 'http://127.0.0.1:19081';
const FIRST_GAME = 'relation_demo';
const SECOND_GAME = 'relation_other';
const NOW = '2026-09-06T08:00:00Z';
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1cAAAAASUVORK5CYII=';
type Json = Record<string, unknown>;
type Row = Json & { name: string };
type Mount = { gameId: string; kind: 'character' | 'equipment' | 'rune'; ownerKey: string; skillKey: string; sortOrder: number };
type Failure = { status: number; code: string; message: string; field: string };

function catalogs(gameId: string): Record<string, Row[]> {
  const common = { gameId, description: null, createdAt: NOW, updatedAt: NOW };
  const enabled = { ...common, status: 'ENABLED', sortOrder: 0 };
  const prefix = gameId === FIRST_GAME ? '' : '另一游戏';
  return {
    characters: [
      { ...common, characterKey: 'hero_a', name: `${prefix}角色甲` },
      { ...common, characterKey: 'hero_b', name: `${prefix}角色乙` }
    ],
    equipment: [{ ...common, equipmentKey: 'blade', name: `${prefix}装备甲` }],
    runes: [],
    'rune-paths': [],
    attributes: [{ ...enabled, attributeKey: 'attack', name: `${prefix}攻击属性`, valueType: 'DECIMAL', minValue: 0, maxValue: null }],
    skills: [
      { ...enabled, skillKey: 'strike', name: `${prefix}打击技能`, maxLevel: 5, skillCategoryKeys: [] },
      { ...enabled, skillKey: 'guard', name: `${prefix}守护技能`, maxLevel: 5, skillCategoryKeys: [] },
      { ...enabled, skillKey: 'disabled_skill', name: `${prefix}停用技能`, status: 'DISABLED', maxLevel: 5, skillCategoryKeys: [] }
    ],
    statuses: [{ ...enabled, statusKey: 'stun', statusKind: 'STUN', name: `${prefix}眩晕状态` }],
    'skill-categories': [],
    'damage-types': [],
    'modifier-zones': [],
    images: [
      { ...common, imageKey: 'portrait_a', name: `${prefix}图片甲`, enabled: true, imageBase64: IMAGE, mimeType: 'image/png', byteSize: 68, width: 1, height: 1 },
      { ...common, imageKey: 'portrait_b', name: `${prefix}图片乙`, enabled: true, imageBase64: IMAGE, mimeType: 'image/png', byteSize: 68, width: 1, height: 1 },
      { ...common, imageKey: 'disabled_image', name: `${prefix}停用图片`, enabled: false, imageBase64: IMAGE, mimeType: 'image/png', byteSize: 68, width: 1, height: 1 }
    ]
  };
}

const KEY_FIELDS: Record<string, string> = {
  characters: 'characterKey', equipment: 'equipmentKey', attributes: 'attributeKey',
  runes: 'runeKey', 'rune-paths': 'pathKey',
  skills: 'skillKey', statuses: 'statusKey', images: 'imageKey'
};

class RelationApi {
  rows: Record<string, Record<string, Row[]>> = { [FIRST_GAME]: catalogs(FIRST_GAME), [SECOND_GAME]: catalogs(SECOND_GAME) };
  mounts: Mount[] = [];
  representatives = new Map<string, string>();
  writes: Array<{ method: string; path: string; body: Json }> = [];
  unexpected: string[] = [];
  mountFailure: Failure | null = null;
  imageFailure: Failure | null = null;
  imageCreateFailure: Failure | null = null;
  runePathFailure: Failure | null = null;
  runeDetailFailure: Failure | null = null;
  runeListReads = 0;
  heldOptions: { started: boolean; promise: Promise<void> } | null = null;

  sourceId(gameId: string, source: string) { return `${gameId}/${source}`; }
  sourceImage(gameId: string, source: string) { return this.representatives.get(this.sourceId(gameId, source)); }
  row(gameId: string, resource: string, key: string) {
    return this.rows[gameId]![resource]!.find(item => item[KEY_FIELDS[resource]!] === key)!;
  }
  effect(gameId: string, skillKey: string) {
    return { gameId, skillKey, effectKey: 'shared_effect', name: '同名效果', description: null,
      sortOrder: 0, resultCount: 0, lifecycle: null, results: [], createdAt: NOW, updatedAt: NOW };
  }
  async install(page: Page) {
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== API) {
        this.unexpected.push(`${route.request().method()} ${url.href}`);
        await route.abort();
        return;
      }
      await this.dispatch(route, url);
    });
  }
  async json(route: Route, data: unknown, status = 200) {
    await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(data) });
  }
  async error(route: Route, failure: Failure) {
    await this.json(route, { error: { code: failure.code, message: failure.message,
      details: { fieldIssues: [{ field: failure.field, code: 'INVALID', message: failure.message }] } } }, failure.status);
  }
  mountResponse(mount: Mount): Json {
    const ownerResource = mount.kind === 'character' ? 'characters' : mount.kind === 'rune' ? 'runes' : 'equipment';
    const skill = this.row(mount.gameId, 'skills', mount.skillKey);
    return { gameId: mount.gameId, [`${mount.kind}Key`]: mount.ownerKey,
      [`${mount.kind}Name`]: this.row(mount.gameId, ownerResource, mount.ownerKey).name,
      skillKey: mount.skillKey, skillName: skill.name, skillStatus: skill.status, sortOrder: mount.sortOrder };
  }
  usages(gameId: string, imageKey: string) {
    const response: Json = { imageKey, games: [], characters: [], attributes: [], equipment: [], skills: [], skillEffects: [], statuses: [], runes: [], runePaths: [] };
    for (const [identity, currentImage] of this.representatives) {
      if (currentImage !== imageKey || !identity.startsWith(`${gameId}/`)) continue;
      const source = identity.slice(gameId.length + 1);
      const [resource, key, effects, effectKey] = source.split('/');
      if (!source) {
        (response.games as Json[]).push({ gameId, gameName: gameId === FIRST_GAME ? '关联验收游戏' : '另一个游戏' });
      } else if (resource === 'skills' && effects === 'effects') {
        (response.skillEffects as Json[]).push({ skillKey: key, skillName: this.row(gameId, 'skills', key!).name,
          effectKey, effectName: '同名效果' });
      } else {
        const row = this.row(gameId, resource!, key!);
        const field = KEY_FIELDS[resource!]!;
        const noun = field.slice(0, -3);
        const item: Json = { [field]: key, [`${noun}Name`]: row.name };
        if ('status' in row) item[`${noun}Status`] = row.status;
        (response[resource === 'rune-paths' ? 'runePaths' : resource!] as Json[]).push(item);
      }
    }
    return response;
  }

  async dispatch(route: Route, url: URL) {
    const request = route.request();
    const method = request.method();
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (method === 'GET' && url.pathname === '/api/games') {
      await this.json(route, [FIRST_GAME, SECOND_GAME].map(gameId => ({ gameId,
        gameName: gameId === FIRST_GAME ? '关联验收游戏' : '另一个游戏',
        representativeImageKey: this.sourceImage(gameId, '') ?? null })));
      return;
    }
    if (method === 'GET' && segments[1] === 'games' && segments[3] === 'images') {
      const gameId = segments[2]!;
      await this.json(route, { gameId, images: this.rows[gameId]!.images!.map(row => ({
        imageKey: row.imageKey, enabled: row.enabled, imageBase64: row.enabled ? row.imageBase64 : null, updatedAt: row.updatedAt
      })) });
      return;
    }
    if (segments[1] !== 'admin' || segments[2] !== 'games' || !this.rows[segments[3]!]) {
      this.unexpected.push(`${method} ${url.pathname}`);
      await this.json(route, {}, 500);
      return;
    }
    const gameId = segments[3]!;
    const tail = segments.slice(4);
    const resource = tail[0]!;
    const body = ['POST', 'PUT'].includes(method) ? request.postDataJSON() as Json : {};
    if (method !== 'GET') this.writes.push({ method, path: url.pathname, body });

    if (resource === 'level-config' && method === 'GET') {
      await this.json(route, { gameId, minLevel: 1, maxLevel: 2 });
      return;
    }
    if (resource === 'image-options' && method === 'GET') {
      const keyword = url.searchParams.get('keyword')!;
      expect(keyword.trim().length).toBeGreaterThan(0);
      const items = this.rows[gameId]!.images!
        .filter(row => row.enabled && (row.name.includes(keyword) || String(row.imageKey).includes(keyword)))
        .map(row => ({ imageKey: row.imageKey, name: row.name }));
      if (this.heldOptions && gameId === FIRST_GAME) {
        this.heldOptions.started = true;
        await this.heldOptions.promise;
      }
      await this.json(route, { items, total: items.length });
      return;
    }
    if (resource === 'character-skill-relations' || resource === 'equipment-skill-relations' || resource === 'rune-skill-relations') {
      const kind = resource === 'character-skill-relations' ? 'character' : resource === 'rune-skill-relations' ? 'rune' : 'equipment';
      const ownerKey = method === 'POST' ? String(body[`${kind}Key`]) : tail[1];
      const skillKey = method === 'POST' ? String(body.skillKey) : tail[2];
      const existing = this.mounts.find(row => row.gameId === gameId && row.kind === kind && row.ownerKey === ownerKey && row.skillKey === skillKey);
      if (method === 'GET') {
        const items = this.mounts.filter(row => row.gameId === gameId && row.kind === kind
          && (!url.searchParams.has(`${kind}Key`) || row.ownerKey === url.searchParams.get(`${kind}Key`))
          && (!url.searchParams.has('skillKey') || row.skillKey === url.searchParams.get('skillKey')))
          .sort((a, b) => a.sortOrder - b.sortOrder || a.skillKey.localeCompare(b.skillKey))
          .map(row => this.mountResponse(row));
        await this.json(route, { items, total: items.length });
      } else if (this.mountFailure) {
        await this.error(route, this.mountFailure);
      } else if (method === 'DELETE') {
        this.mounts = this.mounts.filter(row => row !== existing);
        await this.json(route, null, 204);
      } else if (method === 'POST' && existing) {
        await this.error(route, { status: 409, code: '409.RELATION_EXISTS', message: '技能已经挂载', field: 'skillKey' });
      } else if (method === 'POST' && this.row(gameId, 'skills', skillKey!).status === 'DISABLED') {
        await this.error(route, { status: 409, code: '409.REFERENCE_DISABLED', message: '技能已停用，不能新增挂载', field: 'skillKey' });
      } else {
        const row = existing ?? { gameId, kind, ownerKey: ownerKey!, skillKey: skillKey!, sortOrder: 0 };
        row.sortOrder = Number(body.sortOrder);
        if (!existing) this.mounts.push(row);
        await this.json(route, this.mountResponse(row), method === 'POST' ? 201 : 200);
      }
      return;
    }
    if (tail.at(-1) === 'representative-image') {
      const source = tail.slice(0, -1).join('/');
      const identity = this.sourceId(gameId, source);
      if (method === 'DELETE') {
        this.representatives.delete(identity);
        await this.json(route, null, 204);
        return;
      }
      if (method === 'PUT') {
        if (this.imageFailure) { await this.error(route, this.imageFailure); return; }
        const imageKey = String(body.imageKey);
        if (!this.row(gameId, 'images', imageKey).enabled && this.representatives.get(identity) !== imageKey) {
          await this.error(route, { status: 409, code: '409.REFERENCE_DISABLED', message: '图片已停用，不能建立新引用', field: 'imageKey' });
          return;
        }
        this.representatives.set(identity, imageKey);
      }
      const imageKey = this.representatives.get(identity);
      const row = imageKey ? this.row(gameId, 'images', imageKey) : null;
      await this.json(route, { image: row ? { imageKey, name: row.name, enabled: row.enabled } : null });
      return;
    }
    if (resource === 'images' && tail[2] === 'usages' && method === 'GET') {
      await this.json(route, this.usages(gameId, tail[1]!));
      return;
    }
    if (resource === 'images' && tail.length === 1 && method === 'POST') {
      if (this.imageCreateFailure) { await this.error(route, this.imageCreateFailure); return; }
      if (this.rows[gameId]!.images!.some(row => row.name.trim().toLocaleLowerCase() === String(body.name).trim().toLocaleLowerCase())) {
        await this.error(route, { status: 409, code: '409.IMAGE_NAME_EXISTS', message: '图片名称已存在', field: 'name' });
        return;
      }
      const imageBase64 = String(body.imageBase64);
      expect(imageBase64).toMatch(/^data:image\/png;base64,/);
      const content = Buffer.from(imageBase64.split(',')[1]!, 'base64');
      const image: Row = {
        gameId, imageKey: String(body.imageKey), name: String(body.name), description: body.description ?? null,
        imageBase64, mimeType: 'image/png', byteSize: content.length,
        width: content.readUInt32BE(16), height: content.readUInt32BE(20), enabled: true,
        createdAt: NOW, updatedAt: NOW
      };
      expect(image.imageKey).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
      expect(image.name.length).toBeGreaterThan(0);
      expect(this.rows[gameId]!.images!.some(row => row.imageKey === image.imageKey)).toBe(false);
      this.rows[gameId]!.images!.push(image);
      await this.json(route, image, 201);
      return;
    }
    if (resource === 'skills' && tail[2] === 'effects' && method === 'GET') {
      const effect = this.effect(gameId, tail[1]!);
      await this.json(route, tail.length === 3 ? [{ ...effect, lifecycleEnabled: false }] : effect);
      return;
    }
    const rows = this.rows[gameId]![resource];
    if (resource === 'runes' && method === 'GET' && tail.length === 2 && this.runeDetailFailure) {
      await this.error(route, this.runeDetailFailure); return;
    }
    if (rows && (resource === 'runes' || resource === 'rune-paths') && ['POST', 'PUT', 'DELETE'].includes(method)) {
      if (resource === 'rune-paths' && this.runePathFailure) { await this.error(route, this.runePathFailure); return; }
      const keyField = KEY_FIELDS[resource]!;
      const key = method === 'POST' ? body[keyField] : tail[1];
      const index = rows.findIndex(row => row[keyField] === key);
      if (method === 'DELETE') { rows.splice(index, 1); await this.json(route, null, 204); return; }
      const row: Row = { ...(index >= 0 ? rows[index] : { gameId, [keyField]: key, createdAt: NOW }), ...body, name: String(body.name), updatedAt: NOW };
      if (index >= 0) rows[index] = row; else rows.push(row);
      await this.json(route, row, method === 'POST' ? 201 : 200); return;
    }
    if (rows && resource !== 'images' && method === 'GET' && tail.length === 1) {
      if (resource === 'runes') this.runeListReads++;
      const keyword = url.searchParams.get('keyword') ?? '';
      const status = url.searchParams.get('status');
      const category = url.searchParams.get('category');
      const items = rows.filter(row => (!status || row.status === status)
        && (!category || row.category === category)
        && (!keyword || row.name.includes(keyword) || String(row[KEY_FIELDS[resource]!]).includes(keyword)));
      await this.json(route, { items, total: items.length });
      return;
    }
    if (rows && tail.length === 2 && (method === 'GET' || method === 'PUT')) {
      const row = this.row(gameId, resource, tail[1]!);
      if (method === 'PUT') Object.assign(row, body, { updatedAt: '2026-09-06T09:00:00Z' });
      await this.json(route, row);
      return;
    }
    this.unexpected.push(`${method} ${url.pathname}`);
    await this.json(route, {}, 500);
  }
}

async function prepare(page: Page, api: RelationApi) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await api.install(page);
  await page.addInitScript(apiBase => {
    localStorage.setItem('damage-viewer.web.api-base-url', apiBase);
    localStorage.setItem('damage-viewer.web.admin-token', 'isolated-relation-test');
  }, API);
  await page.goto('/#/characters');
  await expect(page.locator('.app-toolbar-field--game')).toContainText(FIRST_GAME);
  return () => {
    expect(errors, '未捕获浏览器异常').toEqual([]);
    expect(api.unexpected, '未定义或已删除接口请求').toEqual([]);
  };
}

test('rune management saves identity, uploads image, keeps disabled skill links and reopens ordered shard layout', async ({ page }) => {
  const api = new RelationApi();
  const assertClean = await prepare(page, api);
  await navigate(page, 'runes');
  await page.getByRole('button', { name: '新增符文', exact: true }).click();
  let dialog = modal(page, '新增符文');
  await dialog.getByLabel('符文标识', { exact: true }).fill('shared_shard');
  await dialog.getByLabel('符文名称', { exact: true }).fill('复用属性碎片');
  await choose(page, dialog, '符文类别', '属性碎片');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'shared_shard')).toContainText('属性碎片');
  expect(api.rows[FIRST_GAME]!.runes).toHaveLength(1);
  dialog = await openRepresentative(page, 'runes', 'shared_shard', '复用属性碎片');
  await selectImageFile(dialog, await pngUpload(page, 32, 32, 'rune.png'));
  await uploadAndUse(dialog); await closeModal(dialog);
  await expectRowImage(page, 'shared_shard', '复用属性碎片', String(api.rows[FIRST_GAME]!.images!.at(-1)!.imageBase64));
  await row(page, 'shared_shard').getByRole('button', { name: '关联技能', exact: true }).click();
  dialog = modal(page, '关联技能 · 复用属性碎片');
  await choose(page, dialog, '选择符文技能', '打击技能', true);
  await dialog.getByRole('button', { name: '添加符文挂载', exact: true }).click();
  await expect(dialog.getByRole('row').filter({ hasText: 'strike' })).toBeVisible();
  await closeModal(dialog);
  api.row(FIRST_GAME, 'skills', 'strike').status = 'DISABLED';
  await navigate(page, 'skills');
  await row(page, 'strike').getByRole('button', { name: '挂载对象', exact: true }).click();
  dialog = modal(page, '挂载对象 · 打击技能');
  const runeSection = dialog.getByRole('region', { name: '符文挂载' });
  await expect(runeSection.getByRole('button', { name: '添加符文挂载', exact: true })).toBeDisabled();
  await runeSection.getByRole('row').filter({ hasText: 'shared_shard' }).getByLabel('复用属性碎片排序').fill('7');
  await runeSection.getByRole('row').filter({ hasText: 'shared_shard' }).getByRole('button', { name: '保存排序', exact: true }).click();
  await expect(dialog.getByText('挂载顺序已保存。', { exact: true })).toBeVisible();
  expect(api.mounts.find(mount => mount.kind === 'rune')?.sortOrder).toBe(7);
  await closeModal(dialog);
  await navigate(page, 'runes');
  await page.getByRole('tab', { name: '分组与槽位', exact: true }).click();
  await page.getByRole('button', { name: '新增符文分组', exact: true }).click();
  dialog = modal(page, '新增符文分组');
  await dialog.getByLabel('分组标识', { exact: true }).fill('shards');
  await dialog.getByLabel('分组名称', { exact: true }).fill('碎片布局');
  await choose(page, dialog, '分组种类', '碎片组');
  for (const [index, name] of ['第一行', '第二行'].entries()) {
    await dialog.getByRole('button', { name: '添加槽位', exact: true }).click();
    const slot = dialog.getByRole('region', { name: `槽位${index + 1}`, exact: true });
    await slot.getByLabel(`槽位${index + 1}名称`, { exact: true }).fill(name);
    await slot.getByRole('button', { name: '添加候选', exact: true }).click();
    await choose(page, slot, `槽位${index + 1}候选1`, '复用属性碎片', true);
  }
  await dialog.getByRole('region', { name: '槽位2', exact: true }).getByRole('button', { name: '上移槽位', exact: true }).click();
  api.runePathFailure = { status: 400, code: '400.INVALID_RUNE_PATH_REQUEST', message: '服务端布局核对失败', field: 'slots[0].runeKeys[0]' };
  await dialog.getByRole('button', { name: '保存完整布局', exact: true }).click();
  await expect(dialog.getByText('服务端布局核对失败', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('槽位1名称', { exact: true })).toHaveValue('第二行');
  expect(api.rows[FIRST_GAME]!['rune-paths']).toHaveLength(0);
  api.runePathFailure = null;
  await dialog.getByRole('button', { name: '保存完整布局', exact: true }).click();
  await expect(dialog).toBeHidden();
  await row(page, 'shards').getByRole('button', { name: '查看', exact: true }).click();
  dialog = modal(page, '查看分组与槽位');
  await expect(dialog.getByLabel('槽位1名称', { exact: true })).toHaveValue('第二行');
  await expect(dialog.getByLabel('槽位2名称', { exact: true })).toHaveValue('第一行');
  expect(api.row(FIRST_GAME, 'rune-paths', 'shards').slots).toEqual([{ name: '第二行', category: 'SHARD', runeKeys: ['shared_shard'] }, { name: '第一行', category: 'SHARD', runeKeys: ['shared_shard'] }]);
  expect(api.rows[FIRST_GAME]!.runes).toHaveLength(1);
  await closeModal(dialog);
  assertClean();
});

test('rune management paginates locally and retries only the final read after a successful save', async ({ page }) => {
  const api = new RelationApi();
  api.rows[FIRST_GAME]!.runes = Array.from({ length: 26 }, (_, index) => ({ gameId: FIRST_GAME, runeKey: `r_${String(index + 1).padStart(2, '0')}`, name: `符文${index + 1}`, category: 'MINOR', description: null, createdAt: NOW, updatedAt: NOW }));
  const assertClean = await prepare(page, api);
  await navigate(page, 'runes');
  await expect(page.locator('tbody tr')).toHaveCount(25);
  const listReads = api.runeListReads;
  await page.getByRole('listitem', { name: '第 2 页', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(row(page, 'r_26')).toBeVisible();
  expect(api.runeListReads).toBe(listReads);
  await row(page, 'r_26').getByRole('button', { name: '编辑', exact: true }).click();
  const dialog = modal(page, '编辑符文');
  await expect(dialog.getByLabel('符文名称', { exact: true })).toHaveValue('符文26');
  await dialog.getByLabel('符文名称', { exact: true }).fill('保存后需回读');
  api.runeDetailFailure = { status: 503, code: '503.TEST_READ_FAILURE', message: '最终读取暂时失败', field: 'runeKey' };
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByText(/已写入，最终回读失败/)).toBeVisible();
  await expect(dialog.getByLabel('符文名称', { exact: true })).toBeDisabled();
  expect(api.writes.filter(write => write.path.endsWith('/runes/r_26'))).toHaveLength(1);
  api.runeDetailFailure = null;
  await dialog.getByRole('button', { name: '重新回读', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'r_26')).toContainText('保存后需回读');
  expect(api.writes.filter(write => write.path.endsWith('/runes/r_26'))).toHaveLength(1);
  await page.getByLabel('符文关键词', { exact: true }).fill('r_01');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(row(page, 'r_01')).toBeVisible();
  await expect(page.locator('.arco-pagination-item-active')).toHaveText('1');
  assertClean();
});

function row(scope: Page | Locator, key: string) {
  return scope.getByRole('row').filter({ has: scope.getByRole('cell', { name: key, exact: true }) });
}
async function expectRowImage(page: Page, key: string, name: string, src: string) {
  const table = page.getByRole('table').filter({ has: page.getByRole('cell', { name: key, exact: true }) });
  await expect(table.getByRole('columnheader').first()).toHaveText('图片');
  const image = row(page, key).getByRole('cell').first().getByRole('img', { name: `${name}代表图片`, exact: true });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', src);
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(element => {
    const imageElement = element as HTMLImageElement;
    return imageElement.complete && imageElement.naturalWidth > 0;
  })).toBe(true);
  await expect.poll(() => image.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const visibleAtCenter = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return visibleAtCenter === element;
  }), { message: `${name}的最左侧图片不能被固定操作列遮挡` }).toBe(true);
}
async function expectRowImagePlaceholder(page: Page, key: string, text: string | RegExp) {
  const cell = row(page, key).getByRole('cell').first();
  await expect(cell).toContainText(text);
  await expect(cell.getByRole('img')).toHaveCount(0);
}
function modal(page: Page, title: string) {
  return page.locator('.arco-modal:visible').filter({ has: page.locator('.arco-modal-title', { hasText: title }) });
}
async function navigate(page: Page, route: string) {
  await page.evaluate(hash => { window.location.hash = `#/${hash}`; }, route);
  await expect(page).toHaveURL(new RegExp(`#/${route}$`));
}
async function choose(page: Page, scope: Locator, label: string, option: string, searchByName = false) {
  const select = scope.getByLabel(label, { exact: true });
  await select.click();
  if (searchByName) {
    await select.getByRole('textbox').fill(option);
    await expect(select.getByRole('textbox')).toHaveValue(option);
  }
  const candidate = page.locator('.arco-select-option:visible').filter({ hasText: option });
  await expect(candidate).toBeVisible();
  await candidate.click();
  await expect(candidate).toBeHidden();
}
async function closeModal(dialog: Locator) {
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function syncImages(page: Page) {
  await navigate(page, 'images');
  await page.getByRole('button', { name: '全量同步', exact: true }).click();
  await expect(row(page, 'portrait_a')).toBeVisible();
}

async function openRepresentative(page: Page, route: string, key: string, title: string) {
  await navigate(page, route);
  if (route === 'game-settings') {
    await page.getByRole('button', { name: '设置代表图片', exact: true }).click();
  } else {
    await row(page, key).getByRole('button', { name: '代表图片', exact: true }).click();
  }
  return modal(page, `${title} · 代表图片`);
}

async function selectImage(page: Page, dialog: Locator, name = '图片甲') {
  await dialog.getByText('选择已有图片', { exact: true }).click();
  await dialog.getByLabel('搜索代表图片', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '搜索图片', exact: true }).click();
  await choose(page, dialog, '选择代表图片', name);
}

async function saveImage(dialog: Locator) {
  await dialog.getByRole('button', { name: '保存代表图片', exact: true }).click();
  await expect(dialog.getByText('代表图片已保存。', { exact: true })).toBeVisible();
}

test('stage 9 skill relations keep both ends, order, disabled references and failed drafts consistent', async ({ page }) => {
  const api = new RelationApi();
  const assertClean = await prepare(page, api);
  await row(page, 'hero_a').getByRole('button', { name: '关联技能', exact: true }).click();
  let dialog = modal(page, '关联技能 · 角色甲');
  await choose(page, dialog, '选择角色技能', '打击技能', true);
  await dialog.getByLabel('角色新增排序', { exact: true }).fill('9');
  api.mountFailure = { status: 409, code: '409.RELATION_EXISTS', message: '服务端拒绝重复挂载', field: 'skillKey' };
  await dialog.getByRole('button', { name: '添加角色挂载', exact: true }).click();
  await expect(dialog.getByText('服务端拒绝重复挂载').first()).toBeVisible();
  await expect(dialog.getByLabel('角色新增排序', { exact: true })).toHaveValue('9');
  await expect(dialog.getByLabel('选择角色技能', { exact: true })).toContainText('打击技能');
  expect(api.mounts).toEqual([]);
  api.mountFailure = null;
  await dialog.getByRole('button', { name: '添加角色挂载', exact: true }).click();
  await expect.poll(() => api.mounts.length).toBe(1);
  await choose(page, dialog, '选择角色技能', '守护技能', true);
  await dialog.getByLabel('角色新增排序', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: '添加角色挂载', exact: true }).click();
  await expect(dialog.getByLabel('守护技能排序', { exact: true })).toHaveValue('1');
  await expect(dialog.getByRole('row').filter({ has: page.getByRole('button', { name: '保存排序', exact: true }) }).first()).toContainText('守护技能');
  await closeModal(dialog);

  await navigate(page, 'equipment');
  await row(page, 'blade').getByRole('button', { name: '关联技能', exact: true }).click();
  dialog = modal(page, '关联技能 · 装备甲');
  await choose(page, dialog, '选择装备技能', '打击技能', true);
  await dialog.getByLabel('装备新增排序', { exact: true }).fill('4');
  await dialog.getByRole('button', { name: '添加装备挂载', exact: true }).click();
  await expect(dialog.getByLabel('打击技能排序', { exact: true })).toHaveValue('4');
  await closeModal(dialog);

  await navigate(page, 'skills');
  await row(page, 'strike').getByRole('button', { name: '挂载对象', exact: true }).click();
  dialog = modal(page, '挂载对象 · 打击技能');
  await choose(page, dialog, '选择挂载角色', '角色乙', true);
  await dialog.getByRole('button', { name: '添加角色挂载', exact: true }).click();
  await expect(dialog.getByLabel('角色乙排序', { exact: true })).toHaveValue('0');
  await dialog.getByRole('row').filter({ hasText: '角色乙' }).getByRole('button', { name: '移除', exact: true }).click();
  await expect(dialog.getByLabel('角色乙排序', { exact: true })).toHaveCount(0);
  await dialog.getByRole('row').filter({ hasText: '装备甲' }).getByRole('button', { name: '移除', exact: true }).click();
  await expect(dialog.getByLabel('装备甲排序', { exact: true })).toHaveCount(0);
  await choose(page, dialog, '选择挂载装备', '装备甲', true);
  await dialog.getByLabel('装备新增排序', { exact: true }).fill('4');
  await dialog.getByRole('button', { name: '添加装备挂载', exact: true }).click();
  await expect(dialog.getByLabel('装备甲排序', { exact: true })).toHaveValue('4');
  await closeModal(dialog);
  await row(page, 'strike').getByRole('button', { name: '停用', exact: true }).click();
  await modal(page, '停用技能').getByRole('button', { name: '停用', exact: true }).click();
  await expect(modal(page, '停用技能')).toBeHidden();
  await row(page, 'strike').getByRole('button', { name: '挂载对象', exact: true }).click();
  dialog = modal(page, '挂载对象 · 打击技能');
  await expect(dialog.getByText('已停用', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByLabel('角色甲排序', { exact: true })).toHaveValue('9');
  await expect(dialog.getByLabel('装备甲排序', { exact: true })).toHaveValue('4');
  await dialog.getByLabel('角色甲排序', { exact: true }).fill('0');
  await dialog.getByRole('row').filter({ hasText: '角色甲' }).getByRole('button', { name: '保存排序', exact: true }).click();
  await expect.poll(() => api.mounts.find(item => item.kind === 'character' && item.skillKey === 'strike')?.sortOrder).toBe(0);
  await dialog.getByLabel('装备甲排序', { exact: true }).fill('2');
  await dialog.getByRole('row').filter({ hasText: '装备甲' }).getByRole('button', { name: '保存排序', exact: true }).click();
  await expect.poll(() => api.mounts.find(item => item.kind === 'equipment')?.sortOrder).toBe(2);
  await expect(dialog.getByRole('button', { name: '添加角色挂载', exact: true })).toBeDisabled();
  await dialog.getByRole('row').filter({ hasText: '装备甲' }).getByRole('button', { name: '移除', exact: true }).click();
  await expect(dialog.getByLabel('装备甲排序', { exact: true })).toBeHidden();
  await closeModal(dialog);

  await navigate(page, 'characters');
  await row(page, 'hero_a').getByRole('button', { name: '关联技能', exact: true }).click();
  dialog = modal(page, '关联技能 · 角色甲');
  await expect(dialog.getByLabel('打击技能排序', { exact: true })).toHaveValue('0');
  await expect(dialog.getByRole('row').filter({ hasText: '打击技能' })).toContainText('已停用');
  await dialog.getByRole('row').filter({ hasText: '打击技能' }).getByRole('button', { name: '移除', exact: true }).click();
  await expect(dialog.getByLabel('打击技能排序', { exact: true })).toHaveCount(0);
  await closeModal(dialog);
  await row(page, 'hero_b').getByRole('button', { name: '关联技能', exact: true }).click();
  dialog = modal(page, '关联技能 · 角色乙');
  await dialog.getByLabel('选择角色技能', { exact: true }).click();
  await expect(page.locator('.arco-select-option:visible').filter({ hasText: '守护技能' })).toBeVisible();
  await expect(page.locator('.arco-select-option:visible').filter({ hasText: '打击技能' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await closeModal(dialog);
  await navigate(page, 'equipment');
  await row(page, 'blade').getByRole('button', { name: '关联技能', exact: true }).click();
  await expect(modal(page, '关联技能 · 装备甲').getByLabel('打击技能排序', { exact: true })).toHaveCount(0);
  expect(api.mounts.filter(item => item.kind === 'equipment')).toEqual([]);
  await closeModal(modal(page, '关联技能 · 装备甲'));
  await navigate(page, 'skills');
  await row(page, 'strike').getByRole('button', { name: '挂载对象', exact: true }).click();
  await expect(modal(page, '挂载对象 · 打击技能').getByRole('button', { name: '移除', exact: true })).toHaveCount(0);
  expect(api.mounts.map(item => item.skillKey)).toEqual(['guard']);
  assertClean();
});

test('equipment skill authoring preserves owner and filter, confirms drafts, retries and clears on game change', async ({ page }) => {
  const api = new RelationApi();
  api.mounts.push({ gameId: FIRST_GAME, kind: 'equipment', ownerKey: 'blade', skillKey: 'strike', sortOrder: 4 });
  const assertClean = await prepare(page, api);
  let failSkillRead = true;
  await page.route(`${API}/api/admin/games/${FIRST_GAME}/skills/strike`, async route => {
    if (route.request().method() === 'GET' && failSkillRead) {
      await api.error(route, { status: 503, code: '503.SKILL_READ_FAILED', message: '技能读取暂时失败', field: '' });
    } else await route.fallback();
  });
  await navigate(page, 'equipment');
  await page.getByLabel('装备关键词', { exact: true }).fill('装备甲');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await row(page, 'blade').getByRole('button', { name: '关联技能', exact: true }).click();
  const relations = modal(page, '关联技能 · 装备甲');
  await relations.getByLabel('打击技能排序', { exact: true }).fill('9');
  await relations.getByRole('button', { name: '录入技能', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(relations.getByLabel('打击技能排序', { exact: true })).toHaveValue('9');
  await relations.getByRole('button', { name: '录入技能', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回装备技能', exact: true })).toBeVisible();
  await expect(page.getByText(/来自装备：装备甲（blade）/)).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '503.SKILL_READ_FAILED: 技能读取暂时失败' })).toBeVisible();
  expect(api.mounts[0]!.sortOrder).toBe(4);
  expect(api.writes).toEqual([]);
  failSkillRead = false;
  await page.locator('.page-stack').getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('heading', { name: '技能录入 · 打击技能', exact: true })).toBeVisible();
  await expect(row(page, 'guard')).toHaveCount(0);
  await row(page, 'strike').getByRole('button', { name: '编辑', exact: true }).click();
  const editor = modal(page, '编辑技能');
  await editor.getByLabel('技能名称', { exact: true }).fill('已编辑打击技能');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toBeHidden();
  expect(api.writes.map(write => `${write.method} ${write.path}`)).toEqual([`PUT /api/admin/games/${FIRST_GAME}/skills/strike`]);
  await page.getByRole('button', { name: '返回装备技能', exact: true }).click();
  await expect(relations.getByText('已编辑打击技能', { exact: true })).toBeVisible();
  await expect(relations.getByLabel('已编辑打击技能排序', { exact: true })).toHaveValue('4');
  await closeModal(relations);
  await expect(page.getByLabel('装备关键词', { exact: true })).toHaveValue('装备甲');
  await row(page, 'blade').getByRole('button', { name: '关联技能', exact: true }).click();
  await relations.getByRole('button', { name: '录入技能', exact: true }).click();
  await expect(page.getByRole('heading', { name: '技能录入 · 已编辑打击技能', exact: true })).toBeVisible();
  await page.locator('.app-toolbar-field--game .arco-select-view').click();
  await page.locator('.arco-select-option:visible').filter({ hasText: SECOND_GAME }).click();
  await expect(page.getByRole('heading', { name: '装备管理', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回装备技能', exact: true })).toHaveCount(0);
  await expect(row(page, 'blade')).toContainText('另一游戏装备甲');
  await expect(relations).toBeHidden();
  assertClean();
});

const IMAGE_SOURCES = [
  { route: 'game-settings', key: FIRST_GAME, name: '关联验收游戏', type: '游戏', source: '' },
  { route: 'characters', key: 'hero_a', name: '角色甲', type: '角色', source: 'characters/hero_a' },
  { route: 'attributes', key: 'attack', name: '攻击属性', type: '属性', source: 'attributes/attack' },
  { route: 'equipment', key: 'blade', name: '装备甲', type: '装备', source: 'equipment/blade' },
  { route: 'skills', key: 'strike', name: '打击技能', type: '技能', source: 'skills/strike' },
  { route: 'skills', key: 'shared_effect', name: '同名效果', type: '技能效果', source: 'skills/strike/effects/shared_effect' },
  { route: 'statuses', key: 'stun', name: '眩晕状态', type: '状态', source: 'statuses/stun' }
];

test('stage 9 all seven image sources share reverse usages, replacement confirmation and effect parent identity', async ({ page }) => {
  const api = new RelationApi();
  const assertClean = await prepare(page, api);
  await syncImages(page);
  for (const source of IMAGE_SOURCES) {
    let dialog: Locator;
    if (source.type === '技能效果') {
      await navigate(page, 'skills');
      await row(page, 'strike').getByRole('button', { name: '效果与结果', exact: true }).click();
      await row(page, source.key).getByRole('button', { name: '代表图片', exact: true }).click();
      dialog = modal(page, '同名效果 · 代表图片');
      await expect(dialog).toContainText('所属技能：strike');
    } else {
      dialog = await openRepresentative(page, source.route, source.key, source.name);
    }
    await selectImage(page, dialog);
    await saveImage(dialog);
    expect(api.sourceImage(FIRST_GAME, source.source)).toBe('portrait_a');
    await closeModal(dialog);
    if (source.type === '技能效果') await closeModal(page.locator('.arco-modal:visible'));
  }
  // 相同效果标识属于不同技能，另一父技能的关系应完整保留。
  api.representatives.set(api.sourceId(FIRST_GAME, 'skills/guard/effects/shared_effect'), 'portrait_b');
  await navigate(page, 'images');
  await row(page, 'portrait_a').getByRole('button', { name: '用途关系', exact: true }).click();
  let dialog = modal(page, '图片用途关系');
  for (const source of IMAGE_SOURCES) {
    await expect(dialog.getByRole('region', { name: `${source.type}图片用途`, exact: true })).toContainText(source.name);
  }
  await closeModal(dialog);

  await row(page, 'portrait_b').getByRole('button', { name: '用途关系', exact: true }).click();
  dialog = modal(page, '图片用途关系');
  await choose(page, dialog, '图片来源类别', '角色');
  await choose(page, dialog, '图片来源对象', '角色甲', true);
  const replacement = page.waitForEvent('dialog').then(async prompt => {
    expect(prompt.message()).toContain('图片甲');
    expect(prompt.message()).toContain('替换');
    await prompt.dismiss();
  });
  await dialog.getByRole('button', { name: '设置此图片', exact: true }).click();
  await replacement;
  expect(api.sourceImage(FIRST_GAME, 'characters/hero_a')).toBe('portrait_a');
  page.once('dialog', prompt => prompt.accept());
  await dialog.getByRole('button', { name: '设置此图片', exact: true }).click();
  await expect(dialog.getByRole('region', { name: '角色图片用途', exact: true })).toContainText('角色甲');
  expect(api.sourceImage(FIRST_GAME, 'characters/hero_a')).toBe('portrait_b');

  await choose(page, dialog, '图片来源对象', '角色乙', true);
  await dialog.getByRole('button', { name: '设置此图片', exact: true }).click();
  const characterGroup = dialog.getByRole('region', { name: '角色图片用途', exact: true });
  await expect(characterGroup).toContainText('角色乙');
  expect(api.sourceImage(FIRST_GAME, 'characters/hero_b')).toBe('portrait_b');
  page.once('dialog', prompt => prompt.accept());
  await characterGroup.getByRole('row').filter({ hasText: '角色乙' }).getByRole('button', { name: '移除关系', exact: true }).click();
  await expect.poll(() => api.sourceImage(FIRST_GAME, 'characters/hero_b')).toBeUndefined();
  expect(api.rows[FIRST_GAME]!.characters).toHaveLength(2);

  await choose(page, dialog, '图片来源类别', '技能效果');
  await choose(page, dialog, '来源技能', '打击技能', true);
  await choose(page, dialog, '图片来源对象', '同名效果', true);
  page.once('dialog', prompt => prompt.accept());
  await dialog.getByRole('button', { name: '设置此图片', exact: true }).click();
  await expect.poll(() => api.sourceImage(FIRST_GAME, 'skills/strike/effects/shared_effect')).toBe('portrait_b');
  const effectGroup = dialog.getByRole('region', { name: '技能效果图片用途', exact: true });
  await expect(effectGroup).toContainText('strike');
  await expect(effectGroup).toContainText('guard');
  page.once('dialog', prompt => prompt.accept());
  await effectGroup.getByRole('row').filter({ hasText: 'strike' }).getByRole('button', { name: '移除关系', exact: true }).click();
  await expect.poll(() => api.sourceImage(FIRST_GAME, 'skills/strike/effects/shared_effect')).toBeUndefined();
  expect(api.sourceImage(FIRST_GAME, 'skills/guard/effects/shared_effect')).toBe('portrait_b');
  await closeModal(dialog);

  dialog = await openRepresentative(page, 'characters', 'hero_a', '角色甲');
  await dialog.getByText('选择已有图片', { exact: true }).click();
  await expect(dialog.getByText('图片乙（portrait_b）', { exact: true })).toBeVisible();
  page.once('dialog', prompt => prompt.accept());
  await dialog.getByRole('button', { name: '移除代表图片', exact: true }).click();
  await expect(dialog.getByText('尚未设置代表图片', { exact: true })).toBeVisible();
  await closeModal(dialog);
  await expectRowImagePlaceholder(page, 'hero_a', '未设置');
  await navigate(page, 'images');
  await row(page, 'portrait_a').getByRole('button', { name: '用途关系', exact: true }).click();
  dialog = modal(page, '图片用途关系');
  for (const source of IMAGE_SOURCES.filter(item => item.type !== '角色' && item.type !== '技能效果')) {
    page.once('dialog', prompt => prompt.accept());
    await dialog.getByRole('region', { name: `${source.type}图片用途`, exact: true }).getByRole('button', { name: '移除关系', exact: true }).click();
    await expect.poll(() => api.sourceImage(FIRST_GAME, source.source)).toBeUndefined();
  }
  await expect(dialog.getByRole('button', { name: '移除关系', exact: true })).toHaveCount(0);
  expect(api.rows[FIRST_GAME]!.images).toHaveLength(3);
  assertClean();
});

test('stage 9 image failures preserve drafts and disabling retains existing references without new choices', async ({ page }) => {
  const api = new RelationApi();
  const assertClean = await prepare(page, api);
  await syncImages(page);
  let dialog = await openRepresentative(page, 'characters', 'hero_a', '角色甲');
  await selectImage(page, dialog);
  for (const failure of [
    { status: 400, code: '400.VALIDATION_FAILED', message: '服务端图片字段校验失败', field: 'imageKey' },
    { status: 409, code: '409.REFERENCE_DISABLED', message: '图片引用状态冲突', field: 'imageKey' }
  ]) {
    api.imageFailure = failure;
    await dialog.getByRole('button', { name: '保存代表图片', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(`${failure.code}: ${failure.message}`);
    await expect(dialog.getByLabel('搜索代表图片', { exact: true })).toHaveValue('图片甲');
    await expect(dialog.getByLabel('选择代表图片', { exact: true })).toContainText('图片甲');
    await expect(dialog.getByText('待保存：图片甲（portrait_a）', { exact: true })).toBeVisible();
    expect(api.sourceImage(FIRST_GAME, 'characters/hero_a')).toBeUndefined();
  }
  api.imageFailure = null;
  await saveImage(dialog);
  await closeModal(dialog);
  await navigate(page, 'images');
  await row(page, 'portrait_a').getByRole('button', { name: '停用', exact: true }).click();
  await modal(page, '停用图片').getByRole('button', { name: '停用', exact: true }).click();
  await expect(modal(page, '停用图片')).toBeHidden();
  await navigate(page, 'characters');
  await expectRowImagePlaceholder(page, 'hero_a', /停用/);
  dialog = await openRepresentative(page, 'characters', 'hero_a', '角色甲');
  await expect(dialog).toContainText('当前图片已停用，原有关联可以保留或移除。');
  expect(api.sourceImage(FIRST_GAME, 'characters/hero_a')).toBe('portrait_a');
  await dialog.getByText('选择已有图片', { exact: true }).click();
  await dialog.getByLabel('搜索代表图片', { exact: true }).fill('图片');
  await dialog.getByRole('button', { name: '搜索图片', exact: true }).click();
  await dialog.getByLabel('选择代表图片', { exact: true }).click();
  await expect(page.locator('.arco-select-option:visible').filter({ hasText: '图片乙' })).toBeVisible();
  await expect(page.locator('.arco-select-option:visible').filter({ hasText: '图片甲' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  page.once('dialog', prompt => prompt.accept());
  await dialog.getByRole('button', { name: '移除代表图片', exact: true }).click();
  await expect(dialog).toContainText('尚未设置代表图片');
  await closeModal(dialog);
  await expectRowImagePlaceholder(page, 'hero_a', '未设置');
  await navigate(page, 'images');
  await row(page, 'portrait_a').getByRole('button', { name: '用途关系', exact: true }).click();
  dialog = modal(page, '图片用途关系');
  await expect(dialog.getByRole('button', { name: '设置此图片', exact: true })).toBeDisabled();
  expect(api.sourceImage(FIRST_GAME, 'characters/hero_a')).toBeUndefined();
  assertClean();
});

test('stage 9 switching games rejects late image candidates and does not reuse same-key previews', async ({ page }) => {
  const api = new RelationApi();
  api.representatives.set(api.sourceId(FIRST_GAME, 'characters/hero_a'), 'portrait_a');
  const assertClean = await prepare(page, api);
  const firstGameUpload = await pngUpload(page, 32, 20, 'first-game.png');
  const firstGameImage = `data:image/png;base64,${firstGameUpload.buffer.toString('base64')}`;
  api.row(FIRST_GAME, 'images', 'portrait_a').imageBase64 = firstGameImage;
  await syncImages(page);
  await navigate(page, 'characters');
  await expectRowImage(page, 'hero_a', '角色甲', firstGameImage);
  let release!: () => void;
  api.heldOptions = { started: false, promise: new Promise<void>(resolve => { release = resolve; }) };
  const oldDialog = await openRepresentative(page, 'characters', 'hero_a', '角色甲');
  await oldDialog.getByText('选择已有图片', { exact: true }).click();
  await oldDialog.getByLabel('搜索代表图片', { exact: true }).fill('图片甲');
  await oldDialog.getByRole('button', { name: '搜索图片', exact: true }).click();
  await expect.poll(() => api.heldOptions?.started).toBe(true);
  await closeModal(oldDialog);
  await page.locator('.app-toolbar-field--game .arco-select-view').click();
  await page.locator('.arco-select-option:visible').filter({ hasText: SECOND_GAME }).click();
  await expect(page.locator('.app-toolbar-field--game')).toContainText(SECOND_GAME);
  await expectRowImagePlaceholder(page, 'hero_a', '未设置');
  const dialog = await openRepresentative(page, 'characters', 'hero_a', '另一游戏角色甲');
  await dialog.getByText('选择已有图片', { exact: true }).click();
  await expect(dialog.getByLabel('搜索代表图片', { exact: true })).toHaveValue('');
  await selectImage(page, dialog, '另一游戏图片甲');
  // 新游戏候选先完成，再放行旧游戏请求，覆盖真正迟到的响应。
  const lateResponse = page.waitForResponse(response => response.url().includes(`/games/${FIRST_GAME}/image-options`));
  release();
  await (await lateResponse).finished();
  await dialog.getByLabel('选择代表图片', { exact: true }).click();
  await expect(page.locator('.arco-select-option:visible').filter({ hasText: '另一游戏图片甲' })).toBeVisible();
  await expect(page.locator('.arco-select-option:visible').getByText('图片甲（portrait_a）· 已启用', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog.getByText('待保存：另一游戏图片甲（portrait_a）', { exact: true })).toBeVisible();
  // 只同步过第一个游戏；另一游戏同名标识没有图片内容，必须显示占位。
  await expect(dialog.locator('img')).toHaveCount(0);
  await expect(dialog).not.toContainText('待保存：图片甲（portrait_a）');
  await saveImage(dialog);
  expect(api.sourceImage(SECOND_GAME, 'characters/hero_a')).toBe('portrait_a');
  expect(api.sourceImage(FIRST_GAME, 'characters/hero_a')).toBe('portrait_a');
  expect(api.writes.filter(write => write.path.includes('representative-image')).every(write => write.path.includes(SECOND_GAME))).toBe(true);
  await closeModal(dialog);
  await expectRowImagePlaceholder(page, 'hero_a', '未缓存');
  assertClean();
});

async function pngUpload(page: Page, width: number, height: number, name = '代表图片.png', color = '#2563eb') {
  const dataUrl = await page.evaluate(({ width: w, height: h, color: fill }) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d')!;
    context.fillStyle = fill;
    context.fillRect(0, 0, w, h);
    context.fillStyle = '#ffffff';
    context.fillRect(Math.floor(w / 4), Math.floor(h / 4), Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
    return canvas.toDataURL('image/png');
  }, { width, height, color });
  return { name, mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

async function selectImageFile(dialog: Locator, file: Awaited<ReturnType<typeof pngUpload>>) {
  const input = dialog.getByLabel('选择图片文件', { exact: true });
  // setInputFiles 不自动等待 enabled，必须先等待对象详情加载完成。
  await expect(input).toBeEnabled();
  await input.setInputFiles(file);
}

async function openImageSource(page: Page, source: typeof IMAGE_SOURCES[number]) {
  if (source.type !== '技能效果') return openRepresentative(page, source.route, source.key, source.name);
  await navigate(page, 'skills');
  await row(page, 'strike').getByRole('button', { name: '效果与结果', exact: true }).click();
  await row(page, source.key).getByRole('button', { name: '代表图片', exact: true }).click();
  const dialog = modal(page, '同名效果 · 代表图片');
  await expect(dialog).toContainText('所属技能：strike');
  return dialog;
}

async function closeImageSource(page: Page, dialog: Locator, source: typeof IMAGE_SOURCES[number], expectedImage?: string) {
  await closeModal(dialog);
  if (source.type !== '游戏' && expectedImage) await expectRowImage(page, source.key, source.name, expectedImage);
  if (source.type === '技能效果') await closeModal(page.locator('.arco-modal:visible'));
}

async function uploadAndUse(dialog: Locator) {
  await dialog.getByRole('button', { name: '上传并使用', exact: true }).click();
  await expect(dialog.getByText('代表图片已上传并保存。', { exact: true })).toBeVisible();
}

function imagePosts(api: RelationApi) {
  return api.writes.filter(write => write.method === 'POST' && write.path.endsWith('/images'));
}

test('stage 9 uploads directly from all seven objects, caches previews and replaces only the selected object', async ({ page }) => {
  const api = new RelationApi();
  api.representatives.set(api.sourceId(FIRST_GAME, 'characters/hero_a'), 'portrait_a');
  api.representatives.set(api.sourceId(FIRST_GAME, 'characters/hero_b'), 'portrait_a');
  const sharedImage = { ...api.row(FIRST_GAME, 'images', 'portrait_a') };
  const assertClean = await prepare(page, api);
  const upload = await pngUpload(page, 160, 96);
  for (const source of IMAGE_SOURCES) {
    let dialog = await openImageSource(page, source);
    await expect(dialog.getByRole('radio', { name: '上传新图片', exact: true })).toBeChecked();
    await expect(dialog.getByRole('button', { name: '上传并使用', exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('图片标识', { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel('图片名称', { exact: true })).toHaveCount(0);
    await selectImageFile(dialog, upload);
    await expect(dialog.getByRole('img', { name: `${source.name}待上传代表图片`, exact: true })).toBeVisible();
    await uploadAndUse(dialog);
    const key = api.sourceImage(FIRST_GAME, source.source)!;
    expect(key).toBeTruthy();
    expect(key).not.toBe('portrait_a');
    const created = api.row(FIRST_GAME, 'images', key);
    expect(created.width).toBe(64);
    expect(created.height).toBe(64);
    expect(Number(created.byteSize)).toBeLessThanOrEqual(262144);
    await expect(dialog.getByRole('img', { name: `${source.name}代表图片`, exact: true })).toHaveAttribute('src', String(created.imageBase64));
    await closeImageSource(page, dialog, source, String(created.imageBase64));

    dialog = await openImageSource(page, source);
    await expect(dialog.getByRole('img', { name: `${source.name}代表图片`, exact: true })).toHaveAttribute('src', String(created.imageBase64));
    await closeImageSource(page, dialog, source);
    // 不做全量同步：上传成功写入的本地缓存必须足够支撑图片列表及反向用途入口。
    await navigate(page, 'images');
    await row(page, key).getByRole('button', { name: '用途关系', exact: true }).click();
    const usages = modal(page, '图片用途关系');
    await expect(usages.getByRole('region', { name: `${source.type}图片用途`, exact: true })).toContainText(source.name);
    await closeModal(usages);
  }
  expect(imagePosts(api)).toHaveLength(7);
  expect(api.sourceImage(FIRST_GAME, 'characters/hero_b')).toBe('portrait_a');
  expect(api.row(FIRST_GAME, 'images', 'portrait_a')).toEqual(sharedImage);
  const firstUploadKey = api.sourceImage(FIRST_GAME, 'characters/hero_a')!;
  const firstUpload = { ...api.row(FIRST_GAME, 'images', firstUploadKey) };
  const dialog = await openRepresentative(page, 'characters', 'hero_a', '角色甲');
  await selectImageFile(dialog, await pngUpload(page, 32, 20, '代表图片.png', '#16a34a'));
  await expect(dialog.getByRole('img', { name: '角色甲待上传代表图片', exact: true })).toBeVisible();
  await uploadAndUse(dialog);
  const replacementKey = api.sourceImage(FIRST_GAME, 'characters/hero_a')!;
  expect(replacementKey).not.toBe(firstUploadKey);
  expect(api.row(FIRST_GAME, 'images', replacementKey).name).not.toBe(firstUpload.name);
  expect(api.row(FIRST_GAME, 'images', firstUploadKey)).toEqual(firstUpload);
  expect(api.row(FIRST_GAME, 'images', 'portrait_a')).toEqual(sharedImage);
  expect(imagePosts(api)).toHaveLength(8);
  expect(api.writes.filter(write => write.method === 'PUT' && /\/images\/[^/]+$/.test(write.path))).toEqual([]);
  await closeModal(dialog);
  await expectRowImage(page, 'hero_a', '角色甲', String(api.row(FIRST_GAME, 'images', replacementKey).imageBase64));
  const removeDialog = await openRepresentative(page, 'characters', 'hero_a', '角色甲');
  page.once('dialog', prompt => prompt.accept());
  await removeDialog.getByRole('button', { name: '移除代表图片', exact: true }).click();
  await expect(removeDialog).toContainText('尚未设置代表图片');
  await closeModal(removeDialog);
  await expectRowImagePlaceholder(page, 'hero_a', '未设置');
  assertClean();
});

test('stage 9 upload and relation failures preserve preview and reuse the successfully created image on retry', async ({ page }) => {
  const api = new RelationApi();
  api.representatives.set(api.sourceId(FIRST_GAME, 'characters/hero_a'), 'portrait_a');
  const assertClean = await prepare(page, api);
  const dialog = await openRepresentative(page, 'characters', 'hero_a', '角色甲');
  const upload = await pngUpload(page, 32, 20);
  const expectedPreview = `data:image/png;base64,${upload.buffer.toString('base64')}`;
  await selectImageFile(dialog, upload);
  const preview = dialog.getByRole('img', { name: '角色甲待上传代表图片', exact: true });
  await expect(preview).toHaveAttribute('src', expectedPreview);
  api.imageCreateFailure = { status: 400, code: '400.VALIDATION_FAILED', message: '图片上传暂时失败', field: 'imageBase64' };
  await dialog.getByRole('button', { name: '上传并使用', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('图片上传暂时失败');
  await expect(preview).toHaveAttribute('src', expectedPreview);
  expect(api.sourceImage(FIRST_GAME, 'characters/hero_a')).toBe('portrait_a');
  expect(api.rows[FIRST_GAME]!.images).toHaveLength(3);
  expect(api.writes.filter(write => write.path.endsWith('/representative-image'))).toEqual([]);

  api.imageCreateFailure = null;
  api.imageFailure = { status: 409, code: '409.RELATION_DANGLING', message: '关联写入暂时失败', field: 'imageKey' };
  await dialog.getByRole('button', { name: '上传并使用', exact: true }).click();
  await expect(dialog).toContainText('图片已上传，尚未设为代表图片');
  await expect(dialog).toContainText('关联写入暂时失败');
  await expect(preview).toHaveAttribute('src', expectedPreview);
  expect(api.sourceImage(FIRST_GAME, 'characters/hero_a')).toBe('portrait_a');
  expect(api.rows[FIRST_GAME]!.images).toHaveLength(4);
  const created = api.rows[FIRST_GAME]!.images!.at(-1)!;
  expect(imagePosts(api)).toHaveLength(2);
  api.imageFailure = null;
  await uploadAndUse(dialog);
  expect(imagePosts(api)).toHaveLength(2);
  expect(api.sourceImage(FIRST_GAME, 'characters/hero_a')).toBe(created.imageKey);
  expect(api.rows[FIRST_GAME]!.images).toHaveLength(4);
  await expect(dialog.getByRole('img', { name: '角色甲代表图片', exact: true })).toHaveAttribute('src', expectedPreview);
  await closeModal(dialog);
  await navigate(page, 'images');
  await row(page, String(created.imageKey)).getByRole('button', { name: '用途关系', exact: true }).click();
  await expect(modal(page, '图片用途关系').getByRole('region', { name: '角色图片用途', exact: true })).toContainText('角色甲');
  assertClean();
});

test('stage 9 switching context during file preparation ignores the late file and uploads only the new game draft', async ({ page }) => {
  type FileReadControl = { relationReadStarted?: boolean; releaseRelationRead?: () => Promise<void> };
  await page.addInitScript(() => {
    const control = window as Window & { relationReadStarted?: boolean; releaseRelationRead?: () => Promise<void> };
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob: Blob) {
      if (!(blob instanceof File) || blob.name !== 'late-context.png') { read.call(this, blob); return; }
      control.relationReadStarted = true;
      control.releaseRelationRead = () => new Promise<void>(resolve => {
        this.addEventListener('loadend', () => resolve(), { once: true });
        read.call(this, blob);
      });
    };
  });
  const api = new RelationApi();
  const assertClean = await prepare(page, api);
  const oldUpload = await pngUpload(page, 64, 64, 'late-context.png', '#dc2626');
  const newUpload = await pngUpload(page, 32, 20, 'new-context.png', '#16a34a');
  const oldDialog = await openRepresentative(page, 'characters', 'hero_a', '角色甲');
  await selectImageFile(oldDialog, oldUpload);
  await page.waitForFunction(() => (window as Window & FileReadControl).relationReadStarted === true);
  await expect(oldDialog.getByRole('button', { name: '上传并使用', exact: true })).toBeDisabled();
  const discard = (prompt: import('@playwright/test').Dialog) => prompt.accept();
  page.on('dialog', discard);
  await navigate(page, 'equipment');
  await expect(oldDialog).toBeHidden();
  page.off('dialog', discard);
  await page.locator('.app-toolbar-field--game .arco-select-view').click();
  await page.locator('.arco-select-option:visible').filter({ hasText: SECOND_GAME }).click();
  await expect(page.locator('.app-toolbar-field--game')).toContainText(SECOND_GAME);
  const dialog = await openRepresentative(page, 'characters', 'hero_a', '另一游戏角色甲');
  await expect(dialog.getByRole('radio', { name: '上传新图片', exact: true })).toBeChecked();
  await expect(dialog.getByRole('img', { name: '另一游戏角色甲待上传代表图片', exact: true })).toHaveCount(0);
  await selectImageFile(dialog, newUpload);
  const expectedPreview = `data:image/png;base64,${newUpload.buffer.toString('base64')}`;
  const preview = dialog.getByRole('img', { name: '另一游戏角色甲待上传代表图片', exact: true });
  await expect(preview).toHaveAttribute('src', expectedPreview);
  await page.evaluate(async () => {
    await (window as Window & FileReadControl).releaseRelationRead!();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(preview).toHaveAttribute('src', expectedPreview);
  await uploadAndUse(dialog);
  expect(imagePosts(api)).toHaveLength(1);
  expect(imagePosts(api)[0]!.path).toBe(`/api/admin/games/${SECOND_GAME}/images`);
  expect(imagePosts(api)[0]!.body.imageBase64).toBe(expectedPreview);
  expect(api.sourceImage(SECOND_GAME, 'characters/hero_a')).toBeTruthy();
  expect(api.sourceImage(FIRST_GAME, 'characters/hero_a')).toBeUndefined();
  assertClean();
});
