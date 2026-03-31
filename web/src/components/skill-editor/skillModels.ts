import type { JsonObject, JsonValue } from '../../types/api';
import { parseJsonArrayText, parseJsonObjectText, stringifyJson } from '../../pages/admin/resources/shared/json';

export type SkillSeriesRow = {
  raw: JsonObject;
  kind: 'const' | 'table';
  by: string;
  value: number;
  values: number[];
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

export type SkillTimingPhaseRow = {
  raw: JsonObject;
  phaseKey: string;
  kind: string;
  durationMs: number;
  interruptible: boolean;
  cancelScheduledOnInterrupt: boolean;
};

export type SkillActionRow = {
  raw: JsonObject;
  type: string;
  damageType: string;
  formulaText: string;
  formulaVarsText: string;
  tickKey: string;
  everyMs: number;
  times: number;
};

export type SkillTriggerRow = {
  raw: JsonObject;
  id: string;
  eventType: string;
  eventTickKey: string;
  actions: SkillActionRow[];
};

export function createEmptySeriesRow(): SkillSeriesRow {
  return {
    raw: {},
    kind: 'const',
    by: 'skillLevel',
    value: 0,
    values: []
  };
}

export function parseSkillSeriesRows(text: string, fieldName: string): SkillSeriesRow[] {
  const parsed = parseJsonArrayText(text, fieldName);
  return parsed.map((entry, index) => parseSkillSeriesRow(entry, fieldName, index));
}

export function stringifySkillSeriesRows(rows: SkillSeriesRow[]): string {
  const result = rows.map((row) => {
    const raw = isPlainObject(row.raw) ? { ...row.raw } : {};
    if (row.kind === 'table') {
      delete raw.value;
      raw.kind = 'table';
      raw.by = row.by.trim() || 'skillLevel';
      raw.values = normalizeNumberArray(row.values);
      return raw;
    }

    delete raw.by;
    delete raw.values;
    raw.kind = 'const';
    raw.value = normalizeNumber(row.value);
    return raw;
  });

  return stringifyJson(result);
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
  const phases = root.phases;
  if (phases === undefined) {
    return { root, rows: [] };
  }
  if (!Array.isArray(phases)) {
    throw new Error('timingProfile.phases 必须是数组。');
  }

  return {
    root,
    rows: phases.map((phase, index) => {
      if (!isPlainObject(phase)) {
        throw new Error(`timingProfile.phases[${index}] 必须是对象。`);
      }
      return {
        raw: { ...phase },
        phaseKey: asText(phase.phaseKey),
        kind: asText(phase.kind) || 'cast',
        durationMs: normalizeNumber(phase.durationMs),
        interruptible: Boolean(phase.interruptible),
        cancelScheduledOnInterrupt: Boolean(phase.cancelScheduledOnInterrupt)
      };
    })
  };
}

export function stringifyTimingProfile(baseRoot: JsonObject, rows: SkillTimingPhaseRow[]): string {
  const next: JsonObject = { ...baseRoot };
  next.phases = rows.map((row) => {
    const raw = isPlainObject(row.raw) ? { ...row.raw } : {};
    updateOptionalString(raw, 'phaseKey', row.phaseKey);
    updateOptionalString(raw, 'kind', row.kind || 'cast');
    raw.durationMs = normalizeNumber(row.durationMs);
    raw.interruptible = Boolean(row.interruptible);
    raw.cancelScheduledOnInterrupt = Boolean(row.cancelScheduledOnInterrupt);
    return raw;
  });
  return stringifyJson(next);
}

export function createEmptyActionRow(): SkillActionRow {
  return {
    raw: {},
    type: 'deal_damage',
    damageType: 'magic',
    formulaText: '',
    formulaVarsText: '',
    tickKey: '',
    everyMs: 1000,
    times: 1
  };
}

export function createEmptyTriggerRow(): SkillTriggerRow {
  return {
    raw: {},
    id: '',
    eventType: 'on_spell_cast',
    eventTickKey: '',
    actions: [createEmptyActionRow()]
  };
}

export function createEmptyMechanicsConfig(): string {
  return stringifyJson({ version: 1, triggers: [] });
}

export function parseMechanicsConfig(text: string): { root: JsonObject; version: number; rows: SkillTriggerRow[] } {
  const root = parseJsonObjectText(text, 'mechanicsConfig');
  const version = typeof root.version === 'number' ? normalizeNumber(root.version) : 1;
  const triggers = root.triggers;
  if (triggers === undefined) {
    return { root, version, rows: [] };
  }
  if (!Array.isArray(triggers)) {
    throw new Error('mechanicsConfig.triggers 必须是数组。');
  }

  return {
    root,
    version,
    rows: triggers.map((trigger, triggerIndex) => {
      if (!isPlainObject(trigger)) {
        throw new Error(`mechanicsConfig.triggers[${triggerIndex}] 必须是对象。`);
      }
      if (!isPlainObject(trigger.event)) {
        throw new Error(`mechanicsConfig.triggers[${triggerIndex}].event 必须是对象。`);
      }
      const actions = trigger.actions;
      if (!Array.isArray(actions)) {
        throw new Error(`mechanicsConfig.triggers[${triggerIndex}].actions 必须是数组。`);
      }

      return {
        raw: { ...trigger },
        id: asText(trigger.id),
        eventType: asText((trigger.event as JsonObject).type) || 'on_spell_cast',
        eventTickKey: asText((trigger.event as JsonObject).tickKey),
        actions: actions.map((action, actionIndex) => parseActionRow(action, triggerIndex, actionIndex))
      };
    })
  };
}

export function stringifyMechanicsConfig(baseRoot: JsonObject, version: number, rows: SkillTriggerRow[]): string {
  const next: JsonObject = { ...baseRoot };
  next.version = normalizeInteger(version || 1, 1);
  next.triggers = rows.map((row) => {
    const raw = isPlainObject(row.raw) ? { ...row.raw } : {};
    const rawEvent = isPlainObject(raw.event) ? { ...(raw.event as JsonObject) } : {};
    updateOptionalString(raw, 'id', row.id);
    rawEvent.type = row.eventType || 'on_spell_cast';
    if (row.eventType === 'on_tick') {
      updateOptionalString(rawEvent, 'tickKey', row.eventTickKey);
    } else {
      delete rawEvent.tickKey;
    }
    raw.event = rawEvent;
    raw.actions = row.actions.map((action) => stringifyActionRow(action));
    return raw;
  });
  return stringifyJson(next);
}

export function inferSkillShapeSummary(params: JsonObject | undefined, mechanicsConfig: JsonObject | undefined): string {
  const hasFlat = Boolean(
    params &&
      [
        'damageType',
        'baseDamage',
        'baseDamageBySkillLevel',
        'attackRatio',
        'adRatio',
        'apRatio',
        'hitCount',
        'hitIntervalMs',
        'channelDurationMs'
      ].some((key) => params[key] !== undefined)
  );
  const hasDsl = Boolean(mechanicsConfig && Array.isArray(mechanicsConfig.triggers) && mechanicsConfig.triggers.length > 0);

  if (hasFlat && hasDsl) {
    return 'Mixed';
  }
  if (hasDsl) {
    return 'DSL';
  }
  if (hasFlat) {
    return 'Flat';
  }
  return 'Basic';
}

function parseSkillSeriesRow(entry: JsonValue, fieldName: string, index: number): SkillSeriesRow {
  if (typeof entry === 'number') {
    return { raw: {}, kind: 'const', by: 'skillLevel', value: normalizeNumber(entry), values: [] };
  }
  if (!isPlainObject(entry)) {
    throw new Error(`${fieldName}[${index}] 仅支持 const/table 对象。`);
  }

  const kind = asText(entry.kind) || 'const';
  if (kind === 'table') {
    const values = entry.values;
    if (!Array.isArray(values)) {
      throw new Error(`${fieldName}[${index}].values 必须是数组。`);
    }
    return {
      raw: { ...entry },
      kind: 'table',
      by: asText(entry.by) || 'skillLevel',
      value: 0,
      values: normalizeNumberArray(values)
    };
  }

  if (kind !== 'const') {
    throw new Error(`${fieldName}[${index}].kind 仅支持 const 或 table。`);
  }

  return {
    raw: { ...entry },
    kind: 'const',
    by: 'skillLevel',
    value: normalizeNumber(entry.value),
    values: []
  };
}

function parseActionRow(action: JsonValue, triggerIndex: number, actionIndex: number): SkillActionRow {
  if (!isPlainObject(action)) {
    throw new Error(`mechanicsConfig.triggers[${triggerIndex}].actions[${actionIndex}] 必须是对象。`);
  }
  const type = asText(action.type);
  if (type !== 'deal_damage' && type !== 'schedule_tick') {
    throw new Error(`当前结构化编辑仅支持 deal_damage / schedule_tick，发现 ${type || 'unknown'}。`);
  }

  if (type === 'deal_damage') {
    const damage = isPlainObject(action.damage) ? (action.damage as JsonObject) : {};
    const formulaVars = Array.isArray(damage.formulaVars) ? damage.formulaVars.map((entry) => String(entry)) : [];
    return {
      raw: { ...action },
      type,
      damageType: asText(damage.damageType) || 'magic',
      formulaText: asText(damage.formulaText),
      formulaVarsText: formulaVars.join(', '),
      tickKey: '',
      everyMs: 1000,
      times: 1
    };
  }

  return {
    raw: { ...action },
    type,
    damageType: 'magic',
    formulaText: '',
    formulaVarsText: '',
    tickKey: asText(action.tickKey),
    everyMs: normalizeNumber(action.everyMs),
    times: normalizeInteger(action.times, 1)
  };
}

function stringifyActionRow(action: SkillActionRow): JsonObject {
  const raw = isPlainObject(action.raw) ? { ...action.raw } : {};
  raw.type = action.type;

  if (action.type === 'deal_damage') {
    const rawDamage = isPlainObject(raw.damage) ? { ...(raw.damage as JsonObject) } : {};
    rawDamage.source = asText(rawDamage.source) || 'self';
    rawDamage.target = asText(rawDamage.target) || 'enemy';
    updateOptionalString(rawDamage, 'damageType', action.damageType || 'magic');
    updateOptionalString(rawDamage, 'formulaText', action.formulaText);
    updateOptionalStringArray(rawDamage, 'formulaVars', action.formulaVarsText);
    raw.damage = rawDamage;
    delete raw.tickKey;
    delete raw.everyMs;
    delete raw.times;
    return raw;
  }

  delete raw.damage;
  updateOptionalString(raw, 'tickKey', action.tickKey);
  raw.everyMs = normalizeNumber(action.everyMs);
  raw.times = normalizeInteger(action.times, 1);
  return raw;
}

function updateOptionalString(target: JsonObject, key: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) {
    target[key] = trimmed;
    return;
  }
  delete target[key];
}

function updateOptionalStringArray(target: JsonObject, key: string, value: string) {
  const normalized = value
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