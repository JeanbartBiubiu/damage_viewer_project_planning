import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSkillConfiguration, getSkillConfiguration, skillConfigurationPath, updateSkillConfiguration } from './skillConfigurationClient';

const body = {
  skill: { gameId: 'demo', skillKey: 'sample_q', name: '样例 Q', description: null, maxLevel: 1,
    status: 'ENABLED', sortOrder: 0, skillCategoryKeys: [], createdAt: '', updatedAt: '' },
  parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [], baseDigest: 'digest'
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('统一技能配置接口', () => {
  it('使用技能路径读取完整配置，缺少必需组成时拒绝成功响应', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...body, effects: undefined }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(skillConfigurationPath('demo', 'sample_q')).toBe('/api/admin/games/demo/skills/sample_q/configuration');
    await expect(getSkillConfiguration('http://localhost:8080', 'demo', 'sample_q', 'token'))
      .resolves.toMatchObject({ data: body });
    await expect(getSkillConfiguration('http://localhost:8080', 'demo', 'sample_q', 'token'))
      .rejects.toMatchObject({ code: 'INVALID_CONFIGURATION_RESPONSE' });
  });

  it('新建与更新只发送统一路径规定的字段和参数操作', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const skill = { name: '样例 Q', description: null, maxLevel: 1, status: 'ENABLED' as const,
      sortOrder: 0, skillCategoryKeys: [] };
    await createSkillConfiguration('http://localhost:8080', 'demo', 'sample_q', 'token', { skill, changes: [] });
    await updateSkillConfiguration('http://localhost:8080', 'demo', 'sample_q', 'token', {
      baseDigest: 'digest', changes: [{ objectType: 'PARAMETER', operation: 'DELETE', key: 'unused' }]
    });
    expect(fetchMock.mock.calls.map(([url, options]) => [url, options.method, JSON.parse(options.body)])).toEqual([
      ['http://localhost:8080/api/admin/games/demo/skills/sample_q/configuration', 'POST', { skill, changes: [] }],
      ['http://localhost:8080/api/admin/games/demo/skills/sample_q/configuration', 'PATCH', {
        baseDigest: 'digest', changes: [{ objectType: 'PARAMETER', operation: 'DELETE', key: 'unused' }]
      }]
    ]);
  });

  it('重复或空稳定键的完整读取不可作为可编辑基线', async () => {
    const duplicate = { ...body, parameters: [
      { gameId: 'demo', skillKey: 'sample_q', parameterKey: 'same' },
      { gameId: 'demo', skillKey: 'sample_q', parameterKey: 'same' }
    ] };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(duplicate), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getSkillConfiguration('http://localhost:8080', 'demo', 'sample_q', 'token'))
      .rejects.toMatchObject({ code: 'INVALID_CONFIGURATION_RESPONSE' });
  });
});
