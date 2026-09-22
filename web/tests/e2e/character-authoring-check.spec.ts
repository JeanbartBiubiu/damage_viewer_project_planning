import { expect, test, type Route } from '@playwright/test';

test('角色录入检查失败重试、技能往返和迟到响应隔离', async ({ page }) => {
  const base = 'http://127.0.0.1:19082';
  const calls: string[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  const now = '2026-09-06T12:00:00Z';
  const characters = ['ez', 'lux'].map((characterKey, index) => ({ gameId: 'demo', characterKey, name: index ? '拉克丝' : '伊泽瑞尔', description: null, createdAt: now, updatedAt: now }));
  const skill = (owner: string) => ({ gameId: 'demo', skillKey: owner + '_q', name: owner === 'ez' ? '秘术射击' : '光之束缚', description: null, maxLevel: 5, status: 'ENABLED', sortOrder: 10, skillCategoryKeys: [], createdAt: now, updatedAt: now });
  const report = (owner: string) => ({ gameId: 'demo', characterKey: owner, characterName: owner === 'ez' ? '伊泽瑞尔' : '拉克丝', checkedAt: now,
    conclusions: { structure: 'NO_ERRORS', mechanics: 'NOT_CHECKED', runtime: 'NOT_RUN' },
    summary: { attachedSkillCount: 1, configuredAttributeCount: 0, errorCount: 0, reviewCount: 0 },
    skills: [{ skillKey: owner + '_q', name: skill(owner).name, status: 'ENABLED', maxLevel: 5, sortOrder: 10, effectCount: 1, processCount: 1, triggerRuleCount: 1 }], references: [], issues: [] });
  let failCheck = true;
  let delayEz = false;
  let delayed: Route | undefined;
  let reads = 0;
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  page.on('pageerror', error => errors.push(error.message));
  await page.route(base + '/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' } });
    calls.push(`${request.method()} ${pathname}`);
    if (pathname === '/api/games') return json(route, [{ gameId: 'demo', gameName: '录入检查测试' }]);
    if (pathname.endsWith('/representative-image')) return json(route, { image: null });
    if (pathname.endsWith('/characters')) return json(route, { items: characters, total: characters.length });
    if (pathname.endsWith('/authoring-check')) {
      reads++;
      const owner = pathname.includes('/characters/ez/') ? 'ez' : 'lux';
      if (delayEz && owner === 'ez') { delayed = route; return; }
      if (failCheck) return json(route, { error: { code: '500.CHECK_FAILED', message: '检查读取失败' } }, 500);
      return json(route, report(owner));
    }
    if (pathname.endsWith('/skill-categories')) return json(route, { items: [], total: 0 });
    if (pathname.endsWith('/skills/ez_q')) return json(route, skill('ez'));
    unexpected.push(pathname);
    return json(route, { error: { code: '404.UNMOCKED', message: pathname } }, 404);
  });
  await page.addInitScript(({ base }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('damage-viewer.web.api-base-url', base);
    localStorage.setItem('damage-viewer.web.admin-token', 'authoring-check-example');
  }, { base });
  await page.goto('/#/characters');
  const ez = page.getByRole('row').filter({ has: page.getByText('伊泽瑞尔', { exact: true }) });
  await expect(ez).toBeVisible();
  await page.getByRole('textbox', { name: '角色关键词', exact: true }).fill('保留的筛选草稿');
  await ez.getByRole('button', { name: '录入检查', exact: true }).click();
  let modal = page.locator('.arco-modal').filter({ has: page.getByText('录入检查 · 伊泽瑞尔', { exact: true }) });
  await expect(modal.getByText(/检查读取失败/)).toBeVisible();
  await expect(modal.getByText(/结构检查：/)).toHaveCount(0);
  failCheck = false;
  await modal.getByRole('button', { name: '重新检查', exact: true }).click();
  await expect(modal.getByText(/结构检查：未发现错误/)).toBeVisible();
  await expect(modal.getByText(/战斗运行：未执行/)).toBeVisible();
  await modal.getByRole('button', { name: '录入技能', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回录入检查', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '技能录入 · 秘术射击', exact: true })).toBeVisible();
  const editor = page.getByRole('dialog', { name: '编辑技能', exact: true });
  await expect(editor.getByLabel('技能名称', { exact: true })).toHaveValue('秘术射击');
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await expect(editor).toBeHidden();
  const beforeReturn = reads;
  await page.getByRole('button', { name: '返回录入检查', exact: true }).click();
  await expect.poll(() => reads).toBeGreaterThan(beforeReturn);
  await expect(modal.getByText(/结构检查：未发现错误/)).toBeVisible();
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '角色关键词', exact: true })).toHaveValue('保留的筛选草稿');

  delayEz = true;
  await ez.getByRole('button', { name: '录入检查', exact: true }).click();
  await expect.poll(() => !!delayed).toBe(true);
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  const lux = page.getByRole('row').filter({ has: page.getByText('拉克丝', { exact: true }) });
  await lux.getByRole('button', { name: '录入检查', exact: true }).click();
  modal = page.locator('.arco-modal').filter({ has: page.getByText('录入检查 · 拉克丝', { exact: true }) });
  await expect(modal.getByText('光之束缚（lux_q）', { exact: true })).toBeVisible();
  await json(delayed!, report('ez'));
  await expect(modal.getByText('光之束缚（lux_q）', { exact: true })).toBeVisible();
  await expect(modal.getByText('秘术射击（ez_q）', { exact: true })).toHaveCount(0);
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  expect(calls.every(call => call.startsWith('GET '))).toBe(true);
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
