import type { Item } from '../../../../types/api';

export type ItemsRecord = Item;

export type ItemsSearchData = {
  itemId: string;
  name: string;
  goldCost: string;
  typeIds: number[];
};

export type ItemsFormData = {
  itemId: string;
  name: string;
  goldCost: string;
  iconUrl: string;
  statsModifierText: string;
  skillRefsText: string;
  recipeIdsText: string;
  selectedTypeIds: number[];
  persistedTypeIds: number[];
};
