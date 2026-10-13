import { skillFormulaDefinition } from '../../../../tests/fixtures/skillFormulaDefinition';
import { describe, expect, it } from 'vitest';
import type { SkillConfiguration } from '../../../types/skillConfiguration';
import type { SkillEffect } from '../../../types/skillEffect';
import type { SkillInternalState } from '../../../types/skillInternalState';
import { fixedValue, parameterValue, formulaValue } from '../../../types/numericValue';
import { skillEffectToDraft } from './effects/effectForm';
import { skillInternalStateToDraft } from './processes/internalStateForm';
import {
  buildConfigurationChanges,
  configurationDraftDirty,
  configurationMatchesRequest,
  configurationToDraft,
  createNewFormulaEntry,
  createNewInternalStateEntry,
  createNewEffectEntry,
  createNewProcessEntry,
  createNewRuleEntry,
  createNewParameterEntry,
  visibleParameterDraft
} from './skillConfigurationDraft';
import { skillProcessToDraft } from './processes/processForm';
import { fromDetail } from './triggers/triggerRuleForm';
import type { SkillProcess } from '../../../types/skillProcess';
import type { SkillTriggerRuleDetail } from '../../../types/skillTriggerRule';

const baseline: SkillConfiguration = {
  skill: {
    gameId: 'demo', skillKey: 'sample_q', name: '样例 Q', description: null,
    maxLevel: 2, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: [],
    createdAt: '2026-01-01', updatedAt: '2026-01-01'
  },
  parameters: [{
    gameId: 'demo', skillKey: 'sample_q', parameterKey: 'damage', name: '伤害',
    valueType: 'DECIMAL', valueMode: 'SKILL_LEVEL', fixedValue: null,
    levelValues: { '1': 80, '2': 120 }, description: null, sortOrder: 0,
    createdAt: '2026-01-01', updatedAt: '2026-01-01'
  }, {
    gameId: 'demo', skillKey: 'sample_q', parameterKey: 'ratio', name: '比例',
    valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0,
    levelValues: null, description: null, sortOrder: 1,
    createdAt: '2026-01-01', updatedAt: '2026-01-01'
  }],
  formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [],
  baseDigest: 'before'
};

describe('技能配置草稿', () => {
  it('指定窗口两端引用同次新增参数和公式完整聚合保存与回读，引用反查保护删除', () => {
    const complete = structuredClone(baseline);
    complete.parameters.push({ ...baseline.parameters[1]!, parameterKey: 'first', name: '首段', valueType: 'INTEGER', fixedValue: 2 },
      { ...baseline.parameters[1]!, parameterKey: 'last', name: '末段', valueType: 'INTEGER', fixedValue: 13 });
    complete.formulas.push({ gameId: 'demo', skillKey: 'sample_q', formulaKey: 'last_formula', name: '末段公式', description: null, sortOrder: 0,
      expression: skillFormulaDefinition('sample_q', { nodeType: 'PARAMETER', parameterKey: 'last' }), createdAt: '', updatedAt: '' });
    complete.processes.push({ gameId: 'demo', skillKey: 'sample_q', processKey: 'channel', name: '指定窗口引导', activationType: 'ACTIVE',
      description: null, sortOrder: 0, cooldown: null, createdAt: '', updatedAt: '',
      steps: [{ stepKey: 'channel', name: '指定窗口', stepType: 'CHANNEL', occupiesAction: true, description: null, sortOrder: 0,
        detail: { durationValue: fixedValue(20), executionCountValue: fixedValue(4), firstExecution: 'CUSTOM_WINDOW',
          firstExecutionOffsetValue: parameterValue('first'), lastExecutionOffsetValue: formulaValue('last_formula') } }],
      effectBindings: [], stateOperations: [] });
    const draft = configurationToDraft(complete);
    const process = complete.processes[0]!;
    draft.processes[0]!.value = { processKey: process.processKey, name: process.name, activationType: process.activationType,
      description: process.description, sortOrder: process.sortOrder, cooldown: process.cooldown, steps: process.steps,
      effectBindings: process.effectBindings, stateOperations: process.stateOperations };
    const built = buildConfigurationChanges(baseline, draft, null);
    expect(built.ok, JSON.stringify(built)).toBe(true);
    if (!built.ok) return;
    expect(built.changes.map(change => [change.objectType, change.operation, change.key])).toEqual([
      ['PARAMETER', 'CREATE', 'first'], ['PARAMETER', 'CREATE', 'last'], ['FORMULA', 'CREATE', 'last_formula'], ['PROCESS', 'CREATE', 'channel']
    ]);
    expect(configurationMatchesRequest(complete, undefined, built.changes)).toBe(true);
    const damaged = structuredClone(complete);
    const step = damaged.processes[0]!.steps[0]!;
    if (step.stepType !== 'CHANNEL') throw new Error('样例步骤不符');
    step.detail.lastExecutionOffsetValue = fixedValue(13);
    expect(configurationMatchesRequest(damaged, undefined, built.changes)).toBe(false);
    for (const kind of ['parameter', 'formula'] as const) {
      const changed = configurationToDraft(complete);
      if (kind === 'parameter') changed.parameters = changed.parameters.filter(entry => entry.draft.parameterKey !== 'first');
      else changed.formulas = [];
      const result = buildConfigurationChanges(complete, changed, null);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(Object.values(result.processErrors).join(';')).toContain('仍引用');
    }
  });
  it('过程与规则引用同次新增效果时一起生成变更并回读核对', () => {
    const process: SkillProcess = {
      gameId: 'demo', skillKey: 'sample_q', processKey: 'cast', name: '施放',
      activationType: 'ACTIVE', description: null, sortOrder: 0, cooldown: null,
      steps: [{ stepKey: 'start', name: '开始', stepType: 'IMMEDIATE', description: null,
        sortOrder: 0, detail: {} }],
      effectBindings: [{ bindingKey: 'apply', effectKey: 'marker',
        moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, sortOrder: 0 }],
      stateOperations: [], createdAt: '', updatedAt: ''
    };
    const rule: SkillTriggerRuleDetail = {
      ruleKey: 'on_use', name: '使用时施放', description: null, sortOrder: 0,
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'sample_q',
        useKind: 'ACTIVE', castPhase: 'INITIAL' } }, conditionGroups: [],
      actions: [{ actionKey: 'start', name: '启动', actionType: 'START_PROCESS', sortOrder: 0,
        targetContext: 'CURRENT_TARGET', detail: { processKey: 'cast' },
        runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
    };
    const draft = configurationToDraft(baseline);
    const processEntry = createNewProcessEntry('new-process');
    processEntry.draft = skillProcessToDraft(process);
    processEntry.value = { processKey: process.processKey, name: process.name,
      activationType: process.activationType, description: process.description,
      sortOrder: process.sortOrder, cooldown: process.cooldown, steps: process.steps,
      effectBindings: process.effectBindings, stateOperations: process.stateOperations };
    draft.processes.push(processEntry);
    const ruleEntry = createNewRuleEntry('new-rule');
    ruleEntry.draft = fromDetail(rule, 'sample_q');
    ruleEntry.value = { ...rule };
    draft.triggerRules.push(ruleEntry);
    const built = buildConfigurationChanges(baseline, draft, null);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.changes.map((item) => [item.objectType, item.operation, item.key])).toEqual([
      ['PROCESS', 'CREATE', 'cast'], ['TRIGGER_RULE', 'CREATE', 'on_use']
    ]);
    expect(configurationDraftDirty(baseline, draft)).toBe(true);
    const readback = structuredClone(baseline);
    readback.processes.push(process);
    readback.triggerRules.push(rule);
    expect(configurationMatchesRequest(readback, undefined, built.changes)).toBe(true);
  });

  it('只读回核发现未修改的效果或过程被意外清空', () => {
    const before = structuredClone(baseline);
    before.effects.push({ gameId: 'demo', skillKey: 'sample_q', effectKey: 'untouched',
      name: '未改效果', description: null, sortOrder: 0, lifecycle: null, results: [],
      createdAt: '', updatedAt: '' });
    before.processes.push({ gameId: 'demo', skillKey: 'sample_q', processKey: 'untouched_cast',
      name: '未改过程', activationType: 'ACTIVE', description: null, sortOrder: 0,
      cooldown: null, steps: [], effectBindings: [], stateOperations: [], createdAt: '', updatedAt: '' });
    const changed = structuredClone(before);
    changed.parameters[1]!.fixedValue = 0.5;
    const changes = [{ objectType: 'PARAMETER' as const, operation: 'UPDATE' as const,
      key: 'ratio', value: { name: '比例', valueType: 'DECIMAL' as const,
        valueMode: 'FIXED' as const, fixedValue: 0.5, levelValues: null,
        description: null, sortOrder: 1 } }];
    expect(configurationMatchesRequest(changed, undefined, changes, before)).toBe(true);
    changed.effects = [];
    expect(configurationMatchesRequest(changed, undefined, changes, before)).toBe(false);
    changed.effects = before.effects;
    changed.processes = [];
    expect(configurationMatchesRequest(changed, undefined, changes, before)).toBe(false);
  });

  it('已保存规则的条件组界面标识不会制造未保存变化', () => {
    const before = structuredClone(baseline);
    before.triggerRules.push({ ruleKey: 'saved', name: '已有规则', description: null,
      sortOrder: 0, eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} },
      conditionGroups: [{ groupKey: 'group', name: '条件组', sortOrder: 0,
        conditions: [{ conditionKey: 'source', conditionType: 'EXPLICIT_TARGET_IS_SOURCE',
          sortOrder: 0, detail: {} }] }],
      actions: [{ actionKey: 'run', name: '执行', actionType: 'EXECUTE_EFFECT', sortOrder: 0,
        targetContext: 'CURRENT_TARGET', detail: { effectKey: 'existing' },
        runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null });
    const draft = configurationToDraft(before);
    expect(configurationDraftDirty(before, draft)).toBe(false);
    const built = buildConfigurationChanges(before, draft, null);
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.changes).toEqual([]);
  });

  it('内部状态与效果和数值对象共用变化列表，回读须逐项匹配', () => {
    const draft = configurationToDraft(baseline);
    const parameter = createNewParameterEntry('new-param', 2);
    parameter.draft.parameterKey = 'stack';
    parameter.draft.name = '层数';
    parameter.draft.fixedValue = '1';
    draft.parameters.push(parameter);
    const state: SkillInternalState = {
      gameId: 'demo', skillKey: 'sample_q', stateKey: 'ready', name: '准备',
      stateType: 'FLAG', scope: 'SKILL', description: null, sortOrder: 0,
      detail: { initialEnabled: false }, createdAt: '', updatedAt: ''
    };
    const stateEntry = createNewInternalStateEntry('new-state');
    stateEntry.draft = skillInternalStateToDraft(state);
    stateEntry.value = {
      stateKey: 'ready', name: '准备', stateType: 'FLAG', scope: 'SKILL',
      description: null, sortOrder: 0, detail: { initialEnabled: false }
    };
    draft.internalStates.push(stateEntry);
    const effect: SkillEffect = {
      gameId: 'demo', skillKey: 'sample_q', effectKey: 'marker', name: '标记',
      description: null, sortOrder: 0, createdAt: '', updatedAt: '',
      lifecycle: {
        durationValue: null, maxStacksValue: fixedValue(1),
        applicationStacksValue: fixedValue(1), instanceScope: 'SOURCE',
        reapplicationStackMode: 'KEEP', reapplicationDurationMode: null,
        expiryMode: 'EXPLICIT_ONLY', periodicIntervalValue: null,
        firstPeriodicExecution: null, endWhenShieldEndsResultKey: null
      }, results: []
    };
    const effectEntry = createNewEffectEntry('new-effect');
    effectEntry.draft = skillEffectToDraft(effect);
    effectEntry.value = {
      effectKey: 'marker', name: '标记', description: null, sortOrder: 0,
      lifecycle: effect.lifecycle, results: []
    };
    draft.effects.push(effectEntry);
    const built = buildConfigurationChanges(baseline, draft, null);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.changes.map((item) => [item.objectType, item.operation, item.key])).toEqual([
      ['PARAMETER', 'CREATE', 'stack'],
      ['INTERNAL_STATE', 'CREATE', 'ready'],
      ['EFFECT', 'CREATE', 'marker']
    ]);
    expect(configurationMatchesRequest(baseline, undefined, built.changes)).toBe(false);
    const current = structuredClone(baseline);
    current.parameters.push({ ...baseline.parameters[1]!, parameterKey: 'stack',
      name: '层数', fixedValue: 1, sortOrder: 0 });
    current.internalStates.push(state);
    current.effects.push(structuredClone(effect));
    built.changes.forEach((change) => {
      expect(configurationMatchesRequest(current, undefined, [change]), change.objectType).toBe(true);
    });
    expect(configurationMatchesRequest(current, undefined, built.changes)).toBe(true);
    current.effects[0]!.lifecycle!.endWhenShieldEndsResultKey = 'other';
    expect(configurationMatchesRequest(current, undefined, built.changes)).toBe(false);
  });

  it('只提交明确变化的参数，未改主体与其余模块不进入写入请求', () => {
    const draft = configurationToDraft(baseline);
    draft.parameters[1]!.draft.fixedValue = '0.25';
    const result = buildConfigurationChanges(baseline, draft, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skillChanged).toBe(false);
    expect(result.changes).toEqual([{ objectType: 'PARAMETER', operation: 'UPDATE', key: 'ratio', value: {
      name: '比例', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.25,
      levelValues: null, description: null, sortOrder: 1
    } }]);
    expect(configurationDraftDirty(baseline, draft)).toBe(true);
  });

  it('扩大最高等级时新增格留空，所有等级参数显式提交，真实零有效', () => {
    const draft = configurationToDraft(baseline);
    draft.skill.maxLevel = '3';
    expect(visibleParameterDraft(draft.parameters[0]!.draft, 3, null).levelValues['3']).toBe('');
    const incomplete = buildConfigurationChanges(baseline, draft, null);
    expect(incomplete.ok).toBe(false);
    if (incomplete.ok) return;
    expect(incomplete.parameterErrors.damage?.levelValues).toContain('等级 3');
    draft.parameters[0]!.draft.levelValues['3'] = '0';
    const complete = buildConfigurationChanges(baseline, draft, null);
    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    expect(complete.skillChanged).toBe(true);
    expect(complete.changes).toEqual([{ objectType: 'PARAMETER', operation: 'UPDATE', key: 'damage', value: {
      name: '伤害', valueType: 'DECIMAL', valueMode: 'SKILL_LEVEL', fixedValue: null,
      levelValues: { '1': 80, '2': 120, '3': 0 }, description: null, sortOrder: 0
    } }]);
  });

  it('缩小最高等级只在显式参数变化中移除范围外数值', () => {
    const draft = configurationToDraft(baseline);
    draft.skill.maxLevel = '1';
    const result = buildConfigurationChanges(baseline, draft, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toEqual([{ objectType: 'PARAMETER', operation: 'UPDATE', key: 'damage', value: {
      name: '伤害', valueType: 'DECIMAL', valueMode: 'SKILL_LEVEL', fixedValue: null,
      levelValues: { '1': 80 }, description: null, sortOrder: 0
    } }]);
  });

  it('按写入字段核对回读结果，不把旧基线当成已保存', () => {
    const draft = configurationToDraft(baseline);
    draft.parameters[1]!.draft.fixedValue = '0.25';
    const result = buildConfigurationChanges(baseline, draft, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(configurationMatchesRequest(baseline, undefined, result.changes)).toBe(false);
    const current = structuredClone(baseline);
    current.parameters[1]!.fixedValue = 0.25;
    current.baseDigest = 'after';
    expect(configurationMatchesRequest(current, undefined, result.changes)).toBe(true);
  });

  it('分类键作为集合核对，对象字段顺序不影响相等', () => {
    const current = structuredClone(baseline);
    current.skill.skillCategoryKeys = ['secondary', 'primary'];
    const request = {
      name: current.skill.name, maxLevel: current.skill.maxLevel, description: current.skill.description,
      status: current.skill.status, sortOrder: current.skill.sortOrder,
      skillCategoryKeys: ['primary', 'secondary']
    };
    expect(configurationMatchesRequest(current, request, [])).toBe(true);
    request.skillCategoryKeys = ['primary'];
    expect(configurationMatchesRequest(current, request, [])).toBe(false);
  });

  it('同次新增参数与引用它的公式，公式确认不需要参数先落库', () => {
    const draft = configurationToDraft(baseline);
    const parameter = createNewParameterEntry('new-param', 2);
    parameter.draft.parameterKey = 'bonus';
    parameter.draft.name = '加成';
    parameter.draft.fixedValue = '0';
    draft.parameters.push(parameter);
    const formula = createNewFormulaEntry('new-formula');
    formula.draft.formulaKey = 'total';
    formula.draft.name = '总伤害';
    formula.draft.expression = skillFormulaDefinition('sample_q', { nodeType: 'PARAMETER', parameterKey: 'bonus' });
    draft.formulas.push(formula);
    const result = buildConfigurationChanges(baseline, draft, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toEqual([
      { objectType: 'PARAMETER', operation: 'CREATE', key: 'bonus', value: {
        parameterKey: 'bonus', name: '加成', valueType: 'DECIMAL', valueMode: 'FIXED',
        fixedValue: 0, levelValues: null, description: null, sortOrder: 0
      } },
      { objectType: 'FORMULA', operation: 'CREATE', key: 'total', value: {
        formulaKey: 'total', name: '总伤害', description: null, sortOrder: 0,
        expression: skillFormulaDefinition('sample_q', { nodeType: 'PARAMETER', parameterKey: 'bonus' })
      } }
    ]);
    const current = structuredClone(baseline);
    current.parameters.push({ ...baseline.parameters[1]!, parameterKey: 'bonus', name: '加成', sortOrder: 0 });
    current.formulas.push({
      gameId: 'demo', skillKey: 'sample_q', formulaKey: 'total', name: '总伤害',
      description: null, sortOrder: 0, expression: skillFormulaDefinition('sample_q', { nodeType: 'PARAMETER', parameterKey: 'bonus' }),
      createdAt: '2026-01-01', updatedAt: '2026-01-01'
    });
    expect(configurationMatchesRequest(current, undefined, result.changes)).toBe(true);
  });

  it('删参数须同时调整仍引用它的公式，最终草稿按稳定键校验', () => {
    const current = structuredClone(baseline);
    current.formulas.push({
      gameId: 'demo', skillKey: 'sample_q', formulaKey: 'total', name: '总伤害',
      description: null, sortOrder: 0, expression: skillFormulaDefinition('sample_q', { nodeType: 'PARAMETER', parameterKey: 'ratio' }),
      createdAt: '2026-01-01', updatedAt: '2026-01-01'
    });
    const draft = configurationToDraft(current);
    draft.parameters = draft.parameters.filter((item) => item.draft.parameterKey !== 'ratio');
    const invalid = buildConfigurationChanges(current, draft, null);
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.formulaNodeIssues.total?.[0]?.message).toContain('ratio');
    draft.formulas[0]!.draft.expression = skillFormulaDefinition('sample_q', { nodeType: 'PARAMETER', parameterKey: 'damage' });
    const valid = buildConfigurationChanges(current, draft, null);
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.changes).toEqual([
      { objectType: 'PARAMETER', operation: 'DELETE', key: 'ratio' },
      { objectType: 'FORMULA', operation: 'UPDATE', key: 'total', value: {
        name: '总伤害', description: null, sortOrder: 0,
        expression: skillFormulaDefinition('sample_q', { nodeType: 'PARAMETER', parameterKey: 'damage' })
      } }
    ]);
  });
});
