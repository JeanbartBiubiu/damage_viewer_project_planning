import { describe, expect, it } from 'vitest';
import { adaptHitProgram, provenSkillUseFact, skillHitFact, unknownSkillUseFact, withHitProgram, type AuthoredHitProgram } from './hitAdapter';
import { adaptPersistentResult } from './persistentResultAdapter';
import type { CompileRequest } from '../types/genericEngine';
import { fixedValue, parameterValue } from '../types/numericValue';
import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { SkillParameter } from '../types/skillParameter';

function lifecycle(scope: 'SOURCE' | 'SOURCE_TARGET' = 'SOURCE_TARGET', duration = 1250) {
  return {
    durationValue: fixedValue(duration), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
    instanceScope: scope, reapplicationStackMode: 'KEEP' as const, reapplicationDurationMode: 'REFRESH_ALL' as const,
    expiryMode: 'ALL_AT_ONCE' as const, periodicIntervalValue: null, firstPeriodicExecution: null
  };
}

function damageResult(scope: SkillEffectResult['spellShieldBlockScope'] = 'SKILL'): SkillEffectResult {
  return {
    resultKey: 'damage', name: '物理伤害', resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 10,
    spellShieldBlockScope: scope, lifecycleBehavior: null,
    valueRule: { value: fixedValue(100), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: {
      damageTypeKey: 'physics', deliveryKind: 'SKILL', originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: []
    }
  };
}

function slowResult(scope: SkillEffectResult['spellShieldBlockScope'] = 'RESULT'): SkillEffectResult {
  return {
    resultKey: 'slow', name: '减速', resultType: 'STATUS_OPERATION', target: 'TARGET', description: null, sortOrder: 10,
    spellShieldBlockScope: scope,
    valueRule: { value: parameterValue('slow_percent_points'), fixedMultiplier: 0.01, fixedMinValue: 0, fixedMaxValue: 1 },
    detail: { statusKey: 'movement_slow', operation: 'APPLY' },
    lifecycleBehavior: {
      moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
      reapplicationValueMode: 'REPLACE', periodicExecutionMode: null
    }
  };
}

function stunResult(): SkillEffectResult {
  return {
    resultKey: 'stun', name: '眩晕', resultType: 'STATUS_OPERATION', target: 'TARGET', description: null, sortOrder: 20,
    spellShieldBlockScope: 'RESULT', valueRule: null, detail: { statusKey: 'stun_q', operation: 'APPLY' },
    lifecycleBehavior: { moment: 'INSTANT', valueReadMode: null, stackValueMode: null, reapplicationValueMode: null, periodicExecutionMode: null }
  };
}

function nullBuff(): SkillEffectResult {
  return {
    resultKey: 'buff', name: '来源加攻', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description: null, sortOrder: 30,
    spellShieldBlockScope: null,
    valueRule: { value: fixedValue(3), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
    detail: { attributeKey: 'attack_damage', operation: 'INCREASE', modifierZoneKey: null },
    lifecycleBehavior: null
  };
}

function effect(effectKey: string, results: SkillEffectResult[], extra: Partial<SkillEffect> = {}): SkillEffect {
  return {
    gameId: 'lol', skillKey: 'urgot_q', effectKey, name: effectKey, description: null, sortOrder: 0,
    lifecycle: extra.lifecycle ?? null, results, createdAt: '', updatedAt: '', ...extra
  };
}

function execute(ruleKey: string, effectKey: string, sortOrder: number, groups: SkillTriggerRuleDetail['conditionGroups'] = []): SkillTriggerRuleDetail {
  return {
    ruleKey, name: ruleKey, description: null, sortOrder,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null, useKind: null } },
    conditionGroups: groups,
    actions: [{
      actionKey: `do_${effectKey}`, name: effectKey, actionType: 'EXECUTE_EFFECT', sortOrder: 10,
      targetContext: 'CURRENT_TARGET', detail: { effectKey }, runtimeInputBindings: [], resultModifiers: []
    }],
    perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
  };
}

function championEnemy(notBlocked = false, extra: SkillTriggerRuleDetail['conditionGroups'][number]['conditions'] = []) {
  const conditions = [
    { conditionKey: 'champion_target', conditionType: 'TARGET_CATEGORY_CHECK' as const, sortOrder: 10, detail: { categories: ['CHAMPION' as const] } },
    { conditionKey: 'enemy_target', conditionType: 'SKILL_HIT_TARGET_IS_ENEMY' as const, sortOrder: 20, detail: {} },
    ...(notBlocked ? [{
      conditionKey: 'not_spell_shield_blocked', conditionType: 'EVENT_VALUE_COMPARE' as const, sortOrder: 30,
      detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED' as const, comparator: 'EQ' as const, comparisonValue: fixedValue(0) }
    }] : []),
    ...extra
  ];
  return [{ groupKey: 'eligible', name: 'eligible', sortOrder: 10, conditions }];
}

const slowParam: SkillParameter = {
  gameId: 'lol', skillKey: 'urgot_q', parameterKey: 'slow_percent_points', name: '减速', valueType: 'DECIMAL',
  valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { '1': 45 }, description: null, sortOrder: 0, createdAt: '', updatedAt: ''
};

function program(patch: Partial<AuthoredHitProgram> = {}): AuthoredHitProgram {
  return {
    gameId: 'lol', skillKey: 'urgot_q', skillLevel: 1, characterLevel: 1,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
    statuses: [
      { statusKey: 'movement_slow', statusKind: 'MOVEMENT_SLOW', status: 'ENABLED' },
      { statusKey: 'stun_q', statusKind: 'STUN', status: 'ENABLED' }
    ],
    modifierZones: [],
    skillCategoryKeys: ['common'],
    vampRules: [{ vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1, deliveryKinds: ['SKILL'], originKinds: ['DIRECT'], skillCategoryKeys: ['common'] }],
    parameters: [slowParam],
    effects: [
      effect('primary_hit', [damageResult()]),
      effect('corrosive_charge_slow', [slowResult()], { lifecycle: lifecycle() }),
      effect('control', [stunResult()], { lifecycle: lifecycle() }),
      effect('self_buff', [nullBuff()])
    ],
    rules: [
      execute('actual_hit', 'primary_hit', 10, championEnemy()),
      execute('apply_slow_on_unblocked_hit', 'corrosive_charge_slow', 30, championEnemy(true))
    ],
    ...patch
  };
}

function request(): CompileRequest {
  const slot = { base: 100, current: 100, max: 200, resolved: 100 };
  return {
    schemaVersion: 'generic-p0', schemaHash: 'schema.p5', rulesHash: 'before',
    typeCatalog: { types: [{ key: 'damage/physical', domain: 'damage' }], relations: [] }, rules: {},
    combatants: (['source', 'target'] as const).map((key) => ({
      key, resources: {}, providers: [{ providerRef: 'champion', definitionRef: 'champion' }],
      attributes: { hp: { ...slot }, attack_damage: { ...slot }, armor: { base: 0, current: 0, max: 0, resolved: 0 }, omnivamp_percent: { base: 0.2, current: 0.2, max: 1, resolved: 0.2 } }
    })),
    sharedProviders: [{
      providerKey: 'champion', stableId: 'champion', kind: 'champion',
      abilities: [{ abilityKey: 'skill_hit', kind: 'active', operations: [] }]
    }]
  };
}

describe('有界命中适配', () => {
  it.each([['physics', 'damage/physical'], ['magic', 'damage/magic'], ['real', 'damage/true']])('管理伤害键%s转换为原生%s且不改作者对象', (key, runtimeType) => {
    const authored = program();
    for (const effect of authored.effects) for (const result of effect.results) {
      if (result.resultType === 'DAMAGE') result.detail.damageTypeKey = key;
    }
    const before = structuredClone(authored);
    const adapted = adaptHitProgram(authored);
    expect(adapted.typeEntries).toContainEqual({ key: runtimeType, domain: 'damage' });
    expect(adapted.skillHit.candidates[0]?.operations[0]).toMatchObject({ damageType: runtimeType });
    expect(authored).toEqual(before);
  });

  it('未知管理伤害键在原字段路径拒绝，不透传给原生引擎', () => {
    const authored = program();
    for (const effect of authored.effects) for (const result of effect.results) {
      if (result.resultType === 'DAMAGE') result.detail.damageTypeKey = 'heat';
    }
    expect(() => adaptHitProgram(authored)).toThrow(/damageTypeKey/);
  });

  it('候选按规则/动作/结果 sortOrder 稳定排列，各规则只保留自己的命中条件', () => {
    const adapted = adaptHitProgram(program());
    expect(adapted.skillHit.candidates.map((row) => row.candidateKey)).toEqual([
      'actual_hit:do_primary_hit:damage',
      'apply_slow_on_unblocked_hit:do_corrosive_charge_slow:slow'
    ]);
    expect(adapted.skillHit.candidates[0]?.spellShieldBlockScope).toBe('SKILL');
    expect(adapted.skillHit.candidates[0]?.eventValueConditions).toBeUndefined();
    expect(adapted.skillHit.candidates[1]?.spellShieldBlockScope).toBe('RESULT');
    expect(adapted.skillHit.candidates[1]?.eventValueConditions).toEqual([
      { key: 'blocked', comparator: 'eq', value: { op: 'const', value: 0 } }
    ]);
    expect(adapted.skillHit.candidates[1]?.operations[0]).toMatchObject({
      operation: 'apply_provider', target: 'target'
    });
    expect(adapted.providers[0]?.statusContributions?.[0]).toMatchObject({
      statusKey: 'movement_slow', statusKind: 'movement_slow'
    });
    expect(adapted.skillHit.candidates[0]?.operations[0]?.vampQualification).toBe('RESOLVED');
    expect(adapted.vampRules).toHaveLength(1);
    expect(adapted.abilityTypes).toEqual(['ability/common']);
  });

  it('OR组提取公共命中值，剩余条件编成组内min组间max，全为1时可省略', () => {
    const groups = [
      {
        groupKey: 'a', name: 'a', sortOrder: 10,
        conditions: [
          { conditionKey: 'blocked', conditionType: 'EVENT_VALUE_COMPARE' as const, sortOrder: 10,
            detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED' as const, comparator: 'EQ' as const, comparisonValue: fixedValue(0) } },
          { conditionKey: 'minion', conditionType: 'TARGET_CATEGORY_CHECK' as const, sortOrder: 20, detail: { categories: ['MINION' as const] } }
        ]
      },
      {
        groupKey: 'b', name: 'b', sortOrder: 20,
        conditions: [
          { conditionKey: 'blocked', conditionType: 'EVENT_VALUE_COMPARE' as const, sortOrder: 10,
            detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED' as const, comparator: 'EQ' as const, comparisonValue: fixedValue(0) } },
          { conditionKey: 'enemy', conditionType: 'SKILL_HIT_TARGET_IS_ENEMY' as const, sortOrder: 20, detail: {} }
        ]
      }
    ];
    const adapted = adaptHitProgram(program({
      rules: [execute('actual_hit', 'primary_hit', 10, groups)]
    }));
    expect(adapted.skillHit.candidates[0]?.eventValueConditions).toEqual([
      { key: 'blocked', comparator: 'eq', value: { op: 'const', value: 0 } }
    ]);
    expect(adapted.skillHit.candidates[0]?.participationCondition).toEqual({
      op: 'max', args: [{ op: 'const', value: 0 }, { op: 'const', value: 1 }]
    });
  });

  it('OR组命中值条件不相同则拒绝，不删notblocked也不套到另一条null结果', () => {
    const groups = [
      {
        groupKey: 'a', name: 'a', sortOrder: 10,
        conditions: [{
          conditionKey: 'blocked', conditionType: 'EVENT_VALUE_COMPARE' as const, sortOrder: 10,
          detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED' as const, comparator: 'EQ' as const, comparisonValue: fixedValue(0) }
        }]
      },
      {
        groupKey: 'b', name: 'b', sortOrder: 20,
        conditions: [{
          conditionKey: 'first', conditionType: 'EVENT_VALUE_COMPARE' as const, sortOrder: 10,
          detail: { eventValueKey: 'SKILL_HIT_FIRST_CONTACT' as const, comparator: 'EQ' as const, comparisonValue: fixedValue(1) }
        }]
      }
    ];
    expect(() => adaptHitProgram(program({ rules: [execute('actual_hit', 'primary_hit', 10, groups)] })))
      .toThrow('OR组公共event value条件');
    const mixed = adaptHitProgram(program({
      effects: [effect('primary_hit', [damageResult(), nullBuff()])],
      rules: [execute('actual_hit', 'primary_hit', 10, championEnemy())]
    }));
    expect(mixed.skillHit.candidates[0]?.eventValueConditions).toBeUndefined();
    expect(mixed.skillHit.candidates[1]?.spellShieldBlockScope).toBeNull();
    expect(mixed.skillHit.candidates[1]?.eventValueConditions).toBeUndefined();
  });

  it('目录身份未知不补英雄或敌方默认，阈值小数合法', () => {
    expect(() => adaptHitProgram(program({ identity: { source: {}, target: {} } }))).toThrow('显式事实');
    const adapted = adaptHitProgram(program({
      rules: [execute('actual_hit', 'primary_hit', 10, [{
        groupKey: 'half', name: 'half', sortOrder: 10,
        conditions: [{
          conditionKey: 'half', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 10,
          detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED', comparator: 'LTE', comparisonValue: fixedValue(0.5) }
        }]
      }])]
    }));
    expect(adapted.skillHit.candidates[0]?.eventValueConditions).toEqual([
      { key: 'blocked', comparator: 'lte', value: { op: 'const', value: 0.5 } }
    ]);
  });

  it('UNRESOLVED 在有无吸血规则时均拒绝，不修改原输入', () => {
    const authored = program();
    const result = authored.effects[0]!.results[0]!;
    if (result.resultType !== 'DAMAGE') throw new Error('fixture');
    result.detail.vampQualification = 'UNRESOLVED';
    const before = structuredClone(authored);
    expect(() => adaptHitProgram(authored)).toThrow('尚未核定');
    expect(() => adaptHitProgram({ ...authored, vampRules: [] })).toThrow('尚未核定');
    expect(authored).toEqual(before);
    expect(() => adaptHitProgram(program({ vampRules: [] }))).toThrow('缺少吸血规则');
  });

  it('真实命中能力装入吸血规则和技能分类，缺属性不补零，冲突不覆盖', () => {
    const input = request();
    for (const actor of input.combatants) actor.attributes.omnivamp_percent = { base: 0, current: 0, max: 1, resolved: 0 };
    const before = structuredClone(input);
    const binding = { hitProviderKey: 'champion', hitAbilityKey: 'skill_hit', authored: program() };
    const adapted = withHitProgram(input, binding, { rulesHash: 'after' });
    expect(input).toEqual(before);
    expect(adapted.rules.vampRules?.[0]?.sourceAttributeKey).toBe('omnivamp_percent');
    expect(adapted.sharedProviders![0]!.abilities![0]!.types).toEqual(['ability/common']);
    expect(adapted.combatants.every((actor) => actor.types?.includes('combatant/champion'))).toBe(true);
    delete input.combatants[0]!.attributes.omnivamp_percent;
    expect(() => withHitProgram(input, binding, { rulesHash: 'after' })).toThrow('不能自动补零');
    adapted.rules.vampRules![0]!.defaultEfficiency = 2;
    expect(() => withHitProgram(adapted, binding, { rulesHash: 'after-again' })).toThrow('规则与命中计划冲突');
  });

  it('同技能不同效果复用结果键时保持不同状态定义', () => {
    const first = effect('slow_a', [slowResult()], { lifecycle: lifecycle() });
    const second = effect('slow_b', [slowResult()], { lifecycle: lifecycle('SOURCE_TARGET', 2000) });
    const adapted = adaptHitProgram(program({ effects: [first, second], rules: [execute('a', 'slow_a', 10), execute('b', 'slow_b', 20)] }));
    expect(adapted.providers.map((row) => row.providerKey)).toEqual(['status:urgot_q:slow_a:slow', 'status:urgot_q:slow_b:slow']);
  });

  it('不把多层控制折成单层，不丢弃属性乘区或持续语义', () => {
    const authored = program({ rules: [execute('control', 'control', 10)] });
    const control = authored.effects.find((effect) => effect.effectKey === 'control')!;
    control.lifecycle!.maxStacksValue = fixedValue(2);
    expect(() => adaptHitProgram(authored)).toThrow('不能丢弃层数配置');
    const buff = nullBuff();
    if (buff.resultType !== 'ATTRIBUTE_CHANGE') throw new Error('fixture');
    buff.detail.modifierZoneKey = 'attack_damage_add';
    expect(() => adaptHitProgram(program({ effects: [effect('buff', [buff])], rules: [execute('buff', 'buff', 10)] }))).toThrow('不能忽略配置');
  });

  it('未知过程、动作依赖和条件按路径整体拒绝', () => {
    expect(() => adaptHitProgram(program({
      rules: [{
        ...execute('on_used', 'primary_hit', 5),
        eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'urgot_q', useKind: 'ACTIVE', castPhase: 'INITIAL' } },
        actions: [{
          actionKey: 'start', name: 'start', actionType: 'START_PROCESS', sortOrder: 10, targetContext: 'CURRENT_TARGET',
          detail: { processKey: 'cast' }, runtimeInputBindings: [], resultModifiers: []
        }]
      }]
    }))).toThrow('未支持的过程');
    expect(() => adaptHitProgram(program({
      rules: [execute('actual_hit', 'primary_hit', 10, [{
        groupKey: 'g', name: 'g', sortOrder: 10,
        conditions: [{
          conditionKey: 'status', conditionType: 'STATUS_CHECK', sortOrder: 10,
          detail: { subject: 'CURRENT_TARGET', statusKey: 'movement_slow', checkKind: 'PRESENT', sourceEffectKey: null, sourceResultKey: null, comparator: null, comparisonValue: null }
        }]
      }])]
    }))).toThrow('整体拒绝');
  });

  it('法术护盾 SOURCE 单层刷新编译 provider/spell_shield，显式消费先治疗再 REMOVE', () => {
    const shieldDuration: SkillParameter = {
      gameId: 'lol', skillKey: 'sivir_e', parameterKey: 'shield_duration_ms', name: '期限', valueType: 'INTEGER',
      valueMode: 'FIXED', fixedValue: 1500, levelValues: null, description: null, sortOrder: 0, createdAt: '', updatedAt: ''
    };
    const authored: AuthoredHitProgram = {
      gameId: 'lol', skillKey: 'sivir_e', skillLevel: 1, characterLevel: 1,
      identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
      statuses: [], modifierZones: [], parameters: [shieldDuration],
      formulas: [{ gameId: 'lol', skillKey: 'sivir_e', formulaKey: 'heal_formula', name: '治疗', description: null, sortOrder: 0, createdAt: '', updatedAt: '', expression: { nodeType: 'OPERATION', operation: 'ADD', operands: [{ nodeType: 'PARAMETER', parameterKey: 'shield_duration_ms' }, { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'ability_power', attributeValueKind: 'TOTAL' }] } }],
      effects: [
        effect('spell_shield', [{
          resultKey: 'shield', name: '盾', resultType: 'SPELL_SHIELD', target: 'SOURCE', description: null, sortOrder: 10,
          spellShieldBlockScope: null, valueRule: null, detail: {},
          lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: null, stackValueMode: null, reapplicationValueMode: null, periodicExecutionMode: null }
        }], { gameId: 'lol', skillKey: 'sivir_e', lifecycle: lifecycle('SOURCE', 1500) }),
        effect('block_heal', [
          {
            resultKey: 'heal', name: '治疗', resultType: 'DIRECT_HEAL', target: 'SOURCE', description: null, sortOrder: 10,
            spellShieldBlockScope: null, detail: {}, lifecycleBehavior: null,
            valueRule: { value: { kind: 'FORMULA', formulaKey: 'heal_formula' }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }
          },
          {
            resultKey: 'remove_spell_shield', name: '移除', resultType: 'LIFECYCLE_OPERATION', target: 'SOURCE',
            description: null, sortOrder: 20, spellShieldBlockScope: null, valueRule: null,
            detail: { operation: 'REMOVE', targetEffectKey: 'spell_shield' }, lifecycleBehavior: null
          }
        ], { gameId: 'lol', skillKey: 'sivir_e' })
      ],
      rules: [{
        ruleKey: 'successful_spell_block', name: '格挡', description: null, sortOrder: 10,
        eventSource: { eventType: 'SPELL_SHIELD_BLOCKED', detail: { shieldEffectKey: 'spell_shield' } },
        conditionGroups: [],
        actions: [{
          actionKey: 'action_1', name: '执行block_heal', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
          targetContext: 'CURRENT_TARGET', detail: { effectKey: 'block_heal' }, runtimeInputBindings: [], resultModifiers: []
        }],
        perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
      }]
    };
    const adapted = adaptHitProgram(authored);
    expect(adapted.providers[0]).toMatchObject({
      providerKey: 'shield:sivir_e:spell_shield', types: ['provider/spell_shield'],
      lifecycle: { durationMs: { op: 'const', value: 1500 }, maxStacks: 1, refreshPolicy: 'replace' }
    });
    expect(adapted.providers[0]?.listeners?.[0]?.operations).toEqual([
      { operation: 'heal', target: 'self', amount: { op: 'max', args: [{ op: 'add', args: [{ op: 'const', value: 1500 }, { op: 'read', path: 'source.attr.ability_power.resolved' }] }, { op: 'const', value: 0 }] } },
      { operation: 'expire_provider', target: 'self', providerRefFromEvent: true }
    ]);
    expect(() => adaptHitProgram({
      ...authored,
      effects: [{ ...authored.effects[0]!, lifecycle: lifecycle('SOURCE_TARGET', 1500) }]
    })).toThrow('不放宽一般范围');
  });

  it('宿主只对已证明单次使用分配事实，未知用null，不从castInstanceId臆造', () => {
    expect(provenSkillUseFact({ useKey: 'u1', source: 'source', skillKey: 'urgot_q' })).toEqual({
      useKey: 'u1', source: 'source', skillKey: 'urgot_q', historyState: 'complete'
    });
    expect(unknownSkillUseFact({ useKey: 'u1', source: 'source', skillKey: 'urgot_q', priorQualifiedContacts: ['target'] })).toEqual({
      useKey: 'u1', source: 'source', skillKey: 'urgot_q', historyState: 'unknown', priorQualifiedContacts: ['target']
    });
    expect(skillHitFact('h1', 'u1', 0)).toEqual({ driverEntryKey: 'h1', useRef: 'u1', sequence: 0 });
    expect(skillHitFact('h2', null)).toEqual({ driverEntryKey: 'h2', useRef: null, sequence: null });
  });

  it('接入命中计划后能力只有 resolve_skill_hit，独立持续入口仍拒绝护盾粒度', () => {
    const input = request();
    const before = structuredClone(input);
    const output = withHitProgram(input, {
      hitProviderKey: 'champion', hitAbilityKey: 'skill_hit', authored: program({
        rules: [execute('actual_hit', 'control', 10, championEnemy())]
      })
    }, { rulesHash: 'after' });
    expect(input).toEqual(before);
    expect(output.sharedProviders?.[0]?.abilities?.[0]?.operations).toHaveLength(1);
    expect(output.sharedProviders?.[0]?.abilities?.[0]?.operations?.[0]?.operation).toBe('resolve_skill_hit');
    expect(output.sharedProviders?.[0]?.abilities?.[0]?.operations?.[0]?.skillHit?.candidates[0]?.semantic).toMatchObject({
      resultType: 'STATUS_OPERATION', statusKind: 'stun', statusOperation: 'APPLY'
    });
    const mixed = request();
    mixed.sharedProviders![0]!.abilities![0]!.operations = [{ operation: 'damage', target: 'target', amount: { op: 'const', value: 1 } }];
    expect(() => withHitProgram(mixed, {
      hitProviderKey: 'champion', hitAbilityKey: 'skill_hit', authored: program()
    }, { rulesHash: 'after' })).toThrow('只能是一条 resolve_skill_hit');
    expect(() => adaptPersistentResult({
      gameId: 'lol', skillKey: 'urgot_q', skillLevel: 1, characterLevel: 1, effectKey: 'corrosive_charge_slow',
      lifecycle: lifecycle(), result: slowResult('RESULT'), parameters: [slowParam], statuses: program().statuses,
      modifierZones: [], source: 'source', target: 'target'
    }, 'status:slow')).toThrow('命中判定');
  });

  it('第6项 oncePerUse 仍由命中入口整体拒绝，不放开布尔跳过', () => {
    expect(() => adaptHitProgram(program({
      rules: [{ ...execute('actual_hit', 'primary_hit', 10, championEnemy()), oncePerUse: { groupKey: 'proc', scope: 'SKILL' } }]
    }))).toThrow('过程限制');
  });

  it('普攻命中入口要求显式 basic_attack 身份与 BASIC_ATTACK 产生方式', () => {
    const aaDamage = damageResult();
    if (aaDamage.resultType !== 'DAMAGE') throw new Error('fixture');
    aaDamage.detail.deliveryKind = 'BASIC_ATTACK';
    const authored = program({
      effects: [effect('primary_hit', [aaDamage])],
      rules: [{
        ...execute('aa_hit', 'primary_hit', 10, championEnemy()),
        eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }
      }]
    });
    const before = structuredClone(authored);
    const adapted = adaptHitProgram(authored);
    expect(authored).toEqual(before);
    expect(adapted.resolveKind).toBe('basic_attack');
    expect(adapted.typeEntries).toEqual(expect.arrayContaining([
      { key: 'event/basic_attack_hit', domain: 'event' },
      { key: 'ability/basic_attack', domain: 'ability' }
    ]));
    expect(adapted.typeEntries.some((entry) => entry.key === 'event/skill_hit')).toBe(false);
    const output = withHitProgram(request(), {
      hitProviderKey: 'champion', hitAbilityKey: 'skill_hit', authored
    }, { rulesHash: 'after-aa' });
    expect(output.sharedProviders?.[0]?.abilities?.[0]?.skillKey).toBe('urgot_q');
    expect(output.sharedProviders?.[0]?.abilities?.[0]?.types).toEqual(expect.arrayContaining(['ability/basic_attack']));
    expect(output.sharedProviders?.[0]?.abilities?.[0]?.operations?.[0]?.skillHit?.skillKey).toBe('urgot_q');
    expect(() => adaptHitProgram(program({
      rules: [{
        ...execute('aa_hit', 'primary_hit', 10, championEnemy()),
        eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }
      }]
    }))).toThrow('BASIC_ATTACK');
    expect(() => adaptHitProgram(program({
      rules: [
        execute('actual_hit', 'primary_hit', 10, championEnemy()),
        {
          ...execute('aa_hit', 'primary_hit', 20, championEnemy()),
          eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }
        }
      ]
    }))).toThrow('不能同时入队');
    expect(() => adaptHitProgram(program({
      effects: [effect('primary_hit', [aaDamage])],
      rules: [{
        ...execute('aa_hit', 'primary_hit', 10, [{
          groupKey: 'first', name: 'first', sortOrder: 10,
          conditions: [{
            conditionKey: 'first', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 10,
            detail: { eventValueKey: 'SKILL_HIT_FIRST_CONTACT', comparator: 'EQ', comparisonValue: fixedValue(1) }
          }]
        }]),
        eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }
      }]
    }))).toThrow('firstContact/blocked');
    const emptyAa = program({
      effects: [],
      rules: [{
        ruleKey: 'empty_aa', name: 'empty_aa', description: null, sortOrder: 10,
        eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
        conditionGroups: [], actions: [], perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
      }]
    });
    expect(adaptHitProgram(emptyAa).resolveKind).toBe('basic_attack');
    expect(adaptHitProgram(emptyAa).skillHit.candidates).toEqual([]);
    const emptyOut = withHitProgram(request(), {
      hitProviderKey: 'champion', hitAbilityKey: 'skill_hit', authored: emptyAa
    }, { rulesHash: 'empty-aa' });
    expect(emptyOut.sharedProviders?.[0]?.abilities?.[0]?.operations).toEqual([
      expect.objectContaining({
        operation: 'resolve_skill_hit',
        skillHit: { skillKey: 'urgot_q', candidates: [] }
      })
    ]);
  });

  it('源目录两个效果相同 resultKey 不能合并成同一 provider', () => {
    const secondSlow = slowResult();
    const adapted = adaptHitProgram(program({
      effects: [
        effect('slow_a', [slowResult()], { lifecycle: lifecycle() }),
        effect('slow_b', [secondSlow], { lifecycle: lifecycle() })
      ],
      rules: [
        execute('apply_a', 'slow_a', 10, championEnemy()),
        execute('apply_b', 'slow_b', 20, championEnemy())
      ]
    }));
    expect(adapted.providers.map((row) => row.providerKey)).toEqual([
      'status:urgot_q:slow_a:slow',
      'status:urgot_q:slow_b:slow'
    ]);
    expect(adapted.providers[0]).not.toEqual(adapted.providers[1]);
  });
});
