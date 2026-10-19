import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AutomaticSkillInput } from '../../src/engine/automaticSkillRequest';
import type { SkillActionInput } from '../../src/engine/skillActionRequest';
import type { SimulationAttributeInputs, SimulationInitialHealth, SimulationSnapshot } from '../../src/types/simulationSnapshot';

export const MECHANISM_CASE_VERSION = 'mechanism-case-v1';
export const MECHANISM_CATALOG_VERSION = 'mechanism-catalog-v1';
export const MECHANISM_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));

export type MechanismMode = 'continuous_attack' | 'skill_action' | 'automatic_skill';

export type MechanismScenario = {
  mode: MechanismMode;
  durationMs: number;
  initialHealth: SimulationInitialHealth;
  attributeInputs?: SimulationAttributeInputs;
  attackSpeedInputMax?: number;
  actions?: SkillActionInput[];
  automaticRules?: AutomaticSkillInput[];
};

export type ProjectedSummary = {
  stopReason: string;
  sourceFinalHp: number;
  targetFinalHp: number;
  sourceDamageDealt: number;
  targetHpLoss: number;
  sourceDirectHealing: number;
  sourceVampHealing: number;
  targetKilledAtMs: number | null;
  basicAttackStarted: number;
  basicAttackHits: number;
};
export type ProjectedDamage = {
  timeMs: number; source: string; target: string; skillKey: string | null; effectKey: string | null; resultKey: string | null;
  damageType: string; rawAmount: number; postDefenseDamage: number; shieldAbsorbed: number; actualHpLoss: number;
};
export type ProjectedHealing = { timeMs: number; source: string; target: string; rawAmount: number; actualHealing: number; overheal: number };
export type ProjectedSkillStart = { timeMs: number; skillKey: string };
export type MechanismProjection = {
  summary: ProjectedSummary;
  damage: ProjectedDamage[];
  healing: ProjectedHealing[];
  skillStarts: ProjectedSkillStart[];
  attackStarts: number[];
};

/** 期望只写手算或游戏机制确定的值；列表按发生顺序完整列出，对象只比较写出的字段。 */
export type MechanismExpectation = {
  summary?: Partial<ProjectedSummary>;
  damage?: Partial<ProjectedDamage>[];
  healing?: Partial<ProjectedHealing>[];
  skillStarts?: ProjectedSkillStart[];
  attackStarts?: number[];
};

type CaseSnapshot = Omit<SimulationSnapshot, 'gameId' | 'catalogs' | 'snapshotDigest' | 'readAt'>;
export type MechanismCaseFile = {
  schemaVersion: typeof MECHANISM_CASE_VERSION;
  caseKey: string;
  title: string;
  mechanisms: string[];
  derivation: string[];
  catalog: string;
  snapshot: CaseSnapshot;
  scenario: MechanismScenario;
  expected: MechanismExpectation;
};
type CatalogFile = { schemaVersion: typeof MECHANISM_CATALOG_VERSION; catalogKey: string; gameId: string; catalogs: SimulationSnapshot['catalogs'] };

export type MechanismCase = MechanismCaseFile & { file: string; gameId: string; fileSha256: string; buildSnapshot(): SimulationSnapshot };

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const MODES: readonly MechanismMode[] = ['continuous_attack', 'skill_action', 'automatic_skill'];

function fail(file: string, message: string): never { throw new Error(`${file}: ${message}`); }
function object(value: unknown, file: string, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(file, `${path} 需要对象`);
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], file: string, path: string) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) fail(file, `${path} 含未定义字段 ${unknown.join(',')}`);
}
function texts(value: unknown, file: string, path: string): string[] {
  if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== 'string' || !item.trim())) fail(file, `${path} 需要非空字符串数组`);
  return value as string[];
}

function readCatalog(catalogKey: string, file: string): CatalogFile {
  if (!KEY.test(catalogKey)) fail(file, 'catalog 需要合法标识');
  const path = resolve(MECHANISM_ROOT, 'catalogs', `${catalogKey}.json`);
  const catalog = JSON.parse(readFileSync(path, 'utf8')) as CatalogFile;
  if (catalog.schemaVersion !== MECHANISM_CATALOG_VERSION || catalog.catalogKey !== catalogKey || !KEY.test(catalog.gameId)) {
    fail(path, '共享目录版本、标识或游戏标识不合法');
  }
  return catalog;
}

export function parseMechanismCase(bytes: Buffer, file: string): MechanismCase {
  const raw = object(JSON.parse(bytes.toString('utf8')), file, 'case');
  onlyKeys(raw, ['schemaVersion', 'caseKey', 'title', 'mechanisms', 'derivation', 'catalog', 'snapshot', 'scenario', 'expected'], file, 'case');
  if (raw.schemaVersion !== MECHANISM_CASE_VERSION) fail(file, `schemaVersion 需要 ${MECHANISM_CASE_VERSION}`);
  if (typeof raw.caseKey !== 'string' || !KEY.test(raw.caseKey) || `${raw.caseKey}.json` !== basename(file)) fail(file, 'caseKey 必须是合法标识且与文件名一致');
  if (typeof raw.title !== 'string' || !raw.title.trim()) fail(file, 'title 不能为空');
  texts(raw.mechanisms, file, 'mechanisms');
  texts(raw.derivation, file, 'derivation');
  object(raw.snapshot, file, 'snapshot');
  const scenario = object(raw.scenario, file, 'scenario');
  onlyKeys(scenario, ['mode', 'durationMs', 'initialHealth', 'attributeInputs', 'attackSpeedInputMax', 'actions', 'automaticRules'], file, 'scenario');
  if (!MODES.includes(scenario.mode as MechanismMode)) fail(file, `scenario.mode 需要 ${MODES.join('|')}`);
  if (!Number.isSafeInteger(scenario.durationMs) || (scenario.durationMs as number) < 1) fail(file, 'scenario.durationMs 需要正整数毫秒');
  const health = object(scenario.initialHealth, file, 'scenario.initialHealth');
  if (typeof health.source !== 'number' || typeof health.target !== 'number') fail(file, 'scenario.initialHealth 需要明确双方当前生命');
  if (scenario.mode === 'skill_action' && !Array.isArray(scenario.actions)) fail(file, 'skill_action 需要 scenario.actions');
  if (scenario.mode === 'automatic_skill' && !Array.isArray(scenario.automaticRules)) fail(file, 'automatic_skill 需要 scenario.automaticRules');
  const expected = object(raw.expected, file, 'expected');
  onlyKeys(expected, ['summary', 'damage', 'healing', 'skillStarts', 'attackStarts'], file, 'expected');
  if (!Object.keys(expected).length) fail(file, 'expected 至少要有一项手算期望');
  const definition = raw as unknown as MechanismCaseFile;
  const catalog = readCatalog(definition.catalog, file);
  const fileSha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    ...definition, file, gameId: catalog.gameId, fileSha256,
    buildSnapshot: () => ({
      ...structuredClone(definition.snapshot), gameId: catalog.gameId, catalogs: structuredClone(catalog.catalogs),
      snapshotDigest: fileSha256, readAt: '2026-01-01T00:00:00Z'
    })
  };
}

export function loadMechanismCases(): MechanismCase[] {
  const directory = resolve(MECHANISM_ROOT, 'cases');
  const files = readdirSync(directory).filter(name => name.endsWith('.json')).sort();
  if (!files.length) throw new Error(`${directory}: 没有机制用例`);
  return files.map(name => {
    const file = resolve(directory, name);
    return parseMechanismCase(readFileSync(file), file);
  });
}
