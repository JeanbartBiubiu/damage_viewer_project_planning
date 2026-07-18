import { describe, expect, it } from 'vitest';
import {
  clearImageReference,
  createUntouchedImageReference,
  setExactImageReference
} from '../../../services/combatDataImageReference';
import {
  buildEffectStepPutFromEditor,
  isEffectStepProviderFormulaAssistanceEligible,
  recordToEffectStepEditorState,
  type EffectStepSemanticTypeOptions
} from './EffectStepEditor';
import {
  adaptEnvelopeDataToRecords,
  bodyFromFields,
  buildReferenceOptions,
  buildResourceCopyForm,
  classifyReferenceAssistance,
  COMBAT_DATA_RESOURCE_LIST,
  createEmptyForm,
  decodeImageReferenceFormValue,
  encodeImageReferenceFormValue,
  filterReferenceRecords,
  getCombatDataResource,
  getFirstInvalidResourceFieldName,
  listDependentFieldsToClear,
  listDistinctNonSelfReferenceResourceIds,
  listScopedReferenceFieldsToClear,
  recordToForm,
  resolveActiveReferences,
  RESOURCE_WORKFLOWS,
  validateResourceForm,
  type ReferenceDef
} from './resourceRegistry';
import { listMultiHopChains } from './resourceRelations';

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

describe('resourceRegistry reference assistance helpers', () => {
  it('builds stable deduplicated sorted options with labelKey fallback to valueKey', () => {
    const options = buildReferenceOptions(
      [
        { entityId: 'hero_b', displayName: 'Beta' },
        { entityId: 'hero_a', displayName: 'Alpha' },
        { entityId: 'hero_a', displayName: 'Alpha duplicate' },
        { entityId: '', displayName: 'ignored empty' },
        { entityId: 'hero_c' }
      ],
      'entityId',
      'displayName'
    );
    expect(options.map((item) => item.value)).toEqual(['hero_a', 'hero_b', 'hero_c']);
    expect(options[0]).toEqual({ value: 'hero_a', label: 'hero_a / Alpha' });
    expect(options[2]).toEqual({ value: 'hero_c', label: 'hero_c' });
  });

  it('falls back labelKey to valueKey when labelKey is omitted', () => {
    const options = buildReferenceOptions(
      [{ attrKey: 'ad' }, { attrKey: 'ap' }],
      'attrKey',
      undefined
    );
    expect(options).toEqual([
      { value: 'ad', label: 'ad' },
      { value: 'ap', label: 'ap' }
    ]);
  });

  it('retains an existing value absent from options as an explicit missing option', () => {
    const options = buildReferenceOptions(
      [{ entityId: 'hero_a', displayName: 'Alpha' }],
      'entityId',
      'displayName',
      'hero_missing'
    );
    expect(options).toEqual([
      { value: 'hero_a', label: 'hero_a / Alpha' },
      { value: 'hero_missing', label: 'hero_missing（缺失）' }
    ]);
  });

  it('does not append a missing option when current value is already present or blank', () => {
    const present = buildReferenceOptions(
      [{ entityId: 'hero_a', displayName: 'Alpha' }],
      'entityId',
      'displayName',
      'hero_a'
    );
    expect(present).toHaveLength(1);

    const blank = buildReferenceOptions(
      [{ entityId: 'hero_a', displayName: 'Alpha' }],
      'entityId',
      'displayName',
      ''
    );
    expect(blank).toHaveLength(1);
  });

  it('classifies references as available, failed, or self-suppressed', () => {
    const cross = { field: 'entityId', resourceId: 'entities', valueKey: 'entityId' };
    expect(classifyReferenceAssistance(cross, 'entity-attributes', false)).toBe('available');
    expect(classifyReferenceAssistance(cross, 'entity-attributes', true)).toBe('failed');
    expect(classifyReferenceAssistance(cross, 'entities', false)).toBe('self-suppressed');
    expect(classifyReferenceAssistance(cross, 'entities', true)).toBe('self-suppressed');
  });

  it('lists distinct non-self reference resource ids in stable order', () => {
    expect(listDistinctNonSelfReferenceResourceIds(undefined, 'entity-attributes')).toEqual([]);
    expect(
      listDistinctNonSelfReferenceResourceIds(
        [
          { field: 'entityId', resourceId: 'entities', valueKey: 'entityId' },
          { field: 'attrKey', resourceId: 'attribute-definitions', valueKey: 'attrKey' },
          { field: 'again', resourceId: 'entities', valueKey: 'entityId' },
          { field: 'self', resourceId: 'entity-attributes', valueKey: 'entityId' }
        ],
        'entity-attributes'
      )
    ).toEqual(['attribute-definitions', 'entities']);
  });

  it('registers exactly one type-relations.typeId → types reference', () => {
    const config = getCombatDataResource('type-relations');
    expect(config).toBeDefined();
    expect(config!.references).toEqual([
      { field: 'typeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }
    ]);
  });

  it('registers type-relations targetId dependentReference with exactly ten category mappings', () => {
    const config = getCombatDataResource('type-relations');
    expect(config).toBeDefined();
    expect(config!.dependentReferences).toEqual([
      {
        field: 'targetId',
        dependsOn: 'targetCategory',
        byValue: {
          entity: { resourceId: 'entities', valueKey: 'entityId', labelKey: 'displayName' },
          attribute: { resourceId: 'attribute-definitions', valueKey: 'attrKey', labelKey: 'attrName' },
          resource: { resourceId: 'resource-definitions', valueKey: 'resourceKey', labelKey: 'displayName' },
          provider: { resourceId: 'providers', valueKey: 'providerId', labelKey: 'displayName' },
          ability: { resourceId: 'abilities', valueKey: 'abilityId', labelKey: 'displayName' },
          ability_phase: { resourceId: 'ability-phases', valueKey: 'phaseId' },
          modifier: { resourceId: 'provider-modifiers', valueKey: 'modifierId', labelKey: 'modifierKey' },
          listener: { resourceId: 'provider-listeners', valueKey: 'listenerId', labelKey: 'listenerKey' },
          effect_step: { resourceId: 'effect-steps', valueKey: 'stepId' },
          type: { resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }
        }
      }
    ]);
    expect(Object.keys(config!.dependentReferences![0].byValue)).toHaveLength(10);
  });

  it('registers static ReferenceDef lists for ten Provider/Ability-chain configs exactly', () => {
    const typeRef = (field: string): ReferenceDef => ({
      field,
      resourceId: 'types',
      valueKey: 'typeId',
      labelKey: 'name'
    });
    const providerRef = (field = 'providerId'): ReferenceDef => ({
      field,
      resourceId: 'providers',
      valueKey: 'providerId',
      labelKey: 'displayName'
    });
    const abilityRef = (field = 'abilityId'): ReferenceDef => ({
      field,
      resourceId: 'abilities',
      valueKey: 'abilityId',
      labelKey: 'displayName'
    });

    const formulaScope = { dependsOn: 'providerId', recordKey: 'providerId' } as const;
    const formulaRef = (field: string): ReferenceDef => ({
      field,
      resourceId: 'provider-formulas',
      valueKey: 'formulaKey',
      scope: formulaScope
    });
    const abilityOwnerFormulaScope = {
      dependsOn: 'abilityId',
      recordKey: 'providerId',
      ownerLookup: { resourceId: 'abilities', matchKey: 'abilityId', ownerKey: 'providerId' }
    } as const;
    const abilityOwnerFormulaRef = (field: string): ReferenceDef => ({
      field,
      resourceId: 'provider-formulas',
      valueKey: 'formulaKey',
      scope: abilityOwnerFormulaScope
    });
    const providerScopedAbilityRef = (): ReferenceDef => ({
      field: 'abilityId',
      resourceId: 'abilities',
      valueKey: 'abilityId',
      labelKey: 'displayName',
      scope: { dependsOn: 'providerId', recordKey: 'providerId' }
    });

    const expectedByResourceId: Record<string, ReferenceDef[]> = {
      providers: [typeRef('providerKindTypeId')],
      'provider-lifecycles': [providerRef(), typeRef('refreshPolicyTypeId'), formulaRef('durationFormulaKey')],
      'provider-state-fields': [providerRef(), typeRef('valueTypeId')],
      'provider-modifiers': [
        providerRef(),
        typeRef('modifierTypeId'),
        typeRef('targetSelectorTypeId'),
        { field: 'targetAttrKey', resourceId: 'attribute-definitions', valueKey: 'attrKey', labelKey: 'attrName' },
        typeRef('commandTypeId'),
        typeRef('channelTypeId'),
        typeRef('bucketTypeId'),
        typeRef('stageTypeId'),
        typeRef('valuePolicyTypeId'),
        formulaRef('valueFormulaKey'),
        formulaRef('conditionFormulaKey')
      ],
      'provider-listeners': [providerRef(), typeRef('eventTypeId'), providerScopedAbilityRef()],
      'listener-match-types': [
        { field: 'listenerId', resourceId: 'provider-listeners', valueKey: 'listenerId', labelKey: 'listenerKey' },
        typeRef('matchModeTypeId'),
        typeRef('typeId')
      ],
      abilities: [providerRef(), typeRef('abilityKindTypeId'), formulaRef('castConditionFormulaKey')],
      'ability-state-fields': [abilityRef(), typeRef('valueTypeId')],
      'ability-phases': [abilityRef(), typeRef('phaseTypeId'), abilityOwnerFormulaRef('durationFormulaKey')],
      'ability-phase-effect-sequences': [
        { field: 'phaseId', resourceId: 'ability-phases', valueKey: 'phaseId' },
        typeRef('triggerTypeId'),
        { field: 'sequenceId', resourceId: 'effect-sequences', valueKey: 'sequenceId', labelKey: 'displayName' }
      ]
    };

    expect(Object.keys(expectedByResourceId)).toHaveLength(10);
    for (const [resourceId, expected] of Object.entries(expectedByResourceId)) {
      const config = getCombatDataResource(resourceId);
      expect(config, resourceId).toBeDefined();
      expect(config!.references, resourceId).toEqual(expected);
    }
  });

  it('registers static ReferenceDef lists for twelve remaining non-self cross-resource configs exactly', () => {
    const entityRef = (field = 'entityId'): ReferenceDef => ({
      field,
      resourceId: 'entities',
      valueKey: 'entityId',
      labelKey: 'displayName'
    });
    const providerRef = (field = 'providerId'): ReferenceDef => ({
      field,
      resourceId: 'providers',
      valueKey: 'providerId',
      labelKey: 'displayName'
    });
    const abilityRef = (field = 'abilityId'): ReferenceDef => ({
      field,
      resourceId: 'abilities',
      valueKey: 'abilityId',
      labelKey: 'displayName'
    });
    const resourceDefRef = (field = 'resourceKey'): ReferenceDef => ({
      field,
      resourceId: 'resource-definitions',
      valueKey: 'resourceKey',
      labelKey: 'displayName'
    });
    const sequenceRef = (field = 'sequenceId'): ReferenceDef => ({
      field,
      resourceId: 'effect-sequences',
      valueKey: 'sequenceId',
      labelKey: 'displayName'
    });
    const providerScopedSequenceRef = (): ReferenceDef => ({
      field: 'sequenceId',
      resourceId: 'effect-sequences',
      valueKey: 'sequenceId',
      labelKey: 'displayName',
      scope: { dependsOn: 'providerId', recordKey: 'providerId' }
    });
    const abilityScopedPhaseRef = (field: string): ReferenceDef => ({
      field,
      resourceId: 'ability-phases',
      valueKey: 'phaseId',
      scope: { dependsOn: 'abilityId', recordKey: 'abilityId' }
    });
    const abilityOwnerFormulaScope = {
      dependsOn: 'abilityId',
      recordKey: 'providerId',
      ownerLookup: { resourceId: 'abilities', matchKey: 'abilityId', ownerKey: 'providerId' }
    } as const;
    const abilityOwnerFormulaRef = (field: string): ReferenceDef => ({
      field,
      resourceId: 'provider-formulas',
      valueKey: 'formulaKey',
      scope: abilityOwnerFormulaScope
    });

    const expectedByResourceId: Record<string, ReferenceDef[]> = {
      'entity-attribute-stages': [
        entityRef(),
        { field: 'attrKey', resourceId: 'attribute-definitions', valueKey: 'attrKey', labelKey: 'attrName' }
      ],
      'entity-resources': [entityRef(), resourceDefRef()],
      'entity-resource-stages': [entityRef(), resourceDefRef()],
      'entity-provider-mounts': [entityRef(), providerRef()],
      'provider-formulas': [providerRef()],
      'provider-tick-sequences': [providerRef(), providerScopedSequenceRef()],
      'ability-parameters': [abilityRef()],
      'ability-costs': [
        abilityRef(),
        abilityScopedPhaseRef('phaseId'),
        resourceDefRef(),
        abilityOwnerFormulaRef('amountFormulaKey')
      ],
      'ability-cooldowns': [
        abilityRef(),
        abilityScopedPhaseRef('startsOnPhaseId'),
        abilityOwnerFormulaRef('durationFormulaKey')
      ],
      'effect-sequences': [providerRef()],
      'execute-effect-details': [
        {
          field: 'stepId',
          resourceId: 'effect-steps',
          valueKey: 'stepId',
          targetPredicate: { field: 'executeDetail', operator: 'present' }
        }
      ],
      'listener-effect-sequences': [
        { field: 'listenerId', resourceId: 'provider-listeners', valueKey: 'listenerId', labelKey: 'listenerKey' },
        sequenceRef()
      ]
    };

    expect(Object.keys(expectedByResourceId)).toHaveLength(12);
    for (const [resourceId, expected] of Object.entries(expectedByResourceId)) {
      const config = getCombatDataResource(resourceId);
      expect(config, resourceId).toBeDefined();
      expect(config!.references, resourceId).toEqual(expected);
    }
  });

  it('registers effect-steps sequence reference and keeps type-relations declarations', () => {
    const effectSteps = getCombatDataResource('effect-steps');
    expect(effectSteps).toBeDefined();
    expect(effectSteps!.references).toEqual([
      { field: 'sequenceId', resourceId: 'effect-sequences', valueKey: 'sequenceId', labelKey: 'displayName' }
    ]);

    const typeRelations = getCombatDataResource('type-relations');
    expect(typeRelations).toBeDefined();
    expect(typeRelations!.references).toEqual([
      { field: 'typeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }
    ]);
    expect(typeRelations!.dependentReferences).toEqual([
      {
        field: 'targetId',
        dependsOn: 'targetCategory',
        byValue: {
          entity: { resourceId: 'entities', valueKey: 'entityId', labelKey: 'displayName' },
          attribute: { resourceId: 'attribute-definitions', valueKey: 'attrKey', labelKey: 'attrName' },
          resource: { resourceId: 'resource-definitions', valueKey: 'resourceKey', labelKey: 'displayName' },
          provider: { resourceId: 'providers', valueKey: 'providerId', labelKey: 'displayName' },
          ability: { resourceId: 'abilities', valueKey: 'abilityId', labelKey: 'displayName' },
          ability_phase: { resourceId: 'ability-phases', valueKey: 'phaseId' },
          modifier: { resourceId: 'provider-modifiers', valueKey: 'modifierId', labelKey: 'modifierKey' },
          listener: { resourceId: 'provider-listeners', valueKey: 'listenerId', labelKey: 'listenerKey' },
          effect_step: { resourceId: 'effect-steps', valueKey: 'stepId' },
          type: { resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }
        }
      }
    ]);
  });

  it('resolves active references as static types plus only the selected category target', () => {
    const config = getCombatDataResource('type-relations')!;

    expect(resolveActiveReferences(config, { targetCategory: '' })).toEqual([
      { field: 'typeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }
    ]);
    expect(resolveActiveReferences(config, { targetCategory: 'unknown_cat' })).toEqual([
      { field: 'typeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }
    ]);

    expect(resolveActiveReferences(config, { targetCategory: 'entity' })).toEqual([
      { field: 'typeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      { field: 'targetId', resourceId: 'entities', valueKey: 'entityId', labelKey: 'displayName' }
    ]);
    expect(resolveActiveReferences(config, { targetCategory: 'ability_phase' })).toEqual([
      { field: 'typeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      { field: 'targetId', resourceId: 'ability-phases', valueKey: 'phaseId' }
    ]);
    expect(resolveActiveReferences(config, { targetCategory: 'type' })).toEqual([
      { field: 'typeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      { field: 'targetId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }
    ]);
  });

  it('identifies targetId for clearing only on valid category A → B transitions', () => {
    const config = getCombatDataResource('type-relations')!;
    const deps = config.dependentReferences;

    expect(listDependentFieldsToClear(deps, 'targetCategory', 'entity', 'ability')).toEqual(['targetId']);
    expect(listDependentFieldsToClear(deps, 'targetCategory', 'entity', 'entity')).toEqual([]);
    expect(listDependentFieldsToClear(deps, 'targetCategory', '', 'entity')).toEqual([]);
    expect(listDependentFieldsToClear(deps, 'targetCategory', 'entity', '')).toEqual([]);
    expect(listDependentFieldsToClear(deps, 'targetCategory', 'nope', 'entity')).toEqual([]);
    expect(listDependentFieldsToClear(deps, 'targetCategory', 'entity', 'nope')).toEqual([]);
    expect(listDependentFieldsToClear(deps, 'typeId', '1', '2')).toEqual([]);
    expect(listDependentFieldsToClear(undefined, 'targetCategory', 'entity', 'ability')).toEqual([]);
  });

  it('filters reference records by optional scope (unscoped, match, mismatch, blank, trim)', () => {
    const records = [
      { providerId: 'p_a', formulaKey: 'fa' },
      { providerId: 'p_b', formulaKey: 'fb' },
      { providerId: '  p_a  ', formulaKey: 'fa2' }
    ];
    const unscoped: ReferenceDef = {
      field: 'providerId',
      resourceId: 'providers',
      valueKey: 'providerId'
    };
    expect(filterReferenceRecords(records, unscoped, { providerId: 'p_a' })).toEqual(records);

    const scoped: ReferenceDef = {
      field: 'valueFormulaKey',
      resourceId: 'provider-formulas',
      valueKey: 'formulaKey',
      scope: { dependsOn: 'providerId', recordKey: 'providerId' }
    };
    expect(filterReferenceRecords(records, scoped, { providerId: 'p_a' }).map((r) => r.formulaKey)).toEqual([
      'fa',
      'fa2'
    ]);
    expect(filterReferenceRecords(records, scoped, { providerId: 'p_missing' })).toEqual([]);
    expect(filterReferenceRecords(records, scoped, { providerId: '' })).toEqual([]);
    expect(filterReferenceRecords(records, scoped, { providerId: '   ' })).toEqual([]);
    expect(filterReferenceRecords(records, scoped, { providerId: '  p_b  ' }).map((r) => r.formulaKey)).toEqual([
      'fb'
    ]);
  });

  it('filters provider-formulas via abilityId → providerId owner lookup', () => {
    const formulas = [
      { providerId: 'p_a', formulaKey: 'fa' },
      { providerId: 'p_b', formulaKey: 'fb' },
      { providerId: '  p_a  ', formulaKey: 'fa2' }
    ];
    const abilities = [
      { abilityId: 'ab_a', providerId: 'p_a' },
      { abilityId: 'ab_b', providerId: 'p_b' },
      { abilityId: '  ab_a  ', providerId: 'p_a' }
    ];
    const ownerScoped: ReferenceDef = {
      field: 'durationFormulaKey',
      resourceId: 'provider-formulas',
      valueKey: 'formulaKey',
      scope: {
        dependsOn: 'abilityId',
        recordKey: 'providerId',
        ownerLookup: { resourceId: 'abilities', matchKey: 'abilityId', ownerKey: 'providerId' }
      }
    };
    const lookup = { abilities };

    expect(
      filterReferenceRecords(formulas, ownerScoped, { abilityId: 'ab_a' }, lookup).map((r) => r.formulaKey)
    ).toEqual(['fa', 'fa2']);
    expect(
      filterReferenceRecords(formulas, ownerScoped, { abilityId: '  ab_b  ' }, lookup).map((r) => r.formulaKey)
    ).toEqual(['fb']);
  });

  it('returns empty for blank/missing/unknown owner lookup values and never unfilters', () => {
    const formulas = [
      { providerId: 'p_a', formulaKey: 'fa' },
      { providerId: 'p_b', formulaKey: 'fb' }
    ];
    const abilities = [
      { abilityId: 'ab_a', providerId: 'p_a' },
      { abilityId: 'ab_blank_owner', providerId: '' },
      { abilityId: 'ab_missing_owner' }
    ];
    const ownerScoped: ReferenceDef = {
      field: 'amountFormulaKey',
      resourceId: 'provider-formulas',
      valueKey: 'formulaKey',
      scope: {
        dependsOn: 'abilityId',
        recordKey: 'providerId',
        ownerLookup: { resourceId: 'abilities', matchKey: 'abilityId', ownerKey: 'providerId' }
      }
    };
    const lookup = { abilities };

    expect(filterReferenceRecords(formulas, ownerScoped, { abilityId: '' }, lookup)).toEqual([]);
    expect(filterReferenceRecords(formulas, ownerScoped, { abilityId: '   ' }, lookup)).toEqual([]);
    expect(filterReferenceRecords(formulas, ownerScoped, { abilityId: 'ab_unknown' }, lookup)).toEqual([]);
    expect(filterReferenceRecords(formulas, ownerScoped, { abilityId: 'ab_blank_owner' }, lookup)).toEqual([]);
    expect(filterReferenceRecords(formulas, ownerScoped, { abilityId: 'ab_missing_owner' }, lookup)).toEqual([]);
    expect(filterReferenceRecords(formulas, ownerScoped, { abilityId: 'ab_a' })).toEqual([]);
    expect(filterReferenceRecords(formulas, ownerScoped, { abilityId: 'ab_a' }, {})).toEqual([]);
  });

  it('schedules ownerLookup resource ids alongside ordinary reference resource ids', () => {
    expect(
      listDistinctNonSelfReferenceResourceIds(
        [
          {
            field: 'durationFormulaKey',
            resourceId: 'provider-formulas',
            valueKey: 'formulaKey',
            scope: {
              dependsOn: 'abilityId',
              recordKey: 'providerId',
              ownerLookup: { resourceId: 'abilities', matchKey: 'abilityId', ownerKey: 'providerId' }
            }
          }
        ],
        'ability-phases'
      )
    ).toEqual(['abilities', 'provider-formulas']);

    expect(
      listDistinctNonSelfReferenceResourceIds(
        getCombatDataResource('ability-costs')!.references,
        'ability-costs'
      )
    ).toEqual(['abilities', 'ability-phases', 'provider-formulas', 'resource-definitions']);

    expect(
      listDistinctNonSelfReferenceResourceIds(
        getCombatDataResource('ability-cooldowns')!.references,
        'ability-cooldowns'
      )
    ).toEqual(['abilities', 'ability-phases', 'provider-formulas']);

    expect(
      listDistinctNonSelfReferenceResourceIds(
        [
          {
            field: 'durationFormulaKey',
            resourceId: 'provider-formulas',
            valueKey: 'formulaKey',
            scope: {
              dependsOn: 'abilityId',
              recordKey: 'providerId',
              ownerLookup: { resourceId: 'ability-phases', matchKey: 'abilityId', ownerKey: 'providerId' }
            }
          }
        ],
        'ability-phases'
      )
    ).toEqual(['provider-formulas']);
  });

  it('lists scoped formula fields to clear on provider control changes', () => {
    const modifiers = getCombatDataResource('provider-modifiers')!.references!;
    const lifecycles = getCombatDataResource('provider-lifecycles')!.references!;

    expect(listScopedReferenceFieldsToClear(modifiers, 'providerId', 'p_a', 'p_a')).toEqual([]);
    expect(listScopedReferenceFieldsToClear(modifiers, 'providerId', '', 'p_a')).toEqual([]);
    expect(listScopedReferenceFieldsToClear(modifiers, 'providerId', 'p_a', 'p_b')).toEqual([
      'valueFormulaKey',
      'conditionFormulaKey'
    ]);
    expect(listScopedReferenceFieldsToClear(modifiers, 'providerId', 'p_a', '')).toEqual([
      'valueFormulaKey',
      'conditionFormulaKey'
    ]);
    expect(listScopedReferenceFieldsToClear(modifiers, 'modifierTypeId', '1', '2')).toEqual([]);
    expect(listScopedReferenceFieldsToClear(lifecycles, 'providerId', 'p_a', 'p_b')).toEqual([
      'durationFormulaKey'
    ]);
    expect(listScopedReferenceFieldsToClear(undefined, 'providerId', 'p_a', 'p_b')).toEqual([]);
  });

  it('clears Ability child formula fields when prior nonblank abilityId changes or clears', () => {
    const phases = getCombatDataResource('ability-phases')!.references!;
    const costs = getCombatDataResource('ability-costs')!.references!;
    const cooldowns = getCombatDataResource('ability-cooldowns')!.references!;

    expect(listScopedReferenceFieldsToClear(phases, 'abilityId', 'ab_a', 'ab_a')).toEqual([]);
    expect(listScopedReferenceFieldsToClear(phases, 'abilityId', '', 'ab_a')).toEqual([]);
    expect(listScopedReferenceFieldsToClear(phases, 'abilityId', 'ab_a', 'ab_b')).toEqual([
      'durationFormulaKey'
    ]);
    expect(listScopedReferenceFieldsToClear(phases, 'abilityId', 'ab_a', '')).toEqual([
      'durationFormulaKey'
    ]);
    expect(listScopedReferenceFieldsToClear(costs, 'abilityId', 'ab_a', 'ab_b')).toEqual([
      'phaseId',
      'amountFormulaKey'
    ]);
    expect(listScopedReferenceFieldsToClear(costs, 'abilityId', 'ab_a', '')).toEqual([
      'phaseId',
      'amountFormulaKey'
    ]);
    expect(listScopedReferenceFieldsToClear(cooldowns, 'abilityId', 'ab_a', 'ab_b')).toEqual([
      'startsOnPhaseId',
      'durationFormulaKey'
    ]);
    expect(listScopedReferenceFieldsToClear(cooldowns, 'abilityId', 'ab_a', '')).toEqual([
      'startsOnPhaseId',
      'durationFormulaKey'
    ]);
    expect(listScopedReferenceFieldsToClear(phases, 'phaseTypeId', '1', '2')).toEqual([]);
  });

  it('treats prototype-key strings as unknown and never clears dependent fields', () => {
    const config = getCombatDataResource('type-relations')!;
    const deps = config.dependentReferences;

    expect(listDependentFieldsToClear(deps, 'targetCategory', 'toString', 'entity')).toEqual([]);
    expect(listDependentFieldsToClear(deps, 'targetCategory', 'entity', 'toString')).toEqual([]);
    expect(listDependentFieldsToClear(deps, 'targetCategory', 'constructor', 'entity')).toEqual([]);
    expect(listDependentFieldsToClear(deps, 'targetCategory', 'entity', 'constructor')).toEqual([]);
    expect(listDependentFieldsToClear(deps, 'targetCategory', 'toString', 'constructor')).toEqual([]);
    expect(listDependentFieldsToClear(deps, 'targetCategory', 'constructor', 'toString')).toEqual([]);
  });

  it('stringifies numeric typeId and labels name or falls back to id via buildReferenceOptions', () => {
    const options = buildReferenceOptions(
      [
        { typeId: 10, name: 'Physical' },
        { typeId: 2, name: '' },
        { typeId: 3 },
        { typeId: 4, name: '   ' }
      ],
      'typeId',
      'name'
    );
    expect(options.map((item) => item.value)).toEqual(['10', '2', '3', '4']);
    expect(options[0]).toEqual({ value: '10', label: '10 / Physical' });
    expect(options[1]).toEqual({ value: '2', label: '2' });
    expect(options[2]).toEqual({ value: '3', label: '3' });
    expect(options[3]).toEqual({ value: '4', label: '4' });
  });

  it('applies type-category targetId mapping through buildReferenceOptions stringification', () => {
    const config = getCombatDataResource('type-relations')!;
    const active = resolveActiveReferences(config, { targetCategory: 'type' });
    const targetRef = active.find((item) => item.field === 'targetId');
    expect(targetRef).toEqual({
      field: 'targetId',
      resourceId: 'types',
      valueKey: 'typeId',
      labelKey: 'name'
    });

    const options = buildReferenceOptions(
      [{ typeId: 7, name: 'Magic' }, { typeId: 8 }],
      targetRef!.valueKey,
      targetRef!.labelKey,
      '9'
    );
    expect(options).toEqual([
      { value: '7', label: '7 / Magic' },
      { value: '8', label: '8' },
      { value: '9', label: '9（缺失）' }
    ]);
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

  it('marks only runtime-backed formula fields eligible for provider Select assistance', () => {
    expect(isEffectStepProviderFormulaAssistanceEligible('common', 'conditionFormulaKey')).toBe(
      true
    );
    for (const family of [
      'damageDetail',
      'healDetail',
      'resourceDetail',
      'attributeDetail',
      'shieldDetail',
      'abilityControlDetail',
      'stateDetail'
    ] as const) {
      expect(isEffectStepProviderFormulaAssistanceEligible(family, 'amountFormulaKey')).toBe(true);
    }
    expect(
      isEffectStepProviderFormulaAssistanceEligible('providerDetail', 'stacksFormulaKey')
    ).toBe(true);

    expect(
      isEffectStepProviderFormulaAssistanceEligible('shieldDetail', 'durationFormulaKey')
    ).toBe(false);
    expect(
      isEffectStepProviderFormulaAssistanceEligible('providerDetail', 'durationFormulaKey')
    ).toBe(false);
    expect(
      isEffectStepProviderFormulaAssistanceEligible('providerDetail', 'amountFormulaKey')
    ).toBe(false);
    expect(isEffectStepProviderFormulaAssistanceEligible('eventDetail', 'amountFormulaKey')).toBe(
      false
    );
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

  it('resolves semantic typeKeys to numeric IDs only when building PUT body', () => {
    const semanticOptions: EffectStepSemanticTypeOptions = {
      operation: [{ typeKey: 'operation/damage', typeId: 50, label: '伤害' }],
      targetSelector: [{ typeKey: 'selector/opponent', typeId: 11, label: '对手' }],
      damageType: [{ typeKey: 'damage/physical', typeId: 20, label: '物理' }],
      valuePolicy: [{ typeKey: 'value_policy/add', typeId: 70, label: '加法' }]
    };
    const body = buildEffectStepPutFromEditor(
      {
        common: {
          stepId: 'step_q',
          sequenceId: 'sequence_q',
          stepOrder: 1,
          operationTypeId: 'operation/damage',
          targetSelectorTypeId: 'selector/opponent',
          conditionFormulaKey: ''
        },
        detailFamily: 'damageDetail',
        detail: {
          amountFormulaKey: 'amt',
          damageTypeId: 'damage/physical',
          valuePolicyTypeId: 'value_policy/add'
        }
      },
      semanticOptions
    );
    expect(body).toEqual({
      sequenceId: 'sequence_q',
      stepOrder: 1,
      operationTypeId: 50,
      targetSelectorTypeId: 11,
      damageDetail: {
        amountFormulaKey: 'amt',
        damageTypeId: 20,
        valuePolicyTypeId: 70
      }
    });
  });
});

describe('GUX-1 workflow metadata and relationship contracts', () => {
  it('requires workflow metadata on all 30 resources and rejects unknown refs', () => {
    expect(COMBAT_DATA_RESOURCE_LIST).toHaveLength(30);
    const knownIds = new Set(COMBAT_DATA_RESOURCE_LIST.map((item) => item.id));
    expect(Object.keys(RESOURCE_WORKFLOWS).sort()).toEqual([...knownIds].sort());

    for (const resource of COMBAT_DATA_RESOURCE_LIST) {
      expect(resource.workflow).toBeDefined();
      expect(resource.workflow.purpose.trim().length).toBeGreaterThan(0);
      for (const upstream of resource.workflow.upstream) {
        expect(knownIds.has(upstream), `unknown upstream ${upstream} on ${resource.id}`).toBe(true);
      }
      for (const downstream of resource.workflow.downstream) {
        expect(knownIds.has(downstream), `unknown downstream ${downstream} on ${resource.id}`).toBe(
          true
        );
      }
      for (const reference of resource.references ?? []) {
        expect(knownIds.has(reference.resourceId), `unknown ref ${reference.resourceId}`).toBe(true);
        expect(resource.fields.some((field) => field.name === reference.field)).toBe(true);
        if (reference.scope) {
          expect(resource.fields.some((field) => field.name === reference.scope!.dependsOn)).toBe(
            true
          );
        }
        if (reference.targetPredicate) {
          expect(reference.targetPredicate).toEqual({
            field: expect.any(String),
            operator: 'present'
          });
        }
      }
      for (const dependent of resource.dependentReferences ?? []) {
        expect(resource.fields.some((field) => field.name === dependent.field)).toBe(true);
        expect(resource.fields.some((field) => field.name === dependent.dependsOn)).toBe(true);
        for (const target of Object.values(dependent.byValue)) {
          expect(knownIds.has(target.resourceId)).toBe(true);
        }
      }
      for (const exception of resource.workflow.exceptions ?? []) {
        if (exception.kind === 'compound-parent') {
          expect(knownIds.has(exception.targetResourceId)).toBe(true);
          expect(exception.fieldPairs.length).toBeGreaterThanOrEqual(2);
        }
        if (exception.kind === 'semantic-context') {
          expect(knownIds.has(exception.resourceId)).toBe(true);
        }
        if (exception.kind === 'multi-hop-assistance') {
          expect(resource.fields.some((field) => field.name === exception.sourceField)).toBe(true);
          expect(resource.fields.some((field) => field.name === exception.assistanceField)).toBe(
            true
          );
          for (const hop of exception.hops) {
            expect(knownIds.has(hop.resourceId)).toBe(true);
          }
          expect(knownIds.has(exception.targetFilter.resourceId)).toBe(true);
        }
      }
    }
  });

  it('applies the four direct same-owner scopes', () => {
    const listeners = getCombatDataResource('provider-listeners')!;
    expect(listeners.references?.find((item) => item.field === 'abilityId')?.scope).toEqual({
      dependsOn: 'providerId',
      recordKey: 'providerId'
    });

    const ticks = getCombatDataResource('provider-tick-sequences')!;
    expect(ticks.references?.find((item) => item.field === 'sequenceId')?.scope).toEqual({
      dependsOn: 'providerId',
      recordKey: 'providerId'
    });

    const costs = getCombatDataResource('ability-costs')!;
    expect(costs.references?.find((item) => item.field === 'phaseId')?.scope).toEqual({
      dependsOn: 'abilityId',
      recordKey: 'abilityId'
    });

    const cooldowns = getCombatDataResource('ability-cooldowns')!;
    expect(cooldowns.references?.find((item) => item.field === 'startsOnPhaseId')?.scope).toEqual({
      dependsOn: 'abilityId',
      recordKey: 'abilityId'
    });
  });

  it('narrows execute-effect-details.stepId with present predicate and never broadens', () => {
    const reference = getCombatDataResource('execute-effect-details')!.references!.find(
      (item) => item.field === 'stepId'
    )!;
    expect(reference.targetPredicate).toEqual({ field: 'executeDetail', operator: 'present' });

    const steps = [
      { stepId: 's1', executeDetail: { hpRatioThreshold: 0.2 } },
      { stepId: 's2', executeDetail: null },
      { stepId: 's3' },
      { stepId: 's4', executeDetail: 0 },
      { stepId: 's5', executeDetail: '' }
    ];
    const filtered = filterReferenceRecords(steps, reference, {});
    expect(filtered.map((row) => row.stepId)).toEqual(['s1', 's4', 's5']);
  });

  it('declares compound parents and semantic progression-schema context on stage resources', () => {
    const attr = getCombatDataResource('entity-attribute-stages')!;
    expect(attr.workflow.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'compound-parent',
          targetResourceId: 'entity-attributes',
          fieldPairs: [
            { sourceField: 'entityId', targetField: 'entityId' },
            { sourceField: 'attrKey', targetField: 'attrKey' }
          ]
        }),
        expect.objectContaining({
          kind: 'semantic-context',
          resourceId: 'progression-schema'
        })
      ])
    );

    const res = getCombatDataResource('entity-resource-stages')!;
    expect(res.workflow.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'compound-parent',
          targetResourceId: 'entity-resources',
          fieldPairs: [
            { sourceField: 'entityId', targetField: 'entityId' },
            { sourceField: 'resourceKey', targetField: 'resourceKey' }
          ]
        }),
        expect.objectContaining({
          kind: 'semantic-context',
          resourceId: 'progression-schema'
        })
      ])
    );
  });

  it('declares exactly two multi-hop assistance chains', () => {
    const chains = listMultiHopChains();
    expect(chains).toHaveLength(2);
    expect(chains.find((item) => item.id === 'phase-binding')).toMatchObject({
      resourceId: 'ability-phase-effect-sequences',
      sourceField: 'phaseId',
      assistanceField: 'sequenceId',
      targetFilter: { resourceId: 'effect-sequences', recordField: 'providerId' }
    });
    expect(chains.find((item) => item.id === 'listener-binding')).toMatchObject({
      resourceId: 'listener-effect-sequences',
      sourceField: 'listenerId',
      assistanceField: 'sequenceId',
      targetFilter: { resourceId: 'effect-sequences', recordField: 'providerId' }
    });
  });

  it('scopes abilityId options for provider-listeners by local providerId', () => {
    const reference = getCombatDataResource('provider-listeners')!.references!.find(
      (item) => item.field === 'abilityId'
    )!;
    const abilities = [
      { abilityId: 'a1', providerId: 'p1' },
      { abilityId: 'a2', providerId: 'p2' }
    ];
    expect(
      filterReferenceRecords(abilities, reference, { providerId: 'p1' }).map((row) => row.abilityId)
    ).toEqual(['a1']);
    expect(filterReferenceRecords(abilities, reference, { providerId: '' })).toEqual([]);
  });
});

describe('getFirstInvalidResourceFieldName', () => {
  it('returns the first required empty field in registry order', () => {
    const config = getCombatDataResource('entities')!;
    const form = createEmptyForm(config.fields);
    expect(getFirstInvalidResourceFieldName(config, form)).toBe('entityId');
    expect(validateResourceForm(config, form)).toBe('请填写 实体 ID');

    form.entityId = 'e1';
    expect(getFirstInvalidResourceFieldName(config, form)).toBe('displayName');
    expect(validateResourceForm(config, form)).toBe('请填写 显示名');

    form.displayName = 'Hero';
    expect(getFirstInvalidResourceFieldName(config, form)).toBeNull();
    expect(validateResourceForm(config, form)).toBeNull();
  });

  it('returns the first invalid number field', () => {
    const config = getCombatDataResource('entity-attributes')!;
    const form = {
      entityId: 'e1',
      attrKey: 'ad',
      baseValue: 'not-a-number'
    };
    expect(getFirstInvalidResourceFieldName(config, form)).toBe('baseValue');
    expect(validateResourceForm(config, form)).toBe('基础值 必须是有效数字');
  });

  it('returns targetCategory for invalid type-relations category', () => {
    const config = getCombatDataResource('type-relations')!;
    const form = {
      typeId: 1,
      targetCategory: 'not-real',
      targetId: 'x',
      extend: ''
    };
    expect(getFirstInvalidResourceFieldName(config, form)).toBe('targetCategory');
    expect(validateResourceForm(config, form)).toMatch(/^targetCategory 必须是：/);
  });

  it('returns the first invalid json field', () => {
    const config = getCombatDataResource('provider-formulas')!;
    const form = {
      providerId: 'p1',
      formulaKey: 'f1',
      expression: '{not-json'
    };
    expect(getFirstInvalidResourceFieldName(config, form)).toBe('expression');
    expect(validateResourceForm(config, form)).toBe('表达式 JSON JSON 格式无效');
  });
});

describe('imageUri registry fields (entities / attribute-definitions only)', () => {
  it('registers image-reference only on entities and attribute-definitions', () => {
    const withImage = COMBAT_DATA_RESOURCE_LIST.filter((resource) =>
      resource.fields.some((field) => field.kind === 'image-reference')
    ).map((resource) => resource.id);
    expect(withImage.sort()).toEqual(['attribute-definitions', 'entities']);

    for (const resource of COMBAT_DATA_RESOURCE_LIST) {
      const imageFields = resource.fields.filter((field) => field.name === 'imageUri');
      if (resource.id === 'entities' || resource.id === 'attribute-definitions') {
        expect(imageFields).toHaveLength(1);
        expect(imageFields[0]?.kind).toBe('image-reference');
      } else {
        expect(imageFields).toHaveLength(0);
      }
    }
  });

  it('recordToForm loads untouched preserve and bodyFromFields omits until touched', () => {
    const config = getCombatDataResource('entities')!;
    const form = recordToForm(
      {
        entityId: 'hero_vayne',
        displayName: '薇恩',
        description: 'x',
        imageUri: 'character_vayne'
      },
      config.fields
    );
    expect(form.imageUri).toEqual(
      expect.stringMatching(/^__imageRef__:/)
    );
    expect(decodeImageReferenceFormValue(form.imageUri)).toEqual({
      status: 'untouched',
      original: 'character_vayne'
    });
    const omitted = bodyFromFields(config.fields, config.pathKeys, form);
    expect(Object.prototype.hasOwnProperty.call(omitted, 'imageUri')).toBe(false);

    form.imageUri = encodeImageReferenceFormValue(
      setExactImageReference(createUntouchedImageReference('character_vayne'), '  other_icon  ')
    );
    expect(bodyFromFields(config.fields, config.pathKeys, form).imageUri).toBe('  other_icon  ');

    form.imageUri = encodeImageReferenceFormValue(
      clearImageReference(createUntouchedImageReference('character_vayne'))
    );
    expect(bodyFromFields(config.fields, config.pathKeys, form).imageUri).toBeNull();
  });

  it('createEmptyForm starts untouched; copy intentionally reuses binding', () => {
    const config = getCombatDataResource('attribute-definitions')!;
    const empty = createEmptyForm(config.fields);
    expect(decodeImageReferenceFormValue(empty.imageUri)).toEqual({
      status: 'untouched',
      original: null
    });

    const copied = buildResourceCopyForm(config, {
      attrKey: 'ad',
      valueKind: 'scalar',
      sortOrder: 1,
      imageUri: 'attribute_ad'
    });
    expect(copied.attrKey).toBe('');
    expect(decodeImageReferenceFormValue(copied.imageUri)).toEqual({
      status: 'set',
      original: null,
      value: 'attribute_ad'
    });
    expect(bodyFromFields(config.fields, config.pathKeys, copied).imageUri).toBe('attribute_ad');
  });
});
