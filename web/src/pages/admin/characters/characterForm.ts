import { ApiRequestError } from '../../../services/apiClient';
import type { Attribute } from '../../../types/attribute';
import type { CharacterFieldIssue, CharacterLevelValues } from '../../../types/character';

export type CharacterDraft = {
  characterKey: string;
  name: string;
  description: string;
};

export type CharacterDraftErrors = Partial<Record<keyof CharacterDraft, string>>;

export type AttributeGenerationMode = 'fixed' | 'increment' | 'levels';

export function validateCharacterDraft(
  draft: CharacterDraft,
  includeCharacterKey: boolean
): CharacterDraftErrors {
  const errors: CharacterDraftErrors = {};
  if (includeCharacterKey) {
    if (!draft.characterKey.trim()) {
      errors.characterKey = '角色标识不能为空';
    } else if (!/^[a-z][a-z0-9_]{0,63}$/.test(draft.characterKey)) {
      errors.characterKey = '小写字母开头，只能包含小写字母、数字和下划线';
    }
  }
  if (!draft.name.trim()) {
    errors.name = '角色名称不能为空';
  } else if (draft.name.trim().length > 100) {
    errors.name = '角色名称不能超过100个字符';
  }
  if (draft.description.trim().length > 2000) {
    errors.description = '说明不能超过2000个字符';
  }
  return errors;
}

export function normalizeLevelValues(
  minLevel: number,
  maxLevel: number,
  attributes: Attribute[],
  source: CharacterLevelValues
): CharacterLevelValues {
  const configuredKeys = new Set(
    attributes
      .filter((attribute) => {
        for (let level = minLevel; level <= maxLevel; level += 1) {
          if (typeof source[String(level)]?.[attribute.attributeKey] !== 'number') {
            return false;
          }
        }
        return true;
      })
      .map((attribute) => attribute.attributeKey)
  );
  const result: CharacterLevelValues = {};
  for (let level = minLevel; level <= maxLevel; level += 1) {
    const levelKey = String(level);
    result[levelKey] = {};
    for (const attribute of attributes) {
      if (configuredKeys.has(attribute.attributeKey)) {
        result[levelKey][attribute.attributeKey] = source[levelKey]![attribute.attributeKey]!;
      }
    }
  }
  return result;
}

export function isAttributeConfigured(
  source: CharacterLevelValues,
  attributeKey: string,
  minLevel: number,
  maxLevel: number
): boolean {
  for (let level = minLevel; level <= maxLevel; level += 1) {
    if (typeof source[String(level)]?.[attributeKey] !== 'number') {
      return false;
    }
  }
  return true;
}

export function removeConfiguredAttribute(
  source: CharacterLevelValues,
  attributeKey: string
): CharacterLevelValues {
  return Object.fromEntries(Object.entries(source).map(([level, values]) => {
    const next = { ...values };
    delete next[attributeKey];
    return [level, next];
  }));
}

export function describeAttributeProgression(
  source: CharacterLevelValues,
  attributeKey: string,
  minLevel: number,
  maxLevel: number
): string {
  if (!isAttributeConfigured(source, attributeKey, minLevel, maxLevel)) {
    return '未配置';
  }
  const mode = getAttributeGenerationMode(source, attributeKey, minLevel, maxLevel);
  if (mode === 'fixed') return '固定';
  if (mode === 'levels') return '逐级变化';
  const increment = Number((source[String(minLevel + 1)]![attributeKey]! - source[String(minLevel)]![attributeKey]!).toFixed(8));
  return `${increment >= 0 ? '+' : ''}${increment} / level`;
}

export function getAttributeGenerationMode(
  source: CharacterLevelValues,
  attributeKey: string,
  minLevel: number,
  maxLevel: number
): AttributeGenerationMode {
  if (!isAttributeConfigured(source, attributeKey, minLevel, maxLevel)) return 'fixed';
  const values = Array.from(
    { length: maxLevel - minLevel + 1 },
    (_, index) => source[String(minLevel + index)]![attributeKey]!
  );
  if (values.every((value) => value === values[0])) {
    return 'fixed';
  }
  const increment = Number((values[1]! - values[0]!).toFixed(8));
  const linear = values.every((value, index) =>
    value === Number((values[0]! + index * increment).toFixed(8))
  );
  return linear ? 'increment' : 'levels';
}

export function generatePerLevelValues(
  source: CharacterLevelValues,
  attribute: Pick<Attribute, 'attributeKey' | 'valueType' | 'minValue' | 'maxValue'>,
  minLevel: number,
  maxLevel: number,
  text: string
): { levelValues: CharacterLevelValues; error: null } | { levelValues: null; error: string } {
  const entries = text.trim() ? text.trim().split(/[\s,，]+/u).filter(Boolean) : [];
  const count = maxLevel - minLevel + 1;
  if (entries.length !== count) {
    return { levelValues: null, error: `请按 Lv${minLevel} 至 Lv${maxLevel} 的顺序输入 ${count} 个数值，当前为 ${entries.length} 个。` };
  }
  const numbers = entries.map(Number);
  for (let index = 0; index < numbers.length; index += 1) {
    const value = numbers[index]!;
    const level = minLevel + index;
    if (!Number.isFinite(value)) {
      return { levelValues: null, error: `Lv${level} 的数值必须为有限数。` };
    }
    if (attribute.valueType === 'INTEGER' && !Number.isInteger(value)) {
      return { levelValues: null, error: `Lv${level} 的数值必须是整数。` };
    }
    if ((attribute.minValue !== null && value < attribute.minValue)
      || (attribute.maxValue !== null && value > attribute.maxValue)) {
      return { levelValues: null, error: `Lv${level} 的数值超出属性范围。` };
    }
  }
  const levelValues: CharacterLevelValues = Object.fromEntries(
    Object.entries(source).map(([level, values]) => [level, { ...values }])
  );
  numbers.forEach((value, index) => {
    const level = String(minLevel + index);
    levelValues[level] = { ...(levelValues[level] ?? {}), [attribute.attributeKey]: value };
  });
  return { levelValues, error: null };
}

export function generateIncrementingLevelValues(
  source: CharacterLevelValues,
  attributeKey: string,
  minLevel: number,
  maxLevel: number,
  startValue: number,
  increment: number
): CharacterLevelValues {
  const result: CharacterLevelValues = Object.fromEntries(
    Object.entries(source).map(([level, values]) => [level, { ...values }])
  );
  for (let level = minLevel; level <= maxLevel; level += 1) {
    const levelKey = String(level);
    const value = startValue + (level - minLevel) * increment;
    result[levelKey] = {
      ...(result[levelKey] ?? {}),
      [attributeKey]: increment === 0 ? startValue : Number(value.toFixed(8))
    };
  }
  return result;
}

export function characterFieldIssues(error: unknown): CharacterFieldIssue[] {
  if (!(error instanceof ApiRequestError)) {
    return [];
  }
  const raw = error.details?.fieldIssues;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((issue): issue is CharacterFieldIssue => {
    if (!issue || typeof issue !== 'object') {
      return false;
    }
    const value = issue as Record<string, unknown>;
    return typeof value.field === 'string'
      && typeof value.code === 'string'
      && typeof value.message === 'string';
  });
}
