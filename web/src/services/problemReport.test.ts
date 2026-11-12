import { describe, expect, it } from 'vitest';
import { buildProblemReport, issueRepository, problemIssueUrl, sanitizeProblemMaterial } from './problemReport';
import { viewerRouteFromHash } from '../config/deployment';

describe('公共问题复现材料', () => {
  it('保留场景和结果，移除所有嵌套凭据及错误中的授权内容', () => {
    const material = { snapshotDigest: 'snapshot', input: { level: 9, authorization: 'secret', hp: 0 },
      result: { damage: 123 }, headers: { Cookie: 'opaque' }, nested: [{ grant: 'secret', accessToken: 'secret', apiKey: 'secret', valid: true }],
      error: 'Authorization: Bearer fixture-secret password=fixture-password' };
    const result = JSON.stringify(sanitizeProblemMaterial(material));
    expect(result).not.toContain('fixture-secret'); expect(result).not.toContain('fixture-password'); expect(result).not.toContain('opaque');
    expect(result).not.toContain('accessToken'); expect(result).toContain('"hp":0'); expect(result).toContain('"damage":123');
    expect(material.input.authorization).toBe('secret');
  });
  it.each(['http://github.com/org/repo', 'https://github.com.evil/org/repo', 'https://token@github.com/org/repo', 'https://github.com/org/repo?token=x', 'https://github.com/org/repo/issues', 'javascript:alert(1)'])('拒绝非规范反馈仓库 %s', value => {
    expect(issueRepository(value)).toBeNull();
  });
  it('问题链接只带说明和身份摘要，不将完整场景和大附件放进查询串', () => {
    const report = buildProblemReport({ gameId: 'lol', mode: 'automatic', material: { sentinel: 'scene-only-in-file' }, description: '技能伤害不符' });
    const url = new URL(problemIssueUrl('https://github.com/org/repo/', report));
    expect(url.pathname).toBe('/org/repo/issues/new'); expect(url.searchParams.get('body')).toContain('技能伤害不符');
    expect(url.toString()).not.toContain('scene-only-in-file'); expect(report.material).toEqual({ sentinel: 'scene-only-in-file' });
  });
  it('手改编辑地址或未知地址均回到公共计算入口', () => {
    expect(viewerRouteFromHash('#/skills')).toBe('simulation/combat-analysis'); expect(viewerRouteFromHash('#/attributes?edit=1')).toBe('simulation/combat-analysis');
    expect(viewerRouteFromHash('#/simulation/basic-attack')).toBe('simulation/basic-attack');
  });
});
