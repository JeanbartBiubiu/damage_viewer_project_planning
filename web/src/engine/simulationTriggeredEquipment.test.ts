import { approveSnapshotFixture, compileFixtureWithNative } from '../../tests/fixtures/nativeFormulaProof';
import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import { describe, expect, it } from 'vitest';
import { triggeredEquipmentSimulationSample } from '../../tests/fixtures/simulationTriggeredEquipment';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import type { GenericFormulaExpr } from '../types/genericEngine';
import type { SkillEffect, SkillEffectDamageResult, SkillEffectLifecycle, SkillEffectResult } from '../types/skillEffect';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillProcess, SkillProcessMoment, SkillProcessStateOperation } from '../types/skillProcess';
import type { SkillTriggerAction, SkillTriggerCondition, SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import { assembleSimulation as raw_assembleSimulation, inspectSimulationSnapshot as raw_inspectSimulationSnapshot, SIMULATION_ADAPTER_VERSION } from './simulationAdapter';
import { equipmentRangeRequirements } from './simulationEquipmentRange';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { assembleTriggeredEquipment as raw_assembleTriggeredEquipment } from './simulationTriggeredEquipment';

function configuration(snapshot: SimulationSnapshot) {
  return snapshot.skillConfigurations.find(row => row.skill.skillKey === 'item_1043_passive')!;
}
function damage(snapshot: SimulationSnapshot): SkillEffectDamageResult {
  return configuration(snapshot).effects[0]!.results[0] as SkillEffectDamageResult;
}
function operation(snapshot: SimulationSnapshot) {
  return assembleTriggeredEquipment(snapshot).providers[0]!.abilities![0]!.listenerSpec!.operations![0]!;
}
function reads(expression: unknown): string[] {
  if (Array.isArray(expression)) return expression.flatMap(reads);
  if (!expression || typeof expression !== 'object') return [];
  const row = expression as GenericFormulaExpr & { binding?: import('../types/formulaContract.generated').Binding };
  if (row.binding?.kind === 'attribute') return [`${row.binding.object}.attr.${row.binding.attributeKey}.${({ TOTAL: 'resolved', BASE: 'base', CURRENT: 'current', MAX: 'max' } as Record<string, string>)[row.binding.valueKind] ?? row.binding.valueKind}`];
  if (row.binding?.kind === 'parameter') return [`parameter.${row.binding.skillKey}.${row.binding.parameterKey}`];
  return [...(row.op === 'read' && row.path ? [row.path] : []), ...Object.values(row).flatMap(reads)];
}

describe('4C完整反曲之弓触发装备装配', () => {
  it('同装备多技能聚合状态消费核定静态数字，保持各共同目录并正式编译', () => {
    const snapshot = triggeredEquipmentSimulationSample();
    const first = configuration(snapshot);
    first.parameters.push({ ...first.parameters[0]!, parameterKey: 'probe_initial', fixedValue: 0 });
    first.formulas.push({ gameId: snapshot.gameId, skillKey: first.skill.skillKey, formulaKey: 'probe_initial', name: '初始计数', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
      expression: skillFormulaDefinition(first.skill.skillKey, { nodeType: 'PARAMETER', parameterKey: 'probe_initial' }) });
    first.internalStates.push({ gameId: snapshot.gameId, skillKey: first.skill.skillKey, stateKey: 'probe', name: '计数', description: null, sortOrder: 0, createdAt: '', updatedAt: '', scope: 'SKILL', stateType: 'COUNTER',
      detail: { initialValue: { kind: 'FORMULA', formulaKey: 'probe_initial' }, maxValue: { kind: 'FIXED', value: 3 }, durationValue: null } });
    first.triggerRules[0]!.conditionGroups = oneGroup([internalCondition(first, 'probe', 0)]);
    const second = structuredClone(first); second.skill.skillKey = 'item_1043_second';
    for (const row of [...second.parameters, ...second.formulas, ...second.effects, ...second.internalStates]) row.skillKey = second.skill.skillKey;
    for (const formula of second.formulas) for (const input of formula.expression.inputs) if (input.binding.kind === 'parameter') input.binding.skillKey = second.skill.skillKey;
    second.triggerRules[0]!.conditionGroups = oneGroup([internalCondition(second, 'probe', 0)]);
    snapshot.skillConfigurations.push(second);
    snapshot.source.selectedEquipment[0]!.attachedSkills.push({ ...snapshot.source.selectedEquipment[0]!.attachedSkills[0]!, skillKey: second.skill.skillKey });
    syncSimulationSkillSources(snapshot);
    const prepared = compileWithInputs(snapshot);
    const aggregate = prepared.compileRequest.sharedProviders!.find(provider => Object.keys(provider.initialStateSchema ?? {}).length === 2)!;
    expect(aggregate.skillKey).toBeUndefined();
    expect(Object.values(aggregate.initialStateSchema!).every(field => typeof field === 'object' && field.defaultValue === 0)).toBe(true);
    expect(prepared.compileRequest.formulas!.filter(formula => formula.key.endsWith('/probe_initial')).map(formula => formula.skillKey).sort()).toEqual([first.skill.skillKey, second.skill.skillKey].sort());
    const result = compileFixtureWithNative(prepared.compileRequest);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it('没有装备名算法表，无所选技能关系时返回空片段', () => {
    const assembled = assembleTriggeredEquipment(triggeredEquipmentSimulationSample(['item_1036', 'item_3065'], ['item_1042', 'item_3110']));
    expect(assembled).toEqual({ providers: [], mounts: [], types: [], formulas: [], rules: { damageTypeFormulas: [] },
      operationOrigins: [], coverage: [], required: { source: new Set(), target: new Set() }, selectedSkills: new Set(), changedAttributes: { source: new Set(), target: new Set() }, compiledSources: [] });
  });

  it('完整已核定伤害由拥有方命中监听立即执行，保留参数、分类、伤害特征与资格', () => {
    const snapshot = triggeredEquipmentSimulationSample();
    const assembled = assembleTriggeredEquipment(snapshot);
    expect(assembled.selectedSkills).toEqual(new Set(['item_1043_passive']));
    expect(assembled.mounts).toEqual([{ side: 'source', providerRef: 'source_item_1043_passive', definitionRef: 'source_item_1043_passive_definition' }]);
    expect(assembled.providers).toHaveLength(1);
    expect(assembled.providers[0]).toMatchObject({ providerKey: 'source_item_1043_passive_definition',
      stableId: 'source_equipment_item_1043_definition', kind: 'item', abilities: [{
        abilityKey: 'resolve_on_basic_attack_hit', kind: 'passive_listener', skillKey: 'item_1043_passive',
        types: ['ability/skill_category/passive', 'ability/skill/item_1043_passive'], params: { on_hit_damage: 15 }, listenerSpec: {
          listenerKey: 'resolve_on_basic_attack_hit', eventMatcher: { all: ['event/basic_attack_hit', 'event/source_owner'] },
          maxTriggersPerEvent: 1, operations: [{ operation: 'damage', target: 'target', damageType: 'physics',
            critEligible: false, vampQualification: 'RESOLVED', vampOverrides: [{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE',
              basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiency: { op: 'const', value: 1 } }],
            types: ['damage_trait/delivery_basic_attack', 'damage_trait/origin_direct'],
            amount: { op: 'max', args: [{ op: 'read', path: 'ability.param.on_hit_damage' }, { op: 'const', value: 0 }] }
          }]
        }
      }] });
    expect(assembled.providers[0]!.processes).toBeUndefined();
    expect(assembled.providers[0]!.initialStateSchema).toBeUndefined();
    expect(assembled.providers[0]!.abilities![0]!.cooldown).toBeUndefined();
    expect(assembled.types).toEqual(expect.arrayContaining([
      { key: 'event/basic_attack_hit', domain: 'event' }, { key: 'event/source_owner', domain: 'event' },
      { key: 'ability/skill_category/passive', domain: 'ability' }, { key: 'ability/skill_category/basic_attack', domain: 'ability' },
      { key: 'physics', domain: 'damage' }, { key: 'combatant/champion', domain: 'combatant' }
    ]));
    expect(assembled.rules.vampRules).toMatchObject([{ vampType: 'LIFE_STEAL', sourceAttributeKey: 'life_steal_percent',
      basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1, abilityMatcher: { any: ['ability/skill_category/basic_attack'] } }]);
    expect(assembled.required.source).toEqual(new Set(['life_steal_percent', 'armor_pen_percent', 'armor_pen_flat']));
    expect(assembled.required.target).toEqual(new Set(['armor']));
  });

  it('双方同装备命名空间与固定装备身份隔离，唯一A普攻事件不匹配B拥有方监听', () => {
    const assembled = assembleTriggeredEquipment(triggeredEquipmentSimulationSample(['item_1043'], ['item_1043']));
    expect(assembled.providers.map(row => row.providerKey)).toEqual(['source_item_1043_passive_definition', 'target_item_1043_passive_definition']);
    expect(assembled.providers.map(row => row.stableId)).toEqual(['source_equipment_item_1043_definition', 'target_equipment_item_1043_definition']);
    expect(assembled.mounts.map(row => row.side)).toEqual(['source', 'target']);
    expect(assembled.operationOrigins.map(row => row.abilityRef)).toEqual([
      'source.provider[source_item_1043_passive].ability[resolve_on_basic_attack_hit]',
      'target.provider[target_item_1043_passive].ability[resolve_on_basic_attack_hit]'
    ]);
    function matchingOwners(eventSource: 'source' | 'target', eventType: string) {
      return assembled.mounts.filter(mount => {
        const definition = assembled.providers.find(row => row.providerKey === mount.definitionRef)!;
        const matcher = definition.abilities![0]!.listenerSpec!.eventMatcher;
        const eventTypes = new Set([eventType, eventSource === mount.side ? 'event/source_owner' : 'event/source_opponent']);
        return matcher.all!.every(type => eventTypes.has(type));
      }).map(row => row.side);
    }
    expect(matchingOwners('source', 'event/basic_attack_hit')).toEqual(['source']);
    for (const provider of assembled.providers) {
      expect(provider.abilities![0]!.listenerSpec!.oncePerUse).toBeUndefined();
      expect(provider.abilities![0]!.listenerSpec!.perCastThrottleMs).toBeUndefined();
    }
    expect(matchingOwners('source', 'event/basic_attack_start')).toEqual([]);
    expect(matchingOwners('source', 'event/damage_instance')).toEqual([]);
    expect(matchingOwners('target', 'event/basic_attack_hit')).toEqual(['target']);
    expect(assembled.rules.damageTypeFormulas).toHaveLength(1);
    for (const side of ['source', 'target'] as const) expect(assembled.required[side]).toEqual(new Set(['life_steal_percent', 'armor_pen_percent', 'armor_pen_flat', 'armor']));
  });

  it('仅B装备保留B拥有方和A受伤方依赖，不把B附伤自动装入A普攻', () => {
    const assembled = assembleTriggeredEquipment(triggeredEquipmentSimulationSample([], ['item_1043']));
    expect(assembled.mounts).toEqual([{ side: 'target', providerRef: 'target_item_1043_passive', definitionRef: 'target_item_1043_passive_definition' }]);
    expect(assembled.required.source).toEqual(new Set(['armor']));
    expect(assembled.required.target).toEqual(new Set(['life_steal_percent', 'armor_pen_percent', 'armor_pen_flat']));
    expect(assembled.operationOrigins[0]!.abilityRef).toMatch(/^target\.provider/);
    expect(assembled.providers[0]!.abilities![0]!.types).toEqual(['ability/skill_category/passive', 'ability/skill/item_1043_passive']);
  });

  it('完整共同定义直接透传，表达式、具名结果与十进制原文保持，不在Web展开', () => {
    const snapshot = triggeredEquipmentSimulationSample();
    const original = structuredClone(snapshot.catalogs.damageTypes[0]!.formula.formula);
    const assembled = assembleTriggeredEquipment(snapshot);
    const defense = assembled.rules.damageTypeFormulas![0]!;
    expect(defense.damageType).toBe('physics');
    expect(defense.formula).toEqual(original);
    expect(defense.formula).not.toBe(snapshot.catalogs.damageTypes[0]!.formula.formula);
    expect(assembled.coverage).toContainEqual({ authorPath: 'damageTypes.physics.formula', compiledPath: 'rules.damageTypeFormulas[0].formula' });
  });

  it('真实伤害明确常量1且可只有一个结果，不从伤害名称补防御模板', () => {
    const snapshot = triggeredEquipmentSimulationSample();
    const entry = structuredClone(snapshot.catalogs.damageTypes[0]!);
    entry.type.damageTypeKey = entry.formula.damageTypeKey = 'real';
    entry.formula.formula = { inputs: [], stages: [{ key: 'unmitigated', name: '明确免防御', expression: { op: 'const', value: '1.00' } }], outputStageKey: 'unmitigated' };
    snapshot.catalogs.damageTypes.push(entry);
    damage(snapshot).detail.damageTypeKey = 'real';
    const assembled = assembleTriggeredEquipment(snapshot);
    expect(assembled.rules.damageTypeFormulas![0]).toEqual({ damageType: 'real', formula: entry.formula.formula });
    expect(assembled.required.target.size).toBe(0);
  });
  it('双方角色等级参数按各自等级绑定，不设技能等级或运行输入默认值', () => {
    const snapshot = triggeredEquipmentSimulationSample(['item_1043'], ['item_1043']);
    snapshot.selection.targetLevel = 4;
    Object.assign(configuration(snapshot).parameters[0]!, { valueMode: 'CHARACTER_LEVEL', fixedValue: null, levelValues: { '1': 15, '4': 30 } });
    const assembled = assembleTriggeredEquipment(snapshot);
    expect(assembled.providers.map(row => row.abilities![0]!.params)).toEqual([{ on_hit_damage: 15 }, { on_hit_damage: 30 }]);
  });

  it('金额、暴击公式复用既有数值翻译，属性依赖按被动实际拥有方与目标翻转', () => {
    const snapshot = triggeredEquipmentSimulationSample([], ['item_1043']);
    const config = configuration(snapshot);
    config.formulas.push({ ...snapshot.skillConfigurations[0]!.formulas[0]!, skillKey: config.skill.skillKey, formulaKey: 'on_hit_formula',
      expression: skillFormulaDefinition(config.skill.skillKey, { nodeType: 'OPERATION', operation: 'ADD', operands: [
        { nodeType: 'PARAMETER', parameterKey: 'on_hit_damage' }, { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'MISSING_RATIO' }
      ] }) });
    damage(snapshot).valueRule.value = { kind: 'FORMULA', formulaKey: 'on_hit_formula' };
    config.parameters.push({ ...config.parameters[0]!, parameterKey: 'critical_base', valueType: 'DECIMAL', fixedValue: 1.75 });
    config.formulas.push({ ...config.formulas[0]!, formulaKey: 'critical_multiplier', expression: skillFormulaDefinition(config.skill.skillKey, { nodeType: 'OPERATION', operation: 'ADD', operands: [
      { nodeType: 'PARAMETER', parameterKey: 'critical_base' },
      { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'critical_strike_damage_bonus_percent', attributeValueKind: 'TOTAL' }
    ] }) });
    damage(snapshot).detail.critical = { mode: 'SOURCE_CRIT_CHANCE', multiplierValue: { kind: 'FORMULA', formulaKey: 'critical_multiplier' } };
    const assembled = assembleTriggeredEquipment(snapshot);
    const compiled = assembled.providers[0]!.abilities![0]!.listenerSpec!.operations![0]!;
    expect(compiled.critChance).toEqual({ op: 'read', path: 'source.attr.critical_strike_chance.resolved' });
    expect(compiled.critMultiplier).toEqual({ op: 'ref', ref: 'target_item_1043_passive/levels/1/1/critical_multiplier' });
    expect(assembled.formulas.map(row => row.key)).toEqual(['target_item_1043_passive/levels/1/1/on_hit_formula', 'target_item_1043_passive/levels/1/1/critical_multiplier']);
    expect(assembled.required.source).toEqual(new Set(['hp', 'armor']));
    expect(assembled.required.target).toEqual(new Set(['critical_strike_chance', 'critical_strike_damage_bonus_percent', 'life_steal_percent', 'armor_pen_percent', 'armor_pen_flat']));
    expect(assembled.coverage).toContainEqual({ authorPath: 'skills.item_1043_passive.formulas.critical_multiplier.expression',
      compiledPath: 'formulas[target_item_1043_passive/levels/1/1/critical_multiplier].expression' });
    expect(assembled.formulas.find(row => row.key.endsWith('/on_hit_formula'))!.expression.inputs.some(input => input.binding.kind === 'attribute' && input.binding.object === 'target' && input.binding.attributeKey === 'hp')).toBe(true); // 作者对象保持target，运行上下文由实际拥有方原生映射
  });

  it('强制暴击保留作者倍率，但不额外索取暴击概率', () => {
    const snapshot = triggeredEquipmentSimulationSample();
    damage(snapshot).detail.critical = { mode: 'FORCED', multiplierValue: { kind: 'FIXED', value: 1.75 } };
    expect(operation(snapshot)).toMatchObject({ critEligible: true, critChance: { op: 'const', value: 1 }, critMultiplier: { op: 'const', value: 1.75 } });
    expect(assembleTriggeredEquipment(snapshot).required.source.has('critical_strike_chance')).toBe(false);
  });

  it('吸血禁止例外完整保留，不能改写为未经核定的资格', () => {
    const snapshot = triggeredEquipmentSimulationSample();
    damage(snapshot).detail.vampOverrides = [{ vampType: 'LIFE_STEAL', mode: 'DISABLED', basisOutputKind: null, efficiencyValue: null }];
    expect(operation(snapshot)).toMatchObject({ vampQualification: 'RESOLVED', vampOverrides: [{ vampType: 'LIFE_STEAL', mode: 'DISABLED' }] });
  });

  it('单笔反曲覆盖准确表达on-hit生命偷取，不全局纳入passive或继承普攻分类', () => {
    const snapshot = triggeredEquipmentSimulationSample(['item_1043'], ['item_1043']);
    const originalRules = structuredClone(snapshot.catalogs.vampRules);
    const assembled = assembleTriggeredEquipment(snapshot);
    expect(snapshot.catalogs.vampRules).toEqual(originalRules);
    expect(snapshot.catalogs.vampRules.rules[0]!.skillCategoryKeys).toEqual(['basic_attack']);
    expect(assembled.rules.vampRules![0]!.abilityMatcher).toEqual({ any: ['ability/skill_category/basic_attack'] });
    for (const provider of assembled.providers) {
      expect(provider.abilities![0]!.types).toEqual(['ability/skill_category/passive', 'ability/skill/item_1043_passive']);
      expect(provider.abilities![0]!.listenerSpec!.operations![0]!.vampOverrides).toEqual([
        { vampType: 'LIFE_STEAL', mode: 'OVERRIDE', basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiency: { op: 'const', value: 1 } }
      ]);
    }
  });

  it('被动能力保留分类供全能吸血匹配，生命偷取全局目录仍只有普攻', () => {
    const snapshot = triggeredEquipmentSimulationSample();
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes.find(row => row.attributeKey === 'life_steal_percent')!, attributeKey: 'omnivamp_percent' });
    snapshot.catalogs.vampRules.rules.push({ vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent',
      basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1, deliveryKinds: ['SKILL', 'BASIC_ATTACK'],
      originKinds: ['DIRECT'], skillCategoryKeys: ['basic_attack', 'passive'] });
    const assembled = assembleTriggeredEquipment(snapshot);
    expect(assembled.providers[0]!.abilities![0]!.types).toEqual(['ability/skill_category/passive', 'ability/skill/item_1043_passive']);
    expect(assembled.rules.vampRules!.find(row => row.vampType === 'OMNIVAMP')!.abilityMatcher).toEqual({ any: ['ability/skill_category/basic_attack', 'ability/skill_category/passive'] });
    expect(assembled.rules.vampRules!.find(row => row.vampType === 'LIFE_STEAL')!.abilityMatcher).toEqual({ any: ['ability/skill_category/basic_attack'] });
    expect(assembled.required.source.has('omnivamp_percent')).toBe(true);
    expect(assembled.required.target.has('omnivamp_percent')).toBe(false);
  });

  it('吸血覆盖公式和参数按side命名空间输出，双方属性依赖不串，分类不继承普攻', () => {
    const snapshot = triggeredEquipmentSimulationSample(['item_1043'], ['item_1043']);
    const config = configuration(snapshot);
    config.parameters.push({ ...config.parameters[0]!, parameterKey: 'efficiency', valueType: 'DECIMAL', fixedValue: .5 });
    config.formulas.push({ ...snapshot.skillConfigurations[0]!.formulas[0]!, skillKey: config.skill.skillKey, formulaKey: 'vamp_efficiency',
      expression: skillFormulaDefinition(config.skill.skillKey, { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
        { nodeType: 'PARAMETER', parameterKey: 'efficiency' },
        { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO' }
      ] }) });
    damage(snapshot).detail.vampOverrides = [{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE', basisOutputKind: 'ACTUAL_HP_LOSS',
      efficiencyValue: { kind: 'FORMULA', formulaKey: 'vamp_efficiency' } }];
    const assembled = assembleTriggeredEquipment(snapshot);
    expect(assembled.formulas.map(row => row.key)).toEqual([
      'source_item_1043_passive/levels/1/1/vamp/item_1043_passive/levels/1/1/vamp_efficiency',
      'target_item_1043_passive/levels/1/1/vamp/item_1043_passive/levels/1/1/vamp_efficiency'
    ]);
    for (const [index, side] of (['source', 'target'] as const).entries()) {
      const ability = assembled.providers[index]!.abilities![0]!;
      expect(ability.types).toEqual(['ability/skill_category/passive', 'ability/skill/item_1043_passive']);
      expect(ability.params).toEqual({ on_hit_damage: 15, efficiency: .5 });
      expect(ability.listenerSpec!.operations![0]!.vampOverrides).toEqual([{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE', basisOutputKind: 'ACTUAL_HP_LOSS',
        efficiency: { op: 'ref', ref: `${side}_item_1043_passive/levels/1/1/vamp/item_1043_passive/levels/1/1/vamp_efficiency` } }]);
      expect(assembled.required[side].has('hp')).toBe(true);
    }
  });

  it('保留完整操作来源和作者覆盖，输出可直接供主装配合并', () => {
    const assembled = assembleTriggeredEquipment(triggeredEquipmentSimulationSample());
    const compiled = 'sharedProviders.source_item_1043_passive_definition.abilities[0].listenerSpec.operations[0]';
    const root = 'skills.item_1043_passive.effects.on_hit_damage.results.on_hit_damage';
    expect(assembled.operationOrigins).toEqual([{ abilityRef: 'source.provider[source_item_1043_passive].ability[resolve_on_basic_attack_hit]',
      operationRef: root, skillKey: 'item_1043_passive', effectKey: 'on_hit_damage', resultKey: 'on_hit_damage', compiledPaths: [compiled] }]);
    expect(assembled.coverage.map(row => row.authorPath)).toEqual(expect.arrayContaining([
      'source.selectedEquipment[item_1043].attachedSkills[0]', 'skills.item_1043_passive.skill',
      'skills.item_1043_passive.triggerRules.resolve_on_basic_attack_hit',
      'skills.item_1043_passive.triggerRules.resolve_on_basic_attack_hit.actions.execute_on_hit_damage',
      'skills.item_1043_passive.effects.on_hit_damage', 'skills.item_1043_passive.parameters.on_hit_damage',
      `${root}.target`, `${root}.valueRule`, `${root}.detail.damageTypeKey`, `${root}.detail.deliveryKind`, `${root}.detail.originKind`,
      `${root}.detail.critical`, `${root}.detail.vampQualification`, `${root}.detail.vampOverrides`, 'catalogs.vampRules.rules[0]'
    ]));
  });

  it('原始快照完全只读，重复装配确定且不与作者数组共享输出', () => {
    const snapshot = triggeredEquipmentSimulationSample(['item_1043'], ['item_1043']);
    const before = structuredClone(snapshot);
    const assembled = assembleTriggeredEquipment(snapshot);
    expect(assembleTriggeredEquipment(snapshot)).toEqual(assembled);
    assembled.providers[0]!.abilities![0]!.params!.on_hit_damage = 999;
    assembled.rules.vampRules![0]!.sourceAttributeKey = 'changed';
    expect(snapshot).toEqual(before);
  });

  it.each(['UNRESOLVED', 'UNKNOWN'])('吸血资格%s整体拒绝，不过滤真实未核定被动后取固定属性', qualification => {
    const snapshot = triggeredEquipmentSimulationSample(['item_1036', 'item_1043']);
    Object.assign(damage(snapshot).detail, { vampQualification: qualification });
    const before = structuredClone(snapshot);
    expect(() => assembleTriggeredEquipment(snapshot)).toThrow(/skills\.item_1043_passive\.effects\.on_hit_damage\.results\.on_hit_damage\.detail\.vampQualification.*吸血资格尚未核定/);
    expect(snapshot).toEqual(before);
  });

  it.each(['item_3124', 'item_3075'])('没有技能关系的装备%s按真实直接属性装配，不按编号拒绝', equipmentKey => {
    const snapshot = triggeredEquipmentSimulationSample(['item_1043'], [equipmentKey]);
    expect(inspectSimulationSnapshot(snapshot).equipmentOrigins.some(row => row.equipmentKey === equipmentKey)).toBe(true);
  });
});

const invalidShapes: Array<[string, (snapshot: SimulationSnapshot) => void, RegExp]> = [
  ['未启用技能', snapshot => { configuration(snapshot).skill.status = 'DISABLED'; }, /全局状态不一致/],
  ['多级技能', snapshot => { configuration(snapshot).skill.maxLevel = 2; }, /完整单级/],
  ['内部状态', snapshot => { Object.assign(configuration(snapshot), { internalStates: [{}] }); }, /稳定标识/],
  ['未知配置字段', snapshot => { Object.assign(configuration(snapshot), { hiddenBehavior: true }); }, /hiddenBehavior.*未接入/],
  ['缺失关系', snapshot => { snapshot.source.selectedEquipment[0]!.attachedSkills = []; }, /原始绑定不一致/],
  ['关系重复', snapshot => { snapshot.source.selectedEquipment[0]!.attachedSkills.push(structuredClone(snapshot.source.selectedEquipment[0]!.attachedSkills[0]!)); }, /稳定标识重复/],
  ['禁用关系', snapshot => { snapshot.source.selectedEquipment[0]!.attachedSkills[0]!.skillStatus = 'DISABLED'; }, /完整启用被动关系|真实绑定授予不一致/],
  ['错误关系装备', snapshot => { snapshot.source.selectedEquipment[0]!.attachedSkills[0]!.equipmentKey = 'item_1042'; }, /完整启用被动关系/],
  ['未知关系字段', snapshot => { Object.assign(snapshot.source.selectedEquipment[0]!.attachedSkills[0]!, { skillLevelMode: 'CHARACTER_LEVEL' }); }, /skillLevelMode.*未接入/],
  ['缺少配置', snapshot => { snapshot.skillConfigurations.pop(); }, /完整启用作者配置缺失|公式预检缺少真实来源技能配置/],
  ['重复配置', snapshot => { snapshot.skillConfigurations.push(structuredClone(configuration(snapshot))); }, /完整作者配置不能重复/],
  ['缺少效果', snapshot => { configuration(snapshot).effects = []; }, /完整效果或触发规则/],
  ['多余效果', snapshot => { configuration(snapshot).effects.push(structuredClone(configuration(snapshot).effects[0]!)); }, /稳定标识重复/],
  ['多余规则', snapshot => { configuration(snapshot).triggerRules.push(structuredClone(configuration(snapshot).triggerRules[0]!)); }, /稳定标识重复/],
  ['未知事件', snapshot => { Object.assign(configuration(snapshot).triggerRules[0]!.eventSource, { eventType: 'UNKNOWN' }); }, /未接入的事件节点/],
  ['未接入的伤害等待事件', snapshot => { configuration(snapshot).triggerRules[0]!.eventSource = { eventType: 'DAMAGE_PENDING', detail: {} }; }, /未接入的事件节点/],
  ['额外事件细节', snapshot => { Object.assign(configuration(snapshot).triggerRules[0]!.eventSource.detail, { sourceSkillKey: 'ignored' }); }, /sourceSkillKey.*未接入/],
  ['未接入条件', snapshot => { Object.assign(configuration(snapshot).triggerRules[0]!, { conditionGroups: [{}] }); }, /稳定标识/],
  ['未知同次使用范围', snapshot => { Object.assign(configuration(snapshot).triggerRules[0]!, { oncePerUse: { groupKey: 'single', scope: 'UNKNOWN' } }); }, /同次使用范围/],
  ['冷却限制', snapshot => { configuration(snapshot).triggerRules[0]!.perTargetCooldown = { durationValue: { kind: 'FIXED', value: 100 }, targetContext: 'CURRENT_TARGET' }; }, /触发限制/],
  ['动作重复', snapshot => { configuration(snapshot).triggerRules[0]!.actions.push(structuredClone(configuration(snapshot).triggerRules[0]!.actions[0]!)); }, /稳定标识重复/],
  ['动作目标为自身', snapshot => { configuration(snapshot).triggerRules[0]!.actions[0]!.targetContext = 'EVENT_SOURCE'; }, /事件拥有方/],
  ['未供值的动作绑定', snapshot => { Object.assign(configuration(snapshot).triggerRules[0]!.actions[0]!, { runtimeInputBindings: [{}] }); }, /运行时绑定/],
  ['结果修饰', snapshot => { Object.assign(configuration(snapshot).triggerRules[0]!.actions[0]!, { resultModifiers: [{}] }); }, /结果修饰/],
  ['错误效果引用', snapshot => { Object.assign(configuration(snapshot).triggerRules[0]!.actions[0]!.detail, { effectKey: 'missing' }); }, /效果引用缺失或重复|必要闭包引用缺失或重复/],
  ['持续效果', snapshot => { Object.assign(configuration(snapshot).effects[0]!, { lifecycle: {} }); }, /生命周期字段/],
  ['空结果', snapshot => { configuration(snapshot).effects[0]!.results = []; }, /完整结果/],
  ['额外并列结果', snapshot => { configuration(snapshot).effects[0]!.results.push(structuredClone(damage(snapshot))); }, /稳定标识重复/],
  ['未知结果类型', snapshot => { Object.assign(damage(snapshot), { resultType: 'UNKNOWN' }); }, /完整效果结果/],
  ['结果目标为自身', snapshot => { damage(snapshot).target = 'SOURCE'; }, /伤害目标或特征/],
  ['阻挡粒度', snapshot => { damage(snapshot).spellShieldBlockScope = 'RESULT'; }, /阻挡粒度/],
  ['持续结果行为', snapshot => { Object.assign(damage(snapshot), { lifecycleBehavior: {} }); }, /即时效果不能夹带生命周期/],
  ['未知伤害来源', snapshot => { Object.assign(damage(snapshot).detail, { originKind: 'UNKNOWN' }); }, /伤害目标或特征/],
  ['未知暴击资格', snapshot => { Object.assign(damage(snapshot).detail.critical, { mode: 'UNKNOWN' }); }, /未知暴击模式/],
  ['禁止暴击但带倍率', snapshot => { damage(snapshot).detail.critical.multiplierValue = { kind: 'FIXED', value: 2 }; }, /禁止暴击/],
  ['允许暴击但缺倍率', snapshot => { damage(snapshot).detail.critical.mode = 'FORCED'; }, /原作者倍率/],
  ['旧逐伤害吸血规则', snapshot => { Object.assign(damage(snapshot).detail, { vampRules: [] }); }, /vampRules.*未接入/],
  ['游戏吸血规则缺失', snapshot => { snapshot.catalogs.vampRules.rules = []; }, /尚未配置游戏吸血规则/],
  ['重复吸血规则', snapshot => { snapshot.catalogs.vampRules.rules.push(structuredClone(snapshot.catalogs.vampRules.rules[0]!)); }, /吸血种类未知或重复/],
  ['未知吸血规则字段', snapshot => { Object.assign(snapshot.catalogs.vampRules.rules[0]!, { hiddenEligibility: true }); }, /hiddenEligibility.*未接入/],
  ['未知数值来源', snapshot => { Object.assign(damage(snapshot).valueRule.value, { kind: 'UNKNOWN' }); }, /未知数值来源/],
  ['多余数值字段', snapshot => { Object.assign(damage(snapshot).valueRule.value, { hidden: 1 }); }, /hidden.*未接入/],
  ['非有限倍率', snapshot => { damage(snapshot).valueRule.fixedMultiplier = Infinity; }, /有限数值/],
  ['倒置上下界', snapshot => { Object.assign(damage(snapshot).valueRule, { fixedMinValue: 20, fixedMaxValue: 10 }); }, /下界不能高于上界/],
  ['运行输入无绑定', snapshot => { Object.assign(configuration(snapshot).parameters[0]!, { valueMode: 'RUNTIME_INPUT', fixedValue: null }); }, /未供值的计算时参数/],
  ['等级参数缺失', snapshot => { Object.assign(configuration(snapshot).parameters[0]!, { valueMode: 'CHARACTER_LEVEL', fixedValue: null, levelValues: {} }); }, /有限数值/],
  ['参数重复', snapshot => { configuration(snapshot).parameters.push(structuredClone(configuration(snapshot).parameters[0]!)); }, /稳定标识重复/],
  ['整数参数为小数', snapshot => { configuration(snapshot).parameters[0]!.fixedValue = 15.5; }, /整数约束/],
  ['固定参数夹带等级值', snapshot => { configuration(snapshot).parameters[0]!.levelValues = { '1': 20 }; }, /不能忽略另一组数值/],
  ['未引用未知公式节点', snapshot => { configuration(snapshot).formulas.push({ ...snapshot.skillConfigurations[0]!.formulas[0]!, skillKey: 'item_1043_passive' }); Object.assign(configuration(snapshot).formulas[0]!.expression, { nodeType: 'UNKNOWN' }); }, /FORMULA_INVALID_STRUCTURE/],
  ['分类未核定', snapshot => { configuration(snapshot).skill.skillCategoryKeys.push('unknown'); }, /真实技能分类/],
  ['吸血规则分类未核定', snapshot => { snapshot.catalogs.vampRules.rules[0]!.skillCategoryKeys.push('unknown'); }, /真实技能分类/],
  ['用途绑定的分类目录禁用', snapshot => { snapshot.catalogs.skillCategories.find(row => row.skillCategoryKey === 'passive')!.status = 'DISABLED'; }, /configuration.equipmentPassiveCategoryKey.*unknown_skill_category/],
  ['未知伤害目录', snapshot => { damage(snapshot).detail.damageTypeKey = 'unknown'; }, /真实共同防御/],
  ['防御目录禁用', snapshot => { snapshot.catalogs.damageTypes[0]!.type.status = 'DISABLED'; }, /真实共同防御/],
  ['防御未配置', snapshot => { snapshot.catalogs.damageTypes[0]!.type.formulaConfigured = false; }, /真实共同防御/],
  ['防御类型重复', snapshot => { snapshot.catalogs.damageTypes.push(structuredClone(snapshot.catalogs.damageTypes[0]!)); }, /真实共同防御/],
  ['防御目录夹带未知语义', snapshot => { Object.assign(snapshot.catalogs.damageTypes[0]!.type, { bypassArmor: true }); }, /bypassArmor.*未接入/],
  ['完整防御公式缺失', snapshot => { Object.assign(snapshot.catalogs.damageTypes[0]!, { formula: null }); }, /catalogs.damageTypes.physics.formula.*完整对象/],
  ['防御循环引用', snapshot => { snapshot.catalogs.damageTypes[0]!.formula.formula.stages[0]!.expression = { op: 'ref', stageKey: 'factor' }; }, /FORMULA_CYCLE/],
  ['防御节点未知', snapshot => { Object.assign(snapshot.catalogs.damageTypes[0]!.formula.formula.stages[4]!.expression, { op: 'UNKNOWN' }); }, /FORMULA_INVALID_STRUCTURE/],
  ['防御输出缺失', snapshot => { snapshot.catalogs.damageTypes[0]!.formula.formula.outputStageKey = 'absent'; }, /FORMULA_UNKNOWN_STAGE/],
  ['伤害依赖属性缺目录', snapshot => { snapshot.catalogs.attributes = snapshot.catalogs.attributes.filter(row => row.attributeKey !== 'armor'); }, /FORMULA_UNKNOWN_BINDING/],
  ['吸血属性缺目录', snapshot => { snapshot.catalogs.attributes = snapshot.catalogs.attributes.filter(row => row.attributeKey !== 'life_steal_percent'); }, /catalogs.attributes.life_steal_percent.*真实目录/],
  ['装备完整集缺失', snapshot => { snapshot.source.selectedEquipment = []; }, /原始绑定不一致/],
  ['所选装备重复', snapshot => { snapshot.selection.sourceEquipmentKeys.push('item_1043'); }, /selection.sourceEquipmentKeys.*重复/],
  ['拥有方等级缺失', snapshot => { snapshot.selection.sourceLevel = 0; }, /拥有方等级/]
];

describe('4C未接入作者配置整体拒绝', () => {
  it.each(invalidShapes)('%s', (_name, mutate, reason) => {
    const snapshot = triggeredEquipmentSimulationSample();
    mutate(snapshot);
    const before = structuredClone(snapshot);
    expect(() => assembleTriggeredEquipment(snapshot)).toThrow(reason);
    expect(snapshot).toEqual(before);
  });
});

function genericSample(key = 'authored_blade', source = true) {
  const original = triggeredEquipmentSimulationSample(source ? ['item_1043'] : [], source ? [] : ['item_1043']);
  return JSON.parse(JSON.stringify(original).replaceAll('item_1043', key)) as SimulationSnapshot;
}
function genericConfiguration(snapshot: SimulationSnapshot) {
  return snapshot.skillConfigurations.find(row => row.skill.skillCategoryKeys.includes('passive'))!;
}
function rootProvider(assembled: ReturnType<typeof assembleTriggeredEquipment>, side: 'source' | 'target' = 'source') {
  const mount = assembled.mounts.find(row => row.side === side)!;
  return assembled.providers.find(row => row.providerKey === mount.definitionRef)!;
}
function listener(snapshot: SimulationSnapshot, event = 'BASIC_ATTACK_HIT') {
  return rootProvider(assembleTriggeredEquipment(snapshot)).abilities!
    .find(row => row.listenerSpec?.eventMatcher.all?.includes(event === 'DAMAGE_DEALT' ? 'event/damage_instance' : `event/${event.toLowerCase()}`))!;
}
function addParameter(config: SkillConfiguration, key: string, amount: number) {
  config.parameters.push({ ...config.parameters[0]!, parameterKey: key, fixedValue: amount, valueType: 'DECIMAL' });
  return { kind: 'PARAMETER' as const, parameterKey: key };
}
function moment(momentType: SkillProcessMoment['momentType'], stepKey: string | null = null): SkillProcessMoment {
  return { momentType, stepKey, failureReason: null } as SkillProcessMoment;
}
function executeAction(effectKey: string, sortOrder = 10): SkillTriggerAction {
  return { actionKey: `execute_${effectKey}`, name: effectKey, actionType: 'EXECUTE_EFFECT', sortOrder, targetContext: 'CURRENT_TARGET',
    detail: { effectKey }, runtimeInputBindings: [], resultModifiers: [] };
}
function startAction(processKey: string, sortOrder = 10): SkillTriggerAction {
  return { actionKey: `start_${processKey}`, name: processKey, actionType: 'START_PROCESS', sortOrder, targetContext: 'CURRENT_TARGET',
    detail: { processKey }, runtimeInputBindings: [], resultModifiers: [] };
}
function ruleFor(config: SkillConfiguration, key: string, eventSource: SkillTriggerRuleDetail['eventSource'], actions: SkillTriggerAction[], sortOrder = 10): SkillTriggerRuleDetail {
  return { ...config.triggerRules[0]!, ruleKey: key, sortOrder, eventSource, actions, conditionGroups: [],
    oncePerUse: null, perTargetCooldown: null, maxTriggersPerProcess: null };
}
function processFor(config: SkillConfiguration, key: string, stateOperations: SkillProcessStateOperation[] = []): SkillProcess {
  return { gameId: config.skill.gameId, skillKey: config.skill.skillKey, processKey: key, name: key, description: null,
    activationType: 'PASSIVE', sortOrder: 10, cooldown: null, createdAt: '', updatedAt: '', stateOperations, effectBindings: [],
    steps: [{ stepKey: 'instant', name: '立即', description: null, sortOrder: 10, stepType: 'IMMEDIATE', detail: {} }] };
}
function stateOperation(config: SkillConfiguration, key: string, operation: 'INCREASE' | 'SET' | 'START', amount?: number, sortOrder = 10): SkillProcessStateOperation {
  return { operationKey: `${operation.toLowerCase()}_${key}`, name: key, stateSkillKey: config.skill.skillKey, stateKey: key,
    operation, value: amount === undefined ? null : { kind: 'FIXED', value: amount }, optionKey: null,
    moment: moment('STEP_EXECUTION', 'instant'), sortOrder } as SkillProcessStateOperation;
}
function internalCondition(config: SkillConfiguration, key: string, comparisonValue: number, valueKind: 'VALUE' | 'REMAINING_MS' = 'VALUE'): SkillTriggerCondition {
  return { conditionKey: `check_${key}`, conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 10,
    detail: { stateSkillKey: config.skill.skillKey, stateKey: key, valueKind, comparator: 'EQ',
      comparisonValue: { kind: 'FIXED', value: comparisonValue }, optionKey: null, expectedBoolean: null } };
}
function oneGroup(conditions: SkillTriggerCondition[]) {
  return [{ groupKey: 'guard', name: '完整条件', sortOrder: 10, conditions }];
}
function sourceLife(durationValue: SkillEffectLifecycle['durationValue'], interval?: number): SkillEffectLifecycle {
  return { durationValue, maxStacksValue: { kind: 'FIXED', value: interval ? 1 : 4 }, applicationStacksValue: { kind: 'FIXED', value: 1 },
    instanceScope: 'SOURCE', reapplicationStackMode: interval ? 'KEEP' : 'INCREASE', reapplicationDurationMode: durationValue ? 'REFRESH_ALL' : null,
    expiryMode: durationValue ? 'ALL_AT_ONCE' : 'EXPLICIT_ONLY', periodicIntervalValue: interval ? { kind: 'FIXED', value: interval } : null,
    firstPeriodicExecution: interval ? 'AFTER_INTERVAL' : null };
}
function counterSample() {
  const snapshot = genericSample();
  const config = genericConfiguration(snapshot);
  config.internalStates = [{ gameId: 'lol', skillKey: config.skill.skillKey, stateKey: 'hits', name: '真实来源计数', scope: 'SKILL',
    stateType: 'COUNTER', description: null, sortOrder: 10, createdAt: '', updatedAt: '',
    detail: { initialValue: { kind: 'FIXED', value: 0 }, maxValue: { kind: 'FIXED', value: 3 } } },
  { gameId: 'lol', skillKey: config.skill.skillKey, stateKey: 'gate', name: '真实来源冷却', scope: 'SKILL',
    stateType: 'INTERNAL_COOLDOWN', description: null, sortOrder: 20, createdAt: '', updatedAt: '', detail: { durationValue: { kind: 'FIXED', value: 1001 } } }];
  const stacking: SkillEffect = { ...config.effects[0]!, effectKey: 'stacking', lifecycle: sourceLife(addParameter(config, 'stack_window', 3000)),
    results: [{ ...config.effects[0]!.results[0]!, resultKey: 'speed', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE',
      detail: { attributeKey: 'bonus_attack_speed_percent', operation: 'INCREASE', modifierZoneKey: null },
      valueRule: { value: addParameter(config, 'per_stack_speed', .1), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'PER_STACK',
        reapplicationValueMode: null, periodicExecutionMode: null } }] };
  const link: SkillEffect = { ...config.effects[0]!, effectKey: 'extra_contact', lifecycle: null,
    results: [{ ...config.effects[0]!.results[0]!, resultKey: 'contact', resultType: 'HIT_LINK_APPLICATION',
      detail: {}, valueRule: { value: { kind: 'FIXED', value: 1 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null } }] };
  config.effects.push(stacking, link);
  const advance = processFor(config, 'advance', [stateOperation(config, 'hits', 'INCREASE', 1)]);
  advance.effectBindings.push({ bindingKey: 'base_bonus', effectKey: 'on_hit_damage', moment: moment('STEP_EXECUTION', 'instant'), sortOrder: 20 });
  const consume = processFor(config, 'consume', [stateOperation(config, 'hits', 'SET', 0), stateOperation(config, 'gate', 'START', undefined, 20)]);
  config.processes.push(advance, consume);
  const onHit = ruleFor(config, 'on_hit', { eventType: 'BASIC_ATTACK_HIT', detail: {} }, [executeAction('stacking'), startAction('advance', 20)]);
  const onCount = ruleFor(config, 'on_count', { eventType: 'PROCESS_MOMENT', detail: { processKey: 'advance', moment: moment('STEP_EXECUTION', 'instant') } },
    [executeAction('extra_contact'), startAction('consume', 20)], 30);
  onCount.conditionGroups = oneGroup([internalCondition(config, 'hits', 3), internalCondition(config, 'gate', 0, 'REMAINING_MS')]);
  const onExtra = ruleFor(config, 'on_extra', { eventType: 'HIT_LINK_APPLIED', detail: { sourceSkillKey: null } }, [executeAction('on_hit_damage')], 20);
  config.triggerRules = [onHit, onExtra, onCount];
  return syncSimulationSkillSources(snapshot);
}
function receivedSample() {
  const snapshot = genericSample('authored_receiver', false);
  const config = genericConfiguration(snapshot);
  const original = config.effects[0]!.results[0] as SkillEffectDamageResult;
  original.detail.originKind = 'REFLECTED';
  original.detail.vampOverrides = [];
  const reduction: SkillEffectResult = { ...original, resultType: 'HEALING_MODIFIER', resultKey: 'reduce_received_healing',
    valueRule: { value: addParameter(config, 'reduction_ratio', .4), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
    detail: { modifierZoneKey: 'author_reduction', direction: 'RECEIVED', operation: 'DECREASE', healingKind: 'ANY' },
    lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
      reapplicationValueMode: 'REPLACE', periodicExecutionMode: null } };
  const life: SkillEffectLifecycle = { ...sourceLife(addParameter(config, 'reduction_window', 3000)),
    instanceScope: 'SOURCE_TARGET', maxStacksValue: { kind: 'FIXED', value: 1 }, reapplicationStackMode: 'KEEP' };
  config.effects.push({ ...config.effects[0]!, effectKey: 'reduction', lifecycle: life, results: [reduction] });
  snapshot.catalogs.modifierZones.push({ gameId: 'lol', modifierZoneKey: 'author_reduction', name: '真实目录', description: null,
    domain: 'HEALING', calculationMode: 'RATIO_MAX', applicationStage: 'HEALING_RESULT', status: 'ENABLED', sortOrder: 10, createdAt: '', updatedAt: '' });
  const reflect = ruleFor(config, 'receive_reflection', { eventType: 'BASIC_ATTACK_RECEIVED', detail: {} }, [executeAction('on_hit_damage')]);
  reflect.actions[0]!.targetContext = 'EVENT_SOURCE';
  const grievous = ruleFor(config, 'receive_reduction', { eventType: 'BASIC_ATTACK_RECEIVED', detail: {} }, [executeAction('reduction')], 20);
  grievous.actions[0]!.targetContext = 'EVENT_SOURCE';
  grievous.conditionGroups = oneGroup([{ conditionKey: 'champion', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 10, detail: { categories: ['CHAMPION'] } }]);
  config.triggerRules = [reflect, grievous];
  return syncSimulationSkillSources(snapshot);
}
function configuredGhostSample() {
  const snapshot = counterSample();
  const config = genericConfiguration(snapshot);
  config.internalStates = config.internalStates.filter(state => state.stateKey === 'hits');
  const counting = processFor(config, 'count_hits', [stateOperation(config, 'hits', 'INCREASE', 1)]);
  counting.stateOperations[0]!.moment = moment('PROCESS_START');
  const reset = processFor(config, 'reset_counter', [stateOperation(config, 'hits', 'SET', 0)]);
  config.processes = [counting, reset];
  const base = ruleFor(config, 'normal_hit', { eventType: 'BASIC_ATTACK_HIT', detail: {} }, [executeAction('on_hit_damage'), executeAction('stacking', 20)]);
  const extra = ruleFor(config, 'linked_damage_only', { eventType: 'HIT_LINK_APPLIED', detail: { sourceSkillKey: null } }, [executeAction('on_hit_damage')], 20);
  const full = ruleFor(config, 'full_count', { eventType: 'BASIC_ATTACK_HIT', detail: {} }, [startAction('count_hits')], 30);
  const notFull = ruleFor(config, 'not_full_reset', { eventType: 'BASIC_ATTACK_HIT', detail: {} }, [startAction('reset_counter')], 40);
  const checkStacks = (comparator: 'GTE' | 'LT'): SkillTriggerCondition => ({ conditionKey: 'stack_qualification', conditionType: 'LIFECYCLE_CHECK', sortOrder: 10,
    detail: { effectSkillKey: config.skill.skillKey, effectKey: 'stacking', subject: null, checkKind: 'STACKS_COMPARE',
      comparator, comparisonValue: { kind: 'FIXED', value: 4 } } });
  full.conditionGroups = oneGroup([checkStacks('GTE')]);
  notFull.conditionGroups = oneGroup([checkStacks('LT')]);
  const reward = ruleFor(config, 'counter_reward', { eventType: 'PROCESS_MOMENT', detail: {
    processKey: 'count_hits', moment: moment('PROCESS_COMPLETE') } }, [executeAction('extra_contact'), startAction('reset_counter', 20)], 50);
  const checkCounter = internalCondition(config, 'hits', 3);
  if (checkCounter.conditionType === 'INTERNAL_STATE_CHECK' && checkCounter.detail.valueKind === 'VALUE') checkCounter.detail.comparator = 'GTE';
  reward.conditionGroups = oneGroup([checkCounter]);
  config.triggerRules = [base, extra, full, notFull, reward];
  return syncSimulationSkillSources(snapshot);
}
function periodicSample(permanent = false, key = 'authored_periodic') {
  const snapshot = genericSample(key);
  const config = genericConfiguration(snapshot);
  const result = config.effects[0]!.results[0] as SkillEffectDamageResult;
  result.lifecycleBehavior = { moment: 'PERIODIC', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: null,
    reapplicationValueMode: null, periodicExecutionMode: 'ONCE_PER_INSTANCE' };
  result.detail.deliveryKind = 'SKILL';
  result.detail.vampOverrides = [];
  const ratio = addParameter(config, 'health_ratio', .015);
  config.parameters[0]!.fixedValue = 20;
  config.formulas.push({ gameId: 'lol', skillKey: config.skill.skillKey, formulaKey: 'scaled_periodic_damage', name: '配置周期伤害', description: null,
    expression: skillFormulaDefinition(config.skill.skillKey, { nodeType: 'OPERATION', operation: 'ADD', operands: [
      { nodeType: 'PARAMETER', parameterKey: config.parameters[0]!.parameterKey },
      { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [{ nodeType: 'PARAMETER', parameterKey: ratio.parameterKey },
        { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'BONUS' }] }
    ] }), sortOrder: 10, createdAt: '', updatedAt: '' });
  result.valueRule.value = { kind: 'FORMULA', formulaKey: 'scaled_periodic_damage' };
  config.effects[0]!.lifecycle = sourceLife(permanent ? null : addParameter(config, 'active_window', 3000), 1000);
  if (permanent) {
    config.triggerRules[0]!.eventSource = { eventType: 'SOURCE_INITIALIZED', detail: {} };
  } else {
    config.triggerRules[0]!.eventSource = { eventType: 'DAMAGE_DEALT', detail: {
      sourceSkillKey: snapshot.selection.basicAttackSkillKey, damageTypeKey: null, deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT' } };
    const taken = { ...structuredClone(config.triggerRules[0]!), ruleKey: 'activate_on_received_damage', sortOrder: 20,
      eventSource: { eventType: 'DAMAGE_TAKEN' as const, detail: {
        sourceSkillKey: snapshot.selection.basicAttackSkillKey, damageTypeKey: null, deliveryKind: 'BASIC_ATTACK' as const, originKind: 'DIRECT' as const } } };
    config.triggerRules.push(taken);
  }
  return syncSimulationSkillSources(snapshot);
}
function compileWithInputs(snapshot: SimulationSnapshot) {
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const requirement of inspectSimulationSnapshot(snapshot).requirements) if (requirement.storedValue === undefined) {
    inputs[requirement.side][requirement.attribute.attributeKey] = requirement.attribute.attributeKey === 'attack_speed_ratio' ? .7 : 0;
  }
  return assembleSimulation(snapshot, inputs, { source: 600, target: 500 }, equipmentRangeRequirements(snapshot)
    .map(requirement => ({ owner: requirement.owner, equipmentKey: requirement.equipmentKey,
      target: requirement.owner === 'source' ? 'target' as const : 'source' as const, inRange: true })));
}

function movementSlowSample(key = 'authored_slow', source = true) {
  const snapshot = genericSample(key, source);
  const config = genericConfiguration(snapshot);
  config.effects[0]!.lifecycle = { ...sourceLife(addParameter(config, 'slow_duration', 1000)),
    instanceScope: 'SOURCE_TARGET', maxStacksValue: { kind: 'FIXED', value: 1 }, reapplicationStackMode: 'KEEP' };
  config.effects[0]!.results = [{ ...config.effects[0]!.results[0]!, resultType: 'STATUS_OPERATION', resultKey: 'ordinary_slow',
    detail: { statusKey: 'authored_slow_status', operation: 'APPLY' },
    valueRule: { value: addParameter(config, 'slow_ratio', .3), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: 1 },
    lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
      reapplicationValueMode: 'REPLACE', periodicExecutionMode: null } }];
  snapshot.catalogs.statuses.push({ gameId: snapshot.gameId, statusKey: 'authored_slow_status', statusKind: 'MOVEMENT_SLOW',
    name: '独立普通减速目录', description: null, status: 'ENABLED', sortOrder: 10, createdAt: '', updatedAt: '' });
  return syncSimulationSkillSources(snapshot);
}

function currentHealthBranchesSample() {
  const snapshot = genericSample('authored_current_health');
  const config = genericConfiguration(snapshot);
  snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes.find(attribute => attribute.attributeKey === 'hp')!,
    attributeKey: 'melee_attack', valueType: 'INTEGER', minValue: 0, maxValue: 1 });
  const template = config.effects[0]!;
  config.effects = [];
  config.triggerRules = [];
  for (const [branch, flag, ratio] of [['melee', 1, .09000000357627869], ['ranged', 0, .05999999865889549]] as const) {
    const parameter = addParameter(config, `${branch}_ratio`, ratio);
    config.formulas.push({ ...snapshot.skillConfigurations[0]!.formulas[0]!, skillKey: config.skill.skillKey,
      formulaKey: `${branch}_current_health`, expression: skillFormulaDefinition(config.skill.skillKey, { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
        { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'CURRENT' },
        { nodeType: 'PARAMETER', parameterKey: parameter.parameterKey }
      ] }) });
    const result = structuredClone(template.results[0]!) as SkillEffectDamageResult;
    result.valueRule.value = { kind: 'FORMULA', formulaKey: `${branch}_current_health` };
    config.effects.push({ ...template, effectKey: `${branch}_damage`, results: [result] });
    for (const eventType of ['BASIC_ATTACK_HIT', 'HIT_LINK_APPLIED'] as const) {
      const rule = ruleFor(config, `${branch}_${eventType.toLowerCase()}`,
        eventType === 'HIT_LINK_APPLIED' ? { eventType, detail: { sourceSkillKey: null } } : { eventType, detail: {} },
        [executeAction(`${branch}_damage`)], config.triggerRules.length * 10 + 10);
      rule.conditionGroups = oneGroup([{ conditionKey: 'explicit_attack_identity', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 10,
        detail: { subject: 'SOURCE', attributeKey: 'melee_attack', attributeValueKind: 'BASE', comparator: 'EQ',
          comparisonValue: { kind: 'FIXED', value: flag } } }]);
      config.triggerRules.push(rule);
    }
  }
  return syncSimulationSkillSources(snapshot);
}

describe('组合补验的通用普通减速与显式身份', () => {
  it.each(['authored_slow', 'renamed_slow', 'item_3153'])('异名%s同结构普通减速保留持有者、真实目录和来源覆盖，不变换成属性运算', key => {
    const snapshot = movementSlowSample(key);
    const before = structuredClone(snapshot);
    const assembled = assembleTriggeredEquipment(snapshot);
    const root = rootProvider(assembled);
    const apply = root.abilities![0]!.listenerSpec!.operations![0]!;
    const status = assembled.providers.find(provider => provider.providerKey === apply.providerDefinitionRef)!;
    expect(apply).toMatchObject({ operation: 'apply_provider', target: 'target',
      ref: `skills.${genericConfiguration(snapshot).skill.skillKey}.effects.on_hit_damage.results.ordinary_slow` });
    expect(status).toMatchObject({ kind: 'status', stableId: root.stableId,
      lifecycle: { durationMs: { op: 'const', value: 1000 }, maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' },
      statusContributions: [{ resultRef: 'ordinary_slow', statusKey: 'authored_slow_status', statusKind: 'movement_slow' }] });
    expect(status.abilities).toBeUndefined();
    expect(status.listeners).toBeUndefined();
    expect(status.modifiers).toBeUndefined();
    expect(assembled.mounts).toHaveLength(1);
    expect(assembled.coverage).toContainEqual({ authorPath: 'catalogs.statuses.authored_slow_status',
      compiledPath: `sharedProviders.${status.providerKey}.statusContributions[0]` });
    expect(assembled.operationOrigins.find(origin => origin.operationRef === apply.ref)!.resultKey).toBe('ordinary_slow');
    expect(compileWithInputs(snapshot).coverage.find(row => row.authorPath === 'catalogs.statuses.authored_slow_status')!.compiledPath)
      .toMatch(/^sharedProviders\[\d+\]\.statusContributions\[0\]$/);
    expect(snapshot).toEqual(before);
  });

  it('普通减速强度公式保留施加快照、双方依赖及重新命名后的有效公式引用', () => {
    const snapshot = movementSlowSample('snapshot_slow', false);
    const config = genericConfiguration(snapshot);
    config.formulas.push({ ...snapshot.skillConfigurations[0]!.formulas[0]!, skillKey: config.skill.skillKey, formulaKey: 'snapshot_strength',
      expression: skillFormulaDefinition(config.skill.skillKey, { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
        { nodeType: 'PARAMETER', parameterKey: 'slow_ratio' },
        { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO' }
      ] }) });
    config.effects[0]!.results[0]!.valueRule!.value = { kind: 'FORMULA', formulaKey: 'snapshot_strength' };
    const assembled = assembleTriggeredEquipment(snapshot);
    const status = assembled.providers.find(provider => provider.kind === 'status')!;
    const formula = assembled.formulas.find(row => row.key.endsWith('/snapshot_strength'))!;
    expect(JSON.stringify(status.statusContributions![0]!.strength)).toContain(formula.key);
    expect(assembled.required.source.has('hp')).toBe(true);
    expect(status.stableId).toBe(rootProvider(assembled, 'target').stableId);
  });

  it.each([
    ['source', false], ['source', true], ['target', false], ['target', true]
  ] as const)('%s生命周期公式动态=%s保留完整命名空间及双方依赖', (side, dynamic) => {
    const snapshot = movementSlowSample('authored_duration', side === 'source');
    const config = genericConfiguration(snapshot);
    config.formulas.push({ ...snapshot.skillConfigurations[0]!.formulas[0]!, skillKey: config.skill.skillKey,
      formulaKey: 'authored_duration', expression: dynamic ? skillFormulaDefinition(config.skill.skillKey, {
        nodeType: 'OPERATION', operation: 'ADD', operands: [
          { nodeType: 'PARAMETER', parameterKey: 'slow_duration' },
          { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'TOTAL' }
        ]
      }) : skillFormulaDefinition(config.skill.skillKey, { nodeType: 'PARAMETER', parameterKey: 'slow_duration' }) });
    config.effects[0]!.lifecycle!.durationValue = { kind: 'FORMULA', formulaKey: 'authored_duration' };
    const before = structuredClone(snapshot);
    const assembled = assembleTriggeredEquipment(snapshot);
    const status = assembled.providers.find(provider => provider.kind === 'status')!;
    if (dynamic) {
      const duration = assembled.formulas.find(formula => formula.key.includes('/status/') && formula.key.endsWith('/authored_duration'))!;
      expect(status.lifecycle!.durationMs).toEqual({ op: 'ref', ref: duration.key });
      expect(duration.key).toMatch(new RegExp(`^${side}_authored_duration_passive/`));
      expect(assembled.required[side].has('hp')).toBe(true);
    } else {
      expect(status.lifecycle!.durationMs).toEqual({ op: 'const', value: 1000 });
    }
    expect(snapshot).toEqual(before);
  });

  it.each([
    ['缺目录', (snapshot: SimulationSnapshot) => { snapshot.catalogs.statuses = []; }],
    ['禁用目录', (snapshot: SimulationSnapshot) => { snapshot.catalogs.statuses[0]!.status = 'DISABLED'; }],
    ['异游戏目录', (snapshot: SimulationSnapshot) => { snapshot.catalogs.statuses[0]!.gameId = 'other_game'; }],
    ['重复目录', (snapshot: SimulationSnapshot) => { snapshot.catalogs.statuses.push(structuredClone(snapshot.catalogs.statuses[0]!)); }],
    ['未知目录字段', (snapshot: SimulationSnapshot) => { Object.assign(snapshot.catalogs.statuses[0]!, { guessedSpeed: .3 }); }],
    ['其它控制', (snapshot: SimulationSnapshot) => { snapshot.catalogs.statuses[0]!.statusKind = 'STUN'; }],
    ['混合持续结果', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.results.push({ ...damage(triggeredEquipmentSimulationSample()), resultKey: 'mixed_damage' }); }],
    ['缺生命周期', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.lifecycle = null; }],
    ['缺期限', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.lifecycle!.durationValue = null; }],
    ['多层', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.lifecycle!.maxStacksValue = { kind: 'FIXED', value: 2 }; }],
    ['周期', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.lifecycle!.periodicIntervalValue = { kind: 'FIXED', value: 100 }; }],
    ['非快照读取', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.results[0]!.lifecycleBehavior!.valueReadMode = 'MOMENT_EVALUATION'; }],
    ['错误重施', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.results[0]!.lifecycleBehavior!.reapplicationValueMode = 'KEEP'; }],
    ['移除操作', (snapshot: SimulationSnapshot) => { const result = genericConfiguration(snapshot).effects[0]!.results[0]!; if (result.resultType === 'STATUS_OPERATION') result.detail.operation = 'REMOVE'; }],
    ['对手投到自己', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).triggerRules[0]!.actions[0]!.targetContext = 'EVENT_SOURCE'; }]
  ] as const)('普通减速%s整件拒绝且快照不被改写', (_label, mutate) => {
    const snapshot = movementSlowSample();
    mutate(snapshot);
    const before = structuredClone(snapshot);
    expect(() => assembleTriggeredEquipment(snapshot)).toThrow();
    expect(snapshot).toEqual(before);
  });

  it('普通和额外命中共用逐笔CURRENT公式，只读取来源BASE身份且保留吸血覆盖', () => {
    const snapshot = currentHealthBranchesSample();
    const assembled = assembleTriggeredEquipment(snapshot);
    const abilities = rootProvider(assembled).abilities!;
    expect(abilities).toHaveLength(4);
    for (const ability of abilities) {
      expect(reads(ability.listenerSpec!.condition)).toEqual(['source.attr.melee_attack.base']);
      expect(ability.listenerSpec!.operations!.map(operation => operation.operation)).toEqual(['damage']);
      expect(ability.listenerSpec!.operations![0]!.vampOverrides).toEqual([{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE',
        basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiency: { op: 'const', value: 1 } }]);
    }
    expect(assembled.formulas.every(formula => reads(formula.expression).includes('target.attr.hp.current'))).toBe(true);
    expect(assembled.required.source.has('melee_attack')).toBe(true);
    expect(assembled.required.target.has('hp')).toBe(true);
    expect(rootProvider(assembled).initialStateSchema).toBeUndefined();
  });

  it('近远标记缺值明确拒绝，0与1合法而小数或越界不合法，不按英雄名推断', () => {
    const snapshot = currentHealthBranchesSample();
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const requirement of inspectSimulationSnapshot(snapshot).requirements) if (requirement.storedValue === undefined && requirement.attribute.attributeKey !== 'melee_attack') {
      inputs[requirement.side][requirement.attribute.attributeKey] = requirement.attribute.attributeKey === 'attack_speed_ratio' ? .7 : 0;
    }
    expect(() => assembleSimulation(snapshot, inputs, { source: 600, target: 500 })).toThrow(/attributeInputs.source.melee_attack/);
    for (const flag of [0, 1]) {
      const compiled = assembleSimulation(snapshot, { ...inputs, source: { ...inputs.source, melee_attack: flag } }, { source: 600, target: 500 });
      expect(compiled.compileRequest.combatants[0]!.attributes.melee_attack!.base).toBe(flag);
    }
    for (const flag of [-1, .5, 2]) expect(() => assembleSimulation(snapshot,
      { ...inputs, source: { ...inputs.source, melee_attack: flag } }, { source: 600, target: 500 })).toThrow(/违反属性类型或范围/);
  });
});

describe('配置驱动装备通用节点编译', () => {
  it.each(['SKILL', 'TARGET'] as const)('%s离散COUNTER与ICD保持真实状态范围、读取、写入及不同刷新策略', scope => {
    const snapshot = counterSample();
    const config = genericConfiguration(snapshot);
    for (const state of config.internalStates) state.scope = scope;
    const hits = config.internalStates[0]!;
    if (hits.stateType !== 'COUNTER') throw new Error('需要完整计数结构');
    hits.detail.durationValue = { kind: 'FIXED', value: 4000 };
    const root = rootProvider(assembleTriggeredEquipment(snapshot));
    expect(root.initialStateSchema!.hits).toEqual({ valueType: 'integer', defaultValue: 0, maxValue: 3,
      durationMs: 4000, refreshPolicy: 'refresh_on_write' });
    expect(root.initialStateSchema!.gate).toMatchObject({ stateKind: 'cooldown', defaultValue: 0, maxValue: 1,
      durationMs: 1001, refreshPolicy: 'start_on_first_write' });
    expect(root.initialStateSchema!.hits.stateKind).toBeUndefined();
    const operations = root.abilities!.find(row => row.abilityKey === 'on_hit')!.listenerSpec!.operations!;
    for (const operation of operations.filter(row => row.ref === 'hits' || row.ref === 'gate')) {
      expect(operation.types).toEqual([scope === 'TARGET' ? 'state_scope/provider_target' : 'state_scope/provider']);
    }
    const stateReads = reads(operations);
    expect(stateReads).toContain(scope === 'TARGET' ? 'provider.target_state.hits' : 'provider.state.hits');
    expect(stateReads).toContain(scope === 'TARGET' ? 'provider.target_state.gate' : 'provider.state.gate');
  });

  it.each([undefined, null, 0, 4000])('COUNTER保持期%s不猜默认值，无保持期不计时，正值刷新', duration => {
    const snapshot = counterSample();
    const state = genericConfiguration(snapshot).internalStates[0]!;
    if (state.stateType !== 'COUNTER') throw new Error('需要完整计数结构');
    if (duration !== undefined) state.detail.durationValue = duration === null ? null : { kind: 'FIXED', value: duration };
    expect(rootProvider(assembleTriggeredEquipment(snapshot)).initialStateSchema!.hits).toEqual({
      valueType: 'integer', defaultValue: 0, maxValue: 3, durationMs: duration ?? 0,
      ...(duration && duration > 0 ? { refreshPolicy: 'refresh_on_write' } : {})
    });
  });

  it.each([-1, .5, Infinity])('COUNTER非法期限%s拒绝，不能截断或封顶', duration => {
    const snapshot = counterSample();
    const state = genericConfiguration(snapshot).internalStates[0]!;
    if (state.stateType !== 'COUNTER') throw new Error('需要完整计数结构');
    state.detail.durationValue = { kind: 'FIXED', value: duration };
    expect(() => assembleTriggeredEquipment(snapshot)).toThrow(/durationValue.*常量|durationValue.*有限/);
  });

  it('COUNTER明确零上限仍输出离散声明，负数及小数写入不因封顶变合法', () => {
    const snapshot = counterSample();
    const config = genericConfiguration(snapshot);
    const state = config.internalStates[0]!;
    if (state.stateType !== 'COUNTER') throw new Error('需要完整计数结构');
    state.detail.maxValue = { kind: 'FIXED', value: 0 };
    expect(rootProvider(assembleTriggeredEquipment(snapshot)).initialStateSchema!.hits).toMatchObject({
      valueType: 'integer', defaultValue: 0, maxValue: 0
    });
    for (const value of [-1, .5]) {
      config.processes[0]!.stateOperations[0]!.value = { kind: 'FIXED', value };
      expect(() => assembleTriggeredEquipment(snapshot)).toThrow(/合法整数/);
    }
  });

  it('开始与攻击联动按配置独立注册，不重复产生主动过程', () => {
    const snapshot = genericSample();
    const config = genericConfiguration(snapshot);
    config.triggerRules[0]!.eventSource = { eventType: 'BASIC_ATTACK_START', detail: {} };
    config.triggerRules.push({ ...structuredClone(config.triggerRules[0]!), ruleKey: 'explicit_attack_link', sortOrder: 20,
      eventSource: { eventType: 'ATTACK_LINK_APPLIED', detail: { sourceSkillKey: null } } });
    syncSimulationSkillSources(snapshot);
    const root = rootProvider(assembleTriggeredEquipment(snapshot));
    expect(root.abilities!.map(row => row.listenerSpec!.eventMatcher.all)).toEqual([
      ['event/basic_attack_start', 'event/source_owner'], ['event/attack_link_applied', 'event/source_owner']
    ]);
    expect(root.processes).toBeUndefined();
    expect(root.abilities!.every(row => row.kind === 'passive_listener')).toBe(true);
  });

  it.each(['authored_blade', 'item_3124', 'item_3075', 'item_3068'])('异名%s同结构编译，不按装备名选择算法或拒绝', key => {
    const snapshot = genericSample(key);
    const config = genericConfiguration(snapshot);
    config.parameters[0]!.fixedValue = 27;
    snapshot.source.selectedEquipment[0]!.equipment.name = '任意作者名称';
    const assembled = assembleTriggeredEquipment(snapshot);
    expect(rootProvider(assembled).abilities![0]!.params).toEqual({ on_hit_damage: 27 });
    expect(rootProvider(assembled).abilities![0]!.listenerSpec!.operations).toHaveLength(1);
    expect(compileWithInputs(snapshot).compileRequest.sharedProviders!.some(provider => provider.abilities?.some(ability => ability.skillKey === config.skill.skillKey))).toBe(true);
  });

  it('多个启用关系完整编译在同一装备拥有方来源，规则和参数命名空间不碰撞', () => {
    const snapshot = genericSample();
    const first = genericConfiguration(snapshot);
    const second = JSON.parse(JSON.stringify(first).replaceAll(first.skill.skillKey, 'independent_second_passive')) as SkillConfiguration;
    snapshot.skillConfigurations.push(second);
    snapshot.source.selectedEquipment[0]!.attachedSkills.push({ ...snapshot.source.selectedEquipment[0]!.attachedSkills[0]!, skillKey: second.skill.skillKey, sortOrder: 20 });
    second.parameters[0]!.fixedValue = 23;
    syncSimulationSkillSources(snapshot);
    const assembled = assembleTriggeredEquipment(snapshot);
    const root = rootProvider(assembled);
    expect(assembled.mounts).toHaveLength(1);
    expect(root.abilities!.map(ability => ability.skillKey)).toEqual([first.skill.skillKey, second.skill.skillKey]);
    expect(new Set(root.abilities!.map(ability => ability.abilityKey)).size).toBe(2);
    expect(root.abilities!.map(ability => ability.params!.on_hit_damage)).toEqual([15, 23]);
    expect(compileWithInputs(snapshot).operationOrigins.filter(origin => assembled.selectedSkills.has(origin.skillKey))).toHaveLength(2);
  });

  it('删除必要规则仍拒绝，未挂接效果保留排除说明，事件替换仅激活新事件', () => {
    const deleted = genericSample();
    genericConfiguration(deleted).triggerRules = [];
    expect(() => assembleTriggeredEquipment(deleted)).toThrow(/完整效果或触发规则/);
    const unused = genericSample();
    genericConfiguration(unused).effects.push({ ...structuredClone(genericConfiguration(unused).effects[0]!), effectKey: 'unreferenced' });
    expect(assembleTriggeredEquipment(unused).coverage).toContainEqual(expect.objectContaining({
      authorPath: `skills.${genericConfiguration(unused).skill.skillKey}.effects.unreferenced`, note: expect.stringContaining('没有可达入口')
    }));
    const relinked = genericSample();
    genericConfiguration(relinked).triggerRules[0]!.eventSource = { eventType: 'HIT_LINK_APPLIED', detail: { sourceSkillKey: null } };
    expect(listener(relinked, 'HIT_LINK_APPLIED').listenerSpec!.eventMatcher.all).toEqual(['event/hit_link_applied', 'event/source_owner']);
    expect(rootProvider(assembleTriggeredEquipment(relinked)).abilities!.some(ability => ability.listenerSpec?.eventMatcher.all?.includes('event/basic_attack_hit'))).toBe(false);
  });

  it('来源COUNTER、ICD、叠层属性、过程时点与即时命中联动按作者先后编译', () => {
    const snapshot = counterSample();
    const assembled = assembleTriggeredEquipment(snapshot);
    const root = rootProvider(assembled);
    expect(root.initialStateSchema).toMatchObject({
      hits: { valueType: 'integer', defaultValue: 0, maxValue: 3 },
      gate: { valueType: 'number', defaultValue: 0, maxValue: 1, durationMs: 1001, refreshPolicy: 'start_on_first_write' },
      effect_stacking: { valueType: 'integer', defaultValue: 0, maxValue: 4, durationMs: 3000, refreshPolicy: 'refresh_on_write' }
    });
    const hit = root.abilities!.find(ability => ability.abilityKey === 'on_hit')!;
    expect(hit.listenerSpec!.operations!.map(operation => operation.operation)).toEqual([
      'state_change', 'state_change', 'damage', 'state_change', 'apply_hit_link', 'state_change', 'state_change'
    ]);
    const operations = hit.listenerSpec!.operations!;
    expect(operations[0]).toMatchObject({ ref: 'effect_stacking', valuePolicy: 'add', amount: { op: 'const', value: 1 } });
    expect(operations[1]).toMatchObject({ ref: 'hits', valuePolicy: 'add', amount: { op: 'const', value: 1 } });
    expect(operations[3]!.amount).toMatchObject({ op: 'min', args: [{ op: 'eq' }, { op: 'eq' }] });
    expect(operations[4]!.condition).toEqual(operations[5]!.condition);
    expect(operations[5]!.condition).toEqual(operations[6]!.condition);
    expect(root.modifiers![0]).toMatchObject({ target: 'self.attr.bonus_attack_speed_percent', valuePolicy: 'add',
      value: { op: 'mul', args: [{ op: 'const', value: .1 }, { op: 'read', path: 'provider.state.effect_stacking' }] } });
    expect(root.abilities!.find(ability => ability.abilityKey === 'on_extra')!.listenerSpec!.operations!.map(operation => operation.operation)).toEqual(['damage']);
    expect(root.processes).toBeUndefined();
    expect(assembled.operationOrigins.some(origin => origin.resultKey === 'contact' && origin.operationRef.includes('extra_contact'))).toBe(true);
  });

  it('命中联动只有apply_hit_link，不复制其它onhit；删除额外接线必须连同孤立结果处理', () => {
    const snapshot = genericSample();
    const config = genericConfiguration(snapshot);
    const result = config.effects[0]!.results[0]!;
    config.parameters = [];
    config.effects[0]!.results = [{ ...result, resultType: 'HIT_LINK_APPLICATION', detail: {},
      valueRule: { value: { kind: 'FIXED', value: 2 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null } }];
    const assembled = assembleTriggeredEquipment(snapshot);
    expect(rootProvider(assembled).abilities).toHaveLength(1);
    expect(rootProvider(assembled).abilities![0]!.listenerSpec!.operations).toEqual([{
      operation: 'apply_hit_link', target: 'target', ref: `skills.${config.skill.skillKey}.effects.on_hit_damage.results.on_hit_damage`, amount: { op: 'const', value: 2 }
    }]);
    expect(assembled.rules.vampRules).toBeUndefined();
    expect(assembled.operationOrigins).toHaveLength(1);
  });

  it('暂定满层后计数与失层后首次命中复位保存为显式作者接线，不向计数注入到期耦合', () => {
    const snapshot = configuredGhostSample();
    const assembled = assembleTriggeredEquipment(snapshot);
    const root = rootProvider(assembled);
    const full = root.abilities!.find(ability => ability.abilityKey === 'full_count')!;
    const reset = root.abilities!.find(ability => ability.abilityKey === 'not_full_reset')!;
    expect(root.initialStateSchema!.hits).toEqual({ valueType: 'integer', defaultValue: 0, maxValue: 3, durationMs: 0 });
    expect(root.initialStateSchema!.effect_stacking).toMatchObject({ durationMs: 3000, refreshPolicy: 'refresh_on_write' });
    expect(full.listenerSpec!.condition).toEqual({ op: 'gte', args: [{ op: 'read', path: 'provider.state.effect_stacking' }, { op: 'const', value: 4 }] });
    expect(reset.listenerSpec!.condition).toEqual({ op: 'lt', args: [{ op: 'read', path: 'provider.state.effect_stacking' }, { op: 'const', value: 4 }] });
    expect(full.listenerSpec!.operations!.map(operation => operation.operation)).toEqual(['state_change', 'state_change', 'apply_hit_link', 'state_change']);
    expect(full.listenerSpec!.operations![0]).toMatchObject({ ref: 'hits', valuePolicy: 'add', amount: { op: 'const', value: 1 } });
    expect(full.listenerSpec!.operations![1]!.amount).toEqual({ op: 'gte', args: [{ op: 'read', path: 'provider.state.hits' }, { op: 'const', value: 3 }] });
    expect(full.listenerSpec!.operations![2]!.condition).toEqual(full.listenerSpec!.operations![3]!.condition);
    expect(full.listenerSpec!.operations![3]).toMatchObject({ ref: 'hits', valuePolicy: 'set', amount: { op: 'const', value: 0 } });
    expect(reset.listenerSpec!.operations).toEqual([{ operation: 'state_change', target: 'self', ref: 'hits', valuePolicy: 'set',
      amount: { op: 'const', value: 0 }, types: ['state_scope/provider'] }]);
    expect(root.abilities!.find(ability => ability.abilityKey === 'linked_damage_only')!.listenerSpec!.operations!.map(operation => operation.operation)).toEqual(['damage']);
    expect(assembled.types.some(type => /natural_end|expired/.test(type.key))).toBe(false);
    expect(compileWithInputs(snapshot).operationOrigins.filter(origin => origin.skillKey === genericConfiguration(snapshot).skill.skillKey).map(origin => origin.resultKey)).toEqual(expect.arrayContaining(['speed', 'contact', 'on_hit_damage']));
  });

  it('未引用的上界公式保留完整可用库与非战斗说明覆盖，不错误替代实际每层属性', () => {
    const snapshot = configuredGhostSample();
    const config = genericConfiguration(snapshot);
    const maximum = addParameter(config, 'max_stacks', 4);
    config.effects.find(effect => effect.effectKey === 'stacking')!.lifecycle!.maxStacksValue = maximum;
    config.formulas.push({ gameId: 'lol', skillKey: config.skill.skillKey, formulaKey: 'max_attack_speed_bonus', name: '作者上界说明',
      description: null, sortOrder: 10, createdAt: '', updatedAt: '', expression: skillFormulaDefinition(config.skill.skillKey, { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
        { nodeType: 'PARAMETER', parameterKey: 'per_stack_speed' }, { nodeType: 'PARAMETER', parameterKey: 'max_stacks' }
      ] }) });
    const totalCount = addParameter(config, 'phantom_total_on_hit_count', 2);
    const normalCount = addParameter(config, 'normal_on_hit_count', 1);
    config.formulas.push({ ...config.formulas[0]!, formulaKey: 'phantom_extra_on_hit_count', expression: skillFormulaDefinition(config.skill.skillKey, { nodeType: 'OPERATION', operation: 'SUBTRACT', operands: [
      { nodeType: 'PARAMETER', parameterKey: totalCount.parameterKey }, { nodeType: 'PARAMETER', parameterKey: normalCount.parameterKey }
    ] }) });
    config.effects.find(effect => effect.effectKey === 'extra_contact')!.results[0]!.valueRule!.value = { kind: 'FORMULA', formulaKey: 'phantom_extra_on_hit_count' };
    const assembled = assembleTriggeredEquipment(snapshot);
    const root = rootProvider(assembled);
    expect(root.modifiers![0]!.value.args![0]).toEqual({ op: 'const', value: .1 });
    const upper = assembled.formulas.find(formula => formula.key.endsWith('/max_attack_speed_bonus'))!;
    expect(upper.expression).toEqual(config.formulas.find(row => row.formulaKey === 'max_attack_speed_bonus')!.expression);
    expect(assembled.coverage.find(row => row.authorPath.endsWith('.formulas.max_attack_speed_bonus.expression'))!.note).toMatch(/非战斗引用/);
    const link = root.abilities!.find(ability => ability.abilityKey === 'full_count')!.listenerSpec!.operations!.find(operation => operation.operation === 'apply_hit_link')!;
    expect(link.amount).toEqual({ op: 'ref', ref: 'source_authored_blade_passive/levels/1/1/phantom_extra_on_hit_count' });
    const linkCount = assembled.formulas.find(formula => formula.key === link.amount!.ref)!;
    expect(linkCount.expression).toEqual(config.formulas.find(row => row.formulaKey === 'phantom_extra_on_hit_count')!.expression);
    expect(linkCount.parameters).toEqual(expect.arrayContaining([{ parameterKey: 'phantom_total_on_hit_count', valueMode: 'FIXED', valueType: 'DECIMAL', value: 2 }, { parameterKey: 'normal_on_hit_count', valueMode: 'FIXED', valueType: 'DECIMAL', value: 1 }]));
  });

  it('全部可用固定参数完整校验并保留；显示速率参数不自动生成任何周期', () => {
    const snapshot = genericSample();
    const config = genericConfiguration(snapshot);
    addParameter(config, 'display_ticks_per_second', 1);
    const assembled = assembleTriggeredEquipment(snapshot);
    expect(rootProvider(assembled).abilities![0]!.params).toEqual({ on_hit_damage: 15, display_ticks_per_second: 1 });
    expect(assembled.coverage.find(row => row.authorPath.endsWith('.parameters.display_ticks_per_second'))!.note).toMatch(/非战斗引用/);
    expect(assembled.providers.every(provider => provider.abilities!.every(ability => !ability.tickSpec))).toBe(true);
    config.parameters.find(parameter => parameter.parameterKey === 'display_ticks_per_second')!.fixedValue = Number.NaN;
    expect(() => assembleTriggeredEquipment(snapshot)).toThrow(/有限数值/);
  });

  it('自然到期规则无真实原生时点时整体拒绝，不用计数状态期限猜测复位', () => {
    const snapshot = configuredGhostSample();
    const config = genericConfiguration(snapshot);
    config.triggerRules.push(ruleFor(config, 'unsupported_expiry', { eventType: 'LIFECYCLE_MOMENT', detail: {
      effectKey: 'stacking', moment: 'NATURAL_END' } }, [startAction('reset_counter')], 60));
    expect(() => assembleTriggeredEquipment(snapshot)).toThrow(/unsupported_expiry.*未接入的作者规则或时点/);
  });

  it('额外命中事件值读取真实联动编号，同次使用组只用合法标识且生成长度受限', () => {
    const snapshot = genericSample();
    const config = genericConfiguration(snapshot);
    config.triggerRules[0]!.eventSource = { eventType: 'HIT_LINK_APPLIED', detail: { sourceSkillKey: null } };
    config.triggerRules[0]!.conditionGroups = oneGroup([{ conditionKey: 'first_link', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 10,
      detail: { eventValueKey: 'LINK_INDEX', comparator: 'EQ', comparisonValue: { kind: 'FIXED', value: 1 } } }]);
    config.triggerRules[0]!.oncePerUse = { groupKey: 'explicit_link', scope: 'SKILL' };
    const specification = listener(snapshot, 'HIT_LINK_APPLIED').listenerSpec!;
    expect(specification.condition).toEqual({ op: 'eq', args: [{ op: 'read', path: 'event.link.index' }, { op: 'const', value: 1 }] });
    expect(specification.oncePerUse!.groupKey).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    const second = JSON.parse(JSON.stringify(config).replaceAll(config.skill.skillKey, 'second_passive')) as SkillConfiguration;
    config.triggerRules[0]!.oncePerUse!.groupKey = 'g'.repeat(64);
    snapshot.skillConfigurations.push(second);
    snapshot.source.selectedEquipment[0]!.attachedSkills.push({ ...snapshot.source.selectedEquipment[0]!.attachedSkills[0]!, skillKey: second.skill.skillKey, sortOrder: 20 });
    syncSimulationSkillSources(snapshot);
    expect(() => assembleTriggeredEquipment(snapshot)).toThrow(/oncePerUse.groupKey.*稳定标识/);
  });

  it('事件来源属性条件保留真实事件冻结读取，属性依赖映射至原攻击者', () => {
    const snapshot = genericSample('authored_receiver', false);
    const config = genericConfiguration(snapshot);
    config.triggerRules[0]!.eventSource = { eventType: 'BASIC_ATTACK_RECEIVED', detail: {} };
    config.triggerRules[0]!.actions[0]!.targetContext = 'EVENT_SOURCE';
    config.triggerRules[0]!.conditionGroups = oneGroup([{ conditionKey: 'original_attacker_hp', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 10,
      detail: { subject: 'EVENT_SOURCE', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO', comparator: 'GT',
        comparisonValue: { kind: 'FIXED', value: .5 } } }]);
    const assembled = assembleTriggeredEquipment(snapshot);
    expect(reads(rootProvider(assembled, 'target').abilities![0]!.listenerSpec!.condition)).toEqual(['event.source.attr.hp.current', 'event.source.attr.hp.max']);
    expect(assembled.required.source.has('hp')).toBe(true);
    expect(assembled.required.target.has('hp')).toBe(false);
  });

  it('条件组内AND、组间OR保留；来源状态条件由原生判断而非前端求战斗结果', () => {
    const snapshot = counterSample();
    const config = genericConfiguration(snapshot);
    config.triggerRules[0]!.conditionGroups = [
      { groupKey: 'first', name: '第一组', sortOrder: 10, conditions: [internalCondition(config, 'hits', 2), internalCondition(config, 'gate', 0, 'REMAINING_MS')] },
      { groupKey: 'second', name: '第二组', sortOrder: 20, conditions: [internalCondition(config, 'hits', 3)] }
    ];
    expect(listener(snapshot).listenerSpec!.condition).toMatchObject({ op: 'max', args: [
      { op: 'min', args: [{ op: 'eq', args: [{ op: 'read', path: 'provider.state.hits' }, { op: 'const', value: 2 }] },
        { op: 'eq', args: [{ op: 'read', path: 'provider.state.gate' }, { op: 'const', value: 0 }] }] },
      { op: 'eq', args: [{ op: 'read', path: 'provider.state.hits' }, { op: 'const', value: 3 }] }
    ] });
  });

  it.each(['BASIC_ATTACK_HIT', 'HIT_LINK_APPLIED', 'DAMAGE_TAKEN', 'BASIC_ATTACK_RECEIVED'] as const)('真实%s同次使用额度完整进入通用账本', event => {
    const snapshot = genericSample();
    const config = genericConfiguration(snapshot);
    config.triggerRules[0]!.eventSource = event === 'DAMAGE_TAKEN' ? { eventType: event,
      detail: { sourceSkillKey: null, damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY' } }
      : event === 'HIT_LINK_APPLIED' ? { eventType: event, detail: { sourceSkillKey: null } } : { eventType: event, detail: {} };
    config.triggerRules[0]!.oncePerUse = { groupKey: 'qualified_use', scope: 'TARGET' };
    if (event === 'DAMAGE_TAKEN' || event === 'BASIC_ATTACK_RECEIVED') config.triggerRules[0]!.actions[0]!.targetContext = 'EVENT_SOURCE';
    const assembled = assembleTriggeredEquipment(snapshot);
    const specification = rootProvider(assembled).abilities![0]!.listenerSpec!;
    expect(specification.oncePerUse).toEqual({ groupKey: 'qualified_use', scope: 'provider_target' });
    expect(specification.eventMatcher.all).toEqual([`event/${event.toLowerCase()}`,
      event === 'DAMAGE_TAKEN' || event === 'BASIC_ATTACK_RECEIVED' ? 'event/target_owner' : 'event/source_owner']);
  });

  it('受击逐笔监听保留真实伤害特征和来源技能，EVENT_SOURCE映射到真实对手', () => {
    const snapshot = genericSample('receiver_traits', false);
    const config = genericConfiguration(snapshot);
    config.triggerRules[0]!.eventSource = { eventType: 'DAMAGE_TAKEN', detail: { sourceSkillKey: snapshot.selection.basicAttackSkillKey,
      damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT' } };
    config.triggerRules[0]!.actions[0]!.targetContext = 'EVENT_SOURCE';
    const root = rootProvider(assembleTriggeredEquipment(snapshot), 'target');
    expect(root.abilities![0]!.listenerSpec!.eventMatcher.all).toEqual(['event/damage_taken', 'event/target_owner', 'physics',
      'damage_trait/delivery_basic_attack', 'damage_trait/origin_direct', `ability/skill/${snapshot.selection.basicAttackSkillKey}`]);
    expect(root.abilities![0]!.listenerSpec!.operations![0]!.target).toBe('target');
    const request = compileWithInputs(snapshot).compileRequest;
    expect(request.sharedProviders![0]!.abilities!.every(ability => ability.types!.includes(`ability/skill/${snapshot.selection.basicAttackSkillKey}`))).toBe(true);
    expect(request.typeCatalog.types).toContainEqual({ key: `ability/skill/${snapshot.selection.basicAttackSkillKey}`, domain: 'ability' });
  });

  it('装备声明另一伤害类型时，五阶段防御与作者覆盖重定位到主请求的真实索引', () => {
    const snapshot = genericSample();
    const extraType = structuredClone(snapshot.catalogs.damageTypes[0]!);
    extraType.type.damageTypeKey = 'independent_magic';
    extraType.formula.damageTypeKey = 'independent_magic';
    snapshot.catalogs.damageTypes.push(extraType);
    (genericConfiguration(snapshot).effects[0]!.results[0] as SkillEffectDamageResult).detail.damageTypeKey = 'independent_magic';
    const compiled = compileWithInputs(snapshot);
    expect(compiled.compileRequest.rules.damageTypeFormulas!.map(row => row.damageType)).toEqual(['physics', 'independent_magic']);
    const stages = compiled.coverage.filter(row => row.authorPath === 'damageTypes.independent_magic.formula');
    expect(stages).toHaveLength(1);
    expect(stages.every(row => row.compiledPath === 'rules.damageTypeFormulas[1].formula')).toBe(true);
    expect(compiled.coverage.filter(row => row.authorPath === 'damageTypes.physics.formula')
      .every(row => row.compiledPath === 'rules.damageTypeFormulas[0].formula')).toBe(true);
  });

  it('结果前受击反伤及英雄减疗分开，真实减疗取强目录、原作者ref和同装备稳定来源保留', () => {
    const snapshot = receivedSample();
    const assembled = assembleTriggeredEquipment(snapshot);
    const root = rootProvider(assembled, 'target');
    expect(root.abilities!.map(ability => ability.listenerSpec!.eventMatcher.all)).toEqual([
      ['event/basic_attack_received', 'event/target_owner'], ['event/basic_attack_received', 'event/target_owner']
    ]);
    const reflect = root.abilities![0]!.listenerSpec!.operations![0]!;
    expect(reflect).toMatchObject({ operation: 'damage', target: 'target', vampQualification: 'RESOLVED',
      types: ['damage_trait/delivery_basic_attack', 'damage_trait/origin_reflected'] });
    expect(reflect.vampOverrides).toEqual([]);
    const apply = root.abilities![1]!.listenerSpec!.operations![0]!;
    const definition = assembled.providers.find(provider => provider.providerKey === apply.providerDefinitionRef)!;
    expect(apply).toMatchObject({ operation: 'apply_provider', target: 'target',
      ref: `skills.${genericConfiguration(snapshot).skill.skillKey}.effects.reduction.results.reduce_received_healing` });
    expect(apply.providerRef).toBeUndefined();
    expect(definition).toMatchObject({ stableId: root.stableId, kind: 'status', lifecycle: {
      durationMs: { op: 'const', value: 3000 }, instanceScope: 'source_target', maxStacks: 1, refreshPolicy: 'replace'
    }, modifiers: [{ command: 'heal', healDirection: 'RECEIVED', healCategory: 'ANY', healGroupKey: 'author_reduction',
      healGroupCalculationMode: 'ratio_max', valuePolicy: 'add_percent', value: { op: 'const', value: -.4 } }] });
    expect(assembled.operationOrigins.find(origin => origin.operationRef === apply.ref)!.compiledPaths).toHaveLength(1);
    expect(root.abilities![1]!.listenerSpec!.condition).toEqual({ op: 'const', value: 1 });
    expect(compileWithInputs(snapshot).operationOrigins.find(origin => origin.operationRef === apply.ref)!.compiledPaths[0]).toMatch(/^sharedProviders\[\d+\]/);
  });

  it('英雄条件使用真实英雄选择合同，身份错配、减疗目录缺失或禁用和取强方式改变时拒绝', () => {
    const noIdentity = receivedSample();
    noIdentity.source.character.characterKey = 'unselected_character';
    expect(() => assembleTriggeredEquipment(noIdentity)).toThrow(/原始绑定不一致/);
    for (const mutate of [
      (snapshot: SimulationSnapshot) => { snapshot.catalogs.modifierZones = []; },
      (snapshot: SimulationSnapshot) => { snapshot.catalogs.modifierZones[0]!.status = 'DISABLED'; },
      (snapshot: SimulationSnapshot) => { snapshot.catalogs.modifierZones[0]!.calculationMode = 'RATIO_ADD'; }
    ]) {
      const snapshot = receivedSample();
      mutate(snapshot);
      expect(() => assembleTriggeredEquipment(snapshot)).toThrow(/真实目录|比例减少取强/);
    }
  });

  it('固定作者周期必须有始终常驻生命周期、无条件初始化和明确首跳；金额仍由参数公式翻译', () => {
    const snapshot = periodicSample(true);
    const assembled = assembleTriggeredEquipment(snapshot);
    const root = rootProvider(assembled);
    expect(root.abilities).toHaveLength(1);
    expect(root.abilities![0]).toMatchObject({ kind: 'tick', skillKey: genericConfiguration(snapshot).skill.skillKey,
      tickSpec: { intervalMs: 1000, startDelayMs: 1000, onTick: [{ operation: 'damage', target: 'target' }] } });
    expect(root.lifecycle).toBeUndefined();
    expect(root.abilities![0]!.params).toMatchObject({ on_hit_damage: 20, health_ratio: .015 });
    const formula = assembled.formulas.find(formula => formula.key.endsWith('/scaled_periodic_damage'))!;
    expect(reads(formula.expression)).toEqual(expect.arrayContaining(['parameter.' + formula.skillKey + '.on_hit_damage', 'parameter.' + formula.skillKey + '.health_ratio', 'source.attr.hp.BONUS']));
    expect(assembled.operationOrigins[0]!.providerDefinitionRef).toBeUndefined();
    expect(assembled.operationOrigins[0]!.abilityRef).toContain(assembled.mounts[0]!.providerRef);
  });

  it('有期SOURCE周期由self apply激活，定义不伪造初始挂载；刷新同定义保留相位及动态作者来源', () => {
    const snapshot = periodicSample();
    const assembled = assembleTriggeredEquipment(snapshot);
    const root = rootProvider(assembled);
    const temporary = assembled.providers.find(provider => provider.kind === 'status')!;
    expect(root.abilities!.map(ability => ability.listenerSpec!.eventMatcher.all)).toEqual([
      ['event/damage_instance', 'event/source_owner', 'damage_trait/delivery_basic_attack', 'damage_trait/origin_direct', `ability/skill/${snapshot.selection.basicAttackSkillKey}`],
      ['event/damage_taken', 'event/target_owner', 'damage_trait/delivery_basic_attack', 'damage_trait/origin_direct', `ability/skill/${snapshot.selection.basicAttackSkillKey}`]
    ]);
    expect(root.abilities!.every(ability => ability.listenerSpec!.operations![0]!.operation === 'apply_provider'
      && ability.listenerSpec!.operations![0]!.target === 'self' && ability.listenerSpec!.operations![0]!.providerDefinitionRef === temporary.providerKey)).toBe(true);
    expect(temporary).toMatchObject({ stableId: root.stableId, kind: 'status', lifecycle: { durationMs: { op: 'const', value: 3000 },
      instanceScope: 'source_target', maxStacks: 1, refreshPolicy: 'replace' }, abilities: [{ abilityKey: 'tick',
      skillKey: genericConfiguration(snapshot).skill.skillKey, tickSpec: { startDelayMs: 1000, intervalMs: 1000 } }] });
    expect(assembled.mounts).toHaveLength(1);
    expect(assembled.mounts.some(mount => mount.definitionRef === temporary.providerKey)).toBe(false);
    const origin = assembled.operationOrigins[0]!;
    expect(origin.providerDefinitionRef).toBe(temporary.providerKey);
    expect(origin.abilityRef).toBe(`source.provider[${temporary.providerKey}].ability[tick]`);
    expect(origin.compiledPaths).toEqual([`sharedProviders.${temporary.providerKey}.abilities[0].tickSpec.onTick[0]`]);
    expect(temporary.abilities![0]!.types).toContain(`ability/skill/${genericConfiguration(snapshot).skill.skillKey}`);
    expect(temporary.abilities![0]!.types).not.toContain(`ability/skill/${snapshot.selection.basicAttackSkillKey}`);
    const compiled = compileWithInputs(snapshot);
    expect(compiled.compileRequest.combatants.every(combatant => combatant.providers.every(mount => mount.definitionRef !== temporary.providerKey))).toBe(true);
    expect(compiled.operationOrigins.find(origin => origin.providerDefinitionRef === temporary.providerKey)!.compiledPaths[0]).toMatch(/^sharedProviders\[\d+\]\.abilities\[0\]\.tickSpec.onTick\[0\]$/);
    expect(SIMULATION_ADAPTER_VERSION).toBe('v45-marked-raw-damage');
  });

  it('异名有期周期、改参改首跳只读取作者配置，3秒参数不自动成为常驻周期', () => {
    const snapshot = periodicSample(false, 'renamed_periodic');
    const config = genericConfiguration(snapshot);
    config.parameters.find(parameter => parameter.parameterKey === 'active_window')!.fixedValue = 4500;
    config.effects[0]!.lifecycle!.periodicIntervalValue = { kind: 'FIXED', value: 700 };
    const temporary = assembleTriggeredEquipment(snapshot).providers.find(provider => provider.kind === 'status')!;
    expect(temporary.lifecycle!.durationMs).toEqual({ op: 'const', value: 4500 });
    expect(temporary.abilities![0]!.tickSpec!.startDelayMs).toBe(700);
    expect(temporary.abilities![0]!.tickSpec!.intervalMs).toBe(700);
    config.effects[0]!.lifecycle!.firstPeriodicExecution = null;
    expect(() => assembleTriggeredEquipment(snapshot)).toThrow(/首跳AFTER_INTERVAL/);
  });

  it.each([
    ['未知首跳', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.lifecycle!.firstPeriodicExecution = null; }],
    ['即时首跳', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.lifecycle!.firstPeriodicExecution = 'IMMEDIATE'; }],
    ['缺周期依据', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.lifecycle!.periodicIntervalValue = null; }],
    ['动态期限', (snapshot: SimulationSnapshot) => { Object.assign(genericConfiguration(snapshot).parameters.find(parameter => parameter.parameterKey === 'active_window')!, { valueMode: 'RUNTIME_INPUT', fixedValue: null }); }],
    ['独立层刷新', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.lifecycle!.reapplicationDurationMode = 'INDEPENDENT'; }],
    ['目标范围', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.lifecycle!.instanceScope = 'SOURCE_TARGET'; }],
    ['周期夹带持续层值合并', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.results[0]!.lifecycleBehavior!.stackValueMode = 'SHARED'; }],
    ['周期夹带重施数值方式', (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).effects[0]!.results[0]!.lifecycleBehavior!.reapplicationValueMode = 'REPLACE'; }],
    ['未核定吸血', (snapshot: SimulationSnapshot) => { (genericConfiguration(snapshot).effects[0]!.results[0] as SkillEffectDamageResult).detail.vampQualification = 'UNRESOLVED'; }]
  ])('有期周期%s整件拒绝，不伪造延迟或默认值', (_label, mutate) => {
    const snapshot = periodicSample();
    (mutate as (snapshot: SimulationSnapshot) => void)(snapshot);
    const before = structuredClone(snapshot);
    expect(() => assembleTriggeredEquipment(snapshot)).toThrow();
    expect(snapshot).toEqual(before);
  });

  it('不能把延迟或有冷却过程展开成即时，循环、时点缺失及不明确排序均拒绝', () => {
    for (const mutate of [
      (snapshot: SimulationSnapshot) => { Object.assign(genericConfiguration(snapshot).processes[0]!.steps[0]!, { stepType: 'DELAY', detail: { delayValue: { kind: 'FIXED', value: 0 } } }); },
      (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).processes[0]!.cooldown = { durationValue: { kind: 'FIXED', value: 1 }, startMoment: moment('PROCESS_START') }; },
      (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).processes[0]!.effectBindings[0]!.moment = moment('STEP_EXECUTION', 'missing'); },
      (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).processes[0]!.effectBindings[0]!.sortOrder = 10; },
      (snapshot: SimulationSnapshot) => { genericConfiguration(snapshot).triggerRules.find(rule => rule.ruleKey === 'on_count')!.actions = [startAction('advance')]; }
    ]) {
      const snapshot = counterSample();
      mutate(snapshot);
      expect(() => assembleTriggeredEquipment(snapshot)).toThrow(/IMMEDIATE|冷却|时点|排序|循环/);
    }
  });

  it('完整SOURCE叠层及生命周期条件不用装备名；内部冷却不能把大于零阈值当毫秒', () => {
    const snapshot = counterSample();
    const config = genericConfiguration(snapshot);
    config.triggerRules[0]!.conditionGroups = oneGroup([{ conditionKey: 'full', conditionType: 'LIFECYCLE_CHECK', sortOrder: 10,
      detail: { effectSkillKey: config.skill.skillKey, effectKey: 'stacking', subject: null, checkKind: 'STACKS_COMPARE',
        comparator: 'GTE', comparisonValue: { kind: 'FIXED', value: 4 } } }]);
    expect(listener(snapshot).listenerSpec!.condition).toMatchObject({ op: 'gte', args: [
      { op: 'read', path: 'provider.state.effect_stacking' }, { op: 'const', value: 4 }
    ] });
    const condition = genericConfiguration(snapshot).triggerRules.find(rule => rule.ruleKey === 'on_count')!.conditionGroups[0]!.conditions[1]!;
    if (condition.conditionType === 'INTERNAL_STATE_CHECK' && condition.detail.valueKind === 'REMAINING_MS') condition.detail.comparisonValue = { kind: 'FIXED', value: 100 };
    expect(() => assembleTriggeredEquipment(snapshot)).toThrow(/不把活动标记当毫秒/);
  });

  it('重复装配只读且动态定义、命名空间和作者覆盖确定，未登记新装备算法分支', () => {
    const snapshot = periodicSample();
    const before = structuredClone(snapshot);
    const first = assembleTriggeredEquipment(snapshot);
    const second = assembleTriggeredEquipment(snapshot);
    expect(first).toEqual(second);
    expect(snapshot).toEqual(before);
    first.providers.find(provider => provider.kind === 'status')!.abilities![0]!.params!.on_hit_damage = 999;
    expect(snapshot).toEqual(before);
  });
});

const assembleSimulation = (...args: Parameters<typeof raw_assembleSimulation>): ReturnType<typeof raw_assembleSimulation> => { approveSnapshotFixture(args[0]); return raw_assembleSimulation(...args); };
const inspectSimulationSnapshot = (...args: Parameters<typeof raw_inspectSimulationSnapshot>): ReturnType<typeof raw_inspectSimulationSnapshot> => { approveSnapshotFixture(args[0]); return raw_inspectSimulationSnapshot(...args); };

const assembleTriggeredEquipment = (...args: Parameters<typeof raw_assembleTriggeredEquipment>): ReturnType<typeof raw_assembleTriggeredEquipment> => { approveSnapshotFixture(args[0]); return raw_assembleTriggeredEquipment(...args); };
