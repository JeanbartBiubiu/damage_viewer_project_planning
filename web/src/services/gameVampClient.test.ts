import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGameVampRules, parseGameVampRules, updateGameVampRules } from './gameVampClient';
import type { GameVampRule } from '../types/gameVamp';

const rule: GameVampRule = {
  vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1,
  deliveryKinds: ['SKILL', 'BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['common', 'basic_attack']
};

afterEach(() => vi.unstubAllGlobals());

describe('游戏吸血规则接口', () => {
  it('完整解析并固定种类顺序，空集合和显式零合法', () => {
    expect(parseGameVampRules({ rules: [] })).toEqual({ rules: [] });
    expect(parseGameVampRules({ rules: [rule, { ...rule, vampType: 'LIFE_STEAL', defaultEfficiency: 0 }] }).rules.map((item) => item.vampType))
      .toEqual(['LIFE_STEAL', 'OMNIVAMP']);
  });
  it.each([
    { rules: [rule, rule] },
    { rules: [{ ...rule, defaultEfficiency: -1 }] },
    { rules: [{ ...rule, defaultEfficiency: Infinity }] },
    { rules: [{ ...rule, deliveryKinds: [] }] },
    { rules: [{ ...rule, originKinds: ['DIRECT', 'DIRECT'] }] },
    { rules: [{ ...rule, skillCategoryKeys: ['unknown/key'] }] },
    { rules: [{ ...rule, sourceAttributeKey: '' }] },
    { rules: [{ ...rule, oldField: 'discarding this is unsafe' }] },
    { rules: [{ ...rule, vampType: 'UNKNOWN' }] }
  ])('生产解析拒绝非法或混合规则 %j', (value) => {
    expect(() => parseGameVampRules(value)).toThrow('游戏吸血规则响应格式不正确');
  });
  it('沿用统一请求并保存完整集合', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rules: [rule] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await getGameVampRules('http://localhost:8080', 'demo', 'test-token');
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:8080/api/admin/games/demo/vamp-rules');
    fetch.mockResolvedValue(new Response(JSON.stringify({ rules: [rule] }), { status: 200 }));
    const saved = await updateGameVampRules('http://localhost:8080', 'demo', 'test-token', { rules: [rule] });
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ rules: [rule] }) });
    expect(saved.data.rules).toEqual([rule]);
  });
});
