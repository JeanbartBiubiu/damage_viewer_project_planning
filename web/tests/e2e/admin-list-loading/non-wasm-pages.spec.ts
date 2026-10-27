import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { expect, test, type Page, type Route } from '@playwright/test';
import { createServer, transformWithEsbuild, type ViteDevServer } from 'vite';

// 仅在测试内提供组件页，不加入产品路由或生产构建。所有接口均为固定测试替身。
const MOCK_API_BASE = 'http://127.0.0.1:19083';
const GAME_ID = 'demo';
const ADMIN_TOKEN = 'admin-list-loading-test';
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
    function Harness() {
      const [game, setGame] = useState(${JSON.stringify(GAME_ID)});
      const [token, setToken] = useState(${JSON.stringify(ADMIN_TOKEN)});
      const onDirtyChange = useCallback(() => {}, []);
      const Page = new URLSearchParams(location.search).get('resource') === 'characters'
        ? CharacterManagementPage : EquipmentManagementPage;
      return <>
        <div aria-label="测试上下文">
          <button onClick={() => setToken('')}>清空令牌</button>
          <button onClick={() => setToken(${JSON.stringify(ADMIN_TOKEN)})}>恢复令牌</button>
          <button onClick={() => setGame(null)}>清空游戏</button>
          <button onClick={() => setGame(${JSON.stringify(GAME_ID)})}>恢复游戏</button>
        </div>
        <main aria-label="列表组件">
          <Page apiBaseUrl=${JSON.stringify(MOCK_API_BASE)} selectedGameId={game}
            adminToken={token} onDirtyChange={onDirtyChange} />
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
            return (await transformWithEsbuild(source, HARNESS_MODULE, { jsx: 'automatic' })).code;
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
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== MOCK_API_BASE || request.method() !== 'GET') {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname === '/api/games') {
      await json(route, [{ gameId: GAME_ID, gameName: '测试游戏', representativeImageKey: null }]);
      return;
    }
    if (request.headers().authorization !== `Bearer ${ADMIN_TOKEN}`) {
      unexpected.push(`缺少测试授权 ${url.pathname}`);
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

for (const resource of resources) {
  for (const context of ['令牌', '游戏'] as const) {
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

  test(`${resource.label}正常管理页清空并恢复令牌保持只读且无未授权请求`, async ({ page }) => {
    const mock = await installMock(page, resource, (route) => json(route, listBody(resource, '正常')));
    await page.addInitScript(({ apiBase, token }) => {
      localStorage.setItem('damage-viewer.web.api-base-url', apiBase);
      localStorage.setItem('damage-viewer.web.admin-token', token);
    }, { apiBase: MOCK_API_BASE, token: ADMIN_TOKEN });
    await page.goto(`${harnessBase}#/${resource.path}`);
    const main = page.locator('.app-main');
    await expect(main.getByRole('cell', { name: `正常${resource.label}`, exact: true })).toBeVisible();
    const tokenInput = page.getByPlaceholder('粘贴 Admin JWT', { exact: true });
    await tokenInput.fill('');
    await expect(main.getByRole('cell', { name: `正常${resource.label}`, exact: true })).toHaveCount(0);
    await expect(main.getByText('请先在顶部配置 Admin Token。', { exact: true })).toBeVisible();
    const clearedCount = mock.listCount();
    await expect(main.locator('.data-table-shell .arco-spin-loading')).toHaveCount(0);
    expect(mock.listCount()).toBe(clearedCount);
    await tokenInput.fill(ADMIN_TOKEN);
    await expect(main.getByRole('cell', { name: `正常${resource.label}`, exact: true })).toBeVisible();
    expect(mock.listCount()).toBeGreaterThan(clearedCount);
    mock.assertClean();
  });
}
