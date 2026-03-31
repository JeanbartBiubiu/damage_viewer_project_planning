import type { JsonObject, JsonValue } from '../../types/api';
import { parseJsonObjectText, stringifyJson } from '../../pages/admin/resources/shared/json';

export type FormulaVarKind = 'const' | 'table' | 'scaled_attr' | 'formula' | 'mapping_scaled_attr';

export type FormulaMappingEntry = {
  key: string;
  value: number;
};

export type FormulaConstantRow = {
  key: string;
  valueText: string;
};

export type FormulaParamVarRow = {
  key: string;
  raw: JsonObject;
  label: string;
  kind: FormulaVarKind;
  by: 'skillLevel' | 'championLevel';
  value?: number;
  values: number[];
  attr: string;
  coefficient?: number;
  selector: string;
  formulaText: string;
  formulaVars: string[];
  mappingValues: FormulaMappingEntry[];
};

export type FormulaParamsState = {
  root: JsonObject;
  formulaText: string;
  vars: FormulaParamVarRow[];
  constants: FormulaConstantRow[];
};

export function createEmptyFormulaParamsText(): string {
  return '{\n  \n}';
}

export function createEmptyFormulaConstantRow(existingKeys: string[] = []): FormulaConstantRow {
  return {
    key: suggestUniqueKey('constant', existingKeys),
    valueText: ''
  };
}

export function createEmptyFormulaParamVarRow(kind: FormulaVarKind = 'const', existingKeys: string[] = []): FormulaParamVarRow {
  return {
    key: suggestUniqueKey('var', existingKeys),
    raw: {},
    label: '',
    kind,
    by: 'skillLevel',
    value: kind === 'const' ? 0 : undefined,
    values: [],
    attr: '',
    coefficient: kind === 'scaled_attr' || kind === 'mapping_scaled_attr' ? 1 : undefined,
    selector: '',
    formulaText: '',
    formulaVars: [],
    mappingValues: []
  };
}

export function parseFormulaParams(text: string, label = 'params'): FormulaParamsState {
  const root = parseJsonObjectText(text, label);
  const varsRoot = isPlainObject(root.vars) ? root.vars : {};
  const constantsRoot = isPlainObject(root.constants) ? root.constants : {};

  return {
    root,
    formulaText: asText(root.formulaText),
    vars: Object.entries(varsRoot).map(([key, value]) => parseFormulaParamVarRow(key, value)),
    constants: Object.entries(constantsRoot).map(([key, value]) => ({
      key,
      valueText: toEditableJsonValue(value as JsonValue | undefined)
    }))
  };
}

export function stringifyFormulaParams(
  baseRoot: JsonObject,
  formulaText: string,
  vars: FormulaParamVarRow[],
  constants: FormulaConstantRow[]
): string {
  return stringifyJson(buildFormulaParamsObject(baseRoot, formulaText, vars, constants));
}

export function buildFormulaParamsObject(
  baseRoot: JsonObject,
  formulaText: string,
  vars: FormulaParamVarRow[],
  constants: FormulaConstantRow[]
): JsonObject {
  const next = clonePlainObject(baseRoot);

  updateOptionalString(next, 'formulaText', formulaText);

  const serializedVars: JsonObject = {};
  vars.forEach((row) => {
    const key = row.key.trim();
    if (!key) {
      return;
    }
    serializedVars[key] = buildFormulaParamVarObject(row);
  });

  if (Object.keys(serializedVars).length > 0) {
    next.vars = serializedVars;
  } else {
    delete next.vars;
  }

  const serializedConstants: JsonObject = {};
  constants.forEach((row) => {
    const key = row.key.trim();
    const valueText = row.valueText.trim();
    if (!key || !valueText) {
      return;
    }
    serializedConstants[key] = parseLooseJsonValue(valueText);
  });

  if (Object.keys(serializedConstants).length > 0) {
    next.constants = serializedConstants;
  } else {
    delete next.constants;
  }

  return next;
}

export function buildFormulaParamVarObject(row: FormulaParamVarRow): JsonObject {
  const raw = clonePlainObject(row.raw);
  raw.kind = row.kind;
  updateOptionalString(raw, 'label', row.label);

  if (row.kind === 'const') {
    if (row.value == null) {
      delete raw.value;
    } else {
      raw.value = normalizeNumber(row.value);
    }
    delete raw.by;
    delete raw.values;
    delete raw.attr;
    delete raw.coefficient;
    delete raw.selector;
    delete raw.formulaText;
    delete raw.formulaVars;
    return raw;
  }

  if (row.kind === 'table') {
    raw.by = row.by;
    raw.values = row.values.map((value) => normalizeNumber(value));
    delete raw.value;
    delete raw.attr;
    delete raw.coefficient;
    delete raw.selector;
    delete raw.formulaText;
    delete raw.formulaVars;
    return raw;
  }

  if (row.kind === 'scaled_attr') {
    updateOptionalString(raw, 'attr', row.attr);
    if (row.coefficient == null) {
      delete raw.coefficient;
    } else {
      raw.coefficient = normalizeNumber(row.coefficient);
    }
    delete raw.value;
    delete raw.values;
    delete raw.by;
    delete raw.selector;
    delete raw.formulaText;
    delete raw.formulaVars;
    return raw;
  }

  if (row.kind === 'formula') {
    updateOptionalString(raw, 'formulaText', row.formulaText);
    updateOptionalStringArray(raw, 'formulaVars', row.formulaVars);
    delete raw.value;
    delete raw.values;
    delete raw.by;
    delete raw.attr;
    delete raw.coefficient;
    delete raw.selector;
    return raw;
  }

  updateOptionalString(raw, 'selector', row.selector);
  updateOptionalString(raw, 'attr', row.attr);
  if (row.coefficient == null) {
    delete raw.coefficient;
  } else {
    raw.coefficient = normalizeNumber(row.coefficient);
  }
  const mapping: JsonObject = {};
  row.mappingValues.forEach((entry) => {
    const key = entry.key.trim();
    if (!key) {
      return;
    }
    mapping[key] = normalizeNumber(entry.value);
  });
  if (Object.keys(mapping).length > 0) {
    raw.values = mapping;
  } else {
    delete raw.values;
  }
  delete raw.value;
  delete raw.by;
  delete raw.formulaText;
  delete raw.formulaVars;
  return raw;
}

function parseFormulaParamVarRow(key: string, value: unknown): FormulaParamVarRow {
  const raw = clonePlainObject(value);
  const kind = normalizeFormulaVarKind(raw);

  return {
    key,
    raw,
    label: asText(raw.label),
    kind,
    by: normalizeLevelAxis(raw.by),
    value: typeof raw.value === 'number' || Number.isFinite(Number(raw.value)) ? normalizeNumber(raw.value) : undefined,
    values: Array.isArray(raw.values) ? raw.values.map((entry) => normalizeNumber(entry)) : [],
    attr: asText(raw.attr),
    coefficient:
      typeof raw.coefficient === 'number' || Number.isFinite(Number(raw.coefficient))
        ? normalizeNumber(raw.coefficient)
        : undefined,
    selector: asText(raw.selector),
    formulaText: asText(raw.formulaText),
    formulaVars: normalizeStringArray(raw.formulaVars),
    mappingValues: parseMappingValues(raw.values)
  };
}

function normalizeFormulaVarKind(value: JsonObject): FormulaVarKind {
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
  if (isPlainObject(value.values) && asText(value.selector)) {
    return 'mapping_scaled_attr';
  }
  if (asText(value.formulaText)) {
    return 'formula';
  }
  if (asText(value.attr)) {
    return 'scaled_attr';
  }
  if (Array.isArray(value.values)) {
    return 'table';
  }
  return 'const';
}

function normalizeLevelAxis(value: unknown): 'skillLevel' | 'championLevel' {
  return value === 'championLevel' ? 'championLevel' : 'skillLevel';
}

function parseMappingValues(value: unknown): FormulaMappingEntry[] {
  if (!isPlainObject(value)) {
    return [];
  }
  return Object.entries(value).map(([key, entry]) => ({
    key,
    value: normalizeNumber(entry)
  }));
}

function suggestUniqueKey(prefix: string, existingKeys: string[]): string {
  const existing = new Set(existingKeys.filter(Boolean));
  let index = 1;
  while (existing.has(`${prefix}_${index}`)) {
    index += 1;
  }
  return `${prefix}_${index}`;
}

function toEditableJsonValue(value: JsonValue | undefined): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

function parseLooseJsonValue(valueText: string): JsonValue {
  const trimmed = valueText.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'null') {
    return null;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(trimmed)) {
    return numeric;
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed) as JsonValue;
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function clonePlainObject(value: unknown): JsonObject {
  return isPlainObject(value) ? { ...(value as JsonObject) } : {};
}

function updateOptionalString(target: JsonObject, key: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) {
    target[key] = trimmed;
  } else {
    delete target[key];
  }
}

function updateOptionalStringArray(target: JsonObject, key: string, values: string[]) {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (normalized.length > 0) {
    target[key] = normalized;
  } else {
    delete target[key];
  }
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

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
