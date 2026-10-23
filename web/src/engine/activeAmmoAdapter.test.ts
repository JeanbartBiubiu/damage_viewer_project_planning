import { inspectSimulationSnapshot } from './simulationAdapter';
import { describe, expect, it } from 'vitest';
import { simulationActiveAmmo } from '../../tests/fixtures/simulationActiveAmmo';
import { assembleActiveSkills } from './simulationActiveSkills';
import { assembleNaturalSkillSources } from './simulationNaturalSkillSources';
import { normalizeSceneInitialParameterInputs, sceneInitialParameterRequirements, SceneInitialParameterRequired } from './sceneInitialParameterInput';
import { naturalRuleKeys } from './simulationSkillSourceDescription';
import { compileProcessCounterValue } from './processCounterInput';
import { createNumericCompileState } from './numericAdapter';
import { skillFormulaPreflightRequest } from './skillFormulaPreflight';
import { compileFixtureWithNative } from '../../tests/fixtures/nativeFormulaProof';

const active = (fixture: ReturnType<typeof simulationActiveAmmo>, stock = 1, remaining = 5000, phase = 1) =>
  assembleActiveSkills(fixture.snapshot, [], undefined, fixture.inputs(stock, remaining, phase));

describe('通用主动弹药与整数循环宿主装配', () => {
  it('库存、余时与下一发各有真实声明，帧读取参数不变成用户输入', () => {
    const fixture = simulationActiveAmmo();
    const requirements = sceneInitialParameterRequirements(fixture.snapshot);
    expect(requirements.map(row => row.parameterKey).sort()).toEqual(['initial_phase', 'initial_remaining', 'initial_stock']);
    expect(requirements.every(row => row.bindings.every(binding => binding.stateKey && binding.field))).toBe(true);
    expect(() => active(fixture)).not.toThrow();
    expect(() => assembleActiveSkills(fixture.snapshot)).toThrow(SceneInitialParameterRequired);
    expect(normalizeSceneInitialParameterInputs(fixture.snapshot, fixture.inputs().reverse())).toEqual(fixture.inputs());
  });
  it.each([0, 1, 4])('库存 %s 进入同一真实父供值器，显式零余时保留或核对后省略', stock => {
    const fixture = simulationActiveAmmo();
    const assembly = active(fixture, stock, 0);
    const provider = assembly.providers.find(row => row.providerKey === assembly.bindings[0]!.providerDefinitionRef)!;
    expect(provider.initialStateSchema?.stock).toEqual({ valueType: 'integer', stateKind: 'ammo', defaultValue: stock, maxValue: 4,
      ammoRecovery: { intervalMs: { op: 'const', value: 20000 }, mode: 'one_by_one', startCondition: 'after_consume', ...(stock < 4 ? { initialRemainingMs: 0 } : {}) } });
    const writes = provider.processes![0]!.momentOperations[0]!.operations;
    expect(writes.map(row => [row.operation, row.ref, row.valuePolicy])).toEqual([
      ['state_change', 'stock', 'add'], ['state_change', 'frozen_phase', 'set'], ['state_change', 'next_phase', 'set']
    ]);
    expect(writes[1]!.amount).toEqual({ op: 'read', path: 'provider.state.next_phase' });
    expect(writes[2]!.amount).toEqual({ op: 'if', args: [
      { op: 'eq', args: [{ op: 'read', path: 'provider.state.next_phase' }, { op: 'const', value: 3 }] },
      { op: 'const', value: 1 }, { op: 'add', args: [{ op: 'read', path: 'provider.state.next_phase' }, { op: 'const', value: 1 }] }
    ] });
    expect(assembly.formulas.some(row => row.key.endsWith('/next_phase'))).toBe(false);
  });
  it.each([1, 2, 3])('循环位置 %s 在默认字段冻结，命中只读本次序号', phase => {
    const fixture = simulationActiveAmmo();
    const assembly = active(fixture, 1, 100, phase);
    const provider = assembly.providers.find(row => row.providerKey === assembly.bindings[0]!.providerDefinitionRef)!;
    expect(provider.initialStateSchema?.next_phase).toMatchObject({ defaultValue: phase });
    const hit = provider.abilities!.find(row => row.operations?.[0]?.operation === 'resolve_skill_hit')!.operations![0]!.skillHit!;
    expect(hit.candidates).toHaveLength(2);
    expect(JSON.stringify(hit.candidates.map(row => row.participationCondition))).toContain('provider.state.frozen_phase');
    expect(JSON.stringify(hit.candidates.map(row => row.participationCondition))).not.toContain('provider.state.next_phase');
  });
  it('自然退款与主动库存 schema 相同，只编译一套同来源定义', () => {
    const fixture = simulationActiveAmmo();
    const inputs = fixture.inputs();
    const natural = assembleNaturalSkillSources(fixture.snapshot, inputs);
    const planned = active(fixture);
    const plannedProvider = planned.providers.find(row => row.providerKey === planned.bindings[0]!.providerDefinitionRef)!;
    const provider = natural.providers.find(row => row.providerKey === plannedProvider.providerKey)!;
    expect(provider.initialStateSchema?.stock).toEqual(plannedProvider.initialStateSchema?.stock);
    expect(provider.abilities?.[0]?.listenerSpec?.operations).toEqual([{ operation: 'state_duration_change', target: 'self', ref: 'stock',
      valuePolicy: 'subtract', amount: { op: 'const', value: 2000 }, types: ['state_scope/provider'] }]);
    expect(provider.abilities?.[0]?.listenerSpec?.eventMatcher.all).toEqual(['event/basic_attack_hit', 'event/source_owner']);
  });
  it('没有普攻时只挂真实主动库存，退款监听不进入自然闭包', () => {
    const fixture = simulationActiveAmmo(false);
    expect(active(fixture).bindings).toHaveLength(1);
    expect(assembleNaturalSkillSources(fixture.snapshot, fixture.inputs()).providers.some(row => row.skillKey === fixture.configuration.skill.skillKey)).toBe(false);
  });
  it('未驱动主动来源及不行动 B 均不索取库存、余时或循环输入', () => {
    const fixture = simulationActiveAmmo();
    const source = fixture.snapshot.source.skillSources[1]!;
    fixture.snapshot.selection.plannedSkills = [];
    source.enabledRuleKeys = []; source.inactiveReason = 'ACTIVE_DEFERRED';
    expect(naturalRuleKeys(fixture.snapshot, fixture.configuration, 'source')).toEqual([]);
    expect(sceneInitialParameterRequirements(fixture.snapshot)).toEqual([]);
    const target = fixture.snapshot.target;
    target.attachedSkills.push({ ...fixture.snapshot.source.attachedSkills[1]!, characterKey: target.character.characterKey });
    target.skillSources.push({ ...structuredClone(source), origin: { kind: 'CHARACTER', characterKey: target.character.characterKey } });
    expect(sceneInitialParameterRequirements(fixture.snapshot)).toEqual([]);
  });
  it.each(['closed', 'unlearned'] as const)('%s 来源不索取初值且不建立空库存', mode => {
    const fixture = simulationActiveAmmo();
    fixture.snapshot.selection.plannedSkills = [];
    const source = fixture.snapshot.source.skillSources[1]!;
    const setting = fixture.snapshot.selection.sourceSkillSettings.find(row => row.skillKey === source.skillKey)!;
    source.enabledRuleKeys = [];
    if (mode === 'closed') { source.enabled = setting.enabled = false; source.inactiveReason = 'SCENE_DISABLED'; }
    else { source.skillLevel = setting.skillLevel = 0; source.inactiveReason = 'UNLEARNED'; }
    expect(sceneInitialParameterRequirements(fixture.snapshot)).toEqual([]);
    expect(assembleNaturalSkillSources(fixture.snapshot).providers.some(row => row.skillKey === source.skillKey)).toBe(false);
  });
  it.each(['missing', 'full_nonzero', 'capacity', 'wrong_reference', 'wrong_scope', 'borrow_max', 'borrow_interval'] as const)('拒绝不完整或越权初值 %s', variant => {
    const fixture = simulationActiveAmmo();
    if (variant === 'missing') delete fixture.stock.detail.initialRemainingValue;
    if (variant === 'capacity') fixture.stock.detail.maxValue = { kind: 'FIXED', value: 0 };
    if (variant === 'wrong_reference') fixture.stock.detail.initialValueBinding!.parameterKey = 'initial_phase';
    if (variant === 'wrong_scope') fixture.stock.scope = 'TARGET';
    if (variant === 'borrow_max') fixture.stock.detail.maxValue = { kind: 'PARAMETER', parameterKey: 'initial_stock' };
    if (variant === 'borrow_interval') fixture.stock.detail.recoveryIntervalValue = { kind: 'PARAMETER', parameterKey: 'initial_remaining' };
    expect(() => active(fixture, variant === 'full_nonzero' ? 4 : 1)).toThrow();
  });
  it.each([-1, 0.5, 5, Number.MAX_SAFE_INTEGER + 1])('库存非法输入 %s 不隐式取整或钳位', stock => {
    expect(() => active(simulationActiveAmmo(), stock)).toThrow();
  });
  it('等级和配置变化使旧输入失效，既有数据不被修改', () => {
    const fixture = simulationActiveAmmo();
    const inputs = fixture.inputs();
    const before = structuredClone(fixture.snapshot);
    active(fixture);
    expect(fixture.snapshot).toEqual(before);
    fixture.configuration.baseDigest = 'new_configuration';
    expect(() => normalizeSceneInitialParameterInputs(fixture.snapshot, inputs)).toThrow(/身份/);
  });
  it.each(['state_kind', 'cross_skill', 'wrong_moment', 'wrong_operation', 'unbound_input', 'attribute', 'invalid_binding_key', 'duplicate_source'] as const)('有界循环拒绝 %s', variant => {
    const fixture = simulationActiveAmmo();
    const binding = fixture.configuration.triggerRules[0]!.actions[0]!.runtimeInputBindings[0]!;
    if (binding.sourceType !== 'INTERNAL_STATE') throw new Error('样例绑定失效');
    if (variant === 'state_kind') binding.detail.stateKey = 'stock';
    if (variant === 'cross_skill') binding.detail.stateSkillKey = 'other_skill';
    if (variant === 'invalid_binding_key') binding.bindingKey = '';
    if (variant === 'duplicate_source') fixture.configuration.triggerRules[0]!.actions[0]!.runtimeInputBindings.push({ bindingKey: 'other_source',
      parameterKey: 'phase_read', sourceType: 'SCENE_ATTRIBUTE_SNAPSHOT', detail: { subject: 'SOURCE', attributeKey: 'hp', sources: ['CHARACTER_LEVEL'] } });
    if (variant === 'wrong_moment') fixture.process.stateOperations[1]!.moment = { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null };
    if (variant === 'wrong_operation') fixture.process.stateOperations[1]!.operation = 'INCREASE';
    if (variant === 'unbound_input') fixture.configuration.formulas[0]!.expression.inputs[0]!.binding = { kind: 'parameter', skillKey: fixture.configuration.skill.skillKey, parameterKey: 'initial_phase' };
    if (variant === 'attribute') fixture.configuration.formulas[0]!.expression.inputs[0]!.binding = { kind: 'attribute', object: 'source', attributeKey: 'hp', valueKind: 'TOTAL', view: 'current_frame' };
    expect(() => active(fixture)).toThrow();
  });
  it.each([0, 1, 2].flatMap(index => ['SOURCE_DIED', 'UNKNOWN_REASON', '', false, 0].map(reason => ({ index, reason }))))(
    '操作$index的非空或未知失败原因$reason不会被当作缺省值', ({ index, reason }) => {
      const fixture = simulationActiveAmmo();
      (fixture.process.stateOperations[index]!.moment as unknown as Record<string, unknown>).failureReason = reason;
      expect(() => active(fixture)).toThrow();
    });
  it('展开后的公式仍验证阶段环、深度与整数常量，不能借参数透传其它动态来源', () => {
    const fixture = simulationActiveAmmo();
    const numeric = createNumericCompileState({ gameId: fixture.snapshot.gameId, skillKey: fixture.configuration.skill.skillKey, skillLevel: 1,
      characterLevel: 1, parameters: fixture.configuration.parameters, formulas: fixture.configuration.formulas, formulaNamespace: 'test',
      bindParameters: false, allowAttributeReads: false, runtimeInputMessage: '拒绝', runtimeInputReads: { phase_read: { op: 'read', path: 'ability.param.phase_read' } } });
    expect(() => compileProcessCounterValue({ kind: 'PARAMETER', parameterKey: 'phase_read' }, 'value', numeric)).toThrow(/状态输入/);
    numeric.runtimeInputReads = { phase_read: { op: 'read', path: 'provider.state.next_phase' } };
    fixture.configuration.formulas[0]!.expression.stages[0]!.expression = { op: 'ref', stageKey: 'next' };
    expect(() => compileProcessCounterValue({ kind: 'FORMULA', formulaKey: 'next_phase' }, 'value', numeric)).toThrow();
  });
  it('未执行的未知资料参数可完整预检，不索取场景输入、不给零、不进入实际引用', () => {
    const fixture = simulationActiveAmmo();
    fixture.configuration.parameters.push({ ...fixture.configuration.parameters[0]!, parameterKey: 'unresolved_reference', valueType: 'DECIMAL' });
    fixture.configuration.formulas.push({ ...fixture.configuration.formulas[0]!, formulaKey: 'documented_formula', expression: {
      inputs: [{ key: 'unknown', binding: { kind: 'parameter', skillKey: fixture.configuration.skill.skillKey, parameterKey: 'unresolved_reference' } }],
      stages: [{ key: 'raw', name: '原始资料', expression: { op: 'read', inputKey: 'unknown' } }], outputStageKey: 'raw'
    } });
    const preflight = skillFormulaPreflightRequest(fixture.snapshot, fixture.inputs());
    expect(compileFixtureWithNative(preflight).ok).toBe(true);
    expect(preflight.formulas?.find(row => row.key.endsWith('/documented_formula'))?.parameters).toEqual([
      { parameterKey: 'unresolved_reference', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL' }
    ]);
    expect(active(fixture).formulas.some(row => row.key.endsWith('/documented_formula'))).toBe(false);
    expect(sceneInitialParameterRequirements(fixture.snapshot).some(row => row.parameterKey === 'unresolved_reference')).toBe(false);
  });
});


/** 动态回充只验证装配，不在此计算截止或触发原生运行。 */
function dynamicRecoverySample() {
  const fixture = simulationActiveAmmo(), { configuration, snapshot, stock } = fixture;
  const skillKey = configuration.skill.skillKey;
  if (!snapshot.catalogs.attributes.some(attribute => attribute.attributeKey === 'ability_haste')) {
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'ability_haste', name: '真实急速目录', valueType: 'DECIMAL', status: 'ENABLED' });
  }
  configuration.parameters.push({ ...configuration.parameters[0]!, parameterKey: 'recharge_ms', valueMode: 'FIXED', valueType: 'INTEGER', fixedValue: 16000, levelValues: null });
  configuration.formulas.push({ gameId: snapshot.gameId, skillKey, formulaKey: 'dynamic_recovery', name: '当前总急速回充',
    description: null, sortOrder: 10, createdAt: '', updatedAt: '', expression: {
      inputs: [{ key: 'base', binding: { kind: 'parameter', skillKey, parameterKey: 'recharge_ms' } },
        { key: 'haste', binding: { kind: 'attribute', object: 'source', attributeKey: 'ability_haste', valueKind: 'TOTAL', view: 'current_frame' } }],
      stages: [{ key: 'raw', name: '原额', expression: { op: 'div', args: [
        { op: 'mul', args: [{ op: 'read', inputKey: 'base' }, { op: 'const', value: '100' }] },
        { op: 'add', args: [{ op: 'const', value: '100' }, { op: 'read', inputKey: 'haste' }] }
      ] } }, { key: 'result', name: '正值取整', expression: { op: 'if', args: [
        { op: 'gt', args: [{ op: 'ref', stageKey: 'raw' }, { op: 'const', value: '0' }] },
        { op: 'max', args: [{ op: 'const', value: '1' }, { op: 'round', args: [{ op: 'ref', stageKey: 'raw' }], decimals: 0 }] }, { op: 'ref', stageKey: 'raw' }
      ] } }], outputStageKey: 'result'
    } });
  stock.detail.recoveryIntervalValue = { kind: 'FORMULA', formulaKey: 'dynamic_recovery' };
  return fixture;
}

describe('动态回充在自然与主动库存的唯一装配', () => {
  it('真实同拥有者schema与完整formula相等，两分支都收集AH且保留实际作者映射', () => {
    const fixture = dynamicRecoverySample();
    const natural = assembleNaturalSkillSources(fixture.snapshot, fixture.inputs(1, 0, 1));
    const planned = active(fixture, 1, 0, 1);
    const parent = planned.providers.find(provider => provider.providerKey === planned.bindings[0]!.providerDefinitionRef)!;
    const other = natural.providers.find(provider => provider.providerKey === parent.providerKey)!;
    expect(other.initialStateSchema?.stock).toEqual(parent.initialStateSchema?.stock);
    const field = parent.initialStateSchema!.stock!;
    if (typeof field === 'number') throw Error('弹药schema不能退化成裸数字');
    const key = field.ammoRecovery!.intervalMs.ref!;
    expect(natural.triggered.formulas.find(formula => formula.key === key)).toEqual(planned.formulas.find(formula => formula.key === key));
    expect(natural.required.source.has('ability_haste')).toBe(true);
    expect(inspectSimulationSnapshot(fixture.snapshot, [], fixture.inputs(1, 0, 1)).requirements.some(row => row.side === 'source' && row.attribute.attributeKey === 'ability_haste')).toBe(true);
    expect(natural.coverage).toContainEqual({ authorPath: `skills.${fixture.configuration.skill.skillKey}.formulas.dynamic_recovery.expression`, compiledPath: `formulas[${key}].expression` });
  });
  it('目录缺失时不补H0，主动和自然都拒绝', () => {
    const fixture = dynamicRecoverySample();
    fixture.snapshot.catalogs.attributes = fixture.snapshot.catalogs.attributes.filter(attribute => attribute.attributeKey !== 'ability_haste');
    expect(() => active(fixture, 1, 0, 1)).toThrow();
    expect(() => assembleNaturalSkillSources(fixture.snapshot, fixture.inputs(1, 0, 1))).toThrow();
  });
});
