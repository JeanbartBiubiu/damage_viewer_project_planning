import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFocusedSkill } from './focusedSkill';
import type { Skill } from '../../../types/skill';

const SKILL: Skill = {
  gameId: 'game', skillKey: 'ezreal/q', name: '秘术射击', description: null,
  maxLevel: 5, status: 'ENABLED', sortOrder: 1, skillCategoryKeys: [],
  createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('character skill authoring focus', () => {
  it('reads the exact selected skill instead of searching for its key prefix', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(SKILL));
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadFocusedSkill('http://localhost:8080', 'game', 'ezreal/q', 'test-token')).toEqual(SKILL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:8080/api/admin/games/game/skills/ezreal%2Fq');
  });

  it.each([
    { ...SKILL, skillKey: 'ezreal/q_extra' },
    { ...SKILL, gameId: 'another-game' }
  ])('refuses another skill or another game in a successful detail response', async (body) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)));
    await expect(loadFocusedSkill('http://localhost:8080', 'game', SKILL.skillKey, 'test-token'))
      .rejects.toMatchObject({ status: 502, code: '502.SKILL_RESPONSE_INVALID' });
  });

  it('still opens an existing disabled skill so its saved configuration can be maintained', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...SKILL, status: 'DISABLED' })));
    expect((await loadFocusedSkill('http://localhost:8080', 'game', SKILL.skillKey, 'test-token')).status).toBe('DISABLED');
  });

  it('keeps a missing skill error and never falls back to another prefix match', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { code: '404.SKILL_NOT_FOUND', message: '技能不存在' } }, 404));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadFocusedSkill('http://localhost:8080', 'game', SKILL.skillKey, 'test-token'))
      .rejects.toMatchObject({ status: 404, code: '404.SKILL_NOT_FOUND' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
