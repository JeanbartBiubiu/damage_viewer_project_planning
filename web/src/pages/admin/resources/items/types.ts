import type { Item } from '../../../../types/api';

export type ItemsRecord = Item;

export type ItemsSearchData = {
  itemId: string;
  name: string;
  goldCost: string;
};

export type ItemsFormData = {
  itemId: string;
  name: string;
  goldCost: string;
  iconUrl: string;
  statsModifierText: string;
  skillRefsText: string;
  recipeIdsText: string;
};
