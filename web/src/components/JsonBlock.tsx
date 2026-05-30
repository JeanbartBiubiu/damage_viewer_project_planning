import { Tag, Typography } from '@arco-design/web-react';

type JsonBlockProps = {
  value: unknown;
};

const MAX_OBJECT_FIELDS = 8;
const MAX_ARRAY_ITEMS = 6;
const MAX_DEPTH = 2;

type ValueKind = 'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'other';

function getValueKind(value: unknown): ValueKind {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'object') {
    return 'object';
  }
  if (typeof value === 'string') {
    return 'string';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  return 'other';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return getValueKind(value) === 'object';
}

function isPrimitiveValue(value: unknown): boolean {
  const kind = getValueKind(value);
  return kind !== 'array' && kind !== 'object';
}

function safeStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized ?? String(value);
  } catch (error) {
    return error instanceof Error ? error.message : String(value);
  }
}

function truncateText(value: string, maxLength = 120): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function formatPrimitive(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return value.trim() ? truncateText(value) : '空字符串';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

function describeValue(value: unknown): string {
  const kind = getValueKind(value);
  if (kind === 'object' && isPlainObject(value)) {
    const count = Object.keys(value).length;
    return `${count} 个字段`;
  }
  if (kind === 'array') {
    return `${(value as unknown[]).length} 项`;
  }
  if (kind === 'string') {
    return `${(value as string).length} 个字符`;
  }
  if (kind === 'null') {
    return '空值';
  }
  return kind;
}

function summarizeComplexValue(value: unknown): string {
  const kind = getValueKind(value);
  if (kind === 'object' && isPlainObject(value)) {
    const keys = Object.keys(value);
    const preview = keys.slice(0, 3).join(', ');
    return preview ? `${keys.length} 个字段 · ${preview}` : '空对象';
  }
  if (kind === 'array') {
    const items = value as unknown[];
    const preview = items
      .slice(0, 3)
      .map((item) => (isPrimitiveValue(item) ? formatPrimitive(item) : describeValue(item)))
      .join(' / ');
    return preview ? `${items.length} 项 · ${preview}` : '空数组';
  }
  return formatPrimitive(value);
}

function renderPrimitive(value: unknown) {
  const kind = getValueKind(value);
  return <span className={`json-inline-value is-${kind}`}>{formatPrimitive(value)}</span>;
}

function renderCollapsedValue(value: unknown) {
  return <span className="json-collapsed-summary">{summarizeComplexValue(value)}</span>;
}

function renderArray(value: unknown[], depth: number, path: string) {
  if (value.length === 0) {
    return <div className="json-empty-state">空数组</div>;
  }

  const visibleItems = value.slice(0, MAX_ARRAY_ITEMS);
  const primitiveOnly = visibleItems.every(isPrimitiveValue);

  return (
    <div className="json-collection-shell">
      <div className="json-collection-head">
        <span className="json-collection-count">{value.length} 项</span>
        {value.length > visibleItems.length ? <span className="json-collection-note">仅展示前 {visibleItems.length} 项</span> : null}
      </div>

      {primitiveOnly ? (
        <div className="json-chip-row">
          {visibleItems.map((item, index) => (
            <span className="json-chip" key={`${path}-${index}`}>
              {formatPrimitive(item)}
            </span>
          ))}
        </div>
      ) : (
        <div className="json-list">
          {visibleItems.map((item, index) => (
            <div className="json-list-item" key={`${path}-${index}`}>
              <span className="json-list-index">#{index + 1}</span>
              <div className="json-list-body">
                {depth >= MAX_DEPTH ? (
                  <span className="json-list-summary">{describeValue(item)}</span>
                ) : (
                  renderStructuredValue(item, depth + 1, `${path}-${index}`)
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderObject(value: Record<string, unknown>, depth: number, path: string) {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return <div className="json-empty-state">空对象</div>;
  }

  const visibleEntries = entries.slice(0, MAX_OBJECT_FIELDS);

  return (
    <div className={`json-struct-grid${depth > 0 ? ' is-nested' : ''}`}>
      {visibleEntries.map(([key, entryValue]) => (
        <article className="json-field-card" key={`${path}-${key}`}>
          <div className="json-field-head">
            <code className="json-field-key">{key}</code>
            <span className="json-field-meta">{describeValue(entryValue)}</span>
          </div>
          <div className="json-field-body">
            {depth >= MAX_DEPTH && !isPrimitiveValue(entryValue)
              ? renderCollapsedValue(entryValue)
              : depth >= MAX_DEPTH
                ? renderPrimitive(entryValue)
                : renderStructuredValue(entryValue, depth + 1, `${path}-${key}`)}
          </div>
        </article>
      ))}
      {entries.length > visibleEntries.length ? (
        <article className="json-field-card json-field-card-more">
          <Typography.Text type="secondary">还有 {entries.length - visibleEntries.length} 个字段，展开原始 JSON 查看完整内容。</Typography.Text>
        </article>
      ) : null}
    </div>
  );
}

function renderStructuredValue(value: unknown, depth = 0, path = 'root'): JSX.Element {
  const kind = getValueKind(value);

  if (kind === 'array') {
    return renderArray(value as unknown[], depth, path);
  }

  if (kind === 'object' && isPlainObject(value)) {
    return renderObject(value, depth, path);
  }

  return renderPrimitive(value);
}

export function JsonBlock({ value }: JsonBlockProps) {
  const kind = getValueKind(value);

  return (
    <div className="json-viewer-shell">
      <div className="json-viewer-head">
        <div className="json-viewer-summary">
          <Tag color="arcoblue">{kind}</Tag>
          <Typography.Text type="secondary">{describeValue(value)}</Typography.Text>
        </div>
        <Typography.Text type="secondary">优先展示结构化摘要，原始 JSON 收进折叠区。</Typography.Text>
      </div>

      <div className="json-viewer-body">{renderStructuredValue(value)}</div>

      <details className="json-raw-toggle">
        <summary>查看原始 JSON</summary>
        <pre className="json-shell">{safeStringify(value)}</pre>
      </details>
    </div>
  );
}
