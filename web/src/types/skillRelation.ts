import type { SkillStatus } from './skill';
import type { BuildConfigurationMode, BuildSkillLevelMode } from './build';

export type SkillRelationOwnerKind = 'character' | 'equipment' | 'buildOption';

export type SkillRelationTarget = {
  kind: SkillRelationOwnerKind | 'skill';
  key: string;
  name: string;
  systemKey?: string;
  systemName?: string;
  configurationMode?: BuildConfigurationMode;
  maxRank?: number;
};

type SkillRelationSummary = {
  gameId: string;
  skillKey: string;
  skillName: string;
  skillStatus: SkillStatus;
  sortOrder: number;
};

export type CharacterSkillRelation = SkillRelationSummary & {
  characterKey: string;
  characterName: string;
};

export type EquipmentSkillRelation = SkillRelationSummary & {
  equipmentKey: string;
  equipmentName: string;
};

export type BuildOptionSkillRelation = {
  gameId: string;
  systemKey: string;
  optionKey: string;
  optionName: string;
  skillKey: string;
  skillName: string;
  skillStatus: SkillStatus;
  activationRank: number;
  skillLevelMode: BuildSkillLevelMode;
  fixedSkillLevel: number | null;
  sortOrder: number;
};

export type AnySkillRelation = CharacterSkillRelation | EquipmentSkillRelation | BuildOptionSkillRelation;

export type SkillRelationList<T> = { items: T[]; total: number };
export type CharacterSkillRelationQuery = { characterKey?: string; skillKey?: string };
export type EquipmentSkillRelationQuery = { equipmentKey?: string; skillKey?: string };
export type BuildOptionSkillRelationQuery = { systemKey?: string; optionKey?: string; skillKey?: string };
export type CreateCharacterSkillRelationRequest = {
  characterKey: string;
  skillKey: string;
  sortOrder: number;
};
export type CreateEquipmentSkillRelationRequest = {
  equipmentKey: string;
  skillKey: string;
  sortOrder: number;
};
export type UpdateSkillRelationRequest = { sortOrder: number };
export type UpdateBuildOptionSkillRelationRequest = {
  activationRank: number;
  skillLevelMode: BuildSkillLevelMode;
  fixedSkillLevel: number | null;
  sortOrder: number;
};
export type CreateBuildOptionSkillRelationRequest = UpdateBuildOptionSkillRelationRequest & {
  systemKey: string;
  optionKey: string;
  skillKey: string;
};
