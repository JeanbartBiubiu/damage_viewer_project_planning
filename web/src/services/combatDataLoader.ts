import type { CombatDataGraph } from '../types/combatData';
import {
  clearCombatDataGraphCache,
  readCombatDataGraphCache,
  writeCombatDataGraphCache
} from './combatDataCache';
import { getCombatDataState, loadCombatDataGraph } from './combatDataClient';

export class CombatDataRevisionChangedError extends Error {
  gameId: string;
  expectedRevision: number;
  actualRevision: number;

  constructor(gameId: string, expectedRevision: number, actualRevision: number) {
    super(
      `Combat-data revision changed for game "${gameId}" during load (expected ${expectedRevision}, got ${actualRevision}).`
    );
    this.name = 'CombatDataRevisionChangedError';
    this.gameId = gameId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export type LoadCombatDataGraphOptions = {
  preferCache?: boolean;
};

/**
 * Revision-safe combat-data graph load:
 * 1. GET /state → currentRevision
 * 2. Optional IndexedDB hit for apiBaseUrl+gameId+revision
 * 3. Load full graph
 * 4. Re-read /state; if revision changed, reload graph once
 * 5. If still changed after second load, throw CombatDataRevisionChangedError
 * 6. Write cache for final revision under apiBaseUrl namespace
 */
export async function loadCombatDataGraphRevisionSafe(
  apiBaseUrl: string,
  gameId: string,
  options: LoadCombatDataGraphOptions = {}
): Promise<CombatDataGraph> {
  const preferCache = options.preferCache ?? false;

  const initialState = await getCombatDataState(apiBaseUrl, gameId);
  const initialRevision = initialState.data.currentRevision;

  if (preferCache) {
    const cached = await readCombatDataGraphCache(apiBaseUrl, gameId, initialRevision).catch(() => null);
    if (cached && cached.currentRevision === initialRevision) {
      return cached;
    }
  }

  let graph = await loadCombatDataGraph(apiBaseUrl, gameId);

  const afterFirst = await getCombatDataState(apiBaseUrl, gameId);
  const afterFirstRevision = afterFirst.data.currentRevision;

  if (afterFirstRevision !== initialRevision) {
    graph = await loadCombatDataGraph(apiBaseUrl, gameId);

    const afterSecond = await getCombatDataState(apiBaseUrl, gameId);
    const afterSecondRevision = afterSecond.data.currentRevision;

    if (afterSecondRevision !== graph.currentRevision) {
      throw new CombatDataRevisionChangedError(gameId, graph.currentRevision, afterSecondRevision);
    }
  }

  await writeCombatDataGraphCache(apiBaseUrl, graph).catch(() => undefined);
  return graph;
}

/** Clear cache for the current API+game scope and reload a fresh revision-safe graph. */
export async function invalidateAndReload(
  apiBaseUrl: string,
  gameId: string
): Promise<CombatDataGraph> {
  await clearCombatDataGraphCache(apiBaseUrl, gameId).catch(() => undefined);
  return loadCombatDataGraphRevisionSafe(apiBaseUrl, gameId, { preferCache: false });
}
