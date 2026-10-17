import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { SIMULATION_ADAPTER_VERSION } from '../../src/engine/simulationAdapter';
import type { SimulationAvailabilityEntry, SimulationAvailabilityResponse, SimulationAvailabilityStatus } from '../../src/types/simulationAvailability';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';

/** 完全独立的接口结构构造；READY 只服务本地页面测试，不是实库录入或整英雄运行证明。 */
export function simulationAvailabilityEntry(key: string, options: {
  equipment?: boolean; characterLevels?: number[]; skills?: Array<{ skillKey: string; levels: number[] }>;
} = {}): SimulationAvailabilityEntry {
  return { key, status: 'READY', contentDigest: '1'.repeat(64), excludedSkillSources: [], issues: [], verification: {
    wasmSha256: WASM_IDENTITY.sha256, adapterVersion: SIMULATION_ADAPTER_VERSION, externalDigest: '2'.repeat(64),
    matched: true, evidenceRefs: [`independent-fixture://simulation-availability/${options.equipment ? 'equipment' : 'character'}/${key}`],
    requiredCoverage: { scenario: 'one-way-combat-analysis-v1', sides: ['source', 'target'], characterLevels: options.characterLevels ?? [1],
      skills: options.skills ?? [], levelValidation: 'each-declared-level', allRequiredSourcesEnabled: true,
      sourceActiveStartedAndCompleted: true, relevantPassivesTriggered: true, equipmentMode: options.equipment ? 'single-item' : 'none' }
  } };
}

export function simulationAvailabilityCatalog(gameId: string, characters: SimulationAvailabilityEntry[] = [],
  equipment: SimulationAvailabilityEntry[] = []): SimulationAvailabilityResponse {
  return { gameId, profile: 'combat-analysis-v1', digestVersion: 'simulation-availability-v1',
    scopeDigest: '3'.repeat(64), sharedDigest: '4'.repeat(64), characters, equipment };
}

export function simulationAvailabilitySample(snapshot: SimulationSnapshot): SimulationAvailabilityResponse {
  const characters = [snapshot.source, snapshot.target].map(actor => simulationAvailabilityEntry(actor.character.characterKey, {
    characterLevels: Array.from({ length: actor.attributes.maxLevel - actor.attributes.minLevel + 1 }, (_, index) => actor.attributes.minLevel + index),
    skills: actor.attachedSkills.filter(relation => relation.skillStatus === 'ENABLED').map(relation => ({ skillKey: relation.skillKey,
      levels: Array.from({ length: snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === relation.skillKey)!.skill.maxLevel }, (_, index) => index + 1) }))
  }));
  const equipment = [...new Set([...snapshot.source.selectedEquipment, ...snapshot.target.selectedEquipment].map(item => item.equipment.equipmentKey))]
    .map(key => simulationAvailabilityEntry(key, { equipment: true }));
  return simulationAvailabilityCatalog(snapshot.gameId, characters, equipment);
}

export function unavailableSimulationEntry(entry: SimulationAvailabilityEntry, status: Exclude<SimulationAvailabilityStatus, 'READY'>,
  message: string, fieldPath = 'skills.fixture.required', skillKey: string | null = null): SimulationAvailabilityEntry {
  return { ...entry, status, issues: [{ code: `INDEPENDENT_${status}`, skillKey, fieldPath, message }],
    verification: { ...entry.verification, matched: false, evidenceRefs: [],
      requiredCoverage: status === 'OUT_OF_SCOPE' ? null : entry.verification.requiredCoverage } };
}
