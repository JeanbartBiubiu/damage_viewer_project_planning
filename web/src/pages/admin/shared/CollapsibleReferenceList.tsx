import { useState } from 'react';
import {
  catalogStatusText,
  expandReferenceButtonLabel,
  formatReferenceItem,
  referenceListNeedsToggle,
  visibleReferenceItems,
  type CatalogLoadState,
  type ReferenceItem
} from './referenceListModel';

export type CollapsibleReferenceListProps = {
  items?: readonly ReferenceItem[];
  loadState?: CatalogLoadState;
  allLabel?: string | null;
};

export function CollapsibleReferenceList({
  items = [],
  loadState,
  allLabel
}: CollapsibleReferenceListProps) {
  const [expanded, setExpanded] = useState(false);
  if (allLabel) {
    return <span>{allLabel}</span>;
  }
  const status = catalogStatusText(loadState);
  if (status) {
    return <span>{status}</span>;
  }
  if (items.length === 0) {
    return <span>—</span>;
  }
  const visible = visibleReferenceItems(items, expanded);
  const canToggle = referenceListNeedsToggle(items.length);
  return (
    <span>
      {visible.map((item, index) => (
        <span key={item.key}>
          {index > 0 ? '、' : ''}
          {formatReferenceItem(item)}
        </span>
      ))}
      {canToggle ? (
        <>
          {expanded ? null : ` 等共 ${items.length} 项`}
          {' '}
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expandReferenceButtonLabel(items.length, expanded)}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? '收起' : '展开全部'}
          </button>
        </>
      ) : null}
    </span>
  );
}
