import type { GameDataBundle, Hero, TypeDefinition, TypeRelation } from '../types/api';
import type { TinyGoV2AttributeDefinition, TinyGoV2EngineBundle } from './tinygoV2BundleAdapter';

export const V2_DPS_CASE_ID = 'V2-BatchA-basic-aa-001';
export const V2_DPS_TARGET_DUMMY_TYPE_NAME = 'target_dummy';
const V2_DPS_BASIC_ATTACK_ACTION_ID = 'basic_attack';

export type V2DpsSelection = {
  attackerHeroId: string;
  targetActorId: string;
  durationMs: number;
};

export type V2DpsActorOption = {
  actorId: string;
  label: string;
  typeNames: string[];
};

export type V2DpsActorTypeGroup = {
  typeKey: string;
  label: string;
  isTargetDummy: boolean;
  actors: V2DpsActorOption[];
};

export type V2DpsActorSnapshot = {
  actorId: string;
  templateId?: string;
  name?: string;
  level?: number;
  types: string[];
  attributes: Record<string, number>;
  currentHp: number;
  maxHp: number;
};

export type V2DpsPreparedInput = {
  engineBundle: TinyGoV2EngineBundle;
  runInput: V2DpsRunInput;
};

export type V2DpsRunInput = {
  mode: 'single_attacker_dps';
  caseId: string;
  versionCode: string;
  wasmSha256: string;
  simulationRules: {
    durationMs: number;
    warmupMs: number;
    sampleBy: 'none';
    attackSpeedCap: number;
    firstAttackAtMs: number;
    eventWindowPolicy: 'timeMs < durationMs';
    dotTickIntervalMs: number;
    critPolicy: 'expected';
    seed: number;
    autoAttackPlan: {
      enabled: true;
      actionId: 'basic_attack';
      startAtMs: number;
      targetRole: 'target';
    };
    maxEvents: number;
  };
  targetSnapshot: V2DpsActorSnapshot;
  curves: V2DpsCurveRunSpec[];
};

export type V2DpsCurveRunSpec = {
  curveId: string;
  label: string;
  selection: {
    heroId: string;
    heroLevel: number;
    targetId: string;
    targetType: string;
    skillLevels: Record<string, number>;
    equipmentSet: string[];
    enabledPassiveEffects: string[];
    scenarioStates: unknown[];
    critPolicy: 'expected';
  };
  resolvedSnapshot: {
    attackerSnapshot: V2DpsActorSnapshot;
    targetSnapshot: V2DpsActorSnapshot;
    equipmentSet: string[];
    equipmentStats: Record<string, number>;
    enabledPassiveEffects: string[];
    externalPassiveEffects: string[];
    scenarioStates: unknown[];
    runeStatAdjustments: Record<string, number>;
  };
};

export type V2DpsOutput = {
  caseId: string;
  versionCode: string;
  wasmSha256: string;
  simulationRules: V2DpsRunInput['simulationRules'];
  targetSnapshot: V2DpsActorSnapshot;
  curveResults: V2DpsCurveResult[];
};

export type V2DpsCurveResult = {
  curveId: string;
  status: 'ok' | 'blocked';
  durationMs: number;
  finalTimeMs: number;
  stopReason: string;
  processedEvents: number;
  queuePeak: number;
  attackCount: number;
  attackTimeline: Array<{ timeMs: number; actionId: string; sourceActorId: string; targetActorId: string }>;
  attackIntervalTimeline: Array<{
    timeMs: number;
    rawAttackSpeed: number;
    effectiveAttackSpeed: number;
    overflowAttackSpeed: number;
    attackIntervalMs: number;
    nextAttackAtMs: number;
    source: string;
  }>;
  damageTimeline: Array<{
    timeMs: number;
    source: string;
    damageType: string;
    rawDamage: number;
    finalDamage: number;
    targetHpBefore: number;
    targetHpAfter: number;
  }>;
  targetHpTimeline: Array<{ timeMs: number; currentHp: number; maxHp: number }>;
  totalDamage: number;
  timeWindowDps: number;
  killDps: number | null;
  killTimeMs: number | null;
  damageByType: Record<string, number>;
  damageBySource: Record<string, number>;
  skillPassiveTriggers: unknown[];
  itemPassiveTriggers: unknown[];
  externalPassiveTriggers: unknown[];
  blockedReasons: string[];
  selection: V2DpsCurveRunSpec['selection'];
  resolvedSnapshot: V2DpsCurveRunSpec['resolvedSnapshot'];
};

export function createDefaultV2DpsSelection(bundle: GameDataBundle): V2DpsSelection {
  const targetGroups = listV2DpsTargetGroups(bundle);
  const targetDummyGroup = targetGroups.find((group) => group.isTargetDummy);
  const targetActorId =
    targetDummyGroup?.actors.find((actor) => actor.actorId === 'target_dummy_fighter')?.actorId
    ?? targetDummyGroup?.actors[0]?.actorId
    ?? targetGroups[0]?.actors[0]?.actorId
    ?? '';
  return {
    attackerHeroId: findDefaultAttacker(bundle),
    targetActorId,
    durationMs: 10000
  };
}

export function listV2DpsAttackers(bundle: GameDataBundle): V2DpsActorOption[] {
  const targetIds = new Set(
    listV2DpsTargetGroups(bundle)
      .flatMap((group) => group.isTargetDummy ? group.actors.map((actor) => actor.actorId) : [])
  );
  return bundle.heroes
    .filter((hero) => hero.heroId && !targetIds.has(hero.heroId))
    .map((hero) => ({
      actorId: hero.heroId,
      label: `${hero.heroId} / ${hero.name ?? hero.heroId}`,
      typeNames: resolveHeroTypeNames(bundle, hero.heroId)
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
}

export function listV2DpsTargetGroups(bundle: GameDataBundle): V2DpsActorTypeGroup[] {
  const typeById = new Map(bundle.types.map((type) => [type.typeId, type]));
  const groups = new Map<string, V2DpsActorTypeGroup>();

  for (const hero of bundle.heroes) {
    const relations = typeRelationsForHero(bundle, hero.heroId);
    if (relations.length === 0) {
      addHeroToGroup(groups, 'uncategorized', 'uncategorized', false, hero, []);
      continue;
    }
    for (const relation of relations) {
      const type = typeById.get(relation.typeId);
      const typeName = normalizeTypeName(type);
      const isTargetDummy = isTargetDummyRelation(relation, type);
      addHeroToGroup(groups, typeName, typeName, isTargetDummy, hero, resolveHeroTypeNames(bundle, hero.heroId));
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      actors: dedupeActors(group.actors).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
    }))
    .sort((left, right) => {
      if (left.isTargetDummy !== right.isTargetDummy) {
        return left.isTargetDummy ? -1 : 1;
      }
      return left.label.localeCompare(right.label, 'zh-CN');
    });
}

export function prepareV2DpsInput(
  bundle: GameDataBundle,
  selection: V2DpsSelection,
  versionCode: string,
  wasmSha256: string
): V2DpsPreparedInput {
  const attrDefinitions = normalizeAttributeDefinitions(bundle.attributeDefinitions);
  const attackerHero = bundle.heroes.find((hero) => hero.heroId === selection.attackerHeroId);
  const targetHero = bundle.heroes.find((hero) => hero.heroId === selection.targetActorId);
  const attackerSnapshot = attackerHero
    ? buildActorSnapshot(bundle, attrDefinitions, attackerHero, 1)
    : emptyActorSnapshot(selection.attackerHeroId);
  const targetSnapshot = targetHero
    ? buildActorSnapshot(bundle, attrDefinitions, targetHero, 1)
    : emptyActorSnapshot(selection.targetActorId);
  const targetTypeNames = targetHero ? resolveHeroTypeNames(bundle, targetHero.heroId) : [];
  const targetType = targetTypeNames.includes(V2_DPS_TARGET_DUMMY_TYPE_NAME) ? V2_DPS_TARGET_DUMMY_TYPE_NAME : targetTypeNames[0] ?? '';
  const simulationRules: V2DpsRunInput['simulationRules'] = {
    durationMs: selection.durationMs,
    warmupMs: 0,
    sampleBy: 'none',
    attackSpeedCap: 3.0,
    firstAttackAtMs: 0,
    eventWindowPolicy: 'timeMs < durationMs',
    dotTickIntervalMs: 1000,
    critPolicy: 'expected',
    seed: 0,
    autoAttackPlan: {
      enabled: true,
      actionId: V2_DPS_BASIC_ATTACK_ACTION_ID,
      startAtMs: 0,
      targetRole: 'target'
    },
    maxEvents: 10000
  };
  const curve: V2DpsCurveRunSpec = {
    curveId: `${selection.attackerHeroId || 'missing_attacker'}-basic-aa`,
    label: `${attackerHero?.name ?? (selection.attackerHeroId || 'missing attacker')} basic attack`,
    selection: {
      heroId: selection.attackerHeroId,
      heroLevel: 1,
      targetId: selection.targetActorId,
      targetType,
      skillLevels: {},
      equipmentSet: [],
      enabledPassiveEffects: [],
      scenarioStates: [],
      critPolicy: 'expected'
    },
    resolvedSnapshot: {
      attackerSnapshot,
      targetSnapshot,
      equipmentSet: [],
      equipmentStats: {},
      enabledPassiveEffects: [],
      externalPassiveEffects: [],
      scenarioStates: [],
      runeStatAdjustments: {}
    }
  };

  return {
    engineBundle: createV2DpsInitBundle(),
    runInput: {
      mode: 'single_attacker_dps',
      caseId: V2_DPS_CASE_ID,
      versionCode,
      wasmSha256,
      simulationRules,
      targetSnapshot,
      curves: [curve]
    }
  };
}

function createV2DpsInitBundle(): TinyGoV2EngineBundle {
  return {
    schemaVersion: 1,
    attributes: [],
    actors: [],
    actions: [],
    formulas: [],
    settings: {
      maxEvents: 1,
      maxCommandsPerEvent: 64
    }
  };
}

function findDefaultAttacker(bundle: GameDataBundle): string {
  const attackers = listV2DpsAttackers(bundle);
  return attackers.find((actor) => actor.actorId === 'Vayne')?.actorId
    ?? attackers.find((actor) => /vayne|薇恩/i.test(actor.label))?.actorId
    ?? attackers[0]?.actorId
    ?? '';
}

function addHeroToGroup(
  groups: Map<string, V2DpsActorTypeGroup>,
  typeKey: string,
  label: string,
  isTargetDummy: boolean,
  hero: Hero,
  typeNames: string[]
) {
  const existing = groups.get(typeKey);
  const group = existing ?? { typeKey, label, isTargetDummy, actors: [] };
  group.isTargetDummy = group.isTargetDummy || isTargetDummy;
  group.actors.push({
    actorId: hero.heroId,
    label: `${hero.heroId} / ${hero.name ?? hero.heroId}`,
    typeNames
  });
  groups.set(typeKey, group);
}

function dedupeActors(actors: V2DpsActorOption[]): V2DpsActorOption[] {
  const seen = new Set<string>();
  return actors.filter((actor) => {
    if (seen.has(actor.actorId)) {
      return false;
    }
    seen.add(actor.actorId);
    return true;
  });
}

function typeRelationsForHero(bundle: GameDataBundle, heroId: string): TypeRelation[] {
  return bundle.typeRelations.filter((relation) => relation.targetCategory === 'character' && relation.targetId === heroId);
}

function resolveHeroTypeNames(bundle: GameDataBundle, heroId: string): string[] {
  const typeById = new Map(bundle.types.map((type) => [type.typeId, type]));
  return typeRelationsForHero(bundle, heroId)
    .map((relation) => normalizeTypeName(typeById.get(relation.typeId)))
    .filter(Boolean);
}

function isTargetDummyRelation(relation: TypeRelation, type: TypeDefinition | undefined): boolean {
  const role = relation.extend && typeof relation.extend.role === 'string' ? relation.extend.role : '';
  return role === V2_DPS_TARGET_DUMMY_TYPE_NAME || normalizeTypeName(type) === V2_DPS_TARGET_DUMMY_TYPE_NAME;
}

function normalizeTypeName(type: TypeDefinition | undefined): string {
  return (type?.name || (type?.typeId !== undefined ? String(type.typeId) : '')).trim();
}

function normalizeAttributeDefinitions(definitions: GameDataBundle['attributeDefinitions']): TinyGoV2AttributeDefinition[] {
  const seen = new Set<string>();
  const result: TinyGoV2AttributeDefinition[] = [];
  for (const definition of definitions) {
    if (!definition.attrKey || seen.has(definition.attrKey)) {
      continue;
    }
    seen.add(definition.attrKey);
    const defaultValue = toNumber(definition.defaultValue, 0);
    result.push({
      id: definition.attrKey,
      defaultBase: defaultValue,
      defaultCurrent: defaultValue,
      defaultMax: defaultValue,
      hasDefaultCurrent: true,
      hasDefaultMax: true
    });
  }
  return result;
}

function buildActorSnapshot(
  bundle: GameDataBundle,
  attrDefinitions: TinyGoV2AttributeDefinition[],
  hero: Hero,
  level: number
): V2DpsActorSnapshot {
  const attrs = Object.fromEntries(attrDefinitions.map((definition) => [definition.id, toNumber(definition.defaultBase, 0)]));
  applyNumberMap(attrs, resolveHeroStatsAtLevel(hero, level));
  const maxHp = Math.max(readFirstNumber(attrs, ['hp', 'health', 'max_hp', 'max_health']) ?? 0, 0);
  return {
    actorId: hero.heroId,
    templateId: hero.heroId,
    name: hero.name ?? hero.heroId,
    level,
    types: resolveHeroTypeNames(bundle, hero.heroId),
    attributes: attrs,
    currentHp: maxHp,
    maxHp
  };
}

function emptyActorSnapshot(actorId: string): V2DpsActorSnapshot {
  return {
    actorId,
    types: [],
    attributes: {},
    currentHp: 0,
    maxHp: 0
  };
}

function resolveHeroStatsAtLevel(hero: Hero, level: number): Record<string, number> {
  const baseStats = toNumberMap(hero.baseStats as Record<string, unknown> | undefined);
  const statsByLevel = hero.statsByLevel;
  if (!statsByLevel || typeof statsByLevel !== 'object') {
    return baseStats;
  }
  const levelEntry = statsByLevel[String(level)];
  if (levelEntry && typeof levelEntry === 'object' && !Array.isArray(levelEntry)) {
    return addNumberMap(baseStats, levelEntry as Record<string, unknown>);
  }
  const result: Record<string, number> = { ...baseStats };
  let hasArrayLevels = false;
  for (const [attrKey, values] of Object.entries(statsByLevel)) {
    if (Array.isArray(values) && values.length > 0) {
      const index = clamp(level, 1, values.length) - 1;
      result[attrKey] = (result[attrKey] ?? 0) + toNumber(values[index], 0);
      hasArrayLevels = true;
    }
  }
  return hasArrayLevels ? result : baseStats;
}

function applyNumberMap(target: Record<string, number>, source: Record<string, number>) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = value;
  }
}

function addNumberMap(base: Record<string, number>, source: Record<string, unknown>): Record<string, number> {
  const result: Record<string, number> = { ...base };
  for (const [key, value] of Object.entries(source)) {
    result[key] = (result[key] ?? 0) + toNumber(value, 0);
  }
  return result;
}

function toNumberMap(source: Record<string, unknown> | undefined): Record<string, number> {
  if (!source) {
    return {};
  }
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, toNumber(value, 0)]));
}

function readFirstNumber(record: Record<string, number>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
