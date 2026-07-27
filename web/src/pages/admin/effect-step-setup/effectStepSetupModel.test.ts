import { describe, expect, it } from 'vitest';
import type { EffectSequence, EffectStep, ProviderFormula, TypeDefinition } from '../../../types/combatData';
import {
  CREATE_UNAVAILABLE_NONSTANDARD_SEQUENCE_MESSAGE,
  RECOMMENDED_OPERATION_BY_DETAIL,
  SEQUENCE_ID_PATTERN,
  STEP_KEY_PATTERN,
  buildSemanticTypeOptions,
  buildStepIdFromSequenceAndKey,
  buildEffectStepPutBodyFromDraft,
  createDefaultFormDraft,
  createUnavailableReason,
  defaultStepOrderForSequence,
  draftFromExistingStep,
  evaluateEffectStepCollisions,
  extractSequenceStem,
  listProviderFormulasForSelectedSequence,
  listStepsForSequence,
  resolveEffectStepTarget,
  validateEffectStepSetup,
  withProviderActionOperation,
  withRecommendedOperationForFamily
} from './effectStepSetupModel';

function typeRow(typeKey: string, typeId: number, name?: string): TypeDefinition {
  return {
    gameId: 'demo',
    typeId,
    typeKey,
    name,
    changeRevision: 1,
    updatedAt: 't'
  };
}

function stepRow(
  stepId: string,
  sequenceId: string,
  stepOrder: number,
  extras: Partial<EffectStep> = {}
): EffectStep {
  return {
    gameId: 'demo',
    stepId,
    sequenceId,
    stepOrder,
    operationTypeId: 20150,
    targetSelectorTypeId: 20111,
    changeRevision: 1,
    updatedAt: 't',
    damageDetail: {
      amountFormulaKey: 'amt',
      damageTypeId: 20220,
      valuePolicyTypeId: 20170
    },
    ...extras
  } as EffectStep;
}

const types = [
  typeRow('operation/damage', 20150, '伤害'),
  typeRow('operation/heal', 20151, '治疗'),
  typeRow('operation/apply_provider', 20155, '施加'),
  typeRow('operation/refresh_provider', 20156, '刷新'),
  typeRow('operation/expire_provider', 20157, '过期'),
  typeRow('selector/opponent', 20111, '对手'),
  typeRow('selector/self', 20110, '自身'),
  typeRow('damage/physical', 20220, '物理'),
  typeRow('value_policy/add', 20170, '加法'),
  typeRow('provider_action/apply', 20230, '施加动作'),
  typeRow('provider_action/refresh', 20231, '刷新动作'),
  typeRow('provider_action/expire', 20232, '过期动作')
];

const semanticOptions = buildSemanticTypeOptions(types);

describe('effectStepSetupModel ID rules', () => {
  it('accepts standard sequence and optional stepKey patterns', () => {
    expect(SEQUENCE_ID_PATTERN.test('sequence_hero_vayne_basic_attack_damage')).toBe(true);
    expect(SEQUENCE_ID_PATTERN.test('sequence_q')).toBe(true);
    expect(SEQUENCE_ID_PATTERN.test('legacy_seq')).toBe(false);
    expect(SEQUENCE_ID_PATTERN.test('sequence_')).toBe(false);

    expect(STEP_KEY_PATTERN.test('hit')).toBe(true);
    expect(STEP_KEY_PATTERN.test('proc_damage')).toBe(true);
    expect(STEP_KEY_PATTERN.test('Hit')).toBe(false);
    expect(STEP_KEY_PATTERN.test('_x')).toBe(false);
  });

  it('derives blank-primary and nonblank-suffixed standard step IDs', () => {
    expect(buildStepIdFromSequenceAndKey('sequence_hero_vayne_basic_attack_damage', '')).toBe(
      'step_hero_vayne_basic_attack_damage'
    );
    expect(buildStepIdFromSequenceAndKey('sequence_hero_vayne_basic_attack_damage', '  ')).toBe(
      'step_hero_vayne_basic_attack_damage'
    );
    expect(buildStepIdFromSequenceAndKey('sequence_hero_vayne_silver_bolts', 'hit_add')).toBe(
      'step_hero_vayne_silver_bolts_hit_add'
    );
    expect(buildStepIdFromSequenceAndKey('legacy_seq', '')).toBeNull();
    expect(buildStepIdFromSequenceAndKey('sequence_q', 'Bad')).toBeNull();
    expect(extractSequenceStem('sequence_ashe_q_impact')).toBe('ashe_q_impact');
  });
});

describe('effectStepSetupModel target and ID preservation', () => {
  const steps = [
    stepRow('step_q_impact', 'sequence_q_impact', 1),
    stepRow('totally_custom_step', 'sequence_q_impact', 2),
    stepRow('legacy_step', 'weird_seq', 1)
  ];

  it('creates blank-primary ID for standard sequence', () => {
    const target = resolveEffectStepTarget(
      {
        ...createDefaultFormDraft(),
        sequenceId: 'sequence_q_cast',
        stepKey: ''
      },
      steps
    );
    expect(target).toEqual({
      mode: 'create',
      stepId: 'step_q_cast',
      sequenceId: 'sequence_q_cast'
    });
  });

  it('creates suffixed ID for nonblank stepKey', () => {
    const target = resolveEffectStepTarget(
      {
        ...createDefaultFormDraft(),
        sequenceId: 'sequence_q_impact',
        stepKey: 'extra'
      },
      steps
    );
    expect(target).toEqual({
      mode: 'create',
      stepId: 'step_q_impact_extra',
      sequenceId: 'sequence_q_impact'
    });
  });

  it('preserves exact selected stepId and never reconstructs it', () => {
    const target = resolveEffectStepTarget(
      {
        ...createDefaultFormDraft(),
        sequenceId: 'sequence_q_impact',
        selectedExistingStepId: 'totally_custom_step',
        stepKey: 'should_not_matter'
      },
      steps
    );
    expect(target.mode).toBe('update');
    if (target.mode === 'update') {
      expect(target.stepId).toBe('totally_custom_step');
      expect(target.stepId).not.toBe(
        buildStepIdFromSequenceAndKey('sequence_q_impact', 'should_not_matter')
      );
    }
  });

  it('blocks create for nonstandard sequences (update-only)', () => {
    expect(createUnavailableReason('weird_seq')).toBe(CREATE_UNAVAILABLE_NONSTANDARD_SEQUENCE_MESSAGE);
    const target = resolveEffectStepTarget(
      {
        ...createDefaultFormDraft(),
        sequenceId: 'weird_seq',
        stepKey: 'x'
      },
      steps
    );
    expect(target.mode).toBe('unavailable');
    if (target.mode === 'unavailable') {
      expect(target.reason).toBe(CREATE_UNAVAILABLE_NONSTANDARD_SEQUENCE_MESSAGE);
    }
  });

  it('lists steps filtered to the selected sequence by order', () => {
    const listed = listStepsForSequence(steps, 'sequence_q_impact');
    expect(listed.map((item) => item.stepId)).toEqual(['step_q_impact', 'totally_custom_step']);
  });
});

describe('effectStepSetupModel collisions', () => {
  const steps = [
    stepRow('step_q_impact', 'sequence_q_impact', 1),
    stepRow('step_q_impact_extra', 'sequence_q_impact', 2)
  ];

  it('blocks create when derived stepId already exists', () => {
    const result = validateEffectStepSetup(
      {
        ...createDefaultFormDraft(),
        sequenceId: 'sequence_q_impact',
        stepKey: '',
        stepOrder: 3,
        editor: {
          ...createDefaultFormDraft().editor,
          common: {
            ...createDefaultFormDraft().editor.common,
            operationTypeId: 'operation/damage',
            targetSelectorTypeId: 'selector/opponent'
          },
          detail: {
            amountFormulaKey: 'amt',
            damageTypeId: 'damage/physical',
            valuePolicyTypeId: 'value_policy/add'
          }
        }
      },
      steps,
      semanticOptions
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('step_q_impact');
    }
  });

  it('blocks order collision excluding the selected update target', () => {
    const collision = evaluateEffectStepCollisions(
      {
        mode: 'update',
        stepId: 'step_q_impact',
        sequenceId: 'sequence_q_impact',
        summary: {
          stepId: 'step_q_impact',
          stepOrder: 1,
          operationTypeId: 20150,
          targetSelectorTypeId: 20111
        }
      },
      2,
      steps
    );
    expect(collision.ok).toBe(false);
    if (!collision.ok) {
      expect(collision.reason).toContain('step_q_impact_extra');
      expect(collision.reason).toContain('stepOrder=2');
    }
  });

  it('does not self-block update when order is unchanged', () => {
    const collision = evaluateEffectStepCollisions(
      {
        mode: 'update',
        stepId: 'step_q_impact',
        sequenceId: 'sequence_q_impact',
        summary: {
          stepId: 'step_q_impact',
          stepOrder: 1,
          operationTypeId: 20150,
          targetSelectorTypeId: 20111
        }
      },
      1,
      steps
    );
    expect(collision.ok).toBe(true);
  });

  it('defaults stepOrder to sequence max + 1', () => {
    expect(defaultStepOrderForSequence(steps, 'sequence_q_impact')).toBe(3);
    expect(defaultStepOrderForSequence([], 'sequence_q_impact')).toBe(1);
  });
});

describe('effectStepSetupModel semantic types and one-detail body', () => {
  it('builds PUT body with resolved typeIds and exactly one detail', () => {
    const draft = createDefaultFormDraft();
    draft.sequenceId = 'sequence_q_cast';
    draft.stepKey = '';
    draft.stepOrder = 1;
    draft.editor.common.operationTypeId = 'operation/damage';
    draft.editor.common.targetSelectorTypeId = 'selector/opponent';
    draft.editor.common.conditionFormulaKey = ' cond.ok ';
    draft.editor.detailFamily = 'damageDetail';
    draft.editor.detail = {
      amountFormulaKey: 'formula.dmg',
      damageTypeId: 'damage/physical',
      valuePolicyTypeId: 'value_policy/add'
    };

    const target = resolveEffectStepTarget(draft, []);
    expect(target.mode).toBe('create');
    if (target.mode !== 'create') {
      return;
    }

    const body = buildEffectStepPutBodyFromDraft(draft, target, semanticOptions);
    expect(body).toEqual({
      sequenceId: 'sequence_q_cast',
      stepOrder: 1,
      operationTypeId: 20150,
      targetSelectorTypeId: 20111,
      conditionFormulaKey: 'cond.ok',
      damageDetail: {
        amountFormulaKey: 'formula.dmg',
        damageTypeId: 20220,
        valuePolicyTypeId: 20170
      }
    });
    expect(Object.keys(body).filter((key) => key.endsWith('Detail'))).toEqual(['damageDetail']);
  });

  it('fails clearly when a required typeKey cannot be resolved', () => {
    const draft = createDefaultFormDraft();
    draft.sequenceId = 'sequence_q_cast';
    draft.stepOrder = 1;
    draft.editor.common.operationTypeId = 'operation/missing';
    draft.editor.common.targetSelectorTypeId = 'selector/opponent';
    draft.editor.detail = {
      amountFormulaKey: 'amt',
      damageTypeId: 'damage/physical',
      valuePolicyTypeId: 'value_policy/add'
    };

    const result = validateEffectStepSetup(draft, [], semanticOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('operation/missing');
    }
  });

  it('maps detail family and provider action to recommended operations without blocking overrides', () => {
    expect(RECOMMENDED_OPERATION_BY_DETAIL.damageDetail).toBe('operation/damage');
    expect(RECOMMENDED_OPERATION_BY_DETAIL.providerDetail).toBe('operation/apply_provider');
    expect(RECOMMENDED_OPERATION_BY_DETAIL.executeDetail).toBe('operation/execute_threshold');

    const afterFamily = withRecommendedOperationForFamily(
      createDefaultFormDraft().editor,
      'healDetail'
    );
    expect(afterFamily.common.operationTypeId).toBe('operation/heal');
    expect(afterFamily.detailFamily).toBe('healDetail');

    const afterAction = withProviderActionOperation(
      { ...afterFamily, detailFamily: 'providerDetail' },
      'provider_action/refresh'
    );
    expect(afterAction.common.operationTypeId).toBe('operation/refresh_provider');

    // Override remains allowed: validation does not require recommendation match.
    const draft = createDefaultFormDraft();
    draft.sequenceId = 'sequence_q_cast';
    draft.stepOrder = 1;
    draft.editor.detailFamily = 'damageDetail';
    draft.editor.common.operationTypeId = 'operation/heal'; // mismatch override
    draft.editor.common.targetSelectorTypeId = 'selector/opponent';
    draft.editor.detail = {
      amountFormulaKey: 'amt',
      damageTypeId: 'damage/physical',
      valuePolicyTypeId: 'value_policy/add'
    };
    const result = validateEffectStepSetup(draft, [], semanticOptions);
    expect(result.ok).toBe(true);
  });

  it('draftFromExistingStep keeps exact stepId and maps typeIds to typeKeys', () => {
    const step = stepRow('legacy_custom_id', 'sequence_q_impact', 5);
    const draft = draftFromExistingStep(step, semanticOptions);
    expect(draft.selectedExistingStepId).toBe('legacy_custom_id');
    expect(draft.editor.common.operationTypeId).toBe('operation/damage');
    expect(draft.editor.common.targetSelectorTypeId).toBe('selector/opponent');
    expect(draft.editor.detail.damageTypeId).toBe('damage/physical');
    expect(draft.editor.detail.valuePolicyTypeId).toBe('value_policy/add');
  });
});

describe('listProviderFormulasForSelectedSequence', () => {
  function sequenceRow(
    sequenceId: string,
    providerId: string,
    extras: Partial<EffectSequence> = {}
  ): EffectSequence {
    return {
      gameId: 'demo',
      sequenceId,
      providerId,
      sequenceKey: 'cast',
      changeRevision: 1,
      updatedAt: 't',
      ...extras
    };
  }

  function formulaRow(providerId: string, formulaKey: string): ProviderFormula {
    return {
      gameId: 'demo',
      providerId,
      formulaKey,
      expression: {},
      changeRevision: 1,
      updatedAt: 't'
    };
  }

  const sequences = [
    sequenceRow('sequence_a', 'provider_a'),
    sequenceRow('sequence_b', 'provider_b'),
    sequenceRow('sequence_blank_owner', '   '),
    sequenceRow('sequence_missing_owner', '')
  ];

  const formulas = [
    formulaRow('provider_a', 'fa1'),
    formulaRow('provider_a', 'fa2'),
    formulaRow('provider_b', 'fb1'),
    formulaRow('  provider_a  ', 'fa_ws'),
    formulaRow('provider_other', 'fx')
  ];

  it('returns only formulas for the matched sequence providerId', () => {
    expect(
      listProviderFormulasForSelectedSequence(sequences, formulas, 'sequence_a').map(
        (item) => item.formulaKey
      )
    ).toEqual(['fa1', 'fa2', 'fa_ws']);
    expect(
      listProviderFormulasForSelectedSequence(sequences, formulas, 'sequence_b').map(
        (item) => item.formulaKey
      )
    ).toEqual(['fb1']);
  });

  it('trims sequenceId and providerId when matching', () => {
    expect(
      listProviderFormulasForSelectedSequence(sequences, formulas, '  sequence_a  ').map(
        (item) => item.formulaKey
      )
    ).toEqual(['fa1', 'fa2', 'fa_ws']);
  });

  it('returns [] for blank or unknown sequence', () => {
    expect(listProviderFormulasForSelectedSequence(sequences, formulas, '')).toEqual([]);
    expect(listProviderFormulasForSelectedSequence(sequences, formulas, '   ')).toEqual([]);
    expect(
      listProviderFormulasForSelectedSequence(sequences, formulas, 'sequence_unknown')
    ).toEqual([]);
  });

  it('returns [] when owner providerId is blank or missing, never all formulas', () => {
    expect(
      listProviderFormulasForSelectedSequence(sequences, formulas, 'sequence_blank_owner')
    ).toEqual([]);
    expect(
      listProviderFormulasForSelectedSequence(sequences, formulas, 'sequence_missing_owner')
    ).toEqual([]);
    const noMatchOwner = [
      ...sequences,
      sequenceRow('sequence_c', 'provider_c')
    ];
    expect(
      listProviderFormulasForSelectedSequence(noMatchOwner, formulas, 'sequence_c')
    ).toEqual([]);
  });
});
