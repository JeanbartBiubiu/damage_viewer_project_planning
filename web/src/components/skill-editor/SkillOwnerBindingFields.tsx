import { Alert, Input, Select, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage, getHeroes, getItems, getOwnerCategories } from '../../services/apiClient';
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

    const task = ownerType === 'hero' ? getHeroes(apiBaseUrl, selectedGameId, token) : getItems(apiBaseUrl, selectedGameId, token);

    task
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (ownerType === 'hero') {
          setHeroes(result.data.heroes);
          setItems([]);
        } else {
          setItems(result.data.items);
          setHeroes([]);
        }
        setLoadingOwners(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setHeroes([]);
        setItems([]);
        setLoadingOwners(false);
        setOwnerError(getErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId, token, ownerType]);

  const ownerTypeOptions = useMemo(
    () => categories.map((category) => ({ label: `${category.name ?? category.ownerType} · ${category.ownerType}`, value: category.ownerType })),
    [categories]
  );

  const ownerIdOptions = useMemo(() => {
    if (ownerType === 'hero') {
      return heroes.map((hero) => ({ label: `${hero.title ?? hero.heroId} · ${hero.heroId}`, value: hero.heroId }));
    }
    if (ownerType === 'item') {
      return items.map((item) => ({ label: `${item.name ?? item.itemId} · ${item.itemId}`, value: item.itemId }));
    }
    return [];
  }, [heroes, items, ownerType]);

  return (
    <div>
      <div className="crud-form-grid">
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            ownerType
          </Typography.Text>
          <Select
            showSearch
            allowClear
            placeholder="选择 ownerType"
            value={ownerType || undefined}
            disabled={disabled || !selectedGameId}
            loading={loadingCategories}
            options={ownerTypeOptions}
            onChange={(value) => onOwnerTypeChange(String(value ?? ''))}
            filterOption={(inputValue, option) => {
              const searchText = `${String(option?.value ?? '')} ${String(option?.label ?? '')}`.toLowerCase();
              return searchText.includes(inputValue.trim().toLowerCase());
            }}
          />
        </div>

        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            ownerId
          </Typography.Text>
          {ownerType === 'hero' || ownerType === 'item' ? (
            <Select
              showSearch
              allowClear
              placeholder={ownerType === 'hero' ? '选择英雄 ownerId' : '选择装备 ownerId'}
              value={ownerId || undefined}
              disabled={disabled || !selectedGameId || !token}
              loading={loadingOwners}
              options={ownerIdOptions}
              onChange={(value) => onOwnerIdChange(String(value ?? ''))}
              filterOption={(inputValue, option) => {
                const searchText = `${String(option?.value ?? '')} ${String(option?.label ?? '')}`.toLowerCase();
                return searchText.includes(inputValue.trim().toLowerCase());
              }}
            />
          ) : (
            <Input value={ownerId} disabled={disabled} onChange={onOwnerIdChange} placeholder="请输入 ownerId" />
          )}
        </div>
      </div>

      {categoryError ? <Alert type="error" content={`ownerType 字典加载失败：${categoryError}`} style={{ marginTop: 8 }} /> : null}
      {ownerError ? <Alert type="error" content={`ownerId 候选加载失败：${ownerError}`} style={{ marginTop: 8 }} /> : null}
      {!categoryError && !ownerError ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
          `hero/item` 会自动提供可选 ownerId，其它 ownerType 暂保留手输模式。
        </Typography.Text>
      ) : null}
    </div>
  );
}