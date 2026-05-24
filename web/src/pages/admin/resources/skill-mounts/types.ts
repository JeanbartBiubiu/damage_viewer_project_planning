import type { SkillMount } from '../../../../types/api';

export type SkillMountsRecord = SkillMount;

export type SkillMountsSearchData = {
  targetCategory: string;
  targetId: string;
  skillId: string;
};

export type SkillMountsFormData = {
  targetCategory: string;
  targetId: string;
  skillId: string;
  enabled: boolean;
  extendText: string;
};

export function skillMountRowKey(record: Pick<SkillMount, 'targetCategory' | 'targetId' | 'skillId'>): string {
  return `${record.targetCategory}:${record.targetId}:${record.skillId}`;
}
