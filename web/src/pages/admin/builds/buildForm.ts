import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  BUILD_BUDGET_SOURCES,
  BUILD_CONFIGURATION_MODES,
  type BuildBudgetSource,
  type BuildConfigurationMode,
  type BuildGroup,
  type BuildOption,
  type BuildSelectionRules,
  type BuildSkillLevelMode,
  type BuildSlot
} from '../../../types/build';

export type BuildFieldErrors = Record<string, string>;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;

export type SlotDraft = {
  slotKey: string;
  name: string;
  minimumSelections: string;
  maximumSelections: string;
  optionKeys: string[];
  persisted: boolean;
};

export type GroupRoleDraft = {
  roleKey: string;
  name: string;
  groupKeys: string[];
  minimumGroups: string;
  maximumGroups: string;
  minimumSelectedSlots: string;
  maximumSelectedSlots: string;
  distinctFromRoleKeys: string[];
  slotRules: Array<{ groupKey: string; slotKey: string; minimumSelections: string; maximumSelections: string }>;
};

export type SelectionRulesDraft = {
  groupRoles: GroupRoleDraft[];
  budgetEnabled: boolean;
  budgetKey: string;
  budgetName: string;
  maximumSource: BuildBudgetSource | '';
  fixedMaximum: string;
  prerequisites: Array<{ optionKey: string; minimumRank: string; requiredOptionKey: string; requiredMinimumRank: string }>;
  exclusions: Array<{ optionKeys: string[]; maximumSelected: string }>;
};

export type BuildSystemDraft = {
  systemKey: string;
  name: string;
  description: string;
  configurationMode: BuildConfigurationMode | '';
  sortOrder: string;
  selectionRules: SelectionRulesDraft;
};

export type BuildOptionDraft = {
  optionKey: string;
  name: string;
  description: string;
  maxRank: string;
  rankCosts: string[];
};

export type BuildGroupDraft = {
  groupKey: string;
  name: string;
  description: string;
  sortOrder: string;
  slots: SlotDraft[];
};

export function emptySelectionRulesDraft(): SelectionRulesDraft {
  return {
    groupRoles: [], budgetEnabled: false, budgetKey: '', budgetName: '', maximumSource: '', fixedMaximum: '',
    prerequisites: [], exclusions: []
  };
}

export function emptySlotDraft(): SlotDraft {
  return { slotKey: '', name: '', minimumSelections: '', maximumSelections: '', optionKeys: [], persisted: false };
}

export function selectionRulesToDraft(rules: BuildSelectionRules): SelectionRulesDraft {
  return {
    groupRoles: rules.groupRoles.map(role => ({
      roleKey: role.roleKey,
      name: role.name,
      groupKeys: [...role.groupKeys],
      minimumGroups: String(role.minimumGroups),
      maximumGroups: String(role.maximumGroups),
      minimumSelectedSlots: String(role.minimumSelectedSlots),
      maximumSelectedSlots: String(role.maximumSelectedSlots),
      distinctFromRoleKeys: [...role.distinctFromRoleKeys],
      slotRules: role.slotRules.map(rule => ({
        groupKey: rule.groupKey,
        slotKey: rule.slotKey,
        minimumSelections: String(rule.minimumSelections),
        maximumSelections: String(rule.maximumSelections)
      }))
    })),
    budgetEnabled: rules.budget !== null,
    budgetKey: rules.budget?.budgetKey ?? '',
    budgetName: rules.budget?.name ?? '',
    maximumSource: rules.budget?.maximumSource ?? 'FIXED',
    fixedMaximum: rules.budget?.fixedMaximum === null || rules.budget === null ? '' : String(rules.budget.fixedMaximum),
    prerequisites: rules.prerequisites.map(rule => ({
      optionKey: rule.optionKey,
      minimumRank: String(rule.minimumRank),
      requiredOptionKey: rule.requiredOptionKey,
      requiredMinimumRank: String(rule.requiredMinimumRank)
    })),
    exclusions: rules.exclusions.map(rule => ({ optionKeys: [...rule.optionKeys], maximumSelected: String(rule.maximumSelected) }))
  };
}

export function slotsToDraft(slots: BuildSlot[]): SlotDraft[] {
  return slots.map(slot => ({
    slotKey: slot.slotKey,
    name: slot.name,
    minimumSelections: String(slot.minimumSelections),
    maximumSelections: String(slot.maximumSelections),
    optionKeys: [...slot.optionKeys],
    persisted: true
  }));
}

export function applySlotPatch(slot: SlotDraft, patch: Partial<SlotDraft>): SlotDraft {
  if (slot.persisted && patch.slotKey !== undefined && patch.slotKey !== slot.slotKey) return slot;
  return { ...slot, ...patch };
}

export function moveOrdered<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = [...items];
  const target = index + direction;
  if (index < 0 || target < 0 || index >= items.length || target >= items.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function countError(value: string, label: string, minimum: number): string | null {
  if (!/^\d+$/.test(value.trim())) return `${label}须为大于等于 ${minimum} 的整数。`;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > 2147483647) return `${label}须为大于等于 ${minimum} 的整数。`;
  return null;
}

function keyError(value: string, creating: boolean): string | null {
  if (!creating) return null;
  return KEY.test(value.trim()) ? null : '小写字母开头，只能包含小写字母、数字和下划线，最多64字符。';
}

function nameError(value: string): string | null {
  const name = value.trim();
  return name.length >= 1 && name.length <= 100 ? null : '名称须为1～100字符。';
}

export function validateSystemDraft(
  draft: BuildSystemDraft, creating: boolean, groups: BuildGroup[], options: BuildOption[]
): BuildFieldErrors {
  const errors: BuildFieldErrors = {};
  const key = keyError(draft.systemKey, creating);
  if (key) errors.systemKey = key;
  const name = nameError(draft.name);
  if (name) errors.name = name;
  if (draft.description.trim().length > 2000) errors.description = '说明最多2000字符。';
  const validMode = BUILD_CONFIGURATION_MODES.includes(draft.configurationMode as BuildConfigurationMode);
  if (!validMode) errors.configurationMode = '请选择配置方式。';
  const sort = countError(draft.sortOrder, '显示顺序', 0);
  if (sort) errors.sortOrder = sort;
  if (validMode) {
    Object.assign(errors, validateSelectionRules(
      draft.selectionRules, draft.configurationMode as BuildConfigurationMode, groups, options
    ));
  }
  return errors;
}

export function validateOptionDraft(
  draft: BuildOptionDraft, creating: boolean, mode: BuildConfigurationMode, budgetEnabled: boolean
): BuildFieldErrors {
  const errors: BuildFieldErrors = {};
  const key = keyError(draft.optionKey, creating);
  if (key) errors.optionKey = key;
  const name = nameError(draft.name);
  if (name) errors.name = name;
  if (draft.description.trim().length > 2000) errors.description = '说明最多2000字符。';
  const rank = countError(draft.maxRank, '最高投入等级', 1);
  if (rank) errors.maxRank = rank;
  else if (mode === 'SLOT_SELECTION' && Number(draft.maxRank) !== 1) errors.maxRank = '按位置选择的最高投入等级只能为 1。';
  const maxRank = rank ? 0 : Number(draft.maxRank);
  if (!rank && draft.rankCosts.length !== maxRank) errors.rankCosts = '每一级都要填写成本，数量必须等于最高投入等级。';
  draft.rankCosts.forEach((cost, index) => {
    const message = countError(cost, `第${index + 1}级成本`, 0);
    if (message) errors[`rankCosts[${index}]`] = message;
    else if (!budgetEnabled && Number(cost) !== 0) errors[`rankCosts[${index}]`] = '没有预算时成本必须为 0。';
  });
  return errors;
}

export function validateGroupDraft(
  draft: BuildGroupDraft, creating: boolean, options: BuildOption[], otherGroups: BuildGroup[], mode: BuildConfigurationMode
): BuildFieldErrors {
  const errors: BuildFieldErrors = {};
  const key = keyError(draft.groupKey, creating);
  if (key) errors.groupKey = key;
  const name = nameError(draft.name);
  if (name) errors.name = name;
  if (draft.description.trim().length > 2000) errors.description = '说明最多2000字符。';
  const sort = countError(draft.sortOrder, '显示顺序', 0);
  if (sort) errors.sortOrder = sort;
  const known = new Set(options.map(option => option.optionKey));
  const placed = new Set(otherGroups.flatMap(group => group.slots.flatMap(slot => slot.optionKeys)));
  const localKeys = new Set<string>();
  draft.slots.forEach((slot, index) => {
    const prefix = `slots[${index}]`;
    if (!KEY.test(slot.slotKey.trim())) errors[`${prefix}.slotKey`] = '位置标识不合法。';
    else if (localKeys.has(slot.slotKey.trim())) errors[`${prefix}.slotKey`] = '同一分组的位置标识不能重复。';
    localKeys.add(slot.slotKey.trim());
    const slotName = nameError(slot.name);
    if (slotName) errors[`${prefix}.name`] = slotName;
    const minimum = countError(slot.minimumSelections, '最少选择数', 0);
    const maximum = countError(slot.maximumSelections, '最多选择数', 0);
    if (minimum) errors[`${prefix}.minimumSelections`] = minimum;
    if (maximum) errors[`${prefix}.maximumSelections`] = maximum;
    if (!minimum && !maximum && Number(slot.minimumSelections) > Number(slot.maximumSelections)) {
      errors[`${prefix}.minimumSelections`] = '最少选择数不能大于最多选择数。';
    }
    const row = new Set<string>();
    slot.optionKeys.forEach((optionKey, position) => {
      const field = `${prefix}.optionKeys[${position}]`;
      if (!known.has(optionKey)) errors[field] = '请选择当前系统中的可选项。';
      else if (row.has(optionKey)) errors[field] = '同一位置不能重复放入可选项。';
      else if (mode === 'POINT_ALLOCATION' && (placed.has(optionKey) || draft.slots.some((other, otherIndex) => otherIndex !== index && other.optionKeys.includes(optionKey)))) {
        errors[field] = '按点投入时同一可选项在整个布局最多出现一次。';
      }
      row.add(optionKey);
    });
  });
  return errors;
}

function validateSelectionRules(
  draft: SelectionRulesDraft, mode: BuildConfigurationMode, groups: BuildGroup[], options: BuildOption[]
): BuildFieldErrors {
  const errors: BuildFieldErrors = {};
  const groupIndex = new Map(groups.map(group => [group.groupKey, group]));
  const optionIndex = new Map(options.map(option => [option.optionKey, option]));
  const roleKeys = new Set<string>();
  draft.groupRoles.forEach((role, index) => {
    const prefix = `selectionRules.groupRoles[${index}]`;
    if (!KEY.test(role.roleKey.trim())) errors[`${prefix}.roleKey`] = '分组角色标识不合法。';
    else if (roleKeys.has(role.roleKey.trim())) errors[`${prefix}.roleKey`] = '分组角色标识不能重复。';
    roleKeys.add(role.roleKey.trim());
    const roleName = nameError(role.name);
    if (roleName) errors[`${prefix}.name`] = roleName;
    const minimumGroups = countError(role.minimumGroups, '最少分组数', 0);
    const maximumGroups = countError(role.maximumGroups, '最多分组数', 0);
    if (minimumGroups) errors[`${prefix}.minimumGroups`] = minimumGroups;
    if (maximumGroups) errors[`${prefix}.maximumGroups`] = maximumGroups;
    if (!minimumGroups && !maximumGroups && (Number(role.minimumGroups) > Number(role.maximumGroups) || Number(role.maximumGroups) > role.groupKeys.length)) {
      errors[`${prefix}.minimumGroups`] = '分组数量不能超出可选分组。';
    }
    const minimumSlots = countError(role.minimumSelectedSlots, '最少已选位置数', 0);
    const maximumSlots = countError(role.maximumSelectedSlots, '最多已选位置数', 0);
    if (minimumSlots) errors[`${prefix}.minimumSelectedSlots`] = minimumSlots;
    if (maximumSlots) errors[`${prefix}.maximumSelectedSlots`] = maximumSlots;
    if (!minimumSlots && !maximumSlots && (Number(role.minimumSelectedSlots) > Number(role.maximumSelectedSlots) || Number(role.minimumSelectedSlots) > role.slotRules.length)) {
      errors[`${prefix}.minimumSelectedSlots`] = '已选位置数量不能超出角色位置规则。';
    }
    role.groupKeys.forEach((groupKey, groupIndexNumber) => {
      if (!groupIndex.has(groupKey)) errors[`${prefix}.groupKeys[${groupIndexNumber}]`] = '分组不存在于当前系统。';
    });
    if (new Set(role.groupKeys).size !== role.groupKeys.length) errors[`${prefix}.groupKeys`] = '分组不能重复。';
    role.distinctFromRoleKeys.forEach((other, otherIndex) => {
      if (other === role.roleKey.trim()) errors[`${prefix}.distinctFromRoleKeys[${otherIndex}]`] = '分组角色不能与自己互异。';
      else if (!draft.groupRoles.some(candidate => candidate.roleKey.trim() === other)) errors[`${prefix}.distinctFromRoleKeys[${otherIndex}]`] = '互异角色不存在。';
    });
    const seenSlots = new Set<string>();
    role.slotRules.forEach((rule, ruleIndex) => {
      const field = `${prefix}.slotRules[${ruleIndex}]`;
      if (!role.groupKeys.includes(rule.groupKey)) errors[`${field}.groupKey`] = '位置规则只能引用本角色的分组。';
      const identity = `${rule.groupKey}\n${rule.slotKey}`;
      if (seenSlots.has(identity)) errors[`${field}.slotKey`] = '同一角色下的位置规则不能重复。';
      seenSlots.add(identity);
      const slot = groupIndex.get(rule.groupKey)?.slots.find(item => item.slotKey === rule.slotKey);
      if (!slot) errors[`${field}.slotKey`] = '位置不存在于当前分组。';
      const minimum = countError(rule.minimumSelections, '最少选择数', 0);
      const maximum = countError(rule.maximumSelections, '最多选择数', 0);
      if (minimum) errors[`${field}.minimumSelections`] = minimum;
      if (maximum) errors[`${field}.maximumSelections`] = maximum;
      if (!minimum && !maximum && Number(rule.minimumSelections) > Number(rule.maximumSelections)) errors[`${field}.minimumSelections`] = '最少选择数不能大于最多选择数。';
      if (slot && !minimum && !maximum && (Number(rule.minimumSelections) < slot.minimumSelections || Number(rule.maximumSelections) > slot.maximumSelections)) {
        errors[`${field}.minimumSelections`] = '角色位置数量必须处于分组位置允许范围内。';
      }
    });
  });
  const directed = new Set<string>();
  draft.groupRoles.forEach((role, index) => {
    role.distinctFromRoleKeys.forEach((other, otherIndex) => {
      const forward = `${role.roleKey.trim()}\n${other}`;
      const reverse = `${other}\n${role.roleKey.trim()}`;
      if (directed.has(reverse)) errors[`selectionRules.groupRoles[${index}].distinctFromRoleKeys[${otherIndex}]`] = '互异关系不能双向重复声明。';
      directed.add(forward);
    });
  });
  if (draft.budgetEnabled) {
    if (!KEY.test(draft.budgetKey.trim())) errors['selectionRules.budget.budgetKey'] = '预算标识不合法。';
    const budgetName = nameError(draft.budgetName);
    if (budgetName) errors['selectionRules.budget.name'] = budgetName;
    if (!BUILD_BUDGET_SOURCES.includes(draft.maximumSource as BuildBudgetSource)) errors['selectionRules.budget.maximumSource'] = '请选择预算上限来源。';
    if (draft.maximumSource === 'FIXED') {
      const fixed = countError(draft.fixedMaximum, '固定上限', 0);
      if (fixed) errors['selectionRules.budget.fixedMaximum'] = fixed;
    } else if (draft.fixedMaximum.trim()) errors['selectionRules.budget.fixedMaximum'] = '场景显式输入时上限必须留空。';
  } else if (options.some(option => option.rankCosts.some(cost => cost !== 0))) {
    errors['selectionRules.budget'] = '已有可选项成本不为 0，不能清空预算。';
  }
  const pairs = new Set<string>();
  draft.prerequisites.forEach((rule, index) => {
    const prefix = `selectionRules.prerequisites[${index}]`;
    const option = optionIndex.get(rule.optionKey);
    const required = optionIndex.get(rule.requiredOptionKey);
    if (!option) errors[`${prefix}.optionKey`] = '可选项不存在于当前系统。';
    if (!required) errors[`${prefix}.requiredOptionKey`] = '前置可选项不存在于当前系统。';
    if (rule.optionKey && rule.optionKey === rule.requiredOptionKey) errors[`${prefix}.optionKey`] = '前置不能指向自己。';
    const minimum = countError(rule.minimumRank, '当前投入等级', 1);
    const requiredRank = countError(rule.requiredMinimumRank, '前置投入等级', 1);
    if (minimum) errors[`${prefix}.minimumRank`] = minimum;
    if (requiredRank) errors[`${prefix}.requiredMinimumRank`] = requiredRank;
    if (option && !minimum && Number(rule.minimumRank) > option.maxRank) errors[`${prefix}.minimumRank`] = '前置等级超出可选项最高等级。';
    if (required && !requiredRank && Number(rule.requiredMinimumRank) > required.maxRank) errors[`${prefix}.requiredMinimumRank`] = '前置等级超出可选项最高等级。';
    if (mode === 'SLOT_SELECTION' && !minimum && !requiredRank && (Number(rule.minimumRank) !== 1 || Number(rule.requiredMinimumRank) !== 1)) {
      errors[`${prefix}.minimumRank`] = '按位置选择的投入等级只能为 1。';
    }
    const pair = `${rule.optionKey}\n${rule.requiredOptionKey}`;
    if (rule.optionKey && pairs.has(pair)) errors[`${prefix}.optionKey`] = '同一对前置不能重复。';
    pairs.add(pair);
  });
  if (prerequisiteCycle(draft.prerequisites)) errors['selectionRules.prerequisites'] = '前置关系形成循环。';
  draft.exclusions.forEach((rule, index) => {
    const prefix = `selectionRules.exclusions[${index}]`;
    if (rule.optionKeys.length === 0) errors[`${prefix}.optionKeys`] = '互斥可选项不能为空。';
    if (new Set(rule.optionKeys).size !== rule.optionKeys.length) errors[`${prefix}.optionKeys`] = '互斥可选项不能重复。';
    rule.optionKeys.forEach((optionKey, optionIndexNumber) => {
      if (!optionIndex.has(optionKey)) errors[`${prefix}.optionKeys[${optionIndexNumber}]`] = '可选项不存在于当前系统。';
    });
    const maximum = countError(rule.maximumSelected, '最多选择数', 0);
    if (maximum) errors[`${prefix}.maximumSelected`] = maximum;
    else if (Number(rule.maximumSelected) > rule.optionKeys.length) errors[`${prefix}.maximumSelected`] = '互斥数量不能超过可选项数量。';
  });
  return errors;
}

function prerequisiteCycle(rules: SelectionRulesDraft['prerequisites']): boolean {
  const edges = new Map<string, string[]>();
  for (const rule of rules) {
    if (!rule.optionKey || !rule.requiredOptionKey || rule.optionKey === rule.requiredOptionKey) continue;
    const next = edges.get(rule.requiredOptionKey) ?? [];
    next.push(rule.optionKey);
    edges.set(rule.requiredOptionKey, next);
  }
  const color = new Map<string, number>();
  const visit = (node: string): boolean => {
    const state = color.get(node) ?? 0;
    if (state === 2) return true;
    if (state === 1) return false;
    color.set(node, 2);
    if ((edges.get(node) ?? []).some(visit)) return true;
    color.set(node, 1);
    return false;
  };
  return [...edges.keys()].some(visit);
}

export function selectionRulesFromDraft(draft: SelectionRulesDraft): BuildSelectionRules {
  return {
    groupRoles: draft.groupRoles.map(role => ({
      roleKey: role.roleKey.trim(),
      name: role.name.trim(),
      groupKeys: [...role.groupKeys],
      minimumGroups: Number(role.minimumGroups),
      maximumGroups: Number(role.maximumGroups),
      minimumSelectedSlots: Number(role.minimumSelectedSlots),
      maximumSelectedSlots: Number(role.maximumSelectedSlots),
      distinctFromRoleKeys: [...role.distinctFromRoleKeys],
      slotRules: role.slotRules.map(rule => ({
        groupKey: rule.groupKey,
        slotKey: rule.slotKey,
        minimumSelections: Number(rule.minimumSelections),
        maximumSelections: Number(rule.maximumSelections)
      }))
    })),
    budget: draft.budgetEnabled ? {
      budgetKey: draft.budgetKey.trim(),
      name: draft.budgetName.trim(),
      maximumSource: draft.maximumSource as BuildBudgetSource,
      fixedMaximum: draft.maximumSource === 'FIXED' ? Number(draft.fixedMaximum) : null
    } : null,
    prerequisites: draft.prerequisites.map(rule => ({
      optionKey: rule.optionKey,
      minimumRank: Number(rule.minimumRank),
      requiredOptionKey: rule.requiredOptionKey,
      requiredMinimumRank: Number(rule.requiredMinimumRank)
    })),
    exclusions: draft.exclusions.map(rule => ({ optionKeys: [...rule.optionKeys], maximumSelected: Number(rule.maximumSelected) }))
  };
}

export function buildFieldErrors(error: unknown): BuildFieldErrors {
  if (!(error instanceof ApiRequestError) || !Array.isArray(error.details?.fieldIssues)) return {};
  return Object.fromEntries(error.details.fieldIssues.flatMap(issue => {
    if (!issue || typeof issue !== 'object') return [];
    const row = issue as Record<string, unknown>;
    return typeof row.field === 'string' && typeof row.message === 'string' ? [[row.field, row.message]] : [];
  }));
}

export function buildErrorMessage(error: unknown): string {
  const message = getErrorMessage(error);
  if (!(error instanceof ApiRequestError) || !Array.isArray(error.details?.references)) return message;
  const locations = error.details.references.flatMap(value => {
    if (!value || typeof value !== 'object' || typeof (value as { path?: unknown }).path !== 'string') return [];
    return [(value as { path: string }).path];
  });
  return locations.length ? `${message} 占用位置：${locations.join('；')}` : message;
}

export function buildWriteResultIsUncertain(error: unknown): boolean {
  return !(error instanceof ApiRequestError) || error.status >= 500 || error.status === 408 || error.status === 429;
}

export function buildReadbackConfirmedMissing(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

export function validateGrantDraft(input: {
  activationRank: string;
  skillLevelMode: BuildSkillLevelMode;
  fixedSkillLevel: string;
  sortOrder: string;
  maxRank: number;
  mode: BuildConfigurationMode;
  skillMaxLevel: number | null;
}): BuildFieldErrors {
  const errors: BuildFieldErrors = {};
  const activation = countError(input.activationRank, '授予等级', 1);
  if (activation) errors.activationRank = activation;
  else if (Number(input.activationRank) > input.maxRank) errors.activationRank = '授予等级不能超过可选项最高投入等级。';
  const sort = countError(input.sortOrder, '排序', 0);
  if (sort) errors.sortOrder = sort;
  if (input.mode === 'SLOT_SELECTION' && input.skillLevelMode !== 'FIXED') errors.skillLevelMode = '按位置选择只接受固定技能等级。';
  if (input.skillLevelMode === 'FIXED') {
    const fixed = countError(input.fixedSkillLevel, '固定技能等级', 1);
    if (fixed) errors.fixedSkillLevel = fixed;
    else if (input.skillMaxLevel !== null && Number(input.fixedSkillLevel) > input.skillMaxLevel) errors.fixedSkillLevel = '固定技能等级不能超过技能最高等级。';
  } else if (input.fixedSkillLevel.trim()) errors.fixedSkillLevel = '随可选项投入等级时固定技能等级必须留空。';
  else if (input.skillMaxLevel !== null && input.maxRank > input.skillMaxLevel) errors.skillLevelMode = '可选项最高投入等级不能超过技能最高等级。';
  return errors;
}
