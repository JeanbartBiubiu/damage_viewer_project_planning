import { describe, expect, it } from 'vitest';
import {
  CATALOG_DISABLED_TEXT,
  CATALOG_FAILED_TEXT,
  CATALOG_LOADING_TEXT,
  CATALOG_MISSING_TEXT,
  catalogReferenceItems,
  catalogStatusText,
  expandReferenceButtonLabel,
  formatReferenceItem,
  referenceListNeedsToggle,
  visibleReferenceItems
} from './referenceListModel';

describe('只读折叠引用展示', () => {
  it('超过三项时默认只暴露前三项，展开后保留全量名字、键、停用和缺失', () => {
    const items = catalogReferenceItems(
      ['a', 'b', 'c', 'd', 'e'],
      'ready',
      new Map([
        ['a', { name: '技能甲' }],
        ['b', { name: '技能乙', status: 'DISABLED' }],
        ['c', { name: '技能丙' }]
      ])
    );
    expect(items).toEqual([
      { key: 'a', name: '技能甲', disabled: false },
      { key: 'b', name: '技能乙', disabled: true },
      { key: 'c', name: '技能丙', disabled: false },
      { key: 'd', missing: true },
      { key: 'e', missing: true }
    ]);
    expect(visibleReferenceItems(items, false).map((item) => item.key)).toEqual(['a', 'b', 'c']);
    expect(visibleReferenceItems(items, true)).toEqual(items);
    expect(referenceListNeedsToggle(items.length)).toBe(true);
    expect(formatReferenceItem(items[0]!)).toBe('技能甲（a）');
    expect(formatReferenceItem(items[1]!)).toBe(`技能乙（b）（${CATALOG_DISABLED_TEXT}）`);
    expect(formatReferenceItem(items[3]!)).toBe(`${CATALOG_MISSING_TEXT}（d）`);
    expect(expandReferenceButtonLabel(5, false)).toBe('展开全部引用（共 5 项）');
    expect(expandReferenceButtonLabel(5, true)).toBe('收起全部引用');
  });

  it('三项以内不折叠，加载失败和加载中不把键当成名称', () => {
    const keys = ['only', 'two'];
    expect(visibleReferenceItems(catalogReferenceItems(keys, 'ready', new Map([
      ['only', { name: '仅有' }],
      ['two', { name: '两项' }]
    ])), false)).toHaveLength(2);
    expect(referenceListNeedsToggle(3)).toBe(false);
    expect(catalogStatusText(undefined)).toBe(CATALOG_LOADING_TEXT);
    expect(catalogStatusText('failed')).toBe(CATALOG_FAILED_TEXT);
    expect(catalogReferenceItems(keys, 'failed').every((item) => item.name == null && !item.missing)).toBe(true);
    expect(formatReferenceItem({ key: 'only' })).toBe(`${CATALOG_MISSING_TEXT}（only）`);
  });
});
