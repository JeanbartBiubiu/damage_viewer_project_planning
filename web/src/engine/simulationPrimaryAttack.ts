import type { GenericFormulaExpr, OperationDefinition, ProviderStateFieldSchema } from '../types/genericEngine';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillTriggerCondition, SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { SimulationMechanicStateInput, SimulationSnapshot } from '../types/simulationSnapshot';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { compileAttributeValue, compileNumericValue, constExpr, createNumericCompileState,
  NumericAdaptationError, tryFoldConstant, staticNumericField, type NumericCompileState } from './numericAdapter';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: unknown, keys: string[], path: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '需要完整对象');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, '未支持字段不能忽略');
}
const compare = (operator: string, left: GenericFormulaExpr, right: GenericFormulaExpr, path: string): GenericFormulaExpr => {
  const op = ({ LT: 'lt', LTE: 'lte', EQ: 'eq', NE: 'ne', GTE: 'gte', GT: 'gt' } as Record<string, string>)[operator];
  if (!op) fail(path, '未知比较符');
  return { op, args: [left, right] };
};
const combine = (op: 'min' | 'max', values: GenericFormulaExpr[], path: string): GenericFormulaExpr => {
  if (!values.length) fail(path, '条件组不能为空');
  return values.reduce((left, right) => ({ op, args: [left, right] }));
};

export function compileSimulationStatusCondition(snapshot: SimulationSnapshot, condition: SkillTriggerCondition,
  path: string, declareStatus: (statusKey: string) => void, source = 'source', target = 'target'): GenericFormulaExpr {
  if (condition.conditionType !== 'STATUS_CHECK') return fail(path, '不是状态条件');
  const detail = condition.detail;
  exact(detail, ['subject', 'statusKey', 'checkKind', 'effectSkillKey', 'sourceEffectKey', 'sourceResultKey', 'comparator', 'comparisonValue'], path);
  const statuses = snapshot.catalogs.statuses.filter(row => row.statusKey === detail.statusKey);
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(detail.statusKey) || statuses.length !== 1
    || statuses[0]!.gameId !== snapshot.gameId || statuses[0]!.status !== 'ENABLED') fail(path, '缺少真实唯一启用状态目录');
  if (!['SOURCE', 'CURRENT_TARGET'].includes(detail.subject) || !['PRESENT', 'ABSENT'].includes(detail.checkKind)
    || detail.effectSkillKey !== null || detail.sourceEffectKey !== null || detail.sourceResultKey !== null
    || detail.comparator !== null || detail.comparisonValue !== null) fail(path, '本期只支持完整状态存在或不存在检查');
  declareStatus(detail.statusKey);
  return compare('EQ', { op: 'read', path: `${detail.subject === 'SOURCE' ? source : target}.status.${detail.statusKey}.present` },
    constExpr(detail.checkKind === 'PRESENT' ? 1 : 0), path);
}

export function compilePrimaryCondition(snapshot: SimulationSnapshot, config: SkillConfiguration,
  rule: SkillTriggerRuleDetail, numeric: NumericCompileState, declareStatus: (statusKey: string) => void): GenericFormulaExpr | undefined {
  const root = `skills.${config.skill.skillKey}.triggerRules.${rule.ruleKey}.conditionGroups`;
  if (!rule.conditionGroups.length) return undefined;
  const unique = (rows: Array<{ sortOrder: number }>, keys: string[], path: string) => {
    if (new Set(keys).size !== keys.length || rows.some(row => !Number.isInteger(row.sortOrder))) fail(path, '条件稳定标识重复或排序无效');
  };
  unique(rule.conditionGroups, rule.conditionGroups.map(group => group.groupKey), root);
  return combine('max', [...rule.conditionGroups].sort((left, right) => left.sortOrder - right.sortOrder).map(group => {
    const path = `${root}.${group.groupKey}`;
    exact(group, ['groupKey', 'name', 'sortOrder', 'conditions'], path);
    unique(group.conditions, group.conditions.map(condition => condition.conditionKey), path);
    return combine('min', [...group.conditions].sort((left, right) => left.sortOrder - right.sortOrder).map(condition => {
      const conditionPath = `${path}.${condition.conditionKey}`;
      exact(condition, ['conditionKey', 'conditionType', 'sortOrder', 'detail'], conditionPath);
      if (condition.conditionType === 'STATUS_CHECK') return compileSimulationStatusCondition(snapshot, condition, conditionPath, declareStatus);
      if (condition.conditionType === 'ATTRIBUTE_COMPARE') {
        const detail = condition.detail;
        exact(detail, ['subject', 'attributeKey', 'attributeValueKind', 'comparator', 'comparisonValue'], conditionPath);
        if (!['SOURCE', 'CURRENT_TARGET'].includes(detail.subject)) fail(conditionPath, '主体条件只读取真实攻击方或目标');
        const expression = compileAttributeValue({ attributeOwner: detail.subject === 'SOURCE' ? 'SOURCE' : 'TARGET',
          attributeKey: detail.attributeKey, attributeValueKind: detail.attributeValueKind }, conditionPath, numeric, fail);
        return compare(detail.comparator, expression, compileNumericValue(detail.comparisonValue, conditionPath, numeric, fail), conditionPath);
      }
      if (condition.conditionType === 'INTERNAL_STATE_CHECK') {
        const detail = condition.detail;
        exact(detail, ['stateSkillKey', 'stateKey', 'valueKind', 'optionKey', 'expectedBoolean', 'comparator', 'comparisonValue'], conditionPath);
        const state = config.internalStates.find(row => row.stateKey === detail.stateKey);
        if (detail.stateSkillKey !== config.skill.skillKey || !state || state.stateType !== 'AMMO' || state.scope !== 'SKILL'
          || detail.valueKind !== 'ATTACK_START_VALUE' || detail.optionKey !== null || detail.expectedBoolean !== null
          || !detail.comparisonValue || !detail.comparator) fail(conditionPath, '本次开始值只允许所选主体自身唯一弹药的数值比较');
        return compare(detail.comparator, { op: 'read', path: 'use.ammo.before' },
          compileNumericValue(detail.comparisonValue, conditionPath, numeric, fail), conditionPath);
      }
      return fail(conditionPath, '主体必要条件尚未支持，不能裁剪');
    }), path);
  }), root);
}

export function primaryConditionsExclusive(left: GenericFormulaExpr, right: GenericFormulaExpr, numeric: NumericCompileState): boolean {
  if (left.op === 'max') return left.args!.every(child => primaryConditionsExclusive(child, right, numeric));
  if (right.op === 'max') return right.args!.every(child => primaryConditionsExclusive(left, child, numeric));
  if (left.op === 'min') return left.args!.some(child => primaryConditionsExclusive(child, right, numeric));
  if (right.op === 'min') return right.args!.some(child => primaryConditionsExclusive(left, child, numeric));
  if (!left.args || !right.args || JSON.stringify(left.args[0]) !== JSON.stringify(right.args[0])) return false;
  const fold = (expression: GenericFormulaExpr): number | null => {
    if (expression.op === 'read' && expression.path?.startsWith('ability.param.')) return numeric.params[expression.path.slice('ability.param.'.length)] ?? null;
    if (expression.op === 'ref') {
      return tryFoldConstant(expression);
    }
    if (expression.args) {
      const values = expression.args.map(fold);
      if (values.some(value => value === null)) return null;
      return tryFoldConstant({ ...expression, args: values.map(value => constExpr(value!)) });
    }
    return tryFoldConstant(expression);
  };
  const leftValue = fold(left.args[1]!); const rightValue = fold(right.args[1]!);
  if (leftValue === null || rightValue === null) return false;
  const intervals = (op: string, value: number): Array<[number, boolean, number, boolean]> => {
    if (op === 'eq') return [[value, true, value, true]];
    if (op === 'ne') return [[-Infinity, false, value, false], [value, false, Infinity, false]];
    if (op === 'lt' || op === 'lte') return [[-Infinity, false, value, op === 'lte']];
    if (op === 'gt' || op === 'gte') return [[value, op === 'gte', Infinity, false]];
    return [];
  };
  const leftRanges = intervals(left.op, leftValue); const rightRanges = intervals(right.op, rightValue);
  return leftRanges.length > 0 && rightRanges.length > 0 && leftRanges.every(first => rightRanges.every(second =>
    first[2] < second[0] || first[2] === second[0] && !(first[3] && second[1])
      || second[2] < first[0] || second[2] === first[0] && !(second[3] && first[1])));
}

export function compilePrimaryAmmo(config: SkillConfiguration, numeric: NumericCompileState) {
  if (!config.internalStates.length) return { schema: undefined, consumption: undefined, stateKey: undefined };
  const root = `skills.${config.skill.skillKey}.internalStates`;
  if (config.internalStates.length !== 1) fail(root, '所选主体只能声明唯一弹药状态');
  const state = config.internalStates[0]!;
  const path = `${root}.${state.stateKey}`;
  exact(state, ['gameId', 'skillKey', 'stateKey', 'name', 'stateType', 'scope', 'description', 'sortOrder', 'createdAt', 'updatedAt', 'detail'], path);
  if (state.stateType !== 'AMMO' || state.scope !== 'SKILL' || state.gameId !== numeric.gameId
    || state.skillKey !== config.skill.skillKey || !/^[a-z][a-z0-9_]{0,63}$/.test(state.stateKey)) fail(path, '只支持主体自身弹药');
  exact(state.detail, ['initialValue', 'maxValue', 'recoveryIntervalValue', 'recoveryMode', 'recoveryStartCondition'], `${path}.detail`);
  if (state.detail.recoveryMode !== 'ALL_AT_ONCE' || state.detail.recoveryStartCondition !== 'WHEN_EMPTY') fail(path, '弹药恢复必须明确为耗尽后一次恢复全部');
  const ammoNumeric = createNumericCompileState({ ...numeric, formulaNamespace: `${numeric.formulaNamespace}/ammo`, bindParameters: false });
  const constant = (value: typeof state.detail.initialValue, field: string, minimum: number) => {
    const folded = tryFoldConstant(compileNumericValue(value, `${path}.detail.${field}`, { ...ammoNumeric, allowAttributeReads: false }, fail));
    if (folded === null || !Number.isSafeInteger(folded) || folded < minimum) fail(`${path}.detail.${field}`, '需要明确的合法整数，不能以容量补初值');
    return folded;
  };
  const maximum = constant(state.detail.maxValue, 'maxValue', 1);
  const initial = constant(state.detail.initialValue, 'initialValue', 0);
  if (initial > maximum) fail(path, '初值不能超过弹药容量');
  const intervalMs = compileNumericValue(state.detail.recoveryIntervalValue, `${path}.detail.recoveryIntervalValue`, ammoNumeric, fail);
  const interval = tryFoldConstant(intervalMs);
  if (interval !== null && (!Number.isSafeInteger(interval) || interval < 1)) fail(path, '恢复间隔必须为正整数毫秒');
  for (const formula of ammoNumeric.namedFormulas.values()) numeric.namedFormulas.set(formula.key, formula);
  const schema: Record<string, ProviderStateFieldSchema> = { [state.stateKey]: { valueType: 'integer', defaultValue: staticNumericField(state.detail.initialValue, path + '.detail.initialValue', ammoNumeric, fail), maxValue: staticNumericField(state.detail.maxValue, path + '.detail.maxValue', ammoNumeric, fail),
    stateKind: 'ammo', ammoRecovery: { intervalMs, mode: 'all_at_once', startCondition: 'when_empty' } } };
  const operations = config.processes.flatMap(process => process.stateOperations);
  if (operations.length !== 1) fail(root, '每次已接受攻击需要唯一开始消费');
  const operation = operations[0]!;
  exact(operation, ['operationKey', 'name', 'sortOrder', 'stateSkillKey', 'stateKey', 'moment', 'operation', 'value', 'optionKey'], `${path}.consumption`);
  exact(operation.moment, ['momentType', 'stepKey', 'failureReason'], `${path}.consumption.moment`);
  if (operation.stateSkillKey !== config.skill.skillKey || operation.stateKey !== state.stateKey || operation.operation !== 'CONSUME'
    || operation.optionKey !== null || operation.moment.momentType !== 'PROCESS_START' || operation.moment.stepKey !== null
    || operation.moment.failureReason != null || operation.value === null
    || tryFoldConstant(compileNumericValue(operation.value, `${path}.consumption.value`, { ...ammoNumeric, allowAttributeReads: false }, fail)) !== 1) {
    fail(root, '开始消费必须指向自身弹药、数量为1且无分支');
  }
  for (const field of ['initialValue', 'maxValue', 'recoveryIntervalValue'] as const) {
    compileNumericValue(state.detail[field], `${path}.detail.${field}`, numeric, fail);
  }
  compileNumericValue(operation.value!, `${path}.consumption.value`, numeric, fail);
  const consumption: OperationDefinition = { operation: 'state_change', target: 'self', ref: state.stateKey,
    valuePolicy: 'add', amount: constExpr(-1), types: ['state_scope/provider'] };
  return { schema, consumption, stateKey: state.stateKey };
}

export type SimulationMechanicRequirement = Omit<SimulationMechanicStateInput, 'value'> & {
  initialValue: number; maxValue: number; name: string; skillName: string;
};

export function primaryMechanicRequirements(snapshot: SimulationSnapshot, schema?: Record<string, number | ProviderStateFieldSchema>): SimulationMechanicRequirement[] {
  return Object.entries(schema ?? {}).filter(([, field]) => typeof field === 'object' && field.stateKind === 'ammo').map(([stateKey, field]) => {
    const declaration = field as ProviderStateFieldSchema;
    const config = snapshot.skillConfigurations.find(row => row.skill.skillKey === snapshot.selection.basicAttackSkillKey)!;
    return { side: 'source', origin: { kind: 'CHARACTER', characterKey: snapshot.selection.sourceCharacterKey }, skillKey: config.skill.skillKey,
      stateKey, initialValue: typeof declaration.defaultValue === 'number' ? declaration.defaultValue : tryFoldConstant(declaration.defaultValue) ?? fail(stateKey, '弹药初值尚未由原生核定'),
      maxValue: typeof declaration.maxValue === 'number' ? declaration.maxValue : declaration.maxValue ? tryFoldConstant(declaration.maxValue) ?? fail(stateKey, '弹药上限尚未由原生核定') : fail(stateKey, '弹药上限缺失'), skillName: config.skill.name,
      name: config.internalStates.find(row => row.stateKey === stateKey)!.name };
  });
}

export function mechanicStateIdentity(input: Omit<SimulationMechanicStateInput, 'value'>) {
  return JSON.stringify([input.side, simulationSkillSourceIdentity(input.origin, input.skillKey), input.stateKey]);
}

export function validateMechanicStateInputs(requirements: SimulationMechanicRequirement[], inputs: readonly SimulationMechanicStateInput[]) {
  if (!Array.isArray(inputs)) fail('mechanicStateInputs', '必须提供明确数组');
  const seen = new Set<string>();
  return inputs.map((input, index) => {
    const path = `mechanicStateInputs[${index}]`;
    exact(input, ['side', 'origin', 'skillKey', 'stateKey', 'value'], path);
    const identity = mechanicStateIdentity(input);
    const requirement = requirements.find(row => mechanicStateIdentity(row) === identity);
    if (!requirement || seen.has(identity)) fail(path, '只允许实际开启主体的唯一声明弹药，不允许重复或跨来源');
    exact(input.origin, ['kind', 'characterKey'], `${path}.origin`);
    if (!Number.isSafeInteger(input.value) || input.value < 0 || input.value > requirement.maxValue) fail(`${path}.value`, '初值必须是0至容量的明确整数');
    seen.add(identity);
    return structuredClone(input);
  }).sort((left, right) => mechanicStateIdentity(left).localeCompare(mechanicStateIdentity(right)));
}
