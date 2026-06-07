import { Alert, Select, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { buildSelectSearchText, filterEntitySelectOption } from '../EntitySelectOption';
import { getErrorMessage, getSkills } from '../../services/apiClient';
import type { Skill } from '../../types/api';

type SkillRefSelectorProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  value: string[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
};

export function SkillRefSelector({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  value,
  disabled = false,
  onChange
}: SkillRefSelectorProps) {
  const token = adminToken.trim();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedGameId || !token) {
      setSkills([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getSkills(apiBaseUrl, selectedGameId, token)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSkills(result.data.skills.filter((skill) => skill.ownerType === 'item'));
        setLoading(false);
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setSkills([]);
        setLoading(false);
        setError(getErrorMessage(loadError));
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId, token]);

  const options = useMemo(
    () =>
      skills.map((skill) => ({
        label: `${skill.name ?? skill.skillId} · ${skill.skillId}`,
        value: skill.skillId,
        searchText: buildSelectSearchText(skill.skillId, skill.name, skill.skillKey, skill.ownerId)
      })),
    [skills]
  );

  return (
    <div>
      <Select
        mode="multiple"
        showSearch
        allowClear
        maxTagCount={3}
        placeholder="选择装备关联技能"
        value={value}
        disabled={disabled || !selectedGameId || !token}
        loading={loading}
        options={options}
        onChange={(nextValue) => onChange(Array.isArray(nextValue) ? nextValue.map(String) : [])}
        filterOption={filterEntitySelectOption}
      />

      {error ? <Alert type="error" content={`技能列表加载失败：${error}`} style={{ marginTop: 8 }} /> : null}
      {!error ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
          仅展示 `ownerType=item` 的技能，保存时回写 `skillRefs` 数组。
        </Typography.Text>
      ) : null}
    </div>
  );
}
