import { expect, test } from '@playwright/test';

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
  });

  test('browser flow: generic validation page loads combat-data context', async ({ page, request }) => {
    const state = await request.get(
      `${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/combat-data/state`
    );
    expect(
      state.status(),
      `combat-data state must be available before browser assertion (gameId=${gameId})`
    ).toBe(200);
    const stateBody = await state.json();
    expect(stateBody.gameId).toBe(gameId);

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
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
