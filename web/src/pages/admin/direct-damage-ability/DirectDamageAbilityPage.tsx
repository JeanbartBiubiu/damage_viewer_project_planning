import {
  Alert,
  Button,
  Input,
  Select,
  Space,
  Switch,
  Tag,
  Typography
} from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  formatCombatDataError,
  getAbilities,
  getAbilityPhaseEffectSequences,
  getAbilityPhases,
  getCombatDataState,
  getEffectSequences,
  getEffectSteps,
  getProviders,
  getTypes,
  putDirectDamageAbilitySetup
} from '../../../services/combatDataClient';
import type {
  Ability,
  AbilityPhase,
  AbilityPhaseEffectSequence,
  DirectDamageAbilitySetupWriteResult,
  EffectSequence,
  EffectStep,
  Provider,
  TypeDefinition
} from '../../../types/combatData';
import {
  DAMAGE_KIND_OPTIONS,
  FIXED_TYPE_KEYS,
  buildDirectDamageAbilitySetupBody,
  collisionStatusLabel,
  createDefaultFormDraft,
  deriveGraphIdsFromProviderId,
  evaluateGraphCollisions,
  formatStableLabel,
  resolveRequiredTypes,
  validateFormDraft,
  type DamageKind,
  type DirectDamageAbilityFormDraft
} from './directDamageAbilityModel';

export type DirectDamageAbilityPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  gamesReachable: boolean;
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

function nodeStatusColor(status: 'absent' | 'update' | 'conflict'): string {
  if (status === 'conflict') {
    return 'red';
  }
  if (status === 'update') {
    return 'arcoblue';
  }
  return 'green';
}

export function DirectDamageAbilityPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  gamesReachable
}: DirectDamageAbilityPageProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentRevision, setCurrentRevision] = useState<number | null>(null);
  const [types, setTypes] = useState<TypeDefinition[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [abilities, setAbilities] = useState<Ability[]>([]);
  const [phases, setPhases] = useState<AbilityPhase[]>([]);
  const [sequences, setSequences] = useState<EffectSequence[]>([]);
  const [steps, setSteps] = useState<EffectStep[]>([]);
  const [bindings, setBindings] = useState<AbilityPhaseEffectSequence[]>([]);

  const [draft, setDraft] = useState<DirectDamageAbilityFormDraft>(createDefaultFormDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [revisionConflict, setRevisionConflict] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<DirectDamageAbilitySetupWriteResult | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const typeResolution = useMemo(() => resolveRequiredTypes(types), [types]);
  const derivedIds = useMemo(
    () => (draft.providerId ? deriveGraphIdsFromProviderId(draft.providerId) : null),
    [draft.providerId]
  );
  const formValidation = useMemo(() => validateFormDraft(draft), [draft]);

  const collisions = useMemo(() => {
    if (!derivedIds || !draft.providerId.trim()) {
      return null;
    }
    return evaluateGraphCollisions(derivedIds, draft.providerId.trim(), {
      abilities,
      phases,
      sequences,
      steps,
      bindings
    });
  }, [derivedIds, draft.providerId, abilities, phases, sequences, steps, bindings]);

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

  const loadAll = useCallback(async () => {
    if (!selectedGameId) {
      setCurrentRevision(null);
      setTypes([]);
      setProviders([]);
      setAbilities([]);
      setPhases([]);
      setSequences([]);
      setSteps([]);
      setBindings([]);
      setLoadError(null);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const [
        stateResult,
        typesResult,
        providersResult,
        abilitiesResult,
        phasesResult,
        sequencesResult,
        stepsResult,
        bindingsResult
      ] = await Promise.all([
        getCombatDataState(apiBaseUrl, selectedGameId),
        getTypes(apiBaseUrl, selectedGameId),
        getProviders(apiBaseUrl, selectedGameId),
        getAbilities(apiBaseUrl, selectedGameId),
        getAbilityPhases(apiBaseUrl, selectedGameId),
        getEffectSequences(apiBaseUrl, selectedGameId),
        getEffectSteps(apiBaseUrl, selectedGameId),
        getAbilityPhaseEffectSequences(apiBaseUrl, selectedGameId)
      ]);

      setCurrentRevision(stateResult.data.currentRevision);
      setTypes(typesResult.data.data);
      setProviders(providersResult.data.data);
      setAbilities(abilitiesResult.data.data);
      setPhases(phasesResult.data.data);
      setSequences(sequencesResult.data.data);
      setSteps(stepsResult.data.data);
      setBindings(bindingsResult.data.data);
    } catch (error) {
      setCurrentRevision(null);
      setTypes([]);
      setProviders([]);
      setAbilities([]);
      setPhases([]);
      setSequences([]);
      setSteps([]);
      setBindings([]);
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
    setRevisionConflict(null);
  }, [selectedGameId]);

  const patchDraft = <K extends keyof DirectDamageAbilityFormDraft>(
    key: K,
    value: DirectDamageAbilityFormDraft[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveError(null);
    setSaveNotice(null);
    setRevisionConflict(null);
  };

  const dataReady = Boolean(selectedGameId) && !loading && !loadError && currentRevision !== null;
  const typesReady = typeResolution.ok;
  const hasHardConflict = collisions?.hasHardConflict === true;
  const canSave =
    dataReady &&
    Boolean(adminToken.trim()) &&
    formValidation.ok &&
    typesReady &&
    !hasHardConflict &&
    !saving;

  const handleSave = async () => {
    if (!selectedGameId || currentRevision === null || !formValidation.ok || !typeResolution.ok) {
      return;
    }
    const ids = deriveGraphIdsFromProviderId(formValidation.trimmed.providerId);
    if (!ids) {
      setSaveError('无法从 Provider ID 推导稳定图 ID。');
      return;
    }
    if (collisions?.hasHardConflict) {
      return;
    }

    const token = adminToken.trim();
    if (!token) {
      setSaveError('写入需要 Admin Token。');
      return;
    }

    const body = buildDirectDamageAbilitySetupBody(
      currentRevision,
      formValidation.trimmed,
      ids,
      typeResolution
    );

    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    setRevisionConflict(null);
    setLastResult(null);
    try {
      const result = await putDirectDamageAbilitySetup(
        apiBaseUrl,
        selectedGameId,
        formValidation.trimmed.providerId,
        ids.abilityId,
        token,
        body
      );
      setCurrentRevision(result.data.currentRevision);
      setLastResult(result.data);
      setSaveNotice(`已保存直伤技能图（revision ${result.data.currentRevision}）。`);
      setReloadTick((value) => value + 1);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409 && error.code === '409.REVISION_CONFLICT') {
        const expected = error.details?.expectedCurrentRevision;
        const actual = error.details?.actualCurrentRevision;
        setRevisionConflict(
          `修订冲突（409.REVISION_CONFLICT）：提交期望 revision=${expected ?? currentRevision}，服务端实际=${actual ?? '未知'}。未写入。依赖数据已刷新；本地表单已保留，请确认后显式再次保存。`
        );
        setReloadTick((value) => value + 1);
      } else {
        setSaveError(formatApiErrorWithDetails(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const editsDisabled = !selectedGameId || loading || saving;

  return (
    <div className="page-stack">
      <Panel
        title="直伤技能配置"
        kicker="Direct-damage Ability Setup"
        actions={
          <Space>
            <Button loading={loading} onClick={() => void loadAll()} disabled={!selectedGameId}>
              刷新依赖
            </Button>
            <Button type="primary" loading={saving} disabled={!canSave} onClick={() => void handleSave()}>
              保存
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          在已有 Provider 下，通过一次具名聚合写配置「主动技能 → impact 相位 → 对敌伤害步骤」。不创建
          Provider、不挂载实体；省略无关图节点，不做删除。
        </Typography.Paragraph>

        {!selectedGameId ? (
          <Alert type="warning" content="请先在顶部选择游戏。" />
        ) : null}
        {loading ? <Alert type="info" content="正在加载 combat-data 依赖…" /> : null}
        {loadError ? <Alert type="error" content={loadError} /> : null}

        {selectedGameId && !loading && !loadError ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Typography.Text bold>当前 revision：</Typography.Text>{' '}
              <Tag color="arcoblue">{currentRevision ?? '—'}</Tag>
              {!adminToken.trim() ? (
                <Tag color="orangered" style={{ marginLeft: 8 }}>
                  缺少 Admin Token，保存已禁用
                </Tag>
              ) : null}
            </div>

            {!typeResolution.ok ? (
              <Alert
                type="error"
                content={`缺少必需类型，无法保存。缺失 typeKey：${typeResolution.missingTypeKeys.join(', ')}。请先在 #/combat-data/types 补齐。`}
              />
            ) : (
              <Alert
                type="success"
                content={`类型就绪：active / impact / damage / opponent / add / on_enter；伤害语义可选 physical / magic / true。`}
              />
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 480 }}>
              <span>Provider（已有）</span>
              <Select
                showSearch
                allowClear
                placeholder="选择 Provider"
                value={draft.providerId || undefined}
                options={providerOptions}
                filterOption={filterSelectOption}
                disabled={editsDisabled}
                onChange={(value) => patchDraft('providerId', typeof value === 'string' ? value : '')}
              />
            </label>

            {draft.providerId && !derivedIds ? (
              <Alert
                type="error"
                content={`Provider ID「${draft.providerId}」不符合 ^provider_([a-z0-9][a-z0-9_]*)$，无法推导稳定 ID，保存已禁用。`}
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
                <span>abilityKey</span>
                <Input
                  value={draft.abilityKey}
                  disabled={editsDisabled}
                  placeholder="例：q"
                  onChange={(value) => patchDraft('abilityKey', value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>displayName</span>
                <Input
                  value={draft.displayName}
                  disabled={editsDisabled}
                  placeholder="显示名"
                  onChange={(value) => patchDraft('displayName', value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>amountFormulaKey</span>
                <Input
                  value={draft.amountFormulaKey}
                  disabled={editsDisabled}
                  placeholder="伤害公式 key"
                  onChange={(value) => patchDraft('amountFormulaKey', value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>伤害类型</span>
                <Select
                  value={draft.damageKind}
                  disabled={editsDisabled || !typeResolution.ok}
                  options={DAMAGE_KIND_OPTIONS.map((item) => ({
                    value: item.kind,
                    label: `${item.label}（${item.typeKey}）`
                  }))}
                  onChange={(value) => patchDraft('damageKind', value as DamageKind)}
                />
              </label>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>castConditionFormulaKey（可选）</span>
                <Input
                  value={draft.castConditionFormulaKey}
                  disabled={editsDisabled}
                  onChange={(value) => patchDraft('castConditionFormulaKey', value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>durationFormulaKey（可选）</span>
                <Input
                  value={draft.durationFormulaKey}
                  disabled={editsDisabled}
                  onChange={(value) => patchDraft('durationFormulaKey', value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>conditionFormulaKey（可选）</span>
                <Input
                  value={draft.conditionFormulaKey}
                  disabled={editsDisabled}
                  onChange={(value) => patchDraft('conditionFormulaKey', value)}
                />
              </label>
            </div>

            <Space size="large">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Switch
                  checked={draft.interruptible}
                  disabled={editsDisabled}
                  onChange={(checked) => patchDraft('interruptible', checked)}
                />
                <span>interruptible（默认 true）</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Switch
                  checked={draft.copyableOnHit}
                  disabled={editsDisabled}
                  onChange={(checked) => patchDraft('copyableOnHit', checked)}
                />
                <span>copyableOnHit（默认 false）</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Switch
                  checked={draft.critEligible}
                  disabled={editsDisabled}
                  onChange={(checked) => patchDraft('critEligible', checked)}
                />
                <span>critEligible（默认 false）</span>
              </label>
            </Space>

            {!formValidation.ok && draft.providerId ? (
              <Alert type="warning" content={formValidation.reason} />
            ) : null}

            {derivedIds ? (
              <section aria-label="图预览">
                <Typography.Title heading={6} style={{ marginBottom: 8 }}>
                  推导图预览（只读）
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
                  固定语义：主动技能（{FIXED_TYPE_KEYS.abilityKind}）→ impact 相位（
                  {FIXED_TYPE_KEYS.phaseType}）→ damage 操作 / opponent 目标 / add 策略 / on_enter
                  触发。
                </Typography.Paragraph>
                <Space wrap>
                  <Tag color={nodeStatusColor(collisions?.ability ?? 'absent')}>
                    ability {derivedIds.abilityId} · {collisionStatusLabel(collisions?.ability ?? 'absent')}
                  </Tag>
                  <Tag color={nodeStatusColor(collisions?.phase ?? 'absent')}>
                    phase {derivedIds.phaseId} · {collisionStatusLabel(collisions?.phase ?? 'absent')}
                  </Tag>
                  <Tag color={nodeStatusColor(collisions?.sequence ?? 'absent')}>
                    sequence {derivedIds.sequenceId} ·{' '}
                    {collisionStatusLabel(collisions?.sequence ?? 'absent')}
                  </Tag>
                  <Tag color={nodeStatusColor(collisions?.step ?? 'absent')}>
                    step {derivedIds.stepId} · {collisionStatusLabel(collisions?.step ?? 'absent')}
                  </Tag>
                </Space>
                {formValidation.ok ? (
                  <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                    sequenceKey = <code>{formValidation.trimmed.abilityKey}_impact</code>
                  </Typography.Paragraph>
                ) : null}
              </section>
            ) : null}

            {collisions?.hardConflicts.map((message) => (
              <Alert key={message} type="error" content={message} />
            ))}
            {collisions?.bindingWarning ? (
              <Alert type="warning" content={collisions.bindingWarning} />
            ) : null}

            {revisionConflict ? <Alert type="warning" content={revisionConflict} /> : null}
            {saveError ? <Alert type="error" content={saveError} /> : null}
            {saveNotice ? <Alert type="success" content={saveNotice} /> : null}

            {lastResult ? (
              <section aria-label="权威返回图">
                <Typography.Title heading={6}>权威返回（服务端）</Typography.Title>
                <Typography.Paragraph style={{ marginTop: 0 }}>
                  gameId={lastResult.gameId} · providerId={lastResult.providerId} · abilityId=
                  {lastResult.abilityId} · revision={lastResult.currentRevision}
                </Typography.Paragraph>
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    overflow: 'auto',
                    maxHeight: 360,
                    background: 'var(--color-fill-2)',
                    borderRadius: 4,
                    fontSize: 12
                  }}
                >
                  {JSON.stringify(
                    {
                      ability: lastResult.ability,
                      phase: lastResult.phase,
                      effectSequence: lastResult.effectSequence,
                      effectStep: lastResult.effectStep,
                      phaseEffectSequenceBinding: lastResult.phaseEffectSequenceBinding
                    },
                    null,
                    2
                  )}
                </pre>
              </section>
            ) : null}
          </Space>
        ) : null}
      </Panel>
    </div>
  );
}
