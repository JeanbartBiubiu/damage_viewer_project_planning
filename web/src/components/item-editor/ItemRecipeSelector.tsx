import { Alert, Select, Typography } from '@arco-design/web-react';
import { useMemo } from 'react';
import { createEntitySelectOption, filterEntitySelectOption } from '../EntitySelectOption';
import { useResourceImageCache } from '../../pages/admin/resources/shared/useResourceImageCache';
import { buildItemImageUri } from '../../services/resourceImage';
import type { Item } from '../../types/api';

type ItemRecipeSelectorProps = {
  selectedGameId: string | null;
  adminToken: string;
  items: Item[];
  itemsLoading?: boolean;
  itemsError?: string | null;
  currentItemId?: string;
  value: string[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
};

export function ItemRecipeSelector({
  selectedGameId,
  adminToken,
  items,
  itemsLoading = false,
  itemsError = null,
  currentItemId,
  value,
  disabled = false,
  onChange
}: ItemRecipeSelectorProps) {
  const token = adminToken.trim();
  const { imageSrcByUri } = useResourceImageCache(selectedGameId);

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
        placeholder="选择合成配方子件"
        value={value}
        disabled={disabled || !selectedGameId || !token}
        loading={itemsLoading}
        options={options}
        onChange={(nextValue) => onChange(Array.isArray(nextValue) ? nextValue.map(String) : [])}
        filterOption={filterEntitySelectOption}
      />

      {itemsError ? <Alert type="error" content={`装备列表加载失败：${itemsError}`} style={{ marginTop: 8 }} /> : null}
      {!itemsError ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
          可多选多个子件，保存时回写 `recipeIds` 数组。
        </Typography.Text>
      ) : null}
    </div>
  );
}
