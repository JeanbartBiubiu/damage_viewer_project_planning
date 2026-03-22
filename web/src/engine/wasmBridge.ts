import type { AttributeDefinition, GameDataBundle, Hero, Item, Skill } from '../types/api';
import type { EngineRunInput, EngineRunOutput, EngineSamplePoint } from './types';

type RuntimeConfig = {
  hpAttrKey: string;
};

type WasmExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  sample_stride: () => number;
  result_stride: () => number;
  samples_ptr: () => number;
  result_ptr: () => number;
  run_basic_attack: (
    selfHp: number,
    selfAd: number,
    selfAttackSpeed: number,
    enemyHp: number,
    enemyArmor: number,
    attackRatio: number,
    hitCount: number,
    maxDurationMs: number
  ) => number;
  run_death_lotus: (
    selfHp: number,
    selfBaseAttackSpeed: number,
    selfAttackSpeed: number,
    selfAd: number,
    selfAp: number,
    enemyHp: number,
    enemyMagicResist: number,
    baseDamage: number,
    adRatio: number,
    apRatio: number,
    bonusAttackSpeedRatio: number,
    hitCount: number,
    hitIntervalMs: number,
    channelDurationMs: number,
    maxDurationMs: number
  ) => number;
};

type Catalog = {
  attributeDefinitions: AttributeDefinition[];
  heroesById: Map<string, Hero>;
  itemsById: Map<string, Item>;
  skillsById: Map<string, Skill>;
};

type CombatantOverrideInput = NonNullable<EngineRunInput['overrides']>['self'];

type CombatantState = {
  hero: Hero;
  stats: Record<string, number>;
  baseHeroStats: Record<string, number>;
  itemIds: string[];
  hp: number;
};

type ResultSnapshot = {
  stopReason: EngineRunOutput['result']['stopReason'];
  timeToKillEnemyMs?: number;
  totalDamageToEnemy: number;
  totalDamageToSelf: number;
  executedHits: number;
  actionDurationMs: number;
  sampleCount: number;
};

const WASM_URL = new URL('./wasm/katarina_mvp_engine.wasm', import.meta.url);
const STOP_REASON_BY_CODE: Record<number, EngineRunOutput['result']['stopReason']> = {
  0: 'completed',
  1: 'enemyDead',
  2: 'selfDead',
  3: 'maxSeconds',
  4: 'cancelled',
  5: 'error'
};

export class KatarinaWasmBridge {
  private readonly exports: WasmExports;

  private readonly sampleStride: number;

  private readonly resultStride: number;

  private readonly catalog: Catalog;

  private readonly hpAttrKey: string;

  private constructor(bundle: GameDataBundle, exports: WasmExports, config: RuntimeConfig) {
    this.catalog = buildCatalog(bundle);
    this.exports = exports;
    this.sampleStride = exports.sample_stride();
    this.resultStride = exports.result_stride();
    this.hpAttrKey = config.hpAttrKey;
  }

  static async create(bundle: GameDataBundle, config: RuntimeConfig): Promise<KatarinaWasmBridge> {
    const exports = await loadWasmExports();
    return new KatarinaWasmBridge(bundle, exports, config);
  }

  run(input: EngineRunInput): EngineRunOutput {
    validateInput(this.catalog, input);

    const self = resolveCombatant(this.catalog, input.initial.self, input.overrides?.self, this.hpAttrKey);
    const enemy = resolveCombatant(this.catalog, input.initial.enemy, input.overrides?.enemy, this.hpAttrKey);
    const maxDurationMs = Math.max(1, Math.round(input.stop.maxSeconds * 1000));

    let output: ResultSnapshot;
    if (input.plan.type === 'basic_attack') {
      const skill = input.plan.skillId ? this.catalog.skillsById.get(input.plan.skillId) : undefined;
      const attackRatio = toNumber(skill?.params?.attackRatio, 1);
      const sampleCount = this.exports.run_basic_attack(
        self.hp,
        self.stats.ad ?? 0,
        self.stats.attack_speed ?? 0,
        enemy.hp,
        enemy.stats.armor ?? 0,
        attackRatio,
        input.plan.count,
        maxDurationMs
      );
      output = this.readResult(sampleCount);
    } else {
      const skill = this.catalog.skillsById.get(input.plan.skillId);
      if (!skill) {
        throw semanticError(`Skill not found: ${input.plan.skillId}`);
      }
      const skillLevel = clampSkillLevel(input.plan.skillLevel ?? toInteger(skill.params?.defaultSkillLevel, 1));
      const baseDamageBySkillLevel = Array.isArray(skill.params?.baseDamageBySkillLevel)
        ? skill.params.baseDamageBySkillLevel.map((value) => toNumber(value, 0))
        : [toNumber(skill.params?.baseDamage, 0)];
      const baseDamage = baseDamageBySkillLevel[Math.min(skillLevel - 1, baseDamageBySkillLevel.length - 1)] ?? 0;
      const sampleCount = this.exports.run_death_lotus(
        self.hp,
        self.baseHeroStats.attack_speed ?? 0,
        self.stats.attack_speed ?? 0,
        self.stats.ad ?? 0,
        self.stats.ap ?? 0,
        enemy.hp,
        enemy.stats.magic_resist ?? 0,
        baseDamage,
        toNumber(skill.params?.adRatio, 0),
        toNumber(skill.params?.apRatio, 0),
        toNumber(skill.params?.bonusAttackSpeedRatio, 0),
        Math.max(1, toInteger(skill.params?.hitCount, 1) * Math.max(1, input.plan.castCount ?? 1)),
        Math.max(1, toInteger(skill.params?.hitIntervalMs, 100)),
        Math.max(1, toInteger(skill.params?.channelDurationMs, 100)),
        maxDurationMs
      );
      output = this.readResult(sampleCount);
    }

    const samples = this.readSamples(output.sampleCount);
    const lastSample = samples.length > 0 ? samples[samples.length - 1] : undefined;
    return {
      samples,
      result: {
        stopReason: output.stopReason,
        timeToKillEnemyMs: output.timeToKillEnemyMs,
        totalDamageToEnemy: output.totalDamageToEnemy,
        totalDamageToSelf: output.totalDamageToSelf,
        executedHits: output.executedHits,
        actionDurationMs: output.actionDurationMs,
        actionLabel: buildActionLabel(this.catalog.skillsById, input),
        lastSample
      }
    };
  }

  private readResult(sampleCount: number): ResultSnapshot {
    const resultData = new Float64Array(
      this.exports.memory.buffer,
      this.exports.result_ptr(),
      this.resultStride
    );
    const stopReasonCode = Math.round(resultData[0] ?? 5);
    return {
      stopReason: STOP_REASON_BY_CODE[stopReasonCode] ?? 'error',
      timeToKillEnemyMs: resultData[1] >= 0 ? Math.round(resultData[1]) : undefined,
      totalDamageToEnemy: resultData[2] ?? 0,
      totalDamageToSelf: resultData[3] ?? 0,
      executedHits: Math.round(resultData[4] ?? 0),
      actionDurationMs: Math.round(resultData[5] ?? 0),
      sampleCount: Math.min(Math.max(0, Math.round(resultData[6] ?? sampleCount)), sampleCount)
    };
  }

  private readSamples(sampleCount: number): EngineSamplePoint[] {
    if (sampleCount <= 0) {
      return [];
    }
    const raw = new Float64Array(
      this.exports.memory.buffer,
      this.exports.samples_ptr(),
      sampleCount * this.sampleStride
    );
    const samples: EngineSamplePoint[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const offset = index * this.sampleStride;
      samples.push({
        tMs: Math.round(raw[offset] ?? 0),
        selfHp: raw[offset + 1] ?? 0,
        enemyHp: raw[offset + 2] ?? 0,
        cumulativeDamageToEnemy: raw[offset + 3] ?? 0,
        cumulativeDamageToSelf: raw[offset + 4] ?? 0
      });
    }
    return samples;
  }
}

async function loadWasmExports(): Promise<WasmExports> {
  const response = await fetch(WASM_URL);
  if (!response.ok) {
    throw new Error(`Failed to load Wasm module: ${response.status} ${response.statusText}`);
  }

  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try {
      const { instance } = await WebAssembly.instantiateStreaming(response.clone(), {});
      return instance.exports as WasmExports;
    } catch {
      // Fall back to instantiate(ArrayBuffer) for local dev servers with an unexpected MIME type.
    }
  }

  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports as WasmExports;
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
    return;
  }

  if (!catalog.skillsById.has(input.plan.skillId)) {
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
  const stats = { ...baseHeroStats };
  const itemIds = [...(init.itemIds ?? [])];
  const removeItemIds = new Set(override?.removeItemIds ?? []);
  const extraItemIds = override?.addItemIds ?? [];
  const effectiveItemIds = itemIds.filter((itemId) => !removeItemIds.has(itemId)).concat(extraItemIds);

  for (const itemId of effectiveItemIds) {
    const item = catalog.itemsById.get(itemId);
    if (!item) {
      throw semanticError(`Item not found: ${itemId}`);
    }
    mergeStats(stats, normalizeStatMap(item.statsModifier));
  }

  mergeStats(stats, normalizeStatMap(override?.baseStats));

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
