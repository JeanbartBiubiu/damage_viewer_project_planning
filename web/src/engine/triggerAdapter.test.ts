import { describe, expect, it } from 'vitest';
import { adaptHitProgram } from './hitAdapter';
import {
  adaptTriggerProgram, attackStartFact, basicAttackHitAbility, basicAttackStartAbility,
  initialCastAbilityType, provenTriggerUse, triggerProviderStateSnapshot, useTriggerLedgerEntry,
  withTriggerProgram, type AuthoredTriggerProgram
} from './triggerAdapter';
import type { CompileRequest } from '../types/genericEngine';
import { fixedValue, formulaValue, parameterValue } from '../types/numericValue';
import type { SkillEffect } from '../types/skillEffect';
import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillProcess, SkillProcessMoment } from '../types/skillProcess';
import type { SkillTriggerCondition, SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { GameVampRule } from '../types/gameVamp';

const processStart: SkillProcessMoment = { momentType: 'PROCESS_START', stepKey: null, failureReason: null };
const processComplete: SkillProcessMoment = { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null };
function stepExec(stepKey: string): SkillProcessMoment {
  return { momentType: 'STEP_EXECUTION', stepKey, failureReason: null };
}

const vampRules: GameVampRule[] = [{
  vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE',
  defaultEfficiency: 1, deliveryKinds: ['SKILL', 'BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['common']
}];

function counter(skillKey: string): SkillInternalState {
  return {
    gameId: 'lol', skillKey, stateKey: 'hits', name: 'hits', scope: 'SKILL', description: null, sortOrder: 10,
    stateType: 'COUNTER', detail: { initialValue: fixedValue(0), maxValue: fixedValue(99) }, createdAt: '', updatedAt: ''
  };
}
function icd(skillKey: string, duration = 1500): SkillInternalState {
  return {
    gameId: 'lol', skillKey, stateKey: 'icd', name: 'icd', scope: 'SKILL', description: null, sortOrder: 20,
    stateType: 'INTERNAL_COOLDOWN', detail: { durationValue: fixedValue(duration) }, createdAt: '', updatedAt: ''
  };
}
function flag(skillKey: string): SkillInternalState {
  return {
    gameId: 'lol', skillKey, stateKey: 'ready', name: 'ready', scope: 'SKILL', description: null, sortOrder: 10,
    stateType: 'FLAG', detail: { initialEnabled: false }, createdAt: '', updatedAt: ''
  };
}

function delayProcess(skillKey: string, delayMs = 2000): SkillProcess {
  return {
    gameId: 'lol', skillKey, processKey: 'window', name: 'window', activationType: 'PASSIVE', description: 'synthetic',
    sortOrder: 10, cooldown: null,
    steps: [{ stepKey: 'wait', name: 'wait', description: null, sortOrder: 10, stepType: 'DELAY', detail: { delayValue: fixedValue(delayMs) } }],
    effectBindings: [],
    stateOperations: [
      { operationKey: 'bump', name: 'bump', stateKey: 'hits', moment: processStart, sortOrder: 10, operation: 'INCREASE', value: fixedValue(1), optionKey: null },
      { operationKey: 'reset', name: 'reset', stateKey: 'hits', moment: processComplete, sortOrder: 20, operation: 'SET', value: fixedValue(0), optionKey: null }
    ],
    createdAt: '', updatedAt: ''
  };
}

function rewardProcess(skillKey: string, effectKey = 'bonus'): SkillProcess {
  return {
    gameId: 'lol', skillKey, processKey: 'reward', name: 'reward', activationType: 'PASSIVE', description: 'synthetic',
    sortOrder: 20, cooldown: null,
    steps: [{ stepKey: 'now', name: 'now', description: null, sortOrder: 10, stepType: 'IMMEDIATE', detail: {} }],
    effectBindings: [{ bindingKey: 'do_bonus', effectKey, moment: processStart, sortOrder: 10 }],
    stateOperations: [
      { operationKey: 'clear', name: 'clear', stateKey: 'hits', moment: processStart, sortOrder: 20, operation: 'SET', value: fixedValue(0), optionKey: null },
      { operationKey: 'start_icd', name: 'start_icd', stateKey: 'icd', moment: processStart, sortOrder: 30, operation: 'START', value: null, optionKey: null }
    ],
    createdAt: '', updatedAt: ''
  };
}

function empoweredProcess(skillKey: string, consumeMoment: 'ATTACK_START' | 'ATTACK_HIT' = 'ATTACK_HIT'): SkillProcess {
  return {
    gameId: 'lol', skillKey, processKey: 'spellblade', name: 'spellblade', activationType: 'ACTIVE', description: 'synthetic',
    sortOrder: 10, cooldown: null,
    steps: [{
      stepKey: 'aa', name: 'aa', description: null, sortOrder: 10, stepType: 'EMPOWERED_BASIC_ATTACK',
      detail: { windowValue: fixedValue(1500), consumeMoment }
    }],
    effectBindings: [{ bindingKey: 'do_bonus', effectKey: 'bonus', moment: stepExec('aa'), sortOrder: 10 }],
    stateOperations: [
      { operationKey: 'arm', name: 'arm', stateKey: 'ready', moment: processStart, sortOrder: 10, operation: 'ENABLE', value: null, optionKey: null },
      { operationKey: 'disarm', name: 'disarm', stateKey: 'ready', moment: stepExec('aa'), sortOrder: 20, operation: 'DISABLE', value: null, optionKey: null },
      { operationKey: 'start_icd', name: 'start_icd', stateKey: 'icd', moment: stepExec('aa'), sortOrder: 30, operation: 'START', value: null, optionKey: null },
      { operationKey: 'timeout', name: 'timeout', stateKey: 'ready', moment: { momentType: 'STEP_TIMEOUT', stepKey: 'aa', failureReason: null }, sortOrder: 40, operation: 'DISABLE', value: null, optionKey: null }
    ],
    createdAt: '', updatedAt: ''
  };
}

function damageEffect(skillKey: string, delivery: 'SKILL' | 'BASIC_ATTACK', extra: SkillEffect['results'] = []): SkillEffect {
  return {
    gameId: 'lol', skillKey, effectKey: 'bonus', name: 'bonus', description: 'synthetic', sortOrder: 10, lifecycle: null,
    results: [
      {
        resultKey: 'hit', name: 'hit', resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 10,
        spellShieldBlockScope: null, lifecycleBehavior: null,
        valueRule: { value: fixedValue(40), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
        detail: {
          damageTypeKey: 'physical', deliveryKind: delivery, originKind: 'DIRECT',
          critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: []
        }
      },
      ...extra
    ],
    createdAt: '', updatedAt: ''
  };
}

function manaResult(): SkillEffect['results'][number] {
  return {
    resultKey: 'mana', name: 'mana', resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: 20,
    spellShieldBlockScope: null, lifecycleBehavior: null,
    valueRule: { value: parameterValue('stolen'), fixedMultiplier: 0.5, fixedMinValue: 0, fixedMaxValue: null },
    detail: { attributeKey: 'mana', operation: 'RESTORE' }
  };
}

function stateEq(stateKey: string, value: number): SkillTriggerCondition {
  return {
    conditionKey: `${stateKey}_eq`, conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 10,
    detail: { stateKey, valueKind: 'VALUE', optionKey: null, expectedBoolean: null, comparator: 'EQ', comparisonValue: fixedValue(value) }
  };
}
function stateGte(stateKey: string, value: number): SkillTriggerCondition {
  return {
    conditionKey: `${stateKey}_gte`, conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 10,
    detail: { stateKey, valueKind: 'VALUE', optionKey: null, expectedBoolean: null, comparator: 'GTE', comparisonValue: fixedValue(value) }
  };
}
function flagOn(enabled: boolean): SkillTriggerCondition {
  return {
    conditionKey: 'ready', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 10,
    detail: { stateKey: 'ready', valueKind: 'ENABLED', optionKey: null, expectedBoolean: enabled, comparator: null, comparisonValue: null }
  };
}

function startRule(skillKey: string, processKey: string, groups: SkillTriggerRuleDetail['conditionGroups'], extra: Partial<SkillTriggerRuleDetail> = {}): SkillTriggerRuleDetail {
  return {
    ruleKey: extra.ruleKey ?? `start_${processKey}`, name: processKey, description: 'synthetic', sortOrder: extra.sortOrder ?? 10,
    eventSource: extra.eventSource ?? { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } },
    conditionGroups: groups,
    actions: [{
      actionKey: `go_${processKey}`, name: processKey, actionType: 'START_PROCESS', sortOrder: 10,
      targetContext: 'CURRENT_TARGET', detail: { processKey }, runtimeInputBindings: extra.actions?.[0]?.runtimeInputBindings ?? [], resultModifiers: []
    }],
    perTargetCooldown: null, maxTriggersPerProcess: null,
    oncePerUse: extra.oncePerUse === undefined ? { groupKey: 'proc', scope: 'SKILL' } : extra.oncePerUse,
    ...omit(extra, ['eventSource', 'actions', 'oncePerUse', 'ruleKey', 'sortOrder'])
  };
}

function omit<T extends object, K extends keyof T>(value: T, keys: K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

function windowProgram(patch: Partial<AuthoredTriggerProgram> = {}): AuthoredTriggerProgram {
  const skillKey = patch.skillKey ?? 'synth_window';
  return {
    gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
    statuses: [], modifierZones: [], skillCategoryKeys: ['common'], vampRules,
    internalStates: [counter(skillKey), icd(skillKey, 6000)],
    processes: [delayProcess(skillKey), rewardProcess(skillKey)],
    effects: [damageEffect(skillKey, 'SKILL')],
    rules: [
      startRule(skillKey, 'window', [{ groupKey: 'first', name: 'first', sortOrder: 10, conditions: [stateEq('hits', 0)] }], { ruleKey: 'first_hit', sortOrder: 10 }),
      startRule(skillKey, 'reward', [{ groupKey: 'ready', name: 'ready', sortOrder: 10, conditions: [stateGte('hits', 1)] }], { ruleKey: 'second_hit', sortOrder: 20 })
    ],
    ...patch
  };
}

function spellbladeProgram(patch: Partial<AuthoredTriggerProgram> = {}): AuthoredTriggerProgram {
  const skillKey = patch.skillKey ?? 'synth_spellblade';
  return {
    gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
    statuses: [], modifierZones: [], skillCategoryKeys: ['common'], vampRules,
    internalStates: [flag(skillKey), icd(skillKey, 1500)],
    processes: [empoweredProcess(skillKey, 'ATTACK_HIT')],
    effects: [damageEffect(skillKey, 'BASIC_ATTACK', [manaResult()])],
    rules: [
      {
        ruleKey: 'arm', name: 'arm', description: 'synthetic', sortOrder: 10,
        eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
        conditionGroups: [{ groupKey: 'idle', name: 'idle', sortOrder: 10, conditions: [flagOn(false)] }],
        actions: [{
          actionKey: 'start', name: 'start', actionType: 'START_PROCESS', sortOrder: 10,
          targetContext: 'CURRENT_TARGET', detail: { processKey: 'spellblade' }, runtimeInputBindings: [], resultModifiers: []
        }],
        perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
      },
      {
        ruleKey: 'consume', name: 'consume', description: 'synthetic', sortOrder: 20,
        eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
        conditionGroups: [{ groupKey: 'armed', name: 'armed', sortOrder: 10, conditions: [flagOn(true)] }],
        actions: [{
          actionKey: 'do_bonus', name: 'bonus', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
          targetContext: 'CURRENT_TARGET', detail: { effectKey: 'bonus' },
          runtimeInputBindings: [{
            bindingKey: 'from_hit', parameterKey: 'stolen', sourceType: 'PRIOR_ACTION_RESULT',
            detail: { sourceActionKey: 'do_bonus', sourceResultKey: 'hit', outputKind: 'POST_DEFENSE_DAMAGE' }
          }],
          resultModifiers: []
        }],
        perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: { groupKey: 'spellblade', scope: 'SKILL' }
      }
    ],
    ...patch
  };
}

function request(): CompileRequest {
  const slot = { base: 100, current: 100, max: 200, resolved: 100 };
  return {
    schemaVersion: 'generic-p0', schemaHash: 'schema.p6', rulesHash: 'before',
    typeCatalog: { types: [{ key: 'damage/physical', domain: 'damage' }], relations: [] }, rules: {},
    combatants: (['source', 'target'] as const).map((key) => ({
      key, resources: { mana: { current: 0, max: 200 } },
      providers: [{ providerRef: 'champion', definitionRef: 'champion' }],
      attributes: {
        hp: { ...slot }, attack_damage: { ...slot }, armor: { base: 0, current: 0, max: 0, resolved: 0 },
        omnivamp_percent: { base: 0.2, current: 0.2, max: 1, resolved: 0.2 }
      }
    })),
    sharedProviders: [{
      providerKey: 'champion', stableId: 'champion', kind: 'champion',
      abilities: [
        { abilityKey: 'cast', kind: 'active', operations: [] },
        basicAttackStartAbility({ abilityKey: 'aa_start', skillKey: 'aa_basic' }),
        basicAttackHitAbility({ abilityKey: 'aa_hit', skillKey: 'aa_basic' })
      ]
    }]
  };
}

describe('有界触发与过程适配', () => {
  it('合成计数窗口：不改输入、共享 oncePerUse、首次写开窗且奖励单元含清计数与冷却', () => {
    const authored = windowProgram();
    const before = structuredClone(authored);
    const adapted = adaptTriggerProgram(authored);
    expect(authored).toEqual(before);
    expect(adapted.combo).toBe('count_window');
    expect(adapted.oncePerUse).toEqual({ groupKey: 'proc', scope: 'provider' });
    expect(adapted.provider.initialStateSchema?.hits).toMatchObject({
      defaultValue: 0, durationMs: 2000, refreshPolicy: 'start_on_first_write'
    });
    expect(adapted.provider.initialStateSchema?.icd).toMatchObject({
      defaultValue: 0, durationMs: 6000, refreshPolicy: 'start_on_first_write'
    });
    const listeners = adapted.provider.abilities?.map((row) => row.listenerSpec);
    expect(listeners).toHaveLength(2);
    expect(listeners?.every((row) => row?.oncePerUse?.groupKey === 'proc')).toBe(true);
    expect(listeners?.every((row) => !row?.abilityRef && (row?.maxTriggersPerEvent ?? 1) <= 1)).toBe(true);
    expect(listeners?.[0]?.operations).toEqual([
      expect.objectContaining({ operation: 'state_change', ref: 'hits', valuePolicy: 'add', amount: { op: 'const', value: 1 } })
    ]);
    expect(listeners?.[0]?.condition).toEqual({
      op: 'eq', args: [{ op: 'read', path: 'provider.state.hits' }, { op: 'const', value: 0 }]
    });
    expect(listeners?.[1]?.operations?.map((row) => row.operation)).toEqual(['damage', 'state_change', 'state_change']);
    expect(listeners?.[1]?.operations?.[1]).toMatchObject({ ref: 'hits', valuePolicy: 'set', amount: { op: 'const', value: 0 } });
    expect(listeners?.[1]?.operations?.[2]).toMatchObject({ ref: 'icd', valuePolicy: 'set', amount: { op: 'const', value: 1 } });
    expect(adapted.provider.abilities?.[1]?.kind).toBe('passive_listener');
    expect(adapted.provider.abilities?.[1]?.types).toEqual(['ability/common']);
  });

  it('合成待击消费：INITIAL 身份、命中消费、伤害 outputRef 与同帧回蓝、清 ready 后开冷却', () => {
    const authored = spellbladeProgram();
    const before = structuredClone(authored);
    const adapted = adaptTriggerProgram(authored);
    expect(authored).toEqual(before);
    expect(adapted.combo).toBe('empowered');
    expect(adapted.oncePerUse).toEqual({ groupKey: 'spellblade', scope: 'provider' });
    expect(adapted.initialCastAbilityType).toBe(initialCastAbilityType('synth_spellblade'));
    expect(adapted.consumeEvent).toBe('event/basic_attack_hit');
    const [start, consume] = adapted.provider.abilities ?? [];
    expect(start?.listenerSpec?.eventMatcher).toEqual({
      all: ['event/ability_started', 'ability/skill_synth_spellblade', 'event/source_owner']
    });
    expect(start?.listenerSpec?.oncePerUse).toBeUndefined();
    expect(start?.listenerSpec?.operations).toEqual([
      expect.objectContaining({ operation: 'state_change', ref: 'ready', valuePolicy: 'set', amount: { op: 'const', value: 1 } })
    ]);
    expect(consume?.listenerSpec?.eventMatcher.all).toEqual(['event/basic_attack_hit', 'event/source_owner']);
    expect(consume?.listenerSpec?.operations?.[0]).toMatchObject({
      operation: 'damage', outputRef: 'do_bonus_hit', vampQualification: 'RESOLVED'
    });
    expect(consume?.listenerSpec?.operations?.[1]).toMatchObject({
      operation: 'resource_change', resourceKey: 'mana',
      amount: { op: 'max', args: [{ op: 'mul', args: [{ op: 'read', path: 'operation.output.do_bonus_hit.POST_DEFENSE_DAMAGE' }, { op: 'const', value: 0.5 }] }, { op: 'const', value: 0 }] }
    });
    expect(consume?.listenerSpec?.operations?.slice(2)).toEqual([
      expect.objectContaining({ ref: 'ready', valuePolicy: 'set', amount: { op: 'const', value: 0 } }),
      expect.objectContaining({ ref: 'icd', valuePolicy: 'set', amount: { op: 'const', value: 1 } })
    ]);
    const input = request();
    const unchanged = structuredClone(input);
    const output = withTriggerProgram(input, {
      triggerProviderKey: 'item:synth_spellblade', authored, initialCastAbilityKey: 'cast'
    }, { rulesHash: 'with-p6' });
    expect(input).toEqual(unchanged);
    expect(output.sharedProviders?.find((row) => row.providerKey === 'item:synth_spellblade')?.abilities?.[0]?.kind).toBe('passive_listener');
    expect(output.sharedProviders?.[0]?.abilities?.find((row) => row.abilityKey === 'cast')?.types).toContain('ability/skill_synth_spellblade');
    expect(output.combatants[0]?.providers.some((row) => row.providerRef === 'item:synth_spellblade')).toBe(true);
  });

  it('未支持完整配置、错口径与缺窗口按路径整条拒绝，不补10秒或猜测', () => {
    expect(() => adaptTriggerProgram(windowProgram({
      processes: [delayProcess('synth_window'), {
        ...rewardProcess('synth_window'),
        steps: [{ stepKey: 'ch', name: 'ch', description: null, sortOrder: 10, stepType: 'CHANNEL', detail: { durationValue: fixedValue(1000), executionCountValue: fixedValue(1), firstExecution: 'IMMEDIATE' } }]
      }]
    }))).toThrow('IMMEDIATE');
    expect(() => adaptTriggerProgram(windowProgram({
      processes: [{
        ...delayProcess('synth_window'),
        steps: [{ stepKey: 'wait', name: 'wait', description: null, sortOrder: 10, stepType: 'DELAY', detail: { delayValue: formulaValue('missing_window') } }]
      }, rewardProcess('synth_window')]
    }))).toThrow('公式缺失');
    expect(() => adaptTriggerProgram(spellbladeProgram({
      processes: [{
        ...empoweredProcess('synth_spellblade'),
        steps: [{
          stepKey: 'aa', name: 'aa', description: null, sortOrder: 10, stepType: 'EMPOWERED_BASIC_ATTACK',
          detail: { windowValue: formulaValue('missing_window'), consumeMoment: 'ATTACK_HIT' }
        }]
      }]
    }))).toThrow('公式缺失');
    const unresolved = damageEffect('synth_window', 'SKILL');
    if (unresolved.results[0] && unresolved.results[0].resultType === 'DAMAGE') unresolved.results[0].detail.vampQualification = 'UNRESOLVED';
    expect(() => adaptTriggerProgram(windowProgram({ effects: [unresolved] }))).toThrow('尚未核定');
    expect(() => adaptTriggerProgram(windowProgram({
      effects: [damageEffect('synth_window', 'BASIC_ATTACK')]
    }))).toThrow('产生方式');
    expect(() => adaptTriggerProgram(spellbladeProgram({
      rules: spellbladeProgram().rules.map((rule) => (
        rule.ruleKey === 'arm'
          ? { ...rule, eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'synth_spellblade', useKind: 'ACTIVE', castPhase: 'RECAST' } } }
          : rule
      ))
    }))).toThrow('INITIAL');
    expect(() => adaptTriggerProgram(spellbladeProgram({
      rules: spellbladeProgram().rules.map((rule) => (
        rule.ruleKey === 'arm'
          ? { ...rule, eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: null, useKind: 'ACTIVE', castPhase: 'INITIAL' } } }
          : rule
      ))
    }))).toThrow('来源技能');
    expect(() => adaptTriggerProgram(windowProgram({
      rules: windowProgram().rules.map((rule) => (
        rule.ruleKey === 'first_hit'
          ? {
              ...rule,
              conditionGroups: [{
                groupKey: 'first', name: 'first', sortOrder: 10,
                conditions: [{
                  conditionKey: 'first', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 10,
                  detail: { eventValueKey: 'SKILL_HIT_FIRST_CONTACT', comparator: 'EQ', comparisonValue: fixedValue(1) }
                }]
              }]
            }
          : rule
      ))
    }))).toThrow('首次接触');
    expect(() => adaptTriggerProgram(spellbladeProgram({
      rules: spellbladeProgram().rules.map((rule) => (
        rule.ruleKey === 'consume'
          ? {
              ...rule,
              conditionGroups: [{
                groupKey: 'blocked', name: 'blocked', sortOrder: 10,
                conditions: [{
                  conditionKey: 'blocked', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 10,
                  detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED', comparator: 'EQ', comparisonValue: fixedValue(0) }
                }]
              }]
            }
          : rule
      ))
    }))).toThrow('blocked');
    expect(() => adaptTriggerProgram(spellbladeProgram({
      rules: spellbladeProgram().rules.map((rule) => (
        rule.ruleKey === 'consume'
          ? {
              ...rule,
              actions: [{
                ...rule.actions[0]!,
                runtimeInputBindings: [{
                  bindingKey: 'bad', parameterKey: 'stolen', sourceType: 'PRIOR_ACTION_RESULT',
                  detail: { sourceActionKey: 'do_bonus', sourceResultKey: 'hit', outputKind: 'RAW_DAMAGE' }
                }]
              }]
            }
          : rule
      ))
    }))).toThrow('未知伤害口径');
    const eclipse = windowProgram({ skillKey: 'item_eclipse' });
    expect(() => adaptTriggerProgram({
      ...eclipse,
      processes: [{
        ...delayProcess('item_eclipse'),
        processKey: 'eclipse',
        steps: [{ stepKey: 'wait', name: 'wait', description: null, sortOrder: 10, stepType: 'DELAY', detail: { delayValue: formulaValue('unverified_window') } }]
      }, { ...rewardProcess('item_eclipse'), processKey: 'eclipse_reward' }],
      rules: [
        startRule('item_eclipse', 'eclipse', [{ groupKey: 'first', name: 'first', sortOrder: 10, conditions: [stateEq('hits', 0)] }], { ruleKey: 'first_hit' }),
        startRule('item_eclipse', 'eclipse_reward', [{ groupKey: 'ready', name: 'ready', sortOrder: 10, conditions: [stateGte('hits', 1)] }], { ruleKey: 'second_hit' })
      ]
    })).toThrow('公式缺失');
    expect(() => adaptHitProgram({
      gameId: 'lol', skillKey: 'synth_window', skillLevel: 1, characterLevel: 1,
      identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
      statuses: [], effects: [damageEffect('synth_window', 'SKILL')],
      rules: [{
        ...windowProgram().rules[0]!,
        actions: [{
          actionKey: 'do_bonus', name: 'bonus', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
          targetContext: 'CURRENT_TARGET', detail: { effectKey: 'bonus' }, runtimeInputBindings: [], resultModifiers: []
        }],
        eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } }
      }]
    })).toThrow('过程限制');
  });

  it('TARGET 范围映射 provider_target，账本与普攻开始事实保持显式身份', () => {
    const authored = windowProgram({
      internalStates: [{ ...counter('synth_window'), scope: 'TARGET' }, icd('synth_window', 6000)],
      rules: windowProgram().rules.map((rule) => ({ ...rule, oncePerUse: { groupKey: 'proc', scope: 'TARGET' } }))
    });
    const adapted = adaptTriggerProgram(authored);
    expect(adapted.oncePerUse).toEqual({ groupKey: 'proc', scope: 'provider_target' });
    expect(adapted.provider.abilities?.[0]?.listenerSpec?.operations?.[0]?.types).toEqual(['state_scope/provider_target']);
    expect(adapted.provider.abilities?.[0]?.listenerSpec?.condition).toEqual({
      op: 'eq', args: [{ op: 'read', path: 'provider.target_state.hits' }, { op: 'const', value: 0 }]
    });
    expect(attackStartFact('start', 'aa1')).toEqual({ driverEntryKey: 'start', useRef: 'aa1' });
    expect(provenTriggerUse({ useKey: 'aa1', source: 'source', skillKey: 'aa_basic' }).historyState).toBe('complete');
    expect(useTriggerLedgerEntry({
      owner: 'source', providerRef: 'item:synth_window', groupKey: 'proc', scope: 'provider',
      useSource: 'source', useSkillKey: 'author_q', useKey: 'hist1'
    }).target).toBeNull();
    expect(() => useTriggerLedgerEntry({
      owner: 'source', providerRef: 'item:synth_window', groupKey: 'proc', scope: 'provider',
      useSource: 'source', useSkillKey: 'author_q', useKey: 'hist1', target: 'target'
    })).toThrow('不能携带 target');
    const snapshot = triggerProviderStateSnapshot({
      state: { hits: 1 }, expireAt: { hits: 2000 },
      targetState: { target: 'target', values: { hits: 1 }, expireAt: { hits: 2000 } }
    });
    expect(snapshot).toEqual({
      state: { hits: 1 }, expireAt: { hits: 2000 },
      targetState: { target: 'target', values: { hits: 1 }, expireAt: { hits: 2000 } }
    });
  });

  it('条件组内 min、组间 max；属性 0 与内部冷却条件原样保留', () => {
    const authored = windowProgram({
      rules: [
        startRule('synth_window', 'window', [
          {
            groupKey: 'idle', name: 'idle', sortOrder: 10,
            conditions: [
              stateEq('hits', 0),
              {
                conditionKey: 'ad', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 20,
                detail: {
                  subject: 'SOURCE', attributeKey: 'omnivamp_percent', attributeValueKind: 'CURRENT',
                  comparator: 'GTE', comparisonValue: fixedValue(0)
                }
              }
            ]
          },
          {
            groupKey: 'icd_clear', name: 'icd_clear', sortOrder: 20,
            conditions: [stateEq('icd', 0)]
          }
        ], { ruleKey: 'first_hit', sortOrder: 10 }),
        startRule('synth_window', 'reward', [{ groupKey: 'ready', name: 'ready', sortOrder: 10, conditions: [stateGte('hits', 1)] }], { ruleKey: 'second_hit', sortOrder: 20 })
      ]
    });
    const adapted = adaptTriggerProgram(authored);
    expect(adapted.provider.abilities?.[0]?.listenerSpec?.condition).toEqual({
      op: 'max',
      args: [
        {
          op: 'min',
          args: [
            { op: 'eq', args: [{ op: 'read', path: 'provider.state.hits' }, { op: 'const', value: 0 }] },
            { op: 'gte', args: [{ op: 'read', path: 'source.attr.omnivamp_percent.current' }, { op: 'const', value: 0 }] }
          ]
        },
        { op: 'eq', args: [{ op: 'read', path: 'provider.state.icd' }, { op: 'const', value: 0 }] }
      ]
    });
    expect(adapted.requiredAttributes).toContain('omnivamp_percent');
  });

  it('ATTACK_START 消费与命中消费保持各自时点，开始能力保留成本与冷却门禁', () => {
    const skillKey = 'synth_spellblade';
    const authored = spellbladeProgram({
      processes: [empoweredProcess(skillKey, 'ATTACK_START')],
      rules: spellbladeProgram().rules.map((rule) => (
        rule.ruleKey === 'consume'
          ? { ...rule, eventSource: { eventType: 'BASIC_ATTACK_START', detail: {} } }
          : rule
      ))
    });
    const adapted = adaptTriggerProgram(authored);
    expect(adapted.consumeEvent).toBe('event/basic_attack_start');
    expect(adapted.provider.abilities?.[1]?.listenerSpec?.eventMatcher.all).toEqual([
      'event/basic_attack_start', 'event/source_owner'
    ]);
    expect(() => adaptTriggerProgram(spellbladeProgram({
      processes: [empoweredProcess(skillKey, 'ATTACK_START')]
    }))).toThrow('各自时点');
    const start = basicAttackStartAbility({
      abilityKey: 'aa_start', skillKey: 'aa_basic',
      cost: { resourceKey: 'mana', amount: { op: 'const', value: 10 } },
      cooldown: { durationMs: { op: 'const', value: 500 }, startsOn: 'cast' }
    });
    expect(start.operations).toEqual([]);
    expect(start.types).toEqual(['ability/basic_attack']);
    expect(start.skillKey).toBe('aa_basic');
    expect(start.cost).toEqual({ resourceKey: 'mana', amount: { op: 'const', value: 10 } });
    expect(start.cooldown).toEqual({ durationMs: { op: 'const', value: 500 }, startsOn: 'cast' });
    expect(basicAttackHitAbility({ abilityKey: 'aa_hit', skillKey: 'aa_basic' }).operations).toEqual([
      expect.objectContaining({
        operation: 'resolve_skill_hit',
        skillHit: { skillKey: 'aa_basic', candidates: [] }
      })
    ]);
  });

  it('SHIELD_ABSORBED 与 ACTUAL_HP_LOSS 走同帧 output；同源两效果相同 resultKey 不得合成同一引用', () => {
    const shield = spellbladeProgram({
      rules: spellbladeProgram().rules.map((rule) => (
        rule.ruleKey === 'consume'
          ? {
              ...rule,
              actions: [{
                ...rule.actions[0]!,
                runtimeInputBindings: [{
                  bindingKey: 'from_hit', parameterKey: 'stolen', sourceType: 'PRIOR_ACTION_RESULT',
                  detail: { sourceActionKey: 'do_bonus', sourceResultKey: 'hit', outputKind: 'SHIELD_ABSORBED' }
                }]
              }]
            }
          : rule
      ))
    });
    const shieldOps = adaptTriggerProgram(shield).provider.abilities?.[1]?.listenerSpec?.operations ?? [];
    expect(JSON.stringify(shieldOps)).toContain('operation.output.do_bonus_hit.SHIELD_ABSORBED');
    const hpLoss = spellbladeProgram({
      rules: spellbladeProgram().rules.map((rule) => (
        rule.ruleKey === 'consume'
          ? {
              ...rule,
              actions: [{
                ...rule.actions[0]!,
                runtimeInputBindings: [{
                  bindingKey: 'from_hit', parameterKey: 'stolen', sourceType: 'PRIOR_ACTION_RESULT',
                  detail: { sourceActionKey: 'do_bonus', sourceResultKey: 'hit', outputKind: 'ACTUAL_HP_LOSS' }
                }]
              }]
            }
          : rule
      ))
    });
    expect(JSON.stringify(adaptTriggerProgram(hpLoss).provider.abilities?.[1]?.listenerSpec?.operations)).toContain(
      'operation.output.do_bonus_hit.ACTUAL_HP_LOSS'
    );
    const extra = damageEffect('synth_window', 'SKILL');
    extra.effectKey = 'bonus2';
    expect(() => adaptTriggerProgram(windowProgram({
      effects: [damageEffect('synth_window', 'SKILL'), extra],
      processes: [delayProcess('synth_window'), {
        ...rewardProcess('synth_window'),
        effectBindings: [
          { bindingKey: 'do_bonus', effectKey: 'bonus', moment: processStart, sortOrder: 10 },
          { bindingKey: 'do_bonus', effectKey: 'bonus2', moment: processStart, sortOrder: 15 }
        ]
      }],
      rules: [
        windowProgram().rules[0]!,
        {
          ...windowProgram().rules[1]!,
          actions: [{
            ...windowProgram().rules[1]!.actions[0]!,
            runtimeInputBindings: [{
              bindingKey: 'from_hit', parameterKey: 'stolen', sourceType: 'PRIOR_ACTION_RESULT',
              detail: { sourceActionKey: 'do_bonus', sourceResultKey: 'hit', outputKind: 'POST_DEFENSE_DAMAGE' }
            }]
          }]
        }
      ]
    }))).toThrow('碰撞');
  });

  it('缺 oncePerUse、动态输入、技能命中来源身份与过程次数限制整条拒绝', () => {
    expect(() => adaptTriggerProgram(windowProgram({
      rules: windowProgram().rules.map((rule) => ({ ...rule, oncePerUse: null }))
    }))).toThrow('oncePerUse');
    expect(() => adaptTriggerProgram(windowProgram({
      rules: windowProgram().rules.map((rule) => (
        rule.ruleKey === 'first_hit'
          ? { ...rule, maxTriggersPerProcess: { processKey: 'window', limitValue: fixedValue(1) } }
          : rule
      ))
    }))).toThrow('过程限制');
    expect(() => adaptTriggerProgram(windowProgram({
      rules: windowProgram().rules.map((rule) => (
        rule.ruleKey === 'first_hit'
          ? {
              ...rule,
              eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'author_q' } }
            }
          : rule
      ))
    }))).toThrow('不能静默略过');
    expect(() => adaptTriggerProgram(windowProgram({
      rules: windowProgram().rules.map((rule) => (
        rule.ruleKey === 'second_hit'
          ? {
              ...rule,
              actions: [{
                ...rule.actions[0]!,
                runtimeInputBindings: [{
                  bindingKey: 'dyn', parameterKey: 'stolen', sourceType: 'EVENT_VALUE',
                  detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED' }
                }]
              }]
            }
          : rule
      ))
    }))).toThrow('动态输入');
    expect(() => adaptTriggerProgram(windowProgram({
      rules: [{ ...windowProgram().rules[0]! }]
    }))).toThrow('两条规则');
    expect(useTriggerLedgerEntry({
      owner: 'source', providerRef: 'item:synth_window', groupKey: 'proc', scope: 'provider_target',
      useSource: 'source', useSkillKey: 'author_q', useKey: 'hist1', target: 'target'
    })).toMatchObject({ scope: 'provider_target', target: 'target' });
    expect(() => useTriggerLedgerEntry({
      owner: 'source', providerRef: 'item:synth_window', groupKey: 'proc', scope: 'provider_target',
      useSource: 'source', useSkillKey: 'author_q', useKey: 'hist1'
    })).toThrow('实际命中目标');
  });
});
