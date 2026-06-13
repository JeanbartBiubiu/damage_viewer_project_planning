import { Alert, Select, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildSelectSearchText, filterEntitySelectOption } from '../EntitySelectOption';
import { getErrorMessage, getSkills } from '../../services/apiClient';
import type { Skill } from '../../types/api';

const SKILL_FIELD_SEPARATOR = '\u001f';
const SKILLS_LIST_SEPARATOR = '\u001e';
const SKILLS_FETCH_CACHE_TTL_MS = 4000;

type SkillsFetchCacheEntry = {
  skills: Skill[];
  skillsSignature: string;
  loaded: boolean;
  error: string | null;
  cachedAt?: number;
};

const skillsFetchCache = new Map<string, SkillsFetchCacheEntry>();

export type SkillRefSelectorLoadState = {
  skills: Skill[];
  loading: boolean;
  error: string | null;
  loaded: boolean;
};

function buildFetchKey(apiBaseUrl: string, selectedGameId: string, token: string): string {
  return `${apiBaseUrl}\u0000${selectedGameId}\u0000${token}`;
}

function buildSkillSignature(skill: Skill): string {
  const mechanicsConfig = skill.mechanicsConfig;
  const mechanicsPart = mechanicsConfig === undefined ? '' : JSON.stringify(mechanicsConfig);

  return [
    skill.skillId,
    skill.ownerType ?? '',
    skill.ownerId ?? '',
    skill.name ?? '',
    skill.skillKey ?? '',
    mechanicsPart
  ].join(SKILL_FIELD_SEPARATOR);
}

function buildSkillsListSignature(skills: Skill[]): string {
  return [...skills]
    .sort((left, right) => left.skillId.localeCompare(right.skillId))
    .map(buildSkillSignature)
    .join(SKILLS_LIST_SEPARATOR);
}

function buildLoadStateSignature(state: SkillRefSelectorLoadState): string {
  return JSON.stringify({
    skills: buildSkillsListSignature(state.skills),
    loading: state.loading,
    error: state.error,
    loaded: state.loaded
  });
}

function resolveStableSkillsList(
  fetchKey: string,
  nextSkills: Skill[],
  prevSkills: Skill[]
): Skill[] {
  const nextSignature = buildSkillsListSignature(nextSkills);
  const cached = skillsFetchCache.get(fetchKey);
  if (cached?.skillsSignature === nextSignature) {
    return cached.skills;
  }
  if (prevSkills.length > 0 && buildSkillsListSignature(prevSkills) === nextSignature) {
    writeSuccessfulCacheEntry(fetchKey, prevSkills, nextSignature);
    return prevSkills;
  }

  writeSuccessfulCacheEntry(fetchKey, nextSkills, nextSignature);
  return nextSkills;
}

function readCachedLoadState(fetchKey: string): SkillsFetchCacheEntry | undefined {
  return skillsFetchCache.get(fetchKey);
}

function isSuccessfulCacheFresh(entry: SkillsFetchCacheEntry): boolean {
  return (
    entry.loaded
    && entry.cachedAt !== undefined
    && Date.now() - entry.cachedAt < SKILLS_FETCH_CACHE_TTL_MS
  );
}

function writeSuccessfulCacheEntry(
  fetchKey: string,
  skills: Skill[],
  skillsSignature: string
): void {
  skillsFetchCache.set(fetchKey, {
    skills,
    skillsSignature,
    loaded: true,
    error: null,
    cachedAt: Date.now()
  });
}

type SkillRefSelectorProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  currentItemId?: string;
  value: string[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
  onSkillsLoadStateChange?: (state: SkillRefSelectorLoadState) => void;
};

function formatLoadedSkillLabel(skill: Skill, currentItemId: string): string {
  const ownedByCurrentItem = skill.ownerType === 'item' && skill.ownerId === currentItemId;
  const ownerHint = skill.ownerType || skill.ownerId
    ? `${skill.ownerType ?? '?'} / ${skill.ownerId ?? '?'}`
    : 'unknown owner';
  return `${skill.name ?? skill.skillId} · ${skill.skillId}${ownedByCurrentItem ? ' · 当前装备' : ` · ${ownerHint}`}`;
}

function formatSkillRefSelectedLabel(
  skillId: string,
  skillsById: ReadonlyMap<string, Skill>,
  skillsLoaded: boolean,
  currentItemId: string
): string {
  const skill = skillsById.get(skillId);
  if (skill) {
    return formatLoadedSkillLabel(skill, currentItemId);
  }
  return skillsLoaded ? `${skillId} · 已选但缺失` : `${skillId} · 待校验`;
}

function compareSkillOptions(left: Skill, right: Skill, currentItemId: string): number {
  const leftOwned = left.ownerType === 'item' && left.ownerId === currentItemId;
  const rightOwned = right.ownerType === 'item' && right.ownerId === currentItemId;
  if (leftOwned !== rightOwned) {
    return leftOwned ? -1 : 1;
  }

  const leftItemSkill = left.ownerType === 'item';
  const rightItemSkill = right.ownerType === 'item';
  if (leftItemSkill !== rightItemSkill) {
    return leftItemSkill ? -1 : 1;
  }

  const leftLabel = left.name ?? left.skillId;
  const rightLabel = right.name ?? right.skillId;
  return leftLabel.localeCompare(rightLabel, 'zh-CN');
}

export function SkillRefSelector({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  currentItemId = '',
  value,
  disabled = false,
  onChange,
  onSkillsLoadStateChange
}: SkillRefSelectorProps) {
  const token = adminToken.trim();
  const normalizedItemId = currentItemId.trim();
  const fetchKey = selectedGameId && token ? buildFetchKey(apiBaseUrl, selectedGameId, token) : null;
  const cachedLoadState = fetchKey ? readCachedLoadState(fetchKey) : undefined;
  const hasFreshCache = cachedLoadState ? isSuccessfulCacheFresh(cachedLoadState) : false;
  const willFetch = Boolean(fetchKey);
  const [skills, setSkills] = useState<Skill[]>(() => cachedLoadState?.skills ?? []);
  const [loading, setLoading] = useState(() => willFetch && !hasFreshCache);
  const [error, setError] = useState<string | null>(() => cachedLoadState?.error ?? null);
  const [loaded, setLoaded] = useState(() => cachedLoadState?.loaded ?? false);
  const lastNotifiedLoadStateSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!fetchKey || !selectedGameId) {
      setSkills([]);
      setLoading(false);
      setError(null);
      setLoaded(false);
      return;
    }

    const cached = readCachedLoadState(fetchKey);
    if (cached && isSuccessfulCacheFresh(cached)) {
      setSkills(cached.skills);
      setLoading(false);
      setLoaded(true);
      setError(cached.error);
      return;
    }

    let cancelled = false;
    if (cached?.loaded) {
      setSkills(cached.skills);
      setLoading(true);
      setLoaded(true);
      setError(null);
    } else {
      setSkills([]);
      setLoading(true);
      setLoaded(false);
      setError(null);
    }

    getSkills(apiBaseUrl, selectedGameId, token)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSkills((prevSkills) => resolveStableSkillsList(fetchKey, result.data.skills, prevSkills));
        setLoading(false);
        setLoaded(true);
        setError(null);
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        const nextError = getErrorMessage(loadError);
        setSkills([]);
        setLoading(false);
        setError(nextError);
        setLoaded(false);
        skillsFetchCache.set(fetchKey, {
          skills: [],
          skillsSignature: buildSkillsListSignature([]),
          loaded: false,
          error: nextError
        });
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, fetchKey, selectedGameId, token]);

  useEffect(() => {
    if (!onSkillsLoadStateChange) {
      return;
    }
    const next: SkillRefSelectorLoadState = {
      skills,
      loading,
      error,
      loaded
    };
    const nextSignature = buildLoadStateSignature(next);
    if (lastNotifiedLoadStateSignatureRef.current === nextSignature) {
      return;
    }
    lastNotifiedLoadStateSignatureRef.current = nextSignature;
    onSkillsLoadStateChange(next);
  }, [skills, loading, error, loaded, onSkillsLoadStateChange]);

  const skillsById = useMemo(
    () => new Map(skills.map((skill) => [skill.skillId, skill])),
    [skills]
  );

  const options = useMemo(() => {
    const sortedSkills = [...skills].sort((left, right) => compareSkillOptions(left, right, normalizedItemId));
    const optionSkillIds = new Set(sortedSkills.map((skill) => skill.skillId));

    const baseOptions = sortedSkills.map((skill) => ({
      label: formatLoadedSkillLabel(skill, normalizedItemId),
      value: skill.skillId,
      searchText: buildSelectSearchText(skill.skillId, skill.name, skill.skillKey, skill.ownerId, skill.ownerType ?? undefined)
    }));

    const missingSelectedOptions = value
      .filter((skillId) => skillId && !optionSkillIds.has(skillId))
      .map((skillId) => ({
        label: formatSkillRefSelectedLabel(skillId, skillsById, loaded, normalizedItemId),
        value: skillId,
        searchText: buildSelectSearchText(skillId)
      }));

    return [...baseOptions, ...missingSelectedOptions];
  }, [loaded, normalizedItemId, skills, skillsById, value]);

  const renderFormat = useCallback(
    (_option: unknown, selectedValue: string | number | { value: string | number }) => {
      const skillId = String(
        typeof selectedValue === 'object' && selectedValue !== null && 'value' in selectedValue
          ? selectedValue.value
          : selectedValue
      );
      return formatSkillRefSelectedLabel(skillId, skillsById, loaded, normalizedItemId);
    },
    [loaded, normalizedItemId, skillsById]
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
        renderFormat={renderFormat}
        onChange={(nextValue) => onChange(Array.isArray(nextValue) ? nextValue.map(String) : [])}
        filterOption={filterEntitySelectOption}
      />

      {error ? <Alert type="error" content={`技能列表加载失败：${error}`} style={{ marginTop: 8 }} /> : null}
      {!error ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
          展示全部技能；当前装备 owned 优先。空 skillRefs 表示不接入装备被动，保存时回写 `skillRefs` 数组。
        </Typography.Text>
      ) : null}
    </div>
  );
}
