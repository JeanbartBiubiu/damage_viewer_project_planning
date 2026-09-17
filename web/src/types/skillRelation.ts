import type { SkillStatus } from './skill';

export type SkillRelationOwnerKind = 'character' | 'equipment' | 'rune';

export type SkillRelationTarget = {
  kind: SkillRelationOwnerKind | 'skill';
  key: string;
  name: string;
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

export type RuneSkillRelation = SkillRelationSummary & { runeKey: string; runeName: string };
export type AnySkillRelation = CharacterSkillRelation | EquipmentSkillRelation | RuneSkillRelation;

export type SkillRelationList<T> = { items: T[]; total: number };
export type CharacterSkillRelationQuery = { characterKey?: string; skillKey?: string };
export type EquipmentSkillRelationQuery = { equipmentKey?: string; skillKey?: string };
export type RuneSkillRelationQuery = { runeKey?: string; skillKey?: string };
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
export type CreateRuneSkillRelationRequest = { runeKey: string; skillKey: string; sortOrder: number };
