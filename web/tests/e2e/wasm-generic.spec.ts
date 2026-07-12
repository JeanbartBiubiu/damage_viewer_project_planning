import { expect, test } from '@playwright/test';

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? 'http://localhost:8080';
const gameId = process.env.E2E_GAME_ID ?? '';

test.describe('wasm combat-data e2e', () => {
  test('backend probe: current version and combat-data state', async ({ request }) => {
    test.skip(!gameId, 'Set E2E_GAME_ID (and optionally E2E_API_BASE_URL) to run against a live backend.');

    const current = await request.get(`${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/versions/current`);
    if (current.status() === 404) {
      test.info().annotations.push({
        type: 'blocker',
        description: `current version 404 for gameId=${gameId}; publish at least once before full e2e.`
      });
      expect(current.status(), 'current version must exist for full e2e').toBe(200);
      return;
    }
    expect(current.ok()).toBeTruthy();

    const state = await request.get(
      `${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/combat-data/state`
    );
    expect(state.ok()).toBeTruthy();
    const body = await state.json();
    expect(body.gameId).toBe(gameId);
    expect(typeof body.currentRevision).toBe('number');
    expect(body.data?.currentRevision).toBeDefined();
  });

  test('browser flow against running web + api when configured', async ({ page, request }) => {
    test.skip(
      !gameId || process.env.E2E_WEB_BASE_URL === undefined,
      'Requires E2E_GAME_ID and a running web app (E2E_WEB_BASE_URL). Do not invent a backend.'
    );

    const state = await request.get(
      `${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/combat-data/state`
    );
    test.skip(!state.ok(), `combat-data state unavailable for ${gameId}`);

    await page.goto('/#/wasm-validation-generic');
    await expect(page.getByText('通用引擎验证')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/combat-data|实体|revision/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
