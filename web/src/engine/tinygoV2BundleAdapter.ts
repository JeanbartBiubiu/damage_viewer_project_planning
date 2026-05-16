import {
  parseMechanicsConfig,
  parseSkillParams,
  parseSkillValueRows,
  type SkillParamVarRow,
  type SkillTriggerRow,
  type SkillValueDefinitionRow
} from '../components/skill-editor/skillModels';
import { parseFormulaParams, type FormulaParamVarRow } from '../components/formula-editor/formulaModels';
import type { BenchmarkFormulaExpr, FormulaActorRef } from './benchmarkTypes';
import { compileConstantSymbols, compileFormulaText, compileVarsToExprMap, type VarDefinition } from './formulaCompiler';
import type { AttributeDefinition, GameDataBundle, Hero, Item, JsonObject, JsonValue, Skill } from '../types/api';

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

export type TinyGoV2ResourceValue = {
  current: number;
  max: number;
};

export type TinyGoV2ActorTemplate = {
  id: string;
  maxHp: number;
  initialHp: number;
  attributes: Record<string, TinyGoV2AttributeValue>;
  resources?: Record<string, TinyGoV2ResourceValue>;
  actions: string[];
};

export type TinyGoV2ResourceDefinition = {
  id: string;
  defaultCurrent: number;
  defaultMax: number;
};

export type TinyGoV2ResourceCost = {
  resourceId: string;
  formulaId?: string;
  amount?: number;
};

export type TinyGoV2ActionPanelCost = {
  resourceId?: string;
  formulaId?: string;
  amount: number;
};

export type TinyGoV2ActionPanelEffect = {
  effectIndex: number;
  kind: string;
  label?: string;
  formulaId?: string;
  amount?: number;
  damageType?: string;
  statusId?: string;
  attrId?: string;
  markId?: string;
  sourceRole?: string;
  targetRole?: string;
};

export type TinyGoV2StatusTemplate = {
  id: string;
  kind: string;
  durationMs?: number;
  magnitude?: number;
  shieldKind?: string;
  tickIntervalMs?: number;
  tickCount?: number;
  tickEffectType?: 'deal_damage' | 'heal';
  tickFormulaId?: string;
  tickAmount?: number;
  tickDamageType?: string;
};

export type TinyGoV2EffectDefinition = {
  type: 'deal_damage' | 'heal' | 'grant_shield' | 'apply_status' | 'apply_mark' | 'consume_mark' | 'damage_from_recent' | 'interrupt' | 'increment_counter';
  formulaId?: string;
  amount?: number;
  damageType?: string;
  statusId?: string;
  markId?: string;
  historyWindowMs?: number;
  counterKey?: string;
  critPolicy?: string;
  critChance?: number;
  critMultiplier?: number;
  modeAugmentId?: string;
  modeMultiplier?: number;
  sourceRole?: string;
  targetRole?: string;
};

export type TinyGoV2ActionTemplate = {
  id: string;
  label?: string;
  skillLevel?: number;
  panelInputs?: Record<string, number>;
  cooldownMs?: number;
  cooldownFormulaId?: string;
  channelDurationMs?: number;
  effects?: TinyGoV2EffectDefinition[];
  requiresMark?: string;
  consumesMark?: boolean;
  resourceCost?: TinyGoV2ResourceCost[];
  panelCosts?: TinyGoV2ActionPanelCost[];
  panelEffects?: TinyGoV2ActionPanelEffect[];
};

export type TinyGoV2FormulaDefinition = {
  id: string;
  op: string;
  value?: number;
  attr?: string;
  attrRead?: string;
  actor?: string;
  resource?: string;
  resourceRead?: string;
  counter?: string;
  left?: string;
  right?: string;
};

export type TinyGoV2EngineBundle = {
  schemaVersion: number;
  attributes: TinyGoV2AttributeDefinition[];
  resources?: TinyGoV2ResourceDefinition[];
  actors: TinyGoV2ActorTemplate[];
  actions: TinyGoV2ActionTemplate[];
  statuses?: TinyGoV2StatusTemplate[];
  formulas: TinyGoV2FormulaDefinition[];
  settings: {
    maxEvents: number;
    maxCommandsPerEvent: number;
  };
};

export type TinyGoV2RunInput = {
  seed: number;
  modeAugments?: string[];
  self: {
    actorId: string;
    templateId: string;
    actionInputs?: Record<string, TinyGoV2ActionRunInput>;
  };
  enemy: {
    actorId: string;
    templateId: string;
    actionInputs?: Record<string, TinyGoV2ActionRunInput>;
  };
  initialActions: TinyGoV2ActionRequest[];
  stopCondition: {
    maxEvents: number;
  };
  trace: {
    enableLogs: boolean;
    sampleEvery: number;
    valueTrace?: boolean;
  };
};

export type TinyGoV2ActionRequest = {
  triggerAtMs: number;
  sourceActorId: 'self' | 'enemy';
  targetActorId: 'self' | 'enemy';
  actionId: string;
};

export type TinyGoV2ActionRunInput = {
  skillLevel?: number;
  panelInputs?: Record<string, number>;
};

export type WasmValidationSelection = {
  selfHeroId: string;
  enemyHeroId: string;
  selfLevel: number;
  enemyLevel: number;
  selfItemIds: string[];
  enemyItemIds: string[];
  selfSkillLevels: Record<string, number>;
  enemySkillLevels: Record<string, number>;
  selfAttributeBonuses?: Record<string, number>;
  enemyAttributeBonuses?: Record<string, number>;
  selfAttributeOverrides?: Record<string, number>;
  enemyAttributeOverrides?: Record<string, number>;
  selfResourceOverrides?: Record<string, TinyGoV2ResourceValue>;
  enemyResourceOverrides?: Record<string, TinyGoV2ResourceValue>;
  hpAttrKey: string;
};

export type WasmValidationSkillOption = {
  skillId: string;
  actionId: string;
  label: string;
  skillKey: string;
  sourceKind: 'hero' | 'item';
  sourceLabel: string;
  ownerType: string;
  ownerId: string;
  level: number;
  defaultLevel: number;
  maxLevel: number;
  editableLevel: boolean;
};

export type ActorInputSummary = {
  actorId: 'self' | 'enemy';
  templateId: string;
  heroId: string;
  heroName: string;
  level: number;
  itemIds: string[];
  itemNames: string[];
  attributeBonuses?: Record<string, number>;
  attributeOverrides?: Record<string, number>;
  maxHp: number;
  attrCount: number;
  actionCount: number;
};

export type TinyGoV2ValidationInput = {
  engineBundle: TinyGoV2EngineBundle;
  runInput: TinyGoV2RunInput;
  summaries: ActorInputSummary[];
};

type ValidationSide = 'self' | 'enemy';

type ResolvedActorState = {
  side: ValidationSide;
  actorId: 'self' | 'enemy';
  templateId: string;
  hero: Hero;
  level: number;
  itemIds: string[];
  items: Item[];
  attributeBonuses: Record<string, number>;
  attributeOverrides: Record<string, number>;
  attrs: Record<string, number>;
  resources: Record<string, TinyGoV2ResourceValue>;
  skills: ResolvedActionSkill[];
  maxHp: number;
};

type ResolvedActionSkill = WasmValidationSkillOption & {
  skill: Skill;
};

type CompiledSkillEnvironment = {
  paramsRoot: JsonObject;
  mechanicsRoot: JsonObject;
  symbols: Map<string, BenchmarkFormulaExpr>;
  skillLevel: number;
  championLevel: number;
  mechanicsRows: SkillTriggerRow[];
};

type FormulaRegistryCompiler = {
  definitions: TinyGoV2FormulaDefinition[];
  resolveGeneratedFormula: (selectedSkill: ResolvedActionSkill, slotLabel: string, expr: BenchmarkFormulaExpr) => string;
  resolveBinding: (
    selectedSkill: ResolvedActionSkill,
    env: CompiledSkillEnvironment,
    bindingKey: string,
    slotLabel: string
  ) => string;
  resolveInlineFormula: (
    selectedSkill: ResolvedActionSkill,
    env: CompiledSkillEnvironment,
    formulaText: string,
    formulaVars: string[] | undefined,
    slotLabel: string
  ) => string;
};

type StatusRegistryCompiler = {
  definitions: TinyGoV2StatusTemplate[];
  registerShieldStatus: (actionId: string, slotLabel: string, options: { durationMs?: number; shieldKind?: string }) => string;
  registerTickStatus: (
    actionId: string,
    slotLabel: string,
    options: {
      kind: 'dot' | 'hot';
      tickIntervalMs: number;
      tickCount: number;
      tickEffectType: 'deal_damage' | 'heal';
      tickFormulaId?: string;
      tickAmount?: number;
      tickDamageType?: string;
      sourceStatusId?: string;
    }
  ) => string;
  ensureStatus: (status: TinyGoV2StatusTemplate) => string;
};

const SELF_TEMPLATE_ID = 'self_template';
const ENEMY_TEMPLATE_ID = 'enemy_template';
const HERO_SKILL_ORDER = ['P', 'Q', 'W', 'E', 'R'];
const HERO_SKILL_ORDER_INDEX = new Map(HERO_SKILL_ORDER.map((key, index) => [key, index]));
const PASSIVE_SKILL_KEYS = new Set(['P', 'PASSIVE']);
const COOLDOWN_MS_MULTIPLIER = 1000;
const ABILITY_HASTE_ATTR_KEY = 'ability_haste';
const LOL_ABILITY_HASTE_COOLDOWN_FACTOR = 100;
const LOL_ABILITY_HASTE_COOLDOWN_SLOT = 'cooldown_ability_haste';

const RESOURCE_CANDIDATES = [
  { id: 'mana', currentKeys: ['mana', 'mana_current', 'current_mana'], maxKeys: ['max_mana', 'mana_max', 'mana'] },
  { id: 'energy', currentKeys: ['energy', 'energy_current', 'current_energy'], maxKeys: ['max_energy', 'energy_max', 'energy'] },
  { id: 'rage', currentKeys: ['rage', 'rage_current', 'current_rage'], maxKeys: ['max_rage', 'rage_max', 'rage'] },
  { id: 'fury', currentKeys: ['fury', 'fury_current', 'current_fury'], maxKeys: ['max_fury', 'fury_max', 'fury'] },
  { id: 'focus', currentKeys: ['focus', 'focus_current', 'current_focus'], maxKeys: ['max_focus', 'focus_max', 'focus'] }
] as const;

const LOL_VALIDATION_RUNE_ATTRIBUTE_BONUSES: Record<string, number> = {
  ap: 18,
  hp: 65
};

const FORMULA_ATTR_ALIASES: Record<string, string> = {
  ability_power: 'ap',
  abilityPower: 'ap',
  magic_power: 'ap',
  attack_damage: 'ad',
  attackDamage: 'ad',
  atk: 'ad',
  health: 'hp',
  max_health: 'hp'
};

export function createDefaultWasmValidationSelection(bundle: GameDataBundle): WasmValidationSelection {
  const firstHero = bundle.heroes[0];
  const secondHero = bundle.heroes[1] ?? firstHero;
  const maxLevel = detectMaxLevel(bundle);
  const runeBonuses = getDefaultValidationAttributeBonuses(bundle);

  return {
    selfHeroId: firstHero?.heroId ?? '',
    enemyHeroId: secondHero?.heroId ?? firstHero?.heroId ?? '',
    selfLevel: maxLevel,
    enemyLevel: 1,
    selfItemIds: [],
    enemyItemIds: [],
    selfSkillLevels: {},
    enemySkillLevels: {},
    selfAttributeBonuses: runeBonuses,
    enemyAttributeBonuses: runeBonuses,
    selfAttributeOverrides: {},
    enemyAttributeOverrides: {},
    selfResourceOverrides: {},
    enemyResourceOverrides: {},
    hpAttrKey: detectHpAttrKey(bundle.attributeDefinitions)
  };
}

export function getDefaultValidationAttributeBonuses(bundle: GameDataBundle): Record<string, number> {
  return bundle.meta.gameId === 'lol' ? { ...LOL_VALIDATION_RUNE_ATTRIBUTE_BONUSES } : {};
}

export function listWasmValidationSkills(
  bundle: GameDataBundle,
  selection: WasmValidationSelection,
  side: ValidationSide
): WasmValidationSkillOption[] {
  const heroId = side === 'self' ? selection.selfHeroId : selection.enemyHeroId;
  const championLevel = side === 'self' ? selection.selfLevel : selection.enemyLevel;
  const itemIds = side === 'self' ? selection.selfItemIds : selection.enemyItemIds;
  const selectedSkillLevels = side === 'self' ? selection.selfSkillLevels : selection.enemySkillLevels;
  const hero = bundle.heroes.find((candidate) => candidate.heroId === heroId);
  if (!hero) {
    return [];
  }
  const items = itemIds
    .map((itemId) => bundle.items.find((candidate) => candidate.itemId === itemId))
    .filter((item): item is Item => Boolean(item));
  return collectActorActionSkills(bundle, hero, items, championLevel, side, selectedSkillLevels).map(stripSkillRecord);
}

export function compileTinyGoV2ValidationInput(
  bundle: GameDataBundle,
  selection: WasmValidationSelection
): TinyGoV2ValidationInput {
  const attrDefinitions = normalizeAttributeDefinitions(bundle.attributeDefinitions);
  const selfBase = resolveActorState(bundle, attrDefinitions, selection, 'self');
  const enemyBase = resolveActorState(bundle, attrDefinitions, selection, 'enemy');
  const formulaCompiler = createFormulaRegistryCompiler(bundle);
  const statusCompiler = createStatusRegistryCompiler();
  const actionTemplates = [
    ...compileActorActionTemplates(bundle.meta.gameId, selfBase, enemyBase, formulaCompiler, statusCompiler),
    ...compileActorActionTemplates(bundle.meta.gameId, enemyBase, selfBase, formulaCompiler, statusCompiler)
  ];
  const resourceDefinitions = buildResourceDefinitions([selfBase, enemyBase]);

  return {
    engineBundle: {
      schemaVersion: 1,
      attributes: attrDefinitions,
      resources: resourceDefinitions.length > 0 ? resourceDefinitions : undefined,
      actors: [buildActorTemplate(selfBase), buildActorTemplate(enemyBase)],
      actions: actionTemplates,
      statuses: statusCompiler.definitions.length > 0 ? statusCompiler.definitions : undefined,
      formulas: formulaCompiler.definitions,
      settings: {
        maxEvents: 1,
        maxCommandsPerEvent: 64
      }
    },
    runInput: {
      seed: 7,
      self: {
        actorId: 'self',
        templateId: SELF_TEMPLATE_ID,
        actionInputs: buildActionRunInputs(selfBase)
      },
      enemy: {
        actorId: 'enemy',
        templateId: ENEMY_TEMPLATE_ID,
        actionInputs: buildActionRunInputs(enemyBase)
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
    summaries: [buildActorSummary(selfBase), buildActorSummary(enemyBase)]
  };
}

export function buildTinyGoV2SingleActionRunInput(
  input: TinyGoV2RunInput,
  action: TinyGoV2ActionRequest,
  options: { maxEvents?: number; enableLogs?: boolean; valueTrace?: boolean } = {}
): TinyGoV2RunInput {
  return {
    ...input,
    initialActions: [action],
    stopCondition: {
      maxEvents: options.maxEvents ?? Math.max(input.stopCondition.maxEvents, 8)
    },
    trace: {
      ...input.trace,
      enableLogs: options.enableLogs ?? true,
      valueTrace: options.valueTrace ?? true
    }
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

function resolveActorState(
  bundle: GameDataBundle,
  attrDefinitions: TinyGoV2AttributeDefinition[],
  selection: WasmValidationSelection,
  side: ValidationSide
): ResolvedActorState {
  const heroId = side === 'self' ? selection.selfHeroId : selection.enemyHeroId;
  const level = side === 'self' ? selection.selfLevel : selection.enemyLevel;
  const itemIds = side === 'self' ? selection.selfItemIds : selection.enemyItemIds;
  const skillLevels = side === 'self' ? selection.selfSkillLevels : selection.enemySkillLevels;
  const attributeBonuses = side === 'self' ? selection.selfAttributeBonuses ?? {} : selection.enemyAttributeBonuses ?? {};
  const attributeOverrides = side === 'self' ? selection.selfAttributeOverrides ?? {} : selection.enemyAttributeOverrides ?? {};
  const resourceOverrides = side === 'self' ? selection.selfResourceOverrides ?? {} : selection.enemyResourceOverrides ?? {};
  const hero = bundle.heroes.find((candidate) => candidate.heroId === heroId);
  if (!hero) {
    throw new Error(`Hero not found in bundle: ${heroId || '(empty)'}`);
  }

  const items = itemIds
    .map((itemId) => bundle.items.find((candidate) => candidate.itemId === itemId))
    .filter((item): item is Item => Boolean(item));
  const attrs = resolveActorAttributes(bundle, attrDefinitions, hero, itemIds, level, attributeBonuses, attributeOverrides);
  const resources = applyResourceOverrides(inferActorResources(attrs), resourceOverrides);
  const skills = collectActorActionSkills(bundle, hero, items, level, side, skillLevels);
  const maxHp = Math.max(toNumber(attrs[selection.hpAttrKey], 0), 1);

  return {
    side,
    actorId: side,
    templateId: side === 'self' ? SELF_TEMPLATE_ID : ENEMY_TEMPLATE_ID,
    hero,
    level,
    itemIds,
    items,
    attributeBonuses,
    attributeOverrides,
    attrs,
    resources,
    skills,
    maxHp
  };
}

function buildActorTemplate(actor: ResolvedActorState): TinyGoV2ActorTemplate {
  return {
    id: actor.templateId,
    maxHp: actor.maxHp,
    initialHp: actor.maxHp,
    attributes: toTinyGoAttributeValues(actor.attrs),
    resources: Object.keys(actor.resources).length > 0 ? actor.resources : undefined,
    actions: actor.skills.map((skill) => skill.actionId)
  };
}

function buildActionRunInputs(actor: ResolvedActorState): Record<string, TinyGoV2ActionRunInput> | undefined {
  const entries = actor.skills.map((skill) => [
    skill.actionId,
    {
      skillLevel: skill.level,
      panelInputs: buildPanelInputs(skill, actor)
    }
  ] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function buildActorSummary(actor: ResolvedActorState): ActorInputSummary {
  return {
    actorId: actor.actorId,
    templateId: actor.templateId,
    heroId: actor.hero.heroId,
    heroName: actor.hero.name ?? actor.hero.heroId,
    level: actor.level,
    itemIds: actor.itemIds,
    itemNames: actor.items.map((item) => item.name ?? item.itemId),
    attributeBonuses: Object.keys(actor.attributeBonuses).length > 0 ? { ...actor.attributeBonuses } : undefined,
    attributeOverrides: Object.keys(actor.attributeOverrides).length > 0 ? { ...actor.attributeOverrides } : undefined,
    maxHp: actor.maxHp,
    attrCount: Object.keys(actor.attrs).length,
    actionCount: actor.skills.length
  };
}

function resolveActorAttributes(
  bundle: GameDataBundle,
  attrDefinitions: TinyGoV2AttributeDefinition[],
  hero: Hero,
  itemIds: string[],
  level: number,
  attributeBonuses: Record<string, number> = {},
  attributeOverrides: Record<string, number> = {}
): Record<string, number> {
  const attrs = Object.fromEntries(attrDefinitions.map((definition) => [definition.id, toNumber(definition.defaultBase, 0)]));
  applyNumberMap(attrs, resolveHeroStatsAtLevel(hero, level));

  for (const itemId of itemIds) {
    const item = bundle.items.find((candidate) => candidate.itemId === itemId);
    if (!item || !Array.isArray(item.statModifiers)) {
      continue;
    }
    for (const modifier of item.statModifiers) {
      const attrKey = typeof modifier?.attrKey === 'string' ? modifier.attrKey.trim() : '';
      if (!attrKey) {
        continue;
      }
      attrs[attrKey] = (attrs[attrKey] ?? 0) + toNumber(modifier.value, 0);
    }
  }

  addNumberMapInPlace(attrs, attributeBonuses);
  applyNumberMap(attrs, attributeOverrides);

  return attrs;
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
      result[attrKey] = (result[attrKey] ?? 0) + toNumber((values as JsonValue[])[index], 0);
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

function addNumberMapInPlace(target: Record<string, number>, source: Record<string, number>) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + toNumber(value, 0);
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
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    result[key] = toNumber(value, 0);
  }
  return result;
}

function collectActorActionSkills(
  bundle: GameDataBundle,
  hero: Hero,
  items: Item[],
  championLevel: number,
  side: ValidationSide,
  selectedSkillLevels: Record<string, number>
): ResolvedActionSkill[] {
  const orderedSkills: Array<{ skill: Skill; sourceKind: 'hero' | 'item'; sourceLabel: string }> = [];
  const seenSkillIds = new Set<string>();

  for (const skill of bundle.skills) {
    if (skill.ownerType !== 'hero' || skill.ownerId !== hero.heroId || !isCastableSkill(skill)) {
      continue;
    }
    seenSkillIds.add(skill.skillId);
    orderedSkills.push({
      skill,
      sourceKind: 'hero',
      sourceLabel: hero.name ?? hero.heroId
    });
  }

  for (const item of items) {
    for (const skillId of item.skillRefs ?? []) {
      if (seenSkillIds.has(skillId)) {
        continue;
      }
      const skill = bundle.skills.find((candidate) => candidate.skillId === skillId);
      if (!skill || !isCastableSkill(skill)) {
        continue;
      }
      seenSkillIds.add(skillId);
      orderedSkills.push({
        skill,
        sourceKind: 'item',
        sourceLabel: item.name ?? item.itemId
      });
    }
  }

  return orderedSkills
    .map(({ skill, sourceKind, sourceLabel }) => {
      const maxLevel = detectSkillMaxLevel(skill);
      const defaultLevel = defaultSkillLevelForSkill(skill, championLevel, maxLevel);
      const selectedLevel = clampLevelInput(selectedSkillLevels[skill.skillId], maxLevel, defaultLevel);
      return {
        skill,
        skillId: skill.skillId,
        actionId: `${side}::${skill.skillId}`,
        label: buildSkillLabel(skill),
        skillKey: (skill.skillKey ?? '').trim().toUpperCase(),
        sourceKind,
        sourceLabel,
        ownerType: skill.ownerType,
        ownerId: skill.ownerId,
        level: selectedLevel,
        defaultLevel,
        maxLevel,
        editableLevel: sourceKind === 'hero' && maxLevel > 1
      } satisfies ResolvedActionSkill;
    })
    .sort(compareSkillOptions);
}

function stripSkillRecord(skill: ResolvedActionSkill): WasmValidationSkillOption {
  const { skill: _skill, ...option } = skill;
  return option;
}

function compareSkillOptions(left: WasmValidationSkillOption, right: WasmValidationSkillOption): number {
  if (left.sourceKind !== right.sourceKind) {
    return left.sourceKind === 'hero' ? -1 : 1;
  }
  const leftOrder = HERO_SKILL_ORDER_INDEX.get(left.skillKey) ?? HERO_SKILL_ORDER.length;
  const rightOrder = HERO_SKILL_ORDER_INDEX.get(right.skillKey) ?? HERO_SKILL_ORDER.length;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return left.label.localeCompare(right.label, 'zh-CN');
}

function buildSkillLabel(skill: Skill): string {
  const name = skill.name?.trim();
  const skillKey = skill.skillKey?.trim();
  if (skillKey && name) {
    return `${skillKey} ${name}`;
  }
  return name || skill.skillId;
}

function isCastableSkill(skill: Skill): boolean {
  const skillKey = (skill.skillKey ?? '').trim().toUpperCase();
  if (PASSIVE_SKILL_KEYS.has(skillKey)) {
    return false;
  }
  if ((skill.cooldowns?.length ?? 0) > 0 || (skill.resourceCosts?.length ?? 0) > 0) {
    return true;
  }
  try {
    const mechanics = parseMechanicsConfig(JSON.stringify(skill.mechanicsConfig ?? { version: 1, triggers: [] }));
    return mechanics.rows.some((row) => row.eventType === 'on_spell_cast');
  } catch {
    return Boolean(skillKey);
  }
}

function detectSkillMaxLevel(skill: Skill): number {
  if (skill.ownerType === 'item') {
    return 1;
  }

  let maxLevel = inferMaxLevelFromSkillKey(skill.skillKey);

  for (const row of safeParseValueRows(skill.cooldowns, 'cooldowns')) {
    if (row.kind === 'table') {
      maxLevel = Math.max(maxLevel, row.values.length);
    }
  }
  for (const row of safeParseValueRows(skill.resourceCosts, 'resourceCosts')) {
    if (row.kind === 'table') {
      maxLevel = Math.max(maxLevel, row.values.length);
    }
  }

  try {
    const params = parseSkillParams(JSON.stringify(skill.params ?? {}));
    for (const row of params.rows) {
      if (row.kind === 'table') {
        maxLevel = Math.max(maxLevel, row.values.length);
      }
      if (row.kind === 'mapping_scaled_attr' && isPlainObject(row.raw.values)) {
        maxLevel = Math.max(maxLevel, 1);
      }
    }
    const legacyBaseDamage = params.root.baseDamageBySkillLevel;
    if (Array.isArray(legacyBaseDamage)) {
      maxLevel = Math.max(maxLevel, legacyBaseDamage.length);
    }
  } catch {
    return maxLevel;
  }

  return Math.max(1, maxLevel);
}

function inferMaxLevelFromSkillKey(skillKey: string | undefined): number {
  const normalized = (skillKey ?? '').trim().toUpperCase();
  if (normalized === 'R') {
    return 3;
  }
  if (normalized === 'Q' || normalized === 'W' || normalized === 'E') {
    return 5;
  }
  return 1;
}

function defaultSkillLevelForSkill(skill: Skill, championLevel: number, maxLevel: number): number {
  const normalized = (skill.skillKey ?? '').trim().toUpperCase();
  if (skill.ownerType === 'item' || PASSIVE_SKILL_KEYS.has(normalized)) {
    return 1;
  }
  if (normalized === 'R') {
    return clamp(1 + Math.floor((championLevel - 1) / 5), 1, maxLevel);
  }
  if (normalized === 'Q' || normalized === 'W' || normalized === 'E') {
    return clamp(1 + Math.floor((championLevel - 1) / 2), 1, maxLevel);
  }
  return clamp(championLevel, 1, maxLevel);
}

function compileActorActionTemplates(
  gameId: string,
  source: ResolvedActorState,
  target: ResolvedActorState,
  formulaCompiler: FormulaRegistryCompiler,
  statusCompiler: StatusRegistryCompiler
): TinyGoV2ActionTemplate[] {
  return source.skills.map((skill) => compileSkillActionTemplate(gameId, skill, source, target, formulaCompiler, statusCompiler));
}

function compileSkillActionTemplate(
  gameId: string,
  selectedSkill: ResolvedActionSkill,
  source: ResolvedActorState,
  target: ResolvedActorState,
  formulaCompiler: FormulaRegistryCompiler,
  statusCompiler: StatusRegistryCompiler
): TinyGoV2ActionTemplate {
  const env = buildSkillEnvironment(selectedSkill, source, target);
  const resourceCosts: TinyGoV2ResourceCost[] = [];
  const cooldownRows = safeParseValueRows(selectedSkill.skill.cooldowns, 'cooldowns');
  const resourceRows = safeParseValueRows(selectedSkill.skill.resourceCosts, 'resourceCosts');

  for (const [index, row] of resourceRows.entries()) {
    const resourceId = resolveCostResourceId(row.raw, source.resources, source.attrs);
    const formulaId =
      row.kind === 'formula'
        ? formulaCompiler.resolveBinding(selectedSkill, env, row.bindingKey, `resource_cost:${index}`)
        : undefined;
    const amount = row.kind === 'formula' ? undefined : resolveValueDefinitionRow(row, env);

    if (!resourceId || isHpLikeResource(resourceId)) {
      continue;
    }
    if (!ensureExecutableResource(resourceId, source.resources, source.attrs)) {
      continue;
    }
    resourceCosts.push({
      resourceId,
      formulaId,
      amount
    });
  }

  const compiledEffects = compileActionEffects(selectedSkill, env, formulaCompiler, statusCompiler);
  const cooldown = compileActionCooldown(gameId, selectedSkill, source, env, cooldownRows[0], formulaCompiler);
  const markRequirement = readActionMarkRequirement(env.mechanicsRoot);
  const channelDurationMs = readActionChannelDurationMs(env.mechanicsRoot);

  return {
    id: selectedSkill.actionId,
    label: selectedSkill.label,
    skillLevel: selectedSkill.level,
    panelInputs: buildPanelInputs(selectedSkill, source),
    cooldownMs: cooldown.cooldownMs,
    cooldownFormulaId: cooldown.cooldownFormulaId,
    channelDurationMs,
    effects: compiledEffects.effects.length > 0 ? compiledEffects.effects : undefined,
    ...markRequirement,
    resourceCost: resourceCosts.length > 0 ? resourceCosts : undefined
  };
}

function compileActionCooldown(
  gameId: string,
  selectedSkill: ResolvedActionSkill,
  source: ResolvedActorState,
  env: CompiledSkillEnvironment,
  row: SkillValueDefinitionRow | undefined,
  formulaCompiler: FormulaRegistryCompiler
): Pick<TinyGoV2ActionTemplate, 'cooldownMs' | 'cooldownFormulaId'> {
  if (!row) {
    return {};
  }
  if (row.kind === 'formula') {
    return {
      cooldownFormulaId: formulaCompiler.resolveBinding(selectedSkill, env, row.bindingKey, 'cooldown')
    };
  }

  const baseCooldownMs = resolveCooldownMs(resolveValueDefinitionRow(row, env));
  if (shouldProjectLoLAbilityHasteCooldown(gameId, source, baseCooldownMs)) {
    return {
      cooldownFormulaId: formulaCompiler.resolveGeneratedFormula(
        selectedSkill,
        LOL_ABILITY_HASTE_COOLDOWN_SLOT,
        buildLoLAbilityHasteCooldownExpr(baseCooldownMs)
      )
    };
  }

  return { cooldownMs: baseCooldownMs };
}

function shouldProjectLoLAbilityHasteCooldown(gameId: string, source: ResolvedActorState, baseCooldownMs: number): boolean {
  return (
    gameId === 'lol' &&
    baseCooldownMs > 0 &&
    Object.prototype.hasOwnProperty.call(source.attrs, ABILITY_HASTE_ATTR_KEY)
  );
}

function buildLoLAbilityHasteCooldownExpr(baseCooldownMs: number): BenchmarkFormulaExpr {
  return {
    type: 'divide',
    numerator: {
      type: 'multiply',
      factors: [
        { type: 'constant', value: baseCooldownMs },
        { type: 'constant', value: LOL_ABILITY_HASTE_COOLDOWN_FACTOR }
      ]
    },
    denominator: {
      type: 'add',
      terms: [
        { type: 'constant', value: LOL_ABILITY_HASTE_COOLDOWN_FACTOR },
        { type: 'actor_attr', actor: 'source', attrKey: ABILITY_HASTE_ATTR_KEY }
      ]
    }
  };
}

function buildPanelInputs(selectedSkill: ResolvedActionSkill, source: ResolvedActorState): Record<string, number> {
  return {
    skillLevel: selectedSkill.level,
    championLevel: source.level
  };
}

function buildSkillEnvironment(
  selectedSkill: ResolvedActionSkill,
  source: ResolvedActorState,
  target: ResolvedActorState
): CompiledSkillEnvironment {
  const params = parseSkillParams(JSON.stringify(selectedSkill.skill.params ?? {}));
  const mechanics = parseMechanicsConfig(JSON.stringify(selectedSkill.skill.mechanicsConfig ?? { version: 1, triggers: [] }));
  const externalSymbols = compileConstantSymbols(extractNumericConstants(params.root));
  addLegacyParamSymbols(externalSymbols, params.root, source.attrs, target.attrs, selectedSkill.level, source.level);

  const varDefs = Object.fromEntries(
    params.rows.map((row) => [row.key, skillParamRowToVarDefinition(row)])
  ) as Record<string, VarDefinition>;
  const compiledVars = compileVarsToExprMap(varDefs, {
    skillLevel: selectedSkill.level,
    championLevel: source.level
  }, externalSymbols);

  const symbols = new Map(externalSymbols);
  for (const [key, value] of compiledVars.entries()) {
    symbols.set(key, value);
  }

  return {
    paramsRoot: params.root,
    mechanicsRoot: mechanics.root,
    symbols,
    skillLevel: selectedSkill.level,
    championLevel: source.level,
    mechanicsRows: mechanics.rows
  };
}

function compileActionEffects(
  selectedSkill: ResolvedActionSkill,
  env: CompiledSkillEnvironment,
  formulaCompiler: FormulaRegistryCompiler,
  statusCompiler: StatusRegistryCompiler
): { effects: TinyGoV2EffectDefinition[] } {
  const effects: TinyGoV2EffectDefinition[] = [];
  const tickTriggers = new Map(
    env.mechanicsRows
      .filter((row) => row.eventType === 'on_tick' && row.eventTickKey)
      .map((row) => [row.eventTickKey, row] as const)
  );

  let effectIndex = 0;
  for (const trigger of env.mechanicsRows) {
    if (trigger.eventType !== 'on_spell_cast') {
      continue;
    }

    for (const action of trigger.actions) {
      if (action.type === 'deal_damage') {
        const formulaId = resolveDamageActionFormula(selectedSkill, env, formulaCompiler, action, `damage:${effectIndex}`);
        const sourceRole = normalizeActionRole(action.damageSource, 'source');
        const targetRole = normalizeActionRole(action.damageTarget, 'target');
        effects.push({
          type: 'deal_damage',
          formulaId,
          damageType: action.damageType || undefined,
          ...resolveCritOptions(action.raw),
          ...resolveModeOptions(action.raw),
          sourceRole,
          targetRole
        });
        effectIndex += 1;
        continue;
      }

      if (action.type === 'schedule_tick') {
        const tickTrigger = tickTriggers.get(action.tickKey);
        if (!tickTrigger) {
          effectIndex += 1;
          continue;
        }
        for (const tickAction of tickTrigger.actions) {
          if (tickAction.type === 'deal_damage') {
            const formulaId = resolveDamageActionFormula(selectedSkill, env, formulaCompiler, tickAction, `tick_damage:${effectIndex}`);
            const sourceRole = normalizeActionRole(tickAction.damageSource, 'source');
            const targetRole = normalizeActionRole(tickAction.damageTarget, 'target');
            const statusId = statusCompiler.registerTickStatus(selectedSkill.actionId, action.tickKey || `tick:${effectIndex}`, {
              kind: 'dot',
              tickIntervalMs: action.everyMs,
              tickCount: action.times,
              tickEffectType: 'deal_damage',
              tickFormulaId: formulaId,
              tickDamageType: tickAction.damageType || undefined
            });
            effects.push({
              type: 'apply_status',
              statusId,
              sourceRole,
              targetRole
            });
            effectIndex += 1;
            continue;
          }
          if (tickAction.type === '__raw__') {
            const rawTick = compileRawEffect(selectedSkill, env, formulaCompiler, statusCompiler, tickAction.raw, `tick:${effectIndex}`);
            if (rawTick?.type === 'heal') {
              const statusId = statusCompiler.registerTickStatus(selectedSkill.actionId, action.tickKey || `tick:${effectIndex}`, {
                kind: 'hot',
                tickIntervalMs: action.everyMs,
                tickCount: action.times,
                tickEffectType: 'heal',
                tickFormulaId: rawTick.formulaId,
                tickAmount: rawTick.amount,
                sourceStatusId: rawTick.statusId
              });
              effects.push({
                type: 'apply_status',
                statusId,
                sourceRole: rawTick.sourceRole,
                targetRole: rawTick.targetRole
              });
              effectIndex += 1;
            }
          }
        }
        continue;
      }

      if (action.type === '__raw__') {
        const rawEffect = compileRawEffect(selectedSkill, env, formulaCompiler, statusCompiler, action.raw, `raw:${effectIndex}`);
        if (rawEffect) {
          effects.push(rawEffect);
          effectIndex += 1;
        }
      }
    }
  }

  return { effects };
}

function compileRawEffect(
  selectedSkill: ResolvedActionSkill,
  env: CompiledSkillEnvironment,
  formulaCompiler: FormulaRegistryCompiler,
  statusCompiler: StatusRegistryCompiler,
  rawAction: JsonObject,
  slotLabel: string
): TinyGoV2EffectDefinition | null {
  const rawType = readString(rawAction.type);
  if (rawType === 'heal' || rawType === 'apply_heal') {
    const heal = isPlainObject(rawAction.heal) ? rawAction.heal : rawAction;
    return {
      type: 'heal',
      ...resolveAmountActionFormula(selectedSkill, env, formulaCompiler, heal, slotLabel),
      sourceRole: normalizeActionRole(readString(heal.source), 'source'),
      targetRole: normalizeActionRole(readString(heal.target), 'target')
    };
  }

  if (rawType === 'grant_shield' || rawType === 'generate_shield' || rawType === 'shield') {
    const shield = isPlainObject(rawAction.shield) ? rawAction.shield : rawAction;
    const statusId =
      readString(shield.statusId) ||
      statusCompiler.registerShieldStatus(selectedSkill.actionId, slotLabel, {
        durationMs: toFiniteOptional(shield.durationMs) ?? toFiniteOptional(rawAction.durationMs) ?? undefined,
        shieldKind: readString(shield.shieldKind) || readString(shield.kind) || undefined
      });
    statusCompiler.ensureStatus({
      id: statusId,
      kind: 'shield',
      durationMs: toFiniteOptional(shield.durationMs) ?? toFiniteOptional(rawAction.durationMs) ?? undefined,
      shieldKind: readString(shield.shieldKind) || readString(shield.kind) || undefined
    });
    return {
      type: 'grant_shield',
      statusId,
      ...resolveAmountActionFormula(selectedSkill, env, formulaCompiler, shield, slotLabel),
      sourceRole: normalizeActionRole(readString(shield.source), 'source'),
      targetRole: normalizeActionRole(readString(shield.target), 'target')
    };
  }

  if (rawType === 'apply_status') {
    const status = isPlainObject(rawAction.status) ? rawAction.status : rawAction;
    const statusId = readString(status.statusId) || readString(status.id);
    if (!statusId) {
      return null;
    }
    statusCompiler.ensureStatus({
      id: statusId,
      kind: readString(status.kind) || 'status',
      durationMs: toFiniteOptional(status.durationMs) ?? undefined
    });
    return {
      type: 'apply_status',
      statusId,
      sourceRole: normalizeActionRole(readString(status.source), 'source'),
      targetRole: normalizeActionRole(readString(status.target), 'target')
    };
  }

  if (rawType === 'apply_mark' || rawType === 'mark') {
    const mark = isPlainObject(rawAction.mark) ? rawAction.mark : rawAction;
    const markId = readString(mark.markId) || readString(mark.id);
    if (!markId) {
      return null;
    }
    return {
      type: 'apply_mark',
      markId,
      sourceRole: normalizeActionRole(readString(mark.source), 'source'),
      targetRole: normalizeActionRole(readString(mark.target), 'target')
    };
  }

  if (rawType === 'consume_mark') {
    const mark = isPlainObject(rawAction.mark) ? rawAction.mark : rawAction;
    const markId = readString(mark.markId) || readString(mark.id);
    if (!markId) {
      return null;
    }
    return {
      type: 'consume_mark',
      markId,
      sourceRole: normalizeActionRole(readString(mark.source), 'source'),
      targetRole: normalizeActionRole(readString(mark.target), 'target')
    };
  }

  if (rawType === 'damage_from_recent') {
    const recent = isPlainObject(rawAction.recent) ? rawAction.recent : rawAction;
    return {
      type: 'damage_from_recent',
      amount: toFiniteOptional(recent.amount) ?? toFiniteOptional(recent.multiplier) ?? 1,
      historyWindowMs: toFiniteOptional(recent.historyWindowMs) ?? toFiniteOptional(recent.windowMs) ?? undefined,
      damageType: readString(recent.damageType) || undefined,
      sourceRole: normalizeActionRole(readString(recent.source), 'source'),
      targetRole: normalizeActionRole(readString(recent.target), 'target')
    };
  }

  if (rawType === 'interrupt') {
    const interrupt = isPlainObject(rawAction.interrupt) ? rawAction.interrupt : rawAction;
    return {
      type: 'interrupt',
      sourceRole: normalizeActionRole(readString(interrupt.source), 'source'),
      targetRole: normalizeActionRole(readString(interrupt.target), 'target')
    };
  }

  if (rawType === 'increment_counter' || rawType === 'counter_increment') {
    const counter = isPlainObject(rawAction.counter) ? rawAction.counter : rawAction;
    const counterKey = readString(counter.counterKey) || readString(counter.key);
    if (!counterKey) {
      return null;
    }
    return {
      type: 'increment_counter',
      counterKey,
      amount: toFiniteOptional(counter.amount) ?? toFiniteOptional(counter.delta) ?? 1,
      sourceRole: normalizeActionRole(readString(counter.source), 'source'),
      targetRole: normalizeActionRole(readString(counter.target), 'target')
    };
  }

  return null;
}

function readActionMarkRequirement(root: JsonObject): Pick<TinyGoV2ActionTemplate, 'requiresMark' | 'consumesMark'> {
  const condition = isPlainObject(root.condition) ? root.condition : {};
  const markId = readString(root.requiresMark) || readString(condition.requiresMark) || readString(condition.markId);
  if (!markId) {
    return {};
  }
  return {
    requiresMark: markId,
    consumesMark: readBoolean(root.consumesMark) || readBoolean(condition.consumesMark)
  };
}

function readActionChannelDurationMs(root: JsonObject): number | undefined {
  const execution = isPlainObject(root.execution) ? root.execution : root;
  return toFiniteOptional(execution.channelDurationMs) ?? toFiniteOptional(execution.castTimeMs) ?? undefined;
}

function resolveCritOptions(raw: JsonObject): Pick<TinyGoV2EffectDefinition, 'critPolicy' | 'critChance' | 'critMultiplier'> {
  const crit = isPlainObject(raw.crit) ? raw.crit : raw;
  const policy = readString(crit.critPolicy) || readString(crit.policy);
  if (!policy) {
    return {};
  }
  return {
    critPolicy: policy,
    critChance: toFiniteOptional(crit.critChance) ?? toFiniteOptional(crit.chance) ?? undefined,
    critMultiplier: toFiniteOptional(crit.critMultiplier) ?? toFiniteOptional(crit.multiplier) ?? undefined
  };
}

function resolveModeOptions(raw: JsonObject): Pick<TinyGoV2EffectDefinition, 'modeAugmentId' | 'modeMultiplier'> {
  const mode = isPlainObject(raw.mode) ? raw.mode : raw;
  const modeAugmentId = readString(mode.modeAugmentId) || readString(mode.augmentId);
  if (!modeAugmentId) {
    return {};
  }
  return {
    modeAugmentId,
    modeMultiplier: toFiniteOptional(mode.modeMultiplier) ?? toFiniteOptional(mode.multiplier) ?? undefined
  };
}

function resolveAmountActionFormula(
  selectedSkill: ResolvedActionSkill,
  env: CompiledSkillEnvironment,
  formulaCompiler: FormulaRegistryCompiler,
  raw: JsonObject,
  slotLabel: string
): Pick<TinyGoV2EffectDefinition, 'formulaId' | 'amount'> {
  const bindingKey = readString(raw.bindingKey).trim();
  if (bindingKey) {
    return { formulaId: formulaCompiler.resolveBinding(selectedSkill, env, bindingKey, slotLabel) };
  }

  const formulaText = readString(raw.formulaText).trim();
  if (formulaText) {
    const formulaVars = Array.isArray(raw.formulaVars) ? raw.formulaVars.map(readString).map((value) => value.trim()).filter(Boolean) : undefined;
    return { formulaId: formulaCompiler.resolveInlineFormula(selectedSkill, env, formulaText, formulaVars, slotLabel) };
  }

  return { amount: toFiniteOptional(raw.amount) ?? toFiniteOptional(raw.value) ?? toFiniteOptional(raw.magnitude) ?? 0 };
}

function resolveDamageActionFormula(
  selectedSkill: ResolvedActionSkill,
  env: CompiledSkillEnvironment,
  formulaCompiler: FormulaRegistryCompiler,
  action: Extract<SkillTriggerRow['actions'][number], { type: 'deal_damage' }>,
  slotLabel: string
): string {
  if (action.bindingKey.trim()) {
    return formulaCompiler.resolveBinding(selectedSkill, env, action.bindingKey, slotLabel);
  }

  const inline = readInlineDamageFormula(action.raw);
  if (inline) {
    return formulaCompiler.resolveInlineFormula(selectedSkill, env, inline.formulaText, inline.formulaVars, slotLabel);
  }

  return formulaCompiler.resolveBinding(selectedSkill, env, action.bindingKey, slotLabel);
}

function readInlineDamageFormula(rawAction: JsonObject): { formulaText: string; formulaVars?: string[] } | null {
  const damage = isPlainObject(rawAction.damage) ? rawAction.damage : rawAction;
  const formulaText = readString(damage.formulaText).trim();
  if (!formulaText) {
    return null;
  }

  const rawVars = Array.isArray(damage.formulaVars) ? damage.formulaVars : undefined;
  const formulaVars = rawVars?.map(readString).map((value) => value.trim()).filter(Boolean);
  return {
    formulaText,
    formulaVars: formulaVars && formulaVars.length > 0 ? formulaVars : undefined
  };
}

function resolveValueDefinitionRow(row: SkillValueDefinitionRow, env: CompiledSkillEnvironment): number {
  if (row.kind === 'table') {
    if (row.values.length === 0) {
      return 0;
    }
    const indexBase = row.by === 'championLevel' ? env.championLevel : env.skillLevel;
    return toNumber(row.values[clamp(indexBase, 1, row.values.length) - 1], 0);
  }
  return toNumber(row.value, 0);
}

function addLegacyParamSymbols(
  symbols: Map<string, BenchmarkFormulaExpr>,
  root: JsonObject,
  sourceAttrs: Record<string, number>,
  targetAttrs: Record<string, number>,
  skillLevel: number,
  championLevel: number
) {
  const damageConstant = resolveLegacyTable(root.baseDamageBySkillLevel, skillLevel) ?? toNumber(root.baseDamage, NaN);
  if (Number.isFinite(damageConstant)) {
    addFormulaAliases(symbols, ['baseDamage', 'base_damage'], { type: 'constant', value: damageConstant });
  }

  const attackDamageAttr = pickFirstKey(sourceAttrs, ['attack_damage', 'attackDamage', 'ad', 'atk']);
  const abilityPowerAttr = pickFirstKey(sourceAttrs, ['ability_power', 'abilityPower', 'ap', 'magic_power']);
  const bonusAttackSpeedAttr = pickFirstKey(sourceAttrs, ['bonus_attack_speed', 'bonusAttackSpeed', 'attack_speed_bonus']);

  addScaledLegacyAlias(symbols, ['attackRatio', 'attack_ratio'], root.attackRatio, attackDamageAttr);
  addScaledLegacyAlias(symbols, ['adRatio', 'ad_ratio'], root.adRatio, attackDamageAttr);
  addScaledLegacyAlias(symbols, ['apRatio', 'ap_ratio'], root.apRatio, abilityPowerAttr);
  addScaledLegacyAlias(symbols, ['bonusAttackSpeedRatio', 'bonus_attack_speed_ratio'], root.bonusAttackSpeedRatio, bonusAttackSpeedAttr);

  const hitCount = toFiniteOptional(root.hitCount);
  if (hitCount !== null) {
    addFormulaAliases(symbols, ['hitCount', 'hit_count'], { type: 'constant', value: hitCount });
  }
  const hitIntervalMs = toFiniteOptional(root.hitIntervalMs);
  if (hitIntervalMs !== null) {
    addFormulaAliases(symbols, ['hitIntervalMs', 'hit_interval_ms'], { type: 'constant', value: hitIntervalMs });
  }
  const channelDurationMs = toFiniteOptional(root.channelDurationMs);
  if (channelDurationMs !== null) {
    addFormulaAliases(symbols, ['channelDurationMs', 'channel_duration_ms'], { type: 'constant', value: channelDurationMs });
  }
  const defaultSkillLevel = toFiniteOptional(root.defaultSkillLevel);
  if (defaultSkillLevel !== null) {
    addFormulaAliases(symbols, ['defaultSkillLevel', 'default_skill_level'], { type: 'constant', value: defaultSkillLevel });
  }

  for (const [name, rawValue] of Object.entries(root)) {
    if (name === 'vars') {
      continue;
    }
    if (symbols.has(name)) {
      continue;
    }
    if (typeof rawValue === 'number') {
      symbols.set(name, { type: 'constant', value: rawValue });
      continue;
    }
    if (Array.isArray(rawValue)) {
      const resolved = resolveLegacyTable(rawValue, championLevel) ?? resolveLegacyTable(rawValue, skillLevel);
      if (resolved !== null) {
        symbols.set(name, { type: 'constant', value: resolved });
      }
    }
  }

  void targetAttrs;
}

function addScaledLegacyAlias(
  symbols: Map<string, BenchmarkFormulaExpr>,
  aliases: string[],
  rawCoefficient: unknown,
  attrKey: string | null
) {
  const coefficient = toFiniteOptional(rawCoefficient);
  if (coefficient === null) {
    return;
  }
  const expr: BenchmarkFormulaExpr = attrKey
    ? {
        type: 'multiply',
        factors: [
          { type: 'actor_attr', actor: 'source', attrKey },
          { type: 'constant', value: coefficient }
        ]
      }
    : { type: 'constant', value: coefficient };
  addFormulaAliases(symbols, aliases, expr);
}

function addFormulaAliases(symbols: Map<string, BenchmarkFormulaExpr>, aliases: string[], expr: BenchmarkFormulaExpr) {
  for (const alias of aliases) {
    symbols.set(alias, expr);
  }
}

function resolveLegacyTable(value: unknown, level: number): number | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  return toFiniteOptional(value[clamp(level, 1, value.length) - 1]);
}

function skillParamRowToVarDefinition(row: SkillParamVarRow): VarDefinition {
  if (readString(row.raw.kind) === 'counter') {
    return {
      label: row.label || undefined,
      kind: 'counter',
      counterKey: readString(row.raw.counterKey) || readString(row.raw.counter) || readString(row.raw.key) || row.key
    };
  }
  const rawValues = row.raw.values;
  return {
    label: row.label || undefined,
    kind: row.kind,
    value: row.value,
    values: Array.isArray(rawValues) ? rawValues.map((value) => toNumber(value, 0)) : (rawValues as number[] | undefined),
    by: row.by === 'championLevel' ? 'championLevel' : 'skillLevel',
    attr: row.attr || undefined,
    coefficient: row.coefficient,
    formulaText: row.formulaText || undefined,
    formulaVars: row.formulaVars.length > 0 ? row.formulaVars : undefined,
    selector: row.selector || undefined
  };
}

function createFormulaRegistryCompiler(bundle: GameDataBundle): FormulaRegistryCompiler {
  const definitions: TinyGoV2FormulaDefinition[] = [];
  const emittedIds = new Set<string>();
  const bindingCache = new Map<string, string>();
  const attrKeys = new Set(bundle.attributeDefinitions.map((definition) => definition.attrKey).filter(Boolean));
  const profiles = new Map((bundle.formulaProfiles ?? []).map((profile) => [profile.formulaId, profile]));
  const bindings = bundle.formulaBindings ?? [];

  return {
    definitions,
    resolveGeneratedFormula(selectedSkill, slotLabel, expr) {
      const rootFormulaId = `${selectedSkill.actionId}::${sanitizeFormulaKey(slotLabel)}`;
      const cacheKey = `${selectedSkill.actionId}::generated::${slotLabel}`;
      const cached = bindingCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      emitFormulaExpr(rootFormulaId, normalizeFormulaAttrRefs(expr, attrKeys), definitions, emittedIds);
      bindingCache.set(cacheKey, rootFormulaId);
      return rootFormulaId;
    },
    resolveBinding(selectedSkill, env, bindingKey, slotLabel) {
      const normalizedBindingKey = bindingKey.trim();
      if (!normalizedBindingKey) {
        throw new Error(`${selectedSkill.skillId}.${slotLabel} missing bindingKey`);
      }

      const cacheKey = `${selectedSkill.actionId}::${normalizedBindingKey}`;
      const cached = bindingCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const binding = resolveFormulaBindingRecord(bundle, bindings, selectedSkill, normalizedBindingKey);
      if (!binding) {
        throw new Error(`formula binding not found: ${selectedSkill.skillId}.${normalizedBindingKey}`);
      }

      const profile = profiles.get(binding.formulaId);
      if (!profile) {
        throw new Error(`formula profile not found: ${binding.formulaId}`);
      }

      const rootFormulaId = `${selectedSkill.actionId}::${sanitizeFormulaKey(normalizedBindingKey)}`;
      const expr = normalizeFormulaAttrRefs(compileBoundFormulaExpr(profile, binding.overrideParams, env), attrKeys);
      emitFormulaExpr(rootFormulaId, expr, definitions, emittedIds);
      bindingCache.set(cacheKey, rootFormulaId);
      return rootFormulaId;
    },
    resolveInlineFormula(selectedSkill, env, formulaText, formulaVars, slotLabel) {
      const normalizedFormulaText = formulaText.trim();
      if (!normalizedFormulaText) {
        throw new Error(`${selectedSkill.skillId}.${slotLabel} missing formulaText`);
      }

      const cacheKey = `${selectedSkill.actionId}::inline::${slotLabel}::${normalizedFormulaText}`;
      const cached = bindingCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const rootFormulaId = `${selectedSkill.actionId}::${sanitizeFormulaKey(slotLabel)}::inline`;
      const expr = normalizeFormulaAttrRefs(compileFormulaText(normalizedFormulaText, formulaVars, env.symbols), attrKeys);
      emitFormulaExpr(rootFormulaId, expr, definitions, emittedIds);
      bindingCache.set(cacheKey, rootFormulaId);
      return rootFormulaId;
    }
  };
}

function createStatusRegistryCompiler(): StatusRegistryCompiler {
  const definitions: TinyGoV2StatusTemplate[] = [];
  const emittedIds = new Set<string>();

  function ensureStatus(status: TinyGoV2StatusTemplate): string {
    if (emittedIds.has(status.id)) {
      return status.id;
    }
    emittedIds.add(status.id);
    definitions.push(status);
    return status.id;
  }

  return {
    definitions,
    ensureStatus,
    registerShieldStatus(actionId, slotLabel, options) {
      const statusId = `${actionId}::${sanitizeFormulaKey(slotLabel)}::shield`;
      return ensureStatus({
        id: statusId,
        kind: 'shield',
        durationMs: options.durationMs,
        shieldKind: options.shieldKind || 'all'
      });
    },
    registerTickStatus(actionId, slotLabel, options) {
      const statusId = options.sourceStatusId || `${actionId}::${sanitizeFormulaKey(slotLabel)}::${options.kind}`;
      return ensureStatus({
        id: statusId,
        kind: options.kind,
        durationMs: options.tickIntervalMs * options.tickCount,
        tickIntervalMs: options.tickIntervalMs,
        tickCount: options.tickCount,
        tickEffectType: options.tickEffectType,
        tickFormulaId: options.tickFormulaId,
        tickAmount: options.tickAmount,
        tickDamageType: options.tickDamageType
      });
    }
  };
}

function normalizeFormulaAttrRefs(expr: BenchmarkFormulaExpr, attrKeys: Set<string>): BenchmarkFormulaExpr {
  switch (expr.type) {
    case 'actor_attr':
      return { ...expr, attrKey: normalizeFormulaAttrKey(expr.attrKey, attrKeys) };
    case 'add':
      return { ...expr, terms: expr.terms.map((term) => normalizeFormulaAttrRefs(term, attrKeys)) };
    case 'multiply':
      return { ...expr, factors: expr.factors.map((factor) => normalizeFormulaAttrRefs(factor, attrKeys)) };
    case 'subtract':
      return {
        ...expr,
        left: normalizeFormulaAttrRefs(expr.left, attrKeys),
        right: normalizeFormulaAttrRefs(expr.right, attrKeys)
      };
    case 'divide':
      return {
        ...expr,
        numerator: normalizeFormulaAttrRefs(expr.numerator, attrKeys),
        denominator: normalizeFormulaAttrRefs(expr.denominator, attrKeys)
      };
    case 'max':
      return { ...expr, operands: expr.operands.map((operand) => normalizeFormulaAttrRefs(operand, attrKeys)) };
    case 'min':
      return { ...expr, operands: expr.operands.map((operand) => normalizeFormulaAttrRefs(operand, attrKeys)) };
    case 'negate':
      return { ...expr, operand: normalizeFormulaAttrRefs(expr.operand, attrKeys) };
    default:
      return expr;
  }
}

function normalizeFormulaAttrKey(attrKey: string, attrKeys: Set<string>): string {
  if (attrKeys.has(attrKey)) {
    return attrKey;
  }

  const alias = FORMULA_ATTR_ALIASES[attrKey];
  if (alias && attrKeys.has(alias)) {
    return alias;
  }

  return attrKey;
}

function resolveFormulaBindingRecord(
  bundle: GameDataBundle,
  bindings: NonNullable<GameDataBundle['formulaBindings']>,
  selectedSkill: ResolvedActionSkill,
  bindingKey: string
) {
  const candidates: Array<[string, string]> = [
    ['skill', selectedSkill.skillId],
    [selectedSkill.ownerType, selectedSkill.ownerId],
    ['global', bundle.meta.gameId]
  ];
  return candidates
    .map(([targetCategory, targetId]) =>
      bindings.find((binding) => binding.targetCategory === targetCategory && binding.targetId === targetId && binding.bindingKey === bindingKey)
    )
    .find(Boolean);
}

function compileBoundFormulaExpr(
  profile: NonNullable<GameDataBundle['formulaProfiles']>[number],
  overrideParams: JsonObject | undefined,
  env: CompiledSkillEnvironment
): BenchmarkFormulaExpr {
  const mergedParams: JsonObject = {
    ...(isPlainObject(profile.params) ? profile.params : {}),
    ...(isPlainObject(overrideParams) ? overrideParams : {})
  };
  const parsed = parseFormulaParams(JSON.stringify(mergedParams), profile.formulaId);
  const externalSymbols = new Map(env.symbols);
  mergeFormulaSymbols(externalSymbols, compileConstantSymbols(extractFormulaRootConstants(parsed.root)));
  mergeFormulaSymbols(
    externalSymbols,
    compileConstantSymbols(isPlainObject(parsed.root.constants) ? (parsed.root.constants as Record<string, unknown>) : undefined)
  );

  const formulaVarDefs = Object.fromEntries(
    parsed.vars.map((row) => [row.key, formulaParamVarRowToVarDefinition(row)])
  ) as Record<string, VarDefinition>;
  const compiledVars = compileVarsToExprMap(
    formulaVarDefs,
    {
      skillLevel: env.skillLevel,
      championLevel: env.championLevel
    },
    externalSymbols
  );
  mergeFormulaSymbols(externalSymbols, compiledVars);

  if (!parsed.formulaText.trim()) {
    throw new Error(`formula profile ${profile.formulaId} has empty params.formulaText`);
  }
  return compileFormulaText(parsed.formulaText, undefined, externalSymbols);
}

function formulaParamVarRowToVarDefinition(row: FormulaParamVarRow): VarDefinition {
  if (readString(row.raw.kind) === 'counter') {
    return {
      kind: 'counter',
      counterKey: readString(row.raw.counterKey) || readString(row.raw.counter) || readString(row.raw.key) || row.key
    };
  }
  if (row.kind === 'const') {
    return {
      kind: 'const',
      value: row.value ?? 0
    };
  }

  if (row.kind === 'table') {
    return {
      kind: 'table',
      by: row.by,
      values: row.values
    };
  }

  if (row.kind === 'scaled_attr') {
    return {
      kind: 'scaled_attr',
      attr: row.attr || undefined,
      coefficient: row.coefficient ?? 1
    };
  }

  if (row.kind === 'formula') {
    return {
      kind: 'formula',
      formulaText: row.formulaText || undefined,
      formulaVars: row.formulaVars.length > 0 ? row.formulaVars : undefined
    };
  }

  return {
    kind: 'mapping_scaled_attr',
    selector: row.selector || undefined,
    attr: row.attr || undefined,
    coefficient: row.coefficient ?? 1,
    values: Object.fromEntries(
      row.mappingValues
        .map((entry) => [entry.key.trim(), entry.value] as const)
        .filter(([key]) => Boolean(key))
    ) as unknown as number[] | undefined
  };
}

function extractFormulaRootConstants(root: JsonObject): Record<string, unknown> {
  const constants: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(root)) {
    if (key === 'vars' || key === 'constants' || key === 'formulaText' || key === 'damageTypeId') {
      continue;
    }
    constants[key] = value;
  }
  return constants;
}

function mergeFormulaSymbols(target: Map<string, BenchmarkFormulaExpr>, source: Map<string, BenchmarkFormulaExpr>) {
  for (const [key, value] of source.entries()) {
    target.set(key, value);
  }
}

function emitFormulaExpr(
  id: string,
  expr: BenchmarkFormulaExpr,
  definitions: TinyGoV2FormulaDefinition[],
  emittedIds: Set<string>
): string {
  if (emittedIds.has(id)) {
    return id;
  }

  switch (expr.type) {
    case 'constant':
      pushFormulaDefinition(definitions, emittedIds, { id, op: 'const', value: toNumber(expr.value, 0) });
      return id;
    case 'input_value':
      pushFormulaDefinition(definitions, emittedIds, { id, op: 'input' });
      return id;
    case 'actor_attr':
      pushFormulaDefinition(definitions, emittedIds, {
        id,
        op: 'attr',
        attr: expr.attrKey,
        actor: normalizeFormulaActor(expr.actor)
      });
      return id;
    case 'actor_hp_current':
      pushFormulaDefinition(definitions, emittedIds, {
        id,
        op: 'hp_current',
        actor: normalizeFormulaActor(expr.actor)
      });
      return id;
    case 'actor_hp_max':
      pushFormulaDefinition(definitions, emittedIds, {
        id,
        op: 'hp_max',
        actor: normalizeFormulaActor(expr.actor)
      });
      return id;
    case 'counter':
      pushFormulaDefinition(definitions, emittedIds, {
        id,
        op: 'counter',
        counter: expr.counterKey
      });
      return id;
    case 'add':
      return emitNaryFormula('add', id, expr.terms, definitions, emittedIds, { type: 'constant', value: 0 });
    case 'multiply':
      return emitNaryFormula('mul', id, expr.factors, definitions, emittedIds, { type: 'constant', value: 1 });
    case 'subtract': {
      const left = emitFormulaExpr(`${id}::left`, expr.left, definitions, emittedIds);
      const right = emitFormulaExpr(`${id}::right`, expr.right, definitions, emittedIds);
      pushFormulaDefinition(definitions, emittedIds, { id, op: 'sub', left, right });
      return id;
    }
    case 'divide': {
      const left = emitFormulaExpr(`${id}::left`, expr.numerator, definitions, emittedIds);
      const right = emitFormulaExpr(`${id}::right`, expr.denominator, definitions, emittedIds);
      pushFormulaDefinition(definitions, emittedIds, { id, op: 'div', left, right });
      return id;
    }
    case 'max':
      return emitNaryFormula('max', id, expr.operands, definitions, emittedIds, { type: 'constant', value: 0 });
    case 'min':
      return emitNaryFormula('min', id, expr.operands, definitions, emittedIds, { type: 'constant', value: 0 });
    case 'negate': {
      const left = emitFormulaExpr(`${id}::const`, { type: 'constant', value: -1 }, definitions, emittedIds);
      const right = emitFormulaExpr(`${id}::operand`, expr.operand, definitions, emittedIds);
      pushFormulaDefinition(definitions, emittedIds, { id, op: 'mul', left, right });
      return id;
    }
    default:
      pushFormulaDefinition(definitions, emittedIds, { id, op: 'const', value: 0 });
      return id;
  }
}

function emitNaryFormula(
  op: 'add' | 'mul' | 'max' | 'min',
  id: string,
  operands: BenchmarkFormulaExpr[],
  definitions: TinyGoV2FormulaDefinition[],
  emittedIds: Set<string>,
  emptyFallback: BenchmarkFormulaExpr
): string {
  if (operands.length === 0) {
    return emitFormulaExpr(id, emptyFallback, definitions, emittedIds);
  }
  if (operands.length === 1) {
    return emitFormulaExpr(id, operands[0], definitions, emittedIds);
  }
  const left = emitFormulaExpr(`${id}::left`, operands[0], definitions, emittedIds);
  const right = emitNaryFormula(op, `${id}::right`, operands.slice(1), definitions, emittedIds, emptyFallback);
  pushFormulaDefinition(definitions, emittedIds, { id, op, left, right });
  return id;
}

function pushFormulaDefinition(
  definitions: TinyGoV2FormulaDefinition[],
  emittedIds: Set<string>,
  definition: TinyGoV2FormulaDefinition
) {
  if (emittedIds.has(definition.id)) {
    return;
  }
  emittedIds.add(definition.id);
  definitions.push(definition);
}

function normalizeFormulaActor(actor: FormulaActorRef): string {
  if (actor === 'target' || actor === 'enemy') {
    return 'target';
  }
  return 'source';
}

function sanitizeFormulaKey(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, '_');
  return normalized || 'formula';
}

function extractNumericConstants(root: JsonObject): Record<string, unknown> {
  const constants: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(root)) {
    if (key === 'vars') {
      continue;
    }
    constants[key] = value;
  }
  return constants;
}

function inferActorResources(attrs: Record<string, number>): Record<string, TinyGoV2ResourceValue> {
  const resources: Record<string, TinyGoV2ResourceValue> = {};
  for (const candidate of RESOURCE_CANDIDATES) {
    const value = inferResourceValue(attrs, candidate.currentKeys, candidate.maxKeys);
    if (value) {
      resources[candidate.id] = value;
    }
  }
  return resources;
}

function applyResourceOverrides(
  resources: Record<string, TinyGoV2ResourceValue>,
  overrides: Record<string, TinyGoV2ResourceValue>
): Record<string, TinyGoV2ResourceValue> {
  const merged = { ...resources };
  for (const [resourceId, override] of Object.entries(overrides)) {
    const max = Math.max(toNumber(override.max, merged[resourceId]?.max ?? 0), 0);
    const current = clampNumber(toNumber(override.current, merged[resourceId]?.current ?? max), 0, max || override.current || 0);
    merged[resourceId] = { current, max };
  }
  return merged;
}

function ensureExecutableResource(
  resourceId: string,
  resources: Record<string, TinyGoV2ResourceValue>,
  attrs: Record<string, number>
): boolean {
  if (resources[resourceId]) {
    return true;
  }
  const inferred = inferResourceValue(attrs, [resourceId, `${resourceId}_current`, `current_${resourceId}`], [`max_${resourceId}`, `${resourceId}_max`, resourceId]);
  if (!inferred) {
    return false;
  }
  resources[resourceId] = inferred;
  return true;
}

function inferResourceValue(attrs: Record<string, number>, currentKeys: readonly string[], maxKeys: readonly string[]): TinyGoV2ResourceValue | null {
  const current = findFirstNumber(attrs, currentKeys);
  const max = findFirstNumber(attrs, maxKeys);
  if (current === null && max === null) {
    return null;
  }
  const normalizedMax = Math.max(max ?? current ?? 0, 0);
  const normalizedCurrent = clampNumber(current ?? normalizedMax, 0, normalizedMax || current || 0);
  return {
    current: normalizedCurrent,
    max: normalizedMax
  };
}

function resolveCostResourceId(
  raw: JsonObject,
  knownResources: Record<string, TinyGoV2ResourceValue>,
  attrs: Record<string, number>
): string | null {
  const explicit = normalizeResourceId(
    readString(raw.resourceId)
      || readString(raw.resource)
      || readString(raw.resourceKey)
      || readString(raw.costType)
      || readString(raw.resourceType)
  );
  if (explicit) {
    return explicit;
  }
  const resourceIds = Object.keys(knownResources);
  if (resourceIds.length === 1) {
    return resourceIds[0];
  }
  const positiveResourceIds = resourceIds.filter((resourceId) => {
    const value = knownResources[resourceId];
    return value && (value.current > 0 || value.max > 0);
  });
  if (positiveResourceIds.length === 1) {
    return positiveResourceIds[0];
  }
  const inferred = inferActorResources(attrs);
  const inferredIds = Object.keys(inferred);
  const positiveInferredIds = inferredIds.filter((resourceId) => {
    const value = inferred[resourceId];
    return value && (value.current > 0 || value.max > 0);
  });
  if (positiveInferredIds.length === 1) {
    return positiveInferredIds[0];
  }
  return inferredIds.length === 1 ? inferredIds[0] : null;
}

function normalizeResourceId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'none') {
    return null;
  }
  if (normalized === 'mp') {
    return 'mana';
  }
  if (normalized === 'ep') {
    return 'energy';
  }
  if (normalized === 'hp') {
    return 'health';
  }
  return normalized;
}

function isHpLikeResource(resourceId: string): boolean {
  return resourceId === 'health' || resourceId === 'hp' || resourceId === 'current_hp';
}

function resolveCooldownMs(value: number): number {
  const numeric = toNumber(value, 0);
  if (numeric <= 0) {
    return 0;
  }
  return Math.round(numeric * COOLDOWN_MS_MULTIPLIER);
}

function normalizeActionRole(value: string, fallback: 'source' | 'target'): 'source' | 'target' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'self' || normalized === 'owner' || normalized === 'source' || normalized === 'caster') {
    return 'source';
  }
  if (normalized === 'enemy' || normalized === 'target' || normalized === 'opponent') {
    return 'target';
  }
  return fallback;
}

function buildResourceDefinitions(actors: ResolvedActorState[]): TinyGoV2ResourceDefinition[] {
  const merged = new Map<string, TinyGoV2ResourceDefinition>();
  for (const actor of actors) {
    for (const [resourceId, value] of Object.entries(actor.resources)) {
      const existing = merged.get(resourceId);
      if (existing) {
        existing.defaultCurrent = Math.max(existing.defaultCurrent, value.current);
        existing.defaultMax = Math.max(existing.defaultMax, value.max);
        continue;
      }
      merged.set(resourceId, {
        id: resourceId,
        defaultCurrent: value.current,
        defaultMax: value.max
      });
    }
  }
  return Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id, 'zh-CN'));
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

function safeParseValueRows(value: JsonValue[] | JsonValue | undefined, fieldName: string): SkillValueDefinitionRow[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }
    return parseSkillValueRows(JSON.stringify(value), fieldName);
  }
  if (typeof value === 'number' || isPlainObject(value)) {
    return parseSkillValueRows(JSON.stringify([value]), fieldName);
  }
  return [];
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

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function toFiniteOptional(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

function clampNumber(value: number, min: number, max: number): number {
  if (max <= min) {
    return Math.max(min, value);
  }
  return Math.max(min, Math.min(max, value));
}

function clampLevelInput(value: unknown, maxLevel: number, fallback = 1): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, 1, maxLevel);
}

function pickFirstKey(record: Record<string, number>, keys: string[]): string | null {
  return keys.find((key) => Number.isFinite(record[key])) ?? null;
}

function findFirstNumber(record: Record<string, number>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
