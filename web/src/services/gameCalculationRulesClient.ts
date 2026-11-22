import type { Attribute } from '../types/attribute';
import type { SkillCategory } from '../types/skillCategory';
import type { Binding } from '../types/formulaContract.generated';
import type { GameCalculationConfiguration, GameCalculationRulesResponse } from '../types/gameCalculationRules';
import { encodePathSegment, requestJson, type ApiResult } from './apiClient';
import { validateFormulaDefinition } from './formulaContract';


const KEY = /^[a-z][a-z0-9_]{0,63}$/;
export class CalculationRulesValidationError extends Error {
  constructor(readonly path: string, readonly code: string) { super(`游戏计算配置校验失败：${path}：${code}`); }
}
export function fail(path: string, code = 'invalid_configuration'): never { throw new CalculationRulesValidationError(path, code); }
function record(value: unknown, fields: readonly string[], path: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path);
  const row = value as Record<string, unknown>;
  const missing = fields.find(key => !Object.prototype.hasOwnProperty.call(row, key));
  if (missing) fail(`${path}.${missing}`, 'missing_required_field');
  const unknown = Object.keys(row).find(key => !fields.includes(key));
  if (unknown) fail(`${path}.${unknown}`, 'unknown_field');
  return row;
}
function key(value: unknown, path: string): string { if (typeof value !== 'string' || !KEY.test(value)) fail(path); return value; }
export function gameFormulaAllowedBindings(attributes: readonly Pick<Attribute, 'attributeKey' | 'status'>[]): Binding[] {
  return attributes.filter(row => row.status === 'ENABLED').flatMap(row => (['BASE', 'BONUS', 'TOTAL'] as const)
    .map(valueKind => ({ kind: 'attribute' as const, object: 'source' as const, attributeKey: row.attributeKey, valueKind, view: 'current_frame' as const })));
}
export function parseGameCalculationConfiguration(value: unknown, attributes?: readonly Attribute[], skillCategories?: readonly SkillCategory[]): GameCalculationConfiguration {
  const row = record(value, ['criticalChanceAttributeKey', 'criticalMultiplierMin', 'attackSpeedAttributeKey',
    'basicAttackCategoryKey', 'equipmentPassiveCategoryKey', 'ignorableCastCostAttributeKeys', 'attributeDerivations'], 'configuration');
  const attribute = (value: unknown, path: string) => {
    const selected = key(value, path);
    if (attributes && attributes.filter(row => row.attributeKey === selected && row.status === 'ENABLED').length !== 1) fail(path, 'unknown_attribute');
    return selected;
  };
  for (const field of ['criticalChanceAttributeKey', 'attackSpeedAttributeKey'] as const) if (row[field] !== null) attribute(row[field], `configuration.${field}`);
  for (const field of ['basicAttackCategoryKey', 'equipmentPassiveCategoryKey'] as const) if (row[field] !== null) {
    const selected = key(row[field], `configuration.${field}`);
    if (skillCategories && skillCategories.filter(category => category.skillCategoryKey === selected && category.status === 'ENABLED').length !== 1) {
      fail(`configuration.${field}`, 'unknown_skill_category');
    }
  }
  if (row.basicAttackCategoryKey !== null && row.basicAttackCategoryKey === row.equipmentPassiveCategoryKey) {
    fail('configuration.equipmentPassiveCategoryKey', 'category_usage_conflict');
  }
  if (!Array.isArray(row.ignorableCastCostAttributeKeys) || row.ignorableCastCostAttributeKeys.length > 32) fail('configuration.ignorableCastCostAttributeKeys');
  const costAttributes = new Set<string>();
  row.ignorableCastCostAttributeKeys.forEach((entry, index) => {
    const path = `configuration.ignorableCastCostAttributeKeys[${index}]`;
    const selected = attribute(entry, path);
    if (costAttributes.has(selected)) fail(path, 'duplicate_attribute');
    if (attributes && !attributes.some(attribute => attribute.attributeKey === selected && ['INTEGER', 'DECIMAL'].includes(attribute.valueType))) fail(path, 'non_numeric_attribute');
    costAttributes.add(selected);
  });
  if (row.criticalMultiplierMin !== null && (typeof row.criticalMultiplierMin !== 'number'
    || !Number.isFinite(row.criticalMultiplierMin) || row.criticalMultiplierMin < 0)) fail('configuration.criticalMultiplierMin');
  if (!Array.isArray(row.attributeDerivations) || row.attributeDerivations.length > 4) fail('configuration.attributeDerivations');
  const outputs = new Set<string>(), identities = new Set<string>();
  for (const [index, entry] of row.attributeDerivations.entries()) {
    const path = `configuration.attributeDerivations[${index}]`;
    const rule = record(entry, ['ruleKey', 'attributeKey', 'valuePolicy', 'activationAttributeKeys', 'formula'], path);
    const ruleKey = key(rule.ruleKey, `${path}.ruleKey`), output = attribute(rule.attributeKey, `${path}.attributeKey`);
    if (identities.has(ruleKey) || outputs.has(output) || output === 'hp') fail(path, 'duplicate_or_invalid_output');
    identities.add(ruleKey); outputs.add(output);
    if (rule.valuePolicy !== 'set' && rule.valuePolicy !== 'multiply') fail(`${path}.valuePolicy`);
    if (!Array.isArray(rule.activationAttributeKeys) || !rule.activationAttributeKeys.length
      || new Set(rule.activationAttributeKeys).size !== rule.activationAttributeKeys.length) fail(`${path}.activationAttributeKeys`);
    rule.activationAttributeKeys.forEach((entry, i) => {
      const activation = attribute(entry, `${path}.activationAttributeKeys[${i}]`);
      if (activation === 'hp') fail(`${path}.activationAttributeKeys[${i}]`, 'unsupported_life_activation');
    });
  }
  for (const [index, entry] of row.attributeDerivations.entries()) {
    const path = `configuration.attributeDerivations[${index}].formula`;
    const formula = (entry as Record<string, unknown>).formula;
    const declared = formula && typeof formula === 'object' && !Array.isArray(formula) ? (formula as Record<string, unknown>).inputs : null;
    const allowed = attributes ? gameFormulaAllowedBindings(attributes) : Array.isArray(declared) ? declared.flatMap<Binding>(entry => {
      const binding = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>).binding as Binding : undefined;
      return binding?.kind === 'attribute' && binding.object === 'source' && binding.view === 'current_frame'
        && ['BASE', 'BONUS', 'TOTAL'].includes(binding.valueKind) ? [binding] : [];
    }) : [];
    const issue = validateFormulaDefinition(formula, allowed);
    if (issue) fail(path + issue.path, issue.code);
    const typed = formula as GameCalculationConfiguration['attributeDerivations'][number]['formula'];
    for (const [inputIndex, input] of typed.inputs.entries()) {
      if (input.binding.kind !== 'attribute' || input.binding.object !== 'source') fail(`${path}.inputs[${inputIndex}].binding`, 'unauthorized_binding');
      if (outputs.has(input.binding.attributeKey) && input.binding.valueKind !== 'BASE') fail(`${path}.inputs[${inputIndex}].binding`, 'derived_output_read');
    }
  }
  return structuredClone(row) as GameCalculationConfiguration;
}
export function parseGameCalculationRules(value: unknown, gameId?: string, attributes?: readonly Attribute[], skillCategories?: readonly SkillCategory[]): GameCalculationRulesResponse {
  const row = record(value, ['gameId', 'baseDigest', 'configuration'], 'calculationRules');
  if (typeof row.gameId !== 'string' || !row.gameId || gameId !== undefined && row.gameId !== gameId) fail('calculationRules.gameId');
  if (attributes?.some(attribute => attribute.gameId !== row.gameId)) fail('calculationRules.attributes', 'foreign_game_attribute');
  if (skillCategories?.some(category => category.gameId !== row.gameId)) fail('calculationRules.skillCategories', 'foreign_game_skill_category');
  if (typeof row.baseDigest !== 'string' || !/^[0-9a-f]{64}$/.test(row.baseDigest)) fail('calculationRules.baseDigest');
  return { gameId: row.gameId, baseDigest: row.baseDigest,
    configuration: row.configuration === null ? null : parseGameCalculationConfiguration(row.configuration, attributes, skillCategories) };
}
export function path(gameId: string) { return `/api/admin/games/${encodePathSegment(gameId)}/calculation-rules`; }
export async function getGameCalculationRules(api: string, gameId: string, signal?: AbortSignal): Promise<ApiResult<GameCalculationRulesResponse>> {
  const result = await requestJson<unknown>(api, path(gameId), { signal });
  return { ...result, data: parseGameCalculationRules(result.data, gameId) };
}
