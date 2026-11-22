import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMaintenanceBatchFixture } from '../../tests/fixtures/maintenanceBatchFixture';

useMaintenanceBatchFixture();
import { getGameCalculationRules, parseGameCalculationConfiguration, parseGameCalculationRules } from './gameCalculationRulesClient';
import { UnconfirmedCalculationRulesWriteError, updateGameCalculationRules } from './maintenance/gameCalculationRulesWrites';
import { authoredCalculationRules, authorEquipmentSpeedRule } from '../../tests/fixtures/simulationCalculationRules';
import { equipmentSimulationSample } from '../../tests/fixtures/simulationEquipment';
import { sameFormulaPayload } from './skillFormulaContract';
import { classificationCostBindingsSample } from '../../tests/fixtures/classificationCostBindings';

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
    await getGameCalculationRules('http://localhost:8080', 'demo');
    const before = structuredClone(original.configuration!);
    const result = await updateGameCalculationRules('http://localhost:8080', 'demo', { baseDigest: original.baseDigest, configuration: original.configuration! });
    expect(result.data.baseDigest).toBe(written.baseDigest);
    expect(fetch.mock.calls[1]![1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ baseDigest: original.baseDigest, configuration: before }) });
    expect(fetch.mock.calls[2]![1]).not.toHaveProperty('method', 'PUT');
    expect(sameFormulaPayload(original.configuration, before)).toBe(true);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: '409.CONFLICT', message: '版本冲突' } }), { status: 409 }));
    await expect(updateGameCalculationRules('http://localhost:8080', 'demo', { baseDigest: original.baseDigest, configuration: before })).rejects.toThrow('版本冲突');
  });
  it('写后读回失败或候选不同，冻结待确认并保留原草稿', async () => {
    const value = authoredCalculationRules('demo');
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(value), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...value, configuration: { ...value.configuration, criticalMultiplierMin: 0 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(updateGameCalculationRules('http://localhost:8080', 'demo', { baseDigest: value.baseDigest, configuration: value.configuration! })).rejects.toBeInstanceOf(UnconfirmedCalculationRulesWriteError);
  });

  it('七字段全部必填，不接旧四字段，不补分类、费用或自动排序', () => {
    const snapshot = classificationCostBindingsSample();
    const original = snapshot.catalogs.calculationRules.configuration!;
    original.ignorableCastCostAttributeKeys = ['spell_fee', 'hp'];
    const before = structuredClone(original);
    const parsed = parseGameCalculationRules(snapshot.catalogs.calculationRules, snapshot.gameId, snapshot.catalogs.attributes, snapshot.catalogs.skillCategories);
    expect(parsed.configuration).toEqual(before);
    expect(parsed.configuration).not.toBe(original);
    for (const field of Object.keys(original)) {
      const incomplete = structuredClone(original) as Record<string, unknown>;
      delete incomplete[field];
      expect(() => parseGameCalculationConfiguration(incomplete)).toThrow(`configuration.${field}：missing_required_field`);
    }
    expect(original).toEqual(before);
  });

  it.each(['same_category', 'invalid_key', 'disabled_category', 'unknown_category', 'foreign_category', 'duplicate_category',
    'null_cost_list', 'null_cost_key', 'duplicate_cost', 'too_many_costs', 'unknown_cost', 'disabled_cost', 'foreign_cost', 'not_numeric_cost'])('完整作者绑定候选%s拒绝', variant => {
    const snapshot = classificationCostBindingsSample();
    const configuration = snapshot.catalogs.calculationRules.configuration!;
    if (variant === 'same_category') configuration.equipmentPassiveCategoryKey = configuration.basicAttackCategoryKey;
    if (variant === 'invalid_key') configuration.basicAttackCategoryKey = 'bad/key';
    if (variant === 'unknown_category') configuration.basicAttackCategoryKey = 'not_in_catalog';
    if (variant === 'disabled_category') snapshot.catalogs.skillCategories[0]!.status = 'DISABLED';
    if (variant === 'foreign_category') snapshot.catalogs.skillCategories[0]!.gameId = 'other';
    if (variant === 'duplicate_category') snapshot.catalogs.skillCategories.push(structuredClone(snapshot.catalogs.skillCategories[0]!));
    if (variant === 'null_cost_list') configuration.ignorableCastCostAttributeKeys = null as never;
    if (variant === 'null_cost_key') configuration.ignorableCastCostAttributeKeys = [null as never];
    if (variant === 'duplicate_cost') configuration.ignorableCastCostAttributeKeys.push('spell_fee');
    if (variant === 'too_many_costs') {
      configuration.ignorableCastCostAttributeKeys = Array.from({ length: 33 }, (_, index) => `fee_${index}`);
      snapshot.catalogs.attributes.push(...configuration.ignorableCastCostAttributeKeys.map(attributeKey => ({ ...snapshot.catalogs.attributes[0]!, attributeKey })));
    }
    if (variant === 'unknown_cost') configuration.ignorableCastCostAttributeKeys = ['unknown_fee'];
    const fee = snapshot.catalogs.attributes.find(row => row.attributeKey === 'spell_fee')!;
    if (variant === 'disabled_cost') fee.status = 'DISABLED';
    if (variant === 'foreign_cost') fee.gameId = 'other';
    if (variant === 'not_numeric_cost') fee.valueType = 'TEXT' as never;
    const before = structuredClone(snapshot);
    expect(() => parseGameCalculationRules(snapshot.catalogs.calculationRules, snapshot.gameId, snapshot.catalogs.attributes, snapshot.catalogs.skillCategories)).toThrow();
    expect(snapshot).toEqual(before);
  });

  it('容量32合法，生命可列入名单，空数组不自动恢复mana等旧名', () => {
    const snapshot = classificationCostBindingsSample();
    const configuration = snapshot.catalogs.calculationRules.configuration!;
    configuration.ignorableCastCostAttributeKeys = ['hp', ...Array.from({ length: 31 }, (_, index) => `fee_${index}`)];
    snapshot.catalogs.attributes.push(...configuration.ignorableCastCostAttributeKeys.slice(1).map(attributeKey => ({ ...snapshot.catalogs.attributes[0]!, attributeKey })));
    expect(parseGameCalculationConfiguration(configuration, snapshot.catalogs.attributes, snapshot.catalogs.skillCategories).ignorableCastCostAttributeKeys).toEqual(configuration.ignorableCastCostAttributeKeys);
    configuration.ignorableCastCostAttributeKeys = [];
    expect(parseGameCalculationConfiguration(configuration).ignorableCastCostAttributeKeys).toEqual([]);
  });

  it('保护PUT冻结完整七字段候选，传输期间草稿编辑不能改变独立读回目标', async () => {
    const original = classificationCostBindingsSample().catalogs.calculationRules;
    const expected = structuredClone(original.configuration!);
    let deliver!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { deliver = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...original, baseDigest: 'd'.repeat(64), configuration: expected }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const pending = updateGameCalculationRules('http://api.test', 'demo', { baseDigest: original.baseDigest, configuration: original.configuration! });
    original.configuration!.basicAttackCategoryKey = null;
    original.configuration!.ignorableCastCostAttributeKeys = [];
    deliver(new Response(JSON.stringify({ ...original, baseDigest: 'd'.repeat(64), configuration: expected }), { status: 200 }));
    const response = await pending;
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ baseDigest: 'c'.repeat(64), configuration: expected });
    expect(response.data.configuration).toEqual(expected);
    expect(fetch.mock.calls[1]![1].method).toBeUndefined();
  });

  it.each(['basicAttackCategoryKey', 'equipmentPassiveCategoryKey', 'ignorableCastCostAttributeKeys'] as const)('独立读回%s漂移不得宣称保存成功', async field => {
    const rules = classificationCostBindingsSample().catalogs.calculationRules;
    const changed = structuredClone(rules);
    if (field === 'ignorableCastCostAttributeKeys') changed.configuration![field] = [];
    else changed.configuration![field] = null;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(rules), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(changed), { status: 200 })));
    await expect(updateGameCalculationRules('http://api.test', 'demo', { baseDigest: rules.baseDigest, configuration: rules.configuration! }))
      .rejects.toBeInstanceOf(UnconfirmedCalculationRulesWriteError);
  });
});
