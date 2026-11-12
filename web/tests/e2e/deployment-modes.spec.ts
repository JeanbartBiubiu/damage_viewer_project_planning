import { expect, test } from '@playwright/test';
import { installSimulationSelectionApi } from '../fixtures/simulationSelection';

test('部署产物只提供对应入口，维护草稿需要独立验证批次', async ({ page }, info) => {
  const writes: Array<{ path: string; batch: string | undefined; csrf: string | undefined }> = [];
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/api/visits') return route.fulfill({ status: 204 });
    if (path === '/api/auth/me') return route.fulfill({ status: 401, json: { error: { code: 'AUTH.SESSION_INVALID', message: '访客' } } });
    if (path === '/api/games') return route.fulfill({ json: [{ gameId: 'demo', gameName: '隔离测试游戏', representativeImageKey: null }] });
    if (request.method() !== 'GET') {
      writes.push({ path, batch: request.headers()['x-damage-maintenance-batch'], csrf: request.headers()['x-csrf-token'] });
      return route.fulfill({ status: 409, json: { error: { code: 'MAINTENANCE.BATCH_MISMATCH', message: '请求未通过批次验证' } } });
    }
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  if (info.project.name === 'viewer') {
    await installSimulationSelectionApi(page, 'http://127.0.0.1:4197', 'demo');
    await page.goto('/#/skills');
    await expect(page).toHaveURL(/#\/simulation\/combat-analysis$/);
    await expect(page.getByRole('heading', { name: '混合战斗分析', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新增技能', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '选择批次', exact: true })).toHaveCount(0);
    await page.goto('/#/simulation/basic-attack');
    await expect(page.getByLabel('指定技能行动计划', { exact: true })).toBeEnabled();
    await page.getByLabel('指定技能行动计划', { exact: true }).check();
    await expect(page.getByLabel('指定技能行动计划', { exact: true })).toBeChecked();
    await page.getByRole('button', { name: '报告问题', exact: true }).click();
    await page.getByLabel('问题说明', { exact: true }).fill('期望技能等级切换后结果对应变化。');
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载复现材料', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('damage-problem-report.json');
    expect(writes).toEqual([]);
    return;
  }
  await page.route('**/internal/maintenance/me', route => route.fulfill({ json: {
    principalId: 'e3e2a480-9bf4-49bb-a036-fef46b341da4', displayName: '隔离维护者', expiresAt: new Date(Date.now() + 600_000).toISOString()
  } }));
  await page.context().addCookies([{ domain: '127.0.0.1', path: '/', name: '__Host-damage-maint-csrf', value: 'fixture-private-csrf', secure: true, sameSite: 'Strict' }]);
  await page.goto('/#/attributes');
  await expect(page.getByRole('button', { name: '选择批次', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '新增属性', exact: true }).click();
  const editor = page.getByRole('dialog').filter({ hasText: '新增属性' });
  await editor.getByLabel('稳定标识', { exact: true }).fill('candidate_damage');
  await editor.getByLabel('属性名称', { exact: true }).fill('候选伤害');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toContainText('候选请求已记录');
  expect(writes).toEqual([]);
  await expect(page.getByRole('button', { name: '下载候选请求', exact: true })).toBeEnabled();
  await expect(editor.getByLabel('属性名称', { exact: true })).toHaveValue('候选伤害');
  page.once('dialog', prompt => { void prompt.accept(); });
  await page.reload();
  await expect(page.getByRole('button', { name: '选择批次', exact: true })).toBeEnabled();
  await page.getByLabel('已验证维护批次', { exact: true }).fill('682ae67a-1be7-4dcf-8ebe-b414b9e949df');
  await page.getByRole('button', { name: '选择批次', exact: true }).click();
  await page.getByRole('button', { name: '新增属性', exact: true }).click();
  await editor.getByLabel('稳定标识', { exact: true }).fill('candidate_damage');
  await editor.getByLabel('属性名称', { exact: true }).fill('候选伤害');
  await expect(editor.getByLabel('稳定标识', { exact: true })).toHaveValue('candidate_damage');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toContainText('请求未通过批次验证');
  expect(writes).toEqual([{ path: '/api/admin/games/demo/attributes', batch: '682ae67a-1be7-4dcf-8ebe-b414b9e949df', csrf: 'fixture-private-csrf' }]);
});
