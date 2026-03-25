import type { SkillsFormData, SkillsSearchData } from './types';

export function createSkillsSearchData(): SkillsSearchData {
  return {
    skillId: '',
    ownerType: '',
    ownerId: '',
    skillKey: '',
    name: ''
  };
}

export function createSkillsFormData(): SkillsFormData {
  return {
    skillId: '',
    ownerType: '',
    ownerId: '',
    skillKey: '',
    name: '',
    description: '',
    resourceCostsText: '[\n  \n]',
    cooldownsText: '[\n  \n]',
    paramsText: '{\n  \n}',
    timingProfileText: '{\n  \n}',
    mechanicsConfigText: '{\n  \n}'
  };
}
