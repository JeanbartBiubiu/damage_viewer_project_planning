import { expect, test, type Page } from '@playwright/test';
import type { SkillConfiguration, SkillConfigurationChange } from '../../src/types/skillConfiguration';
import { fixedValue } from '../../src/types/numericValue';

const API = 'http://127.0.0.1:19091';
const savedAt = '2026-10-06T00:00:00Z';

function configuration(): SkillConfiguration {
  const base = { gameId: 'window_fixture', skillKey: 'window_sample', description: null, sortOrder: 0, createdAt: savedAt, updatedAt: savedAt };
  return { skill: { ...base, name: '独立窗口表单样例', maxLevel: 1, status: 'ENABLED', skillCategoryKeys: [] },
    parameters: ['first', 'last'].map((parameterKey, index) => ({ ...base, parameterKey, name: index ? '末段参数' : '首段参数',
      valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: index, levelValues: null })),
    formulas: [{ ...base, formulaKey: 'last_formula', name: '末段公式', expression: { nodeType: 'PARAMETER', parameterKey: 'last' } }],
    effects: [{ ...base, effectKey: 'marker', name: '表单引用样例', lifecycle: null, results: [] }],
    processes: [{ ...base, processKey: 'window', name: '指定窗口引导', activationType: 'ACTIVE', cooldown: null,
      steps: [{ stepKey: 'channel', name: '引导步骤', stepType: 'CHANNEL', occupiesAction: true, description: null, sortOrder: 0,
        detail: { firstExecution: 'IMMEDIATE', durationValue: fixedValue(20), executionCountValue: fixedValue(4) } }],
      effectBindings: [{ bindingKey: 'marker', effectKey: 'marker', sortOrder: 0,
        moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } }], stateOperations: [] }],
    internalStates: [], triggerRules: [], baseDigest: 'window-fixture-1' };
}

async function install(page: Page, rejectWrite = false) {
  const state = { current: configuration(), writes: [] as Array<{ baseDigest: string; changes: SkillConfigurationChange[] }>, unexpected: [] as string[] };
  await page.addInitScript(({ api }) => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', 'independent-window-fixture');
  }, { api: API });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
      return;
    }
    if (url.origin !== API) { state.unexpected.push(url.pathname); await route.abort(); return; }
    if (request.method() === 'GET' && url.pathname === '/api/games') {
      await respond([{ gameId: 'window_fixture', gameName: '独立窗口表单', representativeImageKey: null }]);
    } else if (request.method() === 'GET' && url.pathname.endsWith('/configuration')) {
      await respond(state.current);
    } else if (request.method() === 'PATCH' && url.pathname.endsWith('/configuration')) {
      const body = request.postDataJSON() as typeof state.writes[number];
      state.writes.push(body);
      if (rejectWrite) {
        await respond({ error: { code: '400.INVALID_SKILL_NUMERIC_VALUE', message: '独立模拟：末段范围非法', details: {
          fieldIssues: [{ field: 'steps[0].detail.lastExecutionOffsetValue', sourceType: 'PROCESS', sourceKey: 'window', sourceSkillKey: 'window_sample',
            code: 'CHANNEL_WINDOW_INVALID', message: '末段超过完整时长。' }] } } }, 400);
        return;
      }
      for (const change of body.changes) {
        if (change.objectType !== 'PROCESS' || change.operation !== 'UPDATE') throw new Error('隔离用例不接受其它写入');
        state.current.processes[0] = { ...state.current.processes[0]!, ...change.value };
      }
      state.current.baseDigest = 'window-fixture-2';
      await respond(state.current);
    } else if (request.method() === 'GET' && url.pathname.endsWith('/skills')) {
      await respond({ items: [state.current.skill], total: 1 });
    } else if (request.method() === 'GET' && url.pathname.endsWith('/level-config')) {
      await respond({ minLevel: 1, maxLevel: 18 });
    } else if (request.method() === 'GET' && url.pathname.endsWith('/vamp-rules')) {
      await respond({ rules: [] });
    } else if (request.method() === 'GET' && url.pathname.includes('representative-image')) {
      await respond({ image: null });
    } else if (request.method() === 'GET' && /\/(attributes|skill-categories|damage-types|statuses)$/.test(url.pathname)) {
      await respond({ items: [], total: 0 });
    } else { state.unexpected.push(`${request.method()} ${url.pathname}`); await route.abort(); }
  });
  await page.goto('/#/skills');
  await page.locator('tr', { hasText: 'window_sample' }).getByRole('button', { name: '编辑配置', exact: true }).click();
  const workspace = page.locator('[aria-label="技能统一编辑工作区"]');
  await expect(workspace).toBeVisible();
  await workspace.getByRole('navigation', { name: '技能配置模块' }).getByRole('button', { name: '施放过程', exact: true }).click();
  return { state, workspace };
}

async function editWindow(page: Page) {
  const workspace = page.locator('[aria-label="技能统一编辑工作区"]');
  await workspace.getByRole('button', { name: '编辑', exact: true }).first().click();
  const process = page.getByRole('dialog', { name: '编辑过程', exact: true });
  await process.getByRole('button', { name: '编辑', exact: true }).first().click();
  const step = page.getByRole('dialog', { name: '编辑步骤', exact: true });
  await step.getByText('指定首末执行窗口', { exact: true }).click();
  await step.getByLabel('持续时间取值固定数值', { exact: true }).fill('1');
  await step.getByLabel('执行次数取值固定数值', { exact: true }).fill('2');
  return { process, step };
}

test('独立管理表单：1毫秒两段固定窗口、同次聚合保存及回读', async ({ page }) => {
  const { state, workspace } = await install(page);
  const { process, step } = await editWindow(page);
  await step.getByLabel('首段执行偏移取值固定数值', { exact: true }).fill('0');
  await step.getByRole('button', { name: '保存', exact: true }).click();
  await expect(step.getByText('请配置末段执行偏移。')).toBeVisible();
  await step.getByLabel('末段执行偏移取值固定数值', { exact: true }).fill('1');
  await step.getByRole('button', { name: '保存', exact: true }).click();
  await process.getByRole('button', { name: '确认到技能草稿', exact: true }).click();
  expect(state.writes).toHaveLength(0);
  await workspace.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]!.changes).toEqual([expect.objectContaining({ objectType: 'PROCESS', operation: 'UPDATE', key: 'window',
    value: expect.objectContaining({ steps: [expect.objectContaining({ stepType: 'CHANNEL', detail: {
      durationValue: fixedValue(1), executionCountValue: fixedValue(2), firstExecution: 'CUSTOM_WINDOW',
      firstExecutionOffsetValue: fixedValue(0), lastExecutionOffsetValue: fixedValue(1) } })] }) })]);
  await expect(workspace.getByRole('button', { name: '保存更改', exact: true })).toBeDisabled();
  const reopened = await editWindow(page);
  await expect(reopened.step.getByLabel('首段执行偏移取值固定数值', { exact: true })).toHaveValue('0');
  await expect(reopened.step.getByLabel('末段执行偏移取值固定数值', { exact: true })).toHaveValue('1');
  expect(state.unexpected).toEqual([]);
});

test('独立管理表单：参数与公式窗口引用、保存失败保留完整草稿', async ({ page }) => {
  const { state, workspace } = await install(page, true);
  const { process, step } = await editWindow(page);
  await step.getByRole('group', { name: '首段执行偏移取值', exact: true }).getByText('技能参数', { exact: true }).click();
  await step.getByLabel('首段执行偏移取值技能参数', { exact: true }).click();
  await page.getByRole('option', { name: '首段参数（first）', exact: true }).click();
  await step.getByRole('group', { name: '末段执行偏移取值', exact: true }).getByText('技能公式', { exact: true }).click();
  await step.getByLabel('末段执行偏移取值技能公式', { exact: true }).click();
  await page.getByRole('option', { name: '末段公式（last_formula）', exact: true }).click();
  await step.getByRole('button', { name: '保存', exact: true }).click();
  await process.getByRole('button', { name: '确认到技能草稿', exact: true }).click();
  await workspace.getByRole('navigation', { name: '技能配置模块' }).getByRole('button', { name: '参数与公式', exact: true }).click();
  await expect(workspace.getByText('引用：过程「指定窗口引导」（window）', { exact: true }).first()).toBeVisible();
  await workspace.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  await expect(workspace.getByText('独立模拟：末段范围非法').first()).toBeVisible();
  await workspace.getByRole('navigation', { name: '技能配置模块' }).getByRole('button', { name: '施放过程', exact: true }).click();
  const reopened = await editWindow(page);
  await expect(reopened.step.getByRole('group', { name: '首段执行偏移取值', exact: true }).getByLabel('技能参数', { exact: true })).toBeChecked();
  await expect(reopened.step.getByRole('group', { name: '末段执行偏移取值', exact: true }).getByLabel('技能公式', { exact: true })).toBeChecked();
  expect(state.unexpected).toEqual([]);
});
