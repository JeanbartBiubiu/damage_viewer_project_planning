import type { Hero } from '../../../../types/api';

export type HeroesRecord = Hero;

export type HeroesSearchData = {
  heroId: string;
  name: string;
  title: string;
};

export type HeroesFormData = {
  heroId: string;
  name: string;
  title: string;
  avatarUrl: string;
  baseStatsText: string;
  statsByLevelText: string;
};
