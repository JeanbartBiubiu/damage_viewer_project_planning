/**
 * Deterministic browser acceptance for the non-calculation attribute management flow.
 * All Backend responses are route mocks; this file does not claim live database evidence.
 */
import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type Route,
  type TestInfo
} from '@playwright/test';

const API_BASE_STORAGE_KEY = 'damage-viewer.web.api-base-url';
const ADMIN_TOKEN_STORAGE_KEY = 'damage-viewer.web.admin-token';
const MOCK_API_BASE = 'http://127.0.0.1:19080';
const GAME_ID = 'demo';
const GAME_NAME = 'Demo Arena';
const ADMIN_TOKEN = 'non-wasm-e2e-token';

type Json = Record<string, unknown>;

type AttributeRow = {
  gameId: string;
  attributeKey: string;
  name: string;
  valueType: 'DECIMAL' | 'INTEGER';
  minValue: number | null;
  maxValue: number | null;
  description: string | null;
  status: 'ENABLED' | 'DISABLED';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type WriteFailure = 'validation' | 'duplicate' | 'not-found' | 'network' | null;

type CapturedWrite = {
  method: string;
  path: string;
  body: Json;
};

const CREATED_AT = '2026-08-22T09:00:00Z';
const UPDATED_AT = '2026-08-22T10:00:00Z';

function attribute(
  attributeKey: string,
  name: string,
  overrides: Partial<AttributeRow> = {}
): AttributeRow {
  return {
    gameId: GAME_ID,
    attributeKey,
    name,
    valueType: 'DECIMAL',
    minValue: 0,
    maxValue: null,
    description: null,
    status: 'ENABLED',
    sortOrder: 100,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides
  };
}

class MockApi {
  attributes: AttributeRow[] = [];
  writeFailure: WriteFailure = null;
  listQueries: Array<{ keyword: string | null; status: string | null }> = [];
  writes: CapturedWrite[] = [];
  unmockedRequests: string[] = [];

  async install(page: Page): Promise<void> {
    await page.route('**/api/**', async (route) => {
      await this.handle(route);
    });
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.href.startsWith(MOCK_API_BASE)) {
      this.unmockedRequests.push(`${request.method()} ${url.href}`);
      await route.abort('failed');
      return;
    }

    try {
      await this.dispatch(route, request, url);
    } catch (error) {
      this.unmockedRequests.push(`${request.method()} ${url.pathname}: ${String(error)}`);
      await this.error(route, 500, '500.MOCK', String(error));
    }
  }

  private async dispatch(route: Route, request: Request, url: URL): Promise<void> {
    const method = request.method().toUpperCase();
    const path = decodeURIComponent(url.pathname);

    if (method === 'GET' && path === '/api/games') {
      await this.json(route, 200, [{ gameId: GAME_ID, gameName: GAME_NAME }]);
      return;
    }

    if (method === 'GET' && path === `/api/games/${GAME_ID}/versions/current`) {
      await this.json(route, 200, {
        gameId: GAME_ID,
        versionCode: '1.0.0',
        releaseDate: '2026-08-01',
        publishedAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        changeRevision: 7
      });
      return;
    }

    if (method === 'GET' && path === `/api/games/${GAME_ID}/combat-data/state`) {
      await this.json(route, 200, {
        gameId: GAME_ID,
        currentRevision: 7,
        data: {
          gameId: GAME_ID,
          currentRevision: 7,
          publishedRevision: 7,
          updatedAt: UPDATED_AT
        }
      });
      return;
    }

    if (path === `/api/admin/games/${GAME_ID}/attributes`) {
      if (method === 'GET') {
        const keyword = url.searchParams.get('keyword');
        const status = url.searchParams.get('status');
        this.listQueries.push({ keyword, status });
        const normalizedKeyword = keyword?.toLocaleLowerCase() ?? '';
        const items = this.attributes.filter((item) => {
          const keywordMatches =
            !normalizedKeyword ||
            item.attributeKey.toLocaleLowerCase().includes(normalizedKeyword) ||
            item.name.toLocaleLowerCase().includes(normalizedKeyword);
          const statusMatches = !status || item.status === status;
          return keywordMatches && statusMatches;
        });
        await this.json(route, 200, { items, total: items.length });
        return;
      }

      if (method === 'POST') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (await this.applyWriteFailure(route)) {
          return;
        }
        const row = attribute(String(body.attributeKey), String(body.name), {
          valueType: body.valueType === 'INTEGER' ? 'INTEGER' : 'DECIMAL',
          minValue: typeof body.minValue === 'number' ? body.minValue : null,
          maxValue: typeof body.maxValue === 'number' ? body.maxValue : null,
          description: typeof body.description === 'string' ? body.description : null,
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder)
        });
        this.attributes.push(row);
        await this.json(route, 201, row);
        return;
      }
    }

    const detail = path.match(new RegExp(`^/api/admin/games/${GAME_ID}/attributes/([^/]+)$`));
    if (detail) {
      const attributeKey = detail[1]!;
      const existing = this.attributes.find((item) => item.attributeKey === attributeKey);

      if (method === 'GET') {
        if (!existing) {
          await this.error(route, 404, '404.ATTRIBUTE_NOT_FOUND', '属性不存在');
          return;
        }
        await this.json(route, 200, existing);
        return;
      }

      if (method === 'PUT') {
        const body = await this.body(request);
        this.writes.push({ method, path, body });
        if (await this.applyWriteFailure(route)) {
          return;
        }
        if (!existing) {
          await this.error(route, 404, '404.ATTRIBUTE_NOT_FOUND', '属性不存在');
          return;
        }
        const next: AttributeRow = {
          ...existing,
          name: String(body.name),
          valueType: body.valueType === 'INTEGER' ? 'INTEGER' : 'DECIMAL',
          minValue: typeof body.minValue === 'number' ? body.minValue : null,
          maxValue: typeof body.maxValue === 'number' ? body.maxValue : null,
          description: typeof body.description === 'string' ? body.description : null,
          status: body.status === 'DISABLED' ? 'DISABLED' : 'ENABLED',
          sortOrder: Number(body.sortOrder),
          updatedAt: '2026-08-22T11:00:00Z'
        };
        this.attributes = this.attributes.map((item) =>
          item.attributeKey === attributeKey ? next : item
        );
        await this.json(route, 200, next);
        return;
      }
    }

    this.unmockedRequests.push(`${method} ${path}`);
    await this.error(route, 404, '404.UNMOCKED', `unmocked API ${method} ${path}`);
  }

  private async applyWriteFailure(route: Route): Promise<boolean> {
    if (this.writeFailure === null) {
      return false;
    }
    if (this.writeFailure === 'network') {
      await route.abort('connectionrefused');
      return true;
    }
    if (this.writeFailure === 'validation') {
      await this.error(route, 400, '400.VALIDATION_FAILED', '属性信息不合法', {
        fieldIssues: [
          {
            field: 'name',
            code: 'FORMAT_INVALID',
            message: '服务端属性名称校验失败'
          }
        ]
      });
      return true;
    }
    if (this.writeFailure === 'duplicate') {
      await this.error(route, 409, '409.ATTRIBUTE_KEY_EXISTS', '稳定标识已存在');
      return true;
    }
    await this.error(route, 404, '404.ATTRIBUTE_NOT_FOUND', '属性不存在');
    return true;
  }

  private async body(request: Request): Promise<Json> {
    const raw = request.postData();
    return raw ? JSON.parse(raw) as Json : {};
  }

  private async json(route: Route, status: number, body: unknown): Promise<void> {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  }

  private async error(
    route: Route,
    status: number,
    code: string,
    message: string,
    details: Json = {}
  ): Promise<void> {
    await this.json(route, status, { error: { code, message, details } });
  }
}

type Diagnostics = {
  assertClean: (label: string) => void;
};

async function prepare(page: Page, mock: MockApi): Promise<Diagnostics> {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await mock.install(page);
  await page.addInitScript(
    ({ apiKey, tokenKey, apiBase, token }) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem(apiKey, apiBase);
      window.localStorage.setItem(tokenKey, token);
    },
    {
      apiKey: API_BASE_STORAGE_KEY,
      tokenKey: ADMIN_TOKEN_STORAGE_KEY,
      apiBase: MOCK_API_BASE,
      token: ADMIN_TOKEN
    }
  );
  return {
    assertClean(label: string) {
      expect(pageErrors, `${label}: uncaught page errors`).toEqual([]);
      expect(mock.unmockedRequests, `${label}: unmocked API calls`).toEqual([]);
    }
  };
}

async function waitForGame(page: Page): Promise<void> {
  await expect(page.locator('.app-toolbar-field--game .arco-select-view-value')).toContainText(
    GAME_ID,
    { timeout: 30_000 }
  );
}

async function openAttributes(page: Page): Promise<void> {
  await page.goto('/#/attributes');
  await waitForGame(page);
  await expect(page.locator('.app-main').getByText('属性管理', { exact: true }).first()).toBeVisible();
}

function attributeRow(page: Page, attributeKey: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: attributeKey, exact: true })
  });
}

function visibleModal(page: Page, title: string): Locator {
  return page.locator('.arco-modal:visible').filter({ hasText: title });
}

async function closeEditorByOutsideOrEscape(page: Page, testInfo: TestInfo): Promise<void> {
  if (testInfo.project.name === 'Desktop Chrome') {
    await page
      .locator('.arco-modal-wrapper:visible')
      .filter({ has: page.locator('.arco-modal:visible') })
      .click({ position: { x: 8, y: 8 } });
    return;
  }
  await page.keyboard.press('Escape');
}

async function fillCreateDraft(
  page: Page,
  values: { key: string; name: string; description?: string }
): Promise<Locator> {
  await page.getByRole('button', { name: '新增属性' }).click();
  const modal = visibleModal(page, '新增属性');
  await expect(modal).toBeVisible();
  await modal.getByLabel('稳定标识').fill(values.key);
  await modal.getByLabel('属性名称').fill(values.name);
  if (values.description !== undefined) {
    await modal.getByLabel('说明').fill(values.description);
  }
  return modal;
}

test.describe('attribute management without Wasm', () => {
  test('empty state, normalized query filtering and reset', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);

    await openAttributes(page);
    await expect(page.getByText('暂无属性，可以新增第一条属性')).toBeVisible();

    mock.attributes = [
      attribute('armor', '护甲', { sortOrder: 10 }),
      attribute('armor_penetration', '护甲穿透', { status: 'DISABLED', sortOrder: 20 }),
      attribute('move_speed', '移动速度', { sortOrder: 30 })
    ];
    await page.getByRole('button', { name: '刷新', exact: true }).last().click();
    await expect(attributeRow(page, 'armor')).toBeVisible();

    await page.getByLabel('关键词').fill('  armor  ');
    const statusGroup = page
      .locator('[aria-label="属性查询"]')
      .getByRole('group', { name: '状态筛选' });
    await statusGroup.getByText('停用', { exact: true }).click();
    await expect(statusGroup.getByRole('radio', { name: '停用' })).toBeChecked();
    await page.getByRole('button', { name: '查询', exact: true }).click();

    await expect(attributeRow(page, 'armor_penetration')).toBeVisible();
    await expect(attributeRow(page, 'armor')).toHaveCount(0);
    await expect.poll(() => mock.listQueries.at(-1)).toEqual({
      keyword: 'armor',
      status: 'DISABLED'
    });

    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(statusGroup.getByRole('radio', { name: '全部' })).toBeChecked();
    await expect(attributeRow(page, 'move_speed')).toBeVisible();
    await expect(page.getByText('共 3 条属性')).toBeVisible();
    diagnostics.assertClean('empty/filter/reset');
  });

  test('creates a trimmed attribute and reads it back from the refreshed list', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);
    await openAttributes(page);

    const modal = await fillCreateDraft(page, {
      key: '  move_speed  ',
      name: '  移动速度  ',
      description: '  角色面板移动速度  '
    });
    await modal.getByLabel('最小值').fill('0');
    await modal.getByLabel('排序').fill('100');
    await modal.getByRole('button', { name: '保存', exact: true }).click();

    await expect(modal).toBeHidden();
    await expect(attributeRow(page, 'move_speed')).toContainText('移动速度');
    await expect(page.getByText('属性「移动速度」已保存。')).toBeVisible();
    expect(mock.writes.at(-1)).toEqual({
      method: 'POST',
      path: `/api/admin/games/${GAME_ID}/attributes`,
      body: {
        attributeKey: 'move_speed',
        name: '移动速度',
        valueType: 'DECIMAL',
        minValue: 0,
        maxValue: null,
        description: '角色面板移动速度',
        status: 'ENABLED',
        sortOrder: 100
      }
    });
    diagnostics.assertClean('create/readback');
  });

  test('views, edits and disables an existing attribute', async ({ page }, testInfo) => {
    const mock = new MockApi();
    mock.attributes = [attribute('move_speed', '移动速度')];
    const diagnostics = await prepare(page, mock);
    await openAttributes(page);
    const row = attributeRow(page, 'move_speed');
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: '查看' }).click();
    const viewModal = visibleModal(page, '查看属性');
    await expect(viewModal.getByLabel('稳定标识')).toBeDisabled();
    await expect(viewModal.getByRole('button', { name: '保存' })).toHaveCount(0);
    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(viewModal).toBeHidden();

    await row.getByRole('button', { name: '编辑' }).click();
    const editModal = visibleModal(page, '编辑属性');
    await expect(editModal.getByLabel('稳定标识')).toBeDisabled();
    await editModal.getByLabel('属性名称').fill('基础移动速度');
    const writesBeforeDiscard = mock.writes.length;
    await closeEditorByOutsideOrEscape(page, testInfo);
    await expect(editModal).toBeHidden();
    expect(mock.writes.length).toBe(writesBeforeDiscard);
    await expect(row).toContainText('移动速度');
    await expect(row.getByText('基础移动速度')).toHaveCount(0);

    await row.getByRole('button', { name: '编辑' }).click();
    await editModal.getByLabel('属性名称').fill('基础移动速度');
    await editModal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(attributeRow(page, 'move_speed')).toContainText('基础移动速度');

    await attributeRow(page, 'move_speed').getByRole('button', { name: '停用' }).click();
    const disableModal = visibleModal(page, '停用属性');
    await expect(disableModal.getByText('确定停用属性「基础移动速度」吗？')).toBeVisible();
    await disableModal.getByRole('button', { name: '停用', exact: true }).click();
    expect(mock.writes.at(-1)?.body.status).toBe('DISABLED');
    await expect(attributeRow(page, 'move_speed').getByRole('button', { name: '启用' })).toBeVisible();

    await attributeRow(page, 'move_speed').getByRole('button', { name: '启用' }).click();
    const enableModal = visibleModal(page, '启用属性');
    mock.writeFailure = 'network';
    await enableModal.getByRole('button', { name: '启用', exact: true }).click();
    await expect(enableModal.getByText(/fetch|network/i)).toBeVisible();
    await expect(enableModal).toBeVisible();
    mock.writeFailure = null;
    await enableModal.getByRole('button', { name: '启用', exact: true }).click();
    expect(mock.writes.at(-1)?.body.status).toBe('ENABLED');
    await expect(attributeRow(page, 'move_speed').getByRole('button', { name: '停用' })).toBeVisible();
    diagnostics.assertClean('view/edit/disable');
  });

  test('keeps the draft for field 400, duplicate 409, 404 and network failures', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);
    await openAttributes(page);
    const modal = await fillCreateDraft(page, {
      key: 'draft_attribute',
      name: '草稿属性'
    });

    mock.writeFailure = 'validation';
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(modal.getByText('服务端属性名称校验失败')).toBeVisible();
    await expect(modal.getByLabel('属性名称')).toHaveValue('草稿属性');

    mock.writeFailure = 'duplicate';
    await modal.getByLabel('属性名称').fill('重复草稿');
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(modal.getByText(/409\.ATTRIBUTE_KEY_EXISTS/)).toBeVisible();
    await expect(modal.getByLabel('属性名称')).toHaveValue('重复草稿');

    mock.writeFailure = 'not-found';
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(modal.getByText(/404\.ATTRIBUTE_NOT_FOUND/)).toBeVisible();
    await expect(modal.getByLabel('属性名称')).toHaveValue('重复草稿');

    mock.writeFailure = 'network';
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await expect(modal.getByText(/fetch|network/i)).toBeVisible();
    await expect(modal.getByLabel('属性名称')).toHaveValue('重复草稿');
    diagnostics.assertClean('write failures retain draft');
  });

  test('confirms unsaved close, route changes and refresh', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);
    await openAttributes(page);

    let modal = await fillCreateDraft(page, { key: 'unsaved_close', name: '未保存关闭' });
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('当前修改尚未保存');
      await dialog.dismiss();
    });
    await modal.getByRole('button', { name: '取消' }).click();
    await expect(modal).toBeVisible();

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await modal.getByRole('button', { name: '取消' }).click();
    await expect(modal).toBeHidden();

    modal = await fillCreateDraft(page, { key: 'unsaved_route', name: '未保存路由' });
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('当前修改尚未保存');
      await dialog.dismiss();
    });
    await page.evaluate(() => {
      window.location.hash = '#/overview';
    });
    await expect(page).toHaveURL(/#\/attributes$/);
    await expect(modal).toBeVisible();

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.evaluate(() => {
      window.location.hash = '#/overview';
    });
    await expect(page).toHaveURL(/#\/overview$/);
    await expect(page.locator('.app-main').getByText('游戏入口', { exact: true }).first()).toBeVisible();

    await page.goto('/#/attributes');
    await waitForGame(page);
    modal = await fillCreateDraft(page, { key: 'unsaved_refresh', name: '未保存刷新' });
    let sawBeforeUnload = false;
    page.once('dialog', async (dialog) => {
      sawBeforeUnload = dialog.type() === 'beforeunload';
      await dialog.accept();
    });
    await page.reload();
    expect(sawBeforeUnload).toBe(true);
    await waitForGame(page);
    await expect(page.locator('.app-main').getByText('属性管理', { exact: true }).first()).toBeVisible();
    diagnostics.assertClean('unsaved guards');
  });

  test('keeps legacy hashes, renders overview and exposes no legacy navigation entry', async ({ page }) => {
    const mock = new MockApi();
    const diagnostics = await prepare(page, mock);
    const legacyHashes = [
      '#/combat-data/effect-steps',
      '#/admin/attribute-definitions',
      '#/entity-growth'
    ];

    for (const hash of legacyHashes) {
      await page.goto(`/${hash}`);
      await waitForGame(page);
      await expect(page.locator('.app-main').getByText('游戏入口', { exact: true }).first()).toBeVisible();
      expect(await page.evaluate(() => window.location.hash)).toBe(hash);
    }

    expect(await page.locator('a[href^="#/combat-data"]').count()).toBe(0);
    expect(await page.locator('a[href="#/entity-growth"]').count()).toBe(0);
    expect(await page.locator('a[href="#/attributes"]').count()).toBe(1);
    diagnostics.assertClean('legacy hash fallback');
  });
});
