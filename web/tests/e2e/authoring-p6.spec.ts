import { fulfillAuthSession } from '../fixtures/authSession';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { simulationComplexSample } from '../fixtures/simulationComplexSkills';
import { SKILL_TRIGGER_EVENT_TYPE_LABELS, SKILL_TRIGGER_SOURCE_TYPE_LABELS } from '../../src/types/skillSystemEnums.generated';
import { parseSkillTriggerRuleDetail, parseSkillTriggerRuleSummary } from '../../src/services/skillTriggerRuleClient';

const API = 'http://127.0.0.1:19085';
const GAME_ID = 'authoring_p6';
const NOW = '2026-09-23T05:00:00Z';
const SKILL_KEY = 'eclipse_p';
const CHAR_KEY = 'p6_champ';

type Json = Record<string, unknown>;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: status === 204 ? '' : JSON.stringify(body)
  });
}

function location(
  identity: { skillKey: string | null; objectType: string; objectKey: string; fieldPath: string },
  editor: string,
  segments: unknown[]
) {
  return {
    ...identity,
    editor,
    precision: 'FIELD',
    degradeReason: null,
    segments,
    formulaSnapshot: null
  };
}

function skillRow(name = '星蚀被动') {
  return {
    gameId: GAME_ID, skillKey: SKILL_KEY, name, description: null, maxLevel: 1, status: 'ENABLED',
    sortOrder: 0, skillCategoryKeys: [], createdAt: NOW, updatedAt: NOW
  };
}

function executeAction(): Json {
  return {
    actionKey: 'deal', name: '执行伤害', actionType: 'EXECUTE_EFFECT', sortOrder: 0,
    targetContext: 'CURRENT_TARGET', detail: { effectKey: 'eclipse_hit' },
    runtimeInputBindings: [], resultModifiers: []
  };
}

function ruleDetail(partial: Json = {}): Json {
  return {
    ruleKey: 'first', name: '已有共享限制', description: null, sortOrder: 0,
    eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
    conditionGroups: [],
    actions: [executeAction()],
    perTargetCooldown: null,
    maxTriggersPerProcess: null,
    oncePerUse: { groupKey: 'eclipse', scope: 'SKILL' },
    ...partial
  };
}

function toSummary(row: Json): Json {
  return {
    ruleKey: row.ruleKey, name: row.name, description: row.description,
    eventType: (row.eventSource as Json).eventType,
    conditionGroupCount: Array.isArray(row.conditionGroups) ? row.conditionGroups.length : 0,
    actionCount: Array.isArray(row.actions) ? row.actions.length : 0,
    perTargetCooldownEnabled: row.perTargetCooldown != null,
    maxTriggersPerProcessEnabled: row.maxTriggersPerProcess != null,
    oncePerUseEnabled: row.oncePerUse != null,
    sortOrder: row.sortOrder, updatedAt: NOW
  };
}

class AuthoringP6Api {
  unexpected: string[] = [];
  writes: Array<{ method: string; path: string; body: Json }> = [];
  rules: Json[] = [ruleDetail()];
  digest = 1;

  configuration(): Json {
    return {
      skill: skillRow(), parameters: [], formulas: [], internalStates: [], processes: [],
      effects: [{
        gameId: GAME_ID, skillKey: SKILL_KEY, effectKey: 'eclipse_hit', name: '星蚀伤害',
        description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW, lifecycle: null,
        results: [{
          resultKey: 'dmg', name: '伤害', resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 0,
          lifecycleBehavior: null, spellShieldBlockScope: null,
          valueRule: { value: { kind: 'FIXED', value: 1 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
          detail: { damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'DIRECT',
            critical: { mode: 'DISALLOWED', multiplierValue: null },
            vampQualification: 'UNRESOLVED', vampOverrides: [] }
        }]
      }],
      triggerRules: this.rules, baseDigest: `digest-${this.digest}`
    };
  }

  async install(page: Page) {
    await page.route('**/api/**', async route => {
      if (await fulfillAuthSession(route)) return;
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET,PATCH,POST,DELETE,OPTIONS'
          }
        });
        return;
      }
      await this.dispatch(route, url);
    });
  }

  private empty(route: Route) {
    return json(route, { items: [], total: 0 });
  }

  async dispatch(route: Route, url: URL) {
    const method = route.request().method();
    const pathname = url.pathname;
    const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (method === 'GET' && pathname === '/api/games') {
      await json(route, [{ gameId: GAME_ID, gameName: '第6项游戏' }]);
      return;
    }
    if (segments[0] !== 'api' || segments[1] !== 'admin' || segments[2] !== 'games') {
      this.unexpected.push(`${method} ${pathname}`);
      await json(route, { error: { code: '404.UNMOCKED', message: pathname } }, 404);
      return;
    }
    const tail = segments.slice(4);
    if (pathname.endsWith('/representative-image')) {
      await json(route, { image: null });
      return;
    }
    if (tail[0] === 'level-config' && method === 'GET') {
      await json(route, { gameId: GAME_ID, minLevel: 1, maxLevel: 18 });
      return;
    }
    if (pathname.endsWith('/vamp-rules') || tail[0] === 'skill-categories' || tail[0] === 'statuses'
      || tail[0] === 'modifier-zones' || tail[0] === 'damage-types') {
      await this.empty(route);
      return;
    }
    if (tail[0] === 'attributes' && method === 'GET') {
      await this.empty(route);
      return;
    }
    if (tail[0] === 'characters' && method === 'GET' && tail.length === 1) {
      await json(route, {
        items: [{ gameId: GAME_ID, characterKey: CHAR_KEY, name: '测试英雄', description: null, createdAt: NOW, updatedAt: NOW }],
        total: 1
      });
      return;
    }
    if (tail[0] === 'characters' && tail[2] === 'authoring-check' && method === 'GET') {
      await json(route, {
        gameId: GAME_ID, characterKey: CHAR_KEY, characterName: '测试英雄', checkedAt: NOW,
        conclusions: { structure: 'HAS_ERRORS', mechanics: 'NOT_CHECKED', runtime: 'NOT_RUN' },
        summary: { attachedSkillCount: 1, configuredAttributeCount: 0, errorCount: 1, reviewCount: 0 },
        skills: [{
          skillKey: SKILL_KEY, name: '星蚀被动', status: 'ENABLED', maxLevel: 1, sortOrder: 0,
          effectCount: 1, processCount: 0, triggerRuleCount: this.rules.length
        }],
        references: [],
        issues: [{
          severity: 'ERROR',
          code: 'ONCE_PER_USE_SCOPE_CONFLICT',
          message: '同技能同一共享限制键的范围必须一致',
          skillKey: SKILL_KEY,
          objectType: 'TRIGGER',
          objectKey: 'second',
          fieldPath: 'limits.oncePerUse.scope',
          location: location(
            { skillKey: SKILL_KEY, objectType: 'TRIGGER', objectKey: 'second', fieldPath: 'limits.oncePerUse.scope' },
            'TRIGGER_RULE',
            [{ kind: 'FIELD', field: 'oncePerUse' }, { kind: 'FIELD', field: 'scope' }]
          )
        }]
      });
      return;
    }
    if (tail[0] === 'character-skill-relations' && method === 'GET') {
      await json(route, {
        items: [{
          gameId: GAME_ID, characterKey: CHAR_KEY, characterName: '测试英雄',
          skillKey: SKILL_KEY, skillName: '星蚀被动', skillStatus: 'ENABLED', sortOrder: 0
        }],
        total: 1
      });
      return;
    }
    if (method === 'GET' && (
      tail[0]?.endsWith('-relations')
      || tail[0] === 'images'
      || tail[0] === 'runes'
      || tail[0] === 'rune-groups'
    )) {
      await this.empty(route);
      return;
    }
    if (tail[0] === 'skills' && tail.length === 1 && method === 'GET') {
      await json(route, { items: [skillRow()], total: 1 });
      return;
    }
    if (tail[0] === 'skills' && tail.length === 2 && method === 'GET') {
      await json(route, skillRow());
      return;
    }
    if (tail[0] === 'skills' && tail[2] === 'configuration') {
      if (method === 'GET') {
        await json(route, this.configuration());
        return;
      }
      if (method === 'PATCH' || method === 'POST') {
        const body = route.request().postDataJSON() as Json;
        this.writes.push({ method, path: pathname, body });
        const changes = body.changes as Json[];
        for (const change of changes) {
          if (change.objectType !== 'TRIGGER_RULE') continue;
          const next = change.value as Json;
          const once = next?.oncePerUse && typeof next.oncePerUse === 'object' ? next.oncePerUse as Json : null;
          const other = once && this.rules.find((item) => item.ruleKey !== change.key
            && item.oncePerUse && typeof item.oncePerUse === 'object'
            && (item.oncePerUse as Json).groupKey === once.groupKey
            && (item.oncePerUse as Json).scope !== once.scope);
          if (other) {
            await json(route, { error: { code: '409.SKILL_TRIGGER_RULE_ONCE_PER_USE_INVALID',
              message: '同次使用限制组范围与现有规则冲突', details: { fieldIssues: [{
                module: 'TRIGGER_RULE', key: change.key, field: 'oncePerUse.scope',
                message: '同技能同一共享限制键的范围必须一致（冲突规则：first）'
              }] } } }, 409);
            return;
          }
        }
        for (const change of changes) {
          if (change.objectType !== 'TRIGGER_RULE') continue;
          if (change.operation === 'DELETE') this.rules = this.rules.filter((item) => item.ruleKey !== change.key);
          else {
            const next = ruleDetail({ ...(change.value as Json), ruleKey: change.key });
            this.rules = this.rules.filter((item) => item.ruleKey !== change.key).concat(next);
          }
        }
        this.digest += 1;
        await json(route, this.configuration());
        return;
      }
    }
    if (tail[0] === 'skills' && tail[2] === 'parameters' && method === 'GET') {
      await json(route, []);
      return;
    }
    if (tail[0] === 'skills' && tail[2] === 'formulas' && method === 'GET') {
      await json(route, []);
      return;
    }
    if (tail[0] === 'skills' && tail[2] === 'internal-states' && method === 'GET') {
      await json(route, []);
      return;
    }
    if (tail[0] === 'skills' && tail[2] === 'processes' && method === 'GET') {
      await json(route, []);
      return;
    }
    if (tail[0] === 'skills' && tail[2] === 'effects' && method === 'GET') {
      const effect = {
        gameId: GAME_ID, skillKey: SKILL_KEY, effectKey: 'eclipse_hit', name: '星蚀伤害',
        description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW, lifecycle: null,
        results: [{
          resultKey: 'dmg', name: '伤害', resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 0,
          lifecycleBehavior: null, spellShieldBlockScope: null,
          valueRule: { value: { kind: 'FIXED', value: 1 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
          detail: {
            damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'DIRECT',
            critical: { mode: 'DISALLOWED', multiplierValue: null },
            vampQualification: 'UNRESOLVED', vampOverrides: []
          }
        }]
      };
      if (tail.length === 4) {
        await json(route, effect);
        return;
      }
      await json(route, [{
        gameId: GAME_ID, skillKey: SKILL_KEY, effectKey: 'eclipse_hit', name: '星蚀伤害',
        description: null, sortOrder: 0, resultCount: 1, lifecycleEnabled: false, createdAt: NOW, updatedAt: NOW
      }]);
      return;
    }
    if (tail[0] === 'skills' && tail[2] === 'trigger-rules') {
      await this.handleRules(route, method, pathname, tail);
      return;
    }
    this.unexpected.push(`${method} ${pathname}`);
    await json(route, { error: { code: '404.UNMOCKED', message: pathname } }, 404);
  }

  private async handleRules(route: Route, method: string, pathname: string, tail: string[]) {
    if (method === 'GET' && tail.length === 3) {
      await json(route, this.rules.map(toSummary));
      return;
    }
    if (method === 'GET' && tail.length === 4) {
      const found = this.rules.find((item) => item.ruleKey === tail[3]);
      if (!found) {
        await json(route, { error: { code: '404.SKILL_TRIGGER_RULE_NOT_FOUND', message: '触发规则不存在' } }, 404);
        return;
      }
      await json(route, found);
      return;
    }
    this.unexpected.push(`${method} ${pathname}`);
    await json(route, { error: { code: '404.UNMOCKED', message: pathname } }, 404);
  }
}

class ChargeHitAuthoringApi extends AuthoringP6Api {
  private authored = JSON.parse(JSON.stringify(simulationComplexSample('CHARGE').skillConfigurations[1])
    .replaceAll('demo', GAME_ID).replaceAll('sample_active', SKILL_KEY)) as ReturnType<typeof simulationComplexSample>['skillConfigurations'][number];

  constructor(qualified: boolean) {
    super();
    this.rules = this.authored.triggerRules.map(rule => ({ ...rule })) as Json[];
    if (!qualified) this.rules = this.rules.filter(rule => rule.ruleKey !== 'release_cast');
  }

  configuration() {
    return { ...super.configuration(), parameters: this.authored.parameters, formulas: this.authored.formulas,
      effects: this.authored.effects, processes: this.authored.processes };
  }
}

async function prepare(page: Page, api: AuthoringP6Api, hash = '/#/skills') {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await api.install(page);
  await page.addInitScript(apiBase => {
    localStorage.clear();
    sessionStorage.clear();
  }, API);
  await page.goto(hash);
  return () => {
    expect(errors, '未捕获浏览器异常').toEqual([]);
    expect(api.unexpected, '未定义或已删除接口请求').toEqual([]);
  };
}

function modal(page: Page, title: string) {
  return page.locator('.arco-modal:visible').filter({ has: page.locator('.arco-modal-title', { hasText: title }) });
}

function skillRowLocator(page: Page) {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name: SKILL_KEY, exact: true }) });
}

async function openTriggers(page: Page): Promise<Locator> {
  await skillRowLocator(page).getByRole('button', { name: '编辑配置', exact: true }).click();
  const shell = page.locator('[aria-label="技能统一编辑工作区"]');
  await expect(shell).toBeVisible();
  await shell.getByRole('navigation', { name: '技能配置模块' })
    .getByRole('button', { name: '条件与触发', exact: true }).click();
  await expect(shell.getByRole('button', { name: '新增规则', exact: true })).toBeVisible();
  return shell;
}

async function saveConfiguration(shell: Locator) {
  await shell.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(shell.getByText('已保存并核对', { exact: true })).toBeVisible();
}

function ruleCard(shell: Locator, key: string) {
  return shell.getByText(`（${key}）`, { exact: true })
    .locator('xpath=ancestor::div[.//button[normalize-space()="编辑"]][1]');
}

async function clickArcoRadioByVisibleLabel(editor: Locator, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const radioLabel = editor.locator('label.arco-radio', { hasText: new RegExp(`^${escaped}$`) });
  await radioLabel.scrollIntoViewIfNeeded();
  await expect(radioLabel).toBeVisible();
  await radioLabel.click();
  await expect(editor.getByRole('radio', { name: label, exact: true })).toBeChecked();
}

async function chooseEvent(page: Page, editor: Locator, optionName: string) {
  const trigger = editor.getByLabel('事件类型', { exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const textbox = trigger.getByRole('textbox');
  if (await textbox.count()) await textbox.fill(optionName);
  const option = page.getByRole('option', { name: optionName, exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect(option).toBeHidden();
}

async function fillDefaultAction(page: Page, editor: Locator) {
  await editor.getByRole('button', { name: '编辑', exact: true }).first().click();
  const action = modal(page, '编辑动作');
  await action.getByLabel('动作名称', { exact: true }).fill('执行伤害');
  await action.getByLabel('目标效果', { exact: true }).click();
  const option = page.getByRole('option', { name: '星蚀伤害', exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await action.getByRole('button', { name: '确定', exact: true }).click();
  await expect(action).toBeHidden();
}

test('同次使用限制启用禁用往返、共享键范围、事件切换确认和409定位', async ({ page }) => {
  const api = new AuthoringP6Api();
  const assertClean = await prepare(page, api);
  await expect(page.locator('.app-toolbar-field--game')).toContainText(GAME_ID);
  const shell = await openTriggers(page);
  await expect(ruleCard(shell, 'first')).toContainText('同次使用限制：eclipse（整个技能使用）');

  await shell.getByRole('button', { name: '新增规则', exact: true }).click();
  const create = modal(page, '新增规则');
  await create.getByLabel('规则标识', { exact: true }).fill('second');
  await create.getByLabel('规则名称', { exact: true }).fill('第二条共享限制');
  await chooseEvent(page, create, '技能命中');
  await expect(create.getByLabel('事件类型', { exact: true })).toContainText('技能命中');
  await fillDefaultAction(page, create);
  await expect(create.getByLabel('共享限制键', { exact: true })).toHaveCount(0);
  await create.getByRole('switch', { name: '同次使用仅触发一次', exact: true }).click();
  await create.getByLabel('共享限制键', { exact: true }).fill('eclipse');
  await expect(create.getByRole('radio', { name: '整个技能使用', exact: true })).toBeChecked();
  await clickArcoRadioByVisibleLabel(create, '每个目标');
  await create.getByRole('button', { name: '确认到技能草稿', exact: true }).click();
  await expect(create).toHaveCount(0);
  expect(api.rules.find((item) => item.ruleKey === 'second')).toBeUndefined();
  await expect(ruleCard(shell, 'second')).toContainText('同次使用限制：eclipse（每个目标）');
  await shell.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(shell.getByText('同技能同一共享限制键的范围必须一致（冲突规则：first）').first()).toBeVisible();
  expect(api.rules.find((item) => item.ruleKey === 'second')).toBeUndefined();

  await ruleCard(shell, 'second').getByRole('button', { name: '编辑', exact: true }).click();
  const corrected = modal(page, '新增规则');
  await expect(corrected.getByLabel('共享限制键', { exact: true })).toHaveValue('eclipse');
  await expect(corrected.getByRole('radio', { name: '每个目标', exact: true })).toBeChecked();
  await clickArcoRadioByVisibleLabel(corrected, '整个技能使用');
  await corrected.getByRole('button', { name: '确认到技能草稿', exact: true }).click();
  await saveConfiguration(shell);
  const saved = api.rules.find((item) => item.ruleKey === 'second');
  expect(saved?.oncePerUse).toEqual({ groupKey: 'eclipse', scope: 'SKILL' });
  await expect(ruleCard(shell, 'second')).toContainText('同次使用限制：eclipse（整个技能使用）');

  await ruleCard(shell, 'second').getByRole('button', { name: '编辑', exact: true }).click();
  const edit = modal(page, '编辑规则');
  await expect(edit.getByRole('switch', { name: '同次使用仅触发一次', exact: true })).toBeChecked();
  await expect(edit.getByLabel('共享限制键', { exact: true })).toHaveValue('eclipse');
  await expect(edit.getByRole('radio', { name: '整个技能使用', exact: true })).toBeChecked();

  await chooseEvent(page, edit, '技能被主动或消耗使用');
  const confirm = page.getByRole('dialog').filter({ hasText: '将关闭该限制' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(edit.getByLabel('事件类型', { exact: true })).toContainText('技能命中');
  await expect(edit.getByRole('switch', { name: '同次使用仅触发一次', exact: true })).toBeChecked();
  await expect(edit.getByLabel('共享限制键', { exact: true })).toHaveValue('eclipse');

  await chooseEvent(page, edit, '技能被主动或消耗使用');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '确定', exact: true }).click();
  await expect(edit.getByLabel('事件类型', { exact: true })).toContainText('技能被主动或消耗使用');
  await expect(edit.getByRole('switch', { name: '同次使用仅触发一次', exact: true })).not.toBeChecked();
  await expect(edit.getByLabel('共享限制键', { exact: true })).toHaveCount(0);

  await chooseEvent(page, edit, '普通攻击命中');
  await edit.getByRole('switch', { name: '同次使用仅触发一次', exact: true }).click();
  await expect(edit.getByLabel('共享限制键', { exact: true })).toHaveValue('eclipse');
  await edit.getByRole('button', { name: '确认到技能草稿', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await saveConfiguration(shell);
  expect(api.rules.find((item) => item.ruleKey === 'second')?.oncePerUse).toEqual({ groupKey: 'eclipse', scope: 'SKILL' });

  await ruleCard(shell, 'second').getByRole('button', { name: '编辑', exact: true }).click();
  const reopen = modal(page, '编辑规则');
  await expect(reopen.getByLabel('事件类型', { exact: true })).toContainText('普通攻击命中');
  await expect(reopen.getByRole('switch', { name: '同次使用仅触发一次', exact: true })).toBeChecked();
  await reopen.getByRole('switch', { name: '同次使用仅触发一次', exact: true }).click();
  await reopen.getByRole('button', { name: '确认到技能草稿', exact: true }).click();
  await expect(reopen).toHaveCount(0);
  await saveConfiguration(shell);
  expect(api.rules.find((item) => item.ruleKey === 'second')?.oncePerUse).toBeNull();

  await ruleCard(shell, 'second').getByRole('button', { name: '编辑', exact: true }).click();
  const disabled = modal(page, '编辑规则');
  await expect(disabled.getByRole('switch', { name: '同次使用仅触发一次', exact: true })).not.toBeChecked();
  await expect(disabled.getByLabel('共享限制键', { exact: true })).toHaveCount(0);
  await disabled.getByRole('button', { name: '取消', exact: true }).click();
  expect(api.writes.map(({ method, path }) => `${method} ${path}`)).toEqual(Array(4).fill(
    `PATCH /api/admin/games/${GAME_ID}/skills/${SKILL_KEY}/configuration`
  ));
  assertClean();
});

test('录入检查把 limits.oncePerUse.scope 定位到平铺范围锚点', async ({ page }) => {
  const api = new AuthoringP6Api();
  api.rules.push(ruleDetail({
    ruleKey: 'second', name: '冲突规则', sortOrder: 1,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } },
    oncePerUse: { groupKey: 'eclipse', scope: 'TARGET' }
  }));
  const assertClean = await prepare(page, api, '/#/characters');
  await page.getByRole('row').filter({ has: page.getByRole('cell', { name: CHAR_KEY, exact: true }) })
    .getByRole('button', { name: '录入检查', exact: true }).click();
  const check = modal(page, '录入检查 · 测试英雄');
  await check.getByRole('row').filter({ hasText: 'limits.oncePerUse.scope' }).getByRole('button', { name: '定位问题', exact: true }).click();
  const editor = modal(page, '编辑规则');
  await expect(editor.getByRole('switch', { name: '同次使用仅触发一次', exact: true })).toBeChecked();
  await expect(editor.locator('[data-authoring-field="scope"].authoring-field-active')).toBeVisible();
  await expect(editor.getByRole('radio', { name: '每个目标', exact: true })).toBeChecked();
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  expect(api.writes).toHaveLength(0);
  assertClean();
});

for (const qualified of [true, false]) test(`6C独立管理表单：${qualified ? '真实同源蓄力命中绑定可确认到草稿' : '缺实际释放声明不得提供充能值'}`, async ({ page }) => {
  const api = new ChargeHitAuthoringApi(qualified);
  const assertClean = await prepare(page, api);
  const shell = await openTriggers(page);
  const key = api.rules.find(rule => (rule.eventSource as Json).eventType === 'SKILL_HIT')!.ruleKey as string;
  await ruleCard(shell, key).getByRole('button', { name: '编辑', exact: true }).click();
  const editor = modal(page, '编辑规则');
  await editor.getByRole('button', { name: '编辑', exact: true }).first().click();
  const action = modal(page, '编辑动作');
  await action.getByRole('button', { name: '编辑', exact: true }).click();
  const binding = modal(page, '编辑绑定');
  await binding.getByLabel('绑定事件值', { exact: true }).click();
  const option = page.getByRole('option', { name: /实际蓄力毫秒数/ });
  if (qualified) {
    await expect(option).toBeVisible();
    await option.click();
    await binding.getByRole('button', { name: '确定', exact: true }).click();
    await expect(binding).toBeHidden();
    await action.getByRole('button', { name: '确定', exact: true }).click();
    await expect(action).toBeHidden();
    await editor.getByLabel('规则名称', { exact: true }).fill('独立同源蓄力命中草稿');
    await editor.getByRole('button', { name: '确认到技能草稿', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(ruleCard(shell, key)).toContainText('独立同源蓄力命中草稿');
    mkdirSync(resolve('output/phase6c'), { recursive: true });
    await page.screenshot({ path: resolve('output/phase6c/construct-charge-hit-authoring.png'), fullPage: true });
  } else {
    await expect(option).toHaveCount(0);
    await binding.getByLabel('绑定事件值', { exact: true }).click();
    await binding.getByRole('button', { name: '取消', exact: true }).click();
    await action.getByRole('button', { name: '取消', exact: true }).click();
    await editor.getByRole('button', { name: '确认到技能草稿', exact: true }).click();
    await expect(editor.getByText('当前事件不提供该事件值。', { exact: true })).toBeVisible();
  }
  expect(api.writes).toHaveLength(0);
  assertClean();
});

class SystemEnumsAuthoringApi extends AuthoringP6Api {
  constructor() {
    super();
    this.rules = [ruleDetail({
      ruleKey: 'received', name: '受到普攻供值样例', oncePerUse: null,
      eventSource: { eventType: 'BASIC_ATTACK_RECEIVED', detail: {} },
      actions: [{ ...executeAction(), runtimeInputBindings: [
        { bindingKey: 'elapsed', parameterKey: 'elapsed_ms', sourceType: 'COMBAT_ELAPSED_TIME', detail: { subject: 'SOURCE' } },
        { bindingKey: 'recent', parameterKey: 'recent_damage', sourceType: 'RECENT_DAMAGE_SUM', detail: {
          subject: 'CURRENT_TARGET', windowValue: { kind: 'FIXED', value: 1000 }, outputKind: 'ACTUAL_HP_LOSS',
          sourceSkillKey: null, damageTypeKey: null, deliveryKind: 'ANY', originKind: 'DIRECT'
        } }
      ] }]
    })];
  }

  configuration(): Json {
    const base = super.configuration();
    const effects = structuredClone(base.effects) as Json[];
    ((effects[0].results as Json[])[0].valueRule as Json).value = { kind: 'FORMULA', formulaKey: 'observed_damage' };
    return { ...base, effects,
      parameters: ['elapsed_ms', 'recent_damage'].map(parameterKey => ({ gameId: GAME_ID, skillKey: SKILL_KEY, parameterKey,
        name: parameterKey, valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null,
        description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW })),
      formulas: [{ gameId: GAME_ID, skillKey: SKILL_KEY, formulaKey: 'observed_damage', name: '明确供值样例', description: null,
        sortOrder: 0, createdAt: NOW, updatedAt: NOW, expression: {
          inputs: ['elapsed_ms', 'recent_damage'].map(parameterKey => ({ key: parameterKey, binding: { kind: 'parameter', skillKey: SKILL_KEY, parameterKey } })),
          stages: [{ key: 'observed', name: '明确参数总和', expression: { op: 'add', args: [
            { op: 'read', inputKey: 'elapsed_ms' }, { op: 'read', inputKey: 'recent_damage' }
          ] } }], outputStageKey: 'observed'
        } }]
    };
  }
}

test('系统枚举专项：受到普攻列表明细、固定事件选择和两种供值编辑读取', async ({ page }, info) => {
  const api = new SystemEnumsAuthoringApi();
  const assertClean = await prepare(page, api);
  const shell = await openTriggers(page);
  await expect(ruleCard(shell, 'received')).toContainText(SKILL_TRIGGER_EVENT_TYPE_LABELS.BASIC_ATTACK_RECEIVED);
  // 浏览器保留真实HTTP读回，解析使用当前服务函数，避免依赖仅开发服务提供的源码地址。
  // 后续界面断言仍经过正式构建的统一技能工作区；请求封装另由服务单测覆盖。
  const wireReadback = await page.evaluate(async ({ base, gameId, skillKey }) => {
    const path = `${base}/api/admin/games/${encodeURIComponent(gameId)}/skills/${encodeURIComponent(skillKey)}/trigger-rules`;
    const headers = { Accept: 'application/json' };
    const [listed, loaded] = await Promise.all([
      fetch(path, { headers }), fetch(`${path}/received`, { headers })
    ]);
    if (!listed.ok || !loaded.ok) throw new Error(`规则读回失败：${listed.status}/${loaded.status}`);
    const summaries: unknown = await listed.json();
    if (!Array.isArray(summaries)) throw new Error('规则名单响应不是列表');
    return { summaries, detail: await loaded.json(), statuses: [listed.status, loaded.status] };
  }, { base: API, gameId: GAME_ID, skillKey: SKILL_KEY });
  expect(wireReadback.statuses).toEqual([200, 200]);
  const readback = {
    summaries: wireReadback.summaries.map(parseSkillTriggerRuleSummary),
    detail: parseSkillTriggerRuleDetail(wireReadback.detail)
  };
  expect(readback.summaries[0].eventType).toBe('BASIC_ATTACK_RECEIVED');
  expect(readback.detail.actions[0].runtimeInputBindings.map(binding => binding.sourceType)).toEqual(['COMBAT_ELAPSED_TIME', 'RECENT_DAMAGE_SUM']);
  await ruleCard(shell, 'received').getByRole('button', { name: '编辑', exact: true }).click();
  const editor = modal(page, '编辑规则');
  await editor.getByLabel('事件类型', { exact: true }).click();
  await expect(page.getByRole('option', { name: SKILL_TRIGGER_EVENT_TYPE_LABELS.SOURCE_INITIALIZED, exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: SKILL_TRIGGER_EVENT_TYPE_LABELS.BASIC_ATTACK_START, exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: SKILL_TRIGGER_EVENT_TYPE_LABELS.BASIC_ATTACK_HIT, exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: SKILL_TRIGGER_EVENT_TYPE_LABELS.BASIC_ATTACK_RECEIVED, exact: true })).toBeVisible();
  await page.getByRole('option', { name: SKILL_TRIGGER_EVENT_TYPE_LABELS.BASIC_ATTACK_RECEIVED, exact: true }).click();
  await editor.getByRole('button', { name: '编辑', exact: true }).first().click();
  const action = modal(page, '编辑动作');
  await expect(action).toContainText(SKILL_TRIGGER_SOURCE_TYPE_LABELS.COMBAT_ELAPSED_TIME);
  await expect(action).toContainText(SKILL_TRIGGER_SOURCE_TYPE_LABELS.RECENT_DAMAGE_SUM);
  await action.getByRole('button', { name: '编辑', exact: true }).first().click();
  const elapsed = modal(page, '编辑绑定');
  await expect(elapsed.getByLabel('入战对象', { exact: true })).toContainText('来源对象');
  await elapsed.getByRole('button', { name: '取消', exact: true }).click();
  await action.getByRole('button', { name: '编辑', exact: true }).nth(1).click();
  const recent = modal(page, '编辑绑定');
  await expect(recent.getByLabel('受伤对象', { exact: true })).toContainText('当前目标');
  await expect(recent.getByLabel('受伤累计口径', { exact: true })).toContainText('实际扣血');
  await recent.getByLabel('受伤产生方式', { exact: true }).click();
  await expect(page.getByRole('option', { name: '普通攻击', exact: true })).toBeVisible();
  await page.getByRole('option', { name: '任意', exact: true }).click();
  await recent.getByRole('button', { name: '取消', exact: true }).click();
  await action.getByRole('button', { name: '取消', exact: true }).click();
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await info.attach('完整读取与固定枚举页面证据', { contentType: 'application/json', body: Buffer.from(JSON.stringify(readback, null, 2)) });
  expect(api.writes).toHaveLength(0);
  assertClean();
});
