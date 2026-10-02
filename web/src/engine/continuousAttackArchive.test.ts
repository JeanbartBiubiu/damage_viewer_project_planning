import { describe, expect, it } from 'vitest';
import { buildContinuousAttackArchive, buildContinuousCsv } from './continuousAttackArchive';
import { initialContinuousView } from './continuousAttackPresentation';

describe('连续展示档案和安全表格导出', () => {
  it('白名单排除连接、鉴权和嵌套秘密，完整结果不被视图筛选裁剪', () => {
    const input = { taskKind: 'continuous_attack', runInputHash: 'business-digest', outcome: 'passed', cleanup: 'released',
      adminToken: 'fake-top-secret', apiBaseUrl: 'http://private-service', controller: {}, snapshot: { gameId: 'demo', nested: {
        authorization: 'fake-nested-secret', password: 'fake-password', customApiKey: 'fake-key', label: '原作者文字' } },
      runResult: { damageRecords: [{ damageId: 1 }, { damageId: 2 }], summary: { sourceDamageDealt: 300 } },
      error: 'Bearer fake-error-secret token=fake-query-secret http://local/service?token=fake-url-secret' };
    const before = structuredClone(input); const view = initialContinuousView(2000); view.timeRangeMs = [1000, 2000]; view.attackIndex = 2;
    const result = buildContinuousAttackArchive(input, view);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/fake-top-secret|fake-nested-secret|fake-password|fake-key|fake-error-secret|fake-query-secret|fake-url-secret/);
    expect(result).toMatchObject({ displayDefinitionVersion: 1, view: { timeRangeMs: [1000, 2000], attackIndex: 2 },
      runResult: { damageRecords: [{ damageId: 1 }, { damageId: 2 }], summary: { sourceDamageDealt: 300 } } });
    expect(input).toEqual(before);
  });
  it('保持原金额精度和真实0，缺失时刻为空，正确转义公式及逗号引号换行', () => {
    const view = initialContinuousView(2000);
    const text = buildContinuousCsv('attack', [{ planKey: '=SUM(1,2)', attackIndex: 1, useRef: 'a,"b"\nc', startAtMs: 0,
      hitAtMs: 0, readyAtMs: null, nextStartAtMs: null, postDefenseDamage: 49.586776859504134 }], {
      runInputHash: 'digest', view, executionComplete: true, attackRecordsTruncated: true, damageRecordsTruncated: true, seriesDownsampled: false });
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain("'=" + 'SUM(1,2)');
    expect(text).toContain('a,""b""\nc');
    expect(text).toContain('49.586776859504134');
    expect(text).toContain('已返回攻击记录的当前筛选');
    expect(text).toContain('时间区间、刀号；不按来源或类型拆分');
    expect(text).toContain('"0","0",,');
  });
  it('导出当前筛选全部行而非某一页，防止文本公式，不改负数原值', () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({ damageId: index + 1, operationRef: index === 0 ? '  @BAD' : 'result', rawAmount: -2 }));
    const text = buildContinuousCsv('damage', rows, { runInputHash: null, view: initialContinuousView(2000), executionComplete: false,
      attackRecordsTruncated: false, damageRecordsTruncated: true, seriesDownsampled: true });
    expect(text.split('\r\n')).toHaveLength(14);
    expect(text).toContain("'  @BAD");
    expect(text).toContain('"-2"');
    expect(text).not.toContain("'-2");
  });
});
