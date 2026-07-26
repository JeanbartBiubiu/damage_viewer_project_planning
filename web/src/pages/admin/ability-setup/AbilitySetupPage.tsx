import { Alert, Button, Input, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  formatCombatDataError,
  getAbilities,
  getCombatDataState,
  getProviders,
  getTypes,
  putAbility
} from '../../../services/combatDataClient';
import type { Ability, Provider, TypeDefinition } from '../../../types/combatData';
import {
  abilityKindBlockingMessage,
  buildAbilityPutBody,
  createDefaultFormDraft,
  createUnavailableReason,
  draftFromExistingAbility,
  formatStableLabel,
  listAbilitiesForProvider,
  listAbilityKindOptions,
  validateAbilitySetup,
  type AbilitySetupFormDraft
} from './abilitySetupModel';

export type AbilitySetupPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  gamesReachable: boolean;
};

type SaveResultSummary = {
  abilityId: string;
  providerId: string;
  abilityKey: string;
  displayName: string;
  abilityKindTypeId: number;
  castConditionFormulaKey?: string;
  currentRevision: number;
};

function filterSelectOption(inputValue: string, option: unknown): boolean {
  const needle = inputValue.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  if (!option || typeof option !== 'object') {
    return false;
  }
  const record = option as {
    value?: unknown;
    children?: unknown;
    label?: unknown;
    props?: { value?: unknown; children?: unknown; label?: unknown };
  };
  const candidates = [
    record.value,
    record.label,
    record.children,
    record.props?.value,
    record.props?.label,
    record.props?.children
  ];
  return candidates.some((item) => String(item ?? '').toLowerCase().includes(needle));
}

function formatApiErrorWithDetails(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const base = error.code ? `${error.code}: ${error.message}` : error.message;
    if (error.details && Object.keys(error.details).length > 0) {
      return `${base} details=${JSON.stringify(error.details)}`;
    }
    return base;
  }
  return getErrorMessage(error);
}

export function AbilitySetupPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  gamesReachable
}: AbilitySetupPageProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentRevision, setCurrentRevision] = useState<number | null>(null);
  const [types, setTypes] = useState<TypeDefinition[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [abilities, setAbilities] = useState<Ability[]>([]);
  const [typesLoaded, setTypesLoaded] = useState(false);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [abilitiesLoaded, setAbilitiesLoaded] = useState(false);

  const [draft, setDraft] = useState<AbilitySetupFormDraft>(createDefaultFormDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SaveResultSummary | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const kindOptions = useMemo(() => listAbilityKindOptions(types), [types]);
  const kindBlockMessage = useMemo(
    () => abilityKindBlockingMessage(kindOptions),
    [kindOptions]
  );
  const validation = useMemo(
    () => validateAbilitySetup(draft, kindOptions, abilities),
    [draft, kindOptions, abilities]
  );
  const createBlockReason = useMemo(
    () =>
      draft.selectedExistingAbilityId.trim()
        ? null
        : createUnavailableReason(draft.providerId),
    [draft.providerId, draft.selectedExistingAbilityId]
  );

  const providerOptions = useMemo(
    () =>
      providers
        .map((item) => ({
          value: item.providerId,
          label: formatStableLabel(item.providerId, item.displayName)
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
    [providers]
  );

  const abilityOptions = useMemo(() => {
    const rows = listAbilitiesForProvider(abilities, draft.providerId);
    return rows.map((item) => ({
      value: item.abilityId,
      label: formatStableLabel(item.abilityId, item.displayName)
    }));
  }, [abilities, draft.providerId]);

  const kindSelectOptions = useMemo(
    () =>
      kindOptions.map((item) => ({
        value: item.typeKey,
        label: item.label
      })),
    [kindOptions]
  );

  const loadAll = useCallback(async () => {
    if (!selectedGameId) {
      setCurrentRevision(null);
      setTypes([]);
      setProviders([]);
      setAbilities([]);
      setTypesLoaded(false);
      setProvidersLoaded(false);
      setAbilitiesLoaded(false);
      setLoadError(null);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const [stateResult, typesResult, providersResult, abilitiesResult] = await Promise.all([
        getCombatDataState(apiBaseUrl, selectedGameId),
        getTypes(apiBaseUrl, selectedGameId),
        getProviders(apiBaseUrl, selectedGameId),
        getAbilities(apiBaseUrl, selectedGameId)
      ]);

      setCurrentRevision(stateResult.data.currentRevision);
      setTypes(typesResult.data.data);
      setProviders(providersResult.data.data);
      setAbilities(abilitiesResult.data.data);
      setTypesLoaded(true);
      setProvidersLoaded(true);
      setAbilitiesLoaded(true);
    } catch (error) {
      setCurrentRevision(null);
      setTypes([]);
      setProviders([]);
      setAbilities([]);
      setTypesLoaded(false);
      setProvidersLoaded(false);
      setAbilitiesLoaded(false);
      setLoadError(
        formatCombatDataError(error, 'contract-entry', {
          apiBaseUrl,
          gamesReachable
        })
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, gamesReachable, selectedGameId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, reloadTick]);

  useEffect(() => {
    setDraft(createDefaultFormDraft());
    setLastResult(null);
    setSaveError(null);
    setSaveNotice(null);
    setTypesLoaded(false);
    setProvidersLoaded(false);
    setAbilitiesLoaded(false);
  }, [selectedGameId]);

  const patchDraft = <K extends keyof AbilitySetupFormDraft>(
    key: K,
    value: AbilitySetupFormDraft[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveError(null);
    setSaveNotice(null);
  };

  const handleProviderChange = (value: unknown) => {
    const providerId = typeof value === 'string' ? value : '';
    setDraft({
      ...createDefaultFormDraft(),
      providerId
    });
    setSaveError(null);
    setSaveNotice(null);
  };

  const handleExistingAbilityChange = (value: unknown) => {
    const abilityId = typeof value === 'string' ? value : '';
    if (!abilityId) {
      setDraft((current) => ({
        ...createDefaultFormDraft(),
        providerId: current.providerId
      }));
      setSaveError(null);
      setSaveNotice(null);
      return;
    }
    const existing = abilities.find((item) => item.abilityId === abilityId);
    if (!existing) {
      return;
    }
    setDraft(draftFromExistingAbility(existing, kindOptions));
    setSaveError(null);
    setSaveNotice(null);
  };

  const providerLocked = Boolean(draft.selectedExistingAbilityId.trim());

  const canSave =
    Boolean(selectedGameId) &&
    gamesReachable === true &&
    !loading &&
    !loadError &&
    currentRevision !== null &&
    typesLoaded &&
    providersLoaded &&
    abilitiesLoaded &&
    kindOptions.length > 0 &&
    validation.ok &&
    Boolean(adminToken.trim()) &&
    !saving;

  const handleSave = async () => {
    if (!selectedGameId || !validation.ok) {
      return;
    }
    if (validation.target.mode === 'unavailable') {
      return;
    }

    const token = adminToken.trim();
    if (!token) {
      setSaveError('写入需要 Admin Token。');
      return;
    }

    const body = buildAbilityPutBody(validation.trimmed);
    const targetAbilityId = validation.target.abilityId;

    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    setLastResult(null);
    try {
      const result = await putAbility(
        apiBaseUrl,
        selectedGameId,
        targetAbilityId,
        token,
        body
      );
      setCurrentRevision(result.data.currentRevision);
      setLastResult({
        abilityId: result.data.abilityId,
        providerId: result.data.providerId,
        abilityKey: result.data.abilityKey,
        displayName: result.data.displayName,
        abilityKindTypeId: result.data.abilityKindTypeId,
        castConditionFormulaKey: result.data.castConditionFormulaKey,
        currentRevision: result.data.currentRevision
      });
      setSaveNotice(
        `已${validation.target.mode === 'update' ? '更新' : '创建'} Ability「${result.data.abilityId}」（revision ${result.data.currentRevision}）。`
      );
      setReloadTick((value) => value + 1);
    } catch (error) {
      setSaveError(formatApiErrorWithDetails(error));
    } finally {
      setSaving(false);
    }
  };

  const editsDisabled = !selectedGameId || loading || saving;
  const target = validation.target;

  return (
    <div className="page-stack">
      <Panel
        title="Ability 创建"
        kicker="Ability Setup"
        actions={
          <Space>
            <Button loading={loading} onClick={() => void loadAll()} disabled={!selectedGameId}>
              刷新
            </Button>
            <Button type="primary" loading={saving} disabled={!canSave} onClick={() => void handleSave()}>
              保存
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          普通 Ability 主档创建或有意更新（单行 PUT：
          <code>{'{ providerId, abilityKey, abilityKindTypeId, displayName }'}</code>
          ，可选 <code>castConditionFormulaKey</code>
          ）。本页不是效果图构建器；序列主档见{' '}
          <a href="#/effect-sequence-setup">#/effect-sequence-setup</a>
          ，直伤图请用{' '}
          <a href="#/direct-damage-ability">#/direct-damage-ability</a>
          。高级分表仍可用 <a href="#/combat-data/abilities">#/combat-data/abilities</a>。
        </Typography.Paragraph>

        {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
        {loading ? (
          <Alert type="info" content="正在并发加载 combat-data state / types / providers / abilities…" />
        ) : null}
        {loadError ? <Alert type="error" content={loadError} /> : null}

        {selectedGameId && !loading && !loadError ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Typography.Text bold>当前 revision：</Typography.Text>{' '}
              <Tag color="arcoblue">{currentRevision ?? '—'}</Tag>
              <Tag color={typesLoaded ? 'green' : 'orangered'} style={{ marginLeft: 8 }}>
                typesLoaded={String(typesLoaded)}
              </Tag>
              <Tag color={providersLoaded ? 'green' : 'orangered'} style={{ marginLeft: 8 }}>
                providersLoaded={String(providersLoaded)}
              </Tag>
              <Tag color={abilitiesLoaded ? 'green' : 'orangered'} style={{ marginLeft: 8 }}>
                abilitiesLoaded={String(abilitiesLoaded)}
              </Tag>
              {!adminToken.trim() ? (
                <Tag color="orangered" style={{ marginLeft: 8 }}>
                  缺少 Admin Token，保存已禁用
                </Tag>
              ) : null}
              {!gamesReachable ? (
                <Tag color="orangered" style={{ marginLeft: 8 }}>
                  游戏列表不可达，保存已禁用
                </Tag>
              ) : null}
            </div>

            {kindBlockMessage ? <Alert type="error" content={kindBlockMessage} /> : null}
            {providers.length === 0 ? (
              <Alert
                type="warning"
                content={
                  <span>
                    当前游戏没有可用 Provider，请先到{' '}
                    <a href="#/provider-setup">#/provider-setup</a> 创建。
                  </span>
                }
              />
            ) : null}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>已有 Provider</span>
                <Select
                  showSearch
                  allowClear
                  placeholder="先选择 Provider"
                  value={draft.providerId || undefined}
                  options={providerOptions}
                  filterOption={filterSelectOption}
                  disabled={editsDisabled || providerLocked || providers.length === 0}
                  onChange={handleProviderChange}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>已有 Ability（可选；用于有意更新）</span>
                <Select
                  showSearch
                  allowClear
                  placeholder={
                    draft.providerId
                      ? '留空=新建；选择则更新该 Ability'
                      : '请先选择 Provider'
                  }
                  value={draft.selectedExistingAbilityId || undefined}
                  options={abilityOptions}
                  filterOption={filterSelectOption}
                  disabled={editsDisabled || !draft.providerId}
                  onChange={handleExistingAbilityChange}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>abilityKey</span>
                <Input
                  value={draft.abilityKey}
                  disabled={editsDisabled || !draft.providerId}
                  placeholder="例：q（小写字母、数字、下划线）"
                  onChange={(value) => patchDraft('abilityKey', value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>显示名</span>
                <Input
                  value={draft.displayName}
                  disabled={editsDisabled || !draft.providerId}
                  placeholder="显示名"
                  onChange={(value) => patchDraft('displayName', value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>Ability 种类</span>
                <Select
                  showSearch
                  allowClear
                  placeholder="选择 ability_kind/*"
                  value={draft.abilityKindTypeKey || undefined}
                  options={kindSelectOptions}
                  filterOption={filterSelectOption}
                  disabled={editsDisabled || kindOptions.length === 0 || !draft.providerId}
                  onChange={(value) =>
                    patchDraft('abilityKindTypeKey', typeof value === 'string' ? value : '')
                  }
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>castConditionFormulaKey（可选；空白省略=清空）</span>
                <Input
                  value={draft.castConditionFormulaKey}
                  disabled={editsDisabled || !draft.providerId}
                  placeholder="可选公式键；留空将清空已有值"
                  onChange={(value) => patchDraft('castConditionFormulaKey', value)}
                />
              </label>
            </div>

            {providerLocked ? (
              <Alert
                type="info"
                content="已选择既有 Ability：Provider 选择已锁定。清除「已有 Ability」后可更换 Provider 或改为新建。"
              />
            ) : null}

            {createBlockReason ? <Alert type="warning" content={createBlockReason} /> : null}

            <div>
              <Typography.Text bold>目标 Ability ID（只读）：</Typography.Text>{' '}
              <code>
                {target.mode === 'create' || target.mode === 'update' ? target.abilityId : '—'}
              </code>
              {target.mode === 'create' ? (
                <Tag color="green" style={{ marginLeft: 8 }}>
                  新建
                </Tag>
              ) : null}
              {target.mode === 'update' ? (
                <Tag color="arcoblue" style={{ marginLeft: 8 }}>
                  更新（保留遗留 ID）
                </Tag>
              ) : null}
            </div>

            {target.mode === 'update' ? (
              <Alert
                type="info"
                content={`将更新已有 Ability「${target.summary.abilityId}」。当前 abilityKey=${target.summary.abilityKey}；displayName=${target.summary.displayName}；abilityKindTypeId=${target.summary.abilityKindTypeId}；castConditionFormulaKey=${target.summary.castConditionFormulaKey || '（空）'}。`}
              />
            ) : null}
            {target.mode === 'create' ? (
              <Alert type="success" content={`将创建新 Ability「${target.abilityId}」。`} />
            ) : null}

            {!validation.ok &&
            (draft.providerId ||
              draft.abilityKey ||
              draft.displayName ||
              draft.abilityKindTypeKey ||
              draft.selectedExistingAbilityId) ? (
              <Alert type="warning" content={validation.reason} />
            ) : null}

            {saveError ? <Alert type="error" content={saveError} /> : null}
            {saveNotice ? <Alert type="success" content={saveNotice} /> : null}

            {lastResult ? (
              <section aria-label="保存结果">
                <Typography.Title heading={6}>保存结果</Typography.Title>
                <Typography.Paragraph style={{ marginTop: 0 }}>
                  abilityId={lastResult.abilityId} · providerId={lastResult.providerId} ·
                  abilityKey={lastResult.abilityKey} · displayName={lastResult.displayName} ·
                  abilityKindTypeId={lastResult.abilityKindTypeId}
                  {lastResult.castConditionFormulaKey
                    ? ` · castConditionFormulaKey=${lastResult.castConditionFormulaKey}`
                    : ''}{' '}
                  · revision={lastResult.currentRevision}
                </Typography.Paragraph>
              </section>
            ) : null}

            <Alert
              type="info"
              content={
                <span>
                  下一步：序列主档见{' '}
                  <a href="#/effect-sequence-setup">#/effect-sequence-setup</a>
                  ；需要直伤图时到{' '}
                  <a href="#/direct-damage-ability">#/direct-damage-ability</a>
                  ；相位 / 参数 / 冷却等高级表见{' '}
                  <a href="#/combat-data/ability-phases">#/combat-data/ability-phases</a>、
                  <a href="#/combat-data/abilities">#/combat-data/abilities</a>
                  （诊断用）。推荐闭环：
                  <a href="#/provider-setup">#/provider-setup</a> →{' '}
                  <a href="#/entity-provider-mount">#/entity-provider-mount</a> → 本页或直伤快捷入口。
                </span>
              }
            />
          </Space>
        ) : null}
      </Panel>
    </div>
  );
}
