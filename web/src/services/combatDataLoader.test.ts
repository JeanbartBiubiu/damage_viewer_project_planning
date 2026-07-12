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
    expect(writeCombatDataGraphCache).toHaveBeenCalledWith(
      'http://localhost:8080',
      expect.objectContaining({ currentRevision: 5 })
    );
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
    expect(readCombatDataGraphCache).toHaveBeenCalledWith('http://localhost:8080', 'demo', 9);
    expect(loadCombatDataGraph).not.toHaveBeenCalled();
  });

  it('routes apiBaseUrl through all cache operations', async () => {
    const apiBaseUrl = 'http://localhost:8082';
    getCombatDataState.mockResolvedValueOnce(envelope(4)).mockResolvedValueOnce(envelope(4));
    loadCombatDataGraph.mockResolvedValueOnce(graph(4));
    readCombatDataGraphCache.mockResolvedValueOnce(null);

    await loadCombatDataGraphRevisionSafe(apiBaseUrl, 'demo', { preferCache: true });
    expect(readCombatDataGraphCache).toHaveBeenCalledWith(apiBaseUrl, 'demo', 4);
    expect(writeCombatDataGraphCache).toHaveBeenCalledWith(apiBaseUrl, expect.objectContaining({ currentRevision: 4 }));

    getCombatDataState.mockResolvedValueOnce(envelope(4)).mockResolvedValueOnce(envelope(4));
    loadCombatDataGraph.mockResolvedValueOnce(graph(4));

    await invalidateAndReload(apiBaseUrl, 'demo');
    expect(clearCombatDataGraphCache).toHaveBeenCalledWith(apiBaseUrl, 'demo');
    expect(readCombatDataGraphCache).toHaveBeenCalledTimes(1);
  });

  it('invalidateAndReload clears only apiBaseUrl+gameId scope then reloads without cache', async () => {
    getCombatDataState.mockResolvedValueOnce(envelope(3)).mockResolvedValueOnce(envelope(3));
    loadCombatDataGraph.mockResolvedValueOnce(graph(3));

    const result = await invalidateAndReload('http://localhost:8080', 'demo');
    expect(clearCombatDataGraphCache).toHaveBeenCalledWith('http://localhost:8080', 'demo');
    expect(clearCombatDataGraphCache).toHaveBeenCalledTimes(1);
    expect(readCombatDataGraphCache).not.toHaveBeenCalled();
    expect(result.currentRevision).toBe(3);
  });
});
