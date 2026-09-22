import { expect, test, type Page, type Route } from '@playwright/test';

const API = 'http://127.0.0.1:19083';
const FIRST_GAME = 'authoring_p9';
const SECOND_GAME = 'authoring_p9_other';
const NOW = '2026-09-06T12:00:00Z';

type Json = Record<string, unknown>;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: status === 204 ? '' : JSON.stringify(body)
  });
}

function skillRow(gameId: string, skillKey: string, name: string, status: 'ENABLED' | 'DISABLED' = 'ENABLED', sortOrder = 0): Json {
  return {
    gameId, skillKey, name, description: null, maxLevel: 5, status, sortOrder,
    skillCategoryKeys: [], createdAt: NOW, updatedAt: NOW
  };
}

function valueRule(value: Json, multiplier = 1, min: number | null = null, max: number | null = null) {
  return { value, fixedMultiplier: multiplier, fixedMinValue: min, fixedMaxValue: max };
}

function baseResult(overrides: Json): Json {
  return {
    description: null,
    sortOrder: 0,
    spellShieldBlockScope: null,
    lifecycleBehavior: null,
    ...overrides
  };
}

function summaryEffect(gameId: string, skillKey: string): Json {
  return {
    gameId,
    skillKey,
    effectKey: 'summary_effect',
    name: '摘要效果',
    description: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    lifecycle: {
      durationValue: { kind: 'FIXED', value: 1000 },
      maxStacksValue: { kind: 'FIXED', value: 1 },
      applicationStacksValue: { kind: 'FIXED', value: 1 },
      instanceScope: 'SOURCE_TARGET',
      reapplicationStackMode: 'KEEP',
      reapplicationDurationMode: 'REFRESH_ALL',
      expiryMode: 'ALL_AT_ONCE',
      periodicIntervalValue: null,
      firstPeriodicExecution: null
    },
    results: [
      baseResult({
        resultKey: 'reduce_zero', name: '减少冷却零', resultType: 'COOLDOWN_CHANGE', target: 'SOURCE',
        valueRule: valueRule({ kind: 'FIXED', value: 0 }),
        detail: { operation: 'REDUCE', affectedSkillScope: { mode: 'ALL', skillKeys: [], skillCategoryKeys: [] } }
      }),
      baseResult({
        resultKey: 'reset_cd', name: '重置冷却', resultType: 'COOLDOWN_CHANGE', target: 'SOURCE',
        valueRule: null,
        detail: { operation: 'RESET', affectedSkillScope: { mode: 'ALL', skillKeys: [], skillCategoryKeys: [] } }
      }),
      baseResult({
        resultKey: 'ratio_cd', name: '比例减少', resultType: 'COOLDOWN_CHANGE', target: 'SOURCE',
        valueRule: valueRule({ kind: 'FIXED', value: 0.7 }),
        detail: { operation: 'REDUCE_REMAINING_RATIO', affectedSkillScope: { mode: 'ALL', skillKeys: [], skillCategoryKeys: [] } }
      }),
      baseResult({
        resultKey: 'param_cd', name: '参数增加', resultType: 'COOLDOWN_CHANGE', target: 'SOURCE',
        valueRule: valueRule({ kind: 'PARAMETER', parameterKey: 'cooldown_ms' }, 2, 0, 4000),
        detail: { operation: 'INCREASE', affectedSkillScope: { mode: 'ALL', skillKeys: [], skillCategoryKeys: [] } }
      }),
      baseResult({
        resultKey: 'many_skills', name: '指定多项技能', resultType: 'COOLDOWN_CHANGE', target: 'SOURCE',
        valueRule: valueRule({ kind: 'FIXED', value: 100 }),
        detail: {
          operation: 'REDUCE',
          affectedSkillScope: {
            mode: 'SKILLS',
            skillKeys: ['skill_a', 'skill_b', 'skill_c', 'skill_d', 'skill_e', 'skill_f'],
            skillCategoryKeys: []
          }
        }
      }),
      baseResult({
        resultKey: 'slow_apply', name: '施加减速', resultType: 'STATUS_OPERATION', target: 'TARGET',
        valueRule: valueRule({ kind: 'FIXED', value: 0 }, 1, 0, 1),
        lifecycleBehavior: {
          moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
          reapplicationValueMode: 'REPLACE', periodicExecutionMode: null
        },
        detail: { statusKey: 'slow', operation: 'APPLY' }
      }),
      baseResult({
        resultKey: 'extend_ms', name: '延长时长', resultType: 'LIFECYCLE_OPERATION', target: 'TARGET',
        valueRule: valueRule({ kind: 'FIXED', value: 1000 }),
        detail: { targetEffectKey: 'other_buff', operation: 'EXTEND_DURATION' }
      }),
      baseResult({
        resultKey: 'add_stacks', name: '增加层数', resultType: 'LIFECYCLE_OPERATION', target: 'TARGET',
        valueRule: valueRule({ kind: 'FIXED', value: 2 }),
        detail: { targetEffectKey: 'other_buff', operation: 'INCREASE' }
      }),
      baseResult({
        resultKey: 'attr_named', name: '增加攻击', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE',
        valueRule: valueRule({ kind: 'FIXED', value: 0 }),
        detail: { attributeKey: 'attack', operation: 'INCREASE', modifierZoneKey: null }
      }),
      baseResult({
        resultKey: 'taken_ratio', name: '降低伤害', resultType: 'DAMAGE_MODIFIER', target: 'TARGET',
        valueRule: valueRule({ kind: 'FIXED', value: 0.25 }),
        lifecycleBehavior: {
          moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
          reapplicationValueMode: 'KEEP', periodicExecutionMode: null
        },
        detail: {
          modifierZoneKey: 'damage_ratio', direction: 'TAKEN', operation: 'DECREASE',
          damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY', criticalFilter: 'ANY'
        }
      })
    ]
  };
}

function catalogs(gameId: string) {
  const prefix = gameId === FIRST_GAME ? '' : '另一游戏';
  return {
    runes: gameId === FIRST_GAME
      ? Array.from({ length: 26 }, (_, index) => ({
        gameId, runeKey: `r_${String(index + 1).padStart(2, '0')}`,
        name: `符文${index + 1}`, category: index === 25 ? 'MINOR' : 'MINOR',
        description: null, createdAt: NOW, updatedAt: NOW
      }))
      : [{ gameId, runeKey: 'other_rune', name: `${prefix}符文`, category: 'KEYSTONE', description: null, createdAt: NOW, updatedAt: NOW }],
    'rune-paths': gameId === FIRST_GAME
      ? [{
        gameId, pathKey: 'path_a', name: '测试分组', kind: 'RUNE_PATH', sortOrder: 0, slots: [],
        description: null, createdAt: NOW, updatedAt: NOW
      }]
      : [] as Json[],
    skills: gameId === FIRST_GAME
      ? [
        skillRow(gameId, 'strike', '打击技能'),
        skillRow(gameId, 'skill_a', '技能甲'),
        skillRow(gameId, 'skill_b', '技能乙'),
        skillRow(gameId, 'skill_c', '技能丙'),
        skillRow(gameId, 'skill_d', '技能丁'),
        skillRow(gameId, 'skill_e', '技能戊', 'DISABLED')
      ]
      : [skillRow(gameId, 'other_skill', `${prefix}技能`)],
    'skill-categories': gameId === FIRST_GAME
      ? [{ gameId, skillCategoryKey: 'mage', name: '法师', description: null, status: 'ENABLED', sortOrder: 0, createdAt: NOW, updatedAt: NOW }]
      : [],
    attributes: [{
      gameId, attributeKey: 'attack', name: `${prefix}攻击`, valueType: 'DECIMAL',
      minValue: 0, maxValue: null, description: null, status: 'ENABLED', sortOrder: 0, createdAt: NOW, updatedAt: NOW
    }],
    statuses: [{
      gameId, statusKey: 'slow', statusKind: 'MOVEMENT_SLOW', name: `${prefix}寒冰`,
      description: null, status: 'ENABLED', sortOrder: 0, createdAt: NOW, updatedAt: NOW
    }]
  };
}

class AuthoringP9Api {
  unexpected: string[] = [];
  writes: Array<{ method: string; path: string }> = [];
  holdSkill: Route | undefined;
  delayFirstSkill = false;
  failSkillCatalog = false;
  skillListReads = 0;
  catalogs = { [FIRST_GAME]: catalogs(FIRST_GAME), [SECOND_GAME]: catalogs(SECOND_GAME) };

  async install(page: Page) {
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS'
          }
        });
        return;
      }
      if (url.origin !== API) {
        this.unexpected.push(`${request.method()} ${url.href}`);
        await route.abort();
        return;
      }
      await this.dispatch(route, url);
    });
  }

  async dispatch(route: Route, url: URL) {
    const method = route.request().method();
    const pathname = url.pathname;
    if (method !== 'GET') this.writes.push({ method, path: pathname });
    if (method === 'GET' && pathname === '/api/games') {
      await json(route, [
        { gameId: FIRST_GAME, gameName: '第9项游戏' },
        { gameId: SECOND_GAME, gameName: '第9项另一游戏' }
      ]);
      return;
    }
    const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (segments[0] !== 'api' || segments[1] !== 'admin' || segments[2] !== 'games' || !this.catalogs[segments[3]! as keyof typeof this.catalogs]) {
      this.unexpected.push(`${method} ${pathname}`);
      await json(route, { error: { code: '404.UNMOCKED', message: pathname } }, 404);
      return;
    }
    const gameId = segments[3]!;
    const rows = this.catalogs[gameId as keyof typeof this.catalogs];
    const tail = segments.slice(4);
    if (pathname.endsWith('/representative-image')) {
      await json(route, { image: null });
      return;
    }
    if (pathname.endsWith('/vamp-rules')) {
      await json(route, { rules: [] });
      return;
    }
    if (tail[0] === 'rune-skill-relations' && method === 'GET') {
      const runeKey = url.searchParams.get('runeKey');
      const items = runeKey === 'r_26' && gameId === FIRST_GAME
        ? [{
          gameId, runeKey, runeName: '符文26', skillKey: 'strike', skillName: '打击技能',
          skillStatus: 'ENABLED', sortOrder: 4
        }]
        : [];
      await json(route, { items, total: items.length });
      return;
    }
    if (tail[0] === 'runes' && method === 'GET' && tail.length === 2) {
      const item = rows.runes.find(rune => rune.runeKey === tail[1]);
      if (item) {
        await json(route, item);
        return;
      }
    }
    if (tail[0] === 'runes' && method === 'GET' && tail.length === 1) {
      const keyword = url.searchParams.get('keyword') ?? '';
      const category = url.searchParams.get('category');
      const items = rows.runes.filter(item => (
        (!category || item.category === category)
        && (!keyword || item.name.includes(keyword) || String(item.runeKey).includes(keyword))
      ));
      await json(route, { items, total: items.length });
      return;
    }
    if (tail[0] === 'rune-paths' && method === 'GET' && tail.length === 1) {
      await json(route, { items: rows['rune-paths'], total: rows['rune-paths'].length });
      return;
    }
    if (tail[0] === 'skills' && tail[2] === 'parameters' && method === 'GET') {
      await json(route, [{
        gameId, skillKey: tail[1], parameterKey: 'cooldown_ms', name: '冷却量',
        valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 100, levelValues: null,
        description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW
      }]);
      return;
    }
    if (tail[0] === 'skills' && tail[2] === 'formulas' && method === 'GET') {
      await json(route, [{
        gameId, skillKey: tail[1], formulaKey: 'reduce_ms', name: '减少量',
        description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW
      }]);
      return;
    }
    if (tail[0] === 'skills' && tail[2] === 'effects' && method === 'GET') {
      if (tail.length === 3) {
        await json(route, [
          { gameId, skillKey: tail[1], effectKey: 'summary_effect', name: '摘要效果', description: null, sortOrder: 0, resultCount: 10, lifecycleEnabled: true, createdAt: NOW, updatedAt: NOW },
          { gameId, skillKey: tail[1], effectKey: 'other_buff', name: '其他增益', description: null, sortOrder: 1, resultCount: 0, lifecycleEnabled: true, createdAt: NOW, updatedAt: NOW }
        ]);
        return;
      }
      if (tail[3] === 'summary_effect') {
        await json(route, summaryEffect(gameId, tail[1]!));
        return;
      }
    }
    if (tail[0] === 'skills' && tail.length === 2 && method === 'GET') {
      if (this.delayFirstSkill && gameId === FIRST_GAME && tail[1] === 'strike' && !this.holdSkill) {
        this.holdSkill = route;
        return;
      }
      const item = rows.skills.find(skill => skill.skillKey === tail[1]);
      if (item) {
        await json(route, item);
        return;
      }
    }
    if (tail[0] === 'skills' && tail.length === 1 && method === 'GET') {
      this.skillListReads += 1;
      if (this.failSkillCatalog && this.skillListReads > 1) {
        await json(route, { error: { code: '503.SKILL_CATALOG_FAILED', message: '技能目录暂时失败' } }, 503);
        return;
      }
      await json(route, { items: rows.skills, total: rows.skills.length });
      return;
    }
    if (tail[0] === 'skill-categories' && method === 'GET') {
      await json(route, { items: rows['skill-categories'], total: rows['skill-categories'].length });
      return;
    }
    if (tail[0] === 'attributes' && method === 'GET') {
      await json(route, { items: rows.attributes, total: rows.attributes.length });
      return;
    }
    if (tail[0] === 'statuses' && method === 'GET') {
      await json(route, { items: rows.statuses, total: rows.statuses.length });
      return;
    }
    this.unexpected.push(`${method} ${pathname}`);
    await json(route, { error: { code: '404.UNMOCKED', message: pathname } }, 404);
  }
}

async function prepare(page: Page, api: AuthoringP9Api) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await api.install(page);
  await page.addInitScript(apiBase => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('damage-viewer.web.api-base-url', apiBase);
    localStorage.setItem('damage-viewer.web.admin-token', 'authoring-p9-example');
  }, API);
  await page.goto('/#/runes');
  await expect(page.locator('.app-toolbar-field--game')).toContainText(FIRST_GAME);
  return () => {
    expect(errors, '未捕获浏览器异常').toEqual([]);
    expect(api.unexpected, '未定义或已删除接口请求').toEqual([]);
    expect(api.writes, '本项夹具不得写入正式或隔离接口').toEqual([]);
  };
}

function row(page: Page, key: string) {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name: key, exact: true }) });
}

function modal(page: Page, title: string) {
  return page.locator('.arco-modal:visible').filter({ has: page.locator('.arco-modal-title', { hasText: title }) });
}

async function answerDialog(page: Page, trigger: () => Promise<unknown>, accept: boolean) {
  let message = '';
  const handled = new Promise<void>((resolve, reject) => {
    page.once('dialog', dialog => {
      message = dialog.message();
      (accept ? dialog.accept() : dialog.dismiss()).then(() => resolve(), reject);
    });
  });
  await trigger();
  await handled;
  return message;
}

test('符文关联技能保留筛选分页并确认草稿，切换游戏隔离旧请求', async ({ page }) => {
  const api = new AuthoringP9Api();
  api.delayFirstSkill = true;
  const assertClean = await prepare(page, api);
  await expect(page.locator('tbody tr')).toHaveCount(25);
  await page.getByRole('listitem', { name: '第 2 页', exact: true }).click();
  await expect(row(page, 'r_26')).toBeVisible();
  await page.getByLabel('符文关键词', { exact: true }).fill('保留的筛选草稿');
  await page.getByLabel('筛选符文类别', { exact: true }).click();
  await page.locator('.arco-select-option:visible').filter({ hasText: '小符文' }).click();
  await row(page, 'r_26').getByRole('button', { name: '关联技能', exact: true }).click();
  const relations = modal(page, '关联技能 · 符文26');
  await expect(relations.getByLabel('打击技能排序', { exact: true })).toHaveValue('4');
  await relations.getByLabel('打击技能排序', { exact: true }).fill('9');
  await relations.getByRole('button', { name: '录入技能', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(relations.getByLabel('打击技能排序', { exact: true })).toHaveValue('9');
  await relations.getByRole('button', { name: '录入技能', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect.poll(() => Boolean(api.holdSkill)).toBe(true);
  await expect(page.getByRole('button', { name: '返回符文技能', exact: true })).toBeVisible();
  await expect(page.getByText(/来自符文：符文26（r_26）/)).toBeVisible();
  await expect(page.getByText(/来自装备：/)).toHaveCount(0);
  await json(api.holdSkill!, skillRow(FIRST_GAME, 'strike', '打击技能'));
  api.holdSkill = undefined;
  api.delayFirstSkill = false;
  await expect(page.getByRole('heading', { name: '技能录入 · 打击技能', exact: true })).toBeVisible();
  await row(page, 'strike').getByRole('button', { name: '编辑', exact: true }).click();
  const editor = modal(page, '编辑技能');
  await editor.getByLabel('技能名称', { exact: true }).fill('未保存打击技能');
  expect(await answerDialog(page, () => editor.getByRole('button', { name: '取消', exact: true }).click(), false)).toBe('技能修改尚未保存，确定关闭吗？');
  await expect(page.getByRole('button', { name: '返回符文技能', exact: true })).toBeVisible();
  await expect(editor.getByLabel('技能名称', { exact: true })).toHaveValue('未保存打击技能');
  expect(await answerDialog(page, () => editor.getByRole('button', { name: '取消', exact: true }).click(), true)).toBe('技能修改尚未保存，确定关闭吗？');
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: '返回符文技能', exact: true }).click();
  await expect(page.getByRole('heading', { name: '技能录入 · 打击技能', exact: true })).toHaveCount(0);
  await expect(relations.getByText('打击技能', { exact: true })).toBeVisible();
  await expect(relations.getByLabel('打击技能排序', { exact: true })).toHaveValue('4');
  await relations.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByLabel('符文关键词', { exact: true })).toHaveValue('保留的筛选草稿');
  await expect(page.getByLabel('筛选符文类别', { exact: true })).toContainText('小符文');
  await expect(page.locator('.arco-pagination-item-active')).toHaveText('2');
  await expect(row(page, 'r_26')).toBeVisible();
  await row(page, 'r_26').getByRole('button', { name: '编辑', exact: true }).click();
  const runeEditor = modal(page, '编辑符文');
  await runeEditor.getByLabel('符文名称', { exact: true }).fill('未保存符文');
  expect(await answerDialog(page, () => runeEditor.getByRole('button', { name: '取消', exact: true }).click(), false)).toBe('符文修改尚未完成，确定关闭吗？');
  await expect(runeEditor.getByLabel('符文名称', { exact: true })).toHaveValue('未保存符文');
  expect(await answerDialog(page, () => runeEditor.getByRole('button', { name: '取消', exact: true }).click(), true)).toBe('符文修改尚未完成，确定关闭吗？');
  await expect(modal(page, '编辑符文')).toHaveCount(0);

  await row(page, 'r_26').getByRole('button', { name: '关联技能', exact: true }).click();
  await relations.getByRole('button', { name: '录入技能', exact: true }).click();
  await expect(page.getByRole('heading', { name: '技能录入 · 打击技能', exact: true })).toBeVisible();
  api.delayFirstSkill = true;
  await page.getByRole('button', { name: '返回符文技能', exact: true }).click();
  await relations.getByRole('button', { name: '录入技能', exact: true }).click();
  await expect.poll(() => Boolean(api.holdSkill)).toBe(true);
  await page.locator('.app-toolbar-field--game .arco-select-view').click();
  await page.getByRole('option', { name: `${SECOND_GAME} / 第9项另一游戏`, exact: true }).click();
  await expect(page.getByRole('heading', { name: '符文管理', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回符文技能', exact: true })).toHaveCount(0);
  await expect(row(page, 'other_rune')).toContainText('另一游戏符文');
  await json(api.holdSkill!, skillRow(FIRST_GAME, 'strike', '迟到打击技能'));
  await expect(page.getByRole('button', { name: '返回符文技能', exact: true })).toHaveCount(0);
  await expect(page.getByText('迟到打击技能', { exact: true })).toHaveCount(0);
  await expect(row(page, 'other_rune')).toBeVisible();

  await page.locator('.app-toolbar-field--game .arco-select-view').click();
  await page.getByRole('option', { name: `${FIRST_GAME} / 第9项游戏`, exact: true }).click();
  await expect(row(page, 'r_01')).toBeVisible();
  await page.getByRole('tab', { name: '分组与槽位', exact: true }).click();
  await expect(row(page, 'path_a').getByRole('button', { name: '关联技能', exact: true })).toHaveCount(0);
  await expect(row(page, 'path_a').getByRole('button', { name: '代表图片', exact: true })).toBeVisible();
  assertClean();
});

test('效果结果摘要区分零与空、名称键、失败缺失及大集合展开', async ({ page }) => {
  const api = new AuthoringP9Api();
  api.failSkillCatalog = true;
  const assertClean = await prepare(page, api);
  await page.evaluate(() => { window.location.hash = '#/skills'; });
  await expect(page).toHaveURL(/#\/skills$/);
  await row(page, 'strike').getByRole('button', { name: '效果与结果', exact: true }).click();
  const shell = modal(page, '效果与结果 - 打击技能');
  await shell.getByRole('row').filter({ hasText: '摘要效果' }).getByRole('button', { name: '查看', exact: true }).click();
  const editor = modal(page, '查看效果');
  await expect(editor.getByText(/施法者 · 减少 · 0 × 1 毫秒/)).toBeVisible();
  await expect(editor.getByText('全部技能', { exact: true }).first()).toBeVisible();
  await expect(editor.getByText(/重置为可用 · 无数值/)).toBeVisible();
  await expect(editor.getByText(/0\.7 × 1 比例/)).toBeVisible();
  await expect(editor.getByText(/0\.7 × 1 毫秒/)).toHaveCount(0);
  await expect(editor.getByText('冷却量（cooldown_ms） × 2 下界 0 上界 4000 毫秒')).toBeVisible();
  await expect(editor.getByText(/加载失败/)).toBeVisible();
  await expect(editor.getByText('技能甲（skill_a）')).toHaveCount(0);
  api.failSkillCatalog = false;
  await editor.getByRole('button', { name: '重试技能目录', exact: true }).click();
  await expect(editor.getByText('技能甲（skill_a）')).toBeVisible();
  await expect(editor.getByText('技能乙（skill_b）')).toBeVisible();
  await expect(editor.getByText('技能丙（skill_c）')).toBeVisible();
  await expect(editor.getByText('技能丁（skill_d）')).toHaveCount(0);
  await expect(editor.getByText(/共 6 项/)).toBeVisible();
  await editor.getByRole('button', { name: '展开全部引用（共 6 项）' }).click();
  await expect(editor.getByText('技能丁（skill_d）')).toBeVisible();
  await expect(editor.getByText('技能戊（skill_e）（已停用）')).toBeVisible();
  await expect(editor.getByText('目录缺失（skill_f）')).toBeVisible();
  await editor.getByRole('button', { name: '收起全部引用' }).click();
  await expect(editor.getByText('技能丁（skill_d）')).toHaveCount(0);
  await expect(editor.getByText(/减速比例/)).toBeVisible();
  await expect(editor.getByText(/寒冰（slow）/)).toBeVisible();
  await expect(editor.getByText(/延长剩余时长 · 1000 × 1 毫秒 · 其他增益（other_buff）/)).toBeVisible();
  await expect(editor.getByText(/增加层数 · 2 × 1 层 · 其他增益（other_buff）/)).toBeVisible();
  await expect(editor.getByText(/增加 · 攻击（attack） · 0 × 1/)).toBeVisible();
  await expect(editor.getByText(/降低 · 0\.25 × 1 比例/)).toBeVisible();
  await expect(editor.getByText('加载失败 毫秒')).toHaveCount(0);
  await expect(editor.getByText('未配置 毫秒')).toHaveCount(0);
  await expect(shell.getByText('0 × 1 毫秒')).toHaveCount(0);
  assertClean();
});
