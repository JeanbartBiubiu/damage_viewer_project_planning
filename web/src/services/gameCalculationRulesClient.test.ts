import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGameCalculationRules, parseGameCalculationConfiguration, parseGameCalculationRules, updateGameCalculationRules, UnconfirmedCalculationRulesWriteError } from './gameCalculationRulesClient';
import { authoredCalculationRules, authorEquipmentSpeedRule } from '../../tests/fixtures/simulationCalculationRules';
import { equipmentSimulationSample } from '../../tests/fixtures/simulationEquipment';
import { sameFormulaPayload } from './skillFormulaContract';

afterEach(() => vi.unstubAllGlobals());
describe('游戏计算配置严格契约与完整保存', () => {
  it('显式空配置、空下限与零下限不同，不补用途或公式', () => {
    expect(parseGameCalculationRules({ ...authoredCalculationRules('demo'), configuration: null }).configuration).toBeNull();
    const value = authoredCalculationRules('demo').configuration!;
    value.criticalChanceAttributeKey = null; value.attackSpeedAttributeKey = null; value.criticalMultiplierMin = 0;
    expect(parseGameCalculationConfiguration(value)).toEqual(value);
    expect(parseGameCalculationConfiguration({ ...value, criticalMultiplierMin: null }).criticalMultiplierMin).toBeNull();
    expect(() => parseGameCalculationRules({ gameId: 'demo', configuration: value })).toThrow('baseDigest');
  });
  it('完整目录与共同内部引用保留原文，全部声明输入参与授权和同批输出回读检查', () => {
    const snapshot = authorEquipmentSpeedRule(equipmentSimulationSample());
    const response = snapshot.catalogs.calculationRules;
    expect(parseGameCalculationRules(response, snapshot.gameId, snapshot.catalogs.attributes)).toEqual(response);
    const formula = response.configuration!.attributeDerivations[0]!.formula;
    formula.inputs[0]!.binding = { kind: 'attribute', object: 'source', attributeKey: 'attack_speed', valueKind: 'TOTAL', view: 'current_frame' };
    expect(() => parseGameCalculationRules(response, snapshot.gameId, snapshot.catalogs.attributes)).toThrow('derived_output_read');
    formula.inputs[0]!.binding = { kind: 'attribute', object: 'target', attributeKey: 'attack_speed', valueKind: 'BASE', view: 'current_frame' };
    expect(() => parseGameCalculationRules(response, snapshot.gameId, snapshot.catalogs.attributes)).toThrow();
  });
  it.each([-1, NaN, Infinity])('非法倍率下限%s不转空值', criticalMultiplierMin => {
    expect(() => parseGameCalculationConfiguration({ ...authoredCalculationRules('demo').configuration!, criticalMultiplierMin })).toThrow('criticalMultiplierMin');
  });
  it.each(['unknown_field', 'duplicate_rule', 'duplicate_output', 'missing_activation', 'disabled_attribute', 'hp_output', 'hp_activation'])('拒绝损坏作者候选%s', variant => {
    const snapshot = equipmentSimulationSample();
    const configuration = snapshot.catalogs.calculationRules.configuration!;
    if (variant === 'unknown_field') Object.assign(configuration, { silentDefault: true });
    if (variant === 'duplicate_rule' || variant === 'duplicate_output') configuration.attributeDerivations.push({ ...configuration.attributeDerivations[0]!, ...(variant === 'duplicate_output' ? { ruleKey: 'second_rule' } : {}) });
    if (variant === 'missing_activation') configuration.attributeDerivations[0]!.activationAttributeKeys = [];
    if (variant === 'disabled_attribute') snapshot.catalogs.attributes.find(row => row.attributeKey === 'attack_speed_ratio')!.status = 'DISABLED';
    if (variant === 'hp_output') configuration.attributeDerivations[0]!.attributeKey = 'hp';
    if (variant === 'hp_activation') configuration.attributeDerivations[0]!.activationAttributeKeys = ['hp'];
    expect(() => parseGameCalculationConfiguration(configuration, snapshot.catalogs.attributes)).toThrow();
  });
  it('统一PUT携带原摘要，成功独立GET后才确认；错误或冲突不吃掉候选', async () => {
    const original = authoredCalculationRules('demo'), written = { ...original, baseDigest: 'd'.repeat(64) };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(original), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(written), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(written), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await getGameCalculationRules('http://localhost:8080', 'demo', 'fixture-token');
    const before = structuredClone(original.configuration!);
    const result = await updateGameCalculationRules('http://localhost:8080', 'demo', 'fixture-token', { baseDigest: original.baseDigest, configuration: original.configuration! });
    expect(result.data.baseDigest).toBe(written.baseDigest);
    expect(fetch.mock.calls[1]![1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ baseDigest: original.baseDigest, configuration: before }) });
    expect(fetch.mock.calls[2]![1]).not.toHaveProperty('method', 'PUT');
    expect(sameFormulaPayload(original.configuration, before)).toBe(true);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: '409.CONFLICT', message: '版本冲突' } }), { status: 409 }));
    await expect(updateGameCalculationRules('http://localhost:8080', 'demo', 'fixture-token', { baseDigest: original.baseDigest, configuration: before })).rejects.toThrow('版本冲突');
  });
  it('写后读回失败或候选不同，冻结待确认并保留原草稿', async () => {
    const value = authoredCalculationRules('demo');
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(value), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...value, configuration: { ...value.configuration, criticalMultiplierMin: 0 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(updateGameCalculationRules('http://localhost:8080', 'demo', 'fixture-token', { baseDigest: value.baseDigest, configuration: value.configuration! })).rejects.toBeInstanceOf(UnconfirmedCalculationRulesWriteError);
  });
});
