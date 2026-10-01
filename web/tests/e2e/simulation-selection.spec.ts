import { expect, test, type Page } from '@playwright/test';
import { chooseSimulationEntity } from '../fixtures/simulationSelection';

test.use({ trace: 'off' });

const API = 'http://127.0.0.1:19106';
const TOKEN = 'selection-fixture-only';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=';
const select = (page: Page, label: string) => page.locator(`.simulation-entity-select[aria-label="${label}"]`);
const options = (page: Page) => page.locator('.arco-select-option:visible');

async function installApi(page: Page) {
  const reads: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ api, token }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', token);
  }, { api: API, token: TOKEN });
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    expect(request.method(), '选择框不得写入管理数据').toBe('GET');
    const url = new URL(request.url());
    reads.push(`${url.pathname}${url.search}`);
    const reply = (data: unknown) => route.fulfill({ json: data });
    if (url.pathname === '/api/games') return reply([
      { gameId: 'demo', gameName: '下拉测试', representativeImageKey: null },
      { gameId: 'other', gameName: '其他游戏', representativeImageKey: null }
    ]);
    expect(request.headers().authorization).toBe(`Bearer ${TOKEN}`);
    const resource = url.pathname.replace(/^\/api\/admin\/games\/[^/]+\//, '');
    const gameId = url.pathname.split('/')[4]!;
    if (resource === 'characters') {
      const items = [
        { characterKey: 'hero_alpha', name: gameId === 'demo' ? '英雄甲' : '其他甲' },
        { characterKey: 'hero_beta', name: gameId === 'demo' ? '英雄乙' : '其他乙' },
        ...Array.from({ length: 60 }, (_, index) => ({ characterKey: `extra_${index}`, name: `候选角色${index}` }))
      ].map(row => ({ ...row, gameId, description: null, createdAt: '', updatedAt: '' }));
      return reply({ items, total: items.length });
    }
    if (resource === 'character-skill-relations') {
      const characterKey = url.searchParams.get('characterKey')!;
      const keys = characterKey === 'hero_alpha' ? ['attack_alpha', 'spell', 'disabled'] : ['attack_beta'];
      const items = keys.map((skillKey, index) => ({ gameId, characterKey, characterName: '英雄', skillKey,
        skillName: skillKey, skillStatus: skillKey === 'disabled' ? 'DISABLED' : 'ENABLED', sortOrder: index }));
      return reply({ items, total: items.length });
    }
    if (/^skills\/[^/]+$/.test(resource)) {
      const skillKey = resource.split('/')[1]!;
      return reply({ gameId, skillKey, name: skillKey === 'spell' ? '主动技能' : `普通攻击${skillKey === 'attack_alpha' ? '甲' : '乙'}`,
        description: null, maxLevel: 1, status: 'ENABLED', sortOrder: 0,
        skillCategoryKeys: [skillKey === 'spell' ? 'active' : 'basic_attack'], createdAt: '', updatedAt: '' });
    }
    if (resource.endsWith('representative-image')) {
      const key = resource.split('/')[1];
      return reply({ image: key?.startsWith('hero_') || key?.startsWith('attack_')
        ? { imageKey: `${key}_portrait`, name: '图标', enabled: true } : null });
    }
    if (/^images\/[^/]+$/.test(resource)) return reply({
      gameId, imageKey: resource.split('/')[1], name: '图标', description: null, imageBase64: PNG,
      mimeType: 'image/png', byteSize: 68, width: 1, height: 1, enabled: true,
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z'
    });
    throw new Error(`未定义只读接口 ${resource}`);
  });
  return { reads, assertClean: () => expect(errors).toEqual([]) };
}

test('名称和标识均可搜索，候选与选中项带头像，普攻按挂载和分类筛选', async ({ page }) => {
  const diagnostics = await installApi(page);
  await page.goto('/#/simulation/basic-attack');
  await expect(select(page, '攻击方角色')).not.toHaveClass(/arco-select-disabled/);
  await select(page, '攻击方角色').click();
  await select(page, '攻击方角色').locator('input').fill('英雄甲');
  await expect(options(page)).toHaveCount(1);
  const avatar = options(page).getByRole('img', { name: '英雄甲', exact: true });
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
  await options(page).click();
  await expect(options(page)).toHaveCount(0);
  await expect(select(page, '攻击方角色').getByRole('img', { name: '英雄甲', exact: true })).toBeVisible();
  const rosterReads = diagnostics.reads.filter(path => path === '/api/admin/games/demo/characters').length;
  await chooseSimulationEntity(page, '目标角色', 'hero_beta');
  await select(page, '普攻技能').click();
  await expect(options(page)).toHaveCount(1);
  await expect(options(page)).toContainText('普通攻击甲');
  await expect(options(page).getByRole('img', { name: '普通攻击甲', exact: true })).toBeVisible();
  await options(page).click();
  await expect(options(page)).toHaveCount(0);
  await expect(select(page, '普攻技能').locator('img[alt]')).toBeVisible();
  await page.getByRole('spinbutton', { name: '普攻技能等级', exact: true }).fill('1');
  await chooseSimulationEntity(page, '攻击方角色', 'hero_beta');
  await expect(select(page, '普攻技能')).not.toContainText('普通攻击甲');
  await expect(page.getByRole('spinbutton', { name: '普攻技能等级', exact: true })).toHaveValue('');
  await chooseSimulationEntity(page, '普攻技能', 'attack_beta');
  expect(diagnostics.reads.filter(path => path === '/api/admin/games/demo/characters')).toHaveLength(rosterReads);
  await select(page, '攻击方角色').hover();
  await select(page, '攻击方角色').locator('.arco-select-clear-icon').click();
  await expect(select(page, '普攻技能')).toHaveClass(/arco-select-disabled/);
  await expect(select(page, '攻击方角色')).not.toContainText('英雄乙');
  await select(page, '攻击方角色').click();
  await select(page, '攻击方角色').locator('input').fill(' HERO_ALPHA ');
  await expect(options(page)).toHaveCount(1);
  await select(page, '攻击方角色').locator('input').press('ArrowDown');
  await select(page, '攻击方角色').locator('input').press('Enter');
  await expect(select(page, '攻击方角色')).toContainText('英雄甲');
  expect(diagnostics.reads.some(path => /\/images$/.test(path))).toBe(false);
  expect(diagnostics.reads.some(path => /\/skills$/.test(path))).toBe(false);
  expect(diagnostics.reads.some(path => /\/skills\/disabled$/.test(path))).toBe(false);
  diagnostics.assertClean();
});

test.describe('真实只读目录', () => {
  test('真实角色头像与共享普攻由现有接口进入选择框，无全量图片读取', async ({ page }, testInfo) => {
    test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实服务检查需显式启用。');
    const api = process.env.SIMULATION_LIVE_API_BASE_URL || 'http://127.0.0.1:8080';
    const token = process.env.SIMULATION_LIVE_ADMIN_TOKEN || 'local-readonly-check';
    await page.addInitScript(({ api, token }) => {
      localStorage.setItem('damage-viewer.web.api-base-url', api);
      localStorage.setItem('damage-viewer.web.admin-token', token);
    }, { api, token });
    const paths: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === api && request.method() !== 'OPTIONS') {
        expect(request.method()).toBe('GET');
        paths.push(url.pathname);
      }
    });
    await page.goto('/#/simulation/basic-attack');
    await chooseSimulationEntity(page, '攻击方角色', 'champion_aatrox');
    const sourceAvatar = select(page, '攻击方角色').locator('img[alt]');
    await expect(sourceAvatar).toBeVisible();
    await expect.poll(() => sourceAvatar.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    await chooseSimulationEntity(page, '目标角色', 'champion_ahri');
    await expect(select(page, '目标角色').locator('img[alt]')).toBeVisible();
    await chooseSimulationEntity(page, '普攻技能', 'shared_basic_attack');
    await expect(select(page, '普攻技能')).toContainText('普通攻击·共享');
    expect(paths.some(path => /\/images$/.test(path))).toBe(false);
    await page.getByRole('region', { name: '普攻模拟', exact: true }).screenshot({ path: testInfo.outputPath('实际下拉选择.png') });
  });
});

test('虚拟列表按可见候选加载，缓存命中不再次下载，缺头像使用占位', async ({ page }) => {
  const diagnostics = await installApi(page);
  await page.goto('/#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', 'hero_alpha');
  await expect(select(page, '攻击方角色').locator('img[alt]')).toBeVisible();
  await chooseSimulationEntity(page, '目标角色', 'hero_alpha');
  await expect(select(page, '目标角色').locator('img[alt]')).toBeVisible();
  expect(diagnostics.reads.filter(path => path.endsWith('/images/hero_alpha_portrait'))).toHaveLength(1);
  await page.reload();
  await chooseSimulationEntity(page, '攻击方角色', 'hero_alpha');
  await expect(select(page, '攻击方角色').locator('img[alt]')).toBeVisible();
  expect(diagnostics.reads.filter(path => path.endsWith('/images/hero_alpha_portrait'))).toHaveLength(1);
  await chooseSimulationEntity(page, '目标角色', 'extra_59');
  await expect(select(page, '目标角色').getByLabel('候选角色59 未上传图片')).toBeVisible();
  expect(diagnostics.reads.filter(path => /characters\/extra_\d+\/representative-image$/.test(path)).length).toBeLessThan(60);
  diagnostics.assertClean();
});

test('目录失败有重试，技能失败不伪装成没有普攻，输入不丢失', async ({ page }) => {
  const diagnostics = await installApi(page);
  let failing = true;
  await page.route(`${API}/api/admin/games/demo/characters`, async route => {
    if (failing) await route.fulfill({ status: 500, json: { error: { message: '目录失败' } } });
    else await route.fallback();
  });
  await page.goto('/#/simulation/basic-attack');
  await expect(page.getByText(/角色列表读取失败/)).toBeVisible();
  failing = false;
  await page.getByRole('button', { name: '重试角色列表' }).click();
  await page.route(`${API}/api/admin/games/demo/character-skill-relations?**`, route => route.fulfill({ status: 500, json: { error: { message: '技能失败' } } }));
  await chooseSimulationEntity(page, '攻击方角色', 'hero_alpha');
  await expect(page.getByText(/普攻列表读取失败/)).toBeVisible();
  await expect(select(page, '攻击方角色')).toContainText('英雄甲');
  await expect(page.getByRole('button', { name: '读取场景快照' })).toBeDisabled();
  await page.unroute(`${API}/api/admin/games/demo/character-skill-relations?**`);
  await page.getByRole('button', { name: '重试普攻列表' }).click();
  await chooseSimulationEntity(page, '普攻技能', 'attack_alpha');
  diagnostics.assertClean();
});

test('攻击方和游戏切换后迟到目录不覆盖新选项', async ({ page }) => {
  const diagnostics = await installApi(page);
  let release!: () => void;
  let started = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${API}/api/admin/games/demo/character-skill-relations?characterKey=hero_alpha`, async route => {
    started = true;
    await gate;
    try { await route.fulfill({ status: 500, json: { message: '旧目录迟到错误' } }); } catch { /* 已取消。 */ }
  });
  await page.goto('/#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', 'hero_alpha');
  await expect.poll(() => started).toBe(true);
  await chooseSimulationEntity(page, '攻击方角色', 'hero_beta');
  await chooseSimulationEntity(page, '普攻技能', 'attack_beta');
  release();
  await expect(page.getByText(/旧目录迟到错误/)).toHaveCount(0);
  await expect(select(page, '普攻技能')).toContainText('普通攻击乙');
  await page.locator('.app-toolbar-field--game .arco-select').click();
  await options(page).filter({ hasText: 'other /' }).click();
  await expect(select(page, '攻击方角色')).not.toContainText('英雄乙');
  await expect(select(page, '普攻技能')).toHaveClass(/arco-select-disabled/);
  await chooseSimulationEntity(page, '攻击方角色', 'hero_alpha');
  await expect(select(page, '攻击方角色')).toContainText('其他甲');
  diagnostics.assertClean();
});
