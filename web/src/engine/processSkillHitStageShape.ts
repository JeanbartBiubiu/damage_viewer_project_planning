import type { ProcessSkillHitStage } from '../types/genericEngine';

const baseFields = ['hitBindingKey', 'stepKey', 'timeMs', 'released', 'contact', 'completed'];
const contactFields = ['hitSequence', 'hitOccurrenceId', 'hitBlocked'];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** 接触必须携带三项提交事实；未接触保持六字段，不兼容缺失身份或默认0。 */
export function assertProcessSkillHitStageShape(value: unknown, path = 'processInstances.skillHitStages'): asserts value is ProcessSkillHitStage {
  const fail = () => { throw new Error(`${path}: 命中阶段必须按真实contact保留精确九字段或六字段`); };
  if (!record(value) || typeof value.contact !== 'boolean') fail();
  const row = value as Record<string, unknown>;
  const fields = row.contact ? [...baseFields, ...contactFields] : baseFields;
  if (Object.keys(row).length !== fields.length || Object.keys(row).some(key => !fields.includes(key))
    || ['hitBindingKey', 'stepKey'].some(key => typeof row[key] !== 'string' || !row[key])
    || typeof row.timeMs !== 'number' || !Number.isSafeInteger(row.timeMs) || row.timeMs < 0
    || typeof row.released !== 'boolean' || typeof row.completed !== 'boolean'
    || row.contact && (!positive(row.hitSequence) || !positive(row.hitOccurrenceId) || ![0, 1].includes(Number(row.hitBlocked))
      || typeof row.hitBlocked !== 'number')) fail();
}

/** 发生编号只在本次运行中唯一；不能把同一个原HIT登记到不同过程或阶段。 */
export function assertProcessSkillHitStagesOutputShape(value: unknown): void {
  if (!record(value) || !record(value.finalSnapshot) || !Array.isArray(value.finalSnapshot.processInstances)) return;
  const occurrences = new Set<number>();
  for (const [index, process] of value.finalSnapshot.processInstances.entries()) {
    if (!record(process) || process.skillHitStages === undefined) continue;
    if (!Array.isArray(process.skillHitStages) || process.skillHitStages.length > 64) {
      throw new Error(`processInstances[${index}].skillHitStages: 缺少有限阶段数组`);
    }
    for (const [ordinal, stage] of process.skillHitStages.entries()) {
      assertProcessSkillHitStageShape(stage, `processInstances[${index}].skillHitStages[${ordinal}]`);
      if (!stage.contact) continue;
      if (occurrences.has(stage.hitOccurrenceId)) throw new Error('processInstances.skillHitStages: 同次命中发生编号不能重复归入其他阶段');
      occurrences.add(stage.hitOccurrenceId);
    }
  }
}
