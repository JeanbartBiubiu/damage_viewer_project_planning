import { Alert, Input, Select, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { createEntitySelectOption, buildSelectSearchText, filterEntitySelectOption } from '../EntitySelectOption';
import { getErrorMessage, getHeroes, getItems, getOwnerCategories } from '../../services/apiClient';
import { useResourceImageCache } from '../../pages/admin/resources/shared/useResourceImageCache';
import { buildHeroImageUri, buildItemImageUri } from '../../services/resourceImage';
import type { Hero, Item, OwnerCategory } from '../../types/api';

type SkillOwnerBindingFieldsProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  ownerType: string;
  ownerId: string;
  disabled?: boolean;
  onOwnerTypeChange: (value: string) => void;
  onOwnerIdChange: (value: string) => void;
};

export function SkillOwnerBindingFields({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  ownerType,
  ownerId,
  disabled = false,
  onOwnerTypeChange,
  onOwnerIdChange
}: SkillOwnerBindingFieldsProps) {
  const token = adminToken.trim();
  const [categories, setCategories] = useState<OwnerCategory[]>([]);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingOwners, setLoadingOwners] = useState(false);
  const { imageSrcByUri } = useResourceImageCache(selectedGameId);

  useEffect(() => {
    if (!selectedGameId) {
      setCategories([]);
      setCategoryError(null);
      setLoadingCategories(false);
      return;
    }

    let cancelled = false;
    setLoadingCategories(true);
    setCategoryError(null);

    getOwnerCategories(apiBaseUrl, selectedGameId)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCategories(result.data.ownerCategories);
        setLoadingCategories(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setCategories([]);
        setLoadingCategories(false);
        setCategoryError(getErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId]);

  useEffect(() => {
    if (!selectedGameId || !token || (ownerType !== 'hero' && ownerType !== 'item')) {
      setHeroes([]);
      setItems([]);
      setOwnerError(null);
      setLoadingOwners(false);
      return;
    }

    let cancelled = false;
    setLoadingOwners(true);
    setOwnerError(null);

    const handleError = (error: unknown) => {
      if (cancelled) {
        return;
      }
      setHeroes([]);
      setItems([]);
      setLoadingOwners(false);
      setOwnerError(getErrorMessage(error));
    };

    if (ownerType === 'hero') {
      getHeroes(apiBaseUrl, selectedGameId, token)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setHeroes(result.data.heroes);
          setItems([]);
          setLoadingOwners(false);
        })
        .catch(handleError);
    } else {
      getItems(apiBaseUrl, selectedGameId, token)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setItems(result.data.items);
          setHeroes([]);
          setLoadingOwners(false);
        })
        .catch(handleError);
    }

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId, token, ownerType]);

  const ownerTypeOptions = useMemo(
    () =>
      categories.map((category) => ({
        label: `${category.name ?? category.ownerType} / ${category.ownerType}`,
        value: category.ownerType,
        searchText: buildSelectSearchText(category.ownerType, category.name)
      })),
    [categories]
  );

  const ownerIdOptions = useMemo(() => {
    if (ownerType === 'hero') {
      return heroes.map((hero) => {
        const imageUri = buildHeroImageUri(hero.heroId);
        return createEntitySelectOption({
          value: hero.heroId,
          primary: hero.title ?? hero.name ?? hero.heroId,
          secondary: hero.heroId,
          imageSrc: (imageUri ? imageSrcByUri[imageUri] ?? null : null) ?? hero.avatarUrl ?? null,
          showImage: true,
          imageAlt: hero.title ?? hero.name ?? hero.heroId
        });
      });
    }
    if (ownerType === 'item') {
      return items.map((item) => {
        const imageUri = buildItemImageUri(item.itemId);
        return createEntitySelectOption({
          value: item.itemId,
          primary: item.name ?? item.itemId,
          secondary: item.name ? item.itemId : undefined,
          imageSrc: (imageUri ? imageSrcByUri[imageUri] ?? null : null) ?? item.iconUrl ?? null,
          showImage: true,
          imageAlt: item.name ?? item.itemId
        });
      });
    }
    return [];
  }, [heroes, imageSrcByUri, items, ownerType]);

  return (
    <div>
      <div className="crud-form-grid">
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            归属类型（ownerType）
          </Typography.Text>
          <Select
            showSearch
            allowClear
            placeholder="选择归属类型"
            value={ownerType || undefined}
            disabled={disabled || !selectedGameId}
            loading={loadingCategories}
            options={ownerTypeOptions}
            onChange={(value) => onOwnerTypeChange(String(value ?? ''))}
            filterOption={filterEntitySelectOption}
          />
        </div>

        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            归属目标（ownerId）
          </Typography.Text>
          {ownerType === 'hero' || ownerType === 'item' ? (
            <Select
              showSearch
              allowClear
              placeholder={ownerType === 'hero' ? '选择英雄' : '选择装备'}
              value={ownerId || undefined}
              disabled={disabled || !selectedGameId || !token}
              loading={loadingOwners}
              options={ownerIdOptions}
              onChange={(value) => onOwnerIdChange(String(value ?? ''))}
              filterOption={filterEntitySelectOption}
            />
          ) : (
            <Input value={ownerId} disabled={disabled} onChange={onOwnerIdChange} placeholder="请输入 ownerId" />
          )}
        </div>
      </div>

      {categoryError ? <Alert type="error" content={`归属类型字典加载失败：${categoryError}`} style={{ marginTop: 8 }} /> : null}
      {ownerError ? <Alert type="error" content={`归属目标候选加载失败：${ownerError}`} style={{ marginTop: 8 }} /> : null}
      {!categoryError && !ownerError ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
          `hero/item` 会自动提供候选目标，其它 `ownerType` 暂时保留手输模式。
        </Typography.Text>
      ) : null}
    </div>
  );
}
