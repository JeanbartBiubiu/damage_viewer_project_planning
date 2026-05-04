import {
  parseMechanicsConfig,
  parseSkillParams,
  parseSkillValueRows,
  type SkillParamVarRow,
  type SkillTriggerRow,
  type SkillValueDefinitionRow
} from '../components/skill-editor/skillModels';
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
  amount: number;
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

export type TinyGoV2EffectDefinition = {
  type: 'deal_damage';
  amount: number;
  damageType?: string;
  sourceRole?: string;
  targetRole?: string;
};

export type TinyGoV2ActionTemplate = {
  id: string;
  label?: string;
  cooldownMs?: number;
  effects?: TinyGoV2EffectDefinition[];
  resourceCost?: TinyGoV2ResourceCost[];
  panelCosts?: TinyGoV2ActionPanelCost[];
  panelEffects?: TinyGoV2ActionPanelEffect[];
};

export type TinyGoV2EngineBundle = {
  schemaVersion: number;
  attributes: TinyGoV2AttributeDefinition[];
  resources?: TinyGoV2ResourceDefinition[];
  actors: TinyGoV2ActorTemplate[];
  actions: TinyGoV2ActionTemplate[];
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
  selfSkillLevels: Record<string, number>;
  enemySkillLevels: Record<string, number>;
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
  attrs: Record<string, number>;
  resources: Record<string, TinyGoV2ResourceValue>;
  skills: ResolvedActionSkill[];
  maxHp: number;
};

type ResolvedActionSkill = WasmValidationSkillOption & {
  skill: Skill;
};

type FormulaEvalActor = {
  attrs: Record<string, number>;
  currentHp: number;
  maxHp: number;
};

type FormulaEvalContext = {
  source: FormulaEvalActor;
  target: FormulaEvalActor;
  inputValue: number;
};

type CompiledSkillEnvironment = {
  paramsRoot: JsonObject;
  symbols: Map<string, BenchmarkFormulaExpr>;
  skillLevel: number;
  championLevel: number;
  evalContext: FormulaEvalContext;
  mechanicsRows: SkillTriggerRow[];
};

const SELF_TEMPLATE_ID = 'self_template';
const ENEMY_TEMPLATE_ID = 'enemy_template';
const HERO_SKILL_ORDER = ['P', 'Q', 'W', 'E', 'R'];
const HERO_SKILL_ORDER_INDEX = new Map(HERO_SKILL_ORDER.map((key, index) => [key, index]));
const PASSIVE_SKILL_KEYS = new Set(['P', 'PASSIVE']);
const COOLDOWN_MS_MULTIPLIER = 1000;
const EPSILON = 0.0001;

const RESOURCE_CANDIDATES = [
  { id: 'mana', currentKeys: ['mana', 'mana_current', 'current_mana'], maxKeys: ['max_mana', 'mana_max', 'mana'] },
  { id: 'energy', currentKeys: ['energy', 'energy_current', 'current_energy'], maxKeys: ['max_energy', 'energy_max', 'energy'] },
  { id: 'rage', currentKeys: ['rage', 'rage_current', 'current_rage'], maxKeys: ['max_rage', 'rage_max', 'rage'] },
  { id: 'fury', currentKeys: ['fury', 'fury_current', 'current_fury'], maxKeys: ['max_fury', 'fury_max', 'fury'] },
  { id: 'focus', currentKeys: ['focus', 'focus_current', 'current_focus'], maxKeys: ['max_focus', 'focus_max', 'focus'] }
] as const;

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
    selfSkillLevels: {},
    enemySkillLevels: {},
    hpAttrKey: detectHpAttrKey(bundle.attributeDefinitions)
  };
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
  const actionTemplates = [
    ...compileActorActionTemplates(selfBase, enemyBase),
    ...compileActorActionTemplates(enemyBase, selfBase)
  ];
  const resourceDefinitions = buildResourceDefinitions([selfBase, enemyBase]);

  return {
    engineBundle: {
      schemaVersion: 1,
      attributes: attrDefinitions,
      resources: resourceDefinitions.length > 0 ? resourceDefinitions : undefined,
      actors: [buildActorTemplate(selfBase), buildActorTemplate(enemyBase)],
      actions: actionTemplates,
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
    summaries: [buildActorSummary(selfBase), buildActorSummary(enemyBase)]
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
  const hero = bundle.heroes.find((candidate) => candidate.heroId === heroId);
  if (!hero) {
    throw new Error(`Hero not found in bundle: ${heroId || '(empty)'}`);
  }

  const items = itemIds
    .map((itemId) => bundle.items.find((candidate) => candidate.itemId === itemId))
    .filter((item): item is Item => Boolean(item));
  const attrs = resolveActorAttributes(bundle, attrDefinitions, hero, itemIds, level);
  const resources = inferActorResources(attrs);
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

function buildActorSummary(actor: ResolvedActorState): ActorInputSummary {
  return {
    actorId: actor.actorId,
    templateId: actor.templateId,
    heroId: actor.hero.heroId,
    heroName: actor.hero.name ?? actor.hero.heroId,
    level: actor.level,
    itemIds: actor.itemIds,
    itemNames: actor.items.map((item) => item.name ?? item.itemId),
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
  level: number
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

function compileActorActionTemplates(source: ResolvedActorState, target: ResolvedActorState): TinyGoV2ActionTemplate[] {
  return source.skills.map((skill) => compileSkillActionTemplate(skill, source, target));
}

function compileSkillActionTemplate(
  selectedSkill: ResolvedActionSkill,
  source: ResolvedActorState,
  target: ResolvedActorState
): TinyGoV2ActionTemplate {
  const env = buildSkillEnvironment(selectedSkill, source, target);
  const panelCosts: TinyGoV2ActionPanelCost[] = [];
  const resourceCosts: TinyGoV2ResourceCost[] = [];
  const cooldownRows = safeParseValueRows(selectedSkill.skill.cooldowns, 'cooldowns');
  const resourceRows = safeParseValueRows(selectedSkill.skill.resourceCosts, 'resourceCosts');

  for (const [index, row] of resourceRows.entries()) {
    const amount = resolveValueDefinitionRow(row, env);
    const resourceId = resolveCostResourceId(row.raw, source.resources, source.attrs);
    const formulaId = resolveStableFormulaId(readString(row.raw.formulaId), selectedSkill.skillId, `cost:${index}`, row.kind === 'formula');
    panelCosts.push({
      resourceId: resourceId ?? undefined,
      formulaId,
      amount
    });

    if (!resourceId || isHpLikeResource(resourceId)) {
      continue;
    }
    if (!ensureExecutableResource(resourceId, source.resources, source.attrs)) {
      continue;
    }
    resourceCosts.push({
      resourceId,
      amount
    });
  }

  const compiledEffects = compileActionEffects(selectedSkill, env);
  const cooldownMs = cooldownRows.length > 0 ? resolveCooldownMs(resolveValueDefinitionRow(cooldownRows[0], env)) : 0;

  return {
    id: selectedSkill.actionId,
    label: selectedSkill.label,
    cooldownMs,
    effects: compiledEffects.effects.length > 0 ? compiledEffects.effects : undefined,
    resourceCost: resourceCosts.length > 0 ? resourceCosts : undefined,
    panelCosts: panelCosts.length > 0 ? panelCosts : undefined,
    panelEffects: compiledEffects.panelEffects.length > 0 ? compiledEffects.panelEffects : undefined
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
    symbols,
    skillLevel: selectedSkill.level,
    championLevel: source.level,
    evalContext: {
      source: {
        attrs: source.attrs,
        currentHp: source.maxHp,
        maxHp: source.maxHp
      },
      target: {
        attrs: target.attrs,
        currentHp: target.maxHp,
        maxHp: target.maxHp
      },
      inputValue: 0
    },
    mechanicsRows: mechanics.rows
  };
}

function compileActionEffects(
  selectedSkill: ResolvedActionSkill,
  env: CompiledSkillEnvironment
): { effects: TinyGoV2EffectDefinition[]; panelEffects: TinyGoV2ActionPanelEffect[] } {
  const effects: TinyGoV2EffectDefinition[] = [];
  const panelEffects: TinyGoV2ActionPanelEffect[] = [];
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
        const amount = resolveFormulaText(action.formulaText, env);
        const sourceRole = normalizeActionRole(action.damageSource, 'source');
        const targetRole = normalizeActionRole(action.damageTarget, 'target');
        effects.push({
          type: 'deal_damage',
          amount,
          damageType: action.damageType || undefined,
          sourceRole,
          targetRole
        });
        panelEffects.push({
          effectIndex,
          kind: 'deal_damage',
          label: trigger.id || selectedSkill.label,
          formulaId: resolveStableFormulaId('', selectedSkill.skillId, `effect:${effectIndex}`, hasFormulaText(action.formulaText)),
          amount,
          damageType: action.damageType || undefined,
          sourceRole,
          targetRole
        });
        effectIndex += 1;
        continue;
      }

      if (action.type === 'apply_modifier') {
        for (const stat of action.stats) {
          const amount = resolveFormulaText(stat.formulaText, env);
          panelEffects.push({
            effectIndex,
            kind: 'apply_modifier',
            label: `${trigger.id || selectedSkill.label}:${stat.op}`,
            formulaId: resolveStableFormulaId('', selectedSkill.skillId, `effect:${effectIndex}`, hasFormulaText(stat.formulaText)),
            amount,
            attrId: stat.key || undefined,
            targetRole: normalizeActionRole(action.modifierTarget, 'source')
          });
          effectIndex += 1;
        }
        continue;
      }

      if (action.type === 'schedule_tick') {
        const tickTrigger = tickTriggers.get(action.tickKey);
        if (!tickTrigger) {
          panelEffects.push({
            effectIndex,
            kind: 'schedule_tick',
            label: action.tickKey || trigger.id || selectedSkill.label,
            amount: action.times
          });
          effectIndex += 1;
          continue;
        }
        const times = Math.max(1, action.times);
        for (const tickAction of tickTrigger.actions) {
          if (tickAction.type === 'deal_damage') {
            const amount = resolveFormulaText(tickAction.formulaText, env) * times;
            panelEffects.push({
              effectIndex,
              kind: 'deal_damage',
              label: `${tickTrigger.id || action.tickKey} x${times}`,
              formulaId: resolveStableFormulaId('', selectedSkill.skillId, `effect:${effectIndex}`, hasFormulaText(tickAction.formulaText)),
              amount,
              damageType: tickAction.damageType || undefined,
              sourceRole: normalizeActionRole(tickAction.damageSource, 'source'),
              targetRole: normalizeActionRole(tickAction.damageTarget, 'target')
            });
            effectIndex += 1;
            continue;
          }
          if (tickAction.type === 'apply_modifier') {
            for (const stat of tickAction.stats) {
              const amount = resolveFormulaText(stat.formulaText, env) * times;
              panelEffects.push({
                effectIndex,
                kind: 'apply_modifier',
                label: `${tickTrigger.id || action.tickKey}:${stat.op} x${times}`,
                formulaId: resolveStableFormulaId('', selectedSkill.skillId, `effect:${effectIndex}`, hasFormulaText(stat.formulaText)),
                amount,
                attrId: stat.key || undefined,
                targetRole: normalizeActionRole(tickAction.modifierTarget, 'source')
              });
              effectIndex += 1;
            }
          }
        }
      }
    }
  }

  return { effects, panelEffects };
}

function resolveValueDefinitionRow(row: SkillValueDefinitionRow, env: CompiledSkillEnvironment): number {
  if (row.kind === 'table') {
    if (row.values.length === 0) {
      return 0;
    }
    const indexBase = row.by === 'championLevel' ? env.championLevel : env.skillLevel;
    return toNumber(row.values[clamp(indexBase, 1, row.values.length) - 1], 0);
  }
  if (row.kind === 'formula') {
    return resolveFormulaText(row.formulaText, env);
  }
  return toNumber(row.value, 0);
}

function resolveFormulaText(formulaText: string, env: CompiledSkillEnvironment): number {
  if (!hasFormulaText(formulaText)) {
    return 0;
  }
  const expr = compileFormulaText(formulaText, undefined, env.symbols);
  return evaluateFormulaExpr(expr, env.evalContext);
}

function evaluateFormulaExpr(expr: BenchmarkFormulaExpr, context: FormulaEvalContext): number {
  switch (expr.type) {
    case 'constant':
      return toNumber(expr.value, 0);
    case 'actor_attr':
      return readActorAttr(expr.actor, expr.attrKey, context);
    case 'actor_hp_current':
      return readActorRef(expr.actor, context).currentHp;
    case 'actor_hp_max':
      return readActorRef(expr.actor, context).maxHp;
    case 'add':
      return expr.terms.reduce((sum, term) => sum + evaluateFormulaExpr(term, context), 0);
    case 'multiply':
      return expr.factors.reduce((product, factor) => product * evaluateFormulaExpr(factor, context), 1);
    case 'subtract':
      return evaluateFormulaExpr(expr.left, context) - evaluateFormulaExpr(expr.right, context);
    case 'divide': {
      const denominator = evaluateFormulaExpr(expr.denominator, context);
      if (Math.abs(denominator) < EPSILON) {
        return 0;
      }
      return evaluateFormulaExpr(expr.numerator, context) / denominator;
    }
    case 'max':
      return expr.operands.reduce((current, operand) => Math.max(current, evaluateFormulaExpr(operand, context)), Number.NEGATIVE_INFINITY);
    case 'min':
      return expr.operands.reduce((current, operand) => Math.min(current, evaluateFormulaExpr(operand, context)), Number.POSITIVE_INFINITY);
    case 'negate':
      return -evaluateFormulaExpr(expr.operand, context);
    case 'input_value':
      return context.inputValue;
    default:
      return 0;
  }
}

function readActorRef(actor: FormulaActorRef, context: FormulaEvalContext): FormulaEvalActor {
  if (actor === 'target' || actor === 'enemy') {
    return context.target;
  }
  return context.source;
}

function readActorAttr(actor: FormulaActorRef, attrKey: string, context: FormulaEvalContext): number {
  const value = readActorRef(actor, context).attrs[attrKey];
  return toNumber(value, 0);
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
  const inferred = inferActorResources(attrs);
  const inferredIds = Object.keys(inferred);
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

function resolveStableFormulaId(explicitId: string, skillId: string, suffix: string, derived: boolean): string | undefined {
  if (explicitId.trim()) {
    return explicitId.trim();
  }
  if (!derived) {
    return undefined;
  }
  return `${skillId}::${suffix}`;
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

function mergeNumberMap(target: Record<string, number>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    result[key] = toNumber(value, 0);
  }
  return result;
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

function safeParseValueRows(value: JsonValue[] | undefined, fieldName: string): SkillValueDefinitionRow[] {
  if (!value || value.length === 0) {
    return [];
  }
  return parseSkillValueRows(JSON.stringify(value), fieldName);
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

function hasFormulaText(value: string): boolean {
  return value.trim().length > 0;
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
