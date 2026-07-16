import { expect, test, type Page, type Response } from '@playwright/test';

const API_BASE_STORAGE_KEY = 'damage-viewer.web.api-base-url';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for wasm-generic e2e (fail-closed). Set a non-empty value; tests never skip when it is missing.`
    );
  }
  return value;
}

const apiBaseUrl = requireEnv('E2E_API_BASE_URL');
const gameId = requireEnv('E2E_GAME_ID');
const sourceEntityId = requireEnv('E2E_SOURCE_ENTITY_ID');
const targetEntityId = requireEnv('E2E_TARGET_ENTITY_ID');
if (sourceEntityId === targetEntityId) {
  throw new Error(
    `E2E_SOURCE_ENTITY_ID and E2E_TARGET_ENTITY_ID must differ (got both "${sourceEntityId}"). ` +
      `Configure a distinct runnable source/target pair.`
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Select an Arco entity combobox scoped by its Form.Item label (not global ordinal).
 * Option labels are `${entityId} (${displayName})` — match by ID prefix, then confirm the view.
 */
async function selectEntityByFormLabel(page: Page, formLabel: string, entityId: string): Promise<void> {
  // Arco Form.Item: label lives under `.arco-form-label-item > label`, select under the same `.arco-form-item`.
  const formItem = page.locator('.arco-form-item').filter({
    has: page.locator('.arco-form-label-item label', { hasText: formLabel })
  });
  const select = formItem.locator('.arco-select');
  await expect(
    select,
    `entity combobox for Form.Item label "${formLabel}" must be visible`
  ).toBeVisible({ timeout: 30_000 });

  const selectedView = formItem.locator('.arco-select-view-value');
  const currentValue = (await selectedView.textContent())?.trim() ?? '';
  if (!currentValue.startsWith(entityId)) {
    await select.click();
    const option = page
      .locator('.arco-select-option')
      .filter({ hasText: new RegExp(`^${escapeRegExp(entityId)}`) })
      .first();
    await expect(
      option,
      `no Arco select option whose visible label begins with entityId="${entityId}" ` +
        `under Form.Item "${formLabel}" (check E2E_*_ENTITY_ID against combat-data entities)`
    ).toBeVisible({ timeout: 15_000 });
    await option.click();
  }

  await expect(
    selectedView,
    `Form.Item "${formLabel}" select view must show configured entityId="${entityId}"`
  ).toContainText(entityId);
}

/** Public combat-data resource URLs for the selected game (not admin). */
function isSelectedGamePublicCombatDataUrl(url: string): boolean {
  const marker = `/api/games/${encodeURIComponent(gameId)}/combat-data/`;
  const unencoded = `/api/games/${gameId}/combat-data/`;
  return url.includes(marker) || url.includes(unencoded);
}

/** progression-schema 404 is explicitly tolerated by loadCombatDataGraph. */
function isOptionalCombatDataNotFound(response: Response): boolean {
  return response.status() === 404 && response.url().includes('/progression-schema');
}

function attachCombatData5xxGuard(page: Page): { assertNo5xx: () => void } {
  const failures: string[] = [];
  page.on('response', (response) => {
    if (!isSelectedGamePublicCombatDataUrl(response.url())) {
      return;
    }
    if (isOptionalCombatDataNotFound(response)) {
      return;
    }
    if (response.status() >= 500) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  return {
    assertNo5xx: () => {
      expect(
        failures,
        `selected game public /combat-data/ resource returned HTTP 5xx (page shell must not pass): ${failures.join('; ')}`
      ).toEqual([]);
    }
  };
}

test.describe('wasm combat-data e2e', () => {
  test('backend probe: current version and combat-data state', async ({ request }) => {
    const current = await request.get(
      `${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/versions/current`
    );
    expect(
      current.status(),
      `GET .../versions/current must succeed for gameId=${gameId} (backend unreachable or current version missing)`
    ).toBe(200);
    expect(current.ok()).toBeTruthy();

    const state = await request.get(
      `${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/combat-data/state`
    );
    expect(
      state.status(),
      `GET .../combat-data/state must succeed for gameId=${gameId} (combat-data state unavailable)`
    ).toBe(200);
    expect(state.ok()).toBeTruthy();
    const body = await state.json();
    expect(body.gameId, 'combat-data state gameId must match E2E_GAME_ID').toBe(gameId);
    expect(typeof body.currentRevision).toBe('number');
    expect(body.data?.currentRevision).toBeDefined();

    const abilities = await request.get(
      `${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/combat-data/abilities`
    );
    expect(
      abilities.status(),
      `GET .../combat-data/abilities must return HTTP 200 for gameId=${gameId}. ` +
        `A non-200 here usually means schema/API drift (e.g. missing columns such as cast_condition_formula_key) ` +
        `or an incompatible backend — not a successful combat-data page shell.`
    ).toBe(200);
    expect(abilities.ok()).toBeTruthy();

    const entities = await request.get(
      `${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/combat-data/entities`
    );
    expect(
      entities.status(),
      `GET .../combat-data/entities must return HTTP 200 for gameId=${gameId} ` +
        `(cannot prove E2E_SOURCE_ENTITY_ID / E2E_TARGET_ENTITY_ID exist)`
    ).toBe(200);
    expect(entities.ok()).toBeTruthy();
    const entitiesBody = await entities.json();
    const entityList = Array.isArray(entitiesBody.data) ? entitiesBody.data : [];
    const entityIds = entityList.map((row: { entityId?: string }) => row.entityId);
    expect(
      entityIds,
      `E2E_SOURCE_ENTITY_ID="${sourceEntityId}" must exist in public /combat-data/entities for gameId=${gameId}`
    ).toContain(sourceEntityId);
    expect(
      entityIds,
      `E2E_TARGET_ENTITY_ID="${targetEntityId}" must exist in public /combat-data/entities for gameId=${gameId}`
    ).toContain(targetEntityId);
  });

  test('browser flow: combat-data ready → explicit source/target → compile → run → release', async ({
    page,
    request
  }) => {
    const state = await request.get(
      `${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/combat-data/state`
    );
    expect(
      state.status(),
      `combat-data state must be available before browser assertion (gameId=${gameId})`
    ).toBe(200);
    const stateBody = await state.json();
    expect(stateBody.gameId).toBe(gameId);

    const { assertNo5xx } = attachCombatData5xxGuard(page);

    await page.addInitScript(
      ({ storageKey, baseUrl }) => {
        window.localStorage.setItem(storageKey, baseUrl);
      },
      { storageKey: API_BASE_STORAGE_KEY, baseUrl: apiBaseUrl }
    );

    await page.goto('/#/wasm-validation-generic');

    const gameSelect = page.locator('.app-toolbar-field--game .arco-select');
    await expect(gameSelect).toBeVisible({ timeout: 30_000 });

    const selectedView = page.locator('.app-toolbar-field--game .arco-select-view-value');
    const currentValue = (await selectedView.textContent())?.trim() ?? '';
    // Select value is gameId; Arco may display label `${gameId} / ${gameName}`.
    if (currentValue !== gameId && !currentValue.startsWith(`${gameId} /`)) {
      await gameSelect.click();
      await page
        .locator('.arco-select-option')
        .filter({ hasText: new RegExp(`^${escapeRegExp(gameId)}(?:\\s|/|$)`) })
        .first()
        .click();
    }

    await expect(selectedView).toContainText(gameId);
    await expect(page.getByText(`GameId ${gameId}`, { exact: true })).toBeVisible();
    await expect(page.getByText('通用引擎验证')).toBeVisible({ timeout: 30_000 });

    const compileButton = page.getByRole('button', { name: '编译', exact: true });
    await expect(
      compileButton,
      'combat-data must materialize to a ready UI (exact 编译 button present); shell-only or load/empty states must not pass'
    ).toBeVisible({ timeout: 60_000 });
    await expect(compileButton).toBeEnabled({ timeout: 60_000 });

    await expect(page.getByText('combat-data 读取失败')).toHaveCount(0);
    await expect(page.getByText('装配错误')).toHaveCount(0);
    assertNo5xx();

    await selectEntityByFormLabel(page, '攻击方实体（source）', sourceEntityId);
    await selectEntityByFormLabel(page, '目标实体（target）', targetEntityId);

    await expect(
      compileButton,
      'after explicit source/target selection, combat-data must rematerialize to a ready compile UI'
    ).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByText('combat-data 读取失败')).toHaveCount(0);
    await expect(page.getByText('装配错误')).toHaveCount(0);
    assertNo5xx();

    await compileButton.click();
    await expect(page.getByText(/编译成功/)).toBeVisible({ timeout: 60_000 });
    assertNo5xx();

    await expect(
      page.getByText('无带 basic type 的主动技能'),
      `configured source E2E_SOURCE_ENTITY_ID="${sourceEntityId}" is not runnable: ` +
        `page still shows "无带 basic type 的主动技能" (no active ability with ability/basic_attack). ` +
        `Pick a source entity that has a basic-attack active skill for gameId=${gameId}.`
    ).toHaveCount(0);

    const runButton = page.getByRole('button', { name: '运行', exact: true });
    await expect(runButton).toBeEnabled({ timeout: 30_000 });
    await runButton.click();
    await expect(page.getByText(/运行成功/)).toBeVisible({ timeout: 60_000 });
    assertNo5xx();

    const releaseButton = page.getByRole('button', { name: '释放', exact: true });
    await expect(releaseButton).toBeEnabled({ timeout: 30_000 });
    await releaseButton.click();
    await expect(page.getByText(/释放成功/)).toBeVisible({ timeout: 60_000 });
    await expect(
      releaseButton,
      'after 释放成功 the session must no longer be actionable (释放 disabled)'
    ).toBeDisabled({ timeout: 30_000 });
    assertNo5xx();
  });
});
