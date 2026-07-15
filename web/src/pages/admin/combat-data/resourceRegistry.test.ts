import { describe, expect, it } from 'vitest';
import {
  buildEffectStepPutFromEditor,
  recordToEffectStepEditorState
} from './EffectStepEditor';
import {
  adaptEnvelopeDataToRecords,
  bodyFromFields,
  createEmptyForm,
  getCombatDataResource,
  recordToForm
} from './resourceRegistry';

describe('combat-data resourceRegistry envelope adaptation', () => {
  it('adapts progression-schema object payload into a single workbench record and form', () => {
    const schemaObject = {
      gameId: 'lol',
      progressionKind: 'LEVEL',
      stageMin: 1,
      stageMax: 18,
      stageLabel: 'Lv',
      requireAllStages: true,
      changeRevision: 3,
      updatedAt: '2026-07-12T04:10:21.983138Z'
    };

    const records = adaptEnvelopeDataToRecords(schemaObject);
    expect(records).toHaveLength(1);
    expect(records[0].progressionKind).toBe('LEVEL');
    expect(records[0].stageMax).toBe(18);

    const config = getCombatDataResource('progression-schema');
    expect(config).toBeDefined();
    expect(config!.kind).toBe('singleton');

    const form = recordToForm(records[0], config!.fields);
    expect(form.progressionKind).toBe('LEVEL');
    expect(form.stageMin).toBe(1);
    expect(form.stageMax).toBe(18);
    expect(form.stageLabel).toBe('Lv');
    expect(form.requireAllStages).toBe(true);
  });

  it('keeps array list contract for non-singleton resources', () => {
    const list = [
      { attrKey: 'ad', valueKind: 'number', sortOrder: 1 },
      { attrKey: 'ap', valueKind: 'number', sortOrder: 2 }
    ];
    const records = adaptEnvelopeDataToRecords(list);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.attrKey)).toEqual(['ad', 'ap']);
  });

  it('does not turn a list array into a singleton wrapper row', () => {
    const records = adaptEnvelopeDataToRecords([{ typeId: 1, typeKey: 'type/1' }]);
    expect(records).toEqual([{ typeId: 1, typeKey: 'type/1' }]);
    expect(Array.isArray(records)).toBe(true);
  });

  it('unwraps accidental full envelope object for singleton resources', () => {
    const records = adaptEnvelopeDataToRecords({
      gameId: 'lol',
      currentRevision: 3,
      data: {
        progressionKind: 'STAR',
        stageMin: 1,
        stageMax: 5,
        stageLabel: '★',
        requireAllStages: false
      }
    });
    expect(records).toHaveLength(1);
    expect(records[0].progressionKind).toBe('STAR');
    expect(records[0].stageLabel).toBe('★');
  });

  it('returns empty records for null/undefined object payloads', () => {
    expect(adaptEnvelopeDataToRecords(null)).toEqual([]);
    expect(adaptEnvelopeDataToRecords(undefined)).toEqual([]);
  });

  it('createEmptyForm still seeds progression-schema defaults for create/overwrite', () => {
    const config = getCombatDataResource('progression-schema')!;
    const form = createEmptyForm(config.fields);
    expect(form.progressionKind).toBe('LEVEL');
    expect(form.stageMin).toBe(1);
    expect(form.stageMax).toBe(18);
    expect(form.stageLabel).toBe('等级');
    expect(form.requireAllStages).toBe(true);
  });
});

describe('abilities castConditionFormulaKey form field', () => {
  it('exposes optional castConditionFormulaKey and retains it on record/form/body path', () => {
    const config = getCombatDataResource('abilities');
    expect(config).toBeDefined();
    expect(config!.groupId).toBe('abilities');

    const field = config!.fields.find((f) => f.name === 'castConditionFormulaKey');
    expect(field).toMatchObject({
      name: 'castConditionFormulaKey',
      kind: 'text',
      label: '施放前置条件公式 Key'
    });
    expect(field?.required).toBeUndefined();

    const emptyForm = createEmptyForm(config!.fields);
    expect(emptyForm.castConditionFormulaKey).toBe('');
    expect(
      bodyFromFields(config!.fields, ['abilityId'], emptyForm)
    ).not.toHaveProperty('castConditionFormulaKey');

    const form = recordToForm(
      {
        abilityId: 'ability_hero_ashe_q_rangers_focus',
        providerId: 'provider_hero_ashe_rangers_focus',
        abilityKey: 'rangers_focus',
        abilityKindTypeId: 20130,
        displayName: '射手的专注',
        castConditionFormulaKey: 'rangers_focus_cast_condition'
      },
      config!.fields
    );
    expect(form.castConditionFormulaKey).toBe('rangers_focus_cast_condition');

    const body = bodyFromFields(config!.fields, ['abilityId'], form);
    expect(body.castConditionFormulaKey).toBe('rangers_focus_cast_condition');
    expect(body.abilityKey).toBe('rangers_focus');
    expect(body.providerId).toBe('provider_hero_ashe_rangers_focus');
  });
});

describe('execute-effect-details and effect-step detail families', () => {
  it('registers execute-effect-details in Effect group with locked stepId and required threshold', () => {
    const config = getCombatDataResource('execute-effect-details');
    expect(config).toBeDefined();
    expect(config!.groupId).toBe('effects');
    expect(config!.pathKeys).toEqual(['stepId']);

    const stepIdField = config!.fields.find((field) => field.name === 'stepId');
    expect(stepIdField).toMatchObject({ kind: 'text', required: true, lockedOnEdit: true });

    const thresholdField = config!.fields.find((field) => field.name === 'threshold');
    expect(thresholdField).toMatchObject({ kind: 'number', required: true });
  });

  it('converts and builds executeDetail PUT body with only threshold plus common fields', () => {
    const state = recordToEffectStepEditorState({
      stepId: 'step_exec',
      sequenceId: 'seq_1',
      stepOrder: 1,
      operationTypeId: 10,
      targetSelectorTypeId: 20,
      conditionFormulaKey: 'cond.hp',
      executeDetail: { threshold: 0.25 }
    });
    expect(state.detailFamily).toBe('executeDetail');
    expect(state.detail.threshold).toBe(0.25);

    const body = buildEffectStepPutFromEditor(state);
    expect(body).toEqual({
      sequenceId: 'seq_1',
      stepOrder: 1,
      operationTypeId: 10,
      targetSelectorTypeId: 20,
      conditionFormulaKey: 'cond.hp',
      executeDetail: { threshold: 0.25 }
    });
  });

  it('converts and builds repeatDetail with all fields intact', () => {
    const state = recordToEffectStepEditorState({
      stepId: 'step_repeat',
      sequenceId: 'seq_2',
      stepOrder: 2,
      operationTypeId: 11,
      targetSelectorTypeId: 21,
      repeatDetail: {
        repeatScopeTypeId: 3,
        repeatCount: 4,
        repeatTag: 'tag.a',
        triggerStateKey: 'state.ready',
        threshold: 0.5
      }
    });
    expect(state.detailFamily).toBe('repeatDetail');
    expect(state.detail).toMatchObject({
      repeatScopeTypeId: 3,
      repeatCount: 4,
      repeatTag: 'tag.a',
      triggerStateKey: 'state.ready',
      threshold: 0.5
    });

    const body = buildEffectStepPutFromEditor(state);
    expect(body.repeatDetail).toEqual({
      repeatScopeTypeId: 3,
      repeatCount: 4,
      repeatTag: 'tag.a',
      triggerStateKey: 'state.ready',
      threshold: 0.5
    });
    expect(body.sequenceId).toBe('seq_2');
    expect(body.stepOrder).toBe(2);
  });
});
