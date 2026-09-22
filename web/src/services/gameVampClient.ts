import { encodePathSegment, requestJson, type ApiResult } from './apiClient';
import { GAME_VAMP_TYPES, sortGameVampRules, type GameVampRule, type GameVampRulesResponse } from '../types/gameVamp';

function fail(path: string): never {
  throw new Error(`游戏吸血规则响应格式不正确：${path}`);
}

export function parseGameVampRules(value: unknown): GameVampRulesResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('rules');
  const root = value as Record<string, unknown>;
  if (Object.keys(root).length !== 1 || !Array.isArray(root.rules)) fail('rules');
  const seen = new Set<string>();
  const rules = root.rules.map((raw, index): GameVampRule => {
    const path = `rules[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(path);
    const rule = raw as Record<string, unknown>;
    const keys = ['vampType', 'sourceAttributeKey', 'basisOutputKind', 'defaultEfficiency', 'deliveryKinds', 'originKinds', 'skillCategoryKeys'];
    if (Object.keys(rule).length !== keys.length || keys.some((key) => !(key in rule))) fail(path);
    if (!(GAME_VAMP_TYPES as readonly unknown[]).includes(rule.vampType) || seen.has(String(rule.vampType))) fail(`${path}.vampType`);
    seen.add(String(rule.vampType));
    if (typeof rule.sourceAttributeKey !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(rule.sourceAttributeKey)) fail(`${path}.sourceAttributeKey`);
    if (rule.basisOutputKind !== 'POST_DEFENSE_DAMAGE' && rule.basisOutputKind !== 'ACTUAL_HP_LOSS') fail(`${path}.basisOutputKind`);
    if (typeof rule.defaultEfficiency !== 'number' || !Number.isFinite(rule.defaultEfficiency) || rule.defaultEfficiency < 0) fail(`${path}.defaultEfficiency`);
    const set = (key: string, allowed?: readonly string[]) => {
      const items = rule[key];
      if (!Array.isArray(items) || !items.length || new Set(items).size !== items.length
        || items.some((item) => typeof item !== 'string' || (allowed ? !allowed.includes(item) : !/^[a-z][a-z0-9_]{0,63}$/.test(item)))) fail(`${path}.${key}`);
    };
    set('deliveryKinds', ['SKILL', 'BASIC_ATTACK']);
    set('originKinds', ['DIRECT', 'REFLECTED']);
    set('skillCategoryKeys');
    return rule as GameVampRule;
  });
  return { rules: sortGameVampRules(rules) };
}

function path(gameId: string): string {
  return `/api/admin/games/${encodePathSegment(gameId)}/vamp-rules`;
}

export async function getGameVampRules(apiBaseUrl: string, gameId: string, token: string): Promise<ApiResult<GameVampRulesResponse>> {
  const result = await requestJson<unknown>(apiBaseUrl, path(gameId), { token });
  return { ...result, data: parseGameVampRules(result.data) };
}

export async function updateGameVampRules(apiBaseUrl: string, gameId: string, token: string, body: GameVampRulesResponse): Promise<ApiResult<GameVampRulesResponse>> {
  const result = await requestJson<unknown>(apiBaseUrl, path(gameId), { method: 'PUT', token, body: JSON.stringify(parseGameVampRules(body)) });
  return { ...result, data: parseGameVampRules(result.data) };
}
