import type { JsonObject, JsonValue } from '../../types/api';
import { parseJsonArrayText, parseJsonObjectText, stringifyJson } from '../../pages/admin/resources/shared/json';

export type SkillValueKind = 'const' | 'table' | 'formula';
export type SkillParamVarKind = 'const' | 'table' | 'scaled_attr' | 'formula' | 'mapping_scaled_attr';
export type SkillActionType = 'deal_damage' | 'schedule_tick' | 'apply_modifier' | '__raw__';
export type SkillValueDefinitionKind = SkillValueKind;

export type SkillValueDefinitionRow = {
  raw: JsonObject;
  kind: SkillValueKind;
  by: string;
  value: number;
  values: number[];
  bindingKey: string;
};

export type SkillFlatParamsForm = {
  damageType: string;
  baseDamage: string;
  baseDamageBySkillLevel: string;
  attackRatio: string;
  adRatio: string;
  apRatio: string;
  bonusAttackSpeedRatio: string;
  hitCount: string;
  hitIntervalMs: string;
  channelDurationMs: string;
  defaultSkillLevel: string;
};

export type SkillParamVarRow = {
  key: string;
  raw: JsonObject;
  fallbackText: string;
  label: string;
  kind: SkillParamVarKind;
  by: string;
  value: number;
  values: number[];
  attr: string;
  coefficient: number;
  selector: string;
  formulaText: string;
  formulaVars: string[];
};

export type SkillTimingPhaseRow = {
  raw: JsonObject;
  phaseKey: string;
  kind: string;
  durationMs: number;
  interruptible: boolean;
  cancelScheduledOnInterrupt: boolean;
};

export type SkillModifierStatRow = {
  raw: JsonObject;
  key: string;
  op: string;
  bindingKey: string;
};

export type SkillStackRow = {
  raw: JsonObject;
  id: string;
  name: string;
  max: number;
  timeoutMs: number;
  resetOn: string[];
};

export type SkillActionRow =
  | {
      raw: JsonObject;
      type: 'deal_damage';
      rawType: string;
      damageSource: string;
      damageTarget: string;
      damageType: string;
      bindingKey: string;
    }
  | {
      raw: JsonObject;
      type: 'schedule_tick';
      rawType: string;
      tickKey: string;
      everyMs: number;
      times: number;
    }
  | {
      raw: JsonObject;
      type: 'apply_modifier';
      rawType: string;
      modifierTarget: string;
      durationMs: number;
      stackingMode: string;
      stats: SkillModifierStatRow[];
    }
  | {
      raw: JsonObject;
      type: '__raw__';
      rawType: string;
    };

export type SkillTriggerRow = {
  raw: JsonObject;
  id: string;
  eventType: string;
  eventTickKey: string;
  eventStackId: string;
  actions: SkillActionRow[];
};

const LEGACY_FLAT_PARAM_KEYS = [
  'damageType',
  'baseDamage',
  'baseDamageBySkillLevel',
  'attackRatio',
  'adRatio',
  'apRatio',
  'bonusAttackSpeedRatio',
  'hitCount',
  'hitIntervalMs',
  'channelDurationMs',
  'defaultSkillLevel'
] as const;

export function createEmptyValueDefinitionRow(kind: SkillValueKind = 'const'): SkillValueDefinitionRow {
  return {
    raw: {},
    kind,
    by: 'skillLevel',
    value: 0,
    values: [],
    bindingKey: ''
  };
}

export function parseSkillValueRows(text: string, fieldName: string): SkillValueDefinitionRow[] {
  const parsed = parseJsonArrayText(text, fieldName);
  return parsed.map((entry, index) => parseValueDefinitionRow(entry, fieldName, index));
}

export function stringifySkillValueRows(rows: SkillValueDefinitionRow[]): string {
  return stringifyJson(
    rows.map((row) => {
      const raw = clonePlainObject(row.raw);
      raw.kind = row.kind;

      if (row.kind === 'const') {
        raw.value = normalizeNumber(row.value);
        delete raw.by;
        delete raw.values;
        delete raw.bindingKey;
      } else if (row.kind === 'table') {
        raw.by = row.by.trim() || 'skillLevel';
        raw.values = normalizeNumberArray(row.values);
        delete raw.value;
        delete raw.bindingKey;
      } else {
        raw.bindingKey = row.bindingKey.trim();
        delete raw.value;
        delete raw.by;
        delete raw.values;
      }

      return raw;
    })
  );
}

export function createEmptyFlatSkillParamsForm(): SkillFlatParamsForm {
  return {
    damageType: '',
    baseDamage: '',
    baseDamageBySkillLevel: '',
    attackRatio: '',
    adRatio: '',
    apRatio: '',
    bonusAttackSpeedRatio: '',
    hitCount: '',
    hitIntervalMs: '',
    channelDurationMs: '',
    defaultSkillLevel: ''
  };
}

export function parseFlatSkillParams(text: string): { root: JsonObject; form: SkillFlatParamsForm } {
  const root = parseJsonObjectText(text, 'params');
  return {
    root,
    form: {
      damageType: asText(root.damageType),
      baseDamage: toEditableNumber(root.baseDamage),
      baseDamageBySkillLevel: toEditableNumberList(root.baseDamageBySkillLevel),
      attackRatio: toEditableNumber(root.attackRatio),
      adRatio: toEditableNumber(root.adRatio),
      apRatio: toEditableNumber(root.apRatio),
      bonusAttackSpeedRatio: toEditableNumber(root.bonusAttackSpeedRatio),
      hitCount: toEditableNumber(root.hitCount),
      hitIntervalMs: toEditableNumber(root.hitIntervalMs),
      channelDurationMs: toEditableNumber(root.channelDurationMs),
      defaultSkillLevel: toEditableNumber(root.defaultSkillLevel)
    }
  };
}

export function stringifyFlatSkillParams(baseRoot: JsonObject, form: SkillFlatParamsForm): string {
  const next: JsonObject = { ...baseRoot };
  updateOptionalString(next, 'damageType', form.damageType);
  updateOptionalNumber(next, 'baseDamage', form.baseDamage);
  updateOptionalNumberArray(next, 'baseDamageBySkillLevel', form.baseDamageBySkillLevel);
  updateOptionalNumber(next, 'attackRatio', form.attackRatio);
  updateOptionalNumber(next, 'adRatio', form.adRatio);
  updateOptionalNumber(next, 'apRatio', form.apRatio);
  updateOptionalNumber(next, 'bonusAttackSpeedRatio', form.bonusAttackSpeedRatio);
  updateOptionalNumber(next, 'hitCount', form.hitCount);
  updateOptionalNumber(next, 'hitIntervalMs', form.hitIntervalMs);
  updateOptionalNumber(next, 'channelDurationMs', form.channelDurationMs);
  updateOptionalNumber(next, 'defaultSkillLevel', form.defaultSkillLevel);
  return stringifyJson(next);
}

export function createEmptyParamVarRow(kind: SkillParamVarKind = 'const', existingKeys: string[] = []): SkillParamVarRow {
  return {
    key: suggestUniqueKey('param', existingKeys),
    raw: {},
    fallbackText: '{\n  \n}',
    label: '',
    kind,
    by: 'skillLevel',
    value: 0,
    values: [],
    attr: '',
    coefficient: 0,
    selector: '',
    formulaText: '',
    formulaVars: []
  };
}

export function parseSkillParams(text: string): { root: JsonObject; rows: SkillParamVarRow[]; hasLegacyFlatParams: boolean } {
  const root = parseJsonObjectText(text, 'params');
  const vars = isPlainObject(root.vars) ? root.vars : {};
  const rows = Object.entries(vars).map(([key, value]) => parseParamVarRow(key, value));

  return {
    root,
    rows,
    hasLegacyFlatParams: LEGACY_FLAT_PARAM_KEYS.some((key) => root[key] !== undefined)
  };
}

export function stringifySkillParams(baseRoot: JsonObject, rows: SkillParamVarRow[]): string {
  const next: JsonObject = { ...baseRoot };
  const vars: JsonObject = {};

    rows.forEach((row) => {
    const key = row.key.trim();
    if (!key) {
      return;
    }

    const raw = row.kind === 'mapping_scaled_attr' ? parseFallbackJsonObject(row.fallbackText, row.raw) : clonePlainObject(row.raw);
    updateOptionalString(raw, 'label', row.label);
    raw.kind = row.kind;

    if (row.kind === 'const') {
      raw.value = normalizeNumber(row.value);
      delete raw.by;
      delete raw.values;
      delete raw.attr;
      delete raw.coefficient;
      delete raw.selector;
      delete raw.formulaText;
      delete raw.formulaVars;
    } else if (row.kind === 'table') {
      raw.by = row.by.trim() || 'skillLevel';
      raw.values = normalizeNumberArray(row.values);
      delete raw.value;
      delete raw.attr;
      delete raw.coefficient;
      delete raw.selector;
      delete raw.formulaText;
      delete raw.formulaVars;
    } else if (row.kind === 'scaled_attr') {
      updateOptionalString(raw, 'attr', row.attr);
      raw.coefficient = normalizeNumber(row.coefficient);
      delete raw.value;
      delete raw.by;
      delete raw.values;
      delete raw.selector;
      delete raw.formulaText;
      delete raw.formulaVars;
    } else if (row.kind === 'formula') {
      updateOptionalString(raw, 'formulaText', row.formulaText);
      updateOptionalStringArray(raw, 'formulaVars', row.formulaVars);
      delete raw.value;
      delete raw.by;
      delete raw.values;
      delete raw.attr;
      delete raw.coefficient;
      delete raw.selector;
    } else {
      updateOptionalString(raw, 'selector', row.selector);
      updateOptionalString(raw, 'attr', row.attr);
      raw.coefficient = normalizeNumber(row.coefficient);
      delete raw.value;
      delete raw.by;
      delete raw.values;
      delete raw.formulaText;
      delete raw.formulaVars;
    }

    vars[key] = raw;
  });

  next.vars = vars;
  return stringifyJson(next);
}

export function parseParamVarJson(key: string, text: string): SkillParamVarRow {
  const parsed = parseJsonObjectText(text, `params.vars.${key}`);
  return parseParamVarRow(key, parsed);
}

export function createEmptyTimingPhaseRow(): SkillTimingPhaseRow {
  return {
    raw: {},
    phaseKey: '',
    kind: 'cast',
    durationMs: 0,
    interruptible: false,
    cancelScheduledOnInterrupt: false
  };
}

export function parseTimingProfile(text: string): { root: JsonObject; rows: SkillTimingPhaseRow[] } {
  const root = parseJsonObjectText(text, 'timingProfile');
  const phases = Array.isArray(root.phases) ? root.phases : [];

  return {
    root,
    rows: phases.filter(isPlainObject).map((phase) => ({
      raw: clonePlainObject(phase),
      phaseKey: asText(phase.phaseKey),
      kind: asText(phase.kind) || 'cast',
      durationMs: normalizeNumber(phase.durationMs),
      interruptible: Boolean(phase.interruptible),
      cancelScheduledOnInterrupt: Boolean(phase.cancelScheduledOnInterrupt)
    }))
  };
}

export function stringifyTimingProfile(baseRoot: JsonObject, rows: SkillTimingPhaseRow[]): string {
  const next: JsonObject = { ...baseRoot };
  next.phases = rows.map((row) => {
    const raw = clonePlainObject(row.raw);
    updateOptionalString(raw, 'phaseKey', row.phaseKey);
    raw.kind = row.kind || 'cast';
    raw.durationMs = normalizeNumber(row.durationMs);
    raw.interruptible = Boolean(row.interruptible);
    raw.cancelScheduledOnInterrupt = Boolean(row.cancelScheduledOnInterrupt);
    return raw;
  });
  return stringifyJson(next);
}

export function createEmptyStackRow(existingIds: string[] = []): SkillStackRow {
  return {
    raw: {},
    id: suggestUniqueKey('stack', existingIds),
    name: '',
    max: 1,
    timeoutMs: 0,
    resetOn: []
  };
}

export function createEmptyModifierStatRow(): SkillModifierStatRow {
  return {
    raw: {},
    key: '',
    op: 'add',
    bindingKey: ''
  };
}

export function createEmptyActionRow(type: SkillActionType = 'deal_damage'): SkillActionRow {
  if (type === 'schedule_tick') {
    return {
      raw: {},
      type,
      rawType: 'schedule_tick',
      tickKey: '',
      everyMs: 1000,
      times: 1
    };
  }

  if (type === 'apply_modifier') {
    return {
      raw: {},
      type,
      rawType: 'apply_modifier',
      modifierTarget: 'self',
      durationMs: 0,
      stackingMode: 'refresh',
      stats: [createEmptyModifierStatRow()]
    };
  }

  if (type === '__raw__') {
    return {
      raw: { type: 'custom_action' },
      type,
      rawType: 'custom_action'
    };
  }

  return {
    raw: {},
    type: 'deal_damage',
    rawType: 'deal_damage',
    damageSource: 'self',
    damageTarget: 'enemy',
    damageType: 'magic',
    bindingKey: ''
  };
}

export function createEmptyTriggerRow(existingIds: string[] = []): SkillTriggerRow {
  return {
    raw: {},
    id: suggestUniqueKey('trigger', existingIds),
    eventType: 'on_spell_cast',
    eventTickKey: '',
    eventStackId: '',
    actions: [createEmptyActionRow()]
  };
}

export function createEmptyMechanicsConfig(): string {
  return stringifyJson({ version: 1, stacks: [], triggers: [] });
}

export function parseMechanicsConfig(text: string): { root: JsonObject; version: number; stacks: SkillStackRow[]; rows: SkillTriggerRow[] } {
  const root = parseJsonObjectText(text, 'mechanicsConfig');
  const version = typeof root.version === 'number' ? normalizeNumber(root.version) : 1;
  const rawStacks = Array.isArray(root.stacks) ? root.stacks : [];
  const rawTriggers = Array.isArray(root.triggers) ? root.triggers : [];

  return {
    root,
    version,
    stacks: rawStacks.filter(isPlainObject).map(parseStackRow),
    rows: rawTriggers.filter(isPlainObject).map(parseTriggerRow)
  };
}

export function stringifyMechanicsConfig(baseRoot: JsonObject, version: number, stacks: SkillStackRow[], rows: SkillTriggerRow[]): string {
  const next: JsonObject = { ...baseRoot };
  next.version = normalizeInteger(version || 1, 1);
  next.stacks = stacks.map(stringifyStackRow);
  next.triggers = rows.map(stringifyTriggerRow);
  return stringifyJson(next);
}

export function parseActionJson(text: string): SkillActionRow {
  const parsed = parseJsonObjectText(text, 'action');
  return parseActionRow(parsed);
}

export function inferSkillShapeSummary(params: JsonObject | undefined, mechanicsConfig: JsonObject | undefined): string {
  const hasFlat = Boolean(params && LEGACY_FLAT_PARAM_KEYS.some((key) => params[key] !== undefined));
  const hasVars = Boolean(params && isPlainObject(params.vars) && Object.keys(params.vars).length > 0);
  const hasDsl = Boolean(mechanicsConfig && Array.isArray(mechanicsConfig.triggers) && mechanicsConfig.triggers.length > 0);

  if ((hasFlat && hasVars) || (hasFlat && hasDsl)) {
    return 'Mixed';
  }
  if (hasDsl || hasVars) {
    return 'DSL';
  }
  if (hasFlat) {
    return 'Flat';
  }
  return 'Basic';
}

function parseValueDefinitionRow(entry: JsonValue, fieldName: string, index: number): SkillValueDefinitionRow {
  if (typeof entry === 'number') {
    return { raw: {}, kind: 'const', by: 'skillLevel', value: normalizeNumber(entry), values: [], bindingKey: '' };
  }

  if (!isPlainObject(entry)) {
    throw new Error(`${fieldName}[${index}] 必须是对象或数字。`);
  }

  const kind = normalizeValueKind(entry);
  if (kind === 'table') {
    return {
      raw: clonePlainObject(entry),
      kind,
      by: asText(entry.by) || 'skillLevel',
      value: 0,
      values: normalizeNumberArray(Array.isArray(entry.values) ? entry.values : []),
      bindingKey: ''
    };
  }

  if (kind === 'formula') {
    return {
      raw: clonePlainObject(entry),
      kind,
      by: 'skillLevel',
      value: 0,
      values: [],
      bindingKey: asText(entry.bindingKey)
    };
  }

  return {
    raw: clonePlainObject(entry),
    kind: 'const',
    by: 'skillLevel',
    value: normalizeNumber(entry.value),
    values: [],
    bindingKey: ''
  };
}

function parseParamVarRow(key: string, value: unknown): SkillParamVarRow {
  const raw = clonePlainObject(value);
  const kind = normalizeParamVarKind(raw);

  return {
    key,
    raw,
    fallbackText: stringifyJson(raw),
    label: asText(raw.label),
    kind,
    by: asText(raw.by) || 'skillLevel',
    value: normalizeNumber(raw.value),
    values: normalizeNumberArray(Array.isArray(raw.values) ? raw.values : []),
    attr: asText(raw.attr),
    coefficient: normalizeNumber(raw.coefficient),
    selector: asText(raw.selector),
    formulaText: asText(raw.formulaText),
    formulaVars: normalizeStringArray(raw.formulaVars)
  };
}

function parseStackRow(value: JsonObject): SkillStackRow {
  return {
    raw: clonePlainObject(value),
    id: asText(value.id),
    name: asText(value.name),
    max: normalizeInteger(value.max, 1),
    timeoutMs: normalizeInteger(value.timeoutMs, 0),
    resetOn: normalizeStringArray(value.resetOn)
  };
}

function stringifyStackRow(row: SkillStackRow): JsonObject {
  const raw = clonePlainObject(row.raw);
  updateOptionalString(raw, 'id', row.id);
  updateOptionalString(raw, 'name', row.name);
  raw.max = normalizeInteger(row.max, 1);
  if (row.timeoutMs > 0) {
    raw.timeoutMs = normalizeInteger(row.timeoutMs, 0);
  } else {
    delete raw.timeoutMs;
  }
  updateOptionalStringArray(raw, 'resetOn', row.resetOn);
  return raw;
}

function parseTriggerRow(value: JsonObject): SkillTriggerRow {
  const event = isPlainObject(value.event) ? value.event : {};
  const actions = Array.isArray(value.actions) ? value.actions.filter(isPlainObject).map(parseActionRow) : [];

  return {
    raw: clonePlainObject(value),
    id: asText(value.id),
    eventType: asText(event.type) || 'on_spell_cast',
    eventTickKey: asText(event.tickKey),
    eventStackId: asText(event.stackId),
    actions
  };
}

function stringifyTriggerRow(row: SkillTriggerRow): JsonObject {
  const raw = clonePlainObject(row.raw);
  const rawEvent = clonePlainObject(raw.event);

  updateOptionalString(raw, 'id', row.id);
  rawEvent.type = row.eventType || 'on_spell_cast';
  if (row.eventType === 'on_tick') {
    updateOptionalString(rawEvent, 'tickKey', row.eventTickKey);
    delete rawEvent.stackId;
  } else if (row.eventType === 'on_stack_change') {
    updateOptionalString(rawEvent, 'stackId', row.eventStackId);
    delete rawEvent.tickKey;
  } else {
    delete rawEvent.tickKey;
    delete rawEvent.stackId;
  }

  raw.event = rawEvent;
  raw.actions = row.actions.map(stringifyActionRow);
  return raw;
}

function parseActionRow(value: JsonObject): SkillActionRow {
  const type = asText(value.type);

  if (type === 'deal_damage') {
    const damage = clonePlainObject(value.damage);
    return {
      raw: clonePlainObject(value),
      type,
      rawType: type,
      damageSource: asText(damage.source) || asText(value.damageSource) || 'self',
      damageTarget: asText(damage.target) || asText(value.damageTarget) || 'enemy',
      damageType: asText(damage.damageType) || asText(value.damageType) || 'magic',
      bindingKey: asText(damage.bindingKey) || asText(value.bindingKey)
    };
  }

  if (type === 'schedule_tick') {
    return {
      raw: clonePlainObject(value),
      type,
      rawType: type,
      tickKey: asText(value.tickKey),
      everyMs: normalizeInteger(value.everyMs, 1000),
      times: normalizeInteger(value.times, 1)
    };
  }

  if (type === 'apply_modifier') {
    const modifier = clonePlainObject(value.modifier);
    const stats = Array.isArray(modifier.stats) ? modifier.stats.filter(isPlainObject).map(parseModifierStatRow) : [];
    const stacking = clonePlainObject(modifier.stacking);
    return {
      raw: clonePlainObject(value),
      type,
      rawType: type,
      modifierTarget: asText(modifier.target) || 'self',
      durationMs: normalizeInteger(modifier.durationMs, 0),
      stackingMode: asText(stacking.mode) || 'refresh',
      stats
    };
  }

  return {
    raw: clonePlainObject(value),
    type: '__raw__',
    rawType: type || 'custom_action'
  };
}

function stringifyActionRow(action: SkillActionRow): JsonObject {
  const raw = clonePlainObject(action.raw);

  if (action.type === '__raw__') {
    return raw;
  }

  raw.type = action.rawType || action.type;

  if (action.type === 'deal_damage') {
    const damage = clonePlainObject(raw.damage);
    damage.source = action.damageSource || 'self';
    damage.target = action.damageTarget || 'enemy';
    damage.damageType = action.damageType || 'magic';
    updateOptionalString(damage, 'bindingKey', action.bindingKey);
    delete damage.formulaText;
    delete damage.formulaVars;
    raw.damage = damage;
    delete raw.tickKey;
    delete raw.everyMs;
    delete raw.times;
    delete raw.modifier;
    return raw;
  }

  if (action.type === 'schedule_tick') {
    updateOptionalString(raw, 'tickKey', action.tickKey);
    raw.everyMs = normalizeInteger(action.everyMs, 1000);
    raw.times = normalizeInteger(action.times, 1);
    delete raw.damage;
    delete raw.modifier;
    return raw;
  }

  const modifier = clonePlainObject(raw.modifier);
  const stacking = clonePlainObject(modifier.stacking);
  modifier.target = action.modifierTarget || 'self';
  if (action.durationMs > 0) {
    modifier.durationMs = normalizeInteger(action.durationMs, 0);
  } else {
    delete modifier.durationMs;
  }
  stacking.mode = action.stackingMode || 'refresh';
  modifier.stacking = stacking;
  modifier.stats = action.stats.map(stringifyModifierStatRow);
  raw.modifier = modifier;
  delete raw.damage;
  delete raw.tickKey;
  delete raw.everyMs;
  delete raw.times;
  return raw;
}

function parseModifierStatRow(value: JsonObject): SkillModifierStatRow {
  return {
    raw: clonePlainObject(value),
    key: asText(value.key),
    op: asText(value.op) || 'add',
    bindingKey: asText(value.bindingKey)
  };
}

function stringifyModifierStatRow(row: SkillModifierStatRow): JsonObject {
  const raw = clonePlainObject(row.raw);
  updateOptionalString(raw, 'key', row.key);
  raw.op = row.op || 'add';
  updateOptionalString(raw, 'bindingKey', row.bindingKey);
  delete raw.formulaText;
  delete raw.formulaVars;
  return raw;
}

function normalizeValueKind(value: JsonObject): SkillValueKind {
  const kind = asText(value.kind);
  if (kind === 'table' || kind === 'formula') {
    return kind;
  }
  if (kind === 'const') {
    return 'const';
  }
  if (asText(value.bindingKey)) {
    return 'formula';
  }
  if (Array.isArray(value.values)) {
    return 'table';
  }
  return 'const';
}

function normalizeParamVarKind(value: JsonObject): SkillParamVarKind {
  const kind = asText(value.kind);
  if (
    kind === 'const' ||
    kind === 'table' ||
    kind === 'scaled_attr' ||
    kind === 'formula' ||
    kind === 'mapping_scaled_attr'
  ) {
    return kind;
  }
  if (asText(value.selector)) {
    return 'mapping_scaled_attr';
  }
  if (asText(value.attr)) {
    return 'scaled_attr';
  }
  if (asText(value.formulaText)) {
    return 'formula';
  }
  if (Array.isArray(value.values)) {
    return 'table';
  }
  return 'const';
}

function suggestUniqueKey(prefix: string, existingKeys: string[]): string {
  const existing = new Set(existingKeys.filter(Boolean));
  let next = 1;
  while (existing.has(`${prefix}_${next}`)) {
    next += 1;
  }
  return `${prefix}_${next}`;
}

function clonePlainObject(value: unknown): JsonObject {
  return isPlainObject(value) ? { ...(value as JsonObject) } : {};
}

function parseFallbackJsonObject(text: string, fallback: JsonObject): JsonObject {
  const trimmed = text.trim();
  if (!trimmed) {
    return clonePlainObject(fallback);
  }

  try {
    return parseJsonObjectText(trimmed, 'fallback');
  } catch {
    return clonePlainObject(fallback);
  }
}

function updateOptionalString(target: JsonObject, key: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) {
    target[key] = trimmed;
    return;
  }
  delete target[key];
}

function updateOptionalStringArray(target: JsonObject, key: string, value: string[] | string) {
  const normalized = Array.isArray(value)
    ? normalizeStringArray(value)
    : value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
  if (normalized.length > 0) {
    target[key] = normalized;
    return;
  }
  delete target[key];
}

function updateOptionalNumber(target: JsonObject, key: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    delete target[key];
    return;
  }
  target[key] = normalizeNumber(trimmed);
}

function updateOptionalNumberArray(target: JsonObject, key: string, value: string) {
  const normalized = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => normalizeNumber(entry));
  if (normalized.length > 0) {
    target[key] = normalized;
    return;
  }
  delete target[key];
}

function toEditableNumber(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : '';
}

function toEditableNumberList(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }
  return value.map((entry) => normalizeNumber(entry)).join(', ');
}

function normalizeNumberArray(values: JsonValue[] | number[]): number[] {
  return values.map((value) => normalizeNumber(value));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function normalizeNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeInteger(value: unknown, fallback = 0): number {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
