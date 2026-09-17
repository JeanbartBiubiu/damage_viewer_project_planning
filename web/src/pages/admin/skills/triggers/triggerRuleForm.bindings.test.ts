import { formulaValue } from '../../../../types/numericValue';
import { describe, expect, it } from 'vitest';
import type { SkillEffect, SkillEffectResult } from '../../../../types/skillEffect';
import type { SkillFormula } from '../../../../types/skillFormula';
import type { SkillInternalState } from '../../../../types/skillInternalState';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillProcess } from '../../../../types/skillProcess';
import type { SkillTriggerResultModifier } from '../../../../types/skillTriggerRule';
import {
  FORBIDDEN_PRIOR_RESULT_OUTPUT_KINDS,
  SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_LABELS,
  collectDirectFormulaKeys,
  collectExecuteEffectFormulaKeys,
  collectFormulaParameterKeys,
  collectStartProcessFormulaKeys,
  createEmptyActionDraft,
  createEmptyBinding,
  createEmptyConditionDraft,
  createEmptyRuleDraft,
  createFormulaSessionCache,
  evaluateBindingCompleteness,
  formulaHasRuntimeInput,
  hasNumericValueRule,
  isAllowedPriorResultOutputKind,
  isBindingTypeCompatible,
  isImmediateNumericResult,
  listImmediatePriorResults,
  persistentStatusApplyResults,
  reachableRuntimeInputParameters,
  sourceValueDomain,
  validateResultModifier,
  validateSkillTriggerDraft,
  type SkillTriggerExecuteEffectActionDraft,
  type SkillTriggerRuleDraft
} from './triggerRuleForm';

const STAMP = {
  gameId: 'lol',
  skillKey: 'ashe_q',
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z'
} as const;

function parameter(overrides: Pick<SkillParameter, 'parameterKey' | 'name' | 'valueType' | 'valueMode'> & Partial<SkillParameter>): SkillParameter {
  return {
    ...STAMP,
    fixedValue: null,
    levelValues: null,
    description: null,
    sortOrder: 10,
    ...overrides
  };
}

function formula(formulaKey: string, expression: SkillFormula['expression']): SkillFormula {
  return {
    ...STAMP,
    formulaKey,
    name: formulaKey,
    description: null,
    sortOrder: 10,
    expression
  };
}

function damageResult(
  resultKey: string,
  formulaKey: string,
  lifecycleBehavior: SkillEffectResult['lifecycleBehavior'] = null
): SkillEffectResult {
  return {
    resultKey,
    name: resultKey,
    resultType: 'DAMAGE',
    target: 'TARGET',
    description: null,
    sortOrder: 10,
    lifecycleBehavior,
    valueRule: { value: formulaValue(formulaKey), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
    detail: {
      damageTypeKey: 'physical',
      deliveryKind: 'SKILL',
      originKind: 'DIRECT',
      critical: { mode: 'DISALLOWED', multiplierValue: null },
      vampRules: []
    }
  };
}

function effect(
  effectKey: string,
  results: SkillEffectResult[],
  lifecycle: SkillEffect['lifecycle'] = null
): SkillEffect {
  return {
    ...STAMP,
    effectKey,
    name: effectKey,
    description: null,
    sortOrder: 10,
    lifecycle,
    results
  };
}

function executeAction(
  actionKey: string,
  effectKey: string,
  sortOrder: string,
  bindings: SkillTriggerExecuteEffectActionDraft['runtimeInputBindings'] = []
): SkillTriggerExecuteEffectActionDraft {
  return {
    ...createEmptyActionDraft([], 'EXECUTE_EFFECT'),
    actionKey,
    name: actionKey,
    sortOrder,
    detail: { effectKey },
    runtimeInputBindings: bindings,
    resultModifiers: []
  };
}

const RUNTIME_HIT = parameter({
  parameterKey: 'prior_hit_value',
  name: '前序命中值',
  valueType: 'DECIMAL',
  valueMode: 'RUNTIME_INPUT'
});
const RUNTIME_STACKS = parameter({
  parameterKey: 'focus_stacks_input',
  name: '专注层数输入',
  valueType: 'INTEGER',
  valueMode: 'RUNTIME_INPUT'
});
const FIXED_RATIO = parameter({
  parameterKey: 'low_health_ratio',
  name: '低生命比例',
  valueType: 'DECIMAL',
  valueMode: 'FIXED',
  fixedValue: 0.3
});

const FOLLOW_UP = formula('follow_up', { nodeType: 'PARAMETER', parameterKey: 'prior_hit_value' });
const STACK_FORMULA = formula('stack_scale', { nodeType: 'PARAMETER', parameterKey: 'focus_stacks_input' });
const THRESHOLD = formula('hp_threshold', { nodeType: 'PARAMETER', parameterKey: 'low_health_ratio' });
const ATTRIBUTE_ONLY = formula('current_hp', {
  nodeType: 'ATTRIBUTE',
  attributeOwner: 'TARGET',
  attributeKey: 'hp',
  attributeValueKind: 'CURRENT'
});
const NESTED = formula('nested_scale', {
  nodeType: 'OPERATION',
  operation: 'MULTIPLY',
  operands: [
    { nodeType: 'PARAMETER', parameterKey: 'prior_hit_value' },
    { nodeType: 'PARAMETER', parameterKey: 'focus_stacks_input' }
  ]
});

const HIT_EFFECT = effect('on_hit_damage', [damageResult('damage', 'follow_up')]);
const MARK_EFFECT = effect('focus_mark', [
  {
    resultKey: 'apply_mark',
    name: '施加标记',
    resultType: 'STATUS_OPERATION',
    target: 'TARGET',
    description: null,
    sortOrder: 10,
    lifecycleBehavior: {
      moment: 'PERSISTENT',
      valueReadMode: null,
      stackValueMode: null,
      reapplicationValueMode: null,
      periodicExecutionMode: null
    },
    valueRule: null,
    detail: { statusKey: 'focus_mark', operation: 'APPLY' }
  },
  damageResult('full_stack_burst', 'follow_up', {
    moment: 'FULL_STACKS',
    valueReadMode: 'MOMENT_EVALUATION',
    stackValueMode: 'SHARED',
    reapplicationValueMode: null,
    periodicExecutionMode: null
  })
], {
  durationValue: formulaValue("mark_duration_ms"),
  maxStacksValue: formulaValue("five"),
  applicationStacksValue: formulaValue("one"),
  instanceScope: 'SOURCE_TARGET',
  reapplicationStackMode: 'INCREASE',
  reapplicationDurationMode: 'REFRESH_ALL',
  expiryMode: 'ALL_AT_ONCE',
  periodicIntervalValue: null,
  firstPeriodicExecution: null
});

const COOLDOWN_STATE: SkillInternalState = {
  ...STAMP,
  stateKey: 'internal_cd',
  name: '内部冷却',
  stateType: 'INTERNAL_COOLDOWN',
  scope: 'SKILL',
  description: null,
  sortOrder: 10,
  detail: { durationValue: formulaValue("internal_cd_ms") }
};

const CHARGE_PROCESS: SkillProcess = {
  ...STAMP,
  processKey: 'charge_cast',
  name: '蓄力施放',
  activationType: 'ACTIVE',
  description: null,
  sortOrder: 10,
  cooldown: {
    durationValue: formulaValue("process_cooldown_ms"),
    startMoment: { momentType: 'PROCESS_START', stepKey: null }
  },
  steps: [
    {
      stepKey: 'charge',
      name: '蓄力',
      description: null,
      sortOrder: 10,
      stepType: 'CHARGE',
      detail: {
        minimumChargeValue: formulaValue("min_charge_ms"),
        maximumChargeValue: formulaValue("max_charge_ms"),
        releaseAtMaximum: true
      }
    }
  ],
  effectBindings: [
    {
      bindingKey: 'hit_on_release',
      effectKey: 'on_hit_damage',
      moment: { momentType: 'STEP_COMPLETE', stepKey: 'charge' },
      sortOrder: 10
    }
  ],
  stateOperations: [
    {
      operationKey: 'start_cd',
      name: '开始冷却',
      stateKey: 'internal_cd',
      operation: 'START',
      value: null,
      optionKey: null,
      moment: { momentType: 'PROCESS_START', stepKey: null },
      sortOrder: 10
    }
  ]
};

describe('formula session cache and reachable RUNTIME_INPUT collection', () => {
  it('de-duplicates formula details by game/skill/formula key inside the session cache', () => {
    const cache = createFormulaSessionCache();
    cache.set('lol', 'ashe_q', 'follow_up', FOLLOW_UP);
    cache.set('lol', 'ashe_w', 'follow_up', { ...FOLLOW_UP, skillKey: 'ashe_w' });
    cache.set('lol', 'ashe_q', 'follow_up', { ...FOLLOW_UP, name: '覆盖后的追加' });
    expect(cache.has('lol', 'ashe_q', 'follow_up')).toBe(true);
    expect(cache.get('lol', 'ashe_q', 'follow_up')?.name).toBe('覆盖后的追加');
    expect(cache.get('lol', 'ashe_w', 'follow_up')?.skillKey).toBe('ashe_w');
    expect(cache.keys()).toEqual(['lol/ashe_q/follow_up', 'lol/ashe_w/follow_up']);
  });

  it('collects nested parameter keys, skips attributes, and de-duplicates effect/process formula keys', () => {
    expect(collectFormulaParameterKeys(NESTED.expression)).toEqual([
      'prior_hit_value',
      'focus_stacks_input'
    ]);
    expect(collectFormulaParameterKeys(ATTRIBUTE_ONLY.expression)).toEqual([]);
    expect(formulaHasRuntimeInput(FOLLOW_UP, [RUNTIME_HIT, FIXED_RATIO])).toBe(true);
    expect(formulaHasRuntimeInput(THRESHOLD, [RUNTIME_HIT, FIXED_RATIO])).toBe(false);
    expect(formulaHasRuntimeInput(undefined, [RUNTIME_HIT])).toBe(false);

    const specialDamage = damageResult('echo', 'follow_up');
    if (specialDamage.resultType === 'DAMAGE') {
      specialDamage.detail.critical = {
        mode: 'SOURCE_CRIT_CHANCE',
        multiplierValue: formulaValue("critical_multiplier")
      };
      specialDamage.detail.vampRules = [{
        vampType: 'OMNIVAMP',
        basisOutputKind: 'ACTUAL_HP_LOSS',
        efficiencyValue: formulaValue("omnivamp_efficiency")
      }];
    }
    const duplicateResults = effect('scaled_hit', [
      damageResult('main', 'follow_up'),
      specialDamage
    ], {
      durationValue: formulaValue("mark_duration_ms"),
      maxStacksValue: formulaValue("five"),
      applicationStacksValue: formulaValue("five"),
      instanceScope: 'SKILL',
      reapplicationStackMode: 'KEEP',
      reapplicationDurationMode: 'KEEP_REMAINING',
      expiryMode: 'ALL_AT_ONCE',
      periodicIntervalValue: formulaValue("tick_ms"),
      firstPeriodicExecution: 'AFTER_INTERVAL'
    });
    expect(collectExecuteEffectFormulaKeys(duplicateResults)).toEqual([
      'follow_up',
      'critical_multiplier',
      'omnivamp_efficiency',
      'mark_duration_ms',
      'five',
      'tick_ms'
    ]);

    const formulaKeys = collectStartProcessFormulaKeys(
      CHARGE_PROCESS,
      new Map([['on_hit_damage', HIT_EFFECT]]),
      new Map([['internal_cd', COOLDOWN_STATE]])
    );
    expect(formulaKeys).toEqual([
      'process_cooldown_ms',
      'min_charge_ms',
      'max_charge_ms',
      'internal_cd_ms',
      'follow_up'
    ]);
  });

  it('collects execute and link result formulas into execute-effect and start-process reachable keys', () => {
    const special = effect('special_results', [
      {
        resultKey: 'execute',
        name: '斩杀',
        resultType: 'EXECUTE',
        target: 'TARGET',
        description: null,
        sortOrder: 10,
        spellShieldBlockScope: null,
        lifecycleBehavior: null,
        valueRule: { value: formulaValue("execute_threshold"), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: { attributeKey: 'hp' }
      },
      {
        resultKey: 'hit_link',
        name: '命中联动',
        resultType: 'HIT_LINK_APPLICATION',
        target: 'TARGET',
        description: null,
        sortOrder: 20,
        spellShieldBlockScope: null,
        lifecycleBehavior: null,
        valueRule: { value: formulaValue("hit_link_count"), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: {}
      },
      {
        resultKey: 'attack_link',
        name: '攻击联动',
        resultType: 'ATTACK_LINK_APPLICATION',
        target: 'TARGET',
        description: null,
        sortOrder: 30,
        spellShieldBlockScope: null,
        lifecycleBehavior: null,
        valueRule: { value: formulaValue("attack_link_count"), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: {}
      }
    ]);
    expect(collectExecuteEffectFormulaKeys(special)).toEqual([
      'execute_threshold',
      'hit_link_count',
      'attack_link_count'
    ]);
    const processWithSpecial = {
      ...CHARGE_PROCESS,
      effectBindings: [{
        bindingKey: 'hit_on_release',
        effectKey: 'special_results',
        moment: { momentType: 'STEP_COMPLETE' as const, stepKey: 'charge' },
        sortOrder: 10
      }]
    };
    expect(collectStartProcessFormulaKeys(
      processWithSpecial,
      new Map([['special_results', special]]),
      new Map([['internal_cd', COOLDOWN_STATE]])
    )).toEqual(expect.arrayContaining([
      'execute_threshold',
      'hit_link_count',
      'attack_link_count'
    ]));
  });

  it('returns only referenced RUNTIME_INPUT parameters and keeps each parameter once', () => {
    const formulas = new Map([
      ['follow_up', FOLLOW_UP],
      ['stack_scale', STACK_FORMULA],
      ['nested_scale', NESTED],
      ['current_hp', ATTRIBUTE_ONLY]
    ]);
    const parameters = [RUNTIME_HIT, RUNTIME_STACKS, FIXED_RATIO];
    expect(reachableRuntimeInputParameters([formulaValue('follow_up'), formulaValue('follow_up')], formulas, parameters)).toEqual([
      RUNTIME_HIT
    ]);
    expect(reachableRuntimeInputParameters([formulaValue('nested_scale'), formulaValue('current_hp')], formulas, parameters)).toEqual([
      RUNTIME_HIT,
      RUNTIME_STACKS
    ]);
    expect(reachableRuntimeInputParameters([formulaValue('missing')], formulas, parameters)).toEqual([]);
  });
});

describe('reflected damage form protection', () => {
  it('requires damage taken, event source target, and a direct-only filter or cooldown', () => {
    const reflectedResult = damageResult('reflect', 'follow_up');
    if (reflectedResult.resultType === 'DAMAGE') {
      reflectedResult.detail.originKind = 'REFLECTED';
    }
    const reflectedEffect = effect('reflect_damage', [reflectedResult]);
    const action = executeAction('reflect', 'reflect_damage', '10');
    const draft: SkillTriggerRuleDraft = {
      ...createEmptyRuleDraft(),
      ruleKey: 'reflect_rule',
      name: '反伤',
      actions: [action]
    };
    const invalid = validateSkillTriggerDraft(draft, {
      includeRuleKey: true,
      effectsByKey: new Map([[reflectedEffect.effectKey, reflectedEffect]])
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.nestedErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'eventSource.eventType' }),
        expect.objectContaining({ path: 'actions[0].targetContext' })
      ]));
    }

    const valid = validateSkillTriggerDraft({
      ...draft,
      eventSource: {
        eventType: 'DAMAGE_TAKEN',
        detail: { damageTypeKey: null, deliveryKind: 'ANY', originKind: 'DIRECT' }
      },
      actions: [{ ...action, targetContext: 'EVENT_SOURCE' }]
    }, {
      includeRuleKey: true,
      effectsByKey: new Map([[reflectedEffect.effectKey, reflectedEffect]])
    });
    expect(valid.ok).toBe(true);
  });
});

describe('binding completeness missing, duplicate, extra and type compatibility', () => {
  it('treats INTEGER sources as compatible with INTEGER or DECIMAL, and DECIMAL only with DECIMAL', () => {
    expect(isBindingTypeCompatible('INTEGER', 'INTEGER')).toBe(true);
    expect(isBindingTypeCompatible('INTEGER', 'DECIMAL')).toBe(true);
    expect(isBindingTypeCompatible('DECIMAL', 'DECIMAL')).toBe(true);
    expect(isBindingTypeCompatible('DECIMAL', 'INTEGER')).toBe(false);
    expect(sourceValueDomain(createEmptyBinding([], 'EVENT_VALUE'))).toBe('INTEGER');
    expect(sourceValueDomain({
      ...createEmptyBinding([], 'EVENT_VALUE'),
      detail: { eventValueKey: 'CHARGE_DURATION_MS' }
    })).toBe('DECIMAL');
    expect(sourceValueDomain(createEmptyBinding([], 'PRIOR_ACTION_RESULT'))).toBe('DECIMAL');
    expect(sourceValueDomain({
      ...createEmptyBinding([], 'INTERNAL_STATE'),
      detail: { stateKey: 'internal_cd', valueKind: 'REMAINING_MS', optionKey: null }
    })).toBe('DECIMAL');
    expect(sourceValueDomain({
      ...createEmptyBinding([], 'COMBAT_STATUS'),
      detail: {
        subject: 'CURRENT_TARGET',
        statusKey: 'focus_mark',
        valueKind: 'STACKS',
        sourceEffectKey: 'focus_mark',
        sourceResultKey: 'apply_mark'
      }
    })).toBe('INTEGER');
  });

  it('flags missing, duplicate, extra and type-incompatible bindings', () => {
    const reachable = [RUNTIME_HIT, RUNTIME_STACKS];
    const missing = evaluateBindingCompleteness(reachable, []);
    expect(missing).toEqual([
      {
        parameterKey: 'prior_hit_value',
        name: '前序命中值',
        valueType: 'DECIMAL',
        missing: true,
        duplicate: false,
        extra: false,
        typeCompatible: null,
        summary: '缺少绑定'
      },
      {
        parameterKey: 'focus_stacks_input',
        name: '专注层数输入',
        valueType: 'INTEGER',
        missing: true,
        duplicate: false,
        extra: false,
        typeCompatible: null,
        summary: '缺少绑定'
      }
    ]);

    const hitBinding = {
      ...createEmptyBinding([], 'PRIOR_ACTION_RESULT'),
      bindingKey: 'bind_hit',
      parameterKey: 'prior_hit_value'
    };
    const integerEventForDecimal = {
      ...createEmptyBinding([], 'EVENT_VALUE'),
      bindingKey: 'bind_hit_index',
      parameterKey: 'prior_hit_value',
      detail: { eventValueKey: 'HIT_INDEX' as const }
    };
    const compatible = evaluateBindingCompleteness([RUNTIME_HIT], [hitBinding]);
    expect(compatible[0]).toMatchObject({
      missing: false,
      duplicate: false,
      extra: false,
      typeCompatible: true
    });
    expect(compatible[0].summary).toContain(SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_LABELS.CONFIGURED_VALUE);

    const duplicate = evaluateBindingCompleteness([RUNTIME_HIT], [hitBinding, integerEventForDecimal]);
    expect(duplicate[0].duplicate).toBe(true);
    expect(duplicate[0].missing).toBe(false);

    const extra = evaluateBindingCompleteness([RUNTIME_STACKS], [hitBinding]);
    expect(extra).toEqual([
      {
        parameterKey: 'focus_stacks_input',
        name: '专注层数输入',
        valueType: 'INTEGER',
        missing: true,
        duplicate: false,
        extra: false,
        typeCompatible: null,
        summary: '缺少绑定'
      },
      {
        parameterKey: 'prior_hit_value',
        name: 'prior_hit_value',
        valueType: 'DECIMAL',
        missing: false,
        duplicate: false,
        extra: true,
        typeCompatible: null,
        summary: '未使用绑定'
      }
    ]);

    const chargeForInteger = {
      ...createEmptyBinding([], 'EVENT_VALUE'),
      bindingKey: 'bind_charge',
      parameterKey: 'focus_stacks_input',
      detail: { eventValueKey: 'CHARGE_DURATION_MS' as const }
    };
    const incompatible = evaluateBindingCompleteness([RUNTIME_STACKS], [chargeForInteger]);
    expect(incompatible[0]).toMatchObject({
      missing: false,
      extra: false,
      typeCompatible: false
    });
  });
});

describe('prior results: earlier EXECUTE_EFFECT immediate configured value only', () => {
  it('lists only earlier execute-effect immediate numeric results as CONFIGURED_VALUE', () => {
    const applicationHit = effect('application_hit', [
      damageResult('damage', 'follow_up', {
        moment: 'APPLICATION',
        valueReadMode: 'APPLICATION_SNAPSHOT',
        stackValueMode: null,
        reapplicationValueMode: null,
        periodicExecutionMode: null
      })
    ], MARK_EFFECT.lifecycle);
    const actions = [
      executeAction('first_hit', 'on_hit_damage', '10'),
      {
        ...createEmptyActionDraft([], 'START_PROCESS'),
        actionKey: 'start_cast',
        name: '启动',
        sortOrder: '20',
        detail: { processKey: 'charge_cast' }
      },
      executeAction('second_hit', 'application_hit', '30'),
      executeAction('third_hit', 'focus_mark', '40'),
      {
        ...createEmptyActionDraft([], 'FAIL_PROCESS'),
        actionKey: 'fail_cast',
        name: '失败',
        sortOrder: '50',
        detail: { processKey: 'charge_cast', failureReason: 'CONTROLLED' }
      }
    ];
    const effectsByKey = new Map([
      ['on_hit_damage', HIT_EFFECT],
      ['application_hit', applicationHit],
      ['focus_mark', MARK_EFFECT]
    ]);
    expect(listImmediatePriorResults(actions, 2, effectsByKey)).toEqual([
      {
        sourceActionKey: 'first_hit',
        sourceActionName: 'first_hit',
        sourceEffectKey: 'on_hit_damage',
        sourceResultKey: 'damage',
        sourceResultName: 'damage'
      }
    ]);
    const forThird = listImmediatePriorResults(actions, 3, effectsByKey);
    expect(forThird.map((item) => `${item.sourceActionKey}:${item.sourceResultKey}`)).toEqual([
      'first_hit:damage',
      'second_hit:damage'
    ]);
    expect(listImmediatePriorResults(actions, 0, effectsByKey)).toEqual([]);
  });

  it('excludes lifecycle non-application results and Stage 7.6 output kinds', () => {
    expect(FORBIDDEN_PRIOR_RESULT_OUTPUT_KINDS).toEqual([
      'MODIFIER_ZONE_SUM',
      'MODIFIER_ZONE_FACTOR',
      'FINAL_MODIFIED_VALUE',
      'ZONE_ADDEND'
    ]);
    for (const kind of FORBIDDEN_PRIOR_RESULT_OUTPUT_KINDS) {
      expect(isAllowedPriorResultOutputKind(kind)).toBe(false);
    }
    expect(isAllowedPriorResultOutputKind('CONFIGURED_VALUE')).toBe(true);
    expect(isAllowedPriorResultOutputKind('KILLED')).toBe(true);
    expect(isAllowedPriorResultOutputKind('ACTUAL_HP_LOSS')).toBe(true);

    const actions = [
      executeAction('mark_action', 'focus_mark', '10'),
      executeAction('follow', 'on_hit_damage', '20')
    ];
    expect(listImmediatePriorResults(actions, 1, new Map([['focus_mark', MARK_EFFECT]]))).toEqual([]);
    expect(persistentStatusApplyResults(MARK_EFFECT, 'focus_mark').map((item) => item.resultKey)).toEqual([
      'apply_mark'
    ]);
    expect(persistentStatusApplyResults(HIT_EFFECT, 'focus_mark')).toEqual([]);
  });

  it('rejects a later or non-immediate prior-result binding during draft validation', () => {
    const draft: SkillTriggerRuleDraft = {
      ...createEmptyRuleDraft(),
      ruleKey: 'prior_scale',
      name: '前序驱动',
      sortOrder: '10',
      actions: [
        executeAction('first_hit', 'on_hit_damage', '10'),
        executeAction('second_hit', 'follow_effect', '20', [
          {
            bindingKey: 'bind_prior',
            parameterKey: 'prior_hit_value',
            sourceType: 'PRIOR_ACTION_RESULT',
            detail: {
              sourceActionKey: 'first_hit',
              sourceResultKey: 'full_stack_burst',
              outputKind: 'CONFIGURED_VALUE'
            }
          }
        ])
      ]
    };
    const invalid = validateSkillTriggerDraft(draft, {
      includeRuleKey: true,
      effectsByKey: new Map([
        ['on_hit_damage', HIT_EFFECT],
        ['follow_effect', effect('follow_effect', [damageResult('damage', 'follow_up')])]
      ])
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error('expected invalid prior result');
    expect(invalid.nestedErrors).toContainEqual({
      path: 'actions[1].runtimeInputBindings[0].detail.sourceActionKey',
      message: '前序结果必须来自更早的执行效果动作及其即时合法输出。'
    });
  });
});

describe('fixed result modifier validation and numeric-result eligibility', () => {
  it('requires a non-empty numeric modifier with non-negative multiplier and min <= max', () => {
    const empty: SkillTriggerResultModifier = {
      resultKey: 'damage',
      fixedMultiplier: null,
      fixedMinValue: null,
      fixedMaxValue: null
    };
    expect(validateResultModifier(empty)).toBe('固定结果修正至少需要一项非空。');
    expect(validateResultModifier({ ...empty, fixedMultiplier: -0.1 })).toBe('额外固定倍率不能小于 0。');
    expect(validateResultModifier({
      ...empty,
      fixedMinValue: 20,
      fixedMaxValue: 10
    })).toBe('额外固定最小值不能大于额外固定最大值。');
    expect(validateResultModifier({ ...empty, fixedMultiplier: 0 })).toBeNull();
    expect(validateResultModifier({
      ...empty,
      fixedMinValue: 10,
      fixedMaxValue: 10
    })).toBeNull();
  });

  it('treats valueRule results as numeric and only APPLICATION or no-lifecycle as immediate', () => {
    const immediate = damageResult('damage', 'follow_up');
    expect(hasNumericValueRule(immediate)).toBe(true);
    expect(isImmediateNumericResult(immediate)).toBe(true);
    expect(isImmediateNumericResult(damageResult('damage', 'follow_up', {
      moment: 'APPLICATION',
      valueReadMode: 'APPLICATION_SNAPSHOT',
      stackValueMode: null,
      reapplicationValueMode: null,
      periodicExecutionMode: null
    }))).toBe(true);
    for (const moment of ['PERSISTENT', 'FULL_STACKS', 'PERIODIC', 'NATURAL_END', 'EARLY_REMOVE'] as const) {
      expect(isImmediateNumericResult(damageResult('damage', 'follow_up', {
        moment,
        valueReadMode: 'MOMENT_EVALUATION',
        stackValueMode: 'SHARED',
        reapplicationValueMode: null,
        periodicExecutionMode: null
      }))).toBe(false);
    }
    const statusApply = MARK_EFFECT.results[0];
    expect(hasNumericValueRule(statusApply)).toBe(false);
    expect(isImmediateNumericResult(statusApply)).toBe(false);
  });

  it('collects only event, condition and protection formulas as direct formula keys', () => {
    const draft: SkillTriggerRuleDraft = {
      ...createEmptyRuleDraft(),
      eventSource: {
        eventType: 'HEALTH_THRESHOLD_CROSSED',
        detail: {
          subject: 'SOURCE',
          attributeKey: 'hp',
          thresholdValue: formulaValue("hp_threshold"),
          direction: 'DOWNWARD'
        }
      },
      perTargetCooldownEnabled: true,
      perTargetCooldownDurationValue: formulaValue("per_target_cooldown_ms"),
      maxTriggersPerProcessEnabled: true,
      maxTriggersLimitValue: formulaValue("max_triggers"),
      conditionGroups: [
        {
          groupKey: 'group_1',
          name: '条件',
          draftId: 'binding-draft',
          sortOrder: '10',
          conditions: [
            {
              ...createEmptyConditionDraft([], 'ATTRIBUTE_COMPARE'),
              conditionKey: 'hp_low',
              sortOrder: '10',
              detail: {
                subject: 'SOURCE',
                attributeKey: 'hp',
                attributeValueKind: 'CURRENT_RATIO',
                comparator: 'LTE',
                comparisonValue: formulaValue("low_health_ratio_formula")
              }
            }
          ]
        }
      ]
    };
    expect(collectDirectFormulaKeys(draft).sort()).toEqual([
      'hp_threshold',
      'low_health_ratio_formula',
      'max_triggers',
      'per_target_cooldown_ms'
    ]);
  });
});
