import { describe, expect, it } from 'vitest';
import type { SkillEffect, SkillEffectResult } from '../../../../types/skillEffect';
import type { SkillInternalState } from '../../../../types/skillInternalState';
import type { SkillProcess } from '../../../../types/skillProcess';
import type { SkillTriggerRuleDetail } from '../../../../types/skillTriggerRule';
import { RESOURCE_DECREASE_REVIEW_NOTE } from '../authoringFocus';
import { buildSkillBehaviorOverview } from './skillBehaviorOverview';

const NOW = '2026-09-06T12:00:00Z';

function effect(partial: Partial<SkillEffect> & Pick<SkillEffect, 'effectKey' | 'name' | 'results'>): SkillEffect {
  return {
    gameId: 'demo', skillKey: 'q', description: null, sortOrder: 0, lifecycle: null,
    createdAt: NOW, updatedAt: NOW, ...partial
  };
}

function process(partial: Partial<SkillProcess> & Pick<SkillProcess, 'processKey' | 'name' | 'activationType'>): SkillProcess {
  return {
    gameId: 'demo', skillKey: 'q', description: null, sortOrder: 0, cooldown: null,
    steps: [], effectBindings: [], stateOperations: [], createdAt: NOW, updatedAt: NOW, ...partial
  };
}

function rule(partial: Partial<SkillTriggerRuleDetail> & Pick<SkillTriggerRuleDetail, 'ruleKey' | 'name' | 'eventSource'>): SkillTriggerRuleDetail {
  return {
    description: null, sortOrder: 0, conditionGroups: [], actions: [],
    perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null, ...partial
  };
}

const emptyValue = { value: { kind: 'FIXED' as const, value: 10 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null };

describe('skill behavior overview grouping', () => {
  it.each([
    ['LT', { kind: 'PARAMETER', parameterKey: 'low_health_ratio' }, '严格低于参数 low_health_ratio', '说明误写高于'],
    ['GT', { kind: 'FORMULA', formulaKey: 'high_health_ratio' }, '严格高于公式 high_health_ratio', '说明误写低于']
  ] as const)('shows authored damage modifier %s filter and threshold without trusting its description', (comparator, comparisonValue, expected, wrongDescription) => {
    const result: Extract<SkillEffectResult, { resultType: 'DAMAGE_MODIFIER' }> = {
      resultKey: 'gate', name: '生命门槛增伤', resultType: 'DAMAGE_MODIFIER', target: 'SOURCE',
      description: wrongDescription, sortOrder: 10,
      lifecycleBehavior: {
        moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: null,
        reapplicationValueMode: null, periodicExecutionMode: null
      },
      spellShieldBlockScope: null,
      valueRule: { value: { kind: 'PARAMETER', parameterKey: 'bonus_ratio' }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      detail: {
        modifierZoneKey: 'damage', direction: 'DEALT', operation: 'INCREASE', damageTypeKey: 'physics',
        deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT', criticalFilter: 'CRITICAL_ONLY',
        condition: { receiver: 'ENEMY_CHAMPION', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO', comparator, comparisonValue }
      }
    };
    const saved = effect({
      effectKey: 'gate_effect', name: '生命门槛',
      lifecycle: {
        durationValue: { kind: 'FIXED', value: 5000 }, maxStacksValue: { kind: 'FIXED', value: 1 },
        applicationStacksValue: { kind: 'FIXED', value: 1 }, instanceScope: 'SKILL',
        reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'KEEP_REMAINING',
        expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null, firstPeriodicExecution: null
      },
      results: [result]
    });
    const before = structuredClone(saved);
    const model = buildSkillBehaviorOverview({
      skillKey: 'q', skillName: '门槛', parameters: [], formulas: [], processes: [],
      internalStates: [], effects: [saved], rules: [], detailsComplete: true
    });
    const row = model.groups.effect.find((item) => item.id === 'effect:gate_effect:result:gate')!;
    expect(row.valueSourceLabel).toBe('伤害修正 · 参数 bonus_ratio');
    expect(row.notes).toEqual([
      '伤害类型：physics', '产生方式：普通攻击', '来源性质：直接伤害', '暴击筛选：仅暴击',
      `仅本笔敌方英雄承受者 · 扣血前hp当前比例${expected}`
    ]);
    expect(row.notes.join(' ')).not.toContain(wrongDescription);
    expect(saved).toEqual(before);
  });

  it.each([['LT', '小于'], ['GTE', '大于等于']] as const)('shows saved attribute comparison %s without relying on the rule description', (comparator, label) => {
    const saved = rule({ ruleKey: 'heal', name: '自身治疗', description: '说明不能代替实际条件',
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'q', useKind: 'ACTIVE', castPhase: 'INITIAL' } },
      conditionGroups: [{ groupKey: 'health', name: '生命条件', sortOrder: 10, conditions: [{
        conditionKey: 'threshold', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 10,
        detail: { subject: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO', comparator,
          comparisonValue: { kind: 'PARAMETER', parameterKey: 'low_health_threshold_ratio' } }
      }] }]
    });
    const before = structuredClone(saved);
    const model = buildSkillBehaviorOverview({ skillKey: 'q', skillName: '治疗', parameters: [], formulas: [],
      processes: [], internalStates: [], effects: [], rules: [saved], detailsComplete: true });
    const row = model.groups.use.find(item => item.id === 'rule:heal:condition:threshold')!;
    for (const value of ['来源对象', 'hp', '当前值比例', label, 'low_health_threshold_ratio']) expect(row.notes.join(' ')).toContain(value);
    expect(row.location?.segments).toEqual(expect.arrayContaining([
      { kind: 'KEYED_CHILD', collection: 'conditions', keyField: 'conditionKey', key: 'threshold' }
    ]));
    expect(saved).toEqual(before);
  });

  it('also shows the saved internal cooldown comparison in the shared condition summary', () => {
    const model = buildSkillBehaviorOverview({ skillKey: 'q', skillName: '咒刃', parameters: [], formulas: [],
      processes: [], internalStates: [], effects: [], detailsComplete: true,
      rules: [rule({ ruleKey: 'arm', name: '待击', eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: null, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
        conditionGroups: [{ groupKey: 'ready', name: '就绪', sortOrder: 10, conditions: [{
          conditionKey: 'icd_ready', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 10,
          detail: { stateKey: 'spellblade_icd', valueKind: 'REMAINING_MS', optionKey: null, expectedBoolean: null,
            comparator: 'EQ', comparisonValue: { kind: 'FIXED', value: 0 } }
        }] }]
      })] });
    const row = model.groups.use.find(item => item.id === 'rule:arm:condition:icd_ready')!;
    for (const value of ['spellblade_icd', '剩余毫秒', '等于', '0']) expect(row.notes.join(' ')).toContain(value);
  });

  it.each([
    [1, 'ATTACK_HIT'], [2, 'ATTACK_HIT'], [1, 'ATTACK_START'], [2, 'ATTACK_START']
  ] as const)('groups %i empowered bindings by hit with %s consumption and retains ending/orphans', (bindingCount, consumeMoment) => {
    const p = process({
      processKey: 'blade', name: '强化普攻', activationType: 'ACTIVE',
      steps: [{ stepKey: 'attack', name: '等待普攻', description: null, sortOrder: 10, stepType: 'EMPOWERED_BASIC_ATTACK',
        detail: { windowValue: { kind: 'PARAMETER', parameterKey: 'window_ms' }, consumeMoment } }],
      effectBindings: Array.from({ length: bindingCount }, (_, index) => ({
        bindingKey: `hit_${index}`, effectKey: `effect_${index}`, sortOrder: index * 10,
        moment: { momentType: 'STEP_EXECUTION' as const, stepKey: 'attack', failureReason: null }
      })),
      stateOperations: [
        { operationKey: 'arm', name: '待命', stateKey: 'ready', operation: 'ENABLE', sortOrder: 10,
          moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, value: null, optionKey: null },
        { operationKey: 'consume', name: '消费', stateKey: 'ready', operation: 'DISABLE', sortOrder: 30,
          moment: { momentType: 'STEP_EXECUTION', stepKey: 'attack', failureReason: null }, value: null, optionKey: null },
        { operationKey: 'cooldown', name: '冷却', stateKey: 'icd', operation: 'START', sortOrder: 40,
          moment: { momentType: 'STEP_EXECUTION', stepKey: 'attack', failureReason: null }, value: null, optionKey: null },
        { operationKey: 'expire', name: '超时', stateKey: 'ready', operation: 'DISABLE', sortOrder: 50,
          moment: { momentType: 'STEP_TIMEOUT', stepKey: 'attack', failureReason: null }, value: null, optionKey: null }
      ]
    });
    p.effectBindings.push({ bindingKey: 'timeout', effectKey: 'effect_0', sortOrder: 90,
      moment: { momentType: 'STEP_TIMEOUT', stepKey: 'attack', failureReason: null } });
    p.effectBindings.push({ bindingKey: 'unknown_step', effectKey: 'effect_0', sortOrder: 100,
      moment: { momentType: 'STEP_EXECUTION', stepKey: 'unknown', failureReason: null } });
    const model = buildSkillBehaviorOverview({
      skillKey: 'q', skillName: '咒刃', parameters: [], formulas: [], internalStates: [], processes: [p], detailsComplete: true,
      effects: [...Array.from({ length: bindingCount }, (_, i) => effect({ effectKey: `effect_${i}`, name: `效果${i}`, results: [] })), effect({ effectKey: 'orphan', name: '未挂接', results: [] })],
      rules: [rule({ ruleKey: 'on_step', name: '步骤规则', eventSource: {
        eventType: 'PROCESS_MOMENT', detail: { processKey: 'blade', moment: { momentType: 'STEP_EXECUTION', stepKey: 'attack', failureReason: null } }
      } })]
    });
    const ids = (group: keyof typeof model.groups) => model.groups[group].map(row => row.id);
    expect(ids('hit')).toContain('process:blade:step:attack');
    expect(ids('hit')).toContain('rule:on_step');
    const step = model.groups.hit.find(row => row.id === 'process:blade:step:attack')!;
    expect(step.valueSourceLabel).toBe('待击窗口（毫秒）：参数 window_ms');
    expect(step.notes).toContain('普攻命中时执行步骤效果');
    expect(step.momentLabel).toContain(consumeMoment === 'ATTACK_HIT' ? '命中时消费' : '发起时消费');
    expect(step.location.segments).toEqual([{ kind: 'KEYED_CHILD', collection: 'steps', keyField: 'stepKey', key: 'attack' }]);
    for (let i = 0; i < bindingCount; i++) {
      const id = `process:blade:binding:hit_${i}`;
      expect(ids('hit')).toContain(id);
      expect(ids('effect')).toContain(id);
      expect(model.supplement.map(row => row.id)).not.toContain(id);
    }
    expect(ids('use')).toContain('process:blade:operation:arm');
    expect(ids('hit')).toContain('process:blade:operation:consume');
    expect(ids('hit')).toContain('process:blade:operation:cooldown');
    expect(ids('costCooldown')).toContain('process:blade:operation:cooldown');
    expect(ids('end')).toContain('process:blade:operation:expire');
    expect(ids('end')).toContain('process:blade:binding:timeout');
    expect(ids('hit')).not.toContain('process:blade:binding:timeout');
    expect(ids('hit')).not.toContain('process:blade:binding:unknown_step');
    expect(model.supplement.map(row => row.id)).toContain('process:blade:binding:unknown_step');
    expect(model.supplement.map(row => row.id)).toContain('effect:orphan:unattached');
  });

  it('distinguishes kill-event action context from the saved healing recipients and retains the rule explanation', () => {
    const healingResult = (resultKey: string, target: 'SOURCE' | 'TARGET') => ({
      resultKey, name: resultKey, resultType: 'DIRECT_HEAL' as const, target, description: null, sortOrder: 0,
      lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: emptyValue, detail: {}
    });
    const savedExplanation = '当前目标是被击杀英雄；治疗结果作用于技能拥有者。';
    const model = buildSkillBehaviorOverview({
      skillKey: 'q', skillName: '凯旋', parameters: [], formulas: [], processes: [], internalStates: [],
      effects: [
        effect({ effectKey: 'self_heal', name: '自身治疗', results: [healingResult('self', 'SOURCE')] }),
        effect({ effectKey: 'mixed_heal', name: '分别治疗', results: [healingResult('self', 'SOURCE'), healingResult('other', 'TARGET')] })
      ],
      rules: [rule({
        ruleKey: 'on_kill', name: '击杀治疗', description: savedExplanation,
        eventSource: { eventType: 'KILL', detail: {} },
        actions: ['self_heal', 'mixed_heal', 'unavailable'].map((effectKey) => ({
          actionKey: effectKey, name: effectKey, actionType: 'EXECUTE_EFFECT', sortOrder: 0,
          targetContext: 'CURRENT_TARGET', detail: { effectKey }, runtimeInputBindings: [], resultModifiers: []
        }))
      })],
      detailsComplete: false
    });
    expect(model.groups.effect.find((item) => item.id === 'rule:on_kill')?.notes).toContain(`规则说明：${savedExplanation}`);
    expect(model.groups.effect.find((item) => item.id === 'rule:on_kill:action:self_heal')).toMatchObject({
      targetLabel: '动作目标上下文：当前目标',
      notes: ['执行效果', '效果结果作用对象：施法者（技能拥有者）']
    });
    expect(model.groups.effect.find((item) => item.id === 'rule:on_kill:action:mixed_heal')?.notes)
      .toContain('效果结果作用对象：施法者（技能拥有者）、当前目标（由执行入口确定）');
    expect(model.groups.effect.find((item) => item.id === 'rule:on_kill:action:unavailable')?.notes)
      .toContain('效果详情未读取，无法确认结果作用对象');
    expect(model.groups.effect.find((item) => item.id === 'effect:self_heal:result:self')?.targetLabel)
      .toBe('施法者（技能拥有者）');
  });

  it('places saved configs into the five groups, keeps unstarted passive processes, and does not call resource decrease a cast cost', () => {
    const damage = effect({
      effectKey: 'hit', name: '命中效果',
      results: [{
        resultKey: 'dmg', name: '伤害', resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 0,
        lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: emptyValue,
        detail: {
          damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'DIRECT',
          critical: { mode: 'DISALLOWED', multiplierValue: null },
          vampQualification: 'UNRESOLVED', vampOverrides: []
        }
      }]
    });
    const mana = effect({
      effectKey: 'mana', name: '扣蓝',
      results: [{
        resultKey: 'spend', name: '扣蓝', resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: 0,
        lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: { ...emptyValue, value: { kind: 'FIXED', value: -40 } },
        detail: { attributeKey: 'mana', operation: 'CONSUME' }
      }]
    });
    const restore = effect({
      effectKey: 'restore', name: '回蓝',
      results: [{
        resultKey: 'gain', name: '回蓝', resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: 0,
        lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: emptyValue,
        detail: { attributeKey: 'mana', operation: 'RESTORE' }
      }]
    });
    const ending = effect({
      effectKey: 'fade', name: '结束效果',
      results: [{
        resultKey: 'clear', name: '结束移除', resultType: 'STATUS_OPERATION', target: 'TARGET', description: null, sortOrder: 10,
        lifecycleBehavior: { moment: 'NATURAL_END', valueReadMode: null, stackValueMode: null, reapplicationValueMode: null, periodicExecutionMode: null },
        spellShieldBlockScope: null, valueRule: null, detail: { statusKey: 'slow', operation: 'REMOVE' }
      }]
    });
    const unattached = effect({
      effectKey: 'orphan', name: '未挂接',
      results: [{
        resultKey: 'mark', name: '标记', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description: null, sortOrder: 0,
        lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: emptyValue,
        detail: { attributeKey: 'ad', operation: 'DECREASE', modifierZoneKey: null }
      }]
    });
    const active = process({
      processKey: 'cast', name: '施放过程', activationType: 'ACTIVE',
      cooldown: { durationValue: { kind: 'PARAMETER', parameterKey: 'cd' }, startMoment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } },
      steps: [{ stepKey: 'fire', name: '出手', description: null, sortOrder: 0, stepType: 'IMMEDIATE', detail: {} }],
      effectBindings: [
        { bindingKey: 'on_start', effectKey: 'mana', moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, sortOrder: 0 },
        { bindingKey: 'on_end', effectKey: 'hit', moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null }, sortOrder: 1 }
      ]
    });
    const passive = process({
      processKey: 'aura', name: '被动光环', activationType: 'PASSIVE',
      steps: [{ stepKey: 'tick', name: '周期', description: null, sortOrder: 0, stepType: 'PERIODIC', detail: {
        repeatCountValue: { kind: 'FIXED', value: 1 }, intervalValue: { kind: 'FIXED', value: 1000 }, firstExecution: 'IMMEDIATE'
      } }]
    });
    const consumable = process({
      processKey: 'charge', name: '充能过程', activationType: 'CONSUMABLE',
      steps: [{ stepKey: 'ready', name: '就绪', description: null, sortOrder: 0, stepType: 'IMMEDIATE', detail: {} }]
    });
    const used = rule({
      ruleKey: 'on_use', name: '主动使用',
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: null, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
      actions: [{
        actionKey: 'start', name: '启动', actionType: 'START_PROCESS', sortOrder: 0, targetContext: 'CURRENT_TARGET',
        detail: { processKey: 'cast' }, runtimeInputBindings: [], resultModifiers: []
      }]
    });
    const hit = rule({
      ruleKey: 'on_hit', name: '技能命中',
      eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } },
      conditionGroups: [{
        groupKey: 'hit_if', name: '命中条件', sortOrder: 0,
        conditions: [{ conditionKey: 'enemy', conditionType: 'SKILL_HIT_TARGET_IS_ENEMY', sortOrder: 0, detail: {} }]
      }],
      actions: [{
        actionKey: 'apply', name: '执行伤害', actionType: 'EXECUTE_EFFECT', sortOrder: 0, targetContext: 'CURRENT_TARGET',
        detail: { effectKey: 'hit' }, runtimeInputBindings: [{
          bindingKey: 'first', parameterKey: 'contact', sourceType: 'EVENT_VALUE', detail: { eventValueKey: 'SKILL_HIT_FIRST_CONTACT' }
        }], resultModifiers: []
      }]
    });
    const init = rule({
      ruleKey: 'on_init', name: '初始化',
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }
    });

    const model = buildSkillBehaviorOverview({
      skillKey: 'q', skillName: 'Q', parameters: [], formulas: [],
      effects: [damage, mana, restore, ending, unattached],
      processes: [active, passive, consumable],
      internalStates: [],
      rules: [used, hit, init],
      detailsComplete: true
    });

    expect(model.groups.use.some((item) => item.sourceKey === 'on_use')).toBe(true);
    expect(model.groups.use.some((item) => item.id.includes('on_start'))).toBe(true);
    expect(model.groups.costCooldown.some((item) => item.id.includes('spend'))).toBe(true);
    expect(model.groups.costCooldown.find((item) => item.id.includes('spend'))?.notes).toContain(RESOURCE_DECREASE_REVIEW_NOTE);
    expect(model.groups.costCooldown.find((item) => item.id.includes('gain'))?.notes ?? []).not.toContain(RESOURCE_DECREASE_REVIEW_NOTE);
    expect(model.groups.costCooldown.some((item) => item.id.endsWith(':cooldown'))).toBe(true);
    expect(model.groups.hit.some((item) => item.sourceKey === 'on_hit')).toBe(true);
    expect(model.groups.effect.some((item) => item.id.includes('dmg'))).toBe(true);
    expect(model.groups.end.some((item) => item.id.includes('on_end'))).toBe(true);
    expect(model.groups.end.some((item) => item.id.includes('clear'))).toBe(true);
    expect(model.supplement.some((item) => item.sourceKey === 'orphan' && item.sourceKindLabel === '未挂接效果')).toBe(true);
    expect(model.supplement.some((item) => item.sourceKey === 'aura' && item.sourceKindLabel === '未启动过程')).toBe(true);
    expect(model.supplement.some((item) => item.sourceKey === 'charge' && item.sourceKindLabel === '未启动过程')).toBe(true);
    expect(model.supplement.some((item) => item.sourceKey === 'on_init')).toBe(true);
    expect(model.groups.costCooldown.some((item) => item.notes.includes(RESOURCE_DECREASE_REVIEW_NOTE) && item.id.includes('mark'))).toBe(false);
    expect(model.groups.use.some((item) => item.sourceKey === 'aura')).toBe(false);
    expect(model.groups.use.find((item) => item.id === 'process:cast:binding:on_start')).toMatchObject({
      sourceName: '施放过程 → 扣蓝（mana）', targetLabel: '施法者（技能拥有者）'
    });
    expect(model.groups.hit.find((item) => item.id === 'rule:on_hit:action:apply')).toMatchObject({
      targetLabel: '动作目标上下文：当前目标', valueSourceLabel: '效果：命中效果（hit）',
      notes: ['执行效果', '效果结果作用对象：当前目标（由执行入口确定）']
    });
    expect(model.groups.hit.find((item) => item.id === 'rule:on_hit:condition:enemy')?.targetLabel).toBe('事件对方');
    expect(model.groups.hit.find((item) => item.id === 'rule:on_hit:binding:first')?.targetLabel).toContain('参数：');
  });

  it('keeps parameters, formulas and mode options as auxiliary references rather than inventing combat groups', () => {
    const state = {
      gameId: 'demo', skillKey: 'q', stateKey: 'stance', name: '姿态', scope: 'SKILL', stateType: 'MODE',
      description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW,
      detail: { options: [{ optionKey: 'open', name: '开启', sortOrder: 0, initial: true }] }
    } as SkillInternalState;
    const model = buildSkillBehaviorOverview({
      skillKey: 'q', skillName: 'Q',
      parameters: [{
        gameId: 'demo', skillKey: 'q', parameterKey: 'ratio', name: '比例', valueType: 'DECIMAL',
        valueMode: 'FIXED', fixedValue: 0.7, levelValues: null, description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW
      }],
      formulas: [{
        gameId: 'demo', skillKey: 'q', formulaKey: 'scale', name: '缩放', description: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW
      }],
      effects: [], processes: [], internalStates: [state], rules: [], detailsComplete: true
    });
    expect(model.auxiliary.map((item) => item.sourceKey)).toEqual(['ratio', 'scale', 'stance', 'stance / open']);
    expect(SKILL_BEHAVIOR_EMPTY(model)).toBe(true);
  });
});

function SKILL_BEHAVIOR_EMPTY(model: ReturnType<typeof buildSkillBehaviorOverview>): boolean {
  return model.groups.use.length === 0 && model.groups.costCooldown.length === 0
    && model.groups.hit.length === 0 && model.groups.effect.length === 0 && model.groups.end.length === 0;
}
