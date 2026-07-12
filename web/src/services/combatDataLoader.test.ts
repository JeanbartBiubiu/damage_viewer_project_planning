import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCombatDataState = vi.fn();
const loadCombatDataGraph = vi.fn();
const readCombatDataGraphCache = vi.fn();
const writeCombatDataGraphCache = vi.fn();
const clearCombatDataGraphCache = vi.fn();

vi.mock('./combatDataClient', () => ({
  getCombatDataState: (...args: unknown[]) => getCombatDataState(...args),
  loadCombatDataGraph: (...args: unknown[]) => loadCombatDataGraph(...args)
}));

vi.mock('./combatDataCache', () => ({
  readCombatDataGraphCache: (...args: unknown[]) => readCombatDataGraphCache(...args),
  writeCombatDataGraphCache: (...args: unknown[]) => writeCombatDataGraphCache(...args),
  clearCombatDataGraphCache: (...args: unknown[]) => clearCombatDataGraphCache(...args)
}));

import {
  CombatDataRevisionChangedError,
  invalidateAndReload,
  loadCombatDataGraphRevisionSafe
} from './combatDataLoader';
import type { CombatDataGraph } from '../types/combatData';

function envelope(revision: number) {
  return {
    data: {
      gameId: 'demo',
      currentRevision: revision,
      data: {
        gameId: 'demo',
        currentRevision: revision,
        publishedRevision: 1,
        updatedAt: '2026-07-12T00:00:00Z'
      }
    }
  };
}

function graph(revision: number): CombatDataGraph {
  return {
    gameId: 'demo',
    currentRevision: revision,
    state: {
      gameId: 'demo',
      currentRevision: revision,
      publishedRevision: 1,
      updatedAt: '2026-07-12T00:00:00Z'
    },
    progressionSchema: null,
    attributeDefinitions: [],
    resourceDefinitions: [],
    types: [],
    typeRelations: [],
    entities: [],
    entityAttributes: [],
    entityAttributeStages: [],
    entityResources: [],
    entityResourceStages: [],
    entityProviderMounts: [],
    providers: [],
    providerLifecycles: [],
    providerStateFields: [],
    providerFormulas: [],
    providerModifiers: [],
    providerListeners: [],
    listenerMatchTypes: [],
    providerTickSequences: [],
    abilities: [],
    abilityParameters: [],
    abilityStateFields: [],
    abilityPhases: [],
    abilityCosts: [],
    abilityCooldowns: [],
    effectSequences: [],
    effectSteps: [],
    abilityPhaseEffectSequences: [],
    listenerEffectSequences: []
  };
}

describe('loadCombatDataGraphRevisionSafe', () => {
  beforeEach(() => {
    getCombatDataState.mockReset();
    loadCombatDataGraph.mockReset();
    readCombatDataGraphCache.mockReset();
    writeCombatDataGraphCache.mockReset();
    clearCombatDataGraphCache.mockReset();
    writeCombatDataGraphCache.mockResolvedValue(undefined);
    clearCombatDataGraphCache.mockResolvedValue(undefined);
  });

  it('returns graph when revision is stable', async () => {
    getCombatDataState.mockResolvedValueOnce(envelope(5)).mockResolvedValueOnce(envelope(5));
    loadCombatDataGraph.mockResolvedValueOnce(graph(5));

    const result = await loadCombatDataGraphRevisionSafe('http://localhost:8080', 'demo');
    expect(result.currentRevision).toBe(5);
    expect(loadCombatDataGraph).toHaveBeenCalledTimes(1);
    expect(writeCombatDataGraphCache).toHaveBeenCalledWith(expect.objectContaining({ currentRevision: 5 }));
  });

  it('reloads once when revision changes during first load', async () => {
    getCombatDataState
      .mockResolvedValueOnce(envelope(5))
      .mockResolvedValueOnce(envelope(6))
      .mockResolvedValueOnce(envelope(6));
    loadCombatDataGraph.mockResolvedValueOnce(graph(5)).mockResolvedValueOnce(graph(6));

    const result = await loadCombatDataGraphRevisionSafe('http://localhost:8080', 'demo');
    expect(result.currentRevision).toBe(6);
    expect(loadCombatDataGraph).toHaveBeenCalledTimes(2);
  });

  it('throws when revision keeps changing after second load', async () => {
    getCombatDataState
      .mockResolvedValueOnce(envelope(5))
      .mockResolvedValueOnce(envelope(6))
      .mockResolvedValueOnce(envelope(7));
    loadCombatDataGraph.mockResolvedValueOnce(graph(5)).mockResolvedValueOnce(graph(6));

    await expect(loadCombatDataGraphRevisionSafe('http://localhost:8080', 'demo')).rejects.toBeInstanceOf(
      CombatDataRevisionChangedError
    );
  });

  it('uses IndexedDB cache hit when preferCache and revision matches', async () => {
    getCombatDataState.mockResolvedValueOnce(envelope(9));
    readCombatDataGraphCache.mockResolvedValueOnce(graph(9));

    const result = await loadCombatDataGraphRevisionSafe('http://localhost:8080', 'demo', {
      preferCache: true
    });
    expect(result.currentRevision).toBe(9);
    expect(loadCombatDataGraph).not.toHaveBeenCalled();
  });

  it('invalidateAndReload clears cache then reloads', async () => {
    getCombatDataState.mockResolvedValueOnce(envelope(3)).mockResolvedValueOnce(envelope(3));
    loadCombatDataGraph.mockResolvedValueOnce(graph(3));

    const result = await invalidateAndReload('http://localhost:8080', 'demo');
    expect(clearCombatDataGraphCache).toHaveBeenCalledWith('demo');
    expect(result.currentRevision).toBe(3);
  });
});
