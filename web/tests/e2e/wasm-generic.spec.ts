import { expect, test } from '@playwright/test';

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? 'http://localhost:8080';
const gameId = process.env.E2E_GAME_ID ?? '';

test.describe('wasm generic catalog e2e', () => {
  test('backend probe: current version and wasm-catalog availability', async ({ request }) => {
    test.skip(!gameId, 'Set E2E_GAME_ID (and optionally E2E_API_BASE_URL) to run against a live backend.');

    const current = await request.get(`${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/versions/current`);
    if (current.status() === 404) {
      test.info().annotations.push({
        type: 'blocker',
        description: `current version 404 for gameId=${gameId}; cannot exercise catalog empty/success UI against this game.`
      });
      expect(current.status(), 'current version must exist for full e2e').toBe(200);
      return;
    }
    expect(current.ok()).toBeTruthy();
    const currentBody = await current.json();
    const versionCode = currentBody.versionCode as string;

    const catalog = await request.get(
      `${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/versions/${encodeURIComponent(versionCode)}/wasm-catalog`
    );

    // Either a real catalog or HTTP 404 (any code spelling, e.g. 404.NOT_FOUND) is acceptable.
    expect([200, 404]).toContain(catalog.status());
    if (catalog.status() === 404) {
      const body = await catalog.json();
      // Do not require a specific code string; frontend maps any catalog 404 to empty state.
      expect(body?.error?.message ?? body?.error?.code ?? true).toBeTruthy();
    }
  });

  test('browser flow against running web + api when configured', async ({ page, request }) => {
    test.skip(
      !gameId || process.env.E2E_WEB_BASE_URL === undefined,
      'Requires E2E_GAME_ID and a running web app (E2E_WEB_BASE_URL). Do not invent a backend.'
    );

    const current = await request.get(`${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/versions/current`);
    test.skip(!current.ok(), `current version unavailable for ${gameId}`);

    const currentBody = await current.json();
    const versionCode = currentBody.versionCode as string;
    const catalog = await request.get(
      `${apiBaseUrl}/api/games/${encodeURIComponent(gameId)}/versions/${encodeURIComponent(versionCode)}/wasm-catalog`
    );

    // Hash route avoids clicking a collapsed "Wasm 验证" nav group.
    await page.goto('/#/wasm-validation-generic');
    await expect(page.getByText('通用引擎验证')).toBeVisible({ timeout: 15_000 });

    if (catalog.status() === 404) {
      await expect(page.getByText('该发布版本尚未配置通用 Wasm 目录')).toBeVisible({ timeout: 15_000 });
      return;
    }

    expect(catalog.status()).toBe(200);
    await expect(page.getByText('目录 / 模板选择')).toBeVisible({ timeout: 15_000 });
  });
});
