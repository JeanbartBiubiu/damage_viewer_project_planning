import { describe, expect, it } from 'vitest';
import {
  adaptEnvelopeDataToRecords,
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
