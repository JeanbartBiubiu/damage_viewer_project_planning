export const BUILD_CONFIGURATION_MODES = ['SLOT_SELECTION', 'POINT_ALLOCATION'] as const;
export type BuildConfigurationMode = typeof BUILD_CONFIGURATION_MODES[number];

export const BUILD_CONFIGURATION_MODE_LABELS: Record<BuildConfigurationMode, string> = {
  SLOT_SELECTION: '按位置选择',
  POINT_ALLOCATION: '按点投入'
};

export const BUILD_BUDGET_SOURCES = ['FIXED', 'SCENARIO_INPUT'] as const;
export type BuildBudgetSource = typeof BUILD_BUDGET_SOURCES[number];

export const BUILD_BUDGET_SOURCE_LABELS: Record<BuildBudgetSource, string> = {
  FIXED: '固定上限',
  SCENARIO_INPUT: '场景显式输入'
};

export const BUILD_SKILL_LEVEL_MODES = ['FIXED', 'SAME_AS_OPTION'] as const;
export type BuildSkillLevelMode = typeof BUILD_SKILL_LEVEL_MODES[number];

export const BUILD_SKILL_LEVEL_MODE_LABELS: Record<BuildSkillLevelMode, string> = {
  FIXED: '固定技能等级',
  SAME_AS_OPTION: '随可选项投入等级'
};

export type BuildSlotRule = {
  groupKey: string;
  slotKey: string;
  minimumSelections: number;
  maximumSelections: number;
};

export type BuildGroupRole = {
  roleKey: string;
  name: string;
  groupKeys: string[];
  minimumGroups: number;
  maximumGroups: number;
  minimumSelectedSlots: number;
  maximumSelectedSlots: number;
  distinctFromRoleKeys: string[];
  slotRules: BuildSlotRule[];
};

export type BuildBudget = {
  budgetKey: string;
  name: string;
  maximumSource: BuildBudgetSource;
  fixedMaximum: number | null;
};

export type BuildPrerequisite = {
  optionKey: string;
  minimumRank: number;
  requiredOptionKey: string;
  requiredMinimumRank: number;
};

export type BuildExclusion = {
  optionKeys: string[];
  maximumSelected: number;
};

export type BuildSelectionRules = {
  groupRoles: BuildGroupRole[];
  budget: BuildBudget | null;
  prerequisites: BuildPrerequisite[];
  exclusions: BuildExclusion[];
};

export type BuildSlot = {
  slotKey: string;
  name: string;
  minimumSelections: number;
  maximumSelections: number;
  optionKeys: string[];
};

type BuildRecordTime = { createdAt: string; updatedAt: string };

export type BuildSystem = BuildRecordTime & {
  gameId: string;
  systemKey: string;
  name: string;
  description: string | null;
  configurationMode: BuildConfigurationMode;
  sortOrder: number;
  selectionRules: BuildSelectionRules;
};

export type BuildGroup = BuildRecordTime & {
  gameId: string;
  systemKey: string;
  groupKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  slots: BuildSlot[];
};

export type BuildOption = BuildRecordTime & {
  gameId: string;
  systemKey: string;
  optionKey: string;
  name: string;
  description: string | null;
  maxRank: number;
  rankCosts: number[];
};

export type BuildSystemListResponse = { items: BuildSystem[]; total: number };
export type BuildGroupListResponse = { items: BuildGroup[]; total: number };
export type BuildOptionListResponse = { items: BuildOption[]; total: number };

export type CreateBuildSystemRequest = {
  systemKey: string;
  name: string;
  description: string | null;
  configurationMode: BuildConfigurationMode;
  sortOrder: number;
  selectionRules: BuildSelectionRules;
};
export type UpdateBuildSystemRequest = Omit<CreateBuildSystemRequest, 'systemKey'>;

export type CreateBuildGroupRequest = {
  groupKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  slots: BuildSlot[];
};
export type UpdateBuildGroupRequest = Omit<CreateBuildGroupRequest, 'groupKey'>;

export type CreateBuildOptionRequest = {
  optionKey: string;
  name: string;
  description: string | null;
  maxRank: number;
  rankCosts: number[];
};
export type UpdateBuildOptionRequest = Omit<CreateBuildOptionRequest, 'optionKey'>;

export type BuildDefinition = {
  system: BuildSystem;
  groups: BuildGroup[];
  options: BuildOption[];
  skillRelations: import('./skillRelation').BuildOptionSkillRelation[];
};

export type BuildGroupAssignment = { roleKey: string; groupKey: string };

export type BuildSelection = {
  roleKey: string;
  groupKey: string;
  slotKey: string;
  optionKey: string;
  rank: number;
};

/** 某次场景中单个构筑系统的完整选择值。后端不保存这份值。 */
export type BuildConfiguration = {
  systemKey: string;
  groupAssignments: BuildGroupAssignment[];
  selections: BuildSelection[];
  budgets: Record<string, number>;
};

export type BuildConfigurationDocument = {
  buildConfigurations: BuildConfiguration[];
};
