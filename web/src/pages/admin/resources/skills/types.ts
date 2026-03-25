import type { Skill } from '../../../../types/api';

export type SkillsRecord = Skill;

export type SkillsSearchData = {
  skillId: string;
  ownerType: string;
  ownerId: string;
  skillKey: string;
  name: string;
};

export type SkillsFormData = {
  skillId: string;
  ownerType: string;
  ownerId: string;
  skillKey: string;
  name: string;
  description: string;
  resourceCostsText: string;
  cooldownsText: string;
  paramsText: string;
  timingProfileText: string;
  mechanicsConfigText: string;
};
