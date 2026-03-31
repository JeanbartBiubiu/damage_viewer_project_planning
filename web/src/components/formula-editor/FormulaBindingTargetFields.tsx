import { Alert, Input, Select, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage, getHeroes, getItems, getSkills } from '../../services/apiClient';
import type { Hero, Item, Skill } from '../../types/api';

type FormulaBindingTargetFieldsProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  targetCategory: string;
  targetId: string;
  disabled?: boolean;
  identityLocked?: boolean;
  onTargetCategoryChange: (value: string) => void;
  onTargetIdChange: (value: string) => void;
};

const TARGET_CATEGORY_OPTIONS = [
  { label: '技能', value: 'skill' },
  { label: '英雄', value: 'hero' },
  { label: '装备', value: 'item' },
  { label: '全局', value: 'global' }
];

export function FormulaBindingTargetFields({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  targetCategory,
  targetId,
  disabled = false,
  identityLocked = false,
  onTargetCategoryChange,
  onTargetIdChange
}: FormulaBindingTargetFieldsProps) {
  const token = adminToken.trim();
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);

  useEffect(() => {
    if (targetCategory !== 'global' || !selectedGameId || targetId.trim()) {
      return;
    }
    onTargetIdChange(selectedGameId);
  }, [onTargetIdChange, selectedGameId, targetCategory, targetId]);

  useEffect(() => {
    if (!selectedGameId || !token || !['skill', 'hero', 'item'].includes(targetCategory)) {
      setHeroes([]);
      setItems([]);
      setSkills([]);
      setLoadingTargets(false);
      setTargetError(null);
      return;
    }

    let cancelled = false;
    setLoadingTargets(true);
    setTargetError(null);

    const handleError = (error: unknown) => {
      if (cancelled) {
        return;
      }
      setHeroes([]);
      setItems([]);
      setSkills([]);
      setLoadingTargets(false);
      setTargetError(getErrorMessage(error));
    };

    if (targetCategory === 'hero') {
      getHeroes(apiBaseUrl, selectedGameId, token)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setHeroes(result.data.heroes);
          setItems([]);
          setSkills([]);
          setLoadingTargets(false);
        })
        .catch(handleError);
      return () => {
        cancelled = true;
      };
    }

    if (targetCategory === 'item') {
      getItems(apiBaseUrl, selectedGameId, token)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setItems(result.data.items);
          setHeroes([]);
          setSkills([]);
          setLoadingTargets(false);
        })
        .catch(handleError);
      return () => {
        cancelled = true;
      };
    }

    getSkills(apiBaseUrl, selectedGameId, token)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSkills(result.data.skills);
        setHeroes([]);
        setItems([]);
        setLoadingTargets(false);
      })
      .catch(handleError);

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId, targetCategory, token]);

  const categoryOptions = useMemo(() => {
    if (!targetCategory || TARGET_CATEGORY_OPTIONS.some((option) => option.value === targetCategory)) {
      return TARGET_CATEGORY_OPTIONS;
    }
    return [...TARGET_CATEGORY_OPTIONS, { label: `${targetCategory}（旧值）`, value: targetCategory }];
  }, [targetCategory]);

  const targetOptions = useMemo(() => {
    if (targetCategory === 'hero') {
      return heroes.map((hero) => ({
        label: `${hero.name ?? hero.heroId} / ${hero.heroId}`,
        value: hero.heroId
      }));
    }
    if (targetCategory === 'item') {
      return items.map((item) => ({
        label: `${item.name ?? item.itemId} / ${item.itemId}`,
        value: item.itemId
      }));
    }
    if (targetCategory === 'skill') {
      return skills.map((skill) => ({
        label: `${skill.name ?? skill.skillId} / ${skill.skillId}`,
        value: skill.skillId
      }));
    }
    return [];
  }, [heroes, items, skills, targetCategory]);

  const targetCategoryLabel = targetCategory === 'hero' ? '英雄' : targetCategory === 'item' ? '装备' : '技能';

  const targetIdField =
    targetCategory === 'hero' || targetCategory === 'item' || targetCategory === 'skill' ? (
      <Select
        showSearch
        allowClear
        placeholder={`选择${targetCategoryLabel}目标`}
        value={targetId || undefined}
        disabled={disabled || identityLocked || !selectedGameId || !token}
        loading={loadingTargets}
        options={targetOptions}
        onChange={(value) => onTargetIdChange(String(value ?? ''))}
        filterOption={(inputValue, option) => {
          const optionData = option as { value?: unknown; label?: unknown } | undefined;
          const searchText = `${String(optionData?.value ?? '')} ${String(optionData?.label ?? '')}`.toLowerCase();
          return searchText.includes(inputValue.trim().toLowerCase());
        }}
      />
    ) : (
      <Input
        value={targetId}
        disabled={disabled || identityLocked || (targetCategory === 'global' && Boolean(selectedGameId))}
        onChange={onTargetIdChange}
        placeholder={targetCategory === 'global' ? selectedGameId ?? '当前 gameId' : '请输入 targetId'}
      />
    );

  return (
    <div>
      <div className="crud-form-grid">
        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            目标类别（targetCategory）
          </Typography.Text>
          <Select
            showSearch
            allowClear
            placeholder="选择目标类别"
            value={targetCategory || undefined}
            disabled={disabled || identityLocked}
            options={categoryOptions}
            onChange={(value) => onTargetCategoryChange(String(value ?? ''))}
          />
        </div>

        <div>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
            目标 ID（targetId）
          </Typography.Text>
          {targetIdField}
        </div>
      </div>

      {targetError ? <Alert type="error" content={`目标列表加载失败：${targetError}`} style={{ marginTop: 8 }} /> : null}
      {!targetError ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
          `global` 绑定会默认把 `targetId` 设为当前 `gameId`，其余类别优先提供已有实体选择。
        </Typography.Text>
      ) : null}
    </div>
  );
}
