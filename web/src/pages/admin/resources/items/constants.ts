import type { ItemsFormData, ItemsSearchData } from './types';

export function createItemsSearchData(): ItemsSearchData {
  return {
    itemId: '',
    name: '',
    goldCost: '',
    typeIds: []
  };
}

export function createItemsFormData(): ItemsFormData {
  return {
    itemId: '',
    name: '',
    goldCost: '',
    statsModifierText: '{\n  \n}',
    skillRefsText: '[\n  \n]',
    recipeIdsText: '[\n  \n]',
    selectedTypeIds: [],
    persistedTypeIds: []
  };
}
