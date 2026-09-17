import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCharacterAuthoringCheck, parseCharacterAuthoringCheck } from './characterAuthoringCheckClient';
import type { CharacterAuthoringCheck } from '../types/characterAuthoringCheck';

const report: CharacterAuthoringCheck = {
  gameId: 'lol', characterKey: 'ez', characterName: '伊泽瑞尔', checkedAt: '2026-09-06T12:00:00Z',
  conclusions: { structure: 'NO_ERRORS', mechanics: 'NOT_CHECKED', runtime: 'NOT_RUN' },
  summary: { attachedSkillCount: 0, configuredAttributeCount: 0, errorCount: 0, reviewCount: 1 },
  skills: [], references: [], issues: [{ code: 'NO_ATTACHED_SKILL', severity: 'REVIEW', message: '没有挂载技能', skillKey: null, objectType: 'CHARACTER', objectKey: 'ez', fieldPath: 'skills' }]
};

describe('character authoring check', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses a read-only character route with management authentication', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBeUndefined();
      expect(init?.method ?? 'GET').toBe('GET');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer example-token');
      return new Response(JSON.stringify({ ...report, characterKey: 'a/b' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await getCharacterAuthoringCheck('http://localhost:8080', 'lol', 'a/b', 'example-token');
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:8080/api/admin/games/lol/characters/a%2Fb/authoring-check');
    expect(response.data.summary.attachedSkillCount).toBe(0);
  });
  it('accepts zero counts and review-only findings without claiming mechanisms or runtime passed', () => {
    expect(parseCharacterAuthoringCheck(report, 'lol', 'ez')).toEqual(report);
  });
  it('keeps missing skill findings visible rather than requiring all linked skills to exist', () => {
    const missing: CharacterAuthoringCheck = { ...report,
      conclusions: { ...report.conclusions, structure: 'HAS_ERRORS' },
      summary: { ...report.summary, attachedSkillCount: 1, errorCount: 1, reviewCount: 0 },
      skills: [{ skillKey: 'missing', name: null, status: null, maxLevel: null, sortOrder: 10, effectCount: 0, processCount: 0, triggerRuleCount: 0 }],
      issues: [{ code: 'ATTACHED_SKILL_MISSING', severity: 'ERROR', message: '技能缺失', skillKey: 'missing', objectType: 'SKILL', objectKey: 'missing', fieldPath: 'skills' }]
    };
    expect(parseCharacterAuthoringCheck(missing, 'lol', 'ez')).toEqual(missing);
  });
  it('rejects missing data, wrong context and contradictory summaries instead of showing success', () => {
    for (const value of [null, {}, { ...report, gameId: 'other' }, { ...report, characterKey: 'other' },
      { ...report, checkedAt: 'bad-date' }, { ...report, skills: null }, { ...report, references: [null] },
      { ...report, conclusions: { ...report.conclusions, runtime: 'PASSED' } },
      { ...report, summary: { ...report.summary, errorCount: 1 } },
      { ...report, summary: { ...report.summary, attachedSkillCount: 5 } },
      { ...report, conclusions: { ...report.conclusions, structure: 'HAS_ERRORS' } }
    ]) expect(() => parseCharacterAuthoringCheck(value, 'lol', 'ez')).toThrow('角色录入检查响应不完整');
  });
  it('displays diagnosed invalid basic values instead of rejecting the report itself', () => {
    const invalidBasics: CharacterAuthoringCheck = { ...report,
      conclusions: { ...report.conclusions, structure: 'HAS_ERRORS' },
      summary: { ...report.summary, attachedSkillCount: 1, errorCount: 1, reviewCount: 0 },
      skills: [{ skillKey: 'ez_q', name: '', status: 'UNKNOWN', maxLevel: 0, sortOrder: -1, effectCount: 0, processCount: 0, triggerRuleCount: 0 }],
      issues: [{ code: 'BASIC_FIELD_INVALID', severity: 'ERROR', message: '基础字段无效', skillKey: 'ez_q', objectType: 'SKILL', objectKey: 'ez_q', fieldPath: 'name' }]
    };
    expect(parseCharacterAuthoringCheck(invalidBasics, 'lol', 'ez')).toEqual(invalidBasics);
  });
  it('propagates server failures without creating an empty passing report', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: '500.ERROR', message: '检查读取失败' } }), { status: 500 })));
    await expect(getCharacterAuthoringCheck('http://localhost:8080', 'lol', 'ez', 'example-token')).rejects.toThrow('检查读取失败');
  });
});
