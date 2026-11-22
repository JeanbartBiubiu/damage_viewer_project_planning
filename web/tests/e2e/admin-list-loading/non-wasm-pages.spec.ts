import { fulfillAuthSession, openMaintenancePage } from '../../fixtures/authSession';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { expect, test, type Page, type Route } from '@playwright/test';
import { createServer, transformWithOxc, type ViteDevServer } from 'vite';

// 仅在测试内提供组件页，不加入产品路由或生产构建。所有接口均为固定测试替身。
const GAME_ID = 'demo';
const HARNESS_PATH = '/__admin-list-loading';
const HARNESS_MODULE = '/__admin-list-loading.tsx';
const resources = [
  { path: 'characters', label: '角色', unit: '个', key: 'characterKey' },
  { path: 'equipment', label: '装备', unit: '件', key: 'equipmentKey' }
] as const;
type Resource = typeof resources[number];

let server: ViteDevServer;
let harnessBase: string;

test.use({ screenshot: 'off', trace: 'off' });
test.setTimeout(90_000);

test.beforeAll(async () => {
  const source = `
    import React, { useCallback, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import '@arco-design/web-react/dist/css/arco.css';
    import '/src/index.css';
    import { CharacterManagementPage } from '/src/pages/admin/characters/CharacterManagementPage';
    import { EquipmentManagementPage } from '/src/pages/admin/equipment/EquipmentManagementPage';
    import { ImageManagementPage } from '/src/pages/admin/images/ImageManagementPage';
    function Harness() {
      const [game, setGame] = useState(${JSON.stringify(GAME_ID)});
      const onDirtyChange = useCallback(() => {}, []);
      const resource = new URLSearchParams(location.search).get('resource');
      const Page = resource === 'characters'
        ? CharacterManagementPage : EquipmentManagementPage;
      return <>
        <div aria-label="测试上下文">
          <button onClick={() => setGame(null)}>清空游戏</button>
          <button onClick={() => setGame(${JSON.stringify(GAME_ID)})}>恢复游戏</button>
          <button onClick={() => setGame('other_safety')}>切换游戏</button>
        </div>
        <main aria-label="列表组件">
          {resource === 'images'
            ? <ImageManagementPage apiBaseUrl={location.origin} selectedGameId={game}
                selectedGameName={game ?? '未选择'} onDirtyChange={onDirtyChange} />
            : <Page apiBaseUrl={location.origin} selectedGameId={game}
                onDirtyChange={onDirtyChange} />}
        </main>
      </>;
    }
    createRoot(document.getElementById('root')).render(<Harness />);
  `;
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    cacheDir: 'output/admin-list-loading/vite',
    logLevel: 'error',
    plugins: [
      react(),
      {
        name: 'admin-list-loading-test-page',
        resolveId(id) {
          if (id === HARNESS_MODULE) return `\0${HARNESS_MODULE}`;
        },
        async load(id) {
          if (id === `\0${HARNESS_MODULE}`) {
            return (await transformWithOxc(source, HARNESS_MODULE, { jsx: { runtime: 'automatic' } })).code;
          }
        },
        configureServer(viteServer) {
          viteServer.middlewares.use(async (request, response, next) => {
            if (request.url?.split('?')[0] !== HARNESS_PATH) return next();
            response.setHeader('Content-Type', 'text/html');
            response.end(await viteServer.transformIndexHtml(HARNESS_PATH,
              `<div id="root"></div><script type="module" src="${HARNESS_MODULE}"></script>`));
          });
        }
      }
    ],
    server: { host: '127.0.0.1', port: 0 }
  });
  await server.listen();
  harnessBase = server.resolvedUrls!.local[0]!;
});

test.afterAll(async () => { await server?.close(); });

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function listBody(resource: Resource, prefix: string) {
  return {
    items: [{
      gameId: GAME_ID, [resource.key]: `${resource.path}_${prefix}`, name: `${prefix}${resource.label}`,
      description: null, createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z'
    }],
    total: 1
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installMock(page: Page, resource: Resource,
  listResponse: (route: Route, count: number) => Promise<void>) {
  let listCount = 0;
  const unexpected: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/**', async route => {
    if (await fulfillAuthSession(route, false)) return;
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname === '/api/games') {
      await json(route, [{ gameId: GAME_ID, gameName: '测试游戏', representativeImageKey: null }]);
      return;
    }
    if (request.headers().authorization || request.headers()['x-csrf-token'] || request.headers().cookie) {
      unexpected.push(`公开读取不应带凭据 ${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname === `/api/admin/games/${GAME_ID}/${resource.path}`) {
      await listResponse(route, ++listCount);
      return;
    }
    if (new RegExp(`^/api/admin/games/${GAME_ID}/${resource.path}/[^/]+/representative-image$`).test(url.pathname)) {
      await json(route, { image: null });
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.abort('blockedbyclient');
  });
  return {
    listCount: () => listCount,
    assertClean: () => {
      expect(unexpected, '所有接口只允许固定 GET 测试替身').toEqual([]);
      expect(pageErrors, '浏览器无未捕获异常').toEqual([]);
    }
  };
}

async function settleResponse(page: Page, response: ReturnType<Page['waitForResponse']>) {
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('图片同一组件切换游戏清理旧详情加载状态，新游戏同名图片仍可查看', async ({ page }) => {
  const stale = deferred();
  let started = false;
  let settled = false;
  const unexpected: string[] = [];
  const pageErrors: string[] = [];
  const imageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const image = (gameId: string) => ({
    gameId, imageKey: 'same_key', name: `${gameId}图片`, description: null,
    imageBase64, mimeType: 'image/png', byteSize: 70, width: 1, height: 1,
    enabled: true, createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z'
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const publicMatch = /^\/api\/games\/(demo|other_safety)\/images$/.exec(path);
    const detailMatch = /^\/api\/admin\/games\/(demo|other_safety)\/images\/same_key$/.exec(path);
    if (route.request().method() === 'GET' && publicMatch) {
      await json(route, { gameId: publicMatch[1], images: [image(publicMatch[1]!)] });
    } else if (route.request().method() === 'GET' && detailMatch) {
      if (detailMatch[1] === GAME_ID) { started = true; await stale.promise; }
      await json(route, image(detailMatch[1]!));
      if (detailMatch[1] === GAME_ID) settled = true;
    } else {
      unexpected.push(`${route.request().method()} ${path}`);
      await route.abort('blockedbyclient');
    }
  });
  try {
    await page.goto(`${harnessBase}${HARNESS_PATH.slice(1)}?resource=images`);
    await page.getByRole('button', { name: '切换游戏', exact: true }).click();
    await page.getByRole('button', { name: '全量同步', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: 'same_key' })).toBeVisible();
    await page.getByRole('button', { name: '恢复游戏', exact: true }).click();
    await page.getByRole('button', { name: '全量同步', exact: true }).click();
    const view = page.getByRole('row').filter({ hasText: 'same_key' }).getByRole('button', { name: '查看', exact: true });
    await view.click();
    await expect.poll(() => started).toBe(true);
    await expect(view).toHaveClass(/arco-btn-loading/);
    await page.getByRole('button', { name: '切换游戏', exact: true }).click();
    await expect(view).not.toHaveClass(/arco-btn-loading/);
    await view.click();
    const modal = page.getByRole('dialog', { name: '查看图片', exact: true });
    await expect(modal.getByLabel('图片名称', { exact: true })).toHaveValue('other_safety图片');
    stale.release();
    await expect.poll(() => settled).toBe(true);
    await expect(modal.getByLabel('图片名称', { exact: true })).toHaveValue('other_safety图片');
    expect(unexpected).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally { stale.release(); }
});

for (const resource of resources) {
  for (const context of ['游戏'] as const) {
    for (const outcome of ['成功', '失败'] as const) {
      test(`${resource.label}同一组件清空${context}立即停止加载，迟到${outcome}不回填且恢复可重载`, async ({ page }) => {
        const stale = deferred();
        const fresh = deferred();
        const mock = await installMock(page, resource, async (route, count) => {
          if (count === 1) return json(route, listBody(resource, '原列表'));
          if (count === 2) {
            await stale.promise;
            return outcome === '成功'
              ? json(route, listBody(resource, '过期'))
              : json(route, { error: { code: '503.OLD_RESPONSE', message: '过期请求失败' } }, 503);
          }
          await fresh.promise;
          return json(route, listBody(resource, '恢复'));
        });
        const listPath = `/api/admin/games/${GAME_ID}/${resource.path}`;
        try {
          await page.goto(`${harnessBase}${HARNESS_PATH.slice(1)}?resource=${resource.path}`);
          const component = page.getByRole('main', { name: '列表组件' });
          const spinner = component.locator('.data-table-shell .arco-spin-loading');
          await expect(component.getByRole('cell', { name: `原列表${resource.label}`, exact: true })).toBeVisible();
          await component.getByRole('button', { name: '刷新', exact: true }).click();
          await expect.poll(mock.listCount).toBe(2);
          await expect(spinner).toBeVisible();

          await page.getByRole('button', { name: `清空${context}`, exact: true }).click();
          await expect(spinner).toHaveCount(0);
          await expect(component.getByRole('cell', { name: `原列表${resource.label}`, exact: true })).toHaveCount(0);
          await expect(component.getByText(new RegExp(`共\\s+0\\s+${resource.unit}${resource.label}`))).toBeVisible();
          await expect(component.getByRole('button', { name: '刷新', exact: true })).toBeDisabled();
          expect(mock.listCount()).toBe(2);

          // 成功响应在无上下文时返回；失败响应在新请求加载中返回，核对旧 finally 不会结束新加载。
          if (outcome === '失败') {
            await page.getByRole('button', { name: `恢复${context}`, exact: true }).click();
            await expect.poll(mock.listCount).toBe(3);
            await expect(spinner).toBeVisible();
          }
          const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === listPath);
          stale.release();
          await settleResponse(page, oldResponse);
          await expect(component.getByRole('cell', { name: `过期${resource.label}`, exact: true })).toHaveCount(0);
          await expect(component.getByText('过期请求失败', { exact: false })).toHaveCount(0);
          if (outcome === '成功') {
            await expect(spinner).toHaveCount(0);
            await page.getByRole('button', { name: `恢复${context}`, exact: true }).click();
            await expect.poll(mock.listCount).toBe(3);
          }
          await expect(spinner).toBeVisible();
          fresh.release();
          await expect(component.getByRole('cell', { name: `恢复${resource.label}`, exact: true })).toBeVisible();
          await expect(spinner).toHaveCount(0);
          await expect(component.getByRole('button', { name: '刷新', exact: true })).toBeEnabled();
          expect(mock.listCount()).toBe(3);
          mock.assertClean();
        } finally {
          stale.release();
          fresh.release();
        }
      });
    }
  }

  test(`${resource.label}私有维护页匿名读取与刷新不携带身份凭据`, async ({ page }) => {
    const mock = await installMock(page, resource, (route) => json(route, listBody(resource, '正常')));
    await openMaintenancePage(page, `${harnessBase}maintenance.html#/${resource.path}`);
    const main = page.locator('.app-main');
    await expect(main.getByRole('cell', { name: `正常${resource.label}`, exact: true })).toBeVisible();
    const count = mock.listCount();
    await main.locator('.panel-head').getByRole('button', { name: '刷新', exact: true }).click();
    await expect.poll(mock.listCount).toBe(count + 1);
    await expect(main.getByRole('cell', { name: `正常${resource.label}`, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '刷新维护身份', exact: true })).toBeVisible();
    mock.assertClean();
  });
}
