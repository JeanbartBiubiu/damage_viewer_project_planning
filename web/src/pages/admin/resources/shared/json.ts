import type { JsonObject, JsonValue } from '../../../../types/api';

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function parseJsonObjectText(text: string, label: string): JsonObject {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象。`);
  }

  return parsed as JsonObject;
}

export function parseJsonArrayText(text: string, label: string): JsonValue[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 数组。`);
  }

  return parsed as JsonValue[];
}

export function parseJsonNumberArrayText(text: string, label: string): number[] {
  return parseJsonArrayText(text, label).map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${label} 中的每一项都必须是数字。`);
    }
    return numeric;
  });
}

export function parseJsonStringArrayText(text: string, label: string): string[] {
  return parseJsonArrayText(text, label).map((value) => {
    if (typeof value !== 'string') {
      throw new Error(`${label} 中的每一项都必须是字符串。`);
    }
    return value;
  });
}
