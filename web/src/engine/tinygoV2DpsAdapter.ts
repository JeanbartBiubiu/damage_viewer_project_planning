import type { GameDataBundle, Hero, Item, JsonObject, Skill, TypeDefinition, TypeRelation } from '../types/api';
import type { TinyGoV2AttributeDefinition, TinyGoV2EngineBundle } from './tinygoV2BundleAdapter';

export const V2_DPS_CASE_ID = 'V2-BatchE-1-single-hero-multicurve-001';
export const V2_DPS_TARGET_DUMMY_TYPE_NAME = 'target_dummy';
const V2_DPS_BASIC_ATTACK_ACTION_ID = 'basic_attack';
const V2_DPS_ADC_COMPLETED_ITEM_TYPE_ID = 62002;
const V2_DPS_ADC_COMPLETED_ITEM_TYPE_NAME = 'adc_completed_item';
const V2_DPS_DEFAULT_HERO_LEVEL = 11;
const V2_DPS_PASSIVE_LEVEL_EFFECT_FIELDS = ['everyN'] as const;
const V2_DPS_PASSIVE_OPERATION_LEVEL_FIELDS = [
  'amount',
  'amountPerStack',
  'targetCurrentHpRatio',
  'targetMaxHpRatio',
  'targetMissingHpRatio',
  'targetMissingHpAmp',
  'attackerAttrRatio',
  'minAmount',
  'value'
] as const;

export type V2DpsCurveSelection = {
  curveId: string;
  label: string;
  heroLevel: number;
  skillLevels: Record<string, number>;
  equipmentItemIds: string[];
  enabledPassiveEffectIds: string[];
  enabledScenarioStateIds: string[];
  runeStatAdjustments: Record<string, number>;
};

export type V2DpsSelection = {
  attackerHeroId: string;
  targetActorId: string;
  durationMs: number;
  attackSpeedCap: 3.0;
  critPolicy: 'expected';
  curves: V2DpsCurveSelection[];
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

export type V2DpsEquipmentOption = {
  itemId: string;
  label: string;
  statsLabel: string;
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

export type V2DpsScenarioState = {
  stateId?: string;
  sourceType?: string;
  sourceId?: string;
  activation?: string;
  stacks?: number;
  startTimeMs?: number;
  durationMs?: number;
};

export type V2DpsPassiveOperation = {
  kind: string;
  source?: string;
  damageType?: string;
  amount?: number;
  amountPerStack?: number;
  targetCurrentHpRatio?: number;
  targetCurrentHpBasis?: string;
  targetMaxHpRatio?: number;
  targetMissingHpRatio?: number;
  targetMissingHpBasis?: string;
  targetMissingHpAmp?: number;
  attackerAttr?: string;
  attackerAttrRatio?: number;
  minAmount?: number;
  hasMinAmount?: boolean;
  stackKey?: string;
  maxStacks?: number;
  triggerStacks?: number;
  resetStacks?: boolean;
  durationMs?: number;
  tickIntervalMs?: number;
  refreshMode?: string;
  attrKey?: string;
  modifierMode?: string;
  value?: number;
  perStack?: boolean;
};

export type V2DpsPassiveEffect = {
  passiveId?: string;
  effectId?: string;
  sourceCategory?: string;
  sourceId?: string;
  sourceType?: string;
  triggerId?: string;
  triggerKind?: string;
  everyN?: number;
  requiresScenarioStateId?: string;
  operations?: V2DpsPassiveOperation[];
};

export type V2DpsPassiveOption = {
  id: string;
  label: string;
  heroKey: string;
  requiredSkillIds: string[];
  defaultEnabled?: boolean;
};

export type V2DpsScenarioOption = {
  id: string;
  label: string;
  heroKey: string;
  requiredSkillIds: string[];
  defaultEnabled?: boolean;
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
    scenarioStates: V2DpsScenarioState[];
    critPolicy: 'expected';
  };
  resolvedSnapshot: {
    attackerSnapshot: V2DpsActorSnapshot;
    targetSnapshot: V2DpsActorSnapshot;
    equipmentSet: string[];
    equipmentStats: Record<string, number>;
    enabledPassiveEffects: string[];
    passiveEffects: V2DpsPassiveEffect[];
    externalPassiveEffects: string[];
    scenarioStates: V2DpsScenarioState[];
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
  effectTimeline: Array<{ timeMs: number; sourceId?: string; kind?: string }>;
  totalDamage: number;
  timeWindowDps: number;
  killDps: number | null;
  killTimeMs: number | null;
  damageByType: Record<string, number>;
  damageBySource: Record<string, number>;
  skillPassiveTriggers: unknown[];
  itemPassiveTriggers: unknown[];
  externalPassiveTriggers: unknown[];
  effectBreakdown: Array<{ timeMs?: number; source?: string; kind?: string; amount?: number; message?: string }>;
  critPolicy: 'expected';
  seed: number;
  blockedReasons: string[];
  selection: V2DpsCurveRunSpec['selection'];
  resolvedSnapshot: V2DpsCurveRunSpec['resolvedSnapshot'];
};

const V2_DPS_BATCH_B_PASSIVE_OPTIONS: V2DpsPassiveOption[] = [
  { heroKey: 'vayne', id: 'skill_vayne_w_silver_bolts_dps_v2', label: '薇恩 W 圣银弩箭', requiredSkillIds: ['skill_vayne_w_silver_bolts_dps_v2'] },
  { heroKey: 'teemo', id: 'skill_teemo_e_toxic_shot_dps_v2', label: '提莫 E 毒性射击', requiredSkillIds: ['skill_teemo_e_toxic_shot_dps_v2'] },
  { heroKey: 'teemo', id: 'skill_teemo_p_guerrilla_warfare_attack_speed_dps_v2', label: '提莫 P 离隐攻速预设', requiredSkillIds: ['skill_teemo_p_guerrilla_warfare_attack_speed_dps_v2'], defaultEnabled: false },
  { heroKey: 'varus', id: 'skill_varus_w_blighted_quiver_dps_v2', label: '韦鲁斯 W 枯萎箭袋', requiredSkillIds: ['skill_varus_w_blighted_quiver_dps_v2'] },
  { heroKey: 'varus', id: 'skill_varus_p_revenge_minion_kill_attack_speed_dps_v2', label: '韦鲁斯 P 击杀小兵攻速预设', requiredSkillIds: ['skill_varus_p_revenge_minion_kill_attack_speed_dps_v2'], defaultEnabled: false },
  { heroKey: 'varus', id: 'skill_varus_p_revenge_champion_takedown_attack_speed_dps_v2', label: '韦鲁斯 P 参与击杀英雄攻速预设', requiredSkillIds: ['skill_varus_p_revenge_champion_takedown_attack_speed_dps_v2'], defaultEnabled: false },
  { heroKey: 'kaisa', id: 'skill_kaisa_p_plasma_dps_v2', label: '卡莎 P 电浆', requiredSkillIds: ['skill_kaisa_p_plasma_dps_v2'] },
  { heroKey: 'twitch', id: 'skill_twitch_p_deadly_venom_dps_v2', label: '图奇 P 死亡毒液', requiredSkillIds: ['skill_twitch_p_deadly_venom_dps_v2'] },
  { heroKey: 'twitch', id: 'skill_twitch_q_ambush_attack_speed_dps_v2', label: '图奇 Q 离隐攻速预设', requiredSkillIds: ['skill_twitch_q_ambush_attack_speed_dps_v2'], defaultEnabled: false },
  { heroKey: 'kogmaw', id: 'skill_kogmaw_q_caustic_spittle_passive_dps_v2', label: '克格莫 Q 被动攻速', requiredSkillIds: ['skill_kogmaw_q_caustic_spittle_passive_dps_v2'] },
  { heroKey: 'kogmaw', id: 'skill_kogmaw_w_bio_arcane_barrage_dps_v2', label: '克格莫 W 生化弹幕预开启', requiredSkillIds: ['skill_kogmaw_w_bio_arcane_barrage_dps_v2'] }
];

const V2_DPS_BATCH_B_SCENARIO_OPTIONS: V2DpsScenarioOption[] = [
  {
    heroKey: 'teemo',
    id: 'teemo_p_after_stealth_attack_speed',
    label: '提莫 P 离隐后攻速',
    requiredSkillIds: ['skill_teemo_p_guerrilla_warfare_attack_speed_dps_v2'],
    defaultEnabled: false
  },
  {
    heroKey: 'varus',
    id: 'varus_p_minion_kill_attack_speed',
    label: '韦鲁斯 P 击杀小兵攻速',
    requiredSkillIds: ['skill_varus_p_revenge_minion_kill_attack_speed_dps_v2'],
    defaultEnabled: false
  },
  {
    heroKey: 'varus',
    id: 'varus_p_champion_takedown_attack_speed',
    label: '韦鲁斯 P 参与击杀英雄攻速',
    requiredSkillIds: ['skill_varus_p_revenge_champion_takedown_attack_speed_dps_v2'],
    defaultEnabled: false
  },
  {
    heroKey: 'twitch',
    id: 'twitch_q_after_camouflage_attack_speed',
    label: '图奇 Q 离隐后攻速',
    requiredSkillIds: ['skill_twitch_q_ambush_attack_speed_dps_v2'],
    defaultEnabled: false
  },
  {
    heroKey: 'kogmaw',
    id: 'kogmaw_w_pre_enabled',
    label: '克格莫 W 预开启',
    requiredSkillIds: ['skill_kogmaw_w_bio_arcane_barrage_dps_v2']
  }
];

export function createDefaultV2DpsSelection(bundle: GameDataBundle): V2DpsSelection {
  const targetGroups = listV2DpsTargetGroups(bundle);
  const targetDummyGroup = targetGroups.find((group) => group.isTargetDummy);
  const targetActorId =
    targetDummyGroup?.actors.find((actor) => actor.actorId === 'target_dummy_fighter')?.actorId
    ?? targetDummyGroup?.actors[0]?.actorId
    ?? targetGroups[0]?.actors[0]?.actorId
    ?? '';
  const attackerHeroId = findDefaultAttacker(bundle);
  return {
    attackerHeroId,
    targetActorId,
    durationMs: 10000,
    attackSpeedCap: 3.0,
    critPolicy: 'expected',
    curves: createDefaultV2DpsCurveSelections(attackerHeroId, bundle)
  };
}

export function createDefaultV2DpsCurveSelections(attackerHeroId: string, bundle?: GameDataBundle): V2DpsCurveSelection[] {
  const passiveIds = defaultPassiveIdsForHero(attackerHeroId);
  const scenarioIds = defaultScenarioIdsForHero(attackerHeroId);
  const heroKey = normalizeHeroKey(attackerHeroId) || 'hero';
  const noItems: string[] = [];
  const bladeKraken = ['3153', '6672'];
  const bladeKrakenGuinsoo = ['3153', '6672', '3124'];
  return [
    createV2DpsCurveSelection(`${heroKey}-no-items`, formatDefaultCurveLabel(bundle, noItems), noItems, attackerHeroId, passiveIds, scenarioIds),
    createV2DpsCurveSelection(`${heroKey}-3153`, formatDefaultCurveLabel(bundle, ['3153']), ['3153'], attackerHeroId, passiveIds, scenarioIds),
    createV2DpsCurveSelection(`${heroKey}-3153-6672`, formatDefaultCurveLabel(bundle, bladeKraken), bladeKraken, attackerHeroId, passiveIds, scenarioIds),
    createV2DpsCurveSelection(`${heroKey}-3153-6672-3124`, formatDefaultCurveLabel(bundle, bladeKrakenGuinsoo), bladeKrakenGuinsoo, attackerHeroId, passiveIds, scenarioIds)
  ];
}

export function createV2DpsCurveSelection(
  curveId: string,
  label: string,
  equipmentItemIds: string[],
  attackerHeroId: string,
  enabledPassiveEffectIds = defaultPassiveIdsForHero(attackerHeroId),
  enabledScenarioStateIds = defaultScenarioIdsForHero(attackerHeroId)
): V2DpsCurveSelection {
  return {
    curveId,
    label,
    heroLevel: V2_DPS_DEFAULT_HERO_LEVEL,
    skillLevels: createDefaultSkillLevels(),
    equipmentItemIds,
    enabledPassiveEffectIds,
    enabledScenarioStateIds,
    runeStatAdjustments: {}
  };
}

export function getDefaultV2DpsPassiveIdsForHero(heroId: string): string[] {
  return defaultPassiveIdsForHero(heroId);
}

export function getDefaultV2DpsScenarioIdsForHero(heroId: string): string[] {
  return defaultScenarioIdsForHero(heroId);
}

export function listV2DpsPassiveOptionsForHero(heroId: string): V2DpsPassiveOption[] {
  const heroKey = normalizeHeroKey(heroId);
  return V2_DPS_BATCH_B_PASSIVE_OPTIONS.filter((option) => option.heroKey === heroKey);
}

export function listV2DpsScenarioOptionsForHero(heroId: string): V2DpsScenarioOption[] {
  const heroKey = normalizeHeroKey(heroId);
  return V2_DPS_BATCH_B_SCENARIO_OPTIONS.filter((option) => option.heroKey === heroKey);
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

export function listV2DpsEquipmentOptions(bundle: GameDataBundle): V2DpsEquipmentOption[] {
  const itemById = new Map(bundle.items.map((item) => [item.itemId, item]));
  return Array.from(adcCompletedEquipmentIds(bundle))
    .map((itemId) => itemById.get(itemId))
    .filter((item): item is Item => Boolean(item))
    .map((item) => ({
      itemId: item.itemId,
      label: `${item.itemId} / ${item.name ?? item.itemId}`,
      statsLabel: formatEquipmentStats(item)
    }))
    .sort((left, right) => Number(left.itemId) - Number(right.itemId));
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
  const targetSnapshot = targetHero
    ? buildActorSnapshot(bundle, attrDefinitions, targetHero, 1)
    : emptyActorSnapshot(selection.targetActorId);
  const targetTypeNames = targetHero ? resolveHeroTypeNames(bundle, targetHero.heroId) : [];
  const targetType = targetTypeNames.includes(V2_DPS_TARGET_DUMMY_TYPE_NAME) ? V2_DPS_TARGET_DUMMY_TYPE_NAME : targetTypeNames[0] ?? '';
  const simulationRules: V2DpsRunInput['simulationRules'] = {
    durationMs: selection.durationMs,
    warmupMs: 0,
    sampleBy: 'none',
    attackSpeedCap: selection.attackSpeedCap,
    firstAttackAtMs: 0,
    eventWindowPolicy: 'timeMs < durationMs',
    dotTickIntervalMs: 1000,
    critPolicy: selection.critPolicy,
    seed: 0,
    autoAttackPlan: {
      enabled: true,
      actionId: V2_DPS_BASIC_ATTACK_ACTION_ID,
      startAtMs: 0,
      targetRole: 'target'
    },
    maxEvents: 10000
  };
  const curves = selection.curves.map((curveSelection, index) => buildV2DpsCurveRunSpec({
    bundle,
    attrDefinitions,
    attackerHero,
    attackerHeroId: selection.attackerHeroId,
    targetActorId: selection.targetActorId,
    targetSnapshot,
    targetType,
    curveSelection,
    index
  }));

  return {
    engineBundle: createV2DpsInitBundle(),
    runInput: {
      mode: 'single_attacker_dps',
      caseId: V2_DPS_CASE_ID,
      versionCode,
      wasmSha256,
      simulationRules,
      targetSnapshot,
      curves
    }
  };
}

type BuildCurveSpecArgs = {
  bundle: GameDataBundle;
  attrDefinitions: TinyGoV2AttributeDefinition[];
  attackerHero: Hero | undefined;
  attackerHeroId: string;
  targetActorId: string;
  targetSnapshot: V2DpsActorSnapshot;
  targetType: string;
  curveSelection: V2DpsCurveSelection;
  index: number;
};

function buildV2DpsCurveRunSpec({
  bundle,
  attrDefinitions,
  attackerHero,
  attackerHeroId,
  targetActorId,
  targetSnapshot,
  targetType,
  curveSelection,
  index
}: BuildCurveSpecArgs): V2DpsCurveRunSpec {
  const heroLevel = clamp(curveSelection.heroLevel, 1, 18);
  const skillLevels = normalizeSkillLevels(curveSelection.skillLevels);
  const attackerSnapshot = attackerHero
    ? applyRuneStatAdjustments(
      buildActorSnapshot(bundle, attrDefinitions, attackerHero, heroLevel),
      curveSelection.runeStatAdjustments
    )
    : emptyActorSnapshot(attackerHeroId);
  const selectedScenarioIds = normalizeStringList(curveSelection.enabledScenarioStateIds);
  const selectedEquipmentItemIds = normalizeStringList(curveSelection.equipmentItemIds);
  const equipment = resolveEquipmentSelection(bundle, selectedEquipmentItemIds);
  const selectedPassiveIds = normalizeStringList([
    ...curveSelection.enabledPassiveEffectIds,
    ...passiveIdsRequiredByScenarioIds(attackerHeroId, selectedScenarioIds)
  ]);
  const selectedEnabledPassiveIds = normalizeStringList([...selectedPassiveIds, ...equipment.passiveIds]);
  const resolvedHeroPassiveEffects = resolveDpsPassiveEffects(bundle, attackerHeroId, selectedPassiveIds, skillLevels);
  const resolvedItemPassiveEffects = resolveDpsItemPassiveEffects(bundle, equipment.itemIds, equipment.passiveIds);
  const resolvedPassiveEffects = [...resolvedHeroPassiveEffects, ...resolvedItemPassiveEffects];
  const resolvedScenarioStates = resolveDpsScenarioStates(bundle, attackerHeroId, selectedScenarioIds);
  const curveId = curveSelection.curveId.trim() || `${attackerHeroId || 'missing_attacker'}-curve-${index + 1}`;
  const label = curveSelection.label.trim() || `Curve ${index + 1}`;

  return {
    curveId,
    label,
    selection: {
      heroId: attackerHeroId,
      heroLevel,
      targetId: targetActorId,
      targetType,
      skillLevels,
      equipmentSet: selectedEquipmentItemIds,
      enabledPassiveEffects: selectedEnabledPassiveIds,
      scenarioStates: selectedScenarioIds.map((stateId) => ({ stateId, activation: 'selected_in_page' })),
      critPolicy: 'expected'
    },
    resolvedSnapshot: {
      attackerSnapshot,
      targetSnapshot,
      equipmentSet: equipment.itemIds,
      equipmentStats: equipment.stats,
      enabledPassiveEffects: selectedEnabledPassiveIds,
      passiveEffects: resolvedPassiveEffects,
      externalPassiveEffects: [],
      scenarioStates: resolvedScenarioStates,
      runeStatAdjustments: normalizeNumberMap(curveSelection.runeStatAdjustments)
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
  return attackers.find((actor) => actor.actorId === 'hero_vayne')?.actorId
    ?? attackers.find((actor) => actor.actorId === 'Vayne')?.actorId
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

function adcCompletedEquipmentIds(bundle: GameDataBundle): Set<string> {
  const typeById = new Map(bundle.types.map((type) => [type.typeId, type]));
  const ids = new Set<string>();
  for (const relation of bundle.typeRelations) {
    if (relation.targetCategory !== 'equipment') {
      continue;
    }
    const type = typeById.get(relation.typeId);
    const role = relation.extend && typeof relation.extend.role === 'string' ? relation.extend.role : '';
    if (
      relation.typeId === V2_DPS_ADC_COMPLETED_ITEM_TYPE_ID
      || role === V2_DPS_ADC_COMPLETED_ITEM_TYPE_NAME
      || normalizeTypeName(type) === V2_DPS_ADC_COMPLETED_ITEM_TYPE_NAME
    ) {
      ids.add(relation.targetId);
    }
  }
  return ids;
}

function resolveEquipmentStats(bundle: GameDataBundle, itemIds: string[]): Record<string, number> {
  const allowedIds = adcCompletedEquipmentIds(bundle);
  const itemById = new Map(bundle.items.map((item) => [item.itemId, item]));
  const stats: Record<string, number> = {};
  for (const itemId of itemIds) {
    if (!allowedIds.has(itemId)) {
      continue;
    }
    const item = itemById.get(itemId);
    if (!item || !Array.isArray(item.statModifiers)) {
      continue;
    }
    for (const modifier of item.statModifiers) {
      const attrKey = modifier.attrKey?.trim();
      const value = toNumber(modifier.value, 0);
      if (!attrKey || !Number.isFinite(value) || value === 0) {
        continue;
      }
      stats[attrKey] = (stats[attrKey] ?? 0) + value;
    }
  }
  return stats;
}

function resolveEquipmentSelection(bundle: GameDataBundle, itemIds: string[]): { itemIds: string[]; stats: Record<string, number>; passiveIds: string[] } {
  const allowedIds = adcCompletedEquipmentIds(bundle);
  const itemById = new Map(bundle.items.map((item) => [item.itemId, item]));
  const resolvedItemIds = itemIds.filter((itemId) => allowedIds.has(itemId) && itemById.has(itemId));
  return {
    itemIds: resolvedItemIds,
    stats: resolveEquipmentStats(bundle, resolvedItemIds),
    passiveIds: itemPassiveIdsForEquipment(bundle, resolvedItemIds)
  };
}

function formatDefaultCurveLabel(bundle: GameDataBundle | undefined, itemIds: string[]): string {
  if (itemIds.length === 0) {
    return '无装备';
  }
  const itemById = new Map((bundle?.items ?? []).map((item) => [item.itemId, item]));
  return itemIds
    .map((itemId) => itemById.get(itemId)?.name?.trim() || itemId)
    .join(' + ');
}

function formatEquipmentStats(item: Item): string {
  if (!Array.isArray(item.statModifiers) || item.statModifiers.length === 0) {
    return 'no stats';
  }
  return item.statModifiers
    .map((modifier) => `${modifier.attrKey}+${formatCompactNumber(modifier.value)}`)
    .join(' / ');
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

function applyRuneStatAdjustments(snapshot: V2DpsActorSnapshot, adjustments: Record<string, number>): V2DpsActorSnapshot {
  const normalized = normalizeNumberMap(adjustments);
  if (Object.keys(normalized).length === 0) {
    return snapshot;
  }
  const attributes = { ...snapshot.attributes };
  for (const [attrKey, value] of Object.entries(normalized)) {
    attributes[attrKey] = (attributes[attrKey] ?? 0) + value;
  }
  const maxHp = Math.max(readFirstNumber(attributes, ['hp', 'health', 'max_hp', 'max_health']) ?? snapshot.maxHp, 0);
  return {
    ...snapshot,
    attributes,
    currentHp: snapshot.currentHp > 0 ? snapshot.currentHp : maxHp,
    maxHp
  };
}

function createDefaultSkillLevels(): Record<string, number> {
  return {
    P: 1,
    Q: 1,
    W: 1,
    E: 1,
    R: 1
  };
}

function defaultPassiveIdsForHero(heroId: string): string[] {
  return listV2DpsPassiveOptionsForHero(heroId)
    .filter((option) => option.defaultEnabled !== false)
    .map((option) => option.id);
}

function defaultScenarioIdsForHero(heroId: string): string[] {
  return listV2DpsScenarioOptionsForHero(heroId)
    .filter((option) => option.defaultEnabled !== false)
    .map((option) => option.id);
}

function passiveIdsRequiredByScenarioIds(heroId: string, scenarioIds: string[]): string[] {
  const wanted = new Set(scenarioIds);
  if (wanted.size === 0) {
    return [];
  }
  return listV2DpsScenarioOptionsForHero(heroId)
    .filter((option) => wanted.has(option.id))
    .flatMap((option) => option.requiredSkillIds);
}

function resolveDpsPassiveEffects(
  bundle: GameDataBundle,
  heroId: string,
  passiveIds: string[],
  skillLevels: Record<string, number>
): V2DpsPassiveEffect[] {
  const wanted = new Set(passiveIds);
  if (wanted.size === 0) {
    return [];
  }
  const heroSkillIds = new Set(listV2DpsPassiveOptionsForHero(heroId).flatMap((option) => option.requiredSkillIds));
  const effects: V2DpsPassiveEffect[] = [];
  const blockedIds = new Set<string>();
  for (const skill of bundle.skills) {
    if (!skillBelongsToHero(skill, heroId) && !heroSkillIds.has(skill.skillId)) {
      continue;
    }
    for (const effect of readDpsPassiveEffects(skill)) {
      const ids = [effect.passiveId, effect.effectId, effect.sourceId].filter((value): value is string => Boolean(value));
      if (ids.some((id) => wanted.has(id))) {
        const projected = resolveDpsPassiveEffectBySkillLevel(effect, skill, skillLevels);
        if (projected) {
          effects.push(projected);
        } else {
          for (const id of ids) {
            if (wanted.has(id)) {
              blockedIds.add(id);
            }
          }
        }
      }
    }
  }
  if (blockedIds.size === 0) {
    return effects;
  }
  return effects.filter((effect) => {
    const ids = [effect.passiveId, effect.effectId, effect.sourceId].filter((value): value is string => Boolean(value));
    return ids.every((id) => !blockedIds.has(id));
  });
}

function itemPassiveIdsForEquipment(bundle: GameDataBundle, itemIds: string[]): string[] {
  const selected = new Set(itemIds);
  if (selected.size === 0) {
    return [];
  }
  const ids: string[] = [];
  const itemById = new Map(bundle.items.map((item) => [item.itemId, item]));
  for (const itemId of selected) {
    const item = itemById.get(itemId);
    if (Array.isArray(item?.skillRefs)) {
      ids.push(...item.skillRefs.filter(Boolean));
    }
  }
  return normalizeStringList(ids);
}

function resolveDpsItemPassiveEffects(bundle: GameDataBundle, itemIds: string[], passiveIds: string[]): V2DpsPassiveEffect[] {
  const selected = new Set(itemIds);
  const wanted = new Set(passiveIds);
  if (selected.size === 0 || wanted.size === 0) {
    return [];
  }
  const skillRefsByItemId = new Map<string, Set<string>>();
  for (const item of bundle.items) {
    if (!selected.has(item.itemId)) {
      continue;
    }
    skillRefsByItemId.set(item.itemId, new Set((item.skillRefs ?? []).filter(Boolean)));
  }
  const effects: V2DpsPassiveEffect[] = [];
  for (const skill of bundle.skills) {
    if (skill.ownerType !== 'item' || !selected.has(skill.ownerId)) {
      continue;
    }
    const skillRefs = skillRefsByItemId.get(skill.ownerId);
    if (skillRefs && skillRefs.size > 0 && !skillRefs.has(skill.skillId)) {
      continue;
    }
    for (const effect of readDpsPassiveEffects(skill)) {
      const ids = [skill.skillId, effect.passiveId, effect.effectId, effect.sourceId].filter((value): value is string => Boolean(value));
      if (ids.some((id) => wanted.has(id))) {
        effects.push(effect);
      }
    }
  }
  return effects;
}

function resolveDpsScenarioStates(bundle: GameDataBundle, heroId: string, scenarioIds: string[]): V2DpsScenarioState[] {
  const wanted = new Set(scenarioIds);
  if (wanted.size === 0) {
    return [];
  }
  const heroSkillIds = new Set(listV2DpsScenarioOptionsForHero(heroId).flatMap((option) => option.requiredSkillIds));
  const states: V2DpsScenarioState[] = [];
  for (const skill of bundle.skills) {
    if (!skillBelongsToHero(skill, heroId) && !heroSkillIds.has(skill.skillId)) {
      continue;
    }
    for (const state of readDpsScenarioStates(skill)) {
      if (state.stateId && wanted.has(state.stateId)) {
        states.push(state);
      }
    }
  }
  return states;
}

function readDpsPassiveEffects(skill: Skill): V2DpsPassiveEffect[] {
  const mechanicsConfig = skill.mechanicsConfig as JsonObject | undefined;
  const raw = mechanicsConfig?.dpsPassiveEffects ?? mechanicsConfig?.dpsPassiveEffect;
  const values = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  return values.filter(isObjectRecord).map((value) => value as V2DpsPassiveEffect);
}

function resolveDpsPassiveEffectBySkillLevel(
  effect: V2DpsPassiveEffect,
  skill: Skill,
  skillLevels: Record<string, number>
): V2DpsPassiveEffect | null {
  const skillLevel = skillLevelForDpsSkill(skill, skillLevels);
  const params = skill.params as JsonObject | undefined;
  const effectRecord = effect as Record<string, unknown>;
  const nextEffect: V2DpsPassiveEffect = { ...effect };
  const nextEffectRecord = nextEffect as Record<string, unknown>;

  for (const field of V2_DPS_PASSIVE_LEVEL_EFFECT_FIELDS) {
    const resolved = resolveDpsLevelNumber({
      skill,
      skillLevel,
      params,
      field,
      rawValue: effectRecord[field]
    });
    if (resolved.missingLevelTable) {
      return null;
    }
    if (resolved.value !== null) {
      nextEffectRecord[field] = resolved.value;
    }
  }

  if (Array.isArray(effect.operations)) {
    nextEffect.operations = effect.operations.map((operation) => {
      const operationRecord = operation as Record<string, unknown>;
      const nextOperation: V2DpsPassiveOperation = { ...operation };
      const nextOperationRecord = nextOperation as Record<string, unknown>;
      for (const field of V2_DPS_PASSIVE_OPERATION_LEVEL_FIELDS) {
        const resolved = resolveDpsLevelNumber({
          skill,
          skillLevel,
          params,
          field,
          operation,
          rawValue: operationRecord[field]
        });
        if (resolved.missingLevelTable) {
          return null;
        }
        if (resolved.value !== null) {
          nextOperationRecord[field] = resolved.value;
        }
      }
      return nextOperation;
    }).filter((operation): operation is V2DpsPassiveOperation => operation !== null);
    if (nextEffect.operations.length !== effect.operations.length) {
      return null;
    }
  }

  return nextEffect;
}

type LevelNumberResolution = {
  value: number | null;
  missingLevelTable: boolean;
};

type ResolveDpsLevelNumberArgs = {
  skill: Skill;
  skillLevel: number;
  params: JsonObject | undefined;
  field: string;
  operation?: V2DpsPassiveOperation;
  rawValue: unknown;
};

function resolveDpsLevelNumber({
  skill,
  skillLevel,
  params,
  field,
  operation,
  rawValue
}: ResolveDpsLevelNumberArgs): LevelNumberResolution {
  const explicitValue = resolveLevelTableNumber(rawValue, skillLevel);
  if (explicitValue !== null) {
    return { value: explicitValue, missingLevelTable: false };
  }

  const paramValue = resolveParamLevelNumber(params, candidateParamKeysForDpsField(field, operation), skillLevel);
  if (paramValue !== null) {
    return { value: paramValue, missingLevelTable: false };
  }

  const scalarValue = resolveScalarNumber(rawValue);
  const paramScalarValue = resolveParamScalarNumber(params, candidateParamKeysForDpsField(field, operation));
  const resolvedScalarValue = scalarValue ?? paramScalarValue;
  if (resolvedScalarValue !== null && requiresBundleLevelTable(skill, field, skillLevel)) {
    return { value: null, missingLevelTable: true };
  }
  return { value: resolvedScalarValue, missingLevelTable: false };
}

function resolveParamLevelNumber(params: JsonObject | undefined, keys: string[], skillLevel: number): number | null {
  if (!params || keys.length === 0) {
    return null;
  }
  const vars = isObjectRecord(params.vars) ? params.vars : undefined;
  for (const key of keys) {
    const direct = resolveLevelTableNumber(params[key], skillLevel);
    if (direct !== null) {
      return direct;
    }
    const fromVars = vars ? resolveLevelTableNumber(vars[key], skillLevel) : null;
    if (fromVars !== null) {
      return fromVars;
    }
  }
  return null;
}

function resolveParamScalarNumber(params: JsonObject | undefined, keys: string[]): number | null {
  if (!params || keys.length === 0) {
    return null;
  }
  const vars = isObjectRecord(params.vars) ? params.vars : undefined;
  for (const key of keys) {
    const direct = resolveScalarNumber(params[key]);
    if (direct !== null) {
      return direct;
    }
    const fromVars = vars ? resolveScalarNumber(vars[key]) : null;
    if (fromVars !== null) {
      return fromVars;
    }
  }
  return null;
}

function resolveLevelTableNumber(value: unknown, skillLevel: number): number | null {
  if (Array.isArray(value)) {
    return readLevelArrayNumber(value, skillLevel);
  }
  if (!isObjectRecord(value)) {
    return null;
  }

  const kind = typeof value.kind === 'string' ? value.kind : '';
  if (kind === 'table') {
    return readLevelArrayNumber(value.values, skillLevel);
  }

  for (const key of ['values', 'skillLevels', 'levels', 'levelValues', 'rankValues']) {
    const resolved = readLevelArrayNumber(value[key], skillLevel);
    if (resolved !== null) {
      return resolved;
    }
  }

  for (const key of ['bySkillLevel', 'valuesByLevel', 'valueByLevel']) {
    const resolved = readLevelMapNumber(value[key], skillLevel);
    if (resolved !== null) {
      return resolved;
    }
  }

  return readLevelMapNumber(value, skillLevel);
}

function resolveScalarNumber(value: unknown): number | null {
  if (isObjectRecord(value) && value.kind === 'const') {
    return toFiniteNumber(value.value);
  }
  return toFiniteNumber(value);
}

function readLevelArrayNumber(value: unknown, skillLevel: number): number | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const index = clamp(skillLevel, 1, value.length) - 1;
  return toFiniteNumber(value[index]);
}

function readLevelMapNumber(value: unknown, skillLevel: number): number | null {
  if (!isObjectRecord(value)) {
    return null;
  }
  const exact = toFiniteNumber(value[String(skillLevel)]);
  if (exact !== null) {
    return exact;
  }
  const oneBasedEntries = Object.entries(value)
    .map(([key, entry]) => [Number(key), entry] as const)
    .filter(([key]) => Number.isInteger(key) && key >= 1)
    .sort((left, right) => left[0] - right[0]);
  if (oneBasedEntries.length === 0) {
    return null;
  }
  const boundedIndex = clamp(skillLevel, oneBasedEntries[0][0], oneBasedEntries[oneBasedEntries.length - 1][0]);
  return toFiniteNumber(oneBasedEntries.find(([key]) => key === boundedIndex)?.[1]);
}

function candidateParamKeysForDpsField(field: string, operation: V2DpsPassiveOperation | undefined): string[] {
  const source = operation?.source ?? '';
  if (field === 'targetMaxHpRatio') {
    return ['targetMaxHpRatio', 'maxHealthRatio', 'maxHealthDamage', 'targetMaxHealthRatio'];
  }
  if (field === 'minAmount') {
    return ['minAmount', 'minDamage', 'damageFloor'];
  }
  if (field === 'amount') {
    if (source.includes('dot')) {
      return ['amount', 'dotMagicDamagePerTick', 'tickDamage', 'dotDamagePerTick'];
    }
    return ['amount', 'onHitMagicDamage', 'onHitDamage', 'baseDamage'];
  }
  if (field === 'amountPerStack') {
    return ['amountPerStack', 'trueDamagePerStackPerTick', 'onHitDamagePerStack', 'damagePerStack'];
  }
  if (field === 'value' && operation?.kind === 'stat_modifier') {
    return ['value', 'attackSpeedPercent', 'attackSpeedRatio'];
  }
  if (field === 'durationMs' && source.includes('dot')) {
    return ['durationMs', 'dotDurationMs'];
  }
  return [field];
}

function skillLevelForDpsSkill(skill: Skill, skillLevels: Record<string, number>): number {
  const skillKey = normalizeSkillKey(skill.skillKey);
  if (!skillKey) {
    return 1;
  }
  const defaults = createDefaultSkillLevels();
  return clamp(toNumber(skillLevels[skillKey], defaults[skillKey] ?? 1), skillKey === 'P' ? 0 : 1, skillKey === 'P' ? 1 : 5);
}

function normalizeSkillKey(skillKey: string | undefined): string {
  const normalized = (skillKey ?? '').trim().toUpperCase();
  if (normalized === 'PASSIVE') {
    return 'P';
  }
  return ['P', 'Q', 'W', 'E', 'R'].includes(normalized) ? normalized : '';
}

function requiresBundleLevelTable(skill: Skill, field: string, skillLevel: number): boolean {
  if (field === 'everyN') {
    return false;
  }
  if (skillLevel <= 1) {
    return false;
  }
  const skillKey = normalizeSkillKey(skill.skillKey);
  return skillKey === 'Q' || skillKey === 'W' || skillKey === 'E' || skillKey === 'R';
}

function readDpsScenarioStates(skill: Skill): V2DpsScenarioState[] {
  const mechanicsConfig = skill.mechanicsConfig as JsonObject | undefined;
  const raw = mechanicsConfig?.dpsScenarioStates ?? mechanicsConfig?.scenarioStates;
  const values = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  return values.filter(isObjectRecord).map((value) => value as V2DpsScenarioState);
}

function skillBelongsToHero(skill: Skill, heroId: string): boolean {
  if (skill.ownerType !== 'hero') {
    return false;
  }
  if (skill.ownerId === heroId) {
    return true;
  }
  return normalizeHeroKey(skill.ownerId) === normalizeHeroKey(heroId);
}

function normalizeHeroKey(heroId: string): string {
  return heroId
    .toLowerCase()
    .replace(/^hero_/, '')
    .replace(/[^a-z0-9]/g, '');
}

function normalizeStringList(value: string[] | undefined): string[] {
  return Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean)));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function normalizeSkillLevels(source: Record<string, number> | undefined): Record<string, number> {
  const defaults = createDefaultSkillLevels();
  const sourceRecord = source ?? {};
  const result: Record<string, number> = {};
  for (const key of ['P', 'Q', 'W', 'E', 'R']) {
    result[key] = clamp(toNumber(sourceRecord[key], defaults[key] ?? 1), key === 'P' ? 0 : 1, key === 'P' ? 1 : 5);
  }
  return result;
}

function normalizeNumberMap(source: Record<string, number> | undefined): Record<string, number> {
  if (!source) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    const attrKey = key.trim();
    const numericValue = toNumber(value, Number.NaN);
    if (attrKey && Number.isFinite(numericValue) && numericValue !== 0) {
      result[attrKey] = numericValue;
    }
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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(4)).toString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
