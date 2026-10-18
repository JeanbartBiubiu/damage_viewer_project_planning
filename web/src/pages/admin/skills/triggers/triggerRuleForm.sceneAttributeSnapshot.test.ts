import { describe, expect, it } from 'vitest';
import type { Attribute } from '../../../../types/attribute';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillProcess } from '../../../../types/skillProcess';
import type { SkillTriggerEventSource, SkillTriggerSceneAttributeSnapshotBinding } from '../../../../types/skillTriggerRule';
import { fixedValue, parameterValue } from '../../../../types/numericValue';
import {
  allowsSceneAttributeSnapshot, applyEventSwitchCleanup, bindingSummary, createEmptyActionDraft,
  createEmptyBinding, createEmptyRuleDraft, evaluateBindingCompleteness, fromDetail,
  requiredCatalogsForDraft, sceneAttributeSnapshotError, sourceValueDomain,
  switchBindingSourceType, toCreateRequest, validateSkillTriggerDraft, type SkillTriggerRuleDraft
} from './triggerRuleForm';

const skillKey = 'authored_skill';
const active: SkillTriggerEventSource = {
  eventType: 'SKILL_USED', detail: { sourceSkillKey: skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' }
};
const binding: SkillTriggerSceneAttributeSnapshotBinding = {
  bindingKey: 'snapshot', parameterKey: 'authored_input', sourceType: 'SCENE_ATTRIBUTE_SNAPSHOT',
  detail: { subject: 'TARGET', attributeKey: 'authored_stat', sources: ['EQUIPMENT_DIRECT'] }
};
const parameter: SkillParameter = {
  gameId: 'game', skillKey, parameterKey: 'authored_input', name: '场景输入', valueMode: 'RUNTIME_INPUT',
  valueType: 'DECIMAL', fixedValue: null, levelValues: null, description: null, sortOrder: 0, createdAt: '', updatedAt: ''
};
const attribute: Attribute = {
  gameId: 'game', attributeKey: 'authored_stat', name: '场景属性', valueType: 'DECIMAL', status: 'ENABLED',
  minValue: null, maxValue: null, description: null, sortOrder: 0, createdAt: '', updatedAt: ''
};
const process: SkillProcess = {
  gameId: 'game', skillKey, processKey: 'authored_process', name: '主动过程', activationType: 'ACTIVE',
  description: null, sortOrder: 0, createdAt: '', updatedAt: '', cooldown: null, effectBindings: [], stateOperations: [],
  steps: [{ stepKey: 'wait', name: '等待', description: null, sortOrder: 0, stepType: 'DELAY', occupiesAction: true,
    detail: { delayValue: parameterValue(parameter.parameterKey) } }]
};
const action = () => ({ ...createEmptyActionDraft([], 'START_PROCESS'), name: '启动',
  detail: { processKey: process.processKey }, runtimeInputBindings: [structuredClone(binding)] });
const draft = (): SkillTriggerRuleDraft => ({ ...createEmptyRuleDraft(), ruleKey: 'start_rule', name: '启动规则',
  eventSource: active, actions: [action()] });
const options = {
  includeRuleKey: true, skillKey, parameters: [parameter], attributes: [attribute],
  effectsByKey: new Map(), processesByKey: new Map([[process.processKey, process]]),
  catalogStates: { effects: 'ready', processes: 'ready', skills: 'ready', parameters: 'ready', attributes: 'ready', formulas: 'ready' } as const
};
const error = (value = binding, event = active, selectedParameters = [parameter], attributes = [attribute]) =>
  sceneAttributeSnapshotError(value, event, skillKey, action(), selectedParameters, attributes, 'ready', [process], 'ready');

describe('场景属性快照管理绑定', () => {
  it('新建明确留空来源，切换来源丢弃旧明细，完整保存回读保留作者声明', () => {
    expect(createEmptyBinding([], 'SCENE_ATTRIBUTE_SNAPSHOT').detail).toEqual({ subject: 'SOURCE', attributeKey: '', sources: [] });
    expect(switchBindingSourceType(createEmptyBinding([], 'EVENT_VALUE'), 'SCENE_ATTRIBUTE_SNAPSHOT').detail)
      .toEqual({ subject: 'SOURCE', attributeKey: '', sources: [] });
    const request = toCreateRequest(draft());
    expect(toCreateRequest(fromDetail(request))).toEqual(request);
    expect(request.actions[0].runtimeInputBindings[0]).toEqual(binding);
    expect(bindingSummary(binding)).toContain('场景目标方 / authored_stat / 装备直接属性');
    expect(requiredCatalogsForDraft(draft())).toContain('attributes');
    expect(validateSkillTriggerDraft(draft(), options).ok).toBe(true);
  });

  it.each([
    ['CHARACTER_LEVEL'], ['EQUIPMENT_DIRECT'], ['EQUIPMENT_DIRECT', 'CHARACTER_LEVEL']
  ] as SkillTriggerSceneAttributeSnapshotBinding['detail']['sources'][])(
    '接受显式来源子集 %j，整数兼容保留给实际取值检查', (...sources) => {
      const selected = { ...binding, detail: { ...binding.detail, sources } };
      expect(error(selected)).toBeNull();
      expect(error(selected, active, [{ ...parameter, valueType: 'INTEGER' }])).toBeNull();
      expect(evaluateBindingCompleteness([{ ...parameter, valueType: 'INTEGER' }], [selected])[0].typeCompatible).toBe(true);
      expect(sourceValueDomain(selected)).toBeNull();
      expect(evaluateBindingCompleteness([{ ...parameter, valueType: 'INTEGER' }], [
        { bindingKey: 'cost', parameterKey: parameter.parameterKey, sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: { attributeKey: 'mana' } }
      ])[0].typeCompatible).toBe(false);
    }
  );

  it.each([
    { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'foreign_skill', useKind: 'ACTIVE', castPhase: 'INITIAL' } },
    { eventType: 'SKILL_USED', detail: { sourceSkillKey: skillKey, useKind: 'ANY', castPhase: 'INITIAL' } },
    { eventType: 'SKILL_USED', detail: { sourceSkillKey: skillKey, useKind: 'ACTIVE', castPhase: 'RECAST' } },
    { eventType: 'SKILL_HIT', detail: { sourceSkillKey: skillKey } },
    { eventType: 'BASIC_ATTACK_HIT', detail: {} }
  ] satisfies SkillTriggerEventSource[])('拒绝非真实本技能首次主动入口 %j，并保留失效草稿供修正', (event) => {
    expect(allowsSceneAttributeSnapshot(event, skillKey, action(), [process])).toBe(false);
    expect(error(binding, event)).toContain('首次主动');
    const changed = applyEventSwitchCleanup(draft(), event);
    expect(changed.actions[0].runtimeInputBindings).toEqual([binding]);
    expect(validateSkillTriggerDraft(changed, options).ok).toBe(false);
  });

  it('只向真实主动过程开放；目录未就绪、错误或被动均不能保存', () => {
    expect(allowsSceneAttributeSnapshot(active, skillKey, createEmptyActionDraft([], 'EXECUTE_EFFECT'), [process])).toBe(false);
    expect(allowsSceneAttributeSnapshot(active, skillKey, action(), [])).toBe(false);
    expect(allowsSceneAttributeSnapshot(active, skillKey, action(), [{ ...process, activationType: 'PASSIVE' }])).toBe(false);
    for (const state of ['idle', 'loading', 'error'] as const) {
      expect(sceneAttributeSnapshotError(binding, active, skillKey, action(), [parameter], [attribute], state, [process], 'ready'))
        .toContain('草稿已保留');
      expect(sceneAttributeSnapshotError(binding, active, skillKey, action(), [parameter], [attribute], 'ready', [process], state))
        .toContain('草稿已保留');
    }
  });

  it('拒绝空来源、重复来源、静态或外来参数及停用属性', () => {
    for (const sources of [[], ['CHARACTER_LEVEL', 'CHARACTER_LEVEL']] as SkillTriggerSceneAttributeSnapshotBinding['detail']['sources'][]) {
      expect(error({ ...binding, detail: { ...binding.detail, sources } })).toContain('非空、无重复');
    }
    expect(error(binding, active, [])).toContain('实际消费');
    expect(error(binding, active, [{ ...parameter, valueMode: 'FIXED', fixedValue: 0 }])).toContain('实际消费');
    expect(error(binding, active, [{ ...parameter, skillKey: 'foreign_skill' }])).toContain('实际消费');
    expect(error(binding, active, [parameter], [{ ...attribute, status: 'DISABLED' }])).toContain('真实启用');
    expect(error(binding, active, [parameter], [])).toContain('真实启用');
    const unusedProcess = { ...process, steps: [{ ...process.steps[0], stepType: 'DELAY' as const, detail: { delayValue: fixedValue(0) } }] };
    expect(validateSkillTriggerDraft(draft(), { ...options, processesByKey: new Map([[process.processKey, unusedProcess]]) }).ok).toBe(false);
  });
});
