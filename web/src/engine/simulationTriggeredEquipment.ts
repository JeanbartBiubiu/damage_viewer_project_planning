import { calculationConfiguration, changedAttributes, simulationCriticalBinding } from './simulationCalculationRules';
import { sameFormulaPayload } from '../services/skillFormulaContract';
import { skillFormulaParameterKeys, skillFormulaReachableInputs, validateStoredSkillFormula } from '../services/skillFormulaContract';
import { TypeCatalogEntries } from './typeCatalogEntries';
import { SKILL_CATEGORY_TYPE_PREFIX, skillCategoryTypeKey } from './skillCategoryType';
import { damageTypeFormulaAllowedBindings } from '../types/damageTypeFormula';
import { parseDamageTypeFormulaDefinition } from '../services/damageTypeClient';
import type {
  CompileRequest, GenericDamageTypeFormula, GenericFormulaExpr, GenericRules, NamedFormula,
  AbilityDefinition, ModifierDefinition, OperationDefinition, ProviderDefinition, ProviderStateFieldSchema, SkillHitCandidate
} from '../types/genericEngine';
import type { NumericValue } from '../types/numericValue';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffect, SkillEffectDamageResult, SkillEffectLifecycle, SkillEffectResult, SkillEffectValueRule } from '../types/skillEffect';
import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillProcess, SkillProcessMoment, SkillProcessStateOperation } from '../types/skillProcess';
import { SKILL_TRIGGER_TARGET_CATEGORIES, type SkillTriggerAction, type SkillTriggerCondition, type SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { FormulaExpressionNode } from '../types/skillFormula';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { executableEquipmentRelations, validateSimulationSkillSourceManifest, type TriggeredSkillSourceDescription } from './simulationSkillSourceDescription';
import { selectSimulationSkillSourceClosure } from './simulationSkillSourceClosure';
import {
  compileAttributeValue, compileNumericValue, registerCommonFormula, constExpr, createNumericCompileState, finiteNumber,
  NumericAdaptationError, tryFoldConstant, staticNumericField, wrapValueRuleExpression
} from './numericAdapter';
import type { OperationOrigin, SimulationCoverage } from './simulationAdapter';
import { adaptDamageVamp } from './vampAdapter';
import { compilePersistentResult } from './persistentResultAdapter';
import { permanentModifier, validatePermanentEffect } from './simulationPermanentResults';
import { compileSimulationStatusCondition } from './simulationPrimaryAttack';
import { compileLinkedShieldEffect } from './shieldEffectAdapter';
import { compileHitIdentityCondition, compilePassiveHitControl } from './hitAdapter';
import { lowerBasicAttackContributionValue, lowerBasicAttackContributionValueRule,
  type BasicAttackContributionFormulaPurpose, type LoweredBasicAttackContributionFormula } from './basicAttackContributionFormula';
import { basicAttackContributionKey, isBasicAttackContributionRule,
  type BasicAttackContribution } from './basicAttackContributionContract';
import { compileStateFieldSchema } from './processStateAdapter';
import { normalizeSceneInitialParameterInputs, sceneInitialParameterRequirements, sceneInitialValuesForSource,
  type SceneInitialParameterInput } from './sceneInitialParameterInput';


type Side = 'source' | 'target';
export type TriggeredEquipmentAssembly = {
  providers: ProviderDefinition[];
  mounts: Array<{ side: Side; providerRef: string; definitionRef: string }>;
  types: CompileRequest['typeCatalog']['types'];
  formulas: NamedFormula[];
  rules: GenericRules;
  operationOrigins: OperationOrigin[];
  coverage: SimulationCoverage[];
  required: Record<Side, Set<string>>;
  selectedSkills: Set<string>;
  changedAttributes: ReturnType<typeof changedAttributes>;
  compiledSources: Array<{ side: Side; providerRef: string; definitionRef: string; skillKey: string }>;
  passiveHitContributions?: Array<{ sourceSkillKey: string; authorSkillKey: string; candidate: SkillHitCandidate }>;
  basicAttackContributions?: BasicAttackContribution[];
};

const METADATA = ['name', 'description', 'sortOrder', 'createdAt', 'updatedAt'];

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '需要完整对象');
  return value as Record<string, unknown>;
}
function exact(value: unknown, fields: readonly string[], path: string) {
  const unexpected = Object.keys(record(value, path)).find(key => !fields.includes(key));
  if (unexpected) fail(`${path}.${unexpected}`, '4C未接入的字段不能被静默忽略');
}
function array<T>(value: T[], path: string): T[] {
  if (!Array.isArray(value)) fail(path, '需要完整数组');
  return value;
}
function stableKey(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) fail(path, '需要合法稳定标识');
  return value;
}
function uniqueRows<T>(rows: T[], keyFor: (row: T) => string, path: string) {
  const seen = new Set<string>();
  for (const row of array(rows, path)) {
    const key = stableKey(keyFor(row), path);
    if (seen.has(key)) fail(path, '稳定标识重复，不能过滤后继续');
    seen.add(key);
  }
}
function validateFormulaNode(node: FormulaExpressionNode, path: string, skillKey: string) {
  const problem = validateStoredSkillFormula(node, skillKey);
  if (problem) fail(path + problem.path, problem.code);
}
function validateNumeric(value: NumericValue, path: string) {
  record(value, path);
  if (value.kind === 'FIXED') exact(value, ['kind', 'value'], path);
  else if (value.kind === 'PARAMETER') exact(value, ['kind', 'parameterKey'], path);
  else if (value.kind === 'FORMULA') exact(value, ['kind', 'formulaKey'], path);
  else fail(path, '未知数值来源');
}
function collectAttributes(value: unknown, owner: Side, required: Record<Side, Set<string>>) {
  if (Array.isArray(value)) { value.forEach(row => collectAttributes(row, owner, required)); return; }
  if (!value || typeof value !== 'object') return;
  const row = value as Record<string, unknown>;
  if (Array.isArray(row.inputs) && Array.isArray(row.stages) && typeof row.outputStageKey === 'string') {
    for (const input of skillFormulaReachableInputs(row as unknown as FormulaExpressionNode)) if (input.binding.kind === 'attribute') {
      required[input.binding.object === 'source' ? owner : owner === 'source' ? 'target' : 'source'].add(input.binding.attributeKey);
    }
    return;
  }
  if (row.op === 'read' && typeof row.path === 'string') {
    const match = /^(source|target)\.attr\.([a-z][a-z0-9_]*)\./.exec(row.path);
    if (match) required[match[1] === 'source' ? owner : owner === 'source' ? 'target' : 'source'].add(match[2]!);
  }
  if (row.kind === 'attribute' && (row.object === 'source' || row.object === 'target') && typeof row.attributeKey === 'string') {
    required[row.object === 'source' ? owner : owner === 'source' ? 'target' : 'source'].add(row.attributeKey);
  }
  Object.values(row).forEach(child => collectAttributes(child, owner, required));
}
function renameFormulaRefs(expression: GenericFormulaExpr, names: ReadonlyMap<string, string>): GenericFormulaExpr {
  return {
    ...expression,
    ...(expression.ref ? { ref: names.get(expression.ref) ?? expression.ref } : {}),
    ...(expression.args ? { args: expression.args.map(child => renameFormulaRefs(child, names)) } : {}),
    ...(expression.min ? { min: renameFormulaRefs(expression.min, names) } : {}),
    ...(expression.max ? { max: renameFormulaRefs(expression.max, names) } : {}),
    ...(expression.expr ? { expr: renameFormulaRefs(expression.expr, names) } : {})
  };
}

function ordered<T extends { sortOrder: number }>(rows: T[], path: string): T[] {
  if (array(rows, path).some(row => !Number.isInteger(row.sortOrder))) fail(path, '排序必须为整数');
  return rows.map((row, index) => ({ row, index }))
    .sort((left, right) => left.row.sortOrder - right.row.sortOrder || left.index - right.index).map(entry => entry.row);
}

export function compileSimulationDamageFormula(snapshot: SimulationSnapshot, damageKey: string): GenericDamageTypeFormula {
  stableKey(damageKey, `catalogs.damageTypes.${damageKey}`);
  const entries = snapshot.catalogs.damageTypes.filter(row => row.type.damageTypeKey === damageKey);
  const authored = entries[0];
  if (entries.length !== 1 || !authored || authored.type.gameId !== snapshot.gameId || authored.type.status !== 'ENABLED'
    || authored.type.formulaConfigured !== true) fail(`catalogs.damageTypes.${damageKey}`, '缺少唯一已启用的真实共同防御公式');
  exact(authored.type, ['gameId', 'damageTypeKey', 'status', 'formulaConfigured', ...METADATA], `catalogs.damageTypes.${damageKey}.type`);
  exact(authored.formula, ['gameId', 'damageTypeKey', 'formula', 'updatedAt'], `catalogs.damageTypes.${damageKey}.formula`);
  if (authored.formula.gameId !== snapshot.gameId || authored.formula.damageTypeKey !== damageKey) fail(`catalogs.damageTypes.${damageKey}.formula`, '防御公式归属不一致');
  const formula = parseDamageTypeFormulaDefinition(authored.formula.formula,
    damageTypeFormulaAllowedBindings(snapshot.catalogs.attributes.filter(attribute => attribute.gameId === snapshot.gameId)));
  return { damageType: damageKey, formula };
}
function combine(operation: 'min' | 'max', expressions: GenericFormulaExpr[]): GenericFormulaExpr {
  if (!expressions.length) fail('conditionGroups', '条件组不能为空');
  return expressions.reduce((left, right) => ({ op: operation, args: [left, right] }));
}
export function validateConfiguration(configuration: SkillConfiguration, gameId: string, root: string, item: boolean, skillLevel: number, equipmentPassiveCategoryKey: string | null) {
  exact(configuration, ['skill', 'parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules', 'baseDigest'], root);
  exact(configuration.skill, ['gameId', 'skillKey', 'maxLevel', 'status', 'skillCategoryKeys', ...METADATA], `${root}.skill`);
  const categories = array(configuration.skill.skillCategoryKeys, `${root}.skill.skillCategoryKeys`);
  if (item && equipmentPassiveCategoryKey === null) fail('catalogs.calculationRules.configuration.equipmentPassiveCategoryKey', '实际启用且可达的装备技能需要明确配置被动分类用途绑定');
  if (configuration.skill.gameId !== gameId || configuration.skill.status !== 'ENABLED'
    || !Number.isSafeInteger(configuration.skill.maxLevel) || configuration.skill.maxLevel < 1
    || !Number.isSafeInteger(skillLevel) || skillLevel < 1 || skillLevel > configuration.skill.maxLevel
    || item && (configuration.skill.maxLevel !== 1 || skillLevel !== 1 || !categories.includes(equipmentPassiveCategoryKey!))
    || new Set(categories).size !== categories.length) {
    fail(root, item ? '装备关系需要完整单级、已启用的被动技能' : '自然来源需要真实启用技能与明确合法已学等级');
  }
  uniqueRows(configuration.parameters, row => row.parameterKey, `${root}.parameters`);
  uniqueRows(configuration.formulas, row => row.formulaKey, `${root}.formulas`);
  uniqueRows(configuration.effects, row => row.effectKey, `${root}.effects`);
  uniqueRows(configuration.processes, row => row.processKey, `${root}.processes`);
  uniqueRows(configuration.internalStates, row => row.stateKey, `${root}.internalStates`);
  uniqueRows(configuration.triggerRules, row => row.ruleKey, `${root}.triggerRules`);
  if (!configuration.triggerRules.length || !configuration.effects.length && (item || !configuration.processes.length && !configuration.internalStates.length)) fail(root, '缺少完整效果或触发规则，不能仅取直接属性');
  for (const parameter of configuration.parameters) {
    const path = `${root}.parameters.${parameter.parameterKey}`;
    exact(parameter, ['gameId', 'skillKey', 'parameterKey', 'valueType', 'valueMode', 'fixedValue', 'levelValues', ...METADATA], path);
    if (parameter.gameId !== gameId || parameter.skillKey !== configuration.skill.skillKey
      || !['INTEGER', 'DECIMAL'].includes(parameter.valueType)
      || !['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT'].includes(parameter.valueMode)) fail(path, '参数归属或取值方式未核定');
    if (parameter.valueMode === 'FIXED' && parameter.levelValues !== null
      || parameter.valueMode !== 'FIXED' && parameter.fixedValue !== null
      || parameter.valueMode === 'RUNTIME_INPUT' && parameter.levelValues !== null) fail(path, '参数必须符合声明的取值方式，不能忽略另一组数值');
  }
  for (const formula of configuration.formulas) {
    const path = `${root}.formulas.${formula.formulaKey}`;
    exact(formula, ['gameId', 'skillKey', 'formulaKey', 'expression', ...METADATA], path);
    if (formula.gameId !== gameId || formula.skillKey !== configuration.skill.skillKey) fail(path, '公式归属不一致');
    validateFormulaNode(formula.expression, `${path}.expression`, configuration.skill.skillKey);
  }
}
function validateLifecycle(lifecycle: SkillEffectLifecycle, path: string) {
  exact(lifecycle, ['durationValue', 'maxStacksValue', 'applicationStacksValue', 'instanceScope', 'reapplicationStackMode',
    'reapplicationDurationMode', 'expiryMode', 'periodicIntervalValue', 'firstPeriodicExecution', 'endWhenShieldEndsResultKey'], path);
  for (const key of ['durationValue', 'maxStacksValue', 'applicationStacksValue', 'instanceScope', 'reapplicationStackMode',
    'reapplicationDurationMode', 'expiryMode', 'periodicIntervalValue', 'firstPeriodicExecution']) {
    if (!Object.prototype.hasOwnProperty.call(lifecycle, key)) fail(`${path}.${key}`, '缺少完整生命周期字段');
  }
  if (lifecycle.endWhenShieldEndsResultKey != null) stableKey(lifecycle.endWhenShieldEndsResultKey, `${path}.endWhenShieldEndsResultKey`);
}
function validateValueRule(rule: SkillEffectValueRule, path: string) {
  exact(rule, ['value', 'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue'], path);
  validateNumeric(rule.value, `${path}.value`);
  finiteNumber(rule.fixedMultiplier, `${path}.fixedMultiplier`, fail);
  for (const bound of ['fixedMinValue', 'fixedMaxValue'] as const) if (rule[bound] !== null) finiteNumber(rule[bound], `${path}.${bound}`, fail);
  if (rule.fixedMinValue !== null && rule.fixedMaxValue !== null && rule.fixedMinValue > rule.fixedMaxValue) fail(path, '数值下界不能高于上界');
}

export function assembleTriggeredEquipment(snapshot: SimulationSnapshot, sceneInputs: readonly SceneInitialParameterInput[] = []): TriggeredEquipmentAssembly {
  const normalized = normalizeSceneInitialParameterInputs(snapshot, sceneInputs);
  const sceneRequirements = sceneInitialParameterRequirements(snapshot);
  validateSimulationSkillSourceManifest(snapshot);
  const descriptions: TriggeredSkillSourceDescription[] = [];
  const excludedCoverage: SimulationCoverage[] = [];
  for (const side of ['source', 'target'] as const) {
    const keys = array(snapshot.selection[`${side}EquipmentKeys`], `selection.${side}EquipmentKeys`);
    const items = array(snapshot[side].selectedEquipment, `${side}.selectedEquipment`);
    if (new Set(keys).size !== keys.length || keys.length > 6) fail(`selection.${side}EquipmentKeys`, '装备选择不能重复或超过6件');
    if (keys.length !== items.length
      || new Set(items.map(item => item.equipment.equipmentKey)).size !== items.length
      || items.some(item => !keys.includes(item.equipment.equipmentKey))) fail(`${side}.selectedEquipment`, '所选装备完整集缺失或重复');
    for (const equipmentKey of [...keys].sort()) {
      stableKey(equipmentKey, `selection.${side}EquipmentKeys`);
      const path = `${side}.selectedEquipment[${equipmentKey}]`;
      const item = items.find(row => row.equipment.equipmentKey === equipmentKey)!;
      if (item.equipment.gameId !== snapshot.gameId || item.attributes.equipmentKey !== equipmentKey) fail(path, '装备归属不一致');
      const allRelations = array(item.attachedSkills, `${path}.attachedSkills`);
      const relations = executableEquipmentRelations(snapshot, side, equipmentKey);
      uniqueRows(allRelations, row => row.skillKey, `${path}.attachedSkills`);
      uniqueRows(relations, row => row.skillKey, `${path}.attachedSkills`);
      for (const relation of relations) {
        const relationPath = `${path}.attachedSkills[${relations.indexOf(relation)}]`;
        exact(relation, ['gameId', 'skillKey', 'skillName', 'skillStatus', 'sortOrder', 'equipmentKey', 'equipmentName'], relationPath);
        if (relation.gameId !== snapshot.gameId || relation.equipmentKey !== equipmentKey || relation.skillStatus !== 'ENABLED') {
          fail(relationPath, '必须保留完整启用被动关系，整件装备拒绝，不能过滤后只取直接属性');
        }
      }
      if (!relations.length) continue;
      if (!Number.isInteger(snapshot.selection[`${side}Level`]) || snapshot.selection[`${side}Level`] < 1) fail(`selection.${side}Level`, '装备拥有方等级必须明确且有效');
      const providerRef = `${side}_${equipmentKey}_passive`;
      const definitionRef = `${providerRef}_definition`;
      descriptions.push({ side, kind: 'item', stableId: `${side}_equipment_${equipmentKey}_definition`,
        providerRef, definitionRef, path, equipmentKey, skills: ordered(relations, `${path}.attachedSkills`).map(relation => {
          const configurations = snapshot.skillConfigurations.filter(row => row.skill.skillKey === relation.skillKey);
          if (configurations.length !== 1) fail(`${path}.attachedSkills`, '完整被动配置缺失或重复，整件装备拒绝');
          const complete = configurations[0]!;
          validateConfiguration(complete, snapshot.gameId, `skills.${relation.skillKey}`, true, 1, calculationConfiguration(snapshot)?.equipmentPassiveCategoryKey ?? null);
          const source = snapshot[side].skillSources.find(source => source.origin.kind === 'EQUIPMENT'
            && source.origin.equipmentKey === equipmentKey && source.skillKey === relation.skillKey)!;
          const rootKeys = source.enabledRuleKeys;
          const { configuration } = selectSimulationSkillSourceClosure(complete, rootKeys);
          // 作者说明公式与参数继续完整校验、保留，不把未挂接的值冒充实际效果。
          configuration.parameters = complete.parameters;
          configuration.formulas = complete.formulas;
          for (const [collection, key] of [
            ['effects', 'effectKey'], ['processes', 'processKey'], ['internalStates', 'stateKey'], ['triggerRules', 'ruleKey']
          ] as const) for (const authored of complete[collection]) {
            const stableKey = (authored as unknown as Record<string, unknown>)[key];
            if (!configuration[collection].some(row => (row as unknown as Record<string, unknown>)[key] === stableKey)) {
              excludedCoverage.push({ authorPath: `skills.${relation.skillKey}.${collection}.${stableKey}`,
                compiledPath: 'runtimeOptions.skillOrigins', note: '完整作者配置保留；本场没有可达入口，不生成执行程序' });
            }
          }
          return { skillKey: relation.skillKey, skillLevel: 1,
            path: `${path}.attachedSkills[${relations.indexOf(relation)}]`, configuration, allowedRootKeys: rootKeys,
            sceneInitialValues: sceneInitialValuesForSource(sceneRequirements, normalized, side, source),
            permanentModifier: (result, resultPath, onNumericConsumed) => {
              const effect = configuration.effects.find(row => row.results.includes(result))!;
              const context = { snapshot, configuration, source, side, formulaNamespace: `${providerRef}/${relation.skillKey}/permanent`, onNumericConsumed };
              validatePermanentEffect(effect, `skills.${relation.skillKey}.effects.${effect.effectKey}`, context);
              const modifier = permanentModifier(context, result, resultPath);
              if ('combatantKey' in modifier) fail(resultPath, '装备常驻只接入明确静态修正，动态转换尚未开放');
              return modifier;
            } };
        }) });
    }
  }
  const assembled = assembleTriggeredSkillSources(snapshot, descriptions);
  const expected = descriptions.flatMap(description => description.skills.map(skill =>
    JSON.stringify([description.side, description.providerRef, description.definitionRef, skill.skillKey])));
  const actual = assembled.compiledSources.map(source => JSON.stringify([source.side, source.providerRef, source.definitionRef, source.skillKey]));
  if (new Set(expected).size !== expected.length || new Set(actual).size !== actual.length
    || expected.length !== actual.length || expected.some(source => !actual.includes(source))) {
    fail('skillSources', '开启装备来源与实编拥有方、挂载及技能身份不一致，不能漏编或覆盖兄弟技能');
  }
  assembled.coverage.push(...excludedCoverage);
  return assembled;
}

export function assembleTriggeredSkillSources(snapshot: SimulationSnapshot, descriptions: readonly TriggeredSkillSourceDescription[]): TriggeredEquipmentAssembly {
  const providers: ProviderDefinition[] = [];
  const mounts: TriggeredEquipmentAssembly['mounts'] = [];
  const types = new TypeCatalogEntries();
  const formulas = new Map<string, NamedFormula>();
  const rules: GenericRules = { damageTypeFormulas: [] };
  const operationOrigins: OperationOrigin[] = [];
  const coverage: SimulationCoverage[] = [];
  const required: Record<Side, Set<string>> = { source: new Set(), target: new Set() };
  const selectedSkills = new Set<string>();
  const changed = changedAttributes();
  const compiledSources: TriggeredEquipmentAssembly['compiledSources'] = [];
  const passiveHitContributions: NonNullable<TriggeredEquipmentAssembly['passiveHitContributions']> = [];
  const basicAttackContributions: BasicAttackContribution[] = [];
  const cover = (authorPath: string, compiledPath: string) => coverage.push({ authorPath, compiledPath });
  const addFormula = (formula: NamedFormula, path: string) => {
    const existing = formulas.get(formula.key);
    if (existing && !sameFormulaPayload(existing, formula)) fail(path, '具名公式冲突');
    formulas.set(formula.key, formula);
  };
  const category = (key: string) => {
    stableKey(key, `catalogs.skillCategories.${key}`);
    const matches = snapshot.catalogs.skillCategories.filter(row => row.skillCategoryKey === key);
    if (matches.length !== 1 || matches[0]!.gameId !== snapshot.gameId || matches[0]!.status !== 'ENABLED') {
      fail(`catalogs.skillCategories.${key}`, '缺少唯一已启用的真实技能分类');
    }
    const type = skillCategoryTypeKey(key);
    types.set(type, 'ability');
    cover(`catalogs.skillCategories.${key}`, `typeCatalog.types[${type}]`);
    return type;
  };
  const defense = (damageKey: string) => {
    stableKey(damageKey, `catalogs.damageTypes.${damageKey}`);
    const damageType = damageKey;
    types.set(damageType, 'damage');
    if (rules.damageTypeFormulas!.some(row => row.damageType === damageType)) return damageType;
    const compiled = compileSimulationDamageFormula(snapshot, damageKey);
    const index = rules.damageTypeFormulas!.length;
    cover(`damageTypes.${damageKey}.formula`, `rules.damageTypeFormulas[${index}].formula`);    rules.damageTypeFormulas!.push(compiled);
    cover(`catalogs.damageTypes.${damageKey}.type`, `typeCatalog.types[${damageType}]`);
    return damageType;
  };

  for (const description of descriptions) {
      const { side, providerRef, definitionRef, stableId, path, skills } = description;
      if (!Number.isSafeInteger(snapshot.selection[`${side}Level`]) || snapshot.selection[`${side}Level`] < 1) fail(`selection.${side}Level`, '实际拥有方等级必须明确且有效');
      const compiledRoot = `sharedProviders.${definitionRef}`;
      const schema: Record<string, ProviderStateFieldSchema> = {};
      const modifiers: ModifierDefinition[] = [];
      const provider: ProviderDefinition = { providerKey: definitionRef, skillKey: skills.length === 1 ? skills[0]!.skillKey : undefined, stableId, kind: description.kind, abilities: [] };
      const opponent = side === 'source' ? 'target' : 'source';
      const namedKey = (skillKey: string, key: string) => skills.length === 1 ? key : `${skillKey}_${key}`;

      for (const source of skills) {
        const { skillKey, skillLevel, configuration } = source;
        const root = `skills.${skillKey}`;
        validateConfiguration(configuration, snapshot.gameId, root, description.kind === 'item', skillLevel,
          description.kind === 'item' ? calculationConfiguration(snapshot)?.equipmentPassiveCategoryKey ?? null : null);
        selectedSkills.add(skillKey);
        const numeric = createNumericCompileState({ gameId: snapshot.gameId, skillKey, skillLevel,
          characterLevel: snapshot.selection[`${side}Level`], parameters: configuration.parameters,
          formulas: configuration.formulas, formulaNamespace: skills.length === 1 ? providerRef : `${providerRef}/${skillKey}`,
          bindParameters: true, allowAttributeReads: true, runtimeInputMessage: '触发来源不允许未供值的计算时参数' });
        const staticField = (authored: NumericValue, fieldPath: string, state: import('./numericAdapter').NumericCompileState, reject: typeof fail) => {
          const field = staticNumericField(authored, fieldPath, state, reject);
          if (skills.length === 1 || typeof field === 'number') return field;
          const approved = tryFoldConstant(field);
          if (approved === null || !Number.isFinite(approved)) return reject(fieldPath, '聚合状态字段需要原生核定的静态数值');
          return approved;
        };
        const usedParameters = new Set<string>();
        const usedFormulas = new Set<string>();
        const usedEffects = new Set<string>();
        const appliedEffects = new Set<string>();
        const queriedShieldEffects = new Set<string>();
        const usedProcesses = new Set<string>();
        const usedStates = new Set<string>();
        const usedRules = new Set<string>();
        let contributesBasicAttack = false;
        let contributionLowerings: BasicAttackContribution['lowerings'] = [];
        const abilities: AbilityDefinition[] = [];
        const stackEffects = new Map<string, { key: string; amount: number; policy: string }>();
        const periodicEffects = new Map<string, { definition: ProviderDefinition; dynamic: boolean }>();
        const activeProcesses = new Set<string>();
        const empoweredProcesses = new Set<string>();
        const deferredAbilities: AbilityDefinition[] = [];
        const activeEffects = new Set<string>();
        let rootEvent = '';
        const skillTypes = configuration.skill.skillCategoryKeys.map(category);
        const noteNumeric = (value: NumericValue) => {
          if (value.kind === 'PARAMETER') usedParameters.add(value.parameterKey);
          if (value.kind === 'FORMULA') {
            usedFormulas.add(value.formulaKey);
            const formula = configuration.formulas.find(row => row.formulaKey === value.formulaKey);
            if (formula) skillFormulaParameterKeys(formula.expression, false).forEach(key => usedParameters.add(key));
          }
        };
        const lowerContribution = (lowered: LoweredBasicAttackContributionFormula, field: string) => {
          contributionLowerings.push({ field, value: lowered });
          for (const reader of ['source', 'target'] as const) for (const key of lowered.requiredAttributes[reader]) {
            required[reader === 'source' ? side : opponent].add(key);
          }
          if (lowered.source.value.kind === 'FORMULA') {
            const key = lowered.source.value.formulaKey;
            const formula = configuration.formulas.find(row => row.formulaKey === key)!;
            registerCommonFormula(formula, lowered.source.authorPath, numeric, fail);
          }
          return lowered.expression;
        };
        const contributionAuthor = () => ({ gameId: snapshot.gameId, skillKey, skillLevel,
          characterLevel: snapshot.selection[`${side}Level`], parameters: configuration.parameters,
          formulas: configuration.formulas, attributes: snapshot.catalogs.attributes });
        const value = (authored: NumericValue, valuePath: string, purpose: BasicAttackContributionFormulaPurpose = 'amount') => {
          validateNumeric(authored, valuePath);
          noteNumeric(authored);
          if (contributesBasicAttack) return lowerContribution(lowerBasicAttackContributionValue(authored,
            contributionAuthor(), valuePath, purpose), purpose === 'criticalMultiplier' ? 'critMultiplier' : 'amount');
          return compileNumericValue(authored, valuePath, numeric, fail);
        };
        const constant = (authored: NumericValue, valuePath: string, integer = false, minimum = 0) => {
          value(authored, valuePath);
          const folded = tryFoldConstant(compileNumericValue(authored, valuePath, { ...numeric, bindParameters: false, allowAttributeReads: false }, fail));
          if (folded === null || !Number.isFinite(folded) || folded < minimum || integer && !Number.isSafeInteger(folded)) fail(valuePath, '需要明确的有限常量及合法整数时点，不能猜测动态值');
          return folded;
        };
        const amount = (result: SkillEffectResult, resultPath: string) => {
          if (!result.valueRule) fail(`${resultPath}.valueRule`, '结果数值规则缺失');
          validateValueRule(result.valueRule, `${resultPath}.valueRule`);
          if (contributesBasicAttack) {
            noteNumeric(result.valueRule.value);
            return lowerContribution(lowerBasicAttackContributionValueRule(result.valueRule, contributionAuthor(),
              `${resultPath}.valueRule`, 'amount'), 'amount');
          }
          return wrapValueRuleExpression(value(result.valueRule.value, `${resultPath}.valueRule.value`), result.valueRule);
        };
        const foldAmount = (result: SkillEffectResult, resultPath: string) => {
          amount(result, resultPath);
          const rule = result.valueRule!;
          const folded = tryFoldConstant(wrapValueRuleExpression(compileNumericValue(rule.value, `${resultPath}.valueRule.value`,
            { ...numeric, bindParameters: false, allowAttributeReads: false }, fail), rule));
          if (folded === null || !Number.isFinite(folded)) fail(resultPath, '来源持久属性必须有明确施加快照数值，不能改为实时求值');
          return folded;
        };
        const stateKey = (state: SkillInternalState) => namedKey(skillKey, state.stateKey);
        const lookupState = (key: string, sourceSkillKey: string, statePath: string) => {
          const state = configuration.internalStates.find(row => row.stateKey === key);
          if (!state || sourceSkillKey !== skillKey) fail(statePath, '内部状态引用缺失或不属于当前来源技能');
          if (state.scope === 'TARGET' && rootEvent === 'SOURCE_INITIALIZED') fail(statePath,
            '自身初始化没有实际攻击对手身份，不能读写来源对手状态');
          usedStates.add(key);
          return state;
        };
        const stateRead = (state: SkillInternalState): GenericFormulaExpr => ({
          op: 'read', path: `provider.${state.scope === 'TARGET' ? 'target_state' : 'state'}.${stateKey(state)}`
        });
        const stateChange = (key: string, policy: string, expression: GenericFormulaExpr, scope: SkillInternalState['scope'] = 'SKILL'): OperationDefinition => {
          const scopeType = scope === 'TARGET' ? 'state_scope/provider_target' : 'state_scope/provider';
          types.set(scopeType, 'state_scope');
          return { operation: 'state_change', target: 'self', ref: key, valuePolicy: policy, amount: expression, types: [scopeType] };
        };
        for (const state of configuration.internalStates) {
          const statePath = `${root}.internalStates.${state.stateKey}`;
          exact(state, ['gameId', 'skillKey', 'stateKey', 'stateType', 'scope', 'detail', ...METADATA], statePath);
          if (state.gameId !== snapshot.gameId || state.skillKey !== skillKey || !['SKILL', 'TARGET'].includes(state.scope)) fail(statePath, '只接入真实来源或来源对手范围内部状态');
          if (state.stateType === 'AMMO' || state.stateType === 'COUNTER' && state.detail.initialValueBinding !== undefined) {
            if (skills.length !== 1) fail(statePath, '显式状态初值与弹药需要唯一真实来源，不能跨聚合来源共享');
            schema[stateKey(state)] = compileStateFieldSchema(state, numeric, statePath, source.sceneInitialValues) as ProviderStateFieldSchema;
            noteNumeric(state.detail.initialValue); noteNumeric(state.detail.maxValue);
            if (state.stateType === 'AMMO') {
              noteNumeric(state.detail.recoveryIntervalValue);
              if (state.detail.initialRemainingValue) noteNumeric(state.detail.initialRemainingValue);
            } else if (state.detail.durationValue) noteNumeric(state.detail.durationValue);
          } else if (state.stateType === 'COUNTER') {
            exact(state.detail, ['initialValue', 'maxValue', 'durationValue'], `${statePath}.detail`);
            const initial = constant(state.detail.initialValue, `${statePath}.detail.initialValue`, true);
            const maximum = constant(state.detail.maxValue, `${statePath}.detail.maxValue`, true);
            if (initial > maximum) fail(statePath, '计数初始值不能超过上限');
            const durationValue = state.detail.durationValue;
            const durationMs = durationValue == null ? 0 : constant(durationValue, `${statePath}.detail.durationValue`, true);
            schema[stateKey(state)] = { valueType: 'integer', defaultValue: staticField(state.detail.initialValue, statePath + '.detail.initialValue', numeric, fail), maxValue: staticField(state.detail.maxValue, statePath + '.detail.maxValue', numeric, fail),
              durationMs: durationValue ? staticField(durationValue, statePath + '.detail.durationValue', numeric, fail) : 0,
              ...(durationMs > 0 ? { refreshPolicy: 'refresh_on_write' } : {}) };
          } else if (state.stateType === 'INTERNAL_COOLDOWN') {
            exact(state.detail, ['durationValue'], `${statePath}.detail`);
            constant(state.detail.durationValue, `${statePath}.detail.durationValue`, true, 1);
            schema[stateKey(state)] = { valueType: 'number', defaultValue: 0, maxValue: 1, stateKind: 'cooldown',
              durationMs: staticField(state.detail.durationValue, `${statePath}.detail.durationValue`, numeric, fail), refreshPolicy: 'start_on_first_write' };
          } else if (state.stateType === 'FLAG') {
            exact(state.detail, ['initialEnabled'], `${statePath}.detail`);
            if (typeof state.detail.initialEnabled !== 'boolean') fail(statePath, '标志初值必须来自明确作者布尔');
            schema[stateKey(state)] = { valueType: 'number', defaultValue: state.detail.initialEnabled ? 1 : 0, maxValue: 1, durationMs: 0 };
          } else fail(statePath, '未接入的内部状态类型，不能补默认值');
        }
        const effect = (key: string, effectPath: string) => {
          const matches = configuration.effects.filter(row => row.effectKey === key);
          if (matches.length !== 1) fail(effectPath, '效果引用缺失或重复');
          const authored = matches[0]!;
          const authorPath = `${root}.effects.${key}`;
          exact(authored, ['gameId', 'skillKey', 'effectKey', 'lifecycle', 'results', ...METADATA], authorPath);
          if (authored.gameId !== snapshot.gameId || authored.skillKey !== skillKey) fail(authorPath, '效果归属不一致');
          uniqueRows(authored.results, row => row.resultKey, `${authorPath}.results`);
          if (authored.lifecycle !== null) validateLifecycle(authored.lifecycle, `${authorPath}.lifecycle`);
          usedEffects.add(key);
          return authored;
        };
        const resultShape = (result: SkillEffectResult, resultPath: string) => {
          exact(result, ['resultKey', 'resultType', 'target', 'valueRule', 'detail', 'lifecycleBehavior', 'spellShieldBlockScope', ...METADATA], resultPath);
          if (!['SOURCE', 'TARGET'].includes(result.target) || result.spellShieldBlockScope !== null) fail(resultPath, '未知目标或未接入阻挡粒度');
          if (result.lifecycleBehavior !== null) exact(result.lifecycleBehavior, ['moment', 'valueReadMode', 'stackValueMode', 'reapplicationValueMode', 'periodicExecutionMode'], `${resultPath}.lifecycleBehavior`);
        };
        const process = (key: string, processPath: string) => {
          const authored = configuration.processes.find(row => row.processKey === key);
          if (!authored) fail(processPath, '过程引用缺失');
          const authorPath = `${root}.processes.${key}`;
          exact(authored, ['gameId', 'skillKey', 'processKey', 'activationType', 'cooldown', 'steps', 'effectBindings', 'stateOperations', ...METADATA], authorPath);
          const empowered = authored.steps.length === 1 && authored.steps[0]!.stepType === 'EMPOWERED_BASIC_ATTACK';
          if (authored.gameId !== snapshot.gameId || authored.skillKey !== skillKey || (empowered ? authored.activationType !== 'ACTIVE' : authored.activationType !== 'PASSIVE')
            || authored.cooldown !== null) fail(authorPath, '仅支持无费用、无冷却的完整即时被动过程');
          uniqueRows(authored.steps, row => row.stepKey, `${authorPath}.steps`);
          uniqueRows(authored.effectBindings, row => row.bindingKey, `${authorPath}.effectBindings`);
          uniqueRows(authored.stateOperations, row => row.operationKey, `${authorPath}.stateOperations`);
          if (!authored.steps.length) fail(authorPath, '即时被动过程缺少完整步骤');
          for (const step of ordered(authored.steps, `${authorPath}.steps`)) {
            exact(step, ['stepKey', 'stepType', 'detail', 'occupiesAction', ...METADATA], `${authorPath}.steps.${step.stepKey}`);
            if (step.occupiesAction != null && typeof step.occupiesAction !== 'boolean') fail(`${authorPath}.steps.${step.stepKey}.occupiesAction`, '行动占用必须是布尔或空值');
            if (empowered && step.stepType === 'EMPOWERED_BASIC_ATTACK') {
              exact(step.detail, ['windowValue', 'consumeMoment'], `${authorPath}.steps.${step.stepKey}.detail`);
              if (step.detail.consumeMoment !== 'ATTACK_HIT' || step.occupiesAction !== false) fail(authorPath, '强化待击只开放明确不占用行动、实际命中一次消费');
            } else {
              if (step.stepType !== 'IMMEDIATE') fail(`${authorPath}.steps.${step.stepKey}`, '只静态展开即时步骤或单段强化待击，不伪造延迟或循环');
              exact(step.detail, [], `${authorPath}.steps.${step.stepKey}.detail`);
            }
          }
          usedProcesses.add(key);
          return authored;
        };
        const momentOrder = (moment: SkillProcessMoment, authored: SkillProcess, momentPath: string) => {
          exact(moment, ['momentType', 'stepKey', 'failureReason'], momentPath);
          if (moment.failureReason != null) fail(momentPath, '即时过程不伪造失败时点');
          const steps = ordered(authored.steps, `${root}.processes.${authored.processKey}.steps`);
          if (moment.momentType === 'PROCESS_START' && moment.stepKey === null) return 0;
          if (moment.momentType === 'PROCESS_COMPLETE' && moment.stepKey === null) return 1 + steps.length * 3;
          const index = steps.findIndex(row => row.stepKey === moment.stepKey);
          const phase = ['STEP_START', 'STEP_EXECUTION', 'STEP_COMPLETE'].indexOf(moment.momentType);
          if (index < 0 || phase < 0) fail(momentPath, '缺失或未接入的真实过程时点');
          return 1 + index * 3 + phase;
        };
        const ruleShape = (rule: SkillTriggerRuleDetail) => {
          const rulePath = `${root}.triggerRules.${rule.ruleKey}`;
          exact(rule, ['ruleKey', 'eventSource', 'conditionGroups', 'actions', 'perTargetCooldown', 'maxTriggersPerProcess', 'oncePerUse', ...METADATA], rulePath);
          exact(rule.eventSource, ['eventType', 'detail'], `${rulePath}.eventSource`);
          if (rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null) fail(rulePath, '触发限制需要真实内部状态，不忽略未接入的规则限制');
          uniqueRows(rule.conditionGroups, row => row.groupKey, `${rulePath}.conditionGroups`);
          uniqueRows(rule.actions, row => row.actionKey, `${rulePath}.actions`);
          if (!rule.actions.length) fail(rulePath, '触发规则缺少完整动作');
        };
        configuration.triggerRules.forEach(ruleShape);
        if (side === 'source' && description.kind !== 'item') {
          const componentRules = configuration.triggerRules.filter(rule => isBasicAttackContributionRule(rule, configuration));
          if (componentRules.length) {
            if (skills.length !== 1 || configuration.processes.length || configuration.internalStates.length
              || componentRules.length !== configuration.triggerRules.length) fail(root,
              '直接普攻组成只接完整无状态静态来源，不能遗漏其它事件、过程或必要尾规则');
            contributesBasicAttack = true;
          }
        }
        const origin = (result: SkillEffectResult, authored: SkillEffect, abilityRef: string, compiledPaths: string[], dynamicDefinition?: string) => {
          const resultPath = `${root}.effects.${authored.effectKey}.results.${result.resultKey}`;
          const existing = operationOrigins.find(row => row.abilityRef === abilityRef && row.operationRef === resultPath && row.providerDefinitionRef === dynamicDefinition);
          if (existing) existing.compiledPaths.push(...compiledPaths.filter(compiled => !existing.compiledPaths.includes(compiled)));
          else operationOrigins.push({ abilityRef, operationRef: resultPath, skillKey, effectKey: authored.effectKey,
            resultKey: result.resultKey, compiledPaths, ...(dynamicDefinition ? { providerDefinitionRef: dynamicDefinition } : {}) });
          for (const compiledPath of compiledPaths) cover(resultPath, compiledPath);
        };
        const compileStateOperation = (operation: SkillProcessStateOperation, operationPath: string) => {
          exact(operation, ['operationKey', 'stateSkillKey', 'stateKey', 'moment', 'operation', 'value', 'optionKey', 'name', 'sortOrder'], operationPath);
          if (operation.optionKey !== null) fail(operationPath, '未接入内部模式选项');
          const state = lookupState(operation.stateKey, operation.stateSkillKey, operationPath);
          if (state.stateType === 'COUNTER' && ['INCREASE', 'DECREASE', 'CONSUME', 'SET'].includes(operation.operation) && operation.value) {
            constant(operation.value, `${operationPath}.value`, true);
            const expression = value(operation.value, `${operationPath}.value`);
            const decrease = operation.operation === 'DECREASE' || operation.operation === 'CONSUME';
            return stateChange(stateKey(state), operation.operation === 'SET' ? 'set' : 'add',
              decrease ? { op: 'mul', args: [constExpr(-1), expression] } : expression, state.scope);
          }
          if (state.stateType === 'INTERNAL_COOLDOWN' && ['START', 'RESET'].includes(operation.operation) && operation.value === null) {
            return stateChange(stateKey(state), 'set', constExpr(operation.operation === 'START' ? 1 : 0), state.scope);
          }
          if (state.stateType === 'FLAG' && ['ENABLE', 'DISABLE'].includes(operation.operation) && operation.value === null) {
            return stateChange(stateKey(state), 'set', constExpr(operation.operation === 'ENABLE' ? 1 : 0), state.scope);
          }
          return fail(operationPath, '状态操作与真实COUNTER或内部冷却不一致');
        };
        const ensureStack = (authored: SkillEffect) => {
          const existing = stackEffects.get(authored.effectKey);
          if (existing) return existing;
          const authorPath = `${root}.effects.${authored.effectKey}`;
          const life = authored.lifecycle!;
          if (life.instanceScope !== 'SOURCE' || life.periodicIntervalValue !== null || life.firstPeriodicExecution !== null
            || life.expiryMode !== 'ALL_AT_ONCE' || !['INCREASE', 'KEEP', 'REPLACE'].includes(life.reapplicationStackMode)
            || !['REFRESH_ALL', 'KEEP_REMAINING'].includes(life.reapplicationDurationMode ?? '')) fail(`${authorPath}.lifecycle`, '来源叠层需要完整有期、同刻到期且无周期的生命周期');
          life.durationValue ? constant(life.durationValue, `${authorPath}.lifecycle.durationValue`, true, 1) : fail(authorPath, '来源叠层时长缺失');
          const maximum = constant(life.maxStacksValue, `${authorPath}.lifecycle.maxStacksValue`, true, 1);
          const stacks = constant(life.applicationStacksValue, `${authorPath}.lifecycle.applicationStacksValue`, true, 1);
          if (stacks > maximum || life.reapplicationStackMode === 'KEEP' && maximum !== 1) fail(authorPath, '未接入保持多层的叠层方式');
          const key = namedKey(skillKey, `effect_${authored.effectKey}`);
          if (schema[key]) fail(authorPath, '生命周期状态标识与内部状态冲突');
          const refreshPolicy = life.reapplicationDurationMode === 'REFRESH_ALL' ? 'refresh_on_write' : 'start_on_first_write';
          schema[key] = { valueType: 'integer', defaultValue: 0, maxValue: staticField(life.maxStacksValue, authorPath + '.lifecycle.maxStacksValue', numeric, fail), durationMs: staticField(life.durationValue!, authorPath + '.lifecycle.durationValue', numeric, fail), refreshPolicy };
          if (!authored.results.length) fail(authorPath, '来源叠层缺少完整属性结果');
          for (const result of ordered(authored.results, `${authorPath}.results`)) {
            const resultPath = `${authorPath}.results.${result.resultKey}`;
            resultShape(result, resultPath);
            if (result.resultType !== 'ATTRIBUTE_CHANGE' || result.target !== 'SOURCE') fail(resultPath, '来源叠层只接入拥有方持久属性结果');
            exact(result.detail, ['attributeKey', 'operation', 'modifierZoneKey'], `${resultPath}.detail`);
            const behavior = result.lifecycleBehavior;
            if (!behavior || behavior.moment !== 'PERSISTENT' || behavior.valueReadMode !== 'APPLICATION_SNAPSHOT'
              || !['SHARED', 'PER_STACK'].includes(behavior.stackValueMode ?? '')
              || (behavior.stackValueMode === 'PER_STACK' ? behavior.reapplicationValueMode !== null : behavior.reapplicationValueMode !== 'REPLACE')
              || behavior.periodicExecutionMode !== null || !['INCREASE', 'DECREASE'].includes(result.detail.operation)) fail(resultPath, '来源叠层属性读取、重施或数值方式未接入');
            let policy = 'add';
            if (result.detail.modifierZoneKey !== null) {
              const zones = snapshot.catalogs.modifierZones.filter(row => row.modifierZoneKey === result.detail.modifierZoneKey);
              const zone = zones[0];
              if (zones.length !== 1 || !zone || zone.gameId !== snapshot.gameId || zone.status !== 'ENABLED' || zone.domain !== 'ATTRIBUTE'
                || !(zone.calculationMode === 'FLAT_ADD' && zone.applicationStage === 'ATTRIBUTE_FLAT'
                  || zone.calculationMode === 'RATIO_ADD' && zone.applicationStage === 'ATTRIBUTE_PERCENT')) fail(resultPath, '来源属性修正区缺少完整真实目录');
              policy = zone.calculationMode === 'FLAT_ADD' ? 'add' : 'percent_add';
              cover(`catalogs.modifierZones.${zone.modifierZoneKey}`, `${compiledRoot}.modifiers[${modifiers.length}]`);
            }
            stableKey(result.detail.attributeKey, `${resultPath}.detail.attributeKey`);
            required[side].add(result.detail.attributeKey);
            changed[side].add(result.detail.attributeKey);
            const magnitude = foldAmount(result, resultPath) * (result.detail.operation === 'DECREASE' ? -1 : 1);
            const read: GenericFormulaExpr = { op: 'read', path: `provider.state.${key}` };
            const layers = behavior.stackValueMode === 'PER_STACK' ? read : { op: 'min', args: [constExpr(1), read] };
            const modifierPath = `${compiledRoot}.modifiers[${modifiers.length}]`;
            modifiers.push({ modifierKey: namedKey(skillKey, `${authored.effectKey}_${result.resultKey}`), kind: 'attribute',
              target: `self.attr.${result.detail.attributeKey}`, valuePolicy: policy, value: { op: 'mul', args: [constExpr(magnitude), layers] } });
            cover(resultPath, modifierPath);
            cover(`${resultPath}.valueRule`, `${modifierPath}.value`);
            cover(`${resultPath}.lifecycleBehavior`, modifierPath);
          }
          const stack = { key, amount: stacks, policy: life.reapplicationStackMode === 'INCREASE' ? 'add' : 'set' };
          stackEffects.set(authored.effectKey, stack);
          cover(`${authorPath}.lifecycle`, `${compiledRoot}.initialStateSchema.${key}`);
          return stack;
        };
        const comparator = (key: string, left: GenericFormulaExpr, right: GenericFormulaExpr, conditionPath: string): GenericFormulaExpr => {
          const operation = ({ LT: 'lt', LTE: 'lte', EQ: 'eq', NE: 'ne', GTE: 'gte', GT: 'gt' } as Record<string, string>)[key];
          if (!operation) fail(conditionPath, '未知比较符');
          return { op: operation, args: [left, right] };
        };
        const condition = (authored: SkillTriggerCondition, conditionPath: string, event: string): GenericFormulaExpr => {
          exact(authored, ['conditionKey', 'conditionType', 'sortOrder', 'detail'], conditionPath);
          const detailPath = `${conditionPath}.detail`;
          if (authored.conditionType === 'STATUS_CHECK') {
            cover(`catalogs.statuses.${authored.detail.statusKey}`, `${compiledRoot}.abilities`);
            return compileSimulationStatusCondition(snapshot, authored, detailPath, statusKey => types.set(`status/${statusKey}`, 'status'));
          }
          if (authored.conditionType === 'INTERNAL_STATE_CHECK') {
            const detail = authored.detail;
            exact(detail, ['stateSkillKey', 'stateKey', 'valueKind', 'optionKey', 'expectedBoolean', 'comparator', 'comparisonValue'], detailPath);
            const state = lookupState(detail.stateKey, detail.stateSkillKey, detailPath);
            if (detail.optionKey !== null || detail.expectedBoolean !== null || !detail.comparisonValue || !detail.comparator) fail(detailPath, '真实数值状态检查字段不完整');
            const read = stateRead(state);
            if (state.stateType === 'COUNTER' && detail.valueKind === 'VALUE') {
              constant(detail.comparisonValue, `${detailPath}.comparisonValue`, true);
              return comparator(detail.comparator, read, value(detail.comparisonValue, detailPath), detailPath);
            }
            if (state.stateType === 'INTERNAL_COOLDOWN' && detail.valueKind === 'REMAINING_MS'
              && constant(detail.comparisonValue, detailPath) === 0) return comparator(detail.comparator, read, constExpr(0), detailPath);
            return fail(detailPath, '内部冷却只接入真实与零的就绪判断，不把活动标记当毫秒');
          }
          if (authored.conditionType === 'LIFECYCLE_CHECK') {
            const detail = authored.detail;
            exact(detail, ['effectSkillKey', 'effectKey', 'subject', 'checkKind', 'comparator', 'comparisonValue'], detailPath);
            if (detail.effectSkillKey !== skillKey || detail.subject !== null) fail(detailPath, 'SOURCE生命周期条件由当前来源保存，subject必须为空');
            const authoredEffect = effect(detail.effectKey, detailPath);
            if (authoredEffect.lifecycle?.endWhenShieldEndsResultKey != null) {
              if (detail.comparator !== null || detail.comparisonValue !== null || !['PRESENT', 'ABSENT'].includes(detail.checkKind)) fail(detailPath, '关联盾生命周期只接入存在或不存在检查');
              if (authoredEffect.lifecycle.instanceScope !== 'SOURCE') fail(detailPath, '关联盾存在检查本期只接入来源自身，不能猜测目标身份');
              const compiled = compileLinkedShieldEffect(authoredEffect, numeric, snapshot.catalogs.modifierZones, definitionRef);
              const existing = providers.find(row => row.providerKey === compiled.provider.providerKey);
              if (existing && JSON.stringify(existing) !== JSON.stringify(compiled.provider)) fail(detailPath, '关联盾定义不一致');
              if (!existing) providers.push(compiled.provider);
              for (const row of authoredEffect.results) if (row.valueRule) noteNumeric(row.valueRule.value);
              if (authoredEffect.lifecycle.durationValue) noteNumeric(authoredEffect.lifecycle.durationValue);
              noteNumeric(authoredEffect.lifecycle.maxStacksValue); noteNumeric(authoredEffect.lifecycle.applicationStacksValue);
              queriedShieldEffects.add(authoredEffect.effectKey);
              collectAttributes(compiled.provider, side, required);
              const read: GenericFormulaExpr = { op: 'read', path: `provider.linked_shield[${compiled.operation.shieldRef}].present` };
              cover(`${root}.effects.${authoredEffect.effectKey}.lifecycle`, `sharedProviders.${compiled.provider.providerKey}.lifecycle`);
              return comparator(detail.checkKind === 'PRESENT' ? 'GT' : 'EQ', read, constExpr(0), detailPath);
            }
            const stack = ensureStack(authoredEffect);
            const read: GenericFormulaExpr = { op: 'read', path: `provider.state.${stack.key}` };
            if (detail.checkKind === 'STACKS_COMPARE' && detail.comparator && detail.comparisonValue) return comparator(detail.comparator, read, value(detail.comparisonValue, detailPath), detailPath);
            if (detail.comparator !== null || detail.comparisonValue !== null || !['PRESENT', 'ABSENT'].includes(detail.checkKind)) fail(detailPath, '生命周期存在检查字段不完整');
            return comparator(detail.checkKind === 'PRESENT' ? 'GT' : 'EQ', read, constExpr(0), detailPath);
          }
          if (authored.conditionType === 'ATTRIBUTE_COMPARE') {
            const detail = authored.detail;
            exact(detail, ['subject', 'attributeKey', 'attributeValueKind', 'comparator', 'comparisonValue'], detailPath);
            if (!['SOURCE', 'CURRENT_TARGET', 'EVENT_SOURCE'].includes(detail.subject)) fail(detailPath, '未知条件属性对象');
            const receiver = event === 'DAMAGE_TAKEN' || event === 'BASIC_ATTACK_RECEIVED';
            const expression = compileAttributeValue({ attributeOwner: detail.subject === 'CURRENT_TARGET' && !receiver ? 'TARGET' : 'SOURCE',
              attributeKey: detail.attributeKey, attributeValueKind: detail.attributeValueKind }, detailPath, numeric, fail);
            const eventRead = (node: GenericFormulaExpr): GenericFormulaExpr => ({ ...node,
              ...(node.path ? { path: node.path.replace(/^source\.attr\./, 'event.source.attr.') } : {}),
              ...(node.args ? { args: node.args.map(eventRead) } : {}) });
            if (detail.subject === 'EVENT_SOURCE') required[event === 'DAMAGE_TAKEN' || event === 'BASIC_ATTACK_RECEIVED' ? opponent : side].add(detail.attributeKey);
            return comparator(detail.comparator, detail.subject === 'EVENT_SOURCE' && event !== 'PROCESS_MOMENT'
              ? eventRead(expression) : expression, value(detail.comparisonValue, detailPath), detailPath);
          }
          if (authored.conditionType === 'TARGET_CATEGORY_CHECK' || authored.conditionType === 'SKILL_HIT_TARGET_IS_ENEMY') {
            if (authored.conditionType === 'TARGET_CATEGORY_CHECK') {
              exact(authored.detail, ['categories'], detailPath);
              const categories = array(authored.detail.categories, `${detailPath}.categories`);
              if (!categories.length || new Set(categories).size !== categories.length
                || categories.some(key => !SKILL_TRIGGER_TARGET_CATEGORIES.includes(key))) fail(detailPath, '目标类别集合不完整或未知');
            } else {
              exact(authored.detail, [], detailPath);
              // 两方宿主的命中计划只接入来源到明确对手；自身目标在请求入口拒绝。
              if (event !== 'SKILL_HIT' || side !== 'source') fail(detailPath, '敌方命中检查必须来自实际驱动来源的真实对手命中');
              const owner = record(snapshot[side].character, `${side}.character`);
              if (owner.gameId !== snapshot.gameId || owner.characterKey !== snapshot.selection[`${side}CharacterKey`]) {
                fail(`${side}.character.characterKey`, '英雄选择与真实来源快照归属不一致，不能推断敌我');
              }
              cover(`${side}.character.characterKey`, `combatants[${side === 'source' ? 0 : 1}].types`);
            }
            const character = record(snapshot[opponent].character, `${opponent}.character`);
            const characterKey = stableKey(character.characterKey, `${opponent}.character.characterKey`);
            if (character.gameId !== snapshot.gameId || characterKey !== snapshot.selection[`${opponent}CharacterKey`]) {
              fail(`${opponent}.character.characterKey`, '英雄选择与真实角色快照归属不一致，不能推断目标类别');
            }
            const identityPath = `combatants[${opponent === 'source' ? 0 : 1}].types`;
            cover(`${opponent}.character.characterKey`, identityPath);
            cover(`selection.${opponent}CharacterKey`, identityPath);
            return compileHitIdentityCondition(authored, detailPath, {
              identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } }
            });
          }
          if (authored.conditionType === 'EVENT_VALUE_COMPARE') {
            exact(authored.detail, ['eventValueKey', 'comparator', 'comparisonValue'], detailPath);
            if (String(authored.detail.eventValueKey) === 'SKILL_USE_CONTACT_COUNT') {
              if (event !== 'PROCESS_RESOLVED') fail(detailPath, '接触计数仅由真实过程终结命中后事实提供');
              constant(authored.detail.comparisonValue, `${detailPath}.comparisonValue`, true);
              return comparator(authored.detail.comparator, { op: 'read', path: 'event.skill_use.contactCount' }, value(authored.detail.comparisonValue, detailPath), detailPath);
            }
            const link = ({ LINK_INDEX: 'event.link.index', LINK_COUNT: 'event.link.count' } as Record<string, string>)[authored.detail.eventValueKey];
            if (!link || !['HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED'].includes(event)) fail(detailPath, '事件数值没有已接入的真实冻结字段');
            return comparator(authored.detail.comparator, { op: 'read', path: link }, value(authored.detail.comparisonValue, detailPath), detailPath);
          }
          return fail(conditionPath, '未接入的条件节点不能被丢弃');
        };
        const conditions = (rule: SkillTriggerRuleDetail, event: string): GenericFormulaExpr | undefined => {
          const rulePath = `${root}.triggerRules.${rule.ruleKey}`;
          if (!rule.conditionGroups.length) return undefined;
          return combine('max', ordered(rule.conditionGroups, `${rulePath}.conditionGroups`).map(group => {
            const groupPath = `${rulePath}.conditionGroups.${group.groupKey}`;
            exact(group, ['groupKey', 'name', 'sortOrder', 'conditions'], groupPath);
            uniqueRows(group.conditions, row => row.conditionKey, `${groupPath}.conditions`);
            return combine('min', ordered(group.conditions, `${groupPath}.conditions`)
              .map(row => condition(row, `${groupPath}.conditions.${row.conditionKey}`, event)));
          }));
        };
        const compileDamage = (result: SkillEffectDamageResult, resultPath: string): OperationDefinition => {
          exact(result.detail, ['damageTypeKey', 'deliveryKind', 'originKind', 'critical', 'vampQualification', 'vampOverrides'], `${resultPath}.detail`);
          if (result.target !== 'TARGET' || !['SKILL', 'BASIC_ATTACK'].includes(result.detail.deliveryKind)
            || !['DIRECT', 'REFLECTED'].includes(result.detail.originKind)) fail(resultPath, '伤害目标或特征未知');
          const operation: OperationDefinition = { operation: 'damage', target: 'target', ref: resultPath,
            damageType: defense(result.detail.damageTypeKey), amount: amount(result, resultPath) };
          exact(result.detail.critical, ['mode', 'multiplierValue'], `${resultPath}.detail.critical`);
          const critical = result.detail.critical;
          if (critical.mode === 'DISALLOWED') {
            if (critical.multiplierValue !== null) fail(resultPath, '禁止暴击不能保留倍率');
            operation.critEligible = false;
          } else if (critical.mode === 'SOURCE_CRIT_CHANCE' || critical.mode === 'FORCED') {
            if (!critical.multiplierValue) fail(resultPath, '暴击必须保留原作者倍率');
            operation.critEligible = true;
            Object.assign(operation, simulationCriticalBinding(snapshot, critical.mode === 'FORCED', `${resultPath}.detail.critical.mode`));
            operation.critMultiplier = value(critical.multiplierValue, `${resultPath}.detail.critical.multiplierValue`, 'criticalMultiplier');
          } else fail(resultPath, '未知暴击模式');
          if (result.detail.vampQualification !== 'RESOLVED') fail(`${resultPath}.detail.vampQualification`, '吸血资格尚未核定，整件装备拒绝');
          for (const [index, override] of array(result.detail.vampOverrides, `${resultPath}.detail.vampOverrides`).entries()) {
            const overridePath = `${resultPath}.detail.vampOverrides[${index}]`;
            exact(override, ['vampType', 'mode', 'basisOutputKind', 'efficiencyValue'], overridePath);
            if (override.efficiencyValue) {
              validateNumeric(override.efficiencyValue, `${overridePath}.efficiencyValue`);
              noteNumeric(override.efficiencyValue);
            }
          }
          exact(snapshot.catalogs.vampRules, ['rules'], 'catalogs.vampRules');
          for (const [index, vampRule] of array(snapshot.catalogs.vampRules.rules, 'catalogs.vampRules.rules').entries()) {
            exact(vampRule, ['vampType', 'sourceAttributeKey', 'basisOutputKind', 'defaultEfficiency', 'deliveryKinds', 'originKinds', 'skillCategoryKeys'], `catalogs.vampRules.rules[${index}]`);
          }
          const vamp = adaptDamageVamp(snapshot.catalogs.vampRules.rules, { gameId: snapshot.gameId, skillKey,
            skillCategoryKeys: configuration.skill.skillCategoryKeys, skillLevel, characterLevel: snapshot.selection[`${side}Level`],
            detail: result.detail, parameters: configuration.parameters, formulas: configuration.formulas });
          if (rules.vampRules && JSON.stringify(rules.vampRules) !== JSON.stringify(vamp.rules)) fail(resultPath, '游戏吸血规则冲突');
          rules.vampRules = vamp.rules;
          const names = new Map(vamp.formulas.map(formula => [formula.key, `${numeric.formulaNamespace}/${formula.key}`]));
          Object.assign(operation, vamp.operation, { vampOverrides: vamp.operation.vampOverrides?.map((override, index) => {
            if (override.mode !== 'OVERRIDE') return override;
            if (!contributesBasicAttack) return { ...override, efficiency: renameFormulaRefs(override.efficiency, names) };
            const authoredIndex = result.detail.vampOverrides.findIndex(row => row.vampType === override.vampType);
            const authored = result.detail.vampOverrides[authoredIndex]!;
            const efficiency = lowerBasicAttackContributionValue(authored.efficiencyValue!, contributionAuthor(),
              `${resultPath}.detail.vampOverrides[${authoredIndex}].efficiencyValue`, 'vampEfficiency');
            return { ...override, efficiency: lowerContribution(efficiency, `vampOverrides[${index}].efficiency`) };
          }) });
          if (!contributesBasicAttack) {
            Object.assign(numeric.params, vamp.params);
            for (const formula of vamp.formulas) addFormula({ ...structuredClone(formula), key: names.get(formula.key)! }, resultPath);
          }
          for (const entry of vamp.typeEntries) {
            if (entry.domain === 'ability') {
              if (!entry.key.startsWith(SKILL_CATEGORY_TYPE_PREFIX)) fail(resultPath, '吸血作者分类类型需要明确的分类作用域');
              category(entry.key.slice(SKILL_CATEGORY_TYPE_PREFIX.length));
            }
            types.set(entry.key, entry.domain);
          }
          for (const [index, vampRule] of vamp.rules.entries()) {
            required[side].add(vampRule.sourceAttributeKey);
            cover(`catalogs.vampRules.rules[${snapshot.catalogs.vampRules.rules.findIndex(row => row.vampType === vampRule.vampType)}]`, `rules.vampRules[${index}]`);
          }
          return operation;
        };
        const addResult = (result: SkillEffectResult, authored: SkillEffect, output: OperationDefinition[], outputRoot: string,
          abilityRef: string, dynamicDefinition?: string) => {
          const resultPath = `${root}.effects.${authored.effectKey}.results.${result.resultKey}`;
          resultShape(result, resultPath);
          const operationPath = `${outputRoot}[${output.length}]`;
          let operation: OperationDefinition;
          if (result.resultType === 'DAMAGE') {
            operation = compileDamage(result, resultPath);
          } else if (result.resultType === 'HIT_LINK_APPLICATION' || result.resultType === 'ATTACK_LINK_APPLICATION') {
            exact(result.detail, [], `${resultPath}.detail`);
            if (result.target !== 'TARGET' || authored.lifecycle !== null || result.lifecycleBehavior !== null) fail(resultPath, '命中联动必须有完整即时对手次数');
            const hit = result.resultType === 'HIT_LINK_APPLICATION';
            types.set(hit ? 'event/hit_link_applied' : 'event/attack_link_applied', 'event');
            operation = { operation: hit ? 'apply_hit_link' : 'apply_attack_link', target: 'target', ref: resultPath, amount: amount(result, resultPath) };
          } else if (result.resultType === 'ATTRIBUTE_CHANGE') {
            if (!authored.lifecycle) fail(resultPath, '属性修正缺少真实生命周期');
            exact(result.detail, ['attributeKey', 'operation', 'modifierZoneKey'], `${resultPath}.detail`);
            const zones = snapshot.catalogs.modifierZones.filter(zone => zone.modifierZoneKey === result.detail.modifierZoneKey);
            const zone = zones[0];
            if (zones.length !== 1 || !zone || zone.gameId !== snapshot.gameId || zone.status !== 'ENABLED'
              || zone.domain !== 'ATTRIBUTE' || !(zone.calculationMode === 'FLAT_ADD' && zone.applicationStage === 'ATTRIBUTE_FLAT'
                || ['RATIO_ADD', 'RATIO_MULTIPLY'].includes(zone.calculationMode) && zone.applicationStage === 'ATTRIBUTE_PERCENT')) {
              fail(resultPath, '目标属性修正区需要唯一已启用、同游戏的真实属性目录与对应作用阶段');
            }
            amount(result, resultPath);
            for (const field of ['durationValue', 'maxStacksValue', 'applicationStacksValue'] as const) {
              if (!authored.lifecycle[field]) fail(`${resultPath}.lifecycle.${field}`, '属性生命周期缺项');
              value(authored.lifecycle[field]!, `${root}.effects.${authored.effectKey}.lifecycle.${field}`);
            }
            const key = `${definitionRef}_${skillKey}_${authored.effectKey}_${result.resultKey}`;
            const compiled = compilePersistentResult({ gameId: snapshot.gameId, skillKey, skillLevel,
              characterLevel: snapshot.selection[`${side}Level`], effectKey: authored.effectKey, lifecycle: authored.lifecycle, result,
              parameters: configuration.parameters, formulas: configuration.formulas, statuses: snapshot.catalogs.statuses,
              modifierZones: snapshot.catalogs.modifierZones, source: 'source', target: 'target' }, key);
            compiled.provider.stableId = provider.stableId;
            Object.assign(numeric.params, compiled.params);
            const names = new Map(compiled.formulas.map(formula => [formula.key, `${numeric.formulaNamespace}/${formula.key}`]));
            for (const formula of compiled.formulas) addFormula({ ...structuredClone(formula), key: names.get(formula.key)! }, resultPath);
            if (compiled.provider.lifecycle?.durationMs) {
              compiled.provider.lifecycle.durationMs = renameFormulaRefs(compiled.provider.lifecycle.durationMs, names);
            }
            compiled.provider.modifiers = compiled.provider.modifiers!.map(modifier => ({
              ...modifier, value: renameFormulaRefs(modifier.value, names)
            }));
            if (!providers.some(row => row.providerKey === key)) providers.push(compiled.provider);
            required[result.target === 'SOURCE' ? side : opponent].add(result.detail.attributeKey);
            changed[result.target === 'SOURCE' ? side : opponent].add(result.detail.attributeKey);
            collectAttributes(compiled.provider, side, required);
            operation = { ...compiled.operation, ref: resultPath };
            cover(`${root}.effects.${authored.effectKey}.lifecycle`, `sharedProviders.${key}.lifecycle`);
            cover(`catalogs.modifierZones.${result.detail.modifierZoneKey}`, `sharedProviders.${key}.modifiers[0]`);
            cover(resultPath, `sharedProviders.${key}.modifiers[0]`);
          } else if (result.resultType === 'HEALING_MODIFIER') {
            if (!authored.lifecycle) fail(resultPath, '受到治疗降低缺少真实生命周期');
            exact(result.detail, ['modifierZoneKey', 'direction', 'operation', 'healingKind'], `${resultPath}.detail`);
            const zones = snapshot.catalogs.modifierZones.filter(row => row.modifierZoneKey === result.detail.modifierZoneKey);
            if (zones.length !== 1 || zones[0]!.gameId !== snapshot.gameId || zones[0]!.status !== 'ENABLED' || zones[0]!.applicationStage !== 'HEALING_RESULT') fail(resultPath, '减疗修正区需要唯一已启用的真实目录');
            amount(result, resultPath);
            const life = authored.lifecycle;
            for (const field of ['durationValue', 'maxStacksValue', 'applicationStacksValue'] as const) {
              if (!life[field]) fail(`${resultPath}.lifecycle.${field}`, '减疗生命周期缺项');
              value(life[field]!, `${root}.effects.${authored.effectKey}.lifecycle.${field}`);
            }
            const key = `${definitionRef}_${skillKey}_${authored.effectKey}_${result.resultKey}`;
            const compiled = compilePersistentResult({ gameId: snapshot.gameId, skillKey, skillLevel,
              characterLevel: snapshot.selection[`${side}Level`], effectKey: authored.effectKey, lifecycle: life, result,
              parameters: configuration.parameters, formulas: configuration.formulas, statuses: snapshot.catalogs.statuses,
              modifierZones: snapshot.catalogs.modifierZones, source: 'source', target: 'target' }, key);
            compiled.provider.stableId = provider.stableId;
            if (!providers.some(row => row.providerKey === key)) providers.push(compiled.provider);
            Object.assign(numeric.params, compiled.params);
            const names = new Map(compiled.formulas.map(formula => [formula.key, `${numeric.formulaNamespace}/${formula.key}`]));
            for (const formula of compiled.formulas) addFormula({ ...structuredClone(formula), key: names.get(formula.key)! }, resultPath);
            if (compiled.provider.lifecycle?.durationMs) {
              compiled.provider.lifecycle.durationMs = renameFormulaRefs(compiled.provider.lifecycle.durationMs, names);
            }
            compiled.provider.modifiers = compiled.provider.modifiers!.map(modifier => ({
              ...modifier, value: renameFormulaRefs(modifier.value, names)
            }));
            collectAttributes(compiled.provider, side, required);
            operation = { ...compiled.operation, ref: resultPath };
            cover(`${root}.effects.${authored.effectKey}.lifecycle`, `sharedProviders.${key}.lifecycle`);
            cover(`catalogs.modifierZones.${result.detail.modifierZoneKey}`, `sharedProviders.${key}.modifiers[0]`);
            cover(resultPath, `sharedProviders.${key}.modifiers[0]`);
          } else if (result.resultType === 'STATUS_OPERATION') {
            if (!authored.lifecycle || authored.results.length !== 1) fail(resultPath, '普通减速需要唯一结果和完整生命周期，不能混合持续结果');
            exact(result.detail, ['statusKey', 'operation'], `${resultPath}.detail`);
            const statusPath = `catalogs.statuses.${result.detail.statusKey}`;
            const statuses = array(snapshot.catalogs.statuses, 'catalogs.statuses').filter(row => row.statusKey === result.detail.statusKey);
            if (statuses.length !== 1 || statuses[0]!.gameId !== snapshot.gameId || statuses[0]!.status !== 'ENABLED'
              || statuses[0]!.statusKind !== 'MOVEMENT_SLOW') fail(statusPath, '普通减速需要唯一已启用且同游戏的真实状态目录');
            exact(statuses[0], ['gameId', 'statusKey', 'statusKind', 'status', ...METADATA], statusPath);
            amount(result, resultPath);
            const life = authored.lifecycle;
            for (const field of ['durationValue', 'maxStacksValue', 'applicationStacksValue'] as const) {
              if (!life[field]) fail(`${resultPath}.lifecycle.${field}`, '普通减速生命周期缺项');
              value(life[field]!, `${root}.effects.${authored.effectKey}.lifecycle.${field}`);
            }
            const key = `${definitionRef}_${skillKey}_${authored.effectKey}_${result.resultKey}`;
            const compiled = compilePersistentResult({ gameId: snapshot.gameId, skillKey, skillLevel,
              characterLevel: snapshot.selection[`${side}Level`], effectKey: authored.effectKey, lifecycle: life, result,
              parameters: configuration.parameters, formulas: configuration.formulas, statuses: snapshot.catalogs.statuses,
              modifierZones: snapshot.catalogs.modifierZones, source: 'source', target: 'target' }, key);
            compiled.provider.stableId = provider.stableId;
            Object.assign(numeric.params, compiled.params);
            const names = new Map(compiled.formulas.map(formula => [formula.key, `${numeric.formulaNamespace}/${formula.key}`]));
            for (const formula of compiled.formulas) addFormula({ ...structuredClone(formula), key: names.get(formula.key)! }, resultPath);
            if (compiled.provider.lifecycle?.durationMs) {
              compiled.provider.lifecycle.durationMs = renameFormulaRefs(compiled.provider.lifecycle.durationMs, names);
            }
            compiled.provider.statusContributions = compiled.provider.statusContributions!.map(contribution => ({
              ...contribution, strength: renameFormulaRefs(contribution.strength, names)
            }));
            if (!providers.some(row => row.providerKey === key)) providers.push(compiled.provider);
            collectAttributes(compiled.provider, side, required);
            operation = { ...compiled.operation, ref: resultPath };
            const contributionPath = `sharedProviders.${key}.statusContributions[0]`;
            cover(`${root}.effects.${authored.effectKey}.lifecycle`, `sharedProviders.${key}.lifecycle`);
            cover(statusPath, contributionPath);
            cover(resultPath, contributionPath);
            cover(`${resultPath}.valueRule`, `${contributionPath}.strength`);
          } else fail(resultPath, '未接入的完整效果结果，整件装备拒绝');
          output.push(operation);
          origin(result, authored, abilityRef, [operationPath], dynamicDefinition);
          for (const field of ['target', 'valueRule', 'lifecycleBehavior', 'detail'] as const) cover(`${resultPath}.${field}`, operationPath);
          if (result.resultType === 'DAMAGE') {
            cover(`${resultPath}.valueRule`, `${operationPath}.amount`);
            for (const [field, compiled] of [['damageTypeKey', 'damageType'], ['deliveryKind', 'types'], ['originKind', 'types'],
              ['critical', 'critEligible'], ['vampQualification', 'vampQualification'], ['vampOverrides', 'vampOverrides']]) cover(`${resultPath}.detail.${field}`, `${operationPath}.${compiled}`);
            if (operation.critChance) cover(`${resultPath}.detail.critical.mode`, `${operationPath}.critChance`);
            if (operation.critMultiplier) cover(`${resultPath}.detail.critical.multiplierValue`, `${operationPath}.critMultiplier`);
            collectAttributes(rules.damageTypeFormulas!.find(row => row.damageType === operation.damageType)!.formula, side, required);
          }
        };
        const targetFor = (action: SkillTriggerAction, event: string, actionPath: string) => {
          if (action.targetContext === 'CURRENT_TARGET') return event === 'DAMAGE_TAKEN' || event === 'BASIC_ATTACK_RECEIVED' || event === 'SOURCE_INITIALIZED' ? 'self' : 'target';
          if (action.targetContext === 'EVENT_SOURCE') {
            if (event === 'DAMAGE_TAKEN' || event === 'BASIC_ATTACK_RECEIVED') return 'target';
            if (['BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'ATTACK_LINK_APPLIED', 'HIT_LINK_APPLIED', 'SKILL_USED', 'SKILL_HIT', 'PROCESS_MOMENT', 'PROCESS_RESOLVED', 'DAMAGE_DEALT', 'SOURCE_INITIALIZED'].includes(event)) return 'self';
          }
          return fail(actionPath, '动作目标缺少真实事件来源到当前对手的完整映射');
        };
        const actionShape = (action: SkillTriggerAction, actionPath: string) => {
          exact(action, ['actionKey', 'actionType', 'detail', 'targetContext', 'runtimeInputBindings', 'resultModifiers', ...METADATA], actionPath);
          if (array(action.runtimeInputBindings, `${actionPath}.runtimeInputBindings`).length
            || array(action.resultModifiers, `${actionPath}.resultModifiers`).length) fail(actionPath, '未接入的运行时绑定或结果修饰不能丢弃');
        };
        const executeEffect = (authored: SkillEffect, output: OperationDefinition[], outputRoot: string, abilityRef: string,
          event: string, actionPath: string, context: string) => {
          const effectPath = `${root}.effects.${authored.effectKey}`;
          appliedEffects.add(authored.effectKey);
          if (activeEffects.has(authored.effectKey)) fail(effectPath, '效果接线循环');
          activeEffects.add(authored.effectKey);
          try {
            if (authored.lifecycle?.expiryMode === 'ALL_AT_ONCE' && authored.results.some(result => result.resultType === 'DAMAGE_MODIFIER'
              || result.resultType === 'ATTRIBUTE_CHANGE' && snapshot.catalogs.modifierZones.some(zone => zone.modifierZoneKey === result.detail.modifierZoneKey
                && zone.calculationMode === 'RATIO_COMPLEMENT_MULTIPLY'))) fail(effectPath, '新增有限减伤与补集属性目前仅接真实过程施加，不把自然触发编译成功当运行准入');
            if (authored.lifecycle?.periodicIntervalValue !== null && authored.lifecycle?.periodicIntervalValue !== undefined) {
              compilePeriodic(authored, output, outputRoot, event, actionPath);
            } else if (authored.lifecycle?.instanceScope === 'SOURCE' && authored.lifecycle.expiryMode === 'EXPLICIT_ONLY' && source.permanentModifier) {
              if (description.kind === 'item' && (event !== 'SOURCE_INITIALIZED' || context !== 'self')) {
                fail(actionPath, '装备永久结果只开放无条件拥有方初始化和明确自身动作');
              }
              if (!authored.results.length) fail(effectPath, '永久效果缺少完整并列结果');
              for (const result of ordered(authored.results, `${effectPath}.results`)) {
                const resultPath = `${effectPath}.results.${result.resultKey}`;
                resultShape(result, resultPath);
                if (!result.valueRule) fail(`${resultPath}.valueRule`, '永久结果缺少完整数值规则');
                validateValueRule(result.valueRule, `${resultPath}.valueRule`);
                const key = [definitionRef, skillKey, authored.effectKey, result.resultKey].join('/');
                const operationPath = `${outputRoot}[${output.length}]`;
                const modifier = source.permanentModifier(result, resultPath, (authoredValue, authorPath, expression) => {
                  noteNumeric(authoredValue);
                  const consumedPath = authorPath.startsWith(`${effectPath}.lifecycle.`) ? operationPath : `sharedProviders.${key}.modifiers[0].value`;
                  cover(authorPath, consumedPath);
                  if (authoredValue.kind === 'PARAMETER') cover(`${root}.parameters.${authoredValue.parameterKey}`, consumedPath);
                  if (authoredValue.kind === 'FORMULA') {
                    if (expression.op !== 'ref' || !expression.ref) fail(authorPath, '已消费共同公式缺少实际程序引用');
                    cover(`${root}.formulas.${authoredValue.formulaKey}.expression`, `formulas[${expression.ref}].expression`);
                    const formula = configuration.formulas.find(row => row.formulaKey === authoredValue.formulaKey)!;
                    for (const parameterKey of skillFormulaParameterKeys(formula.expression, false)) cover(`${root}.parameters.${parameterKey}`, consumedPath);
                  }
                });
                if (!providers.some(row => row.providerKey === key)) providers.push({
                  providerKey: key, skillKey, stableId, kind: 'status', modifiers: [modifier]
                });
                output.push({ operation: 'apply_provider', target: 'self', providerDefinitionRef: key, providerRef: key, ref: resultPath });
                if (result.resultType === 'ATTRIBUTE_CHANGE') {
                  const attributeKey = String(result.detail.attributeKey);
                  const recipient = result.target === 'TARGET' ? opponent : side;
                  required[recipient].add(attributeKey);
                  changed[recipient].add(attributeKey);
                  if (recipient === opponent && description.kind === 'item') {
                    cover(`equipmentAssumptions.${side}.${description.equipmentKey}.target`, `sharedProviders.${key}.modifiers[0].target`);
                  }
                }
                origin(result, authored, abilityRef, [operationPath]);
                cover(resultPath, `sharedProviders.${key}.modifiers[0]`);
              }
              cover(effectPath, outputRoot);
            } else if (authored.lifecycle?.instanceScope === 'SOURCE') {
              if (authored.lifecycle.expiryMode === 'EXPLICIT_ONLY') {
                fail(effectPath, '本场可达的永久常驻效果尚未接入通用装配，不能只取装备固定属性');
              }
              const stack = ensureStack(authored);
              const operationPath = `${outputRoot}[${output.length}]`;
              output.push(stateChange(stack.key, stack.policy, constExpr(stack.amount)));
              for (const result of authored.results) origin(result, authored, abilityRef, [operationPath]);
              cover(effectPath, operationPath);
            } else {
              if (!authored.results.length) fail(effectPath, '效果缺少完整结果');
              for (const result of ordered(authored.results, `${effectPath}.results`)) {
                if (authored.lifecycle !== null && !['ATTRIBUTE_CHANGE', 'HEALING_MODIFIER', 'STATUS_OPERATION'].includes(result.resultType)) fail(effectPath, '未接入的持续效果不能伪装成即时结果');
                if (context === 'self' && result.target === 'TARGET') fail(actionPath, '当前节点未接入把对手结果改投到事件拥有方');
                if (authored.lifecycle === null && result.lifecycleBehavior !== null) fail(effectPath, '即时效果不能夹带生命周期结果');
                addResult(result, authored, output, outputRoot, abilityRef);
              }
              cover(effectPath, outputRoot);
            }
          } finally { activeEffects.delete(authored.effectKey); }
        };
        const executeActions = (rule: SkillTriggerRuleDetail, output: OperationDefinition[], outputRoot: string, abilityRef: string, event: string) => {
          const rulePath = `${root}.triggerRules.${rule.ruleKey}`;
          for (const action of ordered(rule.actions, `${rulePath}.actions`)) {
            const actionPath = `${rulePath}.actions.${action.actionKey}`;
            actionShape(action, actionPath);
            const context = targetFor(action, event, actionPath);
            const operationPath = `${outputRoot}[${output.length}]`;
            if (action.actionType === 'EXECUTE_EFFECT') {
              exact(action.detail, ['effectKey'], `${actionPath}.detail`);
              const authoredEffect = effect(action.detail.effectKey, actionPath);
              const control = event === 'SKILL_HIT' && authoredEffect.results.some(result => result.resultType === 'STATUS_OPERATION'
                && snapshot.catalogs.statuses.some(status => status.statusKey === result.detail.statusKey && status.statusKind !== 'MOVEMENT_SLOW'));
              if (control) {
                if (side !== 'source' || context !== 'target' || rule.eventSource.eventType !== 'SKILL_HIT'
                  || rule.eventSource.detail.sourceSkillKey == null || rule.eventSource.detail.sourceSkillKey === skillKey) fail(actionPath, '自然控制候选必须明确同拥有者实际驱动的兄弟技能');
                const freezeParams = (expression: GenericFormulaExpr): GenericFormulaExpr => {
                  if (expression.op === 'read' && expression.path?.startsWith('ability.param.')) {
                    const key = expression.path.slice('ability.param.'.length);
                    const parameter = numeric.params[key];
                    if (parameter === undefined) fail(actionPath, '被动候选条件参数必须由其自身核定');
                    return constExpr(parameter);
                  }
                  return { ...expression, ...(expression.args ? { args: expression.args.map(freezeParams) } : {}) };
                };
                const predicate = conditions(rule, event);
                const compiled = compilePassiveHitControl({ gameId: snapshot.gameId, skillKey, skillLevel,
                  characterLevel: snapshot.selection[`${side}Level`], effects: configuration.effects, rules: [], parameters: configuration.parameters,
                  formulas: configuration.formulas, statuses: snapshot.catalogs.statuses, modifierZones: snapshot.catalogs.modifierZones,
                  identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } } }, authoredEffect,
                { providerRef, parentDefinitionRef: definitionRef, occurrenceKey: `passive/${skillKey}/${rule.ruleKey}:${action.actionKey}`,
                  ...(predicate ? { participationCondition: freezeParams(predicate) } : {}) });
                for (const definition of compiled.providers) {
                  const previous = providers.find(row => row.providerKey === definition.providerKey);
                  if (previous && JSON.stringify(previous) !== JSON.stringify(definition)) fail(actionPath, '被动控制定义冲突');
                  if (!previous) providers.push(definition);
                }
                for (const formula of compiled.formulas) addFormula(formula, actionPath);
                for (const type of compiled.types) types.set(type.key, type.domain);
                for (const candidate of compiled.candidates) passiveHitContributions.push({ sourceSkillKey: rule.eventSource.detail.sourceSkillKey, authorSkillKey: skillKey, candidate });
                appliedEffects.add(authoredEffect.effectKey);
                if (authoredEffect.lifecycle?.durationValue) noteNumeric(authoredEffect.lifecycle.durationValue);
                cover(actionPath, 'runtimeOptions.skillOrigins');
              } else executeEffect(authoredEffect, output, outputRoot, abilityRef, event, actionPath, context);
            } else if (action.actionType === 'MODIFY_INTERNAL_STATE') {
              exact(action.detail, ['stateSkillKey', 'stateKey', 'operation', 'value'], `${actionPath}.detail`);
              const definition = lookupState(action.detail.stateKey, action.detail.stateSkillKey, actionPath);
              if (event !== 'BASIC_ATTACK_HIT' || context !== 'self' || action.targetContext !== 'EVENT_SOURCE'
                || action.detail.operation !== 'REDUCE_RECOVERY' || definition.stateType !== 'AMMO' || definition.scope !== 'SKILL') {
                fail(actionPath, '回充减时仅允许本技能真实普攻命中对自身弹药操作');
              }
              const expression = value(action.detail.value, `${actionPath}.detail.value`);
              const folded = tryFoldConstant(expression);
              if (folded !== null && (!Number.isFinite(folded) || folded < 0)) fail(actionPath, '回充减时必须为有限非负毫秒');
              types.set('state_scope/provider', 'state_scope');
              output.push({ operation: 'state_duration_change', target: 'self', ref: stateKey(definition),
                valuePolicy: 'subtract', amount: expression, types: ['state_scope/provider'] });
            } else if (action.actionType === 'START_PROCESS') {
              exact(action.detail, ['processKey'], `${actionPath}.detail`);
              if (context !== 'target' && event !== 'SOURCE_INITIALIZED') fail(actionPath, '静态被动过程必须保持同一真实对手目标');
              const authored = process(action.detail.processKey, actionPath);
              if (authored.steps[0]!.stepType === 'EMPOWERED_BASIC_ATTACK') compileEmpoweredProcess(authored, output, outputRoot, event);
              else compileProcess(authored, output, outputRoot, abilityRef, event, context);
            } else fail(actionPath, '未接入的动作节点');
            cover(actionPath, output.length ? operationPath : `${compiledRoot}.abilities`);
          }
        };
        function compileEmpoweredProcess(authored: SkillProcess, output: OperationDefinition[], outputRoot: string, event: string) {
          const processPath = `${root}.processes.${authored.processKey}`;
          const step = authored.steps[0]!;
          if (step.stepType !== 'EMPOWERED_BASIC_ATTACK' || event !== 'SKILL_USED' || side !== 'source') fail(processPath, '强化待击必须由A真实成功主动施法开启');
          const windowMs = constant(step.detail.windowValue, `${processPath}.steps.${step.stepKey}.detail.windowValue`, true, 1);
          const starts = authored.stateOperations.filter(operation => operation.moment.momentType === 'PROCESS_START');
          const timeouts = authored.stateOperations.filter(operation => operation.moment.momentType === 'STEP_TIMEOUT');
          if (starts.length !== 1 || starts[0]!.operation !== 'ENABLE' || starts[0]!.moment.stepKey !== null
            || timeouts.length !== 1 || timeouts[0]!.operation !== 'DISABLE' || timeouts[0]!.stateKey !== starts[0]!.stateKey
            || timeouts[0]!.moment.stepKey !== step.stepKey || authored.effectBindings.some(binding => binding.moment.momentType !== 'STEP_EXECUTION'
              || binding.moment.stepKey !== step.stepKey) || configuration.triggerRules.some(rule => rule.eventSource.eventType === 'PROCESS_MOMENT'
                && rule.eventSource.detail.processKey === authored.processKey)) fail(processPath, '强化待击只开放完整单标志、命中结果和清空超时，必要其它时点不能丢弃');
          const ready = lookupState(starts[0]!.stateKey, starts[0]!.stateSkillKey, processPath);
          if (ready.stateType !== 'FLAG' || ready.scope !== 'SKILL' || ready.detail.initialEnabled) fail(processPath, '强化待击需要明确初始关闭的自身标志');
          const readyKey = stateKey(ready);
          schema[readyKey] = { ...schema[readyKey]!, durationMs: windowMs, refreshPolicy: 'refresh_on_write' };
          output.push(compileStateOperation(starts[0]!, `${processPath}.stateOperations.${starts[0]!.operationKey}`));
          cover(`${processPath}.stateOperations.${starts[0]!.operationKey}`, `${outputRoot}[${output.length - 1}]`);
          cover(`${processPath}.stateOperations.${timeouts[0]!.operationKey}`, `${compiledRoot}.initialStateSchema.${readyKey}.durationMs`);
          if (!empoweredProcesses.has(authored.processKey)) {
            empoweredProcesses.add(authored.processKey);
            const abilityKey = namedKey(skillKey, `consume_${authored.processKey}`);
            const index = provider.abilities!.length + 1 + deferredAbilities.length;
            const consumeRoot = `${compiledRoot}.abilities[${index}].listenerSpec.operations`;
            const consumeRef = `${side}.provider[${providerRef}].ability[${abilityKey}]`;
            const operations: OperationDefinition[] = [];
            const entries = [
              ...authored.effectBindings.map(binding => ({ sortOrder: binding.sortOrder, key: binding.bindingKey, execute: () => {
                const bindingPath = `${processPath}.effectBindings.${binding.bindingKey}`;
                exact(binding, ['bindingKey', 'effectKey', 'moment', 'sortOrder'], bindingPath);
                executeEffect(effect(binding.effectKey, bindingPath), operations, consumeRoot, consumeRef, 'BASIC_ATTACK_HIT', bindingPath, 'target');
                cover(bindingPath, consumeRoot);
              } })),
              ...authored.stateOperations.filter(operation => !starts.includes(operation) && !timeouts.includes(operation)).map(operation => ({
                sortOrder: operation.sortOrder, key: operation.operationKey, execute: () => {
                  if (operation.moment.momentType !== 'STEP_EXECUTION' || operation.moment.stepKey !== step.stepKey) fail(processPath, '强化待击其它必要时点未接入');
                  const operationPath = `${processPath}.stateOperations.${operation.operationKey}`;
                  operations.push(compileStateOperation(operation, operationPath));
                  cover(operationPath, `${consumeRoot}[${operations.length - 1}]`);
                }
              }))
            ].sort((left, right) => left.sortOrder - right.sortOrder);
            entries.forEach((entry, entryIndex) => {
              if (entryIndex && entries[entryIndex - 1]!.sortOrder === entry.sortOrder) fail(processPath, '强化结果与消费同刻排序必须明确');
              entry.execute();
            });
            const consumesReady = authored.stateOperations.filter(operation => operation.moment.momentType === 'STEP_EXECUTION'
              && operation.stateKey === ready.stateKey && operation.operation === 'DISABLE');
            if (consumesReady.length !== 1 || !operations.some(operation => operation.operation === 'damage')) fail(processPath, '强化待击必须完整命中伤害并唯一消费原标志');
            types.set('event/basic_attack_hit', 'event'); types.set('event/source_owner', 'event');
            deferredAbilities.push({ abilityKey, kind: 'passive_listener', skillKey, types: [...skillTypes, `ability/skill/${skillKey}`],
              listenerSpec: { listenerKey: abilityKey, eventMatcher: { all: ['event/basic_attack_hit', 'event/source_owner'] }, maxTriggersPerEvent: 1,
                condition: { op: 'eq', args: [{ op: 'read', path: `provider.state.${readyKey}` }, constExpr(1)] }, operations } });
          }
          cover(`${processPath}.steps.${step.stepKey}`, `${compiledRoot}.initialStateSchema.${readyKey}`);
          cover(processPath, compiledRoot);
        }
        const executeMomentRule = (rule: SkillTriggerRuleDetail, output: OperationDefinition[], outputRoot: string, abilityRef: string, event: string) => {
          const rulePath = `${root}.triggerRules.${rule.ruleKey}`;
          if (rule.oncePerUse !== null) fail(rulePath, '静态过程时点不能丢弃独立同次使用额度');
          usedRules.add(rule.ruleKey);
          const guard = conditions(rule, event);
          let guardKey: string | undefined;
          if (guard) {
            let index = Object.keys(schema).length;
            while (schema[`compiled_guard_${index}`]) index++;
            guardKey = `compiled_guard_${index}`;
            schema[guardKey] = { valueType: 'number', defaultValue: 0, maxValue: 1, durationMs: 0 };
            const guardPath = `${outputRoot}[${output.length}]`;
            output.push(stateChange(guardKey, 'set', guard));
            cover(`${rulePath}.conditionGroups`, `${guardPath}.amount`);
          }
          const start = output.length;
          executeActions(rule, output, outputRoot, abilityRef, event);
          if (guardKey) for (const operation of output.slice(start)) {
            const predicate: GenericFormulaExpr = { op: 'read', path: `provider.state.${guardKey}` };
            operation.condition = operation.condition ? combine('min', [predicate, operation.condition]) : predicate;
          }
          cover(rulePath, outputRoot);
        };
        function compileProcess(authored: SkillProcess, output: OperationDefinition[], outputRoot: string, abilityRef: string, event: string, context: string) {
          const processPath = `${root}.processes.${authored.processKey}`;
          if (activeProcesses.has(authored.processKey)) fail(processPath, '即时被动过程存在循环');
          activeProcesses.add(authored.processKey);
          try {
            const scheduled: Array<{ moment: number; sortOrder: number; key: string; run: () => void }> = [];
            for (const operation of ordered(authored.stateOperations, `${processPath}.stateOperations`)) {
              const operationPath = `${processPath}.stateOperations.${operation.operationKey}`;
              scheduled.push({ moment: momentOrder(operation.moment, authored, operationPath), sortOrder: operation.sortOrder, key: operationPath, run: () => {
                const compiledPath = `${outputRoot}[${output.length}]`;
                output.push(compileStateOperation(operation, operationPath));
                cover(operationPath, compiledPath);
              } });
            }
            for (const binding of ordered(authored.effectBindings, `${processPath}.effectBindings`)) {
              const bindingPath = `${processPath}.effectBindings.${binding.bindingKey}`;
              exact(binding, ['bindingKey', 'effectKey', 'moment', 'sortOrder'], bindingPath);
              scheduled.push({ moment: momentOrder(binding.moment, authored, bindingPath), sortOrder: binding.sortOrder, key: bindingPath, run: () => {
                executeEffect(effect(binding.effectKey, bindingPath), output, outputRoot, abilityRef, event, bindingPath, context);
                cover(bindingPath, outputRoot);
              } });
            }
            for (const rule of configuration.triggerRules) if (rule.eventSource.eventType === 'PROCESS_MOMENT' && rule.eventSource.detail.processKey === authored.processKey) {
              const rulePath = `${root}.triggerRules.${rule.ruleKey}`;
              exact(rule.eventSource.detail, ['processKey', 'moment'], `${rulePath}.eventSource.detail`);
              scheduled.push({ moment: momentOrder(rule.eventSource.detail.moment, authored, rulePath), sortOrder: rule.sortOrder,
                key: rulePath, run: () => executeMomentRule(rule, output, outputRoot, abilityRef, 'PROCESS_MOMENT') });
            }
            scheduled.sort((left, right) => left.moment - right.moment || left.sortOrder - right.sortOrder);
            for (const [index, entry] of scheduled.entries()) {
              if (index && scheduled[index - 1]!.moment === entry.moment && scheduled[index - 1]!.sortOrder === entry.sortOrder) fail(entry.key, '同一时点的跨节点排序不明确，不能猜测先后');
              entry.run();
            }
            for (const step of ordered(authored.steps, `${processPath}.steps`)) cover(`${processPath}.steps.${step.stepKey}`, outputRoot);
            cover(processPath, outputRoot);
          } finally { activeProcesses.delete(authored.processKey); }
        }
        function compilePeriodic(authored: SkillEffect, output: OperationDefinition[], outputRoot: string, event: string, actionPath: string) {
          const effectPath = `${root}.effects.${authored.effectKey}`;
          const life = authored.lifecycle!;
          if (life.instanceScope !== 'SOURCE' || life.reapplicationStackMode !== 'KEEP' || life.periodicIntervalValue === null
            || life.firstPeriodicExecution !== 'AFTER_INTERVAL') fail(`${effectPath}.lifecycle`, '周期需要真实SOURCE范围、首跳AFTER_INTERVAL及完整生命周期依据');
          const interval = constant(life.periodicIntervalValue, `${effectPath}.lifecycle.periodicIntervalValue`, true, 1);
          if (constant(life.maxStacksValue, `${effectPath}.lifecycle.maxStacksValue`, true, 1) !== 1
            || constant(life.applicationStacksValue, `${effectPath}.lifecycle.applicationStacksValue`, true, 1) !== 1) fail(effectPath, '周期只支持完整单层来源');
          const dynamic = life.durationValue !== null;
          if (dynamic ? life.expiryMode !== 'ALL_AT_ONCE' || life.reapplicationDurationMode !== 'REFRESH_ALL'
            : life.expiryMode !== 'EXPLICIT_ONLY' || life.reapplicationDurationMode !== null || event !== 'SOURCE_INITIALIZED') fail(effectPath, '周期激活、刷新或有期终点缺少完整作者依据');
          let compiled = periodicEffects.get(authored.effectKey);
          if (!compiled) {
            const key = dynamic ? `${definitionRef}_${skillKey}_${authored.effectKey}_periodic` : definitionRef;
            const tick: AbilityDefinition = { abilityKey: dynamic ? 'tick' : namedKey(skillKey, `tick_${authored.effectKey}`), kind: 'tick',
              skillKey, types: [...skillTypes, `ability/skill/${skillKey}`], tickSpec: { intervalMs: interval, startDelayMs: interval, onTick: [] } };
            const tickProvider: ProviderDefinition = dynamic ? { providerKey: key, skillKey, stableId: provider.stableId, kind: 'status',
              lifecycle: { durationMs: constExpr(constant(life.durationValue!, `${effectPath}.lifecycle.durationValue`, true, 1)),
                maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' }, abilities: [tick] } : provider;
            if (!dynamic && provider.abilities!.some(ability => ability.kind === 'tick')) fail(effectPath, '固定来源不支持第二项独立周期');
            const tickIndex = dynamic ? 0 : provider.abilities!.length;
            const tickRoot = `sharedProviders.${key}.abilities[${tickIndex}].tickSpec.onTick`;
            const tickRef = `${side}.provider[${dynamic ? key : providerRef}].ability[${tick.abilityKey}]`;
            for (const result of ordered(authored.results, `${effectPath}.results`)) {
              resultShape(result, `${effectPath}.results.${result.resultKey}`);
              const behavior = result.lifecycleBehavior;
              if (!behavior || behavior.moment !== 'PERIODIC' || behavior.valueReadMode !== 'MOMENT_EVALUATION'
                || behavior.stackValueMode !== null || behavior.reapplicationValueMode !== null
                || behavior.periodicExecutionMode !== 'ONCE_PER_INSTANCE' || result.resultType !== 'DAMAGE') fail(effectPath, '周期结果时点、读取、层数或类型不完整');
              addResult(result, authored, tick.tickSpec!.onTick, tickRoot, tickRef, dynamic ? key : undefined);
            }
            for (const rule of configuration.triggerRules) if (rule.eventSource.eventType === 'LIFECYCLE_MOMENT'
              && rule.eventSource.detail.effectKey === authored.effectKey && rule.eventSource.detail.moment === 'PERIODIC') {
              exact(rule.eventSource.detail, ['effectKey', 'moment'], `${root}.triggerRules.${rule.ruleKey}.eventSource.detail`);
              if (rule.conditionGroups.length || rule.oncePerUse !== null) fail(effectPath, '周期时点尚未接入条件或原使用额度');
              if (rule.actions.some(action => action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET')) fail(effectPath, '周期时点只接入真实对手的即时伤害，不串用来源状态或过程');
              usedRules.add(rule.ruleKey);
              const before = operationOrigins.length;
              executeActions(rule, tick.tickSpec!.onTick, tickRoot, tickRef, 'DAMAGE_DEALT');
              if (tick.tickSpec!.onTick.some(operation => operation.operation !== 'damage' || operation.target !== 'target')) fail(effectPath, '周期时点未接入非伤害操作');
              if (dynamic) for (const originRow of operationOrigins.slice(before)) originRow.providerDefinitionRef = key;
            }
            if (!tick.tickSpec!.onTick.length) fail(effectPath, '周期没有完整执行结果');
            if (dynamic) providers.push(tickProvider);
            else provider.abilities!.push(tick);
            abilities.push(tick);
            compiled = { definition: tickProvider, dynamic };
            periodicEffects.set(authored.effectKey, compiled);
            cover(`${effectPath}.lifecycle`, `sharedProviders.${key}`);
            cover(effectPath, tickRoot);
          } else if (!dynamic) fail(actionPath, '永久周期不能重复播种');
          if (compiled.dynamic) {
            const operationPath = `${outputRoot}[${output.length}]`;
            output.push({ operation: 'apply_provider', target: 'self', providerDefinitionRef: compiled.definition.providerKey, ref: effectPath });
            cover(actionPath, operationPath);
            cover(`${effectPath}.lifecycle.instanceScope`, `${operationPath}.target`);
          }
          cover(`${effectPath}.lifecycle.firstPeriodicExecution`, `sharedProviders.${compiled.definition.providerKey}`);
        }


        for (const rule of ordered(configuration.triggerRules, `${root}.triggerRules`)) {
          const event: string = rule.eventSource.eventType;
          rootEvent = event;
          const rulePath = `${root}.triggerRules.${rule.ruleKey}`;
          if (event === 'PROCESS_MOMENT' || event === 'LIFECYCLE_MOMENT') continue;
          if (source.allowedRootKeys && !source.allowedRootKeys.includes(rule.ruleKey)) fail(rulePath, '必要闭包的事件尾规则尚未接入，不能编译自然根后忽略尾部');
          if (contributesBasicAttack) {
            for (const action of ordered(rule.actions, `${rulePath}.actions`)) {
              const actionPath = `${rulePath}.actions.${action.actionKey}`;
              actionShape(action, actionPath);
              if (action.actionType !== 'EXECUTE_EFFECT') fail(actionPath, '普攻组成需要完整即时执行效果');
              exact(action.detail, ['effectKey'], `${actionPath}.detail`);
              const authored = effect(action.detail.effectKey, actionPath);
              for (const result of ordered(authored.results, `${root}.effects.${authored.effectKey}.results`)) {
                const resultPath = `${root}.effects.${authored.effectKey}.results.${result.resultKey}`;
                resultShape(result, resultPath);
                if (result.resultType !== 'DAMAGE') fail(resultPath, '普攻组成只接独立即时伤害');
                contributionLowerings = [];
                const operation = compileDamage(result, resultPath);
                collectAttributes(operation, side, required);
                basicAttackContributions.push({ authorSkillKey: skillKey, lowerings: contributionLowerings,
                  candidate: { candidateKey: basicAttackContributionKey(providerRef, rule.ruleKey, action.actionKey, result.resultKey),
                    effectOccurrenceKey: basicAttackContributionKey(providerRef, rule.ruleKey, action.actionKey),
                    effectKey: authored.effectKey, resultKey: result.resultKey,
                    semantic: { resultType: 'DAMAGE', target: 'TARGET', moment: 'INSTANT' }, spellShieldBlockScope: null,
                    participationProviderRef: providerRef, participationCondition: constExpr(1), operations: [operation] } });
              }
              appliedEffects.add(authored.effectKey);
              cover(actionPath, 'runtimeOptions.skillOrigins');
            }
            usedRules.add(rule.ruleKey);
            cover(rulePath, 'runtimeOptions.skillOrigins');
            continue;
          }
          if (event === 'SOURCE_INITIALIZED' && rule.oncePerUse !== null) fail(rulePath, '初始化没有真实攻击使用身份，不能配置同次使用额度');
          const eventTypes: Record<string, string> = { BASIC_ATTACK_START: 'event/basic_attack_start', ATTACK_LINK_APPLIED: 'event/attack_link_applied',
            SKILL_USED: snapshot.selection.plannedSkills.length ? 'event/ability_started' : 'event/basic_attack_start',
            SKILL_HIT: snapshot.selection.plannedSkills.length ? 'event/skill_hit' : 'event/basic_attack_hit',
            BASIC_ATTACK_HIT: 'event/basic_attack_hit', HIT_LINK_APPLIED: 'event/hit_link_applied',
            DAMAGE_TAKEN: 'event/damage_taken', BASIC_ATTACK_RECEIVED: 'event/basic_attack_received', DAMAGE_DEALT: 'event/damage_instance',
            SOURCE_INITIALIZED: 'event/source_initialized' };
          eventTypes.PROCESS_RESOLVED = 'event/process_resolved';
          const eventType = eventTypes[event];
          if (!eventType) fail(`${rulePath}.eventSource.eventType`, '未接入的事件节点，整件装备拒绝');
          const receiver = event === 'DAMAGE_TAKEN' || event === 'BASIC_ATTACK_RECEIVED';
          const matcher: { all: string[]; any?: string[] } = { all: [eventType, receiver ? 'event/target_owner' : 'event/source_owner'] };
          matcher.all.forEach(key => types.set(key, 'event'));
          if (event === 'DAMAGE_TAKEN' || event === 'DAMAGE_DEALT') {
            const detail = record(rule.eventSource.detail, `${rulePath}.eventSource.detail`);
            exact(detail, ['sourceSkillKey', 'damageTypeKey', 'deliveryKind', 'originKind'], `${rulePath}.eventSource.detail`);
            if (!['ANY', 'BASIC_ATTACK', 'SKILL'].includes(detail.deliveryKind as string) || !['ANY', 'DIRECT', 'REFLECTED'].includes(detail.originKind as string)) fail(rulePath, '伤害事件特征不完整');
            if (detail.damageTypeKey !== null) matcher.all.push(defense(stableKey(detail.damageTypeKey, rulePath)));
            for (const [field, prefix] of [['deliveryKind', 'delivery'], ['originKind', 'origin']] as const) if (detail[field] !== 'ANY') {
              const key = `damage_trait/${prefix}_${String(detail[field]).toLowerCase()}`;
              matcher.all.push(key); types.set(key, 'damage_trait');
            }
            if (detail.sourceSkillKey !== null) {
              const key = stableKey(detail.sourceSkillKey, `${rulePath}.eventSource.detail.sourceSkillKey`);
              if (!snapshot.skillConfigurations.some(row => row.skill.skillKey === key && row.skill.status === 'ENABLED')) fail(rulePath, '伤害来源技能缺少真实已启用配置');
              const identity = `ability/skill/${key}`;
              types.set(identity, 'ability'); matcher.all.push(identity);
            }
          } else if (event === 'PROCESS_RESOLVED') {
            if (rule.eventSource.eventType !== 'PROCESS_RESOLVED') fail(rulePath, '过程终结事实类型不一致');
            const detail = rule.eventSource.detail;
            exact(detail, ['sourceSkillKey', 'processKey'], `${rulePath}.eventSource.detail`);
            const selected = snapshot.selection.plannedSkills.find(plan => plan.skillKey === detail.sourceSkillKey && plan.phaseKinds.includes('INITIAL'));
            const sourceConfiguration = snapshot.skillConfigurations.find(row => row.skill.skillKey === detail.sourceSkillKey && row.skill.status === 'ENABLED');
            if (side !== 'source' || !selected || !sourceConfiguration?.processes.some(process => process.processKey === detail.processKey)) fail(rulePath, '终结事实必须引用同实际来源已计划技能的真实过程');
            for (const [key, domain] of [[`ability/${detail.sourceSkillKey}`, 'ability'], [`event/process_resolved/${detail.sourceSkillKey}/${detail.processKey}`, 'event']] as const) {
              matcher.all.push(key); types.set(key, domain);
            }
          } else if (event === 'SKILL_USED' || event === 'SKILL_HIT') {
            exact(rule.eventSource.detail, event === 'SKILL_USED' ? ['sourceSkillKey', 'useKind', 'castPhase'] : ['sourceSkillKey'], `${rulePath}.eventSource.detail`);
            const detail = record(rule.eventSource.detail, `${rulePath}.eventSource.detail`);
            const drivenSkillKeys = (snapshot.selection.plannedSkills.length ? snapshot.selection.plannedSkills.map(plan => plan.skillKey)
              : [snapshot.selection.basicAttackSkillKey]).filter((key): key is string => key !== null);
            if (side !== 'source' || !drivenSkillKeys.length || detail.sourceSkillKey !== null && !drivenSkillKeys.includes(String(detail.sourceSkillKey))
              || event === 'SKILL_USED' && (detail.castPhase !== 'INITIAL' || !['ANY', 'ACTIVE'].includes(String(detail.useKind)))) {
              fail(rulePath, '只监听本次真实驱动技能的成功使用或命中，不自动执行主动兄弟');
            }
            const identities = drivenSkillKeys.filter(key => detail.sourceSkillKey === null || detail.sourceSkillKey === key).map(key => `ability/skill/${key}`);
            identities.forEach(identity => types.set(identity, 'ability'));
            if (identities.length === 1) matcher.all.push(identities[0]!);
            else matcher.any = identities;
          } else if (event === 'HIT_LINK_APPLIED' || event === 'ATTACK_LINK_APPLIED') {
            exact(rule.eventSource.detail, ['sourceSkillKey'], `${rulePath}.eventSource.detail`);
            const sourceSkillKey = record(rule.eventSource.detail, `${rulePath}.eventSource.detail`).sourceSkillKey;
            if (sourceSkillKey !== null) {
              stableKey(sourceSkillKey, `${rulePath}.eventSource.detail.sourceSkillKey`);
              fail(`${rulePath}.eventSource.detail.sourceSkillKey`, '非空命中联动来源筛选需要原生原使用技能身份匹配，不能忽略后继续');
            }
          } else exact(rule.eventSource.detail, [], `${rulePath}.eventSource.detail`);
          if (event === 'SOURCE_INITIALIZED' && description.kind === 'item') {
            if (rule.conditionGroups.length || rule.oncePerUse !== null) fail(rulePath, '常驻与固定周期必须有无条件真实初始化依据');
            let hasPermanentResult = false;
            for (const action of rule.actions) {
              const effect = action.actionType === 'EXECUTE_EFFECT'
                ? configuration.effects.find(row => row.effectKey === action.detail.effectKey) : undefined;
              const permanent = effect?.lifecycle?.expiryMode === 'EXPLICIT_ONLY' && effect.lifecycle.periodicIntervalValue === null;
              if (action.actionType !== 'EXECUTE_EFFECT' || !effect?.lifecycle?.periodicIntervalValue && !permanent) {
                fail(rulePath, '通用初始化只接入完整永久常驻或始终持久周期');
              }
              if (permanent && action.targetContext !== 'EVENT_SOURCE') fail(`${rulePath}.actions.${action.actionKey}`, '永久初始化动作必须明确作用于事件来源自身');
              hasPermanentResult ||= permanent;
            }
            const operations: OperationDefinition[] = [];
            const abilityKey = namedKey(skillKey, rule.ruleKey);
            const abilityRoot = `${compiledRoot}.abilities[${provider.abilities!.length}]`;
            const abilityRef = `${side}.provider[${providerRef}].ability[${abilityKey}]`;
            if (hasPermanentResult) {
              const initializer: AbilityDefinition = { abilityKey, kind: 'passive_listener', skillKey,
                types: [...skillTypes, `ability/skill/${skillKey}`], listenerSpec: {
                  listenerKey: namedKey(skillKey, rule.ruleKey), maxTriggersPerEvent: 1, eventMatcher: matcher, operations
                } };
              // 先保留能力槽位，再编译同规则中的周期，避免周期插入使来源路径错位。
              abilities.push(initializer); provider.abilities!.push(initializer);
            }
            executeActions(rule, operations, `${abilityRoot}.listenerSpec.operations`, abilityRef, event);
            if (operations.some(operation => operation.operation !== 'apply_provider')) fail(rulePath, '初始化不能把有限窗口改成常驻');
            if (hasPermanentResult && !operations.length) fail(rulePath, '永久初始化缺少完整执行操作');
            if (!hasPermanentResult && operations.length) fail(rulePath, '固定周期不能把有限窗口改成常驻');
            usedRules.add(rule.ruleKey);
            cover(rulePath, hasPermanentResult ? `${abilityRoot}.listenerSpec` : `${compiledRoot}.abilities`);
            if (hasPermanentResult) cover(`${rulePath}.eventSource`, `${abilityRoot}.listenerSpec.eventMatcher`);
            continue;
          }
          const abilityKey = namedKey(skillKey, rule.ruleKey);
          const index = provider.abilities!.length;
          const abilityRoot = `${compiledRoot}.abilities[${index}]`;
          const outputRoot = `${abilityRoot}.listenerSpec.operations`;
          const abilityRef = `${side}.provider[${providerRef}].ability[${abilityKey}]`;
          const predicate = conditions(rule, event);
          const operations: OperationDefinition[] = [];
          executeActions(rule, operations, outputRoot, abilityRef, event);
          if (!operations.length) fail(rulePath, '规则没有完整可执行操作');
          const listener: NonNullable<AbilityDefinition['listenerSpec']> = { listenerKey: namedKey(skillKey, rule.ruleKey), eventMatcher: matcher,
            maxTriggersPerEvent: 1, operations, ...(predicate ? { condition: predicate } : {}) };
          if (rule.oncePerUse !== null) {
            exact(rule.oncePerUse, ['groupKey', 'scope'], `${rulePath}.oncePerUse`);
            const groupKey = stableKey(rule.oncePerUse.groupKey, `${rulePath}.oncePerUse.groupKey`);
            if (!['SKILL', 'TARGET'].includes(rule.oncePerUse.scope)) fail(rulePath, '未知同次使用范围');
            listener.oncePerUse = { groupKey: stableKey(namedKey(skillKey, groupKey), `${rulePath}.oncePerUse.groupKey`),
              scope: rule.oncePerUse.scope === 'SKILL' ? 'provider' : 'provider_target' };
            cover(`${rulePath}.oncePerUse`, `${abilityRoot}.listenerSpec.oncePerUse`);
          }
          const ability: AbilityDefinition = { abilityKey, kind: 'passive_listener', skillKey, types: [...skillTypes, `ability/skill/${skillKey}`], listenerSpec: listener };
          abilities.push(ability); provider.abilities!.push(ability);
          abilities.push(...deferredAbilities); provider.abilities!.push(...deferredAbilities); deferredAbilities.length = 0;
          usedRules.add(rule.ruleKey);
          cover(rulePath, `${abilityRoot}.listenerSpec`);
          cover(`${rulePath}.eventSource`, `${abilityRoot}.listenerSpec.eventMatcher`);
          if (predicate) cover(`${rulePath}.conditionGroups`, `${abilityRoot}.listenerSpec.condition`);
        }
        for (const authored of configuration.effects) if (!usedEffects.has(authored.effectKey) || !appliedEffects.has(authored.effectKey) && !queriedShieldEffects.has(authored.effectKey)) fail(`${root}.effects.${authored.effectKey}`, '存在未接入的作者效果，不能丢弃后成功');
        for (const authored of configuration.processes) if (!usedProcesses.has(authored.processKey)) fail(`${root}.processes.${authored.processKey}`, '存在未接入的作者过程');
        for (const authored of configuration.internalStates) if (!usedStates.has(authored.stateKey)) fail(`${root}.internalStates.${authored.stateKey}`, '存在未接入的内部状态');
        for (const authored of configuration.triggerRules) if (!usedRules.has(authored.ruleKey)) fail(`${root}.triggerRules.${authored.ruleKey}`, '存在未接入的作者规则或时点');
        for (const authored of configuration.formulas) if (!usedFormulas.has(authored.formulaKey)) {
          const authorPath = `${root}.formulas.${authored.formulaKey}.expression`;
          registerCommonFormula(authored, authorPath, numeric, fail);

          const key = `${numeric.formulaNamespace}/${authored.formulaKey}`;
          coverage.push({ authorPath, compiledPath: `formulas[${key}].expression`,
            note: '非战斗引用：完整透传共同公式，未绑定动作，不替换任何战斗节点数值' });
        }
        for (const parameter of configuration.parameters) {
          if (parameter.valueMode === 'RUNTIME_INPUT') {
            continue;
          }
          compileNumericValue({ kind: 'PARAMETER', parameterKey: parameter.parameterKey }, `${root}.parameters.${parameter.parameterKey}`, numeric, fail);
          if (parameter.valueType === 'INTEGER' && !Number.isInteger(numeric.params[parameter.parameterKey])) fail(`${root}.parameters.${parameter.parameterKey}`, '参数违反整数约束');
          for (const ability of abilities) {
            const definition = providers.find(row => row !== provider && row.abilities?.includes(ability)) ?? provider;
            coverage.push({ authorPath: `${root}.parameters.${parameter.parameterKey}`,
              compiledPath: `sharedProviders.${definition.providerKey}.abilities[${definition.abilities!.indexOf(ability)}].params.${parameter.parameterKey}`,
              ...(!usedParameters.has(parameter.parameterKey) ? { note: '非战斗引用：保留可用作者参数，未绑定动作，不作为周期或效果默认值' } : {}) });
          }
        }
        for (const authored of configuration.formulas) {
          const authorPath = `${root}.formulas.${authored.formulaKey}.expression`;
          if (!coverage.some(row => row.authorPath === authorPath && row.compiledPath.startsWith('formulas['))) cover(authorPath, `formulas[${numeric.formulaNamespace}/${authored.formulaKey}].expression`);
        }
        for (const formula of numeric.namedFormulas.values()) addFormula(formula, root);
        for (const ability of abilities) {
          ability.skillKey = skillKey;
          ability.params = { ...numeric.params };
          collectAttributes(ability, side, required);
        }
        for (const formula of formulas.values()) if (formula.key.startsWith(`${numeric.formulaNamespace}/`)) collectAttributes(formula.expression, side, required);
        cover(source.path, compiledRoot);
        cover(`${root}.skill`, compiledRoot);
        compiledSources.push({ side, providerRef, definitionRef, skillKey });
      }
      if (Object.keys(schema).length) provider.initialStateSchema = schema;
      if (modifiers.length) provider.modifiers = modifiers;
      providers.push(provider);
      mounts.push({ side, providerRef, definitionRef });
      collectAttributes(modifiers, side, required);
      cover(path, compiledRoot);
  }
  for (const provider of providers) for (const ability of provider.abilities ?? []) if (ability.skillKey) {
    types.set(`ability/skill/${ability.skillKey}`, 'ability');
  }
  for (const side of ['source', 'target'] as const) for (const key of required[side]) {
    const entries = snapshot.catalogs.attributes.filter(row => row.attributeKey === key);
    if (entries.length !== 1 || entries[0]!.gameId !== snapshot.gameId || entries[0]!.status !== 'ENABLED') fail(`catalogs.attributes.${key}`, '依赖属性缺少唯一已启用的真实目录');
  }
  return { providers, mounts, types: [...types].map(([key, domain]) => ({ key, domain })), formulas: [...formulas.values()],
    rules, operationOrigins, coverage, required, selectedSkills, changedAttributes: changed, compiledSources,
    ...(passiveHitContributions.length ? { passiveHitContributions } : {}),
    ...(basicAttackContributions.length ? { basicAttackContributions } : {}) };
}
