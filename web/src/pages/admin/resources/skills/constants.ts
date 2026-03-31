import type { SkillsFormData, SkillsSearchData } from './types';

export function createSkillsSearchData(): SkillsSearchData {
  return {
    skillId: '',
    ownerType: '',
    ownerId: '',
    skillKey: '',
    name: '',
    typeIds: []
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
    mechanicsConfigText: '{\n  "version": 1,\n  "triggers": []\n}',
    mvpExtensionsText: '{\n  \n}',
    notesText: '[\n  \n]',
    extraFieldsText: '{\n  \n}',
    selectedTypeIds: [],
    persistedTypeIds: []
  };
}
