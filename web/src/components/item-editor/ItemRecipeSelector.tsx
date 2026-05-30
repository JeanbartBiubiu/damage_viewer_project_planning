import { Alert, Select, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { createEntitySelectOption, filterEntitySelectOption } from '../EntitySelectOption';
import { getErrorMessage, getItems } from '../../services/apiClient';
import { useResourceImageCache } from '../../pages/admin/resources/shared/useResourceImageCache';
import { buildItemImageUri } from '../../services/resourceImage';
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
  const { imageSrcByUri } = useResourceImageCache(selectedGameId);

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
        .map((item) => {
          const imageUri = buildItemImageUri(item.itemId);
          return createEntitySelectOption({
            value: item.itemId,
            primary: item.name ?? item.itemId,
            secondary: item.name ? item.itemId : undefined,
            imageSrc: (imageUri ? imageSrcByUri[imageUri] ?? null : null) ?? item.iconUrl ?? null,
            showImage: true,
            imageAlt: item.name ?? item.itemId
          });
        }),
    [currentItemId, imageSrcByUri, items]
  );

  return (
    <div>
      <Select
        mode="multiple"
        showSearch
        allowClear
        maxTagCount={3}
        placeholder="閫夋嫨鍚堟垚閰嶆柟瀛愪欢"
        value={value}
        disabled={disabled || !selectedGameId || !token}
        loading={loading}
        options={options}
        onChange={(nextValue) => onChange(Array.isArray(nextValue) ? nextValue.map(String) : [])}
        filterOption={filterEntitySelectOption}
      />

      {error ? <Alert type="error" content={`瑁呭鍒楄〃鍔犺浇澶辫触锛?{error}`} style={{ marginTop: 8 }} /> : null}
      {!error ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
          鍙閫夊涓瓙浠讹紝淇濆瓨鏃跺洖鍐?`recipeIds` 鏁扮粍銆?
        </Typography.Text>
      ) : null}
    </div>
  );
}
