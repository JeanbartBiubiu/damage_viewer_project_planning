import { validateStoredSkillFormula } from './skillFormulaContract';
import { ApiRequestError, requestJson } from './apiClient';
import type { ApiResult } from './apiClient';
import { skillsPath } from './skillClient';
import type { SkillConfiguration } from '../types/skillConfiguration';

export function skillConfigurationPath(gameId: string, skillKey: string): string {
  return `${skillsPath(gameId, skillKey)}/configuration`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateSkillConfiguration(
  value: unknown,
  gameId: string,
  skillKey: string
): SkillConfiguration {
  if (!isRecord(value) || !isRecord(value.skill)
    || value.skill.gameId !== gameId || value.skill.skillKey !== skillKey
    || typeof value.baseDigest !== 'string' || !value.baseDigest.trim()) {
    throw new ApiRequestError('技能配置响应不完整，请重新读取。', 502, 'INVALID_CONFIGURATION_RESPONSE');
  }
  const collections = ['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'] as const;
  const keys = ['parameterKey', 'formulaKey', 'effectKey', 'processKey', 'stateKey', 'ruleKey'] as const;
  for (let index = 0; index < collections.length; index += 1) {
    const items = value[collections[index]!];
    const key = keys[index]!;
    if (!Array.isArray(items) || items.some((item) => !isRecord(item)
      || (key !== 'ruleKey' && (item.gameId !== gameId || item.skillKey !== skillKey))
      || typeof item[key] !== 'string' || !item[key].trim())) {
      throw new ApiRequestError('技能配置响应不完整，请重新读取。', 502, 'INVALID_CONFIGURATION_RESPONSE');
    }
    const stableKeys = (items as Record<string, unknown>[]).map((item) => item[key] as string);
    if (new Set(stableKeys).size !== stableKeys.length) {
      throw new ApiRequestError('技能配置含重复的稳定标识，请重新读取。', 502, 'INVALID_CONFIGURATION_RESPONSE');
    }
  }
  if ((value.formulas as unknown[]).some((formula) => !isRecord(formula) || validateStoredSkillFormula(formula.expression, skillKey) !== null)) {
    throw new ApiRequestError('技能公式详情不完整，请重新读取。', 502, 'INVALID_CONFIGURATION_RESPONSE');
  }
  return value as SkillConfiguration;
}

export async function getSkillConfiguration(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string
): Promise<ApiResult<SkillConfiguration>> {
  const result = await requestJson<unknown>(apiBaseUrl, skillConfigurationPath(gameId, skillKey));
  return { ...result, data: validateSkillConfiguration(result.data, gameId, skillKey) };
}
