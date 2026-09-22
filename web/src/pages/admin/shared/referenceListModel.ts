export const COLLAPSED_REFERENCE_LIMIT = 3;
export const CATALOG_LOADING_TEXT = '加载中';
export const CATALOG_FAILED_TEXT = '加载失败';
export const CATALOG_MISSING_TEXT = '目录缺失';
export const CATALOG_DISABLED_TEXT = '已停用';

export type CatalogLoadState = 'ready' | 'failed' | undefined;

export type ReferenceItem = {
  key: string;
  name?: string | null;
  missing?: boolean;
  disabled?: boolean;
};

export type CatalogEntry = {
  name: string;
  status?: 'ENABLED' | 'DISABLED' | null;
};

export function formatReferenceItem(item: ReferenceItem): string {
  if (item.missing || !item.name) {
    return `${CATALOG_MISSING_TEXT}（${item.key}）`;
  }
  const disabled = item.disabled ? `（${CATALOG_DISABLED_TEXT}）` : '';
  return `${item.name}（${item.key}）${disabled}`;
}

export function catalogReferenceItems(
  keys: readonly string[],
  loadState: CatalogLoadState,
  entries?: ReadonlyMap<string, CatalogEntry>
): ReferenceItem[] {
  if (loadState !== 'ready') return keys.map((key) => ({ key }));
  return keys.map((key) => {
    const entry = entries?.get(key);
    if (!entry) return { key, missing: true };
    return {
      key,
      name: entry.name,
      disabled: entry.status === 'DISABLED'
    };
  });
}

export function collapsedItems<T>(
  items: readonly T[],
  expanded: boolean,
  limit = COLLAPSED_REFERENCE_LIMIT
): readonly T[] {
  if (expanded || items.length <= limit) return items;
  return items.slice(0, limit);
}

export function visibleReferenceItems(
  items: readonly ReferenceItem[],
  expanded: boolean,
  limit = COLLAPSED_REFERENCE_LIMIT
): readonly ReferenceItem[] {
  return collapsedItems(items, expanded, limit);
}

export function referenceListNeedsToggle(itemCount: number, limit = COLLAPSED_REFERENCE_LIMIT): boolean {
  return itemCount > limit;
}

export function catalogStatusText(loadState: CatalogLoadState): string | null {
  if (loadState === undefined) return CATALOG_LOADING_TEXT;
  if (loadState === 'failed') return CATALOG_FAILED_TEXT;
  return null;
}

export function expandReferenceButtonLabel(itemCount: number, expanded: boolean): string {
  return expanded ? '收起全部引用' : `展开全部引用（共 ${itemCount} 项）`;
}
