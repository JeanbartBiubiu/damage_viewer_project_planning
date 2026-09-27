import type {
  BuildConfiguration,
  BuildConfigurationDocument,
  BuildDefinition,
  BuildGroup,
  BuildOption,
  BuildSelection,
  BuildSelectionRules,
  BuildSlot
} from '../../../types/build';
import type { BuildOptionSkillRelation } from '../../../types/skillRelation';

export type BuildConfigurationIssue = { path: string; message: string };

export type BuildConfigurationValidation = {
  ok: boolean;
  errors: BuildConfigurationIssue[];
  notices: BuildConfigurationIssue[];
};

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const CONFIGURATION_FIELDS = ['systemKey', 'groupAssignments', 'selections', 'budgets'] as const;
const ASSIGNMENT_FIELDS = ['roleKey', 'groupKey'] as const;
const SELECTION_FIELDS = ['roleKey', 'groupKey', 'slotKey', 'optionKey', 'rank'] as const;

export function cumulativeRankCost(rankCosts: number[], rank: number): number {
  let total = 0;
  for (let index = 0; index < rank; index += 1) total += rankCosts[index] ?? 0;
  return total;
}

export function activeSkillGrants(
  relations: BuildOptionSkillRelation[], optionKey: string, rank: number
): BuildOptionSkillRelation[] {
  return relations.filter(relation => relation.optionKey === optionKey && relation.activationRank <= rank);
}

export function validateBuildConfigurations(
  gameId: string,
  definitions: BuildDefinition[],
  configurations: BuildConfiguration[]
): BuildConfigurationValidation {
  const errors: BuildConfigurationIssue[] = [];
  const notices: BuildConfigurationIssue[] = [];
  const bySystem = new Map<string, BuildDefinition>();
  const seenDefinitions = new Set<string>();
  for (const definition of definitions) {
    if (seenDefinitions.has(definition.system.systemKey)) {
      errors.push({ path: 'buildConfigurations', message: '同一次校验不能重复提供同一构筑系统的定义快照。' });
    }
    seenDefinitions.add(definition.system.systemKey);
    bySystem.set(definition.system.systemKey, definition);
  }
  const seenSystems = new Set<string>();
  configurations.forEach((configuration, index) => {
    const base = `buildConfigurations[${index}]`;
    if (seenSystems.has(configuration.systemKey)) {
      errors.push({ path: `${base}.systemKey`, message: '同一角色实例中同一构筑系统只能出现一次。' });
      return;
    }
    seenSystems.add(configuration.systemKey);
    const definition = bySystem.get(configuration.systemKey);
    if (!definition || definition.system.gameId !== gameId) {
      errors.push({ path: `${base}.systemKey`, message: '构筑系统不属于当前游戏的定义快照。' });
      return;
    }
    const context = createContext(definition);
    validateAssignments(base, configuration, context, errors);
    validateSelectionShape(base, configuration, context, errors);
    validateSelectionCounts(base, configuration, context, errors);
    validateDependencies(base, configuration, context, errors);
    validateBudget(base, configuration, context, errors);
    validateGrants(base, configuration, context, errors, notices);
  });
  return { ok: errors.length === 0, errors, notices };
}

export function parseBuildConfigurationDocument(value: unknown): BuildConfigurationDocument {
  const row = objectOf(value, 'buildConfigurations');
  rejectUnknown(row, ['buildConfigurations'], 'buildConfigurations');
  if (!Array.isArray(row.buildConfigurations)) fail('buildConfigurations', '完整配置必须是数组。');
  return {
    buildConfigurations: row.buildConfigurations.map((item, index) => {
      const configuration = parseConfiguration(item, index);
      const seen = new Set<string>();
      configuration.selections.forEach((selection, selectionIndex) => {
        const identity = JSON.stringify([selection.roleKey, selection.groupKey, selection.slotKey, selection.optionKey]);
        if (seen.has(identity)) fail(`buildConfigurations[${index}].selections[${selectionIndex}]`, '同一位置不能重复选择同一可选项。');
        seen.add(identity);
      });
      return configuration;
    })
  };
}

type Context = {
  definition: BuildDefinition;
  rules: BuildSelectionRules;
  groups: Map<string, BuildGroup>;
  options: Map<string, BuildOption>;
  roles: Map<string, BuildSelectionRules['groupRoles'][number]>;
  distinct: Set<string>;
};

function createContext(definition: BuildDefinition): Context {
  const groups = new Map(definition.groups.map(group => [group.groupKey, group]));
  const options = new Map(definition.options.map(option => [option.optionKey, option]));
  const roles = new Map(definition.system.selectionRules.groupRoles.map(role => [role.roleKey, role]));
  const distinct = new Set<string>();
  for (const role of definition.system.selectionRules.groupRoles) {
    for (const other of role.distinctFromRoleKeys) {
      distinct.add(pair(role.roleKey, other));
      distinct.add(pair(other, role.roleKey));
    }
  }
  return { definition, rules: definition.system.selectionRules, groups, options, roles, distinct };
}

function validateAssignments(
  base: string, configuration: BuildConfiguration, context: Context, errors: BuildConfigurationIssue[]
): void {
  const seen = new Set<string>();
  configuration.groupAssignments.forEach((assignment, index) => {
    const path = `${base}.groupAssignments[${index}]`;
    const role = context.roles.get(assignment.roleKey);
    if (!role) {
      errors.push({ path: `${path}.roleKey`, message: '分组角色不存在于当前构筑系统。' });
      return;
    }
    if (!role.groupKeys.includes(assignment.groupKey) || !context.groups.has(assignment.groupKey)) {
      errors.push({ path: `${path}.groupKey`, message: '该分组角色不能选择这个分组。' });
      return;
    }
    const identity = `${assignment.roleKey}\n${assignment.groupKey}`;
    if (seen.has(identity)) {
      errors.push({ path, message: '同一分组角色不能重复选择同一分组。' });
      return;
    }
    seen.add(identity);
    const conflict = configuration.groupAssignments.find((other, otherIndex) => otherIndex < index
      && other.groupKey === assignment.groupKey
      && context.distinct.has(pair(assignment.roleKey, other.roleKey)));
    if (conflict) {
      errors.push({ path: `${path}.groupKey`, message: '互异的分组角色不能选择同一分组。' });
    }
  });
  for (const role of context.rules.groupRoles) {
    const count = configuration.groupAssignments.filter(item => item.roleKey === role.roleKey && role.groupKeys.includes(item.groupKey)).length;
    if (count < role.minimumGroups || count > role.maximumGroups) {
      errors.push({
        path: `${base}.groupAssignments`,
        message: `分组角色「${role.name}」需要选择 ${role.minimumGroups}～${role.maximumGroups} 个分组，当前为 ${count} 个。`
      });
    }
  }
}

function validateSelectionShape(
  base: string, configuration: BuildConfiguration, context: Context, errors: BuildConfigurationIssue[]
): void {
  const accepted: number[] = [];
  configuration.selections.forEach((selection, index) => {
    const path = `${base}.selections[${index}]`;
    const role = context.roles.get(selection.roleKey);
    const assigned = configuration.groupAssignments.some(item => item.roleKey === selection.roleKey && item.groupKey === selection.groupKey);
    if (!role || !assigned) {
      errors.push({ path: `${path}.roleKey`, message: '选择必须属于已分配的分组角色和分组。' });
      return;
    }
    const slotRule = role.slotRules.find(rule => rule.groupKey === selection.groupKey && rule.slotKey === selection.slotKey);
    const slot = context.groups.get(selection.groupKey)?.slots.find(item => item.slotKey === selection.slotKey);
    if (!slotRule || !slot) {
      errors.push({ path: `${path}.slotKey`, message: '该分组角色不允许选择这个位置。' });
      return;
    }
    if (!slot.optionKeys.includes(selection.optionKey) || !context.options.has(selection.optionKey)) {
      errors.push({ path: `${path}.optionKey`, message: '可选项不在该位置的候选中。' });
      return;
    }
    accepted.push(index);
  });
  const seen = new Set<string>();
  const pointOptions = new Set<string>();
  for (const index of accepted) {
    const selection = configuration.selections[index]!;
    const path = `${base}.selections[${index}]`;
    const identity = JSON.stringify([selection.roleKey, selection.groupKey, selection.slotKey, selection.optionKey]);
    if (seen.has(identity)) errors.push({ path, message: '同一位置不能重复选择同一可选项。' });
    seen.add(identity);
    const option = context.options.get(selection.optionKey)!;
    if (context.definition.system.configurationMode === 'SLOT_SELECTION' && selection.rank !== 1) {
      errors.push({ path: `${path}.rank`, message: '按位置选择时投入等级只能为 1。' });
    } else if (!Number.isInteger(selection.rank) || selection.rank < 1 || selection.rank > option.maxRank) {
      errors.push({ path: `${path}.rank`, message: '投入等级必须是 1 到最高投入等级之间的整数。' });
    }
    if (context.definition.system.configurationMode === 'POINT_ALLOCATION') {
      if (pointOptions.has(selection.optionKey)) {
        errors.push({ path: `${path}.optionKey`, message: '按点投入时同一可选项在整个系统中最多选择一次。' });
      }
      pointOptions.add(selection.optionKey);
    }
  }
}

function validateSelectionCounts(
  base: string, configuration: BuildConfiguration, context: Context, errors: BuildConfigurationIssue[]
): void {
  configuration.groupAssignments.forEach((assignment, index) => {
    const role = context.roles.get(assignment.roleKey);
    if (!role) return;
    for (const rule of role.slotRules.filter(item => item.groupKey === assignment.groupKey)) {
      const count = configuration.selections.filter(selection => samePlace(selection, assignment.roleKey, assignment.groupKey, rule.slotKey)
        && context.groups.get(selection.groupKey)?.slots.find(slot => slot.slotKey === rule.slotKey)?.optionKeys.includes(selection.optionKey)).length;
      if (count < rule.minimumSelections || count > rule.maximumSelections) {
        errors.push({
          path: `${base}.groupAssignments[${index}]`,
          message: `位置「${rule.slotKey}」需要选择 ${rule.minimumSelections}～${rule.maximumSelections} 项，当前为 ${count} 项。`
        });
      }
    }
  });
  for (const role of context.rules.groupRoles) {
    const filled = new Set<string>();
    for (const selection of configuration.selections) {
      if (selection.roleKey !== role.roleKey) continue;
      const slot = context.groups.get(selection.groupKey)?.slots.find(item => item.slotKey === selection.slotKey);
      if (!slot?.optionKeys.includes(selection.optionKey)) continue;
      if (!role.slotRules.some(rule => rule.groupKey === selection.groupKey && rule.slotKey === selection.slotKey)) continue;
      filled.add(`${selection.groupKey}\n${selection.slotKey}`);
    }
    if (filled.size < role.minimumSelectedSlots || filled.size > role.maximumSelectedSlots) {
      errors.push({
        path: `${base}.groupAssignments`,
        message: `分组角色「${role.name}」需要有选择的位置数量为 ${role.minimumSelectedSlots}～${role.maximumSelectedSlots}，当前为 ${filled.size}。`
      });
    }
  }
}

function validateDependencies(
  base: string, configuration: BuildConfiguration, context: Context, errors: BuildConfigurationIssue[]
): void {
  const rankOf = (optionKey: string) => configuration.selections
    .filter(selection => selection.optionKey === optionKey)
    .reduce((highest, selection) => Math.max(highest, Number.isInteger(selection.rank) ? selection.rank : 0), 0);
  for (const rule of context.rules.prerequisites) {
    if (rankOf(rule.optionKey) < rule.minimumRank) continue;
    if (rankOf(rule.requiredOptionKey) >= rule.requiredMinimumRank) continue;
    const selectionIndex = configuration.selections.findIndex(selection => selection.optionKey === rule.optionKey);
    errors.push({
      path: selectionIndex >= 0 ? `${base}.selections[${selectionIndex}]` : `${base}.selections`,
      message: `达到投入等级 ${rule.minimumRank} 前，可选项「${rule.requiredOptionKey}」至少要达到 ${rule.requiredMinimumRank} 级。`
    });
  }
  context.rules.exclusions.forEach(rule => {
    const chosen = rule.optionKeys.filter(optionKey => rankOf(optionKey) > 0);
    if (chosen.length <= rule.maximumSelected) return;
    const selectionIndex = configuration.selections.findIndex(selection => chosen.includes(selection.optionKey));
    errors.push({
      path: selectionIndex >= 0 ? `${base}.selections[${selectionIndex}]` : `${base}.selections`,
      message: `互斥可选项最多选择 ${rule.maximumSelected} 个，当前选择了 ${chosen.length} 个不同可选项。`
    });
  });
}

function validateBudget(
  base: string, configuration: BuildConfiguration, context: Context, errors: BuildConfigurationIssue[]
): void {
  const spent = configuration.selections.reduce((total, selection) => {
    const option = context.options.get(selection.optionKey);
    if (!option || !Number.isInteger(selection.rank) || selection.rank < 1 || selection.rank > option.rankCosts.length) return total;
    return total + cumulativeRankCost(option.rankCosts, selection.rank);
  }, 0);
  const budget = context.rules.budget;
  const entries = Object.entries(configuration.budgets);
  if (!budget) {
    for (const [key] of entries) {
      errors.push({ path: `${base}.budgets.${key}`, message: '当前构筑系统没有预算，不能提交预算值。' });
    }
    if (spent > 0) errors.push({ path: `${base}.budgets`, message: '没有预算时所有可选项成本必须为 0。' });
    return;
  }
  for (const [key] of entries) {
    if (key !== budget.budgetKey || budget.maximumSource === 'FIXED') {
      errors.push({
        path: `${base}.budgets.${key}`,
        message: budget.maximumSource === 'FIXED' ? '固定预算不能在配置中重复提交。' : '配置只能提供规则要求的场景预算。'
      });
    }
  }
  if (budget.maximumSource === 'FIXED') {
    if (spent > (budget.fixedMaximum ?? -1)) {
      errors.push({ path: `${base}.budgets`, message: `累计成本 ${spent} 超过固定上限 ${budget.fixedMaximum}。` });
    }
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(configuration.budgets, budget.budgetKey)) {
    errors.push({ path: `${base}.budgets.${budget.budgetKey}`, message: '场景预算必须显式提供，不能自动补 0。' });
    return;
  }
  const value = configuration.budgets[budget.budgetKey];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647) {
    errors.push({ path: `${base}.budgets.${budget.budgetKey}`, message: '场景预算必须是大于等于 0 的整数。' });
    return;
  }
  if (spent > value) errors.push({ path: `${base}.budgets.${budget.budgetKey}`, message: `累计成本 ${spent} 超过场景预算 ${value}。` });
}

function validateGrants(
  base: string,
  configuration: BuildConfiguration,
  context: Context,
  errors: BuildConfigurationIssue[],
  notices: BuildConfigurationIssue[]
): void {
  configuration.selections.forEach((selection, index) => {
    if (!Number.isInteger(selection.rank) || selection.rank < 1) return;
    const grants = activeSkillGrants(context.definition.skillRelations, selection.optionKey, selection.rank);
    const enabled = grants.filter(grant => grant.skillStatus === 'ENABLED');
    const path = `${base}.selections[${index}]`;
    if (grants.some(grant => grant.skillStatus !== 'ENABLED')) {
      errors.push({ path, message: '停用技能的授予不能进入可运行配置。' });
    }
    if (enabled.length === 0) notices.push({ path, message: '当前没有可计算授予内容。' });
  });
}

function parseConfiguration(value: unknown, index: number): BuildConfiguration {
  const path = `buildConfigurations[${index}]`;
  const row = objectOf(value, path);
  rejectUnknown(row, CONFIGURATION_FIELDS, path);
  if (typeof row.systemKey !== 'string' || !KEY.test(row.systemKey)) fail(`${path}.systemKey`, '构筑系统标识不合法。');
  if (!Array.isArray(row.groupAssignments)) fail(`${path}.groupAssignments`, '分组分配必须是数组。');
  if (!Array.isArray(row.selections)) fail(`${path}.selections`, '选择必须是数组。');
  const budgets = objectOf(row.budgets, `${path}.budgets`);
  for (const [key, budget] of Object.entries(budgets)) {
    if (!KEY.test(key)) fail(`${path}.budgets.${key}`, '预算标识不合法。');
    if (typeof budget !== 'number' || !Number.isInteger(budget) || budget < 0 || budget > 2147483647) {
      fail(`${path}.budgets.${key}`, '预算必须是大于等于 0 的整数。');
    }
  }
  return {
    systemKey: row.systemKey,
    groupAssignments: row.groupAssignments.map((item, assignmentIndex) => parseAssignment(item, `${path}.groupAssignments[${assignmentIndex}]`)),
    selections: row.selections.map((item, selectionIndex) => parseSelection(item, `${path}.selections[${selectionIndex}]`)),
    budgets: budgets as Record<string, number>
  };
}

function parseAssignment(value: unknown, path: string): BuildConfiguration['groupAssignments'][number] {
  const row = objectOf(value, path);
  rejectUnknown(row, ASSIGNMENT_FIELDS, path);
  if (typeof row.roleKey !== 'string' || !KEY.test(row.roleKey)) fail(`${path}.roleKey`, '分组角色标识不合法。');
  if (typeof row.groupKey !== 'string' || !KEY.test(row.groupKey)) fail(`${path}.groupKey`, '分组标识不合法。');
  return { roleKey: row.roleKey, groupKey: row.groupKey };
}

function parseSelection(value: unknown, path: string): BuildSelection {
  const row = objectOf(value, path);
  rejectUnknown(row, SELECTION_FIELDS, path);
  const roleKey = selectionKey(row.roleKey, `${path}.roleKey`);
  const groupKey = selectionKey(row.groupKey, `${path}.groupKey`);
  const slotKey = selectionKey(row.slotKey, `${path}.slotKey`);
  const optionKey = selectionKey(row.optionKey, `${path}.optionKey`);
  if (typeof row.rank !== 'number' || !Number.isInteger(row.rank) || row.rank < 1 || row.rank > 2147483647) {
    fail(`${path}.rank`, '投入等级必须是大于等于 1 的整数。');
  }
  return { roleKey, groupKey, slotKey, optionKey, rank: row.rank };
}

function samePlace(selection: BuildSelection, roleKey: string, groupKey: string, slotKey: string): boolean {
  return selection.roleKey === roleKey && selection.groupKey === groupKey && selection.slotKey === slotKey;
}

function pair(left: string, right: string): string {
  return `${left}\n${right}`;
}

function selectionKey(value: unknown, path: string): string {
  if (typeof value !== 'string' || !KEY.test(value)) fail(path, '选择标识不合法。');
  return value;
}

function objectOf(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须提供完整对象。');
  return value as Record<string, unknown>;
}

function rejectUnknown(row: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(row)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, '完整配置不接受此字段。');
  }
}

function fail(path: string, message: string): never {
  const error = new Error(`${path}: ${message}`);
  (error as Error & { path: string }).path = path;
  throw error;
}

export function slotByKey(group: BuildGroup, slotKey: string): BuildSlot | undefined {
  return group.slots.find(slot => slot.slotKey === slotKey);
}
