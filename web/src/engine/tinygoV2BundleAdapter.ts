import type { AttributeDefinition, GameDataBundle, Hero, Item, JsonValue } from '../types/api';

export type TinyGoV2AttributeDefinition = {
  id: string;
  defaultBase?: number;
  defaultCurrent?: number;
  defaultMax?: number;
  hasDefaultCurrent?: boolean;
  hasDefaultMax?: boolean;
};

export type TinyGoV2AttributeValue = {
  base: number;
  current: number;
  max: number;
  resolved: number;
  hasCurrent: boolean;
  hasMax: boolean;
};

export type TinyGoV2ActorTemplate = {
  id: string;
  maxHp: number;
  initialHp: number;
  attributes: Record<string, TinyGoV2AttributeValue>;
  resources?: Record<string, { current: number; max: number }>;
  actions: string[];
};

export type TinyGoV2EngineBundle = {
  schemaVersion: number;
  attributes: TinyGoV2AttributeDefinition[];
  actors: TinyGoV2ActorTemplate[];
  actions: Array<{ id: string; label?: string }>;
  formulas: Array<{ id: string; op: string; value?: number; attr?: string }>;
  settings: {
    maxEvents: number;
    maxCommandsPerEvent: number;
  };
};

export type TinyGoV2RunInput = {
  seed: number;
  self: {
    actorId: string;
    templateId: string;
  };
  enemy: {
    actorId: string;
    templateId: string;
  };
  initialActions: [];
  stopCondition: {
    maxEvents: number;
  };
  trace: {
    enableLogs: boolean;
    sampleEvery: number;
  };
};

export type WasmValidationSelection = {
  selfHeroId: string;
  enemyHeroId: string;
  selfLevel: number;
  enemyLevel: number;
  selfItemIds: string[];
  enemyItemIds: string[];
  hpAttrKey: string;
};

export type ActorInputSummary = {
  actorId: 'self' | 'enemy';
  templateId: string;
  heroId: string;
  heroName: string;
  level: number;
  itemIds: string[];
  itemNames: string[];
  maxHp: number;
  attrCount: number;
};

export type TinyGoV2ValidationInput = {
  engineBundle: TinyGoV2EngineBundle;
  runInput: TinyGoV2RunInput;
  summaries: ActorInputSummary[];
};

const SELF_TEMPLATE_ID = 'self_template';
const ENEMY_TEMPLATE_ID = 'enemy_template';

export function createDefaultWasmValidationSelection(bundle: GameDataBundle): WasmValidationSelection {
  const firstHero = bundle.heroes[0];
  const secondHero = bundle.heroes[1] ?? firstHero;
  const maxLevel = detectMaxLevel(bundle);

  return {
    selfHeroId: firstHero?.heroId ?? '',
    enemyHeroId: secondHero?.heroId ?? firstHero?.heroId ?? '',
    selfLevel: maxLevel,
    enemyLevel: 1,
    selfItemIds: [],
    enemyItemIds: [],
    hpAttrKey: detectHpAttrKey(bundle.attributeDefinitions)
  };
}

export function compileTinyGoV2ValidationInput(
  bundle: GameDataBundle,
  selection: WasmValidationSelection
): TinyGoV2ValidationInput {
  const attrDefinitions = normalizeAttributeDefinitions(bundle.attributeDefinitions);
  const self = buildActorTemplate(bundle, attrDefinitions, selection, 'self');
  const enemy = buildActorTemplate(bundle, attrDefinitions, selection, 'enemy');

  return {
    engineBundle: {
      schemaVersion: 1,
      attributes: attrDefinitions,
      actors: [self.template, enemy.template],
      actions: [],
      formulas: [],
      settings: {
        maxEvents: 1,
        maxCommandsPerEvent: 64
      }
    },
    runInput: {
      seed: 7,
      self: {
        actorId: 'self',
        templateId: SELF_TEMPLATE_ID
      },
      enemy: {
        actorId: 'enemy',
        templateId: ENEMY_TEMPLATE_ID
      },
      initialActions: [],
      stopCondition: {
        maxEvents: 1
      },
      trace: {
        enableLogs: false,
        sampleEvery: 0
      }
    },
    summaries: [self.summary, enemy.summary]
  };
}

export function detectMaxLevel(bundle: GameDataBundle): number {
  const levels = bundle.heroes
    .map((hero) => {
      const statsByLevel = hero.statsByLevel;
      if (!statsByLevel || typeof statsByLevel !== 'object') {
        return 0;
      }
      const numericKeys = Object.keys(statsByLevel)
        .map((key) => Number(key))
        .filter((value) => Number.isFinite(value) && value > 0);
      if (numericKeys.length > 0) {
        return Math.max(...numericKeys);
      }
      const arrayLengths = Object.values(statsByLevel)
        .filter(Array.isArray)
        .map((value) => value.length);
      return arrayLengths.length > 0 ? Math.max(...arrayLengths) : 0;
    })
    .filter((value) => value > 0);
  return levels.length > 0 ? Math.max(...levels) : 18;
}

function normalizeAttributeDefinitions(definitions: AttributeDefinition[]): TinyGoV2AttributeDefinition[] {
  const normalized = definitions
    .filter((definition) => definition.attrKey)
    .map((definition) => {
      const defaultValue = toNumber(definition.defaultValue, 0);
      return {
        id: definition.attrKey,
        defaultBase: defaultValue,
        defaultCurrent: defaultValue,
        defaultMax: defaultValue,
        hasDefaultCurrent: true,
        hasDefaultMax: true
      };
    });

  return dedupeById(normalized);
}

function buildActorTemplate(
  bundle: GameDataBundle,
  attrDefinitions: TinyGoV2AttributeDefinition[],
  selection: WasmValidationSelection,
  side: 'self' | 'enemy'
) {
  const heroId = side === 'self' ? selection.selfHeroId : selection.enemyHeroId;
  const level = side === 'self' ? selection.selfLevel : selection.enemyLevel;
  const itemIds = side === 'self' ? selection.selfItemIds : selection.enemyItemIds;
  const templateId = side === 'self' ? SELF_TEMPLATE_ID : ENEMY_TEMPLATE_ID;
  const hero = bundle.heroes.find((candidate) => candidate.heroId === heroId);
  if (!hero) {
    throw new Error(`Hero not found in bundle: ${heroId || '(empty)'}`);
  }

  const attrs = resolveActorAttributes(bundle, attrDefinitions, hero, itemIds, level);
  const maxHp = Math.max(toNumber(attrs[selection.hpAttrKey], 0), 1);
  const items = itemIds
    .map((itemId) => bundle.items.find((item) => item.itemId === itemId))
    .filter((item): item is Item => Boolean(item));

  return {
    template: {
      id: templateId,
      maxHp,
      initialHp: maxHp,
      attributes: toTinyGoAttributeValues(attrs),
      actions: []
    },
    summary: {
      actorId: side,
      templateId,
      heroId: hero.heroId,
      heroName: hero.name ?? hero.heroId,
      level,
      itemIds,
      itemNames: items.map((item) => item.name ?? item.itemId),
      maxHp,
      attrCount: Object.keys(attrs).length
    } satisfies ActorInputSummary
  };
}

function resolveActorAttributes(
  bundle: GameDataBundle,
  attrDefinitions: TinyGoV2AttributeDefinition[],
  hero: Hero,
  itemIds: string[],
  level: number
): Record<string, number> {
  const attrs = Object.fromEntries(attrDefinitions.map((definition) => [definition.id, toNumber(definition.defaultBase, 0)]));
  mergeNumberMap(attrs, resolveHeroStatsAtLevel(hero, level));

  for (const itemId of itemIds) {
    const item = bundle.items.find((candidate) => candidate.itemId === itemId);
    if (item?.statsModifier && typeof item.statsModifier === 'object') {
      mergeNumberMap(attrs, item.statsModifier);
    }
  }

  return attrs;
}

function resolveHeroStatsAtLevel(hero: Hero, level: number): Record<string, unknown> {
  const statsByLevel = hero.statsByLevel;
  if (!statsByLevel || typeof statsByLevel !== 'object') {
    return hero.baseStats ?? {};
  }

  const levelEntry = statsByLevel[String(level)];
  if (levelEntry && typeof levelEntry === 'object' && !Array.isArray(levelEntry)) {
    return levelEntry as Record<string, unknown>;
  }

  const result: Record<string, number> = {};
  for (const [attrKey, values] of Object.entries(statsByLevel)) {
    if (Array.isArray(values) && values.length > 0) {
      const index = clamp(level, 1, values.length) - 1;
      result[attrKey] = toNumber((values as JsonValue[])[index], 0);
    }
  }
  return Object.keys(result).length > 0 ? result : hero.baseStats ?? {};
}

function mergeNumberMap(target: Record<string, number>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + toNumber(value, 0);
  }
}

function toTinyGoAttributeValues(attrs: Record<string, number>): Record<string, TinyGoV2AttributeValue> {
  return Object.fromEntries(
    Object.entries(attrs).map(([attrKey, value]) => [
      attrKey,
      {
        base: value,
        current: value,
        max: value,
        resolved: value,
        hasCurrent: true,
        hasMax: true
      }
    ])
  );
}

function detectHpAttrKey(definitions: AttributeDefinition[]): string {
  const attrKeys = definitions.map((definition) => definition.attrKey).filter(Boolean);
  const exact = attrKeys.find((attrKey) => ['hp', 'health', 'max_hp', 'max_health'].includes(attrKey));
  if (exact) {
    return exact;
  }
  return attrKeys.find((attrKey) => /(^|_)(hp|health)($|_)/i.test(attrKey)) ?? attrKeys[0] ?? 'hp';
}

function dedupeById(definitions: TinyGoV2AttributeDefinition[]): TinyGoV2AttributeDefinition[] {
  const seen = new Set<string>();
  return definitions.filter((definition) => {
    if (seen.has(definition.id)) {
      return false;
    }
    seen.add(definition.id);
    return true;
  });
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
