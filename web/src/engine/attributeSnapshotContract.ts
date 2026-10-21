import type { DoneResult } from '../types/genericEngine';

/** 此处只检查线上的新字段形状；实例完整键集合与恢复身份仍由原生编译定义核对。 */
export function assertAttributeSnapshotOutputShape(done: DoneResult) {
  for (const [actorIndex, actor] of (done.finalSnapshot?.combatants ?? []).entries()) {
    for (const [providerIndex, provider] of (actor.providers ?? []).entries()) {
      if (!Object.prototype.hasOwnProperty.call(provider, 'modifierSnapshots')) continue;
      const values = provider.modifierSnapshots;
      const path = `finalSnapshot.combatants[${actorIndex}].providers[${providerIndex}].modifierSnapshots`;
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`${path}: 需要完整修正快照对象`);
      for (const [key, value] of Object.entries(values)) if (!key || typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`${path}.${key}: 需要稳定修正键及有限非负快照值`);
      }
    }
  }
}
