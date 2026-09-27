import { expect, test, type Page, type Route } from '@playwright/test';

const API = 'http://127.0.0.1:8080';
const NOW = '2026-09-27T00:00:00Z';
const GAME = { gameId: 'g', gameName: '构筑测试游戏', representativeImageKey: null };
const rules = {
  groupRoles: [{
    roleKey: 'primary', name: '主组', groupKeys: ['precision'], minimumGroups: 1, maximumGroups: 1,
    minimumSelectedSlots: 1, maximumSelectedSlots: 1, distinctFromRoleKeys: [],
    slotRules: [{ groupKey: 'precision', slotKey: 'keystone', minimumSelections: 1, maximumSelections: 1 }]
  }],
  budget: null,
  prerequisites: [],
  exclusions: []
};
const system = {
  gameId: 'g', systemKey: 'paths', name: '路径', description: null, configurationMode: 'SLOT_SELECTION',
  sortOrder: 0, selectionRules: rules, createdAt: NOW, updatedAt: NOW
};
const option = {
  gameId: 'g', systemKey: 'paths', optionKey: 'press', name: '强攻', description: null,
  maxRank: 1, rankCosts: [0], createdAt: NOW, updatedAt: NOW
};
const group = {
  gameId: 'g', systemKey: 'paths', groupKey: 'precision', name: '精密', description: null, sortOrder: 0,
  slots: [{ slotKey: 'keystone', name: '基石', minimumSelections: 0, maximumSelections: 1, optionKeys: ['press'] }],
  createdAt: NOW, updatedAt: NOW
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installApi(page: Page) {
  const unexpected: string[] = [];
  await page.route(`${API}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === '/api/games' && method === 'GET') return json(route, [GAME]);
    const prefix = '/api/admin/games/g';
    if (!url.pathname.startsWith(prefix)) {
      unexpected.push(`${method} ${url.pathname}`);
      return json(route, { error: { message: 'unexpected' } }, 404);
    }
    const path = url.pathname.slice(prefix.length);
    if (path.endsWith('/representative-image') && method === 'GET') return json(route, { image: null });
    if (path === '/build-systems' && method === 'GET') return json(route, { items: [system], total: 1 });
    if (path === '/build-systems/paths/options' && method === 'GET') return json(route, { items: [option], total: 1 });
    if (path === '/build-systems/paths/groups' && method === 'GET') return json(route, { items: [group], total: 1 });
    if (path === '/build-systems/paths/definition' && method === 'GET') {
      return json(route, { system, groups: [group], options: [option], skillRelations: [] });
    }
    unexpected.push(`${method} ${path}`);
    return json(route, { error: { message: 'unexpected' } }, 404);
  });
  await page.addInitScript(api => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', 'build-management-test');
  }, API);
  return unexpected;
}

test('构筑管理编辑器不猜规则，试配遵守角色位置并保护草稿', async ({ page }) => {
  const unexpected = await installApi(page);
  await page.goto('/#/builds');
  await expect(page.locator('.app-main').getByText('构筑系统管理', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '新增构筑系统', exact: true }).click();
  const create = page.locator('.arco-modal:visible').filter({ hasText: '新增构筑系统' });
  await create.getByLabel('系统标识', { exact: true }).fill('new_system');
  await create.getByLabel('系统名称', { exact: true }).fill('新系统');
  await create.getByRole('button', { name: '保存', exact: true }).click();
  await expect(create.getByText('请选择配置方式。', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await create.getByRole('button', { name: '取消', exact: true }).click();
  await expect(create).toBeHidden();

  await page.getByRole('tab', { name: '可选项', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'press', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '分组与位置', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'precision', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '试配与校验', exact: true }).click();
  await expect(page.getByText('试配只在当前页面校验，不会保存方案，也不会调用战斗运行。', { exact: false })).toBeVisible();
  await expect(page.getByText('基石（keystone）最少 1，最多 1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '添加选择', exact: true }).click();
  const optionSelect = page.getByLabel('基石选择1', { exact: true });
  await expect(optionSelect).not.toContainText('强攻');
  let prompt = '';
  page.once('dialog', dialog => { prompt = dialog.message(); return dialog.dismiss(); });
  await page.getByRole('tab', { name: '系统与规则', exact: true }).click();
  expect(prompt).toContain('尚未保存');
  await expect(page.getByRole('tab', { name: '试配与校验', exact: true })).toHaveAttribute('aria-selected', 'true');

  await optionSelect.click();
  await page.locator('.arco-select-option:visible').filter({ hasText: '强攻 · press' }).click();
  await page.getByRole('button', { name: '校验当前试配', exact: true }).click();
  await expect(page.getByText('当前角色构筑通过结构校验。', { exact: false })).toBeVisible();
  expect(unexpected).toEqual([]);
});
