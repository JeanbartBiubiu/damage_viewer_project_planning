import { describe, expect, it } from 'vitest';
import { approveSnapshotFixture, compileFixtureWithNative } from '../../tests/fixtures/nativeFormulaProof';
import { authoredAuraPairSample, authoredCostRef, classificationCostBindingsSample } from '../../tests/fixtures/classificationCostBindings';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { equipmentSimulationSample } from '../../tests/fixtures/simulationEquipment';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { assembleActiveSkills, simulationAutomaticCastCosts, simulationCastCostCandidates } from './simulationActiveSkills';
import { assembleTriggeredEquipment } from './simulation/sources/equipment';
import { validateSimulationSkillSourceManifest } from './simulation/sources/description';
import { validateSimulationSnapshot } from '../services/simulationSnapshotClient';

function costResult(snapshot: ReturnType<typeof classificationCostBindingsSample>) {
  const result = snapshot.skillConfigurations.find(row => row.skill.skillKey === authoredCostRef.skillKey)!
    .effects.find(row => row.effectKey === authoredCostRef.effectKey)!.results[0]!;
  if (result.resultType !== 'RESOURCE_CHANGE') throw new Error('作者费用样例错误');
  return result;
}

describe('本次快照分类和费用用途绑定', () => {
  it.each([false, true])('两个独立装备光环不同属性=%s仍保持完整来源和两份挂载', different => {
    const snapshot = authoredAuraPairSample(different);
    expect(validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection)).toBe(snapshot);
    approveSnapshotFixture(snapshot);
    const assembly = assembleTriggeredEquipment(snapshot);
    expect(assembly.compiledSources.map(row => row.skillKey)).toEqual(['authored_aura_a_passive', 'authored_aura_b_passive']);
    expect(assembly.mounts).toHaveLength(2);
    const modifiers = assembly.providers.flatMap(row => row.modifiers ?? []);
    expect(modifiers.map(row => row.target)).toEqual(['opponent.attr.authored_tempo', `opponent.attr.${different ? 'authored_guard' : 'authored_tempo'}`]);
  });
  it('全部分类改名后保留完整角色、装备和来源闭包；费用声明不产生属性补值', () => {
    const snapshot = classificationCostBindingsSample();
    const before = structuredClone(snapshot);
    expect(validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection)).toBe(snapshot);
    approveSnapshotFixture(snapshot);
    expect(simulationCastCostCandidates(snapshot)).toEqual([authoredCostRef]);
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow('资源改变');
    const inspection = inspectSimulationSnapshot(snapshot, [authoredCostRef]);
    expect(inspection.requirements.some(row => row.attribute.attributeKey === 'spell_fee')).toBe(false);
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspection.requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
    const prepared = assembleSimulation(snapshot, inputs, { source: 250, target: 500 }, [], [], [authoredCostRef]);
    expect(prepared.basicAttackBinding!.skillKey).toBe('sample_basic_attack');
    expect(prepared.compileRequest.sharedProviders!.some(row => row.kind === 'item' && row.skillKey === 'item_1043_passive')).toBe(true);
    expect(prepared.compileRequest.typeCatalog.types).toContainEqual({ key: 'ability/skill_category/authored_strike', domain: 'ability' });
    expect(prepared.compileRequest.typeCatalog.types).toContainEqual({ key: 'ability/skill_category/authored_item', domain: 'ability' });
    expect(prepared.compileRequest.typeCatalog.types).toContainEqual({ key: 'spell_fee', domain: 'attribute' });
    for (const actor of prepared.compileRequest.combatants) expect(actor.attributes).not.toHaveProperty('spell_fee');
    expect(prepared.ignoredCastCosts).toEqual([authoredCostRef]);
    expect(snapshot).toEqual(before);
  });

  it('旧basic_attack和passive目录名没有特殊准入身份', () => {
    const snapshot = classificationCostBindingsSample();
    approveSnapshotFixture(snapshot);
    snapshot.skillConfigurations[0]!.skill.skillCategoryKeys = ['basic_attack'];
    expect(() => inspectSimulationSnapshot(snapshot, [authoredCostRef])).toThrow('所选技能必须');
    const item = classificationCostBindingsSample();
    item.skillConfigurations.find(row => row.skill.skillKey === 'item_1043_passive')!.skill.skillCategoryKeys = ['passive'];
    expect(() => assembleTriggeredEquipment(item)).toThrow('完整单级');
  });

  it('重命名普攻的三能力明确携带协议标记，普通basic_attack作者分类不把主动技能变成普攻', () => {
    const snapshot = classificationCostBindingsSample();
    const active = snapshot.skillConfigurations.find(row => row.skill.skillKey === authoredCostRef.skillKey)!;
    active.skill.skillCategoryKeys = ['basic_attack'];
    snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'basic_attack', name: '普通作者类别' });
    approveSnapshotFixture(snapshot);
    const inspection = inspectSimulationSnapshot(snapshot, [authoredCostRef]);
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspection.requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
    const prepared = assembleSimulation(snapshot, inputs, { source: 250, target: 500 }, [], [], [authoredCostRef]);
    const primary = prepared.compileRequest.sharedProviders!.find(row => row.skillKey === 'sample_basic_attack')!;
    expect(primary.abilities!.filter(row => row.kind === 'active')).toHaveLength(3);
    for (const ability of primary.abilities!.filter(row => row.kind === 'active')) {
      expect(ability.types).toContain('ability/basic_attack');
      expect(ability.types).toContain('ability/skill_category/authored_strike');
    }
    const compiledActive = prepared.compileRequest.sharedProviders!.find(row => row.skillKey === authoredCostRef.skillKey)!;
    for (const ability of compiledActive.abilities!.filter(row => row.kind === 'active')) {
      expect(ability.types).not.toContain('ability/basic_attack');
      expect(ability.types).toContain('ability/skill_category/basic_attack');
    }
    expect(prepared.compileRequest.rules.vampRules![0]!.abilityMatcher).toEqual({ any: ['ability/skill_category/authored_strike'] });
    expect(compileFixtureWithNative(prepared.compileRequest).ok).toBe(true);
  });

  it('普攻绑定只在实际所选普攻消费，纯主动允许两个分类用途未绑定', () => {
    const selected = classificationCostBindingsSample();
    selected.catalogs.calculationRules.configuration!.basicAttackCategoryKey = null;
    expect(() => inspectSimulationSnapshot(selected, [authoredCostRef])).toThrow('catalogs.calculationRules.configuration.basicAttackCategoryKey');
    const pure = simulationActiveSample();
    pure.catalogs.calculationRules.configuration!.basicAttackCategoryKey = null;
    pure.catalogs.calculationRules.configuration!.equipmentPassiveCategoryKey = null;
    approveSnapshotFixture(pure);
    expect(inspectSimulationSnapshot(pure).requirements.length).toBeGreaterThan(0);
    expect(assembleActiveSkills(pure).bindings).toHaveLength(1);
  });

  it('启用且可达装备才消费被动分类，纯属性装备或关闭装备技能无需绑定', () => {
    const snapshot = classificationCostBindingsSample();
    snapshot.catalogs.calculationRules.configuration!.equipmentPassiveCategoryKey = null;
    expect(() => assembleTriggeredEquipment(snapshot)).toThrow('catalogs.calculationRules.configuration.equipmentPassiveCategoryKey');
    snapshot.selection.sourceSkillSettings.push({ origin: { kind: 'EQUIPMENT', equipmentKey: 'item_1043' }, skillKey: 'item_1043_passive', enabled: false });
    syncSimulationSkillSources(snapshot);
    expect(assembleTriggeredEquipment(snapshot).compiledSources).toEqual([]);
    expect(assembleTriggeredEquipment(equipmentSimulationSample(['item_1036'])).compiledSources).toEqual([]);
  });

  it('非自主普攻来源按本次绑定识别，不能用旧目录名隐藏可达入口', () => {
    const snapshot = classificationCostBindingsSample();
    validateSimulationSkillSourceManifest(snapshot);
    const basic = snapshot.skillConfigurations[0]!;
    const other = JSON.parse(JSON.stringify(basic).replaceAll('sample_basic_attack', 'other_attack')) as typeof basic;
    other.skill.skillCategoryKeys = ['basic_attack'];
    snapshot.skillConfigurations.push(other);
    snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[0]!, skillKey: other.skill.skillKey });
    snapshot.source.skillSources.push({ ...snapshot.source.skillSources[0]!, skillKey: other.skill.skillKey, enabledRuleKeys: [], inactiveReason: 'NO_AUTONOMOUS_ATTACK' });
    expect(() => validateSimulationSkillSourceManifest(snapshot)).toThrow('无自主普攻排除原因');
    other.skill.skillCategoryKeys = ['authored_strike'];
    validateSimulationSkillSourceManifest(snapshot);
  });

  it('名单本身不自动忽略；旧mana也不具备隐含费用资格，快照漂移拒绝旧确认', () => {
    const snapshot = classificationCostBindingsSample();
    approveSnapshotFixture(snapshot);
    expect(() => assembleActiveSkills(snapshot)).toThrow('资源改变');
    const saved = structuredClone(authoredCostRef);
    snapshot.catalogs.calculationRules.configuration!.ignorableCastCostAttributeKeys = [];
    expect(simulationCastCostCandidates(snapshot)).toEqual([]);
    expect(() => assembleActiveSkills(snapshot, [saved])).toThrow('只允许逐项声明');
    snapshot.catalogs.calculationRules.configuration!.ignorableCastCostAttributeKeys = ['spell_fee'];
    costResult(snapshot).detail.attributeKey = 'mana';
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'mana' });
    expect(simulationCastCostCandidates(snapshot)).toEqual([]);
    expect(() => assembleActiveSkills(snapshot, [saved])).toThrow('只允许逐项声明');
  });

  it.each(['not_planned', 'disabled_source', 'unused_process', 'wrong_owner', 'different_level'])('%s不能成为费用候选', variant => {
    const snapshot = classificationCostBindingsSample();
    const plan = snapshot.selection.plannedSkills[0]!;
    if (variant === 'not_planned') snapshot.selection.plannedSkills = [];
    if (variant === 'disabled_source') snapshot.source.skillSources.find(row => row.skillKey === authoredCostRef.skillKey)!.enabled = false;
    if (variant === 'wrong_owner') plan.origin.characterKey = 'actor_b';
    if (variant === 'different_level') plan.skillLevel = 2;
    if (variant === 'unused_process') {
      const skill = snapshot.skillConfigurations.find(row => row.skill.skillKey === authoredCostRef.skillKey)!;
      const original = skill.processes[0]!;
      skill.processes.push({ ...structuredClone(original), processKey: 'unplanned_cast' });
      original.effectBindings = [];
    }
    expect(simulationCastCostCandidates(snapshot)).toEqual([]);
  });

  it.each(['restore', 'target', 'late_moment', 'step_key', 'failure', 'effect_lifecycle', 'result_lifecycle', 'shield'])('完整费用形状损坏%s不能成为候选', variant => {
    const snapshot = classificationCostBindingsSample();
    const skill = snapshot.skillConfigurations.find(row => row.skill.skillKey === authoredCostRef.skillKey)!;
    const result = costResult(snapshot);
    const effect = skill.effects.find(row => row.effectKey === authoredCostRef.effectKey)!;
    const binding = skill.processes[0]!.effectBindings[0]!;
    if (variant === 'restore') result.detail.operation = 'RESTORE';
    if (variant === 'target') result.target = 'TARGET';
    if (variant === 'late_moment') binding.moment.momentType = 'PROCESS_COMPLETE';
    if (variant === 'step_key') binding.moment.stepKey = 'delay';
    if (variant === 'failure') binding.moment.failureReason = 'ACTIVE_CANCEL';
    if (variant === 'effect_lifecycle') effect.lifecycle = {} as never;
    if (variant === 'result_lifecycle') result.lifecycleBehavior = {} as never;
    if (variant === 'shield') result.spellShieldBlockScope = 'RESULT';
    expect(simulationCastCostCandidates(snapshot)).toEqual([]);
  });

  it('普通费用可以自动识别并保留档案引用，不依赖资源或效果名称', () => {
    const snapshot = classificationCostBindingsSample();
    approveSnapshotFixture(snapshot);
    const before = structuredClone(snapshot);
    const costs = simulationAutomaticCastCosts(snapshot);
    expect(costs).toEqual([authoredCostRef]);
    expect(assembleActiveSkills(snapshot, costs).ignoredCastCosts).toEqual(costs);
    expect(snapshot).toEqual(before);
    snapshot.catalogs.calculationRules.configuration!.ignorableCastCostAttributeKeys = [];
    expect(simulationAutomaticCastCosts(snapshot)).toEqual([]);
    expect(() => assembleActiveSkills(snapshot, simulationAutomaticCastCosts(snapshot))).toThrow('资源改变');
  });

  it.each(['extra_result', 'extra_binding'] as const)('自动识别拒绝同一普通资源的额外开始消费：%s', variant => {
    const snapshot = classificationCostBindingsSample();
    approveSnapshotFixture(snapshot);
    const skill = snapshot.skillConfigurations.find(row => row.skill.skillKey === authoredCostRef.skillKey)!;
    if (variant === 'extra_result') {
      skill.effects.find(row => row.effectKey === authoredCostRef.effectKey)!.results.push({
        ...structuredClone(costResult(snapshot)), resultKey: 'necessary_payment'
      });
    } else {
      const binding = skill.processes[0]!.effectBindings.find(row => row.bindingKey === authoredCostRef.bindingKey)!;
      skill.processes[0]!.effectBindings.push({ ...structuredClone(binding), bindingKey: 'necessary_spend', sortOrder: 1 });
    }
    const before = structuredClone(snapshot);
    expect(simulationCastCostCandidates(snapshot)).toHaveLength(2);
    expect(() => simulationAutomaticCastCosts(snapshot)).toThrow('无法自动区分施法成本和必要消费');
    expect(snapshot).toEqual(before);
  });

  it('伪造或重复确认费用及未处理的必要费用均拒绝，不改变作者快照', () => {
    const snapshot = classificationCostBindingsSample();
    approveSnapshotFixture(snapshot);
    const before = structuredClone(snapshot);
    for (const ignored of [[{ ...authoredCostRef, bindingKey: 'forged' }], [{ ...authoredCostRef, resultKey: 'missing' }],
      [{ ...authoredCostRef, skillKey: 'unplanned' }], [authoredCostRef, authoredCostRef], [{ ...authoredCostRef, hidden: true }]]) {
      expect(() => assembleActiveSkills(snapshot, ignored)).toThrow();
    }
    expect(snapshot).toEqual(before);
    const skill = snapshot.skillConfigurations.find(row => row.skill.skillKey === authoredCostRef.skillKey)!;
    const result = costResult(snapshot);
    skill.effects.find(row => row.effectKey === authoredCostRef.effectKey)!.results.push({ ...structuredClone(result), resultKey: 'necessary_payment' });
    expect(() => assembleActiveSkills(snapshot, [authoredCostRef])).toThrow('资源改变');
  });

  it('未消费的绑定仍要求合法目录，名单属性缺目录或停用仍拒绝', () => {
    const snapshot = simulationActiveSample();
    snapshot.catalogs.calculationRules.configuration!.equipmentPassiveCategoryKey = 'absent_item_kind';
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow('unknown_skill_category');
    const cost = classificationCostBindingsSample();
    cost.catalogs.attributes.find(row => row.attributeKey === 'spell_fee')!.status = 'DISABLED';
    expect(() => simulationCastCostCandidates(cost)).toThrow('unknown_attribute');
  });

  it('必要闭包损坏或无法定位首次入口时不产生费用候选，执行仍按原路径严格拒绝', () => {
    const snapshot = classificationCostBindingsSample();
    const skill = snapshot.skillConfigurations.find(row => row.skill.skillKey === authoredCostRef.skillKey)!;
    skill.triggerRules[0]!.actions[0]!.detail = { processKey: 'missing_process' } as never;
    expect(simulationCastCostCandidates(snapshot)).toEqual([]);
    expect(() => assembleActiveSkills(snapshot, [authoredCostRef])).toThrow('必要闭包引用缺失或重复');
    skill.triggerRules = [];
    expect(simulationCastCostCandidates(snapshot)).toEqual([]);
    expect(() => assembleActiveSkills(snapshot, [authoredCostRef])).toThrow('缺少完整效果或触发规则');
  });
});
