import { Alert, Button, Card, Modal, Space, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import { listAttributes } from '../../../services/attributeClient';
import {
  UnconfirmedDamageTypeFormulaWriteError,
  deleteDamageTypeFormula,
  getDamageTypeFormula,
  updateDamageTypeFormula
} from '../../../services/damageTypeClient';
import type { Attribute } from '../../../types/attribute';
import type { DamageType } from '../../../types/damageType';
import type { DamageTypeFormula } from '../../../types/damageTypeFormula';
import { DAMAGE_TYPE_FORMULA_NOT_FOUND } from '../../../types/damageTypeFormula';
import { DamageTypeFormulaExpressionEditor } from './DamageTypeFormulaExpressionEditor';
import {
  FORMULA_SAVE_PENDING_MESSAGE,
  applyFormulaReadbackResult,
  canSubmitDamageTypeFormula,
  formulaStageViews,
  isSameFormulaContext,
  mapDamageTypeFormulaFieldIssues,
  partitionFormulaNodeIssues,
  previewDamageTypeFormulaChain,
  previewDamageTypeFormulaStage,
  resolveFormulaCloseAttempt,
  resolveFormulaLoad,
  restoreScrollTop,
  retainedDisabledAttributeTriples,
  updateFormulaDraftAtPath,
  validateDamageTypeFormulaDraft,
  type DamageTypeFormulaDraft,
  type DamageTypeFormulaNodeDraft,
  type DamageTypeFormulaNodeIssue,
  type DamageTypeFormulaRequestContext
} from './damageTypeFormulaForm';

type DamageTypeFormulaEditorModalProps = {
  damageType: DamageType;
  readOnly: boolean;
  apiBaseUrl: string;
  selectedGameId: string;
  adminToken: string;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
  onDeleted: (message: string) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

type PendingFormulaWrite =
  | { kind: 'save'; formula: DamageTypeFormula }
  | { kind: 'delete' };

function requestContext(
  apiBaseUrl: string,
  selectedGameId: string,
  adminToken: string,
  damageTypeKey: string
): DamageTypeFormulaRequestContext {
  return {
    apiBaseUrl,
    gameId: selectedGameId,
    token: adminToken.trim(),
    damageTypeKey
  };
}

export function DamageTypeFormulaEditorModal({
  damageType,
  readOnly,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onDeleted,
  onDirtyChange
}: DamageTypeFormulaEditorModalProps) {
  const [reloadToken, setReloadToken] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DamageTypeFormulaDraft | null>(null);
  const [baseline, setBaseline] = useState<DamageTypeFormulaDraft | null>(null);
  const [originDraft, setOriginDraft] = useState<DamageTypeFormulaDraft | null>(null);
  const [persisted, setPersisted] = useState(false);
  const [blank, setBlank] = useState(false);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [nodeIssues, setNodeIssues] = useState<DamageTypeFormulaNodeIssue[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [awaitingReadback, setAwaitingReadback] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [scrollVersion, setScrollVersion] = useState(0);
  const generationRef = useRef(0);
  const catalogGeneration = useRef(0);
  const contextRef = useRef<DamageTypeFormulaRequestContext>(
    requestContext(apiBaseUrl, selectedGameId, adminToken, damageType.damageTypeKey)
  );
  const draftRef = useRef<DamageTypeFormulaDraft | null>(null);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const pendingRef = useRef<PendingFormulaWrite | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRestore = useRef<number | null>(null);

  const retainedDisabled = useMemo(
    () => originDraft && catalogReady ? retainedDisabledAttributeTriples(originDraft, attributes) : [],
    [attributes, catalogReady, originDraft]
  );
  const dirty = !readOnly
    && draft !== null
    && baseline !== null
    && JSON.stringify(draft) !== JSON.stringify(baseline);
  const pending = awaitingReadback || pendingMessage !== null;
  const ready = phase === 'ready' && draft !== null;
  const canSave = canSubmitDamageTypeFormula({
    readOnly,
    catalogReady,
    pending,
    saving: saving || deleting || confirming,
    ready
  });

  const replaceDraft = (next: DamageTypeFormulaDraft | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  const rememberScroll = () => {
    scrollRestore.current = scrollRef.current?.scrollTop ?? 0;
    setScrollVersion((value) => value + 1);
  };

  useEffect(() => {
    if (scrollVersion === 0) return;
    restoreScrollTop(scrollRef.current, scrollRestore.current ?? 0);
  }, [scrollVersion]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const catalogRequestGeneration = ++catalogGeneration.current;
    const started = requestContext(apiBaseUrl, selectedGameId, adminToken, damageType.damageTypeKey);
    contextRef.current = started;
    let cancelled = false;
    const current = () => !cancelled
      && generationRef.current === generation
      && isSameFormulaContext(started, contextRef.current);
    const catalogCurrent = () => current() && catalogGeneration.current === catalogRequestGeneration;

    setPhase('loading');
    setLoadError(null);
    setSaveError(null);
    setPendingMessage(null);
    setAwaitingReadback(false);
    setNodeIssues([]);
    setCatalogError(null);
    setCatalogReady(false);
    setCatalogLoading(true);
    setAttributes([]);
    pendingRef.current = null;
    savingRef.current = false;
    deletingRef.current = false;
    setSaving(false);
    setDeleting(false);
    setConfirming(false);
    replaceDraft(null);
    setBaseline(null);
    setOriginDraft(null);
    setPersisted(false);
    setBlank(false);

    if (!started.token) {
      setPhase('error');
      setLoadError('请先配置 Admin Token。');
      setCatalogLoading(false);
      return () => { cancelled = true; };
    }
    if (!started.gameId) {
      setPhase('error');
      setLoadError('请先选择游戏。');
      setCatalogLoading(false);
      return () => { cancelled = true; };
    }

    const loadFormula = async () => {
      let resolved: ReturnType<typeof resolveFormulaLoad>;
      try {
        const result = await getDamageTypeFormula(
          apiBaseUrl,
          selectedGameId,
          damageType.damageTypeKey,
          started.token
        );
        resolved = resolveFormulaLoad({ ok: true, detail: result.data });
      } catch (error) {
        resolved = resolveFormulaLoad({ ok: false, error });
      }
      if (!current()) return;
      if (resolved.kind === 'error') {
        setPhase('error');
        setLoadError(resolved.message);
        replaceDraft(null);
        setBaseline(null);
        setOriginDraft(null);
        return;
      }
      replaceDraft(resolved.draft);
      setBaseline(resolved.draft);
      setOriginDraft(resolved.draft);
      setPersisted(resolved.persisted);
      setBlank(!resolved.persisted);
      setPhase('ready');
    };

    const loadCatalog = async () => {
      try {
        const result = await listAttributes(apiBaseUrl, selectedGameId, started.token);
        if (!catalogCurrent()) return;
        if (!Array.isArray(result.data?.items)) {
          setAttributes([]);
          setCatalogReady(false);
          setCatalogError('属性目录响应不完整。');
          return;
        }
        setAttributes(result.data.items);
        setCatalogReady(true);
        setCatalogError(null);
      } catch (error) {
        if (!catalogCurrent()) return;
        setAttributes([]);
        setCatalogReady(false);
        setCatalogError(getErrorMessage(error));
      } finally {
        if (catalogCurrent()) setCatalogLoading(false);
      }
    };

    void loadFormula();
    void loadCatalog();
    return () => {
      cancelled = true;
      generationRef.current += 1;
      catalogGeneration.current += 1;
    };
  }, [adminToken, apiBaseUrl, damageType.damageTypeKey, reloadToken, selectedGameId]);

  const retryCatalog = async () => {
    const generation = ++catalogGeneration.current;
    const started = contextRef.current;
    if (!started.token || !started.gameId) return;
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const result = await listAttributes(started.apiBaseUrl, started.gameId, started.token);
      if (catalogGeneration.current !== generation || !isSameFormulaContext(started, contextRef.current)) return;
      if (!Array.isArray(result.data?.items)) {
        setCatalogReady(false);
        setCatalogError('属性目录响应不完整。');
        return;
      }
      setAttributes(result.data.items);
      setCatalogReady(true);
      setCatalogError(null);
    } catch (error) {
      if (catalogGeneration.current !== generation || !isSameFormulaContext(started, contextRef.current)) return;
      setCatalogReady(false);
      setCatalogError(getErrorMessage(error));
    } finally {
      if (catalogGeneration.current === generation && isSameFormulaContext(started, contextRef.current)) {
        setCatalogLoading(false);
      }
    }
  };

  const confirmSaved = async (submitted: DamageTypeFormula) => {
    const generation = generationRef.current;
    const started = contextRef.current;
    pendingRef.current = { kind: 'save', formula: submitted };
    setAwaitingReadback(true);
    setConfirming(true);
    const currentDraft = draftRef.current;
    const stillCurrent = () => generationRef.current === generation
      && isSameFormulaContext(started, contextRef.current);
    let readback: { ok: true; formula: DamageTypeFormula } | { ok: false };
    try {
      const result = await getDamageTypeFormula(
        started.apiBaseUrl,
        started.gameId,
        started.damageTypeKey,
        started.token
      );
      readback = stillCurrent() ? { ok: true, formula: result.data.formula } : { ok: false };
    } catch {
      readback = { ok: false };
    } finally {
      if (stillCurrent()) setConfirming(false);
    }
    if (!stillCurrent()) return;
    const decision = applyFormulaReadbackResult(currentDraft, submitted, readback);
    if (!decision.close) {
      setPendingMessage(decision.message ?? FORMULA_SAVE_PENDING_MESSAGE);
      return;
    }
    pendingRef.current = null;
    setAwaitingReadback(false);
    setPendingMessage(null);
    onDirtyChange(false);
    await onSaved(`伤害类型「${damageType.name}」的结算公式已保存。`);
  };

  const confirmDeleted = async () => {
    const generation = generationRef.current;
    const started = contextRef.current;
    pendingRef.current = { kind: 'delete' };
    setAwaitingReadback(true);
    setConfirming(true);
    const stillCurrent = () => generationRef.current === generation
      && isSameFormulaContext(started, contextRef.current);
    let deleted = false;
    try {
      await getDamageTypeFormula(
        started.apiBaseUrl,
        started.gameId,
        started.damageTypeKey,
        started.token
      );
    } catch (error) {
      deleted = error instanceof ApiRequestError
        && error.status === 404
        && error.code === DAMAGE_TYPE_FORMULA_NOT_FOUND;
    } finally {
      if (stillCurrent()) setConfirming(false);
    }
    if (!stillCurrent()) return;
    if (!deleted) {
      setPendingMessage('删除结果待确认');
      return;
    }
    pendingRef.current = null;
    setAwaitingReadback(false);
    setPendingMessage(null);
    onDirtyChange(false);
    await onDeleted(`伤害类型「${damageType.name}」的结算公式已删除。`);
  };

  const save = async () => {
    const currentDraft = draftRef.current;
    if (!currentDraft || savingRef.current || deletingRef.current || pendingRef.current || !canSave) return;
    const validation = validateDamageTypeFormulaDraft(currentDraft, attributes, retainedDisabled);
    if (!validation.ok) {
      rememberScroll();
      setNodeIssues(validation.nodeIssues);
      setSaveError(validation.nodeIssues[0]?.message ?? '结算公式不完整。');
      return;
    }
    const started = contextRef.current;
    const generation = generationRef.current;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await updateDamageTypeFormula(
        started.apiBaseUrl,
        started.gameId,
        started.damageTypeKey,
        started.token,
        { formula: validation.formula }
      );
    } catch (error) {
      if (generationRef.current !== generation || !isSameFormulaContext(started, contextRef.current)) return;
      if (error instanceof UnconfirmedDamageTypeFormulaWriteError) {
        savingRef.current = false;
        setSaving(false);
        await confirmSaved(validation.formula);
        return;
      }
      const mapped = mapDamageTypeFormulaFieldIssues(error);
      const { placed, unplaced } = partitionFormulaNodeIssues(currentDraft, mapped.nodeIssues);
      rememberScroll();
      setNodeIssues(placed);
      setSaveError([
        getErrorMessage(error),
        ...mapped.unmappedMessages,
        ...unplaced.map((issue) => issue.message)
      ].filter((item) => item.trim()).join('；'));
      savingRef.current = false;
      setSaving(false);
      return;
    }
    if (generationRef.current !== generation || !isSameFormulaContext(started, contextRef.current)) return;
    savingRef.current = false;
    setSaving(false);
    await confirmSaved(validation.formula);
  };

  const remove = async () => {
    if (!persisted || readOnly || savingRef.current || deletingRef.current || pendingRef.current || confirming) return;
    if (!window.confirm(`确定删除「${damageType.name}」的结算公式吗？伤害类型会保留。`)) return;
    const started = contextRef.current;
    const generation = generationRef.current;
    deletingRef.current = true;
    setDeleting(true);
    setSaveError(null);
    let verifyDelete = false;
    try {
      await deleteDamageTypeFormula(started.apiBaseUrl, started.gameId, started.damageTypeKey, started.token);
      if (generationRef.current !== generation || !isSameFormulaContext(started, contextRef.current)) return;
      verifyDelete = true;
    } catch (error) {
      if (generationRef.current !== generation || !isSameFormulaContext(started, contextRef.current)) return;
      verifyDelete = error instanceof UnconfirmedDamageTypeFormulaWriteError
        || (error instanceof ApiRequestError
          && error.status === 404
          && error.code === DAMAGE_TYPE_FORMULA_NOT_FOUND);
      if (!verifyDelete) setSaveError(getErrorMessage(error));
    } finally {
      if (generationRef.current === generation && isSameFormulaContext(started, contextRef.current)) {
        deletingRef.current = false;
        setDeleting(false);
      }
    }
    if (verifyDelete) await confirmDeleted();
  };

  const close = () => {
    if (savingRef.current || deletingRef.current || confirming) return;
    const confirmedDiscard = !dirty || window.confirm('结算公式修改尚未保存，确定放弃吗？');
    if (resolveFormulaCloseAttempt(dirty, confirmedDiscard) === 'keep') return;
    onClose();
  };

  const updateAtPath = (path: string, next: DamageTypeFormulaNodeDraft) => {
    if (readOnly || savingRef.current || deletingRef.current || pendingRef.current) return;
    setDraft((current) => {
      if (!current) return current;
      const updated = updateFormulaDraftAtPath(current, path, next);
      draftRef.current = updated;
      return updated;
    });
    setNodeIssues([]);
    setSaveError(null);
  };

  const stageViews = draft ? formulaStageViews(draft) : [];
  const chainPreview = draft
    ? previewDamageTypeFormulaChain(draft, attributes, retainedDisabled)
    : [];

  return (
    <Modal
      title={`结算公式 - ${damageType.name}`}
      visible
      maskClosable
      onCancel={close}
      style={{ width: 960 }}
      footer={
        <Space>
          {pending ? (
            <Button
              onClick={() => {
                const pendingWrite = pendingRef.current;
                if (!pendingWrite || confirming) return;
                if (pendingWrite.kind === 'save') {
                  void confirmSaved(pendingWrite.formula);
                } else {
                  void confirmDeleted();
                }
              }}
              loading={confirming}
              disabled={saving || deleting}
            >重新读取</Button>
          ) : null}
          {!readOnly && persisted && !pending ? (
            <Button
              status="danger"
              onClick={() => void remove()}
              loading={deleting}
              disabled={saving || deleting || confirming}
            >删除公式</Button>
          ) : null}
          <Button onClick={close} disabled={saving || deleting || confirming}>{readOnly ? '关闭' : '取消'}</Button>
          {canSave ? <Button type="primary" loading={saving} onClick={() => void save()}>保存</Button> : null}
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        <Typography.Text type="secondary">伤害类型标识：{damageType.damageTypeKey}</Typography.Text>
        {phase === 'loading' ? <Typography.Text type="secondary">正在读取结算公式…</Typography.Text> : null}
        {phase === 'error' && loadError ? (
          <Space direction="vertical">
            <Alert type="error" content={loadError} />
            <Button
              onClick={() => setReloadToken((value) => value + 1)}
              disabled={saving || deleting || confirming}
            >重新读取</Button>
          </Space>
        ) : null}
        {ready && catalogLoading ? <Typography.Text type="secondary">正在读取属性目录…</Typography.Text> : null}
        {catalogError ? (
          <Space direction="vertical">
            <Alert type="error" content={catalogError} />
            <Button
              onClick={() => void retryCatalog()}
              loading={catalogLoading}
              disabled={saving || deleting || confirming}
            >重试加载属性</Button>
          </Space>
        ) : null}
        {pendingMessage ? <Alert type="warning" content={pendingMessage} /> : null}
        {saveError ? <Alert type="error" content={saveError} /> : null}
        {ready && blank ? <Alert type="info" content="当前伤害类型尚未配置结算公式。" /> : null}
        {ready && draft ? (
          <div ref={scrollRef} style={{ maxHeight: '68vh', overflow: 'auto', paddingRight: 4 }}>
            <Space direction="vertical" size="medium" style={{ width: '100%' }}>
              <Card size="small">
                <div role="region" aria-label="五阶段关系预览">
                  <Typography.Title heading={6} style={{ marginTop: 0, marginBottom: 8 }}>
                    五阶段关系预览
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    R、P、F、E、M 分别代表穿透前抗性、百分比穿透、固定穿透、有效抗性和抗性系数。
                  </Typography.Text>
                  {chainPreview.map((stage) => (
                    <Typography.Paragraph key={stage.stageKey} style={{ marginBottom: 6 }}>
                      <Typography.Text bold>{stage.symbol}（{stage.label}） = </Typography.Text>
                      {stage.segments.map((segment, index) => (
                        <Typography.Text
                          key={`${stage.stageKey}-chain-${index}-${segment.text}`}
                          type={segment.error ? 'error' : undefined}
                        >
                          {segment.text}
                        </Typography.Text>
                      ))}
                    </Typography.Paragraph>
                  ))}
                </div>
              </Card>
              {stageViews.map((stage) => {
                const preview = previewDamageTypeFormulaStage(
                  stage.node,
                  stage.stageKey,
                  attributes,
                  retainedDisabled
                );
                return (
                  <div key={stage.stageKey}>
                    <Typography.Title heading={6} style={{ marginTop: 0 }}>{stage.label}</Typography.Title>
                    <DamageTypeFormulaExpressionEditor
                      stageKey={stage.stageKey}
                      stageRoot={stage.node}
                      path={stage.path}
                      node={stage.node}
                      readOnly={readOnly}
                      disabled={saving || deleting || confirming || pending}
                      attributes={attributes}
                      retainedDisabled={retainedDisabled}
                      nodeIssues={nodeIssues}
                      onChange={updateAtPath}
                      onRejectExpand={(issue) => {
                        rememberScroll();
                        setNodeIssues((current) => [
                          ...current.filter((item) => item.path !== issue.path),
                          issue
                        ]);
                      }}
                    />
                    <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>本阶段预览</Typography.Text>
                    <Typography.Paragraph style={{ marginBottom: 0 }}>
                      {preview.map((segment, index) => (
                        <Typography.Text
                          key={`${stage.stageKey}-${index}-${segment.text}`}
                          type={segment.error ? 'error' : undefined}
                        >
                          {segment.text}
                        </Typography.Text>
                      ))}
                    </Typography.Paragraph>
                  </div>
                );
              })}
            </Space>
          </div>
        ) : null}
      </Space>
    </Modal>
  );
}
