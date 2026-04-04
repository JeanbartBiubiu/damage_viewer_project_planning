import type { AttributeDefinition, GameDataBundle, Hero, Item, Skill } from '../types/api';
import type {
  DamageType,
  EngineDamageComponent,
  EngineDamageEvent,
  EngineRunInput,
  EngineRunOutput,
  EngineSamplePoint
} from './types';

type RuntimeConfig = {
  hpAttrKey: string;
};

type CombatantOverrideInput = NonNullable<EngineRunInput['overrides']>['self'];

type CombatantState = {
  hero: Hero;
  stats: Record<string, number>;
  baseHeroStats: Record<string, number>;
  itemIds: string[];
  hp: number;
};

type Catalog = {
  attributeDefinitions: AttributeDefinition[];
  heroesById: Map<string, Hero>;
  itemsById: Map<string, Item>;
  skillsById: Map<string, Skill>;
};

const BORK_ITEM_ID = 'item_blade_of_the_ruined_king';
const NASHOR_ITEM_ID = 'item_nashors_tooth';
const BORK_CURRENT_HP_RATIO = 0.12;
const NASHOR_ON_HIT_BASE = 15;
const NASHOR_AP_RATIO = 0.15;

export function runSimulation(bundle: GameDataBundle, input: EngineRunInput, config: RuntimeConfig): EngineRunOutput {
  const catalog = buildCatalog(bundle);
  validateInput(catalog, input);

  const self = resolveCombatant(catalog, input.initial.self, input.overrides?.self, config.hpAttrKey);
  const enemy = resolveCombatant(catalog, input.initial.enemy, input.overrides?.enemy, config.hpAttrKey);
  const maxDurationMs = Math.max(1, Math.round(input.stop.maxSeconds * 1000));

  let tMs = 0;
  let executedHits = 0;
  let cumulativeDamageToEnemy = 0;
  let cumulativeDamageToSelf = 0;
  let stopReason: EngineRunOutput['result']['stopReason'] = 'completed';
  let timeToKillEnemy: number | undefined;
  const samples: EngineSamplePoint[] = [];
  const events: EngineDamageEvent[] = [];
  let eventSequence = 0;

  const pushSample = () => {
    samples.push({
      tMs,
      selfHp: roundNumber(self.hp),
      enemyHp: roundNumber(enemy.hp),
      cumulativeDamageToEnemy: roundNumber(cumulativeDamageToEnemy),
      cumulativeDamageToSelf: roundNumber(cumulativeDamageToSelf)
    });
  };

  const dealDamageToEnemy = (
    label: string,
    pendingComponents: Array<Omit<EngineDamageComponent, 'dealtDamage'>>
  ) => {
    const enemyHpBefore = enemy.hp;
    const components = pendingComponents.map<EngineDamageComponent>((component) => ({
      ...component,
      rawDamage: roundNumber(component.rawDamage),
      dealtDamage: applyMitigation(component.rawDamage, component.damageType, enemy.stats)
    }));
    const totalRawDamage = roundNumber(components.reduce((sum, component) => sum + component.rawDamage, 0));
    const totalDealtDamage = roundNumber(components.reduce((sum, component) => sum + component.dealtDamage, 0));
    enemy.hp = Math.max(0, enemy.hp - totalDealtDamage);
    cumulativeDamageToEnemy += totalDealtDamage;
    executedHits += 1;
    eventSequence += 1;
    events.push({
      sequence: eventSequence,
      tMs,
      label,
      enemyHpBefore: roundNumber(enemyHpBefore),
      enemyHpAfter: roundNumber(enemy.hp),
      totalRawDamage,
      totalDealtDamage,
      components
    });
    pushSample();
    if (enemy.hp <= 0 && timeToKillEnemy === undefined) {
      timeToKillEnemy = tMs;
      stopReason = 'enemyDead';
    }
  };

  if (input.plan.type === 'basic_attack') {
    const attackSpeed = Math.max(self.stats.attack_speed || 0, 0.1);
    const intervalMs = 1000 / attackSpeed;
    const skill = input.plan.skillId ? catalog.skillsById.get(input.plan.skillId) : undefined;
    const attackRatio = toNumber(skill?.params?.attackRatio, 1);
    const damageType: DamageType =
      skill?.params?.damageType === 'magic' ? 'magic' : skill?.params?.damageType === 'true' ? 'true' : 'physical';

    for (let hitIndex = 0; hitIndex < input.plan.count; hitIndex += 1) {
      tMs = Math.round((hitIndex + 1) * intervalMs);
      if (tMs > maxDurationMs) {
        stopReason = 'maxSeconds';
        break;
      }
      const enemyCurrentHp = enemy.hp;
      const components: Array<Omit<EngineDamageComponent, 'dealtDamage'>> = [
        {
          sourceKind: 'basic_attack',
          sourceId: skill?.skillId ?? 'basic_attack',
          label: skill?.name ?? '平A',
          damageType,
          rawDamage: (self.stats.ad || 0) * attackRatio,
          isCritical: false
        }
      ];

      if (self.itemIds.includes(BORK_ITEM_ID)) {
        components.push({
          sourceKind: 'item',
          sourceId: BORK_ITEM_ID,
          label: '破败王者之刃被动（当前生命值）',
          damageType: 'physical',
          rawDamage: enemyCurrentHp * BORK_CURRENT_HP_RATIO,
          isCritical: false
        });
      }

      if (self.itemIds.includes(NASHOR_ITEM_ID)) {
        components.push({
          sourceKind: 'item',
          sourceId: NASHOR_ITEM_ID,
          label: '纳什之牙被动',
          damageType: 'magic',
          rawDamage: NASHOR_ON_HIT_BASE + (self.stats.ap || 0) * NASHOR_AP_RATIO,
          isCritical: false
        });
      }

      dealDamageToEnemy(`平A ${hitIndex + 1}`, components);
      if (enemy.hp <= 0) {
        break;
      }
    }
  } else {
    const skill = catalog.skillsById.get(input.plan.skillId);
    if (!skill) {
      throw semanticError(`Skill not found: ${input.plan.skillId}`);
    }
    const skillLevel = clampSkillLevel(input.plan.skillLevel ?? toInteger(skill.params?.defaultSkillLevel, 1));
    const hitCount = Math.max(1, toInteger(skill.params?.hitCount, 1) * Math.max(1, input.plan.castCount ?? 1));
    const hitIntervalMs = Math.max(1, toInteger(skill.params?.hitIntervalMs, 100));
    const baseDamageBySkillLevel = Array.isArray(skill.params?.baseDamageBySkillLevel)
      ? skill.params.baseDamageBySkillLevel.map((value) => toNumber(value, 0))
      : [toNumber(skill.params?.baseDamage, 0)];
    const baseDamage = baseDamageBySkillLevel[Math.min(skillLevel - 1, baseDamageBySkillLevel.length - 1)] ?? 0;
    const adRatio = toNumber(skill.params?.adRatio, 0);
    const apRatio = toNumber(skill.params?.apRatio, 0);
    const bonusAttackSpeedRatio = toNumber(skill.params?.bonusAttackSpeedRatio, 0);
    const damageType: DamageType =
      skill.params?.damageType === 'physical' ? 'physical' : skill.params?.damageType === 'true' ? 'true' : 'magic';
    const bonusAttackSpeed = Math.max((self.stats.attack_speed || 0) - (self.baseHeroStats.attack_speed || 0), 0);

    for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
      tMs = hitIndex === 0 ? 0 : hitIndex * hitIntervalMs;
      if (tMs > maxDurationMs) {
        stopReason = 'maxSeconds';
        break;
      }
      const rawDamage =
        baseDamage
        + (self.stats.ad || 0) * adRatio * (1 + bonusAttackSpeed * bonusAttackSpeedRatio)
        + (self.stats.ap || 0) * apRatio;
      dealDamageToEnemy(skill.name ?? skill.skillId, [
        {
          sourceKind: 'skill',
          sourceId: skill.skillId,
          label: skill.name ?? skill.skillId,
          damageType,
          rawDamage,
          isCritical: false
        }
      ]);
      if (enemy.hp <= 0) {
        break;
      }
    }

    if (stopReason === 'completed') {
      tMs = Math.max(tMs, toInteger(skill.params?.channelDurationMs, hitIntervalMs * hitCount));
      if (tMs > maxDurationMs) {
        tMs = maxDurationMs;
        stopReason = 'maxSeconds';
      }
    }
  }

  const actionLabel = buildActionLabel(catalog.skillsById, input);
  return {
    samples,
    events,
    result: {
      stopReason,
      timeToKillEnemyMs: timeToKillEnemy,
      totalDamageToEnemy: roundNumber(cumulativeDamageToEnemy),
      totalDamageToSelf: roundNumber(cumulativeDamageToSelf),
      executedHits,
      actionDurationMs: tMs,
      actionLabel,
      lastSample: samples.length > 0 ? samples[samples.length - 1] : undefined
    }
  };
}

function buildCatalog(bundle: GameDataBundle): Catalog {
  return {
    attributeDefinitions: bundle.attributeDefinitions,
    heroesById: new Map(bundle.heroes.map((hero) => [hero.heroId, hero])),
    itemsById: new Map(bundle.items.map((item) => [item.itemId, item])),
    skillsById: new Map(bundle.skills.map((skill) => [skill.skillId, skill]))
  };
}

function validateInput(catalog: Catalog, input: EngineRunInput) {
  if (input.stop.maxSeconds <= 0) {
    throw invalidInput('stop.maxSeconds must be greater than 0');
  }
  validateCombatantRef(catalog, input.initial.self.heroId, input.initial.self.itemIds);
  validateCombatantRef(catalog, input.initial.enemy.heroId, input.initial.enemy.itemIds);
  validateOverride(catalog, input.overrides?.self);
  validateOverride(catalog, input.overrides?.enemy);
  if (input.plan.type === 'basic_attack') {
    if (input.plan.count <= 0) {
      throw invalidInput('basic_attack.count must be greater than 0');
    }
    if (input.plan.skillId && !catalog.skillsById.has(input.plan.skillId)) {
      throw semanticError(`Skill not found: ${input.plan.skillId}`);
    }
  } else if (!catalog.skillsById.has(input.plan.skillId)) {
    throw semanticError(`Skill not found: ${input.plan.skillId}`);
  }
}

function validateCombatantRef(catalog: Catalog, heroId: string, itemIds?: string[]) {
  if (!catalog.heroesById.has(heroId)) {
    throw semanticError(`Hero not found: ${heroId}`);
  }
  for (const itemId of itemIds ?? []) {
    if (!catalog.itemsById.has(itemId)) {
      throw semanticError(`Item not found: ${itemId}`);
    }
  }
}

function validateOverride(catalog: Catalog, override?: CombatantOverrideInput) {
  if (!override?.baseStats) {
    return;
  }
  const attrKeys = new Set(catalog.attributeDefinitions.map((attribute) => attribute.attrKey));
  for (const attrKey of Object.keys(override.baseStats)) {
    if (!attrKeys.has(attrKey)) {
      throw semanticError(`Unknown attribute override: ${attrKey}`);
    }
  }
}

function resolveCombatant(
  catalog: Catalog,
  init: EngineRunInput['initial']['self'],
  override: CombatantOverrideInput | undefined,
  hpAttrKey: string
): CombatantState {
  const hero = catalog.heroesById.get(init.heroId);
  if (!hero) {
    throw semanticError(`Hero not found: ${init.heroId}`);
  }
  const defaultStats = buildDefaultStats(catalog.attributeDefinitions);
  const baseHeroStats = {
    ...defaultStats,
    ...normalizeStatMap(hero.baseStats)
  };
  const itemIds = [...(init.itemIds ?? [])];
  const removeItemIds = new Set(override?.removeItemIds ?? []);
  const extraItemIds = override?.addItemIds ?? [];
  const effectiveItemIds = itemIds.filter((itemId) => !removeItemIds.has(itemId)).concat(extraItemIds);
  const itemStats = effectiveItemIds.reduce<Record<string, number>>((stats, itemId) => {
    const item = catalog.itemsById.get(itemId);
    if (!item) {
      throw semanticError(`Item not found: ${itemId}`);
    }
    mergeStats(stats, normalizeStatMap(item.statsModifier));
    return stats;
  }, {});
  const overrideStats = normalizeStatMap(override?.baseStats);
  const stats = {
    ...baseHeroStats,
    ...itemStats
  };
  mergeStats(stats, overrideStats);
  return {
    hero,
    stats,
    baseHeroStats,
    itemIds: effectiveItemIds,
    hp: stats[hpAttrKey] ?? 0
  };
}

function buildDefaultStats(attributeDefinitions: AttributeDefinition[]): Record<string, number> {
  return attributeDefinitions.reduce<Record<string, number>>((accumulator, attribute) => {
    accumulator[attribute.attrKey] = toNumber(attribute.defaultValue, 0);
    return accumulator;
  }, {});
}

function normalizeStatMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const stats: Record<string, number> = {};
  for (const [key, statValue] of Object.entries(value)) {
    stats[key] = toNumber(statValue, 0);
  }
  return stats;
}

function mergeStats(target: Record<string, number>, source: Record<string, number>) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function applyMitigation(rawDamage: number, damageType: DamageType, stats: Record<string, number>) {
  if (damageType === 'true') {
    return roundNumber(rawDamage);
  }
  const resistance = damageType === 'physical' ? stats.armor ?? 0 : stats.magic_resist ?? 0;
  if (resistance >= 0) {
    return roundNumber(rawDamage * (100 / (100 + resistance)));
  }
  return roundNumber(rawDamage * (2 - 100 / (100 - resistance)));
}

function buildActionLabel(skillsById: Map<string, Skill>, input: EngineRunInput) {
  if (input.plan.type === 'basic_attack') {
    return `平A x${input.plan.count}`;
  }
  const skillName = skillsById.get(input.plan.skillId)?.name ?? input.plan.skillId;
  return `${skillName}${input.plan.castCount && input.plan.castCount > 1 ? ` x${input.plan.castCount}` : ''}`;
}

function clampSkillLevel(skillLevel: number) {
  return Math.max(1, Math.min(5, Math.round(skillLevel)));
}

function roundNumber(value: number) {
  return Math.round(value * 1000) / 1000;
}

function toNumber(value: unknown, fallback: number) {
  return typeof value === 'number' ? value : Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function toInteger(value: unknown, fallback: number) {
  return Math.round(toNumber(value, fallback));
}

function invalidInput(message: string): Error {
  const error = new Error(message);
  error.name = 'INVALID_INPUT';
  return error;
}

function semanticError(message: string): Error {
  const error = new Error(message);
  error.name = 'SEMANTIC_ERROR';
  return error;
}
