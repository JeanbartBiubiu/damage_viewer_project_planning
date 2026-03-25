import type { ItemsFormData, ItemsSearchData } from './types';

export function createItemsSearchData(): ItemsSearchData {
  return {
    itemId: '',
    name: '',
    goldCost: ''
  };
}

export function createItemsFormData(): ItemsFormData {
  return {
    itemId: '',
    name: '',
    goldCost: '',
    iconUrl: '',
    statsModifierText: '{\n  \n}',
    skillRefsText: '[\n  \n]',
    recipeIdsText: '[\n  \n]'
  };
}
