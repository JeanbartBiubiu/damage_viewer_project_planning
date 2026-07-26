import { describe, expect, it } from 'vitest';
import type {
  EntityAttribute,
  EntityAttributeStage,
  EntityResource,
  EntityResourceStage,
  ProgressionSchema
} from '../../../types/combatData';
import {
  ENTITY_GROWTH_STAGE_COUNT,
  ENTITY_GROWTH_STAGE_MAX,
  ENTITY_GROWTH_STAGE_MIN,
  buildAttributeCurveBatchBody,
  buildLabelledOptions,
  buildResourceCurveBatchBody,
  countFilledAttributeStages,
  countFilledResourceStages,
  evaluateEntityGrowthSchema,
  formatStableLabel,
  isAttributeCurveComplete,
  isResourceCurveComplete,
  materializeAttributeCurve,
  materializeResourceCurve
} from './entityGrowthModel';

function levelSchema(
  overrides: Partial<ProgressionSchema> = {}
): ProgressionSchema {
  return {
    gameId: 'demo',
    changeRevision: 1,
    updatedAt: 't',
    progressionKind: 'LEVEL',
    stageMin: 1,
    stageMax: 18,
    stageLabel: '等级',
    requireAllStages: true,
    ...overrides
  };
}

describe('entityGrowthModel schema gating', () => {
  it('accepts LEVEL 1..18 only', () => {
    expect(evaluateEntityGrowthSchema(levelSchema())).toEqual({ ok: true });
  });

  it('rejects missing schema without inventing defaults', () => {
    const gate = evaluateEntityGrowthSchema(null);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toContain('progression schema');
    }
  });

  it('rejects incompatible kind or stage range', () => {
    const star = evaluateEntityGrowthSchema(levelSchema({ progressionKind: 'STAR' }));
    expect(star.ok).toBe(false);
    if (!star.ok) {
      expect(star.reason).toContain('STAR');
    }

    const range = evaluateEntityGrowthSchema(levelSchema({ stageMin: 0, stageMax: 18 }));
    expect(range.ok).toBe(false);
    if (!range.ok) {
      expect(range.reason).toContain('0..18');
    }
  });
});

describe('entityGrowthModel materialization and completeness', () => {
  it('materializes attribute curves with exact stages 1..18 and missing cells', () => {
    const base: EntityAttribute = {
      gameId: 'demo',
      entityId: 'e1',
      attrKey: 'ad',
      baseValue: 52,
      changeRevision: 1,
      updatedAt: 't'
    };
    const stageRows: EntityAttributeStage[] = [
      { gameId: 'demo', entityId: 'e1', attrKey: 'ad', stage: 1, value: 52, changeRevision: 1, updatedAt: 't' },
      { gameId: 'demo', entityId: 'e1', attrKey: 'ad', stage: 18, value: 100, changeRevision: 1, updatedAt: 't' },
      { gameId: 'demo', entityId: 'e1', attrKey: 'hp', stage: 2, value: 999, changeRevision: 1, updatedAt: 't' }
    ];

    const curve = materializeAttributeCurve('ad', base, stageRows);
    expect(curve.attrKey).toBe('ad');
    expect(curve.baseValue).toBe(52);
    expect(curve.stages).toHaveLength(ENTITY_GROWTH_STAGE_COUNT);
    expect(curve.stages[0]).toEqual({ stage: ENTITY_GROWTH_STAGE_MIN, value: 52 });
    expect(curve.stages[17]).toEqual({ stage: ENTITY_GROWTH_STAGE_MAX, value: 100 });
    expect(curve.stages[1].value).toBeNull();
    expect(countFilledAttributeStages(curve)).toBe(2);
    expect(isAttributeCurveComplete(curve)).toBe(false);
  });

  it('materializes resource curves with paired initial/max cells', () => {
    const base: EntityResource = {
      gameId: 'demo',
      entityId: 'e1',
      resourceKey: 'mana',
      initialValue: 300,
      maxValue: 300,
      changeRevision: 1,
      updatedAt: 't'
    };
    const stageRows: EntityResourceStage[] = [
      {
        gameId: 'demo',
        entityId: 'e1',
        resourceKey: 'mana',
        stage: 1,
        initialValue: 300,
        maxValue: 300,
        changeRevision: 1,
        updatedAt: 't'
      }
    ];

    const curve = materializeResourceCurve('mana', base, stageRows);
    expect(curve.stages).toHaveLength(18);
    expect(curve.stages[0]).toEqual({ stage: 1, initialValue: 300, maxValue: 300 });
    expect(curve.stages[1].initialValue).toBeNull();
    expect(countFilledResourceStages(curve)).toBe(1);
    expect(isResourceCurveComplete(curve)).toBe(false);
  });

  it('treats a full 1..18 attribute curve as complete', () => {
    const stages = Array.from({ length: 18 }, (_, index) => ({
      stage: index + 1,
      value: 10 + index
    }));
    const curve = { attrKey: 'ad', baseValue: 10, stages };
    expect(isAttributeCurveComplete(curve)).toBe(true);
    expect(countFilledAttributeStages(curve)).toBe(18);
  });
});

describe('entityGrowthModel aggregate request construction', () => {
  it('builds one attribute aggregate body and refuses incomplete curves', () => {
    const incomplete = materializeAttributeCurve('ad', undefined, []);
    expect(
      buildAttributeCurveBatchBody(7, { displayName: 'Ashe', description: 'ADC' }, incomplete)
    ).toBeNull();

    const stages = Array.from({ length: 18 }, (_, index) => ({
      stage: index + 1,
      value: 50 + index
    }));
    const complete = { attrKey: 'ad', baseValue: 50, stages };
    const body = buildAttributeCurveBatchBody(
      7,
      { displayName: 'Ashe', description: 'ADC' },
      complete
    );

    expect(body).toEqual({
      expectedCurrentRevision: 7,
      displayName: 'Ashe',
      description: 'ADC',
      attributes: [
        {
          attrKey: 'ad',
          baseValue: 50,
          stages
        }
      ]
    });
    expect(body).not.toHaveProperty('resources');
    expect(body).not.toHaveProperty('providerMounts');
    expect(body).not.toHaveProperty('imageUri');
  });

  it('omits imageUri from attribute batch even when loaded meta carries a binding', () => {
    const stages = Array.from({ length: 18 }, (_, index) => ({
      stage: index + 1,
      value: 10 + index
    }));
    const body = buildAttributeCurveBatchBody(
      1,
      {
        displayName: 'Ashe',
        description: 'ADC',
        imageUri: 'character_ashe'
      },
      { attrKey: 'ad', baseValue: 52, stages }
    );
    expect(body).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(body, 'imageUri')).toBe(false);
    expect(JSON.stringify(body)).not.toContain('imageUri');
    expect(JSON.stringify(body)).not.toContain('character_ashe');
  });

  it('builds one resource aggregate body without attributes or mounts', () => {
    const stages = Array.from({ length: 18 }, (_, index) => ({
      stage: index + 1,
      initialValue: 200 + index,
      maxValue: 200 + index
    }));
    const complete = {
      resourceKey: 'mana',
      initialValue: 200,
      maxValue: 200,
      stages
    };

    expect(buildResourceCurveBatchBody(3, { displayName: 'Ashe' }, complete)).toEqual({
      expectedCurrentRevision: 3,
      displayName: 'Ashe',
      resources: [
        {
          resourceKey: 'mana',
          initialValue: 200,
          maxValue: 200,
          stages
        }
      ]
    });

    const withImageMeta = buildResourceCurveBatchBody(
      3,
      { displayName: 'Ashe', imageUri: 'character_ashe' },
      complete
    );
    expect(withImageMeta).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(withImageMeta, 'imageUri')).toBe(false);

    const incomplete = materializeResourceCurve('mana', undefined, []);
    expect(buildResourceCurveBatchBody(3, { displayName: 'Ashe' }, incomplete)).toBeNull();
  });

  it('formats searchable labels from stable id + display name', () => {
    expect(formatStableLabel('ad', '攻击力')).toBe('ad / 攻击力');
    expect(formatStableLabel('ad', '  ')).toBe('ad');
    expect(buildLabelledOptions([{ id: 'b', displayName: 'Beta' }, { id: 'a', displayName: 'Alpha' }])).toEqual([
      { value: 'a', label: 'a / Alpha' },
      { value: 'b', label: 'b / Beta' }
    ]);
  });
});
