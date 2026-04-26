import type { Hero } from '../../../../types/api';

export type HeroesRecord = Hero;

export type HeroesSearchData = {
  heroId: string;
  name: string;
  title: string;
  typeIds: number[];
};

export type HeroesFormData = {
  heroId: string;
  name: string;
  title: string;
  baseStatsText: string;
  statsByLevelText: string;
  selectedTypeIds: number[];
  persistedTypeIds: number[];
};
