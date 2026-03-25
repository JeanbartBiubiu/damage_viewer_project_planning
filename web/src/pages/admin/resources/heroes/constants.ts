import type { HeroesFormData, HeroesSearchData } from './types';

export function createHeroesSearchData(): HeroesSearchData {
  return {
    heroId: '',
    name: '',
    title: ''
  };
}

export function createHeroesFormData(): HeroesFormData {
  return {
    heroId: '',
    name: '',
    title: '',
    avatarUrl: '',
    baseStatsText: '{\n  \n}',
    statsByLevelText: '{\n  \n}'
  };
}
