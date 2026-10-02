import type { CompileRequest, InitialSnapshot } from '../types/genericEngine';

/** 每次运行均从本次编译输入重新建立初始状态，不复用上次结果。 */
export function simulationInitialSnapshot(input: CompileRequest): InitialSnapshot {
  return {
    schemaHash: input.schemaHash, rulesHash: input.rulesHash, timeMs: 0,
    useTriggerLedger: [], processInstances: [], combatants: input.combatants.map(actor => ({
      key: actor.key, attributes: structuredClone(actor.attributes), resources: structuredClone(actor.resources),
      cooldowns: {}, providers: actor.providers.map(mount => ({
        providerRef: mount.providerRef, definitionRef: mount.definitionRef,
        source: actor.key, owner: actor.key, stacks: 1, expireAt: null,
        state: structuredClone(mount.initialState ?? {})
      })), shields: [], abilityState: {}, providerState: {}, vars: {}, effectiveStatuses: []
    }))
  };
}
