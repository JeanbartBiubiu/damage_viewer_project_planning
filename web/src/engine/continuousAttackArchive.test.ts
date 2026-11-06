import { describe, expect, it } from 'vitest';
import { buildContinuousAttackArchive, buildContinuousCsv } from './continuousAttackArchive';
import { initialContinuousView } from './continuousAttackPresentation';

describe('连续展示档案和安全表格导出', () => {
  it('初始当前资源完整冻结，不补满额或混入属性容量', () => {
    const input = { initialResourceInputs: [{ side: 'source', resourceKey: 'mana', current: 0 }] };
    const archive = buildContinuousAttackArchive(input, initialContinuousView(1000));
    input.initialResourceInputs[0]!.current = 50;
    expect(archive.initialResourceInputs).toEqual([{ side: 'source', resourceKey: 'mana', current: 0 }]);
  });
  it('冻结独立资源累计、明细和生命顺序，不因时间筛选裁掉或改为治疗', () => {
    const input = { runResult: { resourceChangeSummary: { changeCount: 1, source: { currentIncrease: 300, maxIncrease: 300, finalMax: 950 } },
      resourceChangeRecords: [{ healthOrder: 1, timeMs: 0, currentDelta: 300, maxDelta: 300, contributors: [{ definitionRef: 'finite', modifierKey: 'health', reason: 'apply' }] }],
      damageRecords: [{ healthOrder: 2, damageId: 1 }], healingRecords: [], recording: { resourceChangeRecordCount: 1 } } };
    const view = initialContinuousView(1000); view.timeRangeMs = [500, 1000];
    const archive = buildContinuousAttackArchive(input, view);
    expect(archive.runResult).toEqual(input.runResult);
    input.runResult.resourceChangeRecords[0]!.maxDelta = 999;
    expect(archive.runResult).toMatchObject({ resourceChangeRecords: [{ maxDelta: 300 }], healingRecords: [] });
  });
  it('冻结新来源生命字段和双方实际吸血汇总，不按视图筛选重算或裁剪', () => {
    const input = { runResult: { summary: { sourceVampHealing: 35, targetVampHealing: 12 },
      damageRecords: [{ damageId: 1, sourceHpBefore: 600, sourceHpAfter: 612 }, { damageId: 2, sourceHpBefore: null, sourceHpAfter: null }] } };
    const view = initialContinuousView(2500); view.timeRangeMs = [2000, 2500]; view.sourceKeys = ['hidden_source'];
    const archive = buildContinuousAttackArchive(input, view);
    input.runResult.summary.sourceVampHealing = 99;
    input.runResult.damageRecords[0]!.sourceHpAfter = 649;
    expect(archive).toMatchObject({ runResult: { summary: { sourceVampHealing: 35, targetVampHealing: 12 },
      damageRecords: [{ damageId: 1, sourceHpBefore: 600, sourceHpAfter: 612 }, { damageId: 2, sourceHpBefore: null, sourceHpAfter: null }] } });
  });
  it('伤害CSV保留来源生命前后及本笔实际吸血，明确null不补零', () => {
    const text = buildContinuousCsv('damage', [
      { damageId: 1, sourceHpBefore: 600, sourceHpAfter: 612.5 },
      { damageId: 2, sourceHpBefore: null, sourceHpAfter: null },
      { damageId: 3, sourceHpBefore: 0, sourceHpAfter: 0 }
    ], { runInputHash: 'digest', view: initialContinuousView(2500), executionComplete: true,
      attackRecordsTruncated: false, damageRecordsTruncated: false, seriesDownsampled: false });
    expect(text).toContain('"伤害来源生命之前","伤害来源生命之后","本笔实际吸血入账"');
    expect(text).toContain('"600","612.5","12.5"');
    expect(text.split('\r\n')[2]!.endsWith(',,,')).toBe(true);
    expect(text.split('\r\n')[3]!.endsWith('"0","0","0"')).toBe(true);
  });
  it('伤害CSV不把缺失、非有限或倒减生命伪装成有效吸血', () => {
    const text = buildContinuousCsv('damage', [
      { damageId: 1, sourceHpBefore: 600 },
      { damageId: 2, sourceHpBefore: 600, sourceHpAfter: Number.POSITIVE_INFINITY },
      { damageId: 3, sourceHpBefore: 600, sourceHpAfter: 599 }
    ], { runInputHash: null, view: initialContinuousView(2500), executionComplete: false,
      attackRecordsTruncated: false, damageRecordsTruncated: true, seriesDownsampled: false });
    const rows = text.split('\r\n');
    expect(rows).toHaveLength(4);
    expect(rows.slice(1).map(row => row.endsWith(','))).toEqual([true, true, true]);
  });
  it('冻结装备选择、属性来源及编译派生，不跟随后续输入变化或视图筛选', () => {
    const input = { snapshot: { selection: { sourceEquipmentKeys: ['item_1042'], targetEquipmentKeys: [] } },
      equipmentOrigins: [{ side: 'source', equipmentKey: 'item_1042', providerRef: 'source_equipment_item_1042', attributeValues: { bonus_attack_speed_percent: 0.1 } }],
      equipmentAssumptions: [{ owner: 'target', equipmentKey: 'item_3110', target: 'source', inRange: true }],
      compileRequest: { rules: { attributeDerivations: [{ combatantKey: 'source', attributeKey: 'attack_speed', valuePolicy: 'set', valueType: 'DECIMAL', value: { op: 'read', path: 'source.attr.attack_speed.base' } }] } } };
    const archive = buildContinuousAttackArchive(input, initialContinuousView(1000));
    input.snapshot.selection.sourceEquipmentKeys = [];
    input.equipmentOrigins[0]!.attributeValues.bonus_attack_speed_percent = 0.9;
    input.equipmentAssumptions[0]!.inRange = false;
    expect(archive).toMatchObject({ snapshot: { selection: { sourceEquipmentKeys: ['item_1042'] } },
      equipmentOrigins: [{ side: 'source', equipmentKey: 'item_1042', attributeValues: { bonus_attack_speed_percent: 0.1 } }],
      equipmentAssumptions: [{ owner: 'target', equipmentKey: 'item_3110', target: 'source', inRange: true }],
      compileRequest: { rules: { attributeDerivations: [{ combatantKey: 'source', attributeKey: 'attack_speed' }] } } });
  });
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
