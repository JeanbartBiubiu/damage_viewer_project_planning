import { Alert, Select, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage, getItems } from '../../services/apiClient';
import type { Item } from '../../types/api';

type ItemRecipeSelectorProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  currentItemId?: string;
  value: string[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
};

export function ItemRecipeSelector({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  currentItemId,
  value,
  disabled = false,
  onChange
}: ItemRecipeSelectorProps) {
  const token = adminToken.trim();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedGameId || !token) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getItems(apiBaseUrl, selectedGameId, token)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setItems(result.data.items);
        setLoading(false);
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setItems([]);
        setLoading(false);
        setError(getErrorMessage(loadError));
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId, token]);

  const options = useMemo(
    () =>
      items
        .filter((item) => item.itemId !== currentItemId)
        .map((item) => ({
          label: `${item.name ?? item.itemId} · ${item.itemId}`,
          value: item.itemId
        })),
    [currentItemId, items]
  );

  return (
    <div>
      <Select
        mode="multiple"
        showSearch
        allowClear
        maxTagCount={3}
        placeholder="选择合成配方子件"
        value={value}
        disabled={disabled || !selectedGameId || !token}
        loading={loading}
        options={options}
        onChange={(nextValue) => onChange(Array.isArray(nextValue) ? nextValue.map(String) : [])}
        filterOption={(inputValue, option) => {
          const optionData = option as { value?: unknown; label?: unknown } | undefined;
          const searchText = `${String(optionData?.value ?? '')} ${String(optionData?.label ?? '')}`.toLowerCase();
          return searchText.includes(inputValue.trim().toLowerCase());
        }}
      />

      {error ? <Alert type="error" content={`装备列表加载失败：${error}`} style={{ marginTop: 8 }} /> : null}
      {!error ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
          可多选多个子件，保存时回写 `recipeIds` 数组。
        </Typography.Text>
      ) : null}
    </div>
  );
}
