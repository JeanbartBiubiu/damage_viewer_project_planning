import { WASM_IDENTITY } from '../engine/wasmIdentity';
import { SIMULATION_ADAPTER_VERSION } from '../engine/simulationAdapter';
import type {
  SimulationAvailabilityEntry, SimulationAvailabilityIssue, SimulationAvailabilityRequiredCoverage,
  SimulationAvailabilityResponse, SimulationAvailabilityStatus, SimulationAvailabilityVerification
} from '../types/simulationAvailability';
import { encodePathSegment, requestJson, type ApiResult } from './apiClient';

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const statuses: readonly SimulationAvailabilityStatus[] = ['READY', 'CONFIGURATION_INCOMPLETE', 'ENGINE_UNSUPPORTED', 'UNVERIFIED', 'OUT_OF_SCOPE'];
export type SimulationAvailabilityIdentity = { wasmSha256: string; adapterVersion: string };
export const SIMULATION_AVAILABILITY_IDENTITY: Readonly<SimulationAvailabilityIdentity> = {
  wasmSha256: WASM_IDENTITY.sha256, adapterVersion: SIMULATION_ADAPTER_VERSION
};

function fail(path: string): never { throw new Error(`计算可用性目录响应不合法：${path}，请重新读取。`); }
function record(value: unknown, fields: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const row = value as Record<string, unknown>;
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(row, field)) fail(`${path}.${field}`);
  for (const field of Object.keys(row)) if (!fields.includes(field)) fail(`${path}.${field}`);
  return row;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(path);
  return value;
}
function key(value: unknown, path: string): string {
  const result = text(value, path);
  if (!KEY.test(result)) fail(path);
  return result;
}
function digest(value: unknown, path: string): string {
  const result = text(value, path);
  if (!SHA256.test(result)) fail(path);
  return result;
}
function rows(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path);
  return value;
}
function levels(value: unknown, path: string, fromOne: boolean): number[] {
  const result = rows(value, path);
  if (!result.length || result.some((level, index) => typeof level !== 'number' || !Number.isSafeInteger(level) || level < 1
    || (index > 0 && level !== (result[index - 1] as number) + 1)) || fromOne && result[0] !== 1) fail(path);
  return result as number[];
}
function coverage(value: unknown, path: string): SimulationAvailabilityRequiredCoverage | null {
  if (value === null) return null;
  const row = record(value, ['scenario', 'sides', 'characterLevels', 'skills', 'levelValidation', 'allRequiredSourcesEnabled',
    'sourceActiveStartedAndCompleted', 'relevantPassivesTriggered', 'equipmentMode'], path);
  if (row.scenario !== 'one-way-combat-analysis-v1') fail(`${path}.scenario`);
  if (!Array.isArray(row.sides) || row.sides.length !== 2 || row.sides[0] !== 'source' || row.sides[1] !== 'target') fail(`${path}.sides`);
  if (row.levelValidation !== 'each-declared-level') fail(`${path}.levelValidation`);
  for (const flag of ['allRequiredSourcesEnabled', 'sourceActiveStartedAndCompleted', 'relevantPassivesTriggered'] as const) {
    if (row[flag] !== true) fail(`${path}.${flag}`);
  }
  if (row.equipmentMode !== 'none' && row.equipmentMode !== 'single-item') fail(`${path}.equipmentMode`);
  const skills = rows(row.skills, `${path}.skills`).map((item, index) => {
    const itemPath = `${path}.skills[${index}]`;
    const skill = record(item, ['skillKey', 'levels'], itemPath);
    return { skillKey: key(skill.skillKey, `${itemPath}.skillKey`), levels: levels(skill.levels, `${itemPath}.levels`, true) };
  });
  if (new Set(skills.map(skill => skill.skillKey)).size !== skills.length) fail(`${path}.skills`);
  return { scenario: row.scenario, sides: ['source', 'target'], characterLevels: levels(row.characterLevels, `${path}.characterLevels`, false),
    skills, levelValidation: row.levelValidation, allRequiredSourcesEnabled: true, sourceActiveStartedAndCompleted: true,
    relevantPassivesTriggered: true, equipmentMode: row.equipmentMode };
}
function verification(value: unknown, path: string, identity: SimulationAvailabilityIdentity): SimulationAvailabilityVerification {
  const row = record(value, ['wasmSha256', 'adapterVersion', 'externalDigest', 'requiredCoverage', 'matched', 'evidenceRefs'], path);
  if (digest(row.wasmSha256, `${path}.wasmSha256`) !== identity.wasmSha256) fail(`${path}.wasmSha256`);
  if (text(row.adapterVersion, `${path}.adapterVersion`) !== identity.adapterVersion) fail(`${path}.adapterVersion`);
  if (typeof row.matched !== 'boolean') fail(`${path}.matched`);
  const evidenceRefs = rows(row.evidenceRefs, `${path}.evidenceRefs`).map((item, index) => text(item, `${path}.evidenceRefs[${index}]`));
  if (new Set(evidenceRefs).size !== evidenceRefs.length) fail(`${path}.evidenceRefs`);
  return { wasmSha256: identity.wasmSha256, adapterVersion: identity.adapterVersion,
    externalDigest: digest(row.externalDigest, `${path}.externalDigest`), requiredCoverage: coverage(row.requiredCoverage, `${path}.requiredCoverage`),
    matched: row.matched, evidenceRefs };
}
function issues(value: unknown, path: string): SimulationAvailabilityIssue[] {
  return rows(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const row = record(item, ['code', 'skillKey', 'fieldPath', 'message'], itemPath);
    return { code: text(row.code, `${itemPath}.code`), skillKey: row.skillKey === null ? null : key(row.skillKey, `${itemPath}.skillKey`),
      fieldPath: row.fieldPath === null ? null : text(row.fieldPath, `${itemPath}.fieldPath`), message: text(row.message, `${itemPath}.message`) };
  });
}
function entries(value: unknown, path: string, identity: SimulationAvailabilityIdentity, equipment: boolean): SimulationAvailabilityEntry[] {
  const result = rows(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const row = record(item, ['key', 'status', 'contentDigest', 'issues', 'excludedSkillSources', 'verification'], itemPath);
    if (!statuses.includes(row.status as SimulationAvailabilityStatus)) fail(`${itemPath}.status`);
    const parsed: SimulationAvailabilityEntry = { key: key(row.key, `${itemPath}.key`), status: row.status as SimulationAvailabilityStatus,
      contentDigest: digest(row.contentDigest, `${itemPath}.contentDigest`), issues: issues(row.issues, `${itemPath}.issues`),
      excludedSkillSources: rows(row.excludedSkillSources, `${itemPath}.excludedSkillSources`).map((value, index) => {
        const excludedPath = `${itemPath}.excludedSkillSources[${index}]`;
        const excluded = record(value, ['skillKey', 'reason'], excludedPath);
        return { skillKey: key(excluded.skillKey, `${excludedPath}.skillKey`), reason: text(excluded.reason, `${excludedPath}.reason`) };
      }),
      verification: verification(row.verification, `${itemPath}.verification`, identity) };
    const excludedKeys = parsed.excludedSkillSources.map(source => source.skillKey);
    if (new Set(excludedKeys).size !== excludedKeys.length || (equipment || parsed.status === 'OUT_OF_SCOPE') && excludedKeys.length
      || parsed.verification.requiredCoverage?.skills.some(skill => excludedKeys.includes(skill.skillKey))) fail(`${itemPath}.excludedSkillSources`);
    if (parsed.verification.requiredCoverage && parsed.verification.requiredCoverage.equipmentMode !== (equipment ? 'single-item' : 'none')) {
      fail(`${itemPath}.verification.requiredCoverage.equipmentMode`);
    }
    if (parsed.status === 'OUT_OF_SCOPE' && (parsed.verification.requiredCoverage !== null || parsed.verification.matched)) fail(`${itemPath}.verification`);
    if (parsed.status === 'READY' && (!parsed.verification.matched || !parsed.verification.evidenceRefs.length
      || parsed.issues.length || !parsed.verification.requiredCoverage)) fail(`${itemPath}.verification`);
    return parsed;
  });
  if (new Set(result.map(item => item.key)).size !== result.length) fail(path);
  return result;
}

export function parseSimulationAvailabilityResponse(value: unknown, gameId: string,
  identity: SimulationAvailabilityIdentity = SIMULATION_AVAILABILITY_IDENTITY): SimulationAvailabilityResponse {
  const row = record(value, ['gameId', 'profile', 'digestVersion', 'scopeDigest', 'sharedDigest', 'characters', 'equipment'], 'availability');
  if (row.gameId !== gameId) fail('availability.gameId');
  if (row.profile !== 'combat-analysis-v1') fail('availability.profile');
  if (row.digestVersion !== 'simulation-availability-v1') fail('availability.digestVersion');
  return { gameId, profile: row.profile, digestVersion: row.digestVersion, scopeDigest: digest(row.scopeDigest, 'availability.scopeDigest'),
    sharedDigest: digest(row.sharedDigest, 'availability.sharedDigest'),
    characters: entries(row.characters, 'availability.characters', identity, false), equipment: entries(row.equipment, 'availability.equipment', identity, true) };
}

export function simulationAvailabilityPath(gameId: string, identity: SimulationAvailabilityIdentity = SIMULATION_AVAILABILITY_IDENTITY): string {
  const query = new URLSearchParams({ wasmSha256: identity.wasmSha256, adapterVersion: identity.adapterVersion });
  return `/api/admin/games/${encodePathSegment(gameId)}/simulation-availability?${query}`;
}

export async function getSimulationAvailability(apiBaseUrl: string, gameId: string, signal?: AbortSignal): Promise<ApiResult<SimulationAvailabilityResponse>> {
  const result = await requestJson<unknown>(apiBaseUrl, simulationAvailabilityPath(gameId), { signal, cache: 'no-store' });
  if (signal?.aborted) throw new DOMException('计算可用性读取已取消。', 'AbortError');
  return { ...result, data: parseSimulationAvailabilityResponse(result.data, gameId) };
}
