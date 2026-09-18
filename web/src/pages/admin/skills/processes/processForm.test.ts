import { formulaValue } from '../../../../types/numericValue';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../../services/apiClient';
import type { SkillProcess } from '../../../../types/skillProcess';
import {
  INCOMPLETE_CATALOG_MESSAGE,
  PROCESS_BEHAVIOR_REQUIRED_MESSAGE,
  applyStepTypeChange,
  buildCreateSkillProcessRequest,
  buildUpdateSkillProcessRequest,
  clearHiddenStepFields,
  createEmptyEffectBindingDraft,
  createEmptyProcessDraft,
  createEmptyStateOperationDraft,
  createEmptyStepDraft,
  findStepDeleteBlockers,
  mapSkillProcessFieldIssues,
  skillProcessToDraft,
  validateSkillProcessDraft,
  type ProcessFormCatalog,
  type SkillProcessDraft,
  type SkillProcessEffectBindingDraft,
  type SkillProcessStateOperationDraft,
  type SkillProcessStepDraft
} from './processForm';

const CATALOG: ProcessFormCatalog = {
  formulas: [
    { formulaKey: 'cooldown_ms', name: '冷却' },
    { formulaKey: 'impact_delay_ms', name: '延迟' },
    { formulaKey: 'hit_count', name: '段数' },
    { formulaKey: 'tick_count', name: '周期次数' },
    { formulaKey: 'tick_interval_ms', name: '周期间隔' },
    { formulaKey: 'channel_duration_ms', name: '引导时长' },
    { formulaKey: 'channel_hit_count', name: '引导次数' },
    { formulaKey: 'minimum_charge_ms', name: '最短蓄力' },
    { formulaKey: 'maximum_charge_ms', name: '最长蓄力' },
    { formulaKey: 'recast_window_ms', name: '重施窗口' },
    { formulaKey: 'maximum_recasts', name: '最大重施' },
    { formulaKey: 'empowered_attack_window_ms', name: '强化窗口' },
    { formulaKey: 'focus_cost', name: '专注消耗' }
  ],
  effects: [
    { effectKey: 'on_hit_results', name: '命中结果' },
    { effectKey: 'mana_cost', name: '法力消耗' }
  ],
  internalStates: [
    { stateKey: 'focus_stacks', name: '专注层数', stateType: 'COUNTER' },
    { stateKey: 'weapon_mode', name: '武器模式', stateType: 'MODE' },
    { stateKey: 'ready', name: '已准备', stateType: 'FLAG' },
    { stateKey: 'internal_cd', name: '内部冷却', stateType: 'INTERNAL_COOLDOWN' }
  ],
  modeOptionsByStateKey: {
    weapon_mode: [
      { optionKey: 'minigun', name: '机枪' },
      { optionKey: 'rocket', name: '火箭' }
    ]
  }
};

function immediateStep(overrides: Partial<SkillProcessStepDraft> = {}): SkillProcessStepDraft {
  return {
    ...createEmptyStepDraft('IMMEDIATE'),
    stepKey: 'hit',
    name: '命中',
    sortOrder: '10',
    ...overrides
  };
}

function binding(overrides: Partial<SkillProcessEffectBindingDraft> = {}): SkillProcessEffectBindingDraft {
  return {
    ...createEmptyEffectBindingDraft(),
    bindingKey: 'hit_results',
    effectKey: 'on_hit_results',
    momentType: 'STEP_EXECUTION',
    stepKey: 'hit',
    sortOrder: '10',
    ...overrides
  };
}

function consumeOp(overrides: Partial<SkillProcessStateOperationDraft> = {}): SkillProcessStateOperationDraft {
  return {
    ...createEmptyStateOperationDraft(),
    operationKey: 'consume_focus',
    name: '消耗专注层数',
    stateKey: 'focus_stacks',
    operation: 'CONSUME',
    value: formulaValue("focus_cost"),
    momentType: 'PROCESS_START',
    stepKey: '',
    sortOrder: '10',
    ...overrides
  };
}

function validProcessDraft(overrides: Partial<SkillProcessDraft> = {}): SkillProcessDraft {
  return {
    ...createEmptyProcessDraft(),
    processKey: 'primary_cast',
    name: '主要施放过程',
    sortOrder: '10',
    steps: [immediateStep()],
    effectBindings: [binding()],
    stateOperations: [],
    ...overrides
  };
}

function expectValid(draft: SkillProcessDraft, includeProcessKey = true) {
  const result = validateSkillProcessDraft(draft, { includeProcessKey, catalog: CATALOG });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected valid draft: ${JSON.stringify(result)}`);
  }
  return result.normalized;
}

const SAVED_PROCESS: SkillProcess = {
  gameId: 'lol',
  skillKey: 'ezreal_q',
  processKey: 'primary_cast',
  name: '主要施放过程',
  activationType: 'ACTIVE',
  description: null,
  sortOrder: 10,
  cooldown: {
    durationValue: formulaValue("cooldown_ms"),
    startMoment: { momentType: 'PROCESS_START', stepKey: null }
  },
  steps: [{
    stepKey: 'hit',
    name: '命中',
    stepType: 'IMMEDIATE',
    description: null,
    sortOrder: 10,
    detail: {}
  }],
  effectBindings: [{
    bindingKey: 'hit_results',
    effectKey: 'on_hit_results',
    moment: { momentType: 'STEP_EXECUTION', stepKey: 'hit' },
    sortOrder: 10
  }],
  stateOperations: [],
  createdAt: '2026-08-27T00:00:00Z',
  updatedAt: '2026-08-27T00:00:00Z'
};

describe('skill process form defaults and conversion', () => {
  it('starts a new process with one immediate step and empty behaviors', () => {
    const empty = createEmptyProcessDraft();
    expect(empty.steps).toHaveLength(1);
    expect(empty.steps[0]?.stepType).toBe('IMMEDIATE');
    expect(empty.effectBindings).toEqual([]);
    expect(empty.stateOperations).toEqual([]);
    const converted = skillProcessToDraft(SAVED_PROCESS);
    expect(converted.cooldownEnabled).toBe(true);
    expect(converted.cooldownStepKey).toBe('');
    expect(converted.steps[0]?.detail === undefined).toBe(true);
  });
});

describe('skill process steps, moments and behaviors', () => {
  it('builds eight step kinds and clears hidden fields when switching a new step', () => {
    const delay = expectValid(validProcessDraft({
      steps: [{
        ...createEmptyStepDraft('DELAY'),
        stepKey: 'delay',
        name: '延迟',
        sortOrder: '10',
        delayValue: formulaValue("impact_delay_ms")
      }],
      effectBindings: [binding({ stepKey: 'delay' })]
    }));
    expect(delay.steps[0]).toMatchObject({
      stepType: 'DELAY',
      detail: { delayValue: formulaValue("impact_delay_ms") }
    });

    const multiHit = expectValid(validProcessDraft({
      steps: [{
        ...createEmptyStepDraft('MULTI_HIT'),
        stepKey: 'hits',
        name: '多段',
        sortOrder: '10',
        repeatCountValue: formulaValue("hit_count"),
        intervalValue: null
      }],
      effectBindings: [binding({ stepKey: 'hits' })]
    }));
    expect(multiHit.steps[0]?.stepType).toBe('MULTI_HIT');
    if (multiHit.steps[0]?.stepType !== 'MULTI_HIT') throw new Error('expected multi hit');
    expect(multiHit.steps[0].detail.intervalValue).toBeNull();

    const periodic = expectValid(validProcessDraft({
      steps: [{
        ...createEmptyStepDraft('PERIODIC'),
        stepKey: 'ticks',
        name: '周期',
        sortOrder: '10',
        repeatCountValue: formulaValue("tick_count"),
        intervalValue: formulaValue("tick_interval_ms"),
        firstExecution: 'AFTER_INTERVAL'
      }],
      effectBindings: [binding({ stepKey: 'ticks' })]
    }));
    expect(periodic.steps[0]?.stepType).toBe('PERIODIC');

    const channel = expectValid(validProcessDraft({
      steps: [{
        ...createEmptyStepDraft('CHANNEL'),
        stepKey: 'channel',
        name: '引导',
        sortOrder: '10',
        durationValue: formulaValue("channel_duration_ms"),
        executionCountValue: formulaValue("channel_hit_count"),
        firstExecution: 'IMMEDIATE'
      }],
      effectBindings: [binding({ stepKey: 'channel' })]
    }));
    expect(channel.steps[0]?.stepType).toBe('CHANNEL');

    const charge = expectValid(validProcessDraft({
      steps: [{
        ...createEmptyStepDraft('CHARGE'),
        stepKey: 'charge',
        name: '蓄力',
        sortOrder: '10',
        minimumChargeValue: formulaValue("minimum_charge_ms"),
        maximumChargeValue: formulaValue("maximum_charge_ms"),
        releaseAtMaximum: true
      }],
      effectBindings: [binding({ stepKey: 'charge' })]
    }));
    expect(charge.steps[0]?.stepType).toBe('CHARGE');

    const recast = expectValid(validProcessDraft({
      steps: [{
        ...createEmptyStepDraft('RECAST'),
        stepKey: 'recast',
        name: '重施',
        sortOrder: '10',
        windowValue: formulaValue("recast_window_ms"),
        maximumRecastCountValue: formulaValue("maximum_recasts")
      }],
      effectBindings: [binding({ stepKey: 'recast' })]
    }));
    expect(recast.steps[0]?.stepType).toBe('RECAST');

    const empowered = expectValid(validProcessDraft({
      steps: [{
        ...createEmptyStepDraft('EMPOWERED_BASIC_ATTACK'),
        stepKey: 'empowered',
        name: '强化普攻',
        sortOrder: '10',
        windowValue: formulaValue("empowered_attack_window_ms"),
        consumeMoment: 'ATTACK_HIT'
      }],
      effectBindings: [binding({ stepKey: 'empowered' })]
    }));
    expect(empowered.steps[0]?.stepType).toBe('EMPOWERED_BASIC_ATTACK');

    const switched = applyStepTypeChange({
      ...createEmptyStepDraft('DELAY'),
      delayValue: formulaValue("impact_delay_ms")
    }, 'IMMEDIATE');
    expect(clearHiddenStepFields(switched).delayValue).toEqual(null);
    expect(switched.stepType).toBe('IMMEDIATE');
  });

  it('pairs seven moment types with process-level null step keys and current draft step keys', () => {
    const processStart = expectValid(validProcessDraft({
      effectBindings: [binding({ momentType: 'PROCESS_START', stepKey: '' })]
    }));
    expect(processStart.effectBindings[0]?.moment).toEqual({
      momentType: 'PROCESS_START',
      stepKey: null
    });

    for (const momentType of ['PROCESS_COMPLETE', 'PROCESS_FAILURE'] as const) {
      const normalized = expectValid(validProcessDraft({
        effectBindings: [binding({ momentType, stepKey: '' })]
      }));
      expect(normalized.effectBindings[0]?.moment.stepKey).toBeNull();
    }

    for (const momentType of ['STEP_START', 'STEP_EXECUTION', 'STEP_COMPLETE'] as const) {
      const normalized = expectValid(validProcessDraft({
        effectBindings: [binding({ momentType, stepKey: 'hit' })]
      }));
      expect(normalized.effectBindings[0]?.moment).toEqual({ momentType, stepKey: 'hit' });
    }

    const processWithStep = validateSkillProcessDraft(validProcessDraft({
      effectBindings: [binding({ momentType: 'PROCESS_START', stepKey: 'hit' })]
    }), { includeProcessKey: true, catalog: CATALOG });
    expect(processWithStep.ok).toBe(false);
    if (processWithStep.ok) throw new Error('expected invalid');
    expect(processWithStep.bindingErrors[0]?.fieldErrors.moment).toBe('过程级时点不能携带步骤。');

    const stepWithoutKey = validateSkillProcessDraft(validProcessDraft({
      effectBindings: [binding({ momentType: 'STEP_EXECUTION', stepKey: '' })]
    }), { includeProcessKey: true, catalog: CATALOG });
    expect(stepWithoutKey.ok).toBe(false);
    if (stepWithoutKey.ok) throw new Error('expected invalid');
    expect(stepWithoutKey.bindingErrors[0]?.fieldErrors.moment).toBe('请选择步骤。');

    const unknownStep = validateSkillProcessDraft(validProcessDraft({
      effectBindings: [binding({ momentType: 'STEP_EXECUTION', stepKey: 'missing' })]
    }), { includeProcessKey: true, catalog: CATALOG });
    expect(unknownStep.ok).toBe(false);
    if (unknownStep.ok) throw new Error('expected invalid');
    expect(unknownStep.bindingErrors[0]?.fieldErrors.moment).toBe('请选择当前过程中的步骤。');
  });

  it('rejects timeout moments except on charge, recast and empowered steps', () => {
    const invalidTimeout = validateSkillProcessDraft(validProcessDraft({
      effectBindings: [binding({ momentType: 'STEP_TIMEOUT', stepKey: 'hit' })]
    }), { includeProcessKey: true, catalog: CATALOG });
    expect(invalidTimeout.ok).toBe(false);
    if (invalidTimeout.ok) throw new Error('expected invalid');
    expect(invalidTimeout.bindingErrors[0]?.fieldErrors.moment)
      .toBe('超时时点只允许蓄力、重施或强化下一次普通攻击步骤。');

    const chargeTimeout = expectValid(validProcessDraft({
      steps: [{
        ...createEmptyStepDraft('CHARGE'),
        stepKey: 'charge',
        name: '蓄力',
        sortOrder: '10',
        minimumChargeValue: formulaValue("minimum_charge_ms"),
        maximumChargeValue: formulaValue("maximum_charge_ms"),
        releaseAtMaximum: false
      }],
      effectBindings: [binding({ momentType: 'STEP_TIMEOUT', stepKey: 'charge' })]
    }));
    expect(chargeTimeout.effectBindings[0]?.moment).toEqual({
      momentType: 'STEP_TIMEOUT',
      stepKey: 'charge'
    });
  });

  it('builds cooldown, effect bindings and state operations into a complete request', () => {
    const normalized = expectValid(validProcessDraft({
      cooldownEnabled: true,
      cooldownDurationValue: formulaValue("cooldown_ms"),
      cooldownMomentType: 'PROCESS_START',
      cooldownStepKey: '',
      effectBindings: [
        binding(),
        binding({
          bindingKey: 'mana_cost',
          effectKey: 'mana_cost',
          momentType: 'PROCESS_START',
          stepKey: '',
          sortOrder: '5'
        })
      ],
      stateOperations: [
        consumeOp(),
        {
          ...createEmptyStateOperationDraft(),
          operationKey: 'select_rocket',
          name: '选择火箭',
          stateKey: 'weapon_mode',
          operation: 'SELECT',
          optionKey: 'rocket',
          momentType: 'PROCESS_COMPLETE',
          sortOrder: '20'
        },
        {
          ...createEmptyStateOperationDraft(),
          operationKey: 'enable_ready',
          name: '启用准备',
          stateKey: 'ready',
          operation: 'ENABLE',
          momentType: 'STEP_COMPLETE',
          stepKey: 'hit',
          sortOrder: '30'
        },
        {
          ...createEmptyStateOperationDraft(),
          operationKey: 'start_cd',
          name: '开始内部冷却',
          stateKey: 'internal_cd',
          operation: 'START',
          momentType: 'PROCESS_START',
          sortOrder: '40'
        },
        {
          ...createEmptyStateOperationDraft(),
          operationKey: 'reset_focus',
          name: '重置专注',
          stateKey: 'focus_stacks',
          operation: 'RESET',
          momentType: 'PROCESS_FAILURE',
          sortOrder: '50'
        }
      ]
    }));
    expect(normalized.cooldown).toEqual({
      durationValue: formulaValue("cooldown_ms"),
      startMoment: { momentType: 'PROCESS_START', stepKey: null }
    });
    expect(normalized.effectBindings.map((item) => item.bindingKey)).toEqual(['mana_cost', 'hit_results']);
    expect(normalized.stateOperations.map((item) => item.operation)).toEqual([
      'CONSUME',
      'SELECT',
      'ENABLE',
      'START',
      'RESET'
    ]);
    expect(normalized.stateOperations.find((item) => item.operation === 'SELECT')).toMatchObject({
      optionKey: 'rocket',
      value: null
    });
    expect(normalized.stateOperations.find((item) => item.operation === 'RESET')).toMatchObject({
      value: null,
      optionKey: null
    });
    const created = buildCreateSkillProcessRequest(normalized);
    expect(created.processKey).toBe('primary_cast');
    expect(buildUpdateSkillProcessRequest(normalized)).not.toHaveProperty('processKey');
  });

  it('saves a cooldown-only cast without inventing resource or hit effects', () => {
    const normalized = expectValid(validProcessDraft({
      cooldownEnabled: true,
      cooldownDurationValue: formulaValue('cooldown_ms'),
      cooldownMomentType: 'PROCESS_START',
      effectBindings: [],
      stateOperations: []
    }));
    const request = buildCreateSkillProcessRequest(normalized);
    expect(request.cooldown).toEqual({
      durationValue: formulaValue('cooldown_ms'),
      startMoment: { momentType: 'PROCESS_START', stepKey: null }
    });
    expect(request.effectBindings).toEqual([]);
    expect(request.stateOperations).toEqual([]);
    expect(buildUpdateSkillProcessRequest(normalized).cooldown).toEqual(request.cooldown);
  });

  it('still rejects an unresolved cooldown when it is the only cast behavior', () => {
    const result = validateSkillProcessDraft(validProcessDraft({
      cooldownEnabled: true,
      cooldownDurationValue: formulaValue('missing_cooldown'),
      cooldownMomentType: 'PROCESS_START',
      effectBindings: [],
      stateOperations: []
    }), { includeProcessKey: true, catalog: CATALOG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid cooldown');
    expect(result.fieldErrors.cooldownDurationValue).toBe(INCOMPLETE_CATALOG_MESSAGE);
  });

  it('marks both behavior arrays when all three behavior sources are empty and rejects empty or duplicate keys', () => {
    const emptyBehaviors = validateSkillProcessDraft(validProcessDraft({
      effectBindings: [],
      stateOperations: []
    }), { includeProcessKey: true, catalog: CATALOG });
    expect(emptyBehaviors.ok).toBe(false);
    if (emptyBehaviors.ok) throw new Error('expected invalid');
    expect(emptyBehaviors.fieldErrors.effectBindings).toBe(PROCESS_BEHAVIOR_REQUIRED_MESSAGE);
    expect(emptyBehaviors.fieldErrors.stateOperations).toBe(PROCESS_BEHAVIOR_REQUIRED_MESSAGE);

    const emptySteps = validateSkillProcessDraft(validProcessDraft({ steps: [] }), {
      includeProcessKey: true,
      catalog: CATALOG
    });
    expect(emptySteps.ok).toBe(false);
    if (emptySteps.ok) throw new Error('expected invalid');
    expect(emptySteps.fieldErrors.steps).toBe('至少需要一个步骤。');

    const duplicateSteps = validateSkillProcessDraft(validProcessDraft({
      steps: [immediateStep(), immediateStep({ name: '第二命中', sortOrder: '20' })]
    }), { includeProcessKey: true, catalog: CATALOG });
    expect(duplicateSteps.ok).toBe(false);
    if (duplicateSteps.ok) throw new Error('expected invalid');
    expect(duplicateSteps.stepErrors.some((item) => item.fieldErrors.stepKey === '步骤标识不能重复。')).toBe(true);
  });

  it('blocks immutable step and operation kinds, referenced step deletion and unknown catalog refs', () => {
    const typeChanged = validateSkillProcessDraft(validProcessDraft({
      steps: [immediateStep({ originalStepType: 'IMMEDIATE', stepType: 'DELAY', delayValue: formulaValue("impact_delay_ms") })]
    }), { includeProcessKey: true, catalog: CATALOG });
    expect(typeChanged.ok).toBe(false);
    if (typeChanged.ok) throw new Error('expected invalid');
    expect(typeChanged.stepErrors[0]?.fieldErrors.stepType).toBe('已有步骤的种类不可修改。');

    const operationChanged = validateSkillProcessDraft(validProcessDraft({
      effectBindings: [],
      stateOperations: [consumeOp({ originalOperation: 'CONSUME', operation: 'INCREASE' })]
    }), { includeProcessKey: true, catalog: CATALOG });
    expect(operationChanged.ok).toBe(false);
    if (operationChanged.ok) throw new Error('expected invalid');
    expect(operationChanged.operationErrors[0]?.fieldErrors.operation).toBe('已有操作的种类不可修改。');

    const blockers = findStepDeleteBlockers('hit', validProcessDraft({
      cooldownEnabled: true,
      cooldownMomentType: 'STEP_EXECUTION',
      cooldownStepKey: 'hit',
      stateOperations: [consumeOp({ momentType: 'STEP_COMPLETE', stepKey: 'hit' })]
    }));
    expect(blockers.map((item) => item.area).sort()).toEqual(['cooldown', 'effectBindings', 'stateOperations']);

    const unknownEffect = validateSkillProcessDraft(validProcessDraft({
      effectBindings: [binding({ effectKey: 'missing_effect' })]
    }), { includeProcessKey: true, catalog: CATALOG });
    expect(unknownEffect.ok).toBe(false);
    if (unknownEffect.ok) throw new Error('expected invalid');
    expect(unknownEffect.bindingErrors[0]?.fieldErrors.effectKey).toBe(INCOMPLETE_CATALOG_MESSAGE);

    const unknownFormula = validateSkillProcessDraft(validProcessDraft({
      cooldownEnabled: true,
      cooldownDurationValue: formulaValue("missing_cd"),
      cooldownMomentType: 'PROCESS_START'
    }), { includeProcessKey: true, catalog: CATALOG });
    expect(unknownFormula.ok).toBe(false);
    if (unknownFormula.ok) throw new Error('expected invalid');
    expect(unknownFormula.fieldErrors.cooldownDurationValue).toBe(INCOMPLETE_CATALOG_MESSAGE);
  });

  it('maps server field issues onto the submitted array indexes', () => {
    const mapped = mapSkillProcessFieldIssues(new ApiRequestError('invalid', 400, '400.VALIDATION_FAILED', {
      fieldIssues: [
        { field: 'steps[1].detail.intervalValue', message: '间隔取值不存在。' },
        { field: 'effectBindings[0].moment.stepKey', message: '未知步骤。' },
        { field: 'stateOperations[2].optionKey', message: '未知模式选项。' },
        { field: 'cooldown.durationValue', message: '冷却公式不存在。' }
      ]
    }));
    expect(mapped.stepErrors).toEqual([
      { index: 1, fieldErrors: { intervalValue: "间隔取值不存在。" } }
    ]);
    expect(mapped.bindingErrors).toEqual([
      { index: 0, fieldErrors: { stepKey: '未知步骤。' } }
    ]);
    expect(mapped.operationErrors).toEqual([
      { index: 2, fieldErrors: { optionKey: '未知模式选项。' } }
    ]);
    expect(mapped.fieldErrors.cooldownDurationValue).toBe('冷却公式不存在。');
  });
});
