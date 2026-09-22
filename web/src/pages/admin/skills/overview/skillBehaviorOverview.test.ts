import { describe, expect, it } from 'vitest';
import type { SkillEffect } from '../../../../types/skillEffect';
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
