import { getSimulationSnapshot } from '../../src/services/simulationSnapshotClient';
import type { SimulationSelection, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { isolatedSimulationSelection } from './simulationSkillSources';

export async function getIsolatedSimulationSnapshot(apiBase: string, gameId: string, selection: SimulationSelection, token: string): Promise<SimulationSnapshot> {
  const candidate = (await getSimulationSnapshot(apiBase, gameId, selection, token)).data;
  const snapshot = (await getSimulationSnapshot(apiBase, gameId, isolatedSimulationSelection(candidate), token)).data;
  for (const side of ['source', 'target'] as const) for (const source of snapshot[side].skillSources) {
    const expected = source.origin.kind !== 'CHARACTER' || source.skillStatus === 'DISABLED'
      || side === 'source' && source.skillKey === snapshot.selection.basicAttackSkillKey;
    if (source.enabled !== expected) throw new Error(`阶段对照来源开关不符：${side} ${JSON.stringify(source.origin)} ${source.skillKey}`);
  }
  return snapshot;
}
