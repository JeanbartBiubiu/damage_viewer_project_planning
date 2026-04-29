import type { HeroesFormData, HeroesSearchData } from './types';

export function createHeroesSearchData(): HeroesSearchData {
  return {
    heroId: '',
    name: '',
    title: '',
    typeIds: []
  };
}

export function createHeroesFormData(): HeroesFormData {
  return {
    heroId: '',
    name: '',
    title: '',
    baseStatsText: '{\n  \n}',
    statsByLevelText: '{\n  \n}',
    selectedTypeIds: [],
    persistedTypeIds: []
  };
}
