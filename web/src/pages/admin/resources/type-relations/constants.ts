import type { TypeRelationsFormData, TypeRelationsSearchData } from './types';

// 目标类别选项：search 和 modal 共用同一份。
export const TARGET_CATEGORY_OPTIONS = [
  { label: '英雄', value: 'character' },
  { label: '技能', value: 'skill' },
  { label: '装备', value: 'equipment' },
  { label: '属性', value: 'attribute' },
  { label: '类型', value: 'type' }
];

export function createTypeRelationsSearchData(): TypeRelationsSearchData {
  return {
    typeId: '',
    targetCategory: '',
    targetId: ''
  };
}

export function createTypeRelationsFormData(): TypeRelationsFormData {
  return {
    typeId: '',
    targetCategory: '',
    targetId: '',
    extendText: '{\n  \n}'
  };
}
