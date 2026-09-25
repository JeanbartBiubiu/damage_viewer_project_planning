import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/project/damage_web_dev/web/package.json');
const { chromium } = require('playwright');
const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const at = '2026-09-24T00:00:00Z';
const gameId = 'mock_gate';
const skillKey = 'rune_8014_passive';
const item = (more) => ({ gameId, createdAt: at, updatedAt: at, ...more });
const skill = item({ skillKey, name: '致命一击', description: null, maxLevel: 1,
  status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['rune'] });
const hp = item({ attributeKey: 'hp', name: '生命值', valueType: 'DECIMAL', minValue: 0,
  maxValue: null, description: null, status: 'ENABLED', sortOrder: 0 });
const zone = item({ modifierZoneKey: 'damage_pre_defense', name: '防御前伤害比例', domain: 'DAMAGE',
  calculationMode: 'RATIO_ADD', applicationStage: 'DAMAGE_PRE_DEFENSE',
  description: null, status: 'ENABLED', sortOrder: 0 });
const params = [item({ skillKey, parameterKey: 'target_health_threshold_ratio', name: '目标生命门槛比例',
  valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.4, levelValues: null,
  description: null, sortOrder: 0 })];
const savedEffect = item({ skillKey, effectKey: 'low_health_bonus', name: '低生命目标增伤',
  description: null, sortOrder: 0,
  lifecycle: { durationValue: null, maxStacksValue: { kind: 'FIXED', value: 1 },
    applicationStacksValue: { kind: 'FIXED', value: 1 }, instanceScope: 'SOURCE',
    reapplicationStackMode: 'KEEP', reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY',
    periodicIntervalValue: null, firstPeriodicExecution: null },
  results: [{ resultKey: 'damage_bonus', name: '条件增伤', resultType: 'DAMAGE_MODIFIER',
    target: 'SOURCE', description: null, sortOrder: 0, spellShieldBlockScope: null,
    lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT',
      stackValueMode: 'SHARED', reapplicationValueMode: 'KEEP', periodicExecutionMode: null },
    valueRule: { value: { kind: 'FIXED', value: 0.08 }, fixedMultiplier: 1,
      fixedMinValue: null, fixedMaxValue: null },
    detail: { modifierZoneKey: 'damage_pre_defense', direction: 'DEALT', operation: 'INCREASE',
      damageTypeKey: null, deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT', criticalFilter: 'ANY',
      condition: { receiver: 'ENEMY_CHAMPION', attributeKey: 'hp',
        attributeValueKind: 'CURRENT_RATIO', comparator: 'LT',
        comparisonValue: { kind: 'FORMULA', formulaKey: 'threshold_formula' } } } }] });
const responses = [];
const writes = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
page.setDefaultTimeout(5000);
page.on('pageerror', (error) => responses.push(`PAGE_ERROR ${error.message}`));
await page.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('damage-viewer.web.api-base-url', 'http://127.0.0.1:19080');
  localStorage.setItem('damage-viewer.web.admin-token', 'isolated-ui-token');
});
await page.route('**/api/**', async (route) => {
  const request = route.request();
  const method = request.method();
  const pathname = new URL(request.url()).pathname;
  if (method !== 'GET') {
    writes.push({ method, path: pathname });
    await route.abort();
    return;
  }
  let body;
  if (pathname === '/api/games') body = [{ gameId, gameName: '隔离页面', representativeImageKey: null }];
  else if (pathname === `/api/admin/games/${gameId}/skills`) body = { items: [skill], total: 1 };
  else if (pathname === `/api/admin/games/${gameId}/skills/${skillKey}`) body = skill;
  else if (pathname === `/api/admin/games/${gameId}/skills/${skillKey}/effects`) body = [{
    gameId, skillKey, effectKey: savedEffect.effectKey, name: savedEffect.name,
    description: null, sortOrder: 0, resultCount: 1, lifecycleEnabled: true,
    createdAt: at, updatedAt: at
  }];
  else if (pathname === `/api/admin/games/${gameId}/skills/${skillKey}/effects/low_health_bonus`) body = savedEffect;
  else if (pathname === `/api/admin/games/${gameId}/skills/${skillKey}/formulas`) body = [{
    gameId, skillKey, formulaKey: 'threshold_formula', name: '动态门槛公式',
    description: null, sortOrder: 0, createdAt: at, updatedAt: at
  }];
  else if (pathname === `/api/admin/games/${gameId}/skills/${skillKey}/formulas/threshold_formula`) {
    responses.push('FORMULA_GET threshold_formula');
    body = item({ skillKey, formulaKey: 'threshold_formula', name: '动态门槛公式',
      description: null, sortOrder: 0,
      expression: { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET',
        attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO' } });
  }
  else if (pathname === `/api/admin/games/${gameId}/skills/${skillKey}/parameters`) body = params;
  else if (pathname === `/api/admin/games/${gameId}/skill-categories`) body = {
    items: [item({ skillCategoryKey: 'rune', name: '符文', description: null,
      status: 'ENABLED', sortOrder: 0 })], total: 1
  };
  else if (pathname === `/api/admin/games/${gameId}/attributes`) body = { items: [hp], total: 1 };
  else if (pathname === `/api/admin/games/${gameId}/modifier-zones`) body = { items: [zone], total: 1 };
  else if (pathname === `/api/admin/games/${gameId}/damage-types`) body = { items: [], total: 0 };
  else if (pathname === `/api/admin/games/${gameId}/statuses`) body = { items: [], total: 0 };
  else if (pathname === `/api/admin/games/${gameId}/vamp-rules`) body = { rules: [] };
  else if (pathname.endsWith('/representative-image')) body = { image: null };
  else if (pathname === `/api/games/${gameId}/images`) body = { gameId, images: [] };
  else {
    responses.push(`UNMOCKED_GET ${pathname}`);
    body = { items: [], total: 0 };
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

try {
  await page.goto('http://127.0.0.1:4182/#/skills');
  await page.locator('.app-toolbar-field--game .arco-select-view-value').getByText(gameId).waitFor();
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: skillKey, exact: true }) });
  await row.getByRole('button', { name: '效果与结果', exact: true }).click();
  const shell = page.getByRole('dialog', { name: '效果与结果 - 致命一击' });
  await shell.getByRole('button', { name: '新增效果', exact: true }).click();
  const effect = page.getByRole('dialog', { name: '新增效果' });
  await effect.getByRole('button', { name: '新增结果', exact: true }).click();
  const result = page.getByRole('dialog', { name: '新增结果' });
  await result.getByLabel('结果种类', { exact: true }).click();
  await page.getByRole('option', { name: '伤害修正', exact: true }).click();
  await page.getByRole('dialog', { name: '启用效果生命周期' })
    .getByRole('button', { name: '启用并继续', exact: true }).click();
  await result.getByLabel('启用逐笔生命门槛').check();
  await result.getByText('敌方英雄（相对本笔实际伤害来源）', { exact: true }).waitFor();
  await result.getByText('扣血前当前生命比例', { exact: true }).waitFor();
  await result.getByLabel('承受者生命属性').click();
  await page.getByRole('option', { name: '生命值', exact: true }).click();
  await result.getByLabel('生命比例门槛取值来源').getByText('技能参数', { exact: true }).click();
  await result.getByLabel('生命比例门槛技能参数').click();
  await page.getByRole('option', { name: '目标生命门槛比例（target_health_threshold_ratio）', exact: true }).click();
  await page.screenshot({ path: path.join(evidenceDir, '隔离页面-条件控件.png'), fullPage: true });
  const conditionVisible = {
    target: await result.getByText('敌方英雄（相对本笔实际伤害来源）').count(),
    ratio: await result.getByText('扣血前当前生命比例').count(),
    hp: await result.getByLabel('承受者生命属性').innerText(),
    threshold: await result.getByLabel('生命比例门槛技能参数').innerText(),
    strictLess: await result.getByRole('radio', { name: /严格低于/ }).count(),
    strictGreater: await result.getByRole('radio', { name: /严格高于/ }).count()
  };
  await result.getByLabel('结果种类', { exact: true }).click();
  await page.getByRole('option', { name: '直接治疗', exact: true }).click();
  const cleanup = page.getByRole('dialog', { name: '清除逐笔生命门槛' });
  await cleanup.getByText('当前修改会清除逐笔生命门槛。是否继续？').waitFor();
  await page.screenshot({ path: path.join(evidenceDir, '隔离页面-门槛清理确认.png'), fullPage: true });
  await cleanup.getByRole('button', { name: '取消', exact: true }).click();
  const cancelKeptCondition = await result.getByLabel('承受者生命属性').count() === 1;
  await result.getByLabel('结果种类', { exact: true }).click();
  await page.getByRole('option', { name: '直接治疗', exact: true }).click();
  await page.getByRole('dialog', { name: '清除逐笔生命门槛' })
    .getByRole('button', { name: '继续', exact: true }).click();
  const confirmClearedCondition = await result.getByLabel('启用逐笔生命门槛').count() === 0;
  await result.getByLabel('结果种类', { exact: true }).click();
  await page.getByRole('option', { name: '伤害修正', exact: true }).click();
  await result.getByLabel('启用逐笔生命门槛').check();
  await result.getByLabel('启用逐笔生命门槛').uncheck();
  const controlsCleared = await result.getByLabel('承受者生命属性').count() === 0;
  const discardConfirmations = [];
  page.on('dialog', async (dialog) => {
    discardConfirmations.push(dialog.message());
    if (dialog.message() === '当前修改尚未保存，确定要离开吗？') await dialog.accept();
    else await dialog.dismiss();
  });
  await result.getByRole('button', { name: '取消', exact: true }).click();
  await result.waitFor({ state: 'hidden' });
  await effect.getByRole('button', { name: '取消', exact: true }).click();
  await effect.waitFor({ state: 'hidden' });
  await shell.locator('tr', { hasText: 'low_health_bonus' })
    .getByRole('button', { name: '编辑', exact: true }).click();
  const saved = page.getByRole('dialog', { name: '编辑效果' });
  await saved.getByRole('button', { name: '保存', exact: true }).click();
  await saved.getByText('逐笔生命门槛公式核对未通过，请检查对应结果。').waitFor();
  const formulaBlocked = await saved.getByText('门槛公式不能读取属性。').count() > 0;
  await page.screenshot({ path: path.join(evidenceDir, '隔离页面-公式保存拦截.png'), fullPage: true });
  await saved.getByRole('button', { name: '取消', exact: true }).click();
  await saved.waitFor({ state: 'hidden' });
  fs.writeFileSync(path.join(evidenceDir, '隔离页面-条件控件.json'), JSON.stringify({
    conditionVisible, cancelKeptCondition, confirmClearedCondition, controlsCleared, formulaBlocked,
    discardConfirmations, writes, responses, browserContexts: browser.contexts().length,
    pages: context.pages().length
  }, null, 2));
  if (!cancelKeptCondition || !confirmClearedCondition || !controlsCleared || !formulaBlocked || writes.length
    || responses.some((entry) => entry.startsWith('PAGE_ERROR'))) {
    throw new Error('隔离页面检查失败，详见证据');
  }
  console.log('PASS', JSON.stringify({ conditionVisible, cancelKeptCondition,
    confirmClearedCondition, controlsCleared, formulaBlocked, writes: writes.length, responses }));
} catch (error) {
  await page.screenshot({ path: path.join(evidenceDir, '隔离页面-定位失败.png'), fullPage: true });
  fs.writeFileSync(path.join(evidenceDir, '隔离页面-定位失败.json'), JSON.stringify({
    error: String(error), dialogs: await page.getByRole('dialog').allInnerTexts(),
    options: await page.getByRole('option').allInnerTexts(),
    writes, responses
  }, null, 2));
  throw error;
} finally {
  await browser.close();
}
