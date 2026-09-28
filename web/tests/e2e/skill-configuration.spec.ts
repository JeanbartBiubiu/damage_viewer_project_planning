import { expect, test, type Page, type Route } from '@playwright/test';
import { configurationMatchesRequest } from '../../src/pages/admin/skills/skillConfigurationDraft';
import type { SkillConfiguration, SkillConfigurationChange } from '../../src/types/skillConfiguration';
import type { UpdateSkillRequest } from '../../src/types/skill';

const API = 'http://127.0.0.1:19088';
const GAME_ID = 'demo';
const NOW = '2026-09-26T00:00:00Z';

type Json = Record<string, unknown>;

function skill(skillKey = 'sample_q', name = '样例技能'): Json {
  return {
    gameId: GAME_ID, skillKey, name, description: null, maxLevel: 2,
    status: 'ENABLED', sortOrder: 0, skillCategoryKeys: [], createdAt: NOW, updatedAt: NOW
  };
}

function parameter(skillKey = 'sample_q'): Json {
  return {
    gameId: GAME_ID, skillKey, parameterKey: 'damage', name: '伤害',
    valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 80, levelValues: null,
    description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW
  };
}

function configuration(): Json {
  return {
    skill: skill(), parameters: [parameter()],
    formulas: [{ gameId: GAME_ID, skillKey: 'sample_q', formulaKey: 'total', name: '总伤害',
      description: null, sortOrder: 0, expression: { nodeType: 'PARAMETER', parameterKey: 'damage' },
      createdAt: NOW, updatedAt: NOW }],
    effects: [], processes: [], internalStates: [], triggerRules: [], baseDigest: 'digest-1'
  };
}

function respond(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  });
}

class ConfigurationApi {
  current = configuration();
  writes: Array<{ method: string; body: Json }> = [];
  reads = 0;
  failFirstConfigurationRead = false;
  ambiguousWrite = false;
  failNextWrite = false;
  failNextReadback = false;
  unexpected: string[] = [];

  async install(page: Page) {
    await page.addInitScript(({ api }) => {
      localStorage.setItem('damage-viewer.web.api-base-url', api);
      localStorage.setItem('damage-viewer.web.admin-token', 'mock-token');
    }, { api: API });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: {
          'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,PATCH,POST,DELETE,OPTIONS'
        } });
        return;
      }
      if (url.origin !== API) {
        this.unexpected.push(`${request.method()} ${url.pathname}`);
        await route.abort();
        return;
      }
      const path = url.pathname;
      if (request.method() === 'GET' && path === '/api/games') {
        await respond(route, [{ gameId: GAME_ID, gameName: '模拟游戏', representativeImageKey: null }]);
      } else if (request.method() === 'GET' && path === `/api/admin/games/${GAME_ID}/skill-categories`) {
        await respond(route, { items: [], total: 0 });
      } else if (request.method() === 'GET' && path === `/api/admin/games/${GAME_ID}/level-config`) {
        await respond(route, { minLevel: 1, maxLevel: 18 });
      } else if (request.method() === 'GET' && path === `/api/admin/games/${GAME_ID}/attributes`) {
        await respond(route, { items: [], total: 0 });
      } else if (request.method() === 'GET' && path === `/api/admin/games/${GAME_ID}/damage-types`) {
        await respond(route, { items: [], total: 0 });
      } else if (request.method() === 'GET' && path === `/api/admin/games/${GAME_ID}/statuses`) {
        await respond(route, { items: [], total: 0 });
      } else if (request.method() === 'GET' && path === `/api/admin/games/${GAME_ID}/vamp-rules`) {
        await respond(route, { rules: [] });
      } else if (request.method() === 'GET' && path === `/api/admin/games/${GAME_ID}/skills`) {
        await respond(route, { items: [this.current.skill], total: 1 });
      } else if (path.endsWith('/configuration') && request.method() === 'GET') {
        this.reads += 1;
        if (this.failFirstConfigurationRead && this.reads === 1) await respond(route, { error: { code: 'READ_FAILED', message: '模拟读取失败' } }, 500);
        else if (this.failNextReadback && this.writes.length) {
          this.failNextReadback = false;
          await respond(route, { error: { code: 'READBACK_FAILED', message: '模拟回读失败' } }, 500);
        }
        else if (path.includes('/sample_q/')) await respond(route, this.current);
        else await respond(route, { error: { code: '404.SKILL_NOT_FOUND', message: '不存在' } }, 404);
      } else if (path.endsWith('/configuration') && (request.method() === 'PATCH' || request.method() === 'POST')) {
        const body = request.postDataJSON() as Json;
        this.writes.push({ method: request.method(), body });
        if (this.failNextWrite) {
          this.failNextWrite = false;
          await respond(route, { error: { code: '409.CONFIGURATION_CHANGED', message: '已有其他修改' } }, 409);
          return;
        }
        const next = structuredClone(this.current);
        if (body.skill && typeof body.skill === 'object') next.skill = { ...(next.skill as Json), ...(body.skill as Json) };
        for (const change of body.changes as Json[]) {
          const target = change.objectType === 'FORMULA' ? 'formulas'
            : change.objectType === 'INTERNAL_STATE' ? 'internalStates'
              : change.objectType === 'EFFECT' ? 'effects'
                : change.objectType === 'PROCESS' ? 'processes'
                  : change.objectType === 'TRIGGER_RULE' ? 'triggerRules' : 'parameters';
          const keyField = change.objectType === 'FORMULA' ? 'formulaKey'
            : change.objectType === 'INTERNAL_STATE' ? 'stateKey'
              : change.objectType === 'EFFECT' ? 'effectKey'
                : change.objectType === 'PROCESS' ? 'processKey'
                  : change.objectType === 'TRIGGER_RULE' ? 'ruleKey' : 'parameterKey';
          const items = next[target] as Json[];
          const key = change.key as string;
          if (change.operation === 'DELETE') next[target] = items.filter((item) => item[keyField] !== key);
          else if (change.operation === 'UPDATE') next[target] = items.map((item) => item[keyField] === key
            ? { ...item, ...(change.value as Json) } : item);
          else next[target] = [...items, {
            ...(change.objectType === 'TRIGGER_RULE' ? {} : { gameId: GAME_ID, skillKey: 'sample_q' }),
            ...(change.value as Json), createdAt: NOW, updatedAt: NOW
          }];
        }
        next.baseDigest = `digest-${this.writes.length + 1}`;
        this.current = next;
        if (this.ambiguousWrite) await route.abort('failed');
        else await respond(route, next);
      } else if (request.method() === 'GET' && path.includes('representative-image')) {
        await respond(route, { image: null });
      } else {
        this.unexpected.push(`${request.method()} ${path}`);
        await respond(route, { error: { code: 'NOT_MOCKED', message: path } }, 404);
      }
    });
  }
}

async function openSkills(page: Page) {
  await page.goto('/#/skills');
  await expect(page.locator('tr', { hasText: 'sample_q' })).toBeVisible();
}

async function openExistingSkill(page: Page, key: string, module = '配置总览') {
  await page.locator('tr', { hasText: key }).getByRole('button', { name: '编辑配置', exact: true }).click();
  const workspace = page.locator('[aria-label="技能统一编辑工作区"]');
  await expect(workspace).toBeVisible();
  if (module !== '配置总览') {
    await workspace.getByRole('navigation', { name: '技能配置模块' })
      .getByRole('button', { name: module, exact: true }).click();
  }
  return workspace;
}

test('完整读取失败不开放空表单；主体与参数共同保存并回读', async ({ page }) => {
  const api = new ConfigurationApi();
  api.failFirstConfigurationRead = true;
  await api.install(page);
  await openSkills(page);
  await page.locator('tr', { hasText: 'sample_q' }).getByRole('button', { name: '编辑配置', exact: true }).click();
  const workspace = page.locator('[aria-label="技能统一编辑工作区"]');
  await expect(workspace.getByText('模拟读取失败')).toBeVisible();
  await expect(workspace.getByLabel('技能名称')).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: '保存更改' })).toBeDisabled();
  await workspace.getByRole('button', { name: '重试读取' }).click();
  await workspace.getByRole('navigation', { name: '技能配置模块' })
    .getByRole('button', { name: '主体与分类', exact: true }).click();
  await expect(workspace.getByLabel('技能名称')).toHaveValue('样例技能');
  await workspace.getByLabel('技能名称').fill('修改后的技能');
  await workspace.getByRole('navigation', { name: '技能配置模块' }).getByRole('button', { name: '参数与公式' }).click();
  await expect(workspace.getByText('中文预览：伤害').first()).toBeVisible();
  await workspace.getByRole('button', { name: '编辑', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: /编辑参数/ });
  await dialog.getByRole('spinbutton', { name: '固定值', exact: true }).fill('90');
  await dialog.getByRole('button', { name: '确认到技能草稿' }).click();
  await expect(dialog).toBeHidden();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.evaluate(() => { location.hash = '#/attributes'; });
  await expect(page).toHaveURL(/#\/skills$/);
  await workspace.getByRole('button', { name: '保存更改' }).click();
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0]).toMatchObject({ method: 'PATCH', body: {
    baseDigest: 'digest-1', skill: { name: '修改后的技能' },
    changes: [{ objectType: 'PARAMETER', operation: 'UPDATE', key: 'damage', value: { fixedValue: 90 } }]
  } });
  expect(Object.keys(api.writes[0]!.body)).toEqual(['baseDigest', 'skill', 'changes']);
  await workspace.getByRole('button', { name: '返回' }).click();
  const reopened = await openExistingSkill(page, 'sample_q', '主体与分类');
  await expect(reopened.getByLabel('技能名称')).toHaveValue('修改后的技能');
  expect(api.unexpected).toEqual([]);
});

test('行启停进入共同草稿；响应不明只读核对，不重复写入', async ({ page }) => {
  const api = new ConfigurationApi();
  api.ambiguousWrite = true;
  await api.install(page);
  await openSkills(page);
  await page.locator('tr', { hasText: 'sample_q' }).getByRole('button', { name: '停用', exact: true }).click();
  const workspace = page.locator('[aria-label="技能统一编辑工作区"]');
  await expect(workspace.getByLabel('技能状态').getByText('停用')).toBeVisible();
  expect(api.writes).toHaveLength(0);
  await workspace.getByRole('button', { name: '保存更改' }).click();
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  expect(api.writes).toHaveLength(1);
  expect((api.writes[0]!.body.skill as Json).status).toBe('DISABLED');
  expect(api.unexpected).toEqual([]);
});

test('等级扩大不补零，所有受影响等级参数随主体提交', async ({ page }) => {
  const api = new ConfigurationApi();
  (api.current.parameters as Json[])[0] = {
    ...parameter(), valueMode: 'SKILL_LEVEL', fixedValue: null,
    levelValues: { '1': 80, '2': 120 }
  };
  await api.install(page);
  await openSkills(page);
  const workspace = await openExistingSkill(page, 'sample_q', '主体与分类');
  await workspace.getByRole('spinbutton', { name: '最高等级' }).fill('3');
  await expect(workspace.getByText(/新增 Lv3/)).toBeVisible();
  await workspace.getByRole('button', { name: '保存更改' }).click();
  await expect(workspace.getByText('请先修正参数。')).toBeVisible();
  expect(api.writes).toHaveLength(0);
  await workspace.getByRole('button', { name: '编辑', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: /编辑参数/ });
  await expect(dialog.getByRole('spinbutton', { name: '等级3数值' })).toHaveValue('');
  await dialog.getByRole('spinbutton', { name: '等级3数值' }).fill('0');
  await dialog.getByRole('button', { name: '确认到技能草稿' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await workspace.getByRole('button', { name: '保存更改' }).click();
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  expect(api.writes).toHaveLength(1);
  const changes = api.writes[0]!.body.changes as Json[];
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ objectType: 'PARAMETER', operation: 'UPDATE', key: 'damage', value: {
    levelValues: { '1': 80, '2': 120, '3': 0 }
  } });
  expect((api.writes[0]!.body.skill as Json).maxLevel).toBe(3);
});

test('冲突保留草稿，成功后回读失败保留冻结内容并可只读重试', async ({ page }) => {
  const api = new ConfigurationApi();
  api.failNextWrite = true;
  await api.install(page);
  await openSkills(page);
  const workspace = await openExistingSkill(page, 'sample_q', '主体与分类');
  await workspace.getByLabel('技能名称').fill('冲突中的草稿');
  await workspace.getByRole('button', { name: '保存更改' }).click();
  await expect(workspace.getByText('配置冲突')).toBeVisible();
  await expect(workspace.getByLabel('技能名称')).toHaveValue('冲突中的草稿');
  expect(api.writes).toHaveLength(1);
  api.failNextReadback = true;
  await workspace.getByRole('button', { name: '保存更改' }).click();
  await expect(workspace.getByText('保存结果待核对', { exact: true })).toBeVisible();
  expect(api.writes).toHaveLength(2);
  await expect(workspace.getByLabel('技能名称')).toBeDisabled();
  await workspace.getByRole('button', { name: '只读核对' }).click();
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  expect(api.writes).toHaveLength(2);
});

test('未保存参数可被同次新建公式选择，两项共同保存并重开', async ({ page }) => {
  const api = new ConfigurationApi();
  await api.install(page);
  await openSkills(page);
  const workspace = await openExistingSkill(page, 'sample_q', '参数与公式');
  await workspace.getByRole('button', { name: '新增参数' }).click();
  const parameterDialog = page.getByRole('dialog', { name: '新增参数' });
  await parameterDialog.getByRole('textbox', { name: '稳定标识' }).fill('bonus');
  await parameterDialog.getByRole('textbox', { name: '参数名称' }).fill('新增加成');
  await parameterDialog.getByRole('spinbutton', { name: '固定值' }).fill('0');
  await parameterDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  expect(api.writes).toHaveLength(0);
  await workspace.getByRole('button', { name: '新增公式' }).click();
  const formulaDialog = page.getByRole('dialog', { name: '新增公式' });
  await formulaDialog.getByRole('textbox', { name: '公式稳定标识' }).fill('bonus_formula');
  await formulaDialog.getByRole('textbox', { name: '公式名称' }).fill('加成公式');
  await formulaDialog.getByLabel('expression节点类型').getByText('技能参数').click();
  await formulaDialog.getByLabel('expression技能参数').click();
  await page.getByRole('option', { name: /新增加成/ }).click();
  await formulaDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  expect(api.writes).toHaveLength(0);
  await workspace.getByRole('button', { name: '保存更改' }).click();
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0]!.body.changes).toMatchObject([
    { objectType: 'PARAMETER', operation: 'CREATE', key: 'bonus', value: { fixedValue: 0 } },
    { objectType: 'FORMULA', operation: 'CREATE', key: 'bonus_formula', value: {
      expression: { nodeType: 'PARAMETER', parameterKey: 'bonus' }
    } }
  ]);
  await workspace.getByRole('button', { name: '返回' }).click();
  const reopened = await openExistingSkill(page, 'sample_q', '参数与公式');
  await expect(reopened.getByText('加成公式', { exact: true }).first()).toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test('内部状态和效果先入共同草稿，再与原数值配置同次保存', async ({ page }) => {
  const api = new ConfigurationApi();
  await api.install(page);
  await openSkills(page);
  const workspace = await openExistingSkill(page, 'sample_q', '内部状态');
  await workspace.getByRole('button', { name: '新增内部状态' }).click();
  const stateDialog = page.getByRole('dialog', { name: '新增内部状态' });
  await stateDialog.getByLabel('内部状态标识').fill('ready_flag');
  await stateDialog.getByLabel('内部状态名称').fill('准备标记');
  await stateDialog.getByLabel('状态种类').click();
  await page.getByRole('option', { name: '准备标记' }).click();
  await stateDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  expect(api.writes).toHaveLength(0);
  await workspace.getByRole('navigation', { name: '技能配置模块' })
    .getByRole('button', { name: '效果与生命周期' }).click();
  await workspace.getByRole('button', { name: '新增效果' }).click();
  const effectDialog = page.getByRole('dialog', { name: '新增效果' });
  await effectDialog.getByLabel('效果标识').fill('marker');
  await effectDialog.getByLabel('效果名称').fill('持续标记');
  await effectDialog.getByLabel('生命周期').click();
  await effectDialog.getByRole('spinbutton', { name: '最大层数取值固定数值' }).fill('1');
  await effectDialog.getByRole('spinbutton', { name: '每次施加层数取值固定数值' }).fill('1');
  await effectDialog.getByLabel('实例范围').click();
  await page.getByRole('option', { name: '按来源与承受对象', exact: true }).click();
  await effectDialog.getByLabel('重复层数').click();
  await page.getByRole('option', { name: '保留层数' }).click();
  await effectDialog.getByRole('button', { name: '新增结果' }).click();
  const resultDialog = page.getByRole('dialog', { name: '新增结果' });
  await resultDialog.getByLabel('结果标识').fill('spell_guard');
  await resultDialog.getByLabel('结果名称').fill('法术护盾');
  await resultDialog.getByLabel('结果种类').click();
  await page.getByRole('option', { name: '法术护盾' }).click();
  await expect(resultDialog.getByRole('button', { name: '新增乘区' })).toHaveCount(0);
  await resultDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(resultDialog).toBeHidden();
  expect(api.writes).toHaveLength(0);
  await effectDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  expect(api.writes).toHaveLength(0);
  await expect(workspace.getByText(/内部状态约 1 项，效果约 1 项/)).toBeVisible();
  await workspace.getByRole('button', { name: '保存更改' }).click();
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0]!.body.changes).toMatchObject([
    { objectType: 'INTERNAL_STATE', operation: 'CREATE', key: 'ready_flag',
      value: { stateType: 'FLAG', detail: { initialEnabled: false } } },
    { objectType: 'EFFECT', operation: 'CREATE', key: 'marker',
      value: { lifecycle: { endWhenShieldEndsResultKey: null },
        results: [{ resultKey: 'spell_guard', resultType: 'SPELL_SHIELD' }] } }
  ]);
  await workspace.getByRole('button', { name: '返回' }).click();
  const reopened = await openExistingSkill(page, 'sample_q', '效果与生命周期');
  await expect(reopened.getByText('持续标记', { exact: true }).first()).toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test('旧弹药恢复启动条件保持空白，明确选择后才进入统一保存', async ({ page }) => {
  const api = new ConfigurationApi();
  (api.current.internalStates as Json[]).push({
    gameId: GAME_ID, skillKey: 'sample_q', stateKey: 'ammo', name: '弹药',
    stateType: 'AMMO', scope: 'SKILL', description: null, sortOrder: 0,
    detail: { initialValue: { kind: 'FIXED', value: 1 },
      maxValue: { kind: 'FIXED', value: 2 },
      recoveryIntervalValue: { kind: 'FIXED', value: 1000 },
      recoveryMode: 'ONE_BY_ONE' },
    createdAt: NOW, updatedAt: NOW
  });
  await api.install(page);
  await openSkills(page);
  const workspace = await openExistingSkill(page, 'sample_q', '内部状态');
  await expect(workspace.getByText(/启动条件：待确认/)).toBeVisible();
  await workspace.getByRole('button', { name: '编辑', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑内部状态' });
  await expect(dialog.getByLabel('恢复启动条件').getByRole('radio', { checked: true })).toHaveCount(0);
  await dialog.getByLabel('内部状态名称').fill('已确认弹药');
  await dialog.getByRole('button', { name: '确认到技能草稿' }).click();
  await expect(dialog.getByText('请根据来源确认恢复启动条件。')).toBeVisible();
  expect(api.writes).toHaveLength(0);
  await dialog.getByLabel('恢复启动条件').getByText('消耗后开始恢复').click();
  await dialog.getByRole('button', { name: '确认到技能草稿' }).click();
  await workspace.getByRole('button', { name: '保存更改' }).click();
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0]!.body.changes).toMatchObject([{
    objectType: 'INTERNAL_STATE', operation: 'UPDATE', key: 'ammo',
    value: { name: '已确认弹药', detail: { recoveryStartCondition: 'AFTER_CONSUME' } }
  }]);
  expect(api.unexpected).toEqual([]);
});

test('待保存过程可被新规则选择，两者仅经顶部一次写入', async ({ page }) => {
  const api = new ConfigurationApi();
  (api.current.effects as Json[]).push({
    gameId: GAME_ID, skillKey: 'sample_q', effectKey: 'marker', name: '标记',
    description: null, sortOrder: 0, lifecycle: null, results: [],
    createdAt: NOW, updatedAt: NOW
  });
  await api.install(page);
  await openSkills(page);
  const workspace = await openExistingSkill(page, 'sample_q', '施放过程');
  await workspace.getByRole('button', { name: '新增过程' }).click();
  const processDialog = page.getByRole('dialog', { name: '新增过程' });
  await processDialog.getByLabel('过程标识').fill('cast');
  await processDialog.getByLabel('过程名称').fill('施放');
  await processDialog.getByRole('button', { name: '编辑', exact: true }).first().click();
  const stepDialog = page.getByRole('dialog', { name: '编辑步骤' });
  await stepDialog.getByLabel('步骤标识').fill('start');
  await stepDialog.getByLabel('步骤名称').fill('开始');
  await stepDialog.getByRole('button', { name: '保存', exact: true }).click();
  await processDialog.getByRole('button', { name: '新增效果挂接' }).click();
  const bindingDialog = page.getByRole('dialog', { name: '新增效果挂接' });
  await bindingDialog.getByLabel('挂接标识').fill('apply_marker');
  await bindingDialog.getByLabel('效果').click();
  await page.getByRole('option', { name: '标记' }).click();
  await bindingDialog.getByRole('button', { name: '保存', exact: true }).click();
  await processDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  expect(api.writes).toHaveLength(0);
  await workspace.getByRole('navigation', { name: '技能配置模块' })
    .getByRole('button', { name: '条件与触发' }).click();
  await workspace.getByRole('button', { name: '新增规则' }).click();
  const ruleDialog = page.getByRole('dialog', { name: '新增规则' });
  await ruleDialog.getByLabel('规则标识').fill('on_use');
  await ruleDialog.getByLabel('规则名称').fill('使用时启动');
  await ruleDialog.getByLabel('使用阶段').click();
  await page.getByRole('option', { name: '首次施放' }).click();
  await ruleDialog.getByRole('button', { name: '编辑', exact: true }).first().click();
  const actionDialog = page.getByRole('dialog', { name: '编辑动作' });
  await actionDialog.getByLabel('动作种类').click();
  await page.getByRole('option', { name: '启动过程' }).click();
  await actionDialog.getByLabel('动作标识').fill('start_cast');
  await actionDialog.getByLabel('动作名称').fill('启动施放');
  await actionDialog.getByLabel('目标过程').click();
  await page.getByRole('option', { name: '施放' }).click();
  await actionDialog.getByRole('button', { name: '确定' }).click();
  await ruleDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  expect(api.writes).toHaveLength(0);
  await workspace.getByRole('button', { name: '保存更改' }).click();
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0]!.body.changes).toMatchObject([
    { objectType: 'PROCESS', operation: 'CREATE', key: 'cast', value: {
      effectBindings: [{ effectKey: 'marker' }] } },
    { objectType: 'TRIGGER_RULE', operation: 'CREATE', key: 'on_use', value: {
      actions: [{ actionType: 'START_PROCESS', detail: { processKey: 'cast' } }] } }
  ]);
  expect(api.unexpected).toEqual([]);
});

test('外部同名状态与生命周期按所属技能读取，失败重试保留草稿', async ({ page }) => {
  const api = new ConfigurationApi();
  const localState = { gameId: GAME_ID, skillKey: 'sample_q', stateKey: 'shared_mode',
    name: '本地同名准备', stateType: 'FLAG', scope: 'SKILL', description: null,
    sortOrder: 0, detail: { initialEnabled: false }, createdAt: NOW, updatedAt: NOW };
  const localEffect = { gameId: GAME_ID, skillKey: 'sample_q', effectKey: 'mark',
    name: '本地同名效果', description: null, sortOrder: 0,
    lifecycle: { instanceScope: 'SOURCE', durationValue: null,
      maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 },
      reapplicationStackMode: 'KEEP', reapplicationDurationMode: null,
      expiryMode: 'EXPLICIT_ONLY', periodicIntervalValue: null, firstPeriodicExecution: null,
      endWhenShieldEndsResultKey: null }, results: [], createdAt: NOW, updatedAt: NOW };
  const externalState = { ...localState, skillKey: 'foreign', name: '外部模式', stateType: 'MODE',
    detail: { initialOptionKey: 'red', options: [
      { optionKey: 'red', name: '红色', sortOrder: 0 },
      { optionKey: 'blue', name: '蓝色', sortOrder: 1 }] } };
  const externalEffect = { ...localEffect, skillKey: 'foreign', name: '外部目标效果',
    lifecycle: { ...localEffect.lifecycle, instanceScope: 'TARGET' },
    results: [{ resultKey: 'external_apply', name: '外部施加', resultType: 'STATUS_OPERATION',
      target: 'TARGET', description: null, sortOrder: 0, valueRule: null,
      spellShieldBlockScope: null, detail: { statusKey: 'burn', operation: 'APPLY' },
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: null,
        stackValueMode: null, reapplicationValueMode: null, periodicExecutionMode: null } }] };
  (api.current.internalStates as Json[]).push(localState);
  (api.current.effects as Json[]).push(localEffect);
  (api.current.processes as Json[]).push({ gameId: GAME_ID, skillKey: 'sample_q',
    processKey: 'cast', name: '施放', activationType: 'ACTIVE', description: null,
    sortOrder: 0, cooldown: null, steps: [{ stepKey: 'start', name: '开始',
      stepType: 'IMMEDIATE', description: null, sortOrder: 0, detail: {} }],
    effectBindings: [], stateOperations: [{ operationKey: 'select', name: '选模式',
      stateSkillKey: 'foreign', stateKey: 'shared_mode', operation: 'SELECT', value: null,
      optionKey: 'red', moment: { momentType: 'PROCESS_START', stepKey: null,
        failureReason: null }, sortOrder: 0 }], createdAt: NOW, updatedAt: NOW });
  (api.current.triggerRules as Json[]).push({ ruleKey: 'external_refs', name: '外部引用',
    description: null, sortOrder: 0,
    eventSource: { eventType: 'INTERNAL_STATE_CHANGED', detail: { stateSkillKey: 'foreign',
      stateKey: 'shared_mode', changeKind: 'OPTION_SELECTED' } },
    conditionGroups: [{ groupKey: 'checks', name: '条件', sortOrder: 0, conditions: [
      { conditionKey: 'mode', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 0,
        detail: { stateSkillKey: 'foreign', stateKey: 'shared_mode', valueKind: 'OPTION_SELECTED',
          optionKey: 'red', expectedBoolean: null, comparator: null, comparisonValue: null } },
      { conditionKey: 'life', conditionType: 'LIFECYCLE_CHECK', sortOrder: 1,
        detail: { effectSkillKey: 'foreign', effectKey: 'mark', subject: 'CURRENT_TARGET',
          checkKind: 'PRESENT', comparator: null, comparisonValue: null } }
    ] }],
    actions: [{ actionKey: 'apply', name: '执行', actionType: 'EXECUTE_EFFECT',
      sortOrder: 0, targetContext: 'CURRENT_TARGET', detail: { effectKey: 'mark' },
      runtimeInputBindings: [{ bindingKey: 'input', parameterKey: 'runtime',
        sourceType: 'INTERNAL_STATE', detail: { stateSkillKey: 'foreign',
          stateKey: 'shared_mode', valueKind: 'OPTION_SELECTED', optionKey: 'red' } },
      { bindingKey: 'status', parameterKey: 'status_runtime', sourceType: 'COMBAT_STATUS',
        detail: { subject: 'CURRENT_TARGET', statusKey: 'burn', valueKind: 'STACKS',
          effectSkillKey: 'foreign', sourceEffectKey: 'mark', sourceResultKey: 'external_apply' } }],
      resultModifiers: [] }], perTargetCooldown: null, maxTriggersPerProcess: null,
    oncePerUse: null });
  await api.install(page);
  let stateReads = 0;
  let effectReads = 0;
  await page.route('**/skills/foreign/internal-states/shared_mode', async (route) => {
    stateReads += 1;
    if (stateReads === 1) await respond(route, { error: { code: 'READ_FAILED', message: '外部状态暂不可用' } }, 503);
    else await respond(route, externalState);
  });
  await page.route('**/skills/foreign/effects/mark', async (route) => {
    effectReads += 1;
    await respond(route, externalEffect);
  });
  await page.route('**/skills/foreign/effects/mark_source', async (route) => {
    effectReads += 1;
    await respond(route, { ...externalEffect, effectKey: 'mark_source',
      lifecycle: { ...externalEffect.lifecycle, instanceScope: 'SOURCE' } });
  });
  await openSkills(page);
  const workspace = await openExistingSkill(page, 'sample_q', '施放过程');
  await workspace.getByRole('button', { name: '编辑', exact: true }).click();
  const processDialog = page.getByRole('dialog', { name: '编辑过程' });
  await processDialog.getByRole('button', { name: '编辑', exact: true }).last().click();
  const operationDialog = page.getByRole('dialog', { name: '编辑内部状态操作' });
  await expect(operationDialog.getByText('外部状态暂不可用')).toBeVisible();
  await expect(operationDialog.getByLabel('外部内部状态标识')).toHaveValue('shared_mode');
  await operationDialog.getByRole('button', { name: '重试' }).click();
  await operationDialog.getByLabel('模式选项').click();
  await expect(page.getByRole('option', { name: '蓝色' })).toBeVisible();
  await page.keyboard.press('Escape');
  await operationDialog.getByRole('button', { name: '取消' }).click();
  await processDialog.getByRole('button', { name: '取消' }).click();
  await workspace.getByRole('navigation', { name: '技能配置模块' })
    .getByRole('button', { name: '条件与触发' }).click();
  await workspace.getByRole('button', { name: '编辑', exact: true }).click();
  const ruleDialog = page.getByRole('dialog', { name: '编辑规则' });
  await ruleDialog.getByLabel('内部状态变化种类').click();
  await expect(page.getByRole('option', { name: '模式选项变化' })).toBeVisible();
  await expect(page.getByRole('option', { name: '准备标记变化' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await ruleDialog.getByRole('button', { name: '编辑', exact: true }).first().click();
  const conditionDialog = page.getByRole('dialog', { name: '编辑条件' });
  await conditionDialog.getByLabel('模式选项').click();
  await expect(page.getByRole('option', { name: '蓝色' })).toBeVisible();
  await page.keyboard.press('Escape');
  await conditionDialog.getByRole('button', { name: '取消' }).click();
  await ruleDialog.getByRole('button', { name: '编辑', exact: true }).nth(1).click();
  const lifecycleDialog = page.getByRole('dialog', { name: '编辑条件' });
  await expect(lifecycleDialog.getByLabel('生命周期主体')).toBeVisible();
  const sourceLifecycleRead = page.waitForResponse((response) => response.url().endsWith('/skills/foreign/effects/mark_source'));
  await lifecycleDialog.getByLabel('外部生命周期效果标识').fill('mark_source');
  expect((await sourceLifecycleRead).ok()).toBe(true);
  await expect(lifecycleDialog.getByLabel('生命周期主体')).toHaveCount(0);
  await lifecycleDialog.getByRole('button', { name: '确定' }).click();
  await expect(lifecycleDialog).toBeHidden();
  await ruleDialog.getByRole('button', { name: '编辑', exact: true }).last().click();
  const actionDialog = page.getByRole('dialog', { name: '编辑动作' });
  await actionDialog.getByRole('button', { name: '编辑', exact: true }).first().click();
  const bindingDialog = page.getByRole('dialog', { name: '编辑绑定' });
  await bindingDialog.getByLabel('绑定模式选项').click();
  await expect(page.getByRole('option', { name: '蓝色' })).toBeVisible();
  await page.keyboard.press('Escape');
  await bindingDialog.getByRole('button', { name: '取消' }).click();
  await actionDialog.getByRole('button', { name: '编辑', exact: true }).nth(1).click();
  const statusBindingDialog = page.getByRole('dialog', { name: '编辑绑定' });
  await statusBindingDialog.getByLabel('绑定状态施加结果').click();
  await expect(page.getByRole('option', { name: '外部施加' })).toBeVisible();
  await page.keyboard.press('Escape');
  await statusBindingDialog.getByRole('button', { name: '取消' }).click();
  await actionDialog.getByRole('button', { name: '取消' }).click();
  expect(stateReads).toBeGreaterThanOrEqual(4);
  expect(effectReads).toBeGreaterThanOrEqual(2);
  expect(api.writes).toHaveLength(0);
  expect(api.unexpected).toEqual([]);
});

test('隔离服务真接口：页面同次创建参数与引用公式，重开并独立回读', async ({ page, request }) => {
  const apiBase = process.env.SKILL_CONFIG_LIVE_API;
  test.skip(apiBase !== 'http://127.0.0.1:18089', '须显式指定本机 18089 隔离服务。');
  const games = await request.get(`${apiBase}/api/games`);
  expect(games.ok()).toBe(true);
  const listed = await games.json() as Array<{ gameId: string; gameName: string }>;
  expect(listed).toContainEqual(expect.objectContaining({
    gameId: 'configuration_test', gameName: '统一技能工作区隔离测试'
  }));
  const key = `front_formula_${Date.now().toString(36)}`;
  await page.addInitScript(({ api }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', 'local-test');
  }, { api: apiBase });
  const writes: string[] = [];
  page.on('request', (req) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method())) writes.push(
      `${req.method()} ${new URL(req.url()).pathname}`);
  });
  await page.goto('/#/skills');
  await page.getByRole('button', { name: '新增技能' }).click();
  const workspace = page.locator('[aria-label="技能统一编辑工作区"]');
  await workspace.getByLabel('技能标识').fill(key);
  await workspace.getByLabel('技能名称').fill('前端参数公式隔离验收');
  await workspace.getByRole('navigation', { name: '技能配置模块' })
    .getByRole('button', { name: '参数与公式' }).click();
  await workspace.getByRole('button', { name: '新增参数' }).click();
  const parameterDialog = page.getByRole('dialog', { name: '新增参数' });
  await parameterDialog.getByRole('textbox', { name: '稳定标识' }).fill('basis');
  await parameterDialog.getByRole('textbox', { name: '参数名称' }).fill('基础值');
  await parameterDialog.getByRole('spinbutton', { name: '固定值' }).fill('0');
  await parameterDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  await workspace.getByRole('button', { name: '新增公式' }).click();
  const formulaDialog = page.getByRole('dialog', { name: '新增公式' });
  await formulaDialog.getByRole('textbox', { name: '公式稳定标识' }).fill('output');
  await formulaDialog.getByRole('textbox', { name: '公式名称' }).fill('计算结果');
  await formulaDialog.getByLabel('expression节点类型').getByText('技能参数').click();
  await formulaDialog.getByLabel('expression技能参数').click();
  await page.getByRole('option', { name: /基础值/ }).click();
  await formulaDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  expect(writes).toEqual([]);
  await workspace.getByRole('button', { name: '保存更改' }).click();
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  expect(writes).toEqual([`POST /api/admin/games/configuration_test/skills/${key}/configuration`]);
  await workspace.getByRole('button', { name: '返回' }).click();
  const reopened = await openExistingSkill(page, key, '参数与公式');
  await expect(reopened.getByText('计算结果', { exact: true }).first()).toBeVisible();
  const persisted = await request.get(`${apiBase}/api/admin/games/configuration_test/skills/${key}/configuration`,
    { headers: { Authorization: 'Bearer local-test' } });
  expect(persisted.ok()).toBe(true);
  const current = await persisted.json() as Json;
  expect(current).toMatchObject({
    parameters: [{ parameterKey: 'basis', fixedValue: 0 }],
    formulas: [{ formulaKey: 'output', expression: { nodeType: 'PARAMETER', parameterKey: 'basis' } }],
    effects: [], internalStates: [], processes: [], triggerRules: []
  });
});

test('隔离服务真接口：页面同次创建内部状态与带结果的效果', async ({ page, request }) => {
  const apiBase = process.env.SKILL_CONFIG_LIVE_API;
  test.skip(apiBase !== 'http://127.0.0.1:18089' || process.env.SKILL_CONFIG_LIVE_STAGE3 !== '1',
    '须显式指定已接入状态与效果的本机隔离服务。');
  const games = await request.get(`${apiBase}/api/games`);
  expect(games.ok()).toBe(true);
  expect(await games.json()).toContainEqual(expect.objectContaining({
    gameId: 'configuration_test', gameName: '统一技能工作区隔离测试'
  }));
  const key = `front_stage3_${Date.now().toString(36)}`;
  await page.addInitScript(({ api }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', 'local-test');
  }, { api: apiBase });
  const writes: string[] = [];
  page.on('request', (req) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method())) writes.push(
      `${req.method()} ${new URL(req.url()).pathname}`);
  });
  await page.goto('/#/skills');
  await page.getByRole('button', { name: '新增技能' }).click();
  const workspace = page.locator('[aria-label="技能统一编辑工作区"]');
  await workspace.getByLabel('技能标识').fill(key);
  await workspace.getByLabel('技能名称').fill('前端状态效果隔离验收');
  await workspace.getByRole('navigation', { name: '技能配置模块' })
    .getByRole('button', { name: '内部状态' }).click();
  await workspace.getByRole('button', { name: '新增内部状态' }).click();
  const stateDialog = page.getByRole('dialog', { name: '新增内部状态' });
  await stateDialog.getByLabel('内部状态标识').fill('ready');
  await stateDialog.getByLabel('内部状态名称').fill('准备');
  await stateDialog.getByLabel('状态种类').click();
  await page.getByRole('option', { name: '准备标记' }).click();
  await stateDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  await workspace.getByRole('navigation', { name: '技能配置模块' })
    .getByRole('button', { name: '效果与生命周期' }).click();
  await workspace.getByRole('button', { name: '新增效果' }).click();
  const effectDialog = page.getByRole('dialog', { name: '新增效果' });
  await effectDialog.getByLabel('效果标识').fill('spell_mark');
  await effectDialog.getByLabel('效果名称').fill('法术护盾标记');
  await effectDialog.getByLabel('生命周期').click();
  await effectDialog.getByRole('spinbutton', { name: '最大层数取值固定数值' }).fill('1');
  await effectDialog.getByRole('spinbutton', { name: '每次施加层数取值固定数值' }).fill('1');
  await effectDialog.getByLabel('实例范围').click();
  await page.getByRole('option', { name: '按来源与承受对象', exact: true }).click();
  await effectDialog.getByLabel('重复层数').click();
  await page.getByRole('option', { name: '保留层数' }).click();
  await effectDialog.getByRole('button', { name: '新增结果' }).click();
  const resultDialog = page.getByRole('dialog', { name: '新增结果' });
  await resultDialog.getByLabel('结果标识').fill('spell_guard');
  await resultDialog.getByLabel('结果名称').fill('法术护盾');
  await resultDialog.getByLabel('结果种类').click();
  await page.getByRole('option', { name: '法术护盾' }).click();
  await resultDialog.getByRole('button', { name: '保存', exact: true }).click();
  await effectDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  expect(writes).toEqual([]);
  await workspace.getByRole('button', { name: '保存更改' }).click();
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  expect(writes).toEqual([`POST /api/admin/games/configuration_test/skills/${key}/configuration`]);
  await workspace.getByRole('button', { name: '返回' }).click();
  const reopened = await openExistingSkill(page, key, '效果与生命周期');
  await expect(reopened.getByText('法术护盾标记', { exact: true }).first()).toBeVisible();
  const persisted = await request.get(`${apiBase}/api/admin/games/configuration_test/skills/${key}/configuration`,
    { headers: { Authorization: 'Bearer local-test' } });
  expect(persisted.ok()).toBe(true);
  expect(await persisted.json()).toMatchObject({
    skill: { skillKey: key },
    internalStates: [{ stateKey: 'ready', stateType: 'FLAG', detail: { initialEnabled: false } }],
    effects: [{ effectKey: 'spell_mark', lifecycle: { endWhenShieldEndsResultKey: null },
      results: [{ resultKey: 'spell_guard', resultType: 'SPELL_SHIELD' }] }],
    processes: [], triggerRules: []
  });
});

test('隔离服务真接口：六模块同次保存并独立回读', async ({ page, request }) => {
  const apiBase = process.env.SKILL_CONFIG_LIVE_API;
  test.skip(apiBase !== 'http://127.0.0.1:18089' || process.env.SKILL_CONFIG_LIVE_STAGE45 !== '1',
    '须显式指定已接入六模块的本机隔离服务。');
  const games = await request.get(`${apiBase}/api/games`);
  expect(games.ok()).toBe(true);
  expect(await games.json()).toContainEqual(expect.objectContaining({ gameId: 'configuration_test' }));
  const key = `front_all_${Date.now().toString(36)}`;
  await page.addInitScript(({ api }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', 'local-test');
  }, { api: apiBase });
  const writes: string[] = [];
  let savedChanges: SkillConfigurationChange[] = [];
  let savedSkill: UpdateSkillRequest | undefined;
  let responseDigest: string | undefined;
  page.on('request', (req) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method())) writes.push(
      `${req.method()} ${new URL(req.url()).pathname}`);
    if (req.method() === 'POST' && req.url().endsWith('/configuration')) {
      const body = req.postDataJSON() as { skill: UpdateSkillRequest; changes: SkillConfigurationChange[] };
      savedChanges = body.changes;
      savedSkill = body.skill;
    }
  });
  await page.goto('/#/skills');
  await page.getByRole('button', { name: '新增技能' }).click();
  const workspace = page.locator('[aria-label="技能统一编辑工作区"]');
  const navigation = workspace.getByRole('navigation', { name: '技能配置模块' });
  await workspace.getByLabel('技能标识').fill(key);
  await workspace.getByLabel('技能名称').fill('六模块隔离验收');

  await navigation.getByRole('button', { name: '参数与公式' }).click();
  await workspace.getByRole('button', { name: '新增参数' }).click();
  const parameterDialog = page.getByRole('dialog', { name: '新增参数' });
  await parameterDialog.getByRole('textbox', { name: '稳定标识' }).fill('basis');
  await parameterDialog.getByRole('textbox', { name: '参数名称' }).fill('基础值');
  await parameterDialog.getByRole('spinbutton', { name: '固定值' }).fill('1');
  await parameterDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  await workspace.getByRole('button', { name: '新增公式' }).click();
  const formulaDialog = page.getByRole('dialog', { name: '新增公式' });
  await formulaDialog.getByRole('textbox', { name: '公式稳定标识' }).fill('output');
  await formulaDialog.getByRole('textbox', { name: '公式名称' }).fill('计算结果');
  await formulaDialog.getByLabel('expression节点类型').getByText('技能参数').click();
  await formulaDialog.getByLabel('expression技能参数').click();
  await page.getByRole('option', { name: /基础值/ }).click();
  await formulaDialog.getByRole('button', { name: '确认到技能草稿' }).click();

  await navigation.getByRole('button', { name: '内部状态' }).click();
  await workspace.getByRole('button', { name: '新增内部状态' }).click();
  const stateDialog = page.getByRole('dialog', { name: '新增内部状态' });
  await stateDialog.getByLabel('内部状态标识').fill('ready');
  await stateDialog.getByLabel('内部状态名称').fill('准备');
  await stateDialog.getByLabel('状态种类').click();
  await page.getByRole('option', { name: '准备标记' }).click();
  await stateDialog.getByRole('button', { name: '确认到技能草稿' }).click();

  await navigation.getByRole('button', { name: '效果与生命周期' }).click();
  await workspace.getByRole('button', { name: '新增效果' }).click();
  const effectDialog = page.getByRole('dialog', { name: '新增效果' });
  await effectDialog.getByLabel('效果标识').fill('shield');
  await effectDialog.getByLabel('效果名称').fill('隔离护盾');
  await effectDialog.getByLabel('生命周期').click();
  await effectDialog.getByRole('spinbutton', { name: '最大层数取值固定数值' }).fill('1');
  await effectDialog.getByRole('spinbutton', { name: '每次施加层数取值固定数值' }).fill('1');
  await effectDialog.getByLabel('实例范围').click();
  await page.getByRole('option', { name: '按来源与承受对象', exact: true }).click();
  await effectDialog.getByLabel('重复层数').click();
  await page.getByRole('option', { name: '保留层数' }).click();
  await effectDialog.getByRole('button', { name: '新增结果' }).click();
  const resultDialog = page.getByRole('dialog', { name: '新增结果' });
  await resultDialog.getByLabel('结果标识').fill('guard');
  await resultDialog.getByLabel('结果名称').fill('法术护盾');
  await resultDialog.getByLabel('结果种类').click();
  await page.getByRole('option', { name: '法术护盾' }).click();
  await resultDialog.getByRole('button', { name: '保存', exact: true }).click();
  await effectDialog.getByRole('button', { name: '确认到技能草稿' }).click();

  await navigation.getByRole('button', { name: '施放过程' }).click();
  await workspace.getByRole('button', { name: '新增过程' }).click();
  const processDialog = page.getByRole('dialog', { name: '新增过程' });
  await processDialog.getByLabel('过程标识').fill('cast');
  await processDialog.getByLabel('过程名称').fill('施放');
  await processDialog.getByRole('button', { name: '编辑', exact: true }).first().click();
  const stepDialog = page.getByRole('dialog', { name: '编辑步骤' });
  await stepDialog.getByLabel('步骤标识').fill('start');
  await stepDialog.getByLabel('步骤名称').fill('开始');
  await stepDialog.getByRole('button', { name: '保存', exact: true }).click();
  await processDialog.getByRole('button', { name: '新增效果挂接' }).click();
  const bindingDialog = page.getByRole('dialog', { name: '新增效果挂接' });
  await bindingDialog.getByLabel('挂接标识').fill('apply_shield');
  await bindingDialog.getByLabel('效果').click();
  await page.getByRole('option', { name: '隔离护盾' }).click();
  await bindingDialog.getByRole('button', { name: '保存', exact: true }).click();
  await processDialog.getByRole('button', { name: '确认到技能草稿' }).click();

  await navigation.getByRole('button', { name: '条件与触发' }).click();
  await workspace.getByRole('button', { name: '新增规则' }).click();
  const ruleDialog = page.getByRole('dialog', { name: '新增规则' });
  await ruleDialog.getByLabel('规则标识').fill('on_use');
  await ruleDialog.getByLabel('规则名称').fill('使用时启动');
  await ruleDialog.getByLabel('使用阶段').click();
  await page.getByRole('option', { name: '首次施放' }).click();
  await ruleDialog.getByRole('button', { name: '编辑', exact: true }).first().click();
  const actionDialog = page.getByRole('dialog', { name: '编辑动作' });
  await actionDialog.getByLabel('动作种类').click();
  await page.getByRole('option', { name: '启动过程' }).click();
  await actionDialog.getByLabel('动作标识').fill('start_cast');
  await actionDialog.getByLabel('动作名称').fill('启动施放');
  await actionDialog.getByLabel('目标过程').click();
  await page.getByRole('option', { name: '施放' }).click();
  await actionDialog.getByRole('button', { name: '确定' }).click();
  await ruleDialog.getByRole('button', { name: '确认到技能草稿' }).click();
  expect(writes).toEqual([]);

  const writeResponse = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().endsWith(`/skills/${key}/configuration`));
  await workspace.getByRole('button', { name: '保存更改' }).click();
  const written = await writeResponse;
  expect(written.ok()).toBe(true);
  responseDigest = ((await written.json()) as SkillConfiguration).baseDigest;
  await expect.poll(() => writes.length).toBe(1);
  const persisted = await request.get(`${apiBase}/api/admin/games/configuration_test/skills/${key}/configuration`,
    { headers: { Authorization: 'Bearer local-test' } });
  expect(persisted.ok()).toBe(true);
  const current = await persisted.json() as SkillConfiguration;
  for (const change of savedChanges) {
    expect(configurationMatchesRequest(current, undefined, [change]), change.objectType).toBe(true);
  }
  expect(configurationMatchesRequest(current, savedSkill, savedChanges), '主体与六类变更回读').toBe(true);
  expect(current.baseDigest, '写入响应摘要与独立回读摘要').toBe(responseDigest);
  await expect(workspace.getByText('已保存并核对')).toBeVisible();
  expect(writes).toEqual([`POST /api/admin/games/configuration_test/skills/${key}/configuration`]);
  expect(current).toMatchObject({
    skill: { skillKey: key }, parameters: [{ parameterKey: 'basis' }],
    formulas: [{ formulaKey: 'output' }], internalStates: [{ stateKey: 'ready' }],
    effects: [{ effectKey: 'shield' }], processes: [{ processKey: 'cast',
      effectBindings: [{ effectKey: 'shield' }] }], triggerRules: [{ ruleKey: 'on_use',
      actions: [{ detail: { processKey: 'cast' } }] }]
  });
  await workspace.getByRole('button', { name: '返回' }).click();
  const row = page.locator('tr', { hasText: key });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '编辑配置', exact: true }).click();
  const reopened = page.locator('[aria-label="技能统一编辑工作区"]');
  await reopened.getByRole('navigation', { name: '技能配置模块' })
    .getByRole('button', { name: '施放过程', exact: true }).click();
  await expect(reopened.getByText(/施放\s*（cast）/)).toBeVisible();
  await reopened.getByRole('navigation', { name: '技能配置模块' })
    .getByRole('button', { name: '条件与触发' }).click();
  await expect(reopened.getByText(/使用时启动\s*（on_use）/)).toBeVisible();
  expect(writes).toEqual([`POST /api/admin/games/configuration_test/skills/${key}/configuration`]);
});
