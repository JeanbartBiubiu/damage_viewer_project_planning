import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Grid, Input, Space, Table, Tabs, Tag, Typography } from '@arco-design/web-react';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import {
  createVersion,
  getBundle,
  getCoefficientBucket,
  getCoefficientBuckets,
  getCurrentVersion,
  getErrorMessage,
  getFormulaBinding,
  getFormulaBindings,
  getFormulaProfile,
  getFormulaProfiles,
  getStatusActionControlRule,
  getStatusActionControlRules,
  patchCoefficientBucket,
  patchFormulaBinding,
  patchFormulaProfile,
  patchStatusActionControlRule,
  publishVersion,
  putCoefficientBucket,
  putFormulaBinding,
  putFormulaProfile,
  putStatusActionControlRule
} from '../services/apiClient';
import type {
  CoefficientBucket,
  CurrentVersion,
  FormulaBinding,
  FormulaProfile,
  GameDataBundle,
  JsonObject,
  LoadState,
  StatusActionControlRule,
  VersionCreateResponse,
  VersionPublishResponse
} from '../types/api';

type AdminPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  adminToken: string;
  onAdminTokenChange: (value: string) => void;
  requestedResource?: ResourceKind | null;
  onDataPublished?: () => void;
};

export type ResourceKind = 'formulaProfiles' | 'formulaBindings' | 'coefficientBuckets' | 'statusActionControlRules';

type AdminSnapshot = {
  coefficientBuckets: CoefficientBucket[];
  statusActionControlRules: StatusActionControlRule[];
  formulaProfiles: FormulaProfile[];
  formulaBindings: FormulaBinding[];
};

type EditorState = {
  mode: 'create' | 'put' | 'patch';
  selectedKey: string | null;
  detailState: LoadState;
  detailError: string | null;
  draftText: string;
  patchText: string;
  createDraft: {
    key: string;
    targetCategory: string;
    targetId: string;
    bindingKey: string;
  };
  submitState: LoadState;
  submitError: string | null;
  successMessage: string | null;
};

type ResourceListRow = {
  key: string;
  primary: string;
  secondary: string;
  tertiary: string;
  quaternary: string;
  note: string;
};

const { Row, Col } = Grid;
const TabPane = Tabs.TabPane;

const EMPTY_SNAPSHOT: AdminSnapshot = {
  coefficientBuckets: [],
  statusActionControlRules: [],
  formulaProfiles: [],
  formulaBindings: []
};
const RESOURCE_KINDS: ResourceKind[] = [
  'formulaProfiles',
  'formulaBindings',
  'coefficientBuckets',
  'statusActionControlRules'
];
const RESOURCE_HASH_SEGMENTS: Record<ResourceKind, string> = {
  formulaProfiles: 'formula-profiles',
  formulaBindings: 'formula-bindings',
  coefficientBuckets: 'coefficient-buckets',
  statusActionControlRules: 'status-action-control-rules'
};
const EMPTY_PATCH_TEXT = '{\n  \n}';

function createEmptyEditorState(): EditorState {
  return {
    mode: 'create',
    selectedKey: null,
    detailState: 'idle',
    detailError: null,
    draftText: '',
    patchText: EMPTY_PATCH_TEXT,
    createDraft: {
      key: '',
      targetCategory: '',
      targetId: '',
      bindingKey: ''
    },
    submitState: 'idle',
    submitError: null,
    successMessage: null
  };
}

function createEditorStateMap(): Record<ResourceKind, EditorState> {
  return {
    formulaProfiles: createEmptyEditorState(),
    formulaBindings: createEmptyEditorState(),
    coefficientBuckets: createEmptyEditorState(),
    statusActionControlRules: createEmptyEditorState()
  };
}

function getResourceLabel(kind: ResourceKind): string {
  switch (kind) {
    case 'formulaProfiles':
      return '公式档案';
    case 'formulaBindings':
      return '公式绑定';
    case 'coefficientBuckets':
      return '乘区桶';
    case 'statusActionControlRules':
      return '状态动作规则';
  }
}

function getResourceDescription(kind: ResourceKind): string {
  switch (kind) {
    case 'formulaProfiles':
      return '管理公式定义本身，决定公式类型、公式种类和参数。';
    case 'formulaBindings':
      return '把公式挂到目标实体与 bindingKey 上。';
    case 'coefficientBuckets':
      return '维护属性域与伤害域的聚合桶。';
    case 'statusActionControlRules':
      return '管理禁用、打断、动作限制等控制规则。';
  }
}

function getResourceItems(snapshot: AdminSnapshot, kind: ResourceKind) {
  switch (kind) {
    case 'formulaProfiles':
      return snapshot.formulaProfiles;
    case 'formulaBindings':
      return snapshot.formulaBindings;
    case 'coefficientBuckets':
      return snapshot.coefficientBuckets;
    case 'statusActionControlRules':
      return snapshot.statusActionControlRules;
  }
}

function encodeFormulaBindingKey(targetCategory: string, targetId: string, bindingKey: string) {
  return `${targetCategory}|${targetId}|${bindingKey}`;
}

function decodeFormulaBindingKey(value: string) {
  const [targetCategory = '', targetId = '', bindingKey = ''] = value.split('|');
  return { targetCategory, targetId, bindingKey };
}

function getResourceKey(kind: ResourceKind, entity: FormulaProfile | FormulaBinding | CoefficientBucket | StatusActionControlRule) {
  switch (kind) {
    case 'formulaProfiles':
      return (entity as FormulaProfile).formulaId;
    case 'formulaBindings': {
      const binding = entity as FormulaBinding;
      return encodeFormulaBindingKey(binding.targetCategory, binding.targetId, binding.bindingKey);
    }
    case 'coefficientBuckets':
      return (entity as CoefficientBucket).bucketKey;
    case 'statusActionControlRules':
      return (entity as StatusActionControlRule).ruleId;
  }
}

function buildResourceRows(snapshot: AdminSnapshot, kind: ResourceKind): ResourceListRow[] {
  switch (kind) {
    case 'formulaProfiles':
      return snapshot.formulaProfiles.map((profile) => ({
        key: profile.formulaId,
        primary: profile.formulaId,
        secondary: profile.formulaType ?? '--',
        tertiary: profile.formulaKind ?? '--',
        quaternary: profile.updatedAt ?? '--',
        note: profile.description ?? ''
      }));
    case 'formulaBindings':
      return snapshot.formulaBindings.map((binding) => ({
        key: encodeFormulaBindingKey(binding.targetCategory, binding.targetId, binding.bindingKey),
        primary: binding.bindingKey,
        secondary: `${binding.targetCategory}:${binding.targetId}`,
        tertiary: binding.formulaId,
        quaternary: binding.updatedAt ?? '--',
        note: binding.overrideParams ? 'overrideParams ready' : 'no overrideParams'
      }));
    case 'coefficientBuckets':
      return snapshot.coefficientBuckets.map((bucket) => ({
        key: bucket.bucketKey,
        primary: bucket.bucketKey,
        secondary: bucket.resolutionDomain,
        tertiary: bucket.stageKey,
        quaternary: bucket.aggregationMode,
        note: bucket.targetAttrKey ?? bucket.description ?? ''
      }));
    case 'statusActionControlRules':
      return snapshot.statusActionControlRules.map((rule) => ({
        key: rule.ruleId,
        primary: rule.ruleId,
        secondary: rule.ruleKind,
        tertiary: `${rule.statusTypeId}`,
        quaternary: `${rule.priority ?? '--'}`,
        note: rule.description ?? ''
      }));
  }
}

function getResourceColumns(kind: ResourceKind) {
  switch (kind) {
    case 'formulaProfiles':
      return ['formulaId', 'formulaType', 'formulaKind', 'updatedAt'];
    case 'formulaBindings':
      return ['bindingKey', 'target', 'formulaId', 'updatedAt'];
    case 'coefficientBuckets':
      return ['bucketKey', 'domain', 'stageKey', 'aggregation'];
    case 'statusActionControlRules':
      return ['ruleId', 'ruleKind', 'statusTypeId', 'priority'];
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseJsonObject(text: string, label: string): JsonObject {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as JsonObject;
}

function getCreateFieldSchema(kind: ResourceKind) {
  switch (kind) {
    case 'formulaProfiles':
      return [{ field: 'key', label: 'formulaId', placeholder: 'damage.skill.katarina.r.base' }] as const;
    case 'formulaBindings':
      return [
        { field: 'targetCategory', label: 'targetCategory', placeholder: 'skill' },
        { field: 'targetId', label: 'targetId', placeholder: 'skill_katarina_r' },
        { field: 'bindingKey', label: 'bindingKey', placeholder: 'damage.base' }
      ] as const;
    case 'coefficientBuckets':
      return [{ field: 'key', label: 'bucketKey', placeholder: 'magic_damage.percent_bonus' }] as const;
    case 'statusActionControlRules':
      return [{ field: 'key', label: 'ruleId', placeholder: 'status_stun_forbid_cast' }] as const;
  }
}

function resolveCreateKey(kind: ResourceKind, createDraft: EditorState['createDraft']): string | null {
  if (kind === 'formulaBindings') {
    const targetCategory = createDraft.targetCategory.trim();
    const targetId = createDraft.targetId.trim();
    const bindingKey = createDraft.bindingKey.trim();
    if (!targetCategory || !targetId || !bindingKey) {
      return null;
    }
    return encodeFormulaBindingKey(targetCategory, targetId, bindingKey);
  }

  const key = createDraft.key.trim();
  return key || null;
}

function buildCreatePayload(kind: ResourceKind, createDraft: EditorState['createDraft']): JsonObject {
  switch (kind) {
    case 'formulaProfiles':
      return {
        formulaId: createDraft.key.trim(),
        formulaType: '',
        formulaKind: '',
        params: {},
        description: ''
      };
    case 'formulaBindings':
      return {
        targetCategory: createDraft.targetCategory.trim(),
        targetId: createDraft.targetId.trim(),
        bindingKey: createDraft.bindingKey.trim(),
        formulaId: '',
        overrideParams: {}
      };
    case 'coefficientBuckets':
      return {
        bucketKey: createDraft.key.trim(),
        resolutionDomain: 'attribute',
        stageKey: '',
        targetAttrKey: '',
        aggregationMode: 'add',
        description: ''
      };
    case 'statusActionControlRules':
      return {
        ruleId: createDraft.key.trim(),
        statusTypeId: 0,
        ruleKind: 'forbid',
        actionTypeIds: [],
        actionMatchTypeIds: [],
        interruptPhaseTypeIds: [],
        priority: 100,
        description: ''
      };
  }
}

export function AdminPage({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  adminToken,
  onAdminTokenChange,
  requestedResource,
  onDataPublished
}: AdminPageProps) {
  const token = adminToken.trim();
  const [activeResource, setActiveResource] = useState<ResourceKind>('formulaProfiles');
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [snapshotState, setSnapshotState] = useState<LoadState>('idle');
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AdminSnapshot>(EMPTY_SNAPSHOT);
  const [editors, setEditors] = useState<Record<ResourceKind, EditorState>>(createEditorStateMap);
  const [versionCodeDraft, setVersionCodeDraft] = useState('');
  const [releaseDateDraft, setReleaseDateDraft] = useState('');
  const [publishVersionIdDraft, setPublishVersionIdDraft] = useState('');
  const [versionState, setVersionState] = useState<LoadState>('idle');
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionSuccess, setVersionSuccess] = useState<string | null>(null);
  const [createdVersion, setCreatedVersion] = useState<VersionCreateResponse | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<VersionPublishResponse | null>(null);
  const [publishedCurrentVersion, setPublishedCurrentVersion] = useState<CurrentVersion | null>(null);
  const [publishedBundleMeta, setPublishedBundleMeta] = useState<GameDataBundle['meta'] | null>(null);

  const activeEditor = editors[activeResource];

  useEffect(() => {
    if (requestedResource && requestedResource !== activeResource) {
      setActiveResource(requestedResource);
    }
  }, [activeResource, requestedResource]);

  useEffect(() => {
    if (!selectedGameId || !token) {
      setSnapshotState('idle');
      setSnapshotError(null);
      setSnapshot(EMPTY_SNAPSHOT);
      setEditors(createEditorStateMap());
      return;
    }

    let cancelled = false;
    const gameId = selectedGameId;

    async function loadSnapshot() {
      setSnapshotState('loading');
      setSnapshotError(null);

      try {
        const [bucketsResult, rulesResult, profilesResult, bindingsResult] = await Promise.all([
          getCoefficientBuckets(apiBaseUrl, gameId, token),
          getStatusActionControlRules(apiBaseUrl, gameId, token),
          getFormulaProfiles(apiBaseUrl, gameId, token),
          getFormulaBindings(apiBaseUrl, gameId, token)
        ]);

        if (cancelled) {
          return;
        }

        setSnapshot({
          coefficientBuckets: bucketsResult.data.coefficientBuckets,
          statusActionControlRules: rulesResult.data.statusActionControlRules,
          formulaProfiles: profilesResult.data.formulaProfiles,
          formulaBindings: bindingsResult.data.formulaBindings
        });
        setSnapshotState('success');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSnapshotState('error');
        setSnapshotError(getErrorMessage(error));
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, refreshSeed, selectedGameId, token]);

  useEffect(() => {
    setEditors((current) => {
      let changed = false;
      const next = { ...current };

      (Object.keys(current) as ResourceKind[]).forEach((kind) => {
        const items = getResourceItems(snapshot, kind);
        const validKeys = items.map((item) => getResourceKey(kind, item));
        const state = current[kind];

        if (validKeys.length === 0) {
          if (state.selectedKey !== null || state.draftText || state.detailState !== 'idle') {
            next[kind] = createEmptyEditorState();
            changed = true;
          }
          return;
        }

        if (state.selectedKey && validKeys.includes(state.selectedKey)) {
          return;
        }

        next[kind] = {
          ...state,
          mode: 'put',
          selectedKey: validKeys[0],
          detailState: 'idle',
          detailError: null,
          draftText: '',
          patchText: EMPTY_PATCH_TEXT,
          submitState: 'idle',
          submitError: null,
          successMessage: null
        };
        changed = true;
      });

      return changed ? next : current;
    });
  }, [snapshot]);

  async function loadEditorDetail(kind: ResourceKind, key: string) {
    if (!selectedGameId || !token) {
      return;
    }

    setEditors((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        detailState: 'loading',
        detailError: null,
        submitError: null,
        successMessage: null
      }
    }));

    try {
      const detail = await fetchResourceDetail(kind, apiBaseUrl, selectedGameId, key, token);
      setEditors((current) => {
        if (current[kind].selectedKey !== key) {
          return current;
        }

        return {
          ...current,
          [kind]: {
            ...current[kind],
            detailState: 'success',
            detailError: null,
            draftText: stringifyJson(detail),
            patchText: EMPTY_PATCH_TEXT,
            submitState: 'idle',
            submitError: null,
            successMessage: null
          }
        };
      });
    } catch (error) {
      setEditors((current) => {
        if (current[kind].selectedKey !== key) {
          return current;
        }

        return {
          ...current,
          [kind]: {
            ...current[kind],
            detailState: 'error',
            detailError: getErrorMessage(error),
            draftText: '',
            submitState: 'idle'
          }
        };
      });
    }
  }

  useEffect(() => {
    if (!selectedGameId || !token || !activeEditor.selectedKey) {
      return;
    }

    void loadEditorDetail(activeResource, activeEditor.selectedKey);
  }, [activeEditor.selectedKey, activeResource, apiBaseUrl, selectedGameId, token]);

  function updateEditorText(field: 'draftText' | 'patchText', value: string) {
    setEditors((current) => ({
      ...current,
      [activeResource]: {
        ...current[activeResource],
        [field]: value,
        submitState: current[activeResource].submitState === 'loading' ? 'loading' : 'idle',
        submitError: null,
        successMessage: null
      }
    }));
  }

  function updateCreateDraft(field: keyof EditorState['createDraft'], value: string) {
    setEditors((current) => ({
      ...current,
      [activeResource]: {
        ...current[activeResource],
        createDraft: {
          ...current[activeResource].createDraft,
          [field]: value
        },
        submitError: null,
        successMessage: null
      }
    }));
  }

  function handleResourceChange(kind: ResourceKind) {
    setActiveResource(kind);
    if (typeof window === 'undefined') {
      return;
    }
    const nextHash = `#/admin/${RESOURCE_HASH_SEGMENTS[kind]}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }

  function handleStartCreate(kind: ResourceKind) {
    setEditors((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        mode: 'create',
        selectedKey: null,
        detailState: 'idle',
        detailError: null,
        draftText: stringifyJson(buildCreatePayload(kind, current[kind].createDraft)),
        patchText: EMPTY_PATCH_TEXT,
        submitState: 'idle',
        submitError: null,
        successMessage: null
      }
    }));
  }

  function handleSwitchToPut(kind: ResourceKind) {
    setEditors((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        mode: 'put',
        submitError: null,
        successMessage: null
      }
    }));
  }

  function handleSwitchToPatch(kind: ResourceKind) {
    setEditors((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        mode: 'patch',
        submitError: null,
        successMessage: null
      }
    }));
  }

  async function handleSave(mode: 'put' | 'patch') {
    if (!selectedGameId || !token || !activeEditor.selectedKey) {
      return;
    }

    setEditors((current) => ({
      ...current,
      [activeResource]: {
        ...current[activeResource],
        submitState: 'loading',
        submitError: null,
        successMessage: null
      }
    }));

    try {
      const payload = parseJsonObject(mode === 'put' ? activeEditor.draftText : activeEditor.patchText, mode.toUpperCase());
      const saved = await saveResource(
        activeResource,
        mode,
        apiBaseUrl,
        selectedGameId,
        activeEditor.selectedKey,
        token,
        payload
      );

      setEditors((current) => ({
        ...current,
        [activeResource]: {
          ...current[activeResource],
          mode,
          detailState: 'success',
          draftText: stringifyJson(saved),
          patchText: EMPTY_PATCH_TEXT,
          submitState: 'success',
          submitError: null,
          successMessage: `${getResourceLabel(activeResource)} ${mode === 'put' ? '编辑保存' : '局部修改'}成功。`
        }
      }));
      setRefreshSeed((value) => value + 1);
    } catch (error) {
      setEditors((current) => ({
        ...current,
        [activeResource]: {
          ...current[activeResource],
          submitState: 'error',
          submitError: getErrorMessage(error),
          successMessage: null
        }
      }));
    }
  }

  async function handleCreate() {
    if (!selectedGameId || !token) {
      return;
    }

    const createKey = resolveCreateKey(activeResource, activeEditor.createDraft);
    if (!createKey) {
      setEditors((current) => ({
        ...current,
        [activeResource]: {
          ...current[activeResource],
          submitState: 'error',
          submitError: '请先填写新记录的关键标识，再执行新增。',
          successMessage: null
        }
      }));
      return;
    }

    setEditors((current) => ({
      ...current,
      [activeResource]: {
        ...current[activeResource],
        submitState: 'loading',
        submitError: null,
        successMessage: null
      }
    }));

    try {
      const payload = parseJsonObject(activeEditor.draftText, 'CREATE PUT');
      const saved = await saveResource(activeResource, 'put', apiBaseUrl, selectedGameId, createKey, token, payload);
      const savedKey = getResourceKey(activeResource, saved);

      setEditors((current) => ({
        ...current,
        [activeResource]: {
          ...current[activeResource],
          mode: 'put',
          selectedKey: savedKey,
          detailState: 'success',
          draftText: stringifyJson(saved),
          patchText: EMPTY_PATCH_TEXT,
          submitState: 'success',
          submitError: null,
          successMessage: `${getResourceLabel(activeResource)} 新增成功。`
        }
      }));
      setRefreshSeed((value) => value + 1);
    } catch (error) {
      setEditors((current) => ({
        ...current,
        [activeResource]: {
          ...current[activeResource],
          submitState: 'error',
          submitError: getErrorMessage(error),
          successMessage: null
        }
      }));
    }
  }

  async function handleCreateVersion() {
    if (!selectedGameId || !token) {
      return;
    }

    setVersionState('loading');
    setVersionError(null);
    setVersionSuccess(null);

    try {
      const result = await createVersion(apiBaseUrl, selectedGameId, token, {
        versionCode: versionCodeDraft.trim(),
        releaseDate: releaseDateDraft.trim() || undefined
      });
      setCreatedVersion(result.data);
      setPublishVersionIdDraft(String(result.data.versionId));
      setVersionState('success');
      setVersionSuccess(`版本 ${result.data.versionCode} 已创建，versionId=${result.data.versionId}。`);
    } catch (error) {
      setVersionState('error');
      setVersionError(getErrorMessage(error));
    }
  }

  async function handlePublishVersion() {
    if (!selectedGameId || !token) {
      return;
    }

    const versionId = Number(publishVersionIdDraft);
    if (!Number.isFinite(versionId) || versionId <= 0) {
      setVersionState('error');
      setVersionError('Publish versionId must be a positive number.');
      setVersionSuccess(null);
      return;
    }

    setVersionState('loading');
    setVersionError(null);
    setVersionSuccess(null);

    try {
      const publishResult = await publishVersion(apiBaseUrl, selectedGameId, versionId, token);
      const currentVersionResult = await getCurrentVersion(apiBaseUrl, selectedGameId);
      const bundleResult = await getBundle(apiBaseUrl, selectedGameId, currentVersionResult.data.versionId);

      setPublishedVersion(publishResult.data);
      setPublishedCurrentVersion(currentVersionResult.data);
      setPublishedBundleMeta(bundleResult.data.meta);
      setVersionState('success');
      setVersionSuccess(`版本 ${publishResult.data.versionCode} 已发布，前端 current + bundle 已刷新。`);
      setRefreshSeed((value) => value + 1);
      onDataPublished?.();
    } catch (error) {
      setVersionState('error');
      setVersionError(getErrorMessage(error));
    }
  }

  const currentSelectedSummary = activeEditor.mode === 'create'
    ? {
        resource: getResourceLabel(activeResource),
        mode: 'create',
        createDraft: activeEditor.createDraft,
        gameId: selectedGameId,
        tokenReady: Boolean(token)
      }
    : activeEditor.selectedKey
      ? {
        resource: getResourceLabel(activeResource),
        mode: activeEditor.mode,
        key: activeEditor.selectedKey,
        gameId: selectedGameId,
        tokenReady: Boolean(token)
      }
      : null;

  return (
    <div className="page-admin page-stack">
      <Panel title="后台入口" kicker="Admin Modules">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            先选定一个资源入口，再继续做 JWT、版本发布和具体记录编辑。公式档案、公式绑定、乘区桶、状态动作规则都支持直接深链打开。
          </Typography.Text>

          <Row gutter={[16, 16]}>
            {RESOURCE_KINDS.map((kind) => (
              <Col xs={24} sm={12} xl={6} key={kind}>
                <Card size="small" hoverable>
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Space align="center" size={8} wrap>
                      <Typography.Title heading={6} style={{ margin: 0 }}>
                        {getResourceLabel(kind)}
                      </Typography.Title>
                      <Tag color={activeResource === kind ? 'arcoblue' : 'gray'}>{getResourceItems(snapshot, kind).length}</Tag>
                    </Space>

                    <Typography.Text type="secondary">{getResourceDescription(kind)}</Typography.Text>

                    <Button long type={activeResource === kind ? 'primary' : 'secondary'} onClick={() => handleResourceChange(kind)}>
                      {activeResource === kind ? '当前入口' : '打开入口'}
                    </Button>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        </Space>
      </Panel>

      <Panel
        title="JWT 与写接口"
        kicker="Admin Access"
        actions={
          <Button onClick={() => setRefreshSeed((value) => value + 1)} type="primary">
            刷新后台快照
          </Button>
        }
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Form layout="vertical">
              <Form.Item label="Admin JWT">
                <Input.TextArea
                  autoSize={{ minRows: 6 }}
                  value={adminToken}
                  onChange={onAdminTokenChange}
                  placeholder="Paste Bearer token here."
                />
              </Form.Item>
            </Form>

            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="当前游戏" value={selectedGameName} hint={selectedGameId ?? 'No game selected'} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="JWT" value={token ? 'Ready' : 'Missing'} hint="Stored in localStorage" />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="Snapshot" value={snapshotState} hint={snapshotError ?? '4 admin resources'} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="Write Surface" value="4" hint="profile / binding / bucket / rule" />
              </Col>
            </Row>

            {snapshotError ? <Alert type="error" content={snapshotError} style={{ marginTop: 16 }} /> : null}
          </Col>

          <Col xs={24} lg={10}>
            <Card size="small">
              <JsonBlock
                value={{
                  selectedGameId,
                  apiBaseUrl,
                  resources: {
                    formulaProfiles: snapshot.formulaProfiles.length,
                    formulaBindings: snapshot.formulaBindings.length,
                    coefficientBuckets: snapshot.coefficientBuckets.length,
                    statusActionControlRules: snapshot.statusActionControlRules.length
                  }
                }}
              />
            </Card>
          </Col>
        </Row>
      </Panel>

      <Panel title="版本控制" kicker="Create And Publish">
        {!selectedGameId ? (
          <EmptyState title="还没有选择 gameId" description="先在顶部切换一个游戏，再创建或发布版本。" />
        ) : !token ? (
          <EmptyState title="还没有可写 JWT" description="填写 Bearer token 后，就可以创建版本并发布。" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <Card size="small" title="Create Version">
                  <Form layout="vertical">
                    <Form.Item label="versionCode">
                      <Input value={versionCodeDraft} onChange={setVersionCodeDraft} placeholder="14.1" />
                    </Form.Item>
                    <Form.Item label="releaseDate (optional)">
                      <Input value={releaseDateDraft} onChange={setReleaseDateDraft} placeholder="2026-03-23" />
                    </Form.Item>
                    <Button type="primary" onClick={() => void handleCreateVersion()} loading={versionState === 'loading'}>
                      创建版本
                    </Button>
                  </Form>
                </Card>
              </Col>

              <Col xs={24} lg={12}>
                <Card size="small" title="Publish Version">
                  <Form layout="vertical">
                    <Form.Item label="versionId">
                      <Input
                        value={publishVersionIdDraft}
                        onChange={setPublishVersionIdDraft}
                        placeholder="Use created versionId or type one manually"
                      />
                    </Form.Item>
                    <Space wrap>
                      <Button type="primary" status="warning" onClick={() => void handlePublishVersion()} loading={versionState === 'loading'}>
                        发布版本
                      </Button>
                      <Button href="#/katarina-mvp">打开 Katarina MVP</Button>
                    </Space>
                  </Form>
                </Card>
              </Col>
            </Row>

            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="Created"
                  value={createdVersion?.versionCode ?? '--'}
                  hint={createdVersion ? `versionId=${createdVersion.versionId}` : 'No version created yet'}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="Published"
                  value={publishedVersion?.versionCode ?? '--'}
                  hint={publishedVersion ? `hash=${publishedVersion.dataHash}` : 'No publish yet'}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="Current"
                  value={publishedCurrentVersion?.versionCode ?? '--'}
                  hint={publishedCurrentVersion ? `versionId=${publishedCurrentVersion.versionId}` : 'Waiting for publish'}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard
                  label="Bundle"
                  value={publishedBundleMeta?.versionCode ?? '--'}
                  hint={publishedBundleMeta?.dataHash ?? 'Current bundle not refreshed yet'}
                />
              </Col>
            </Row>

            {versionError ? <Alert type="error" content={versionError} /> : null}
            {versionSuccess ? <Alert type="success" content={versionSuccess} /> : null}

            {publishedBundleMeta ? (
              <Card size="small">
                <JsonBlock
                  value={{
                    publishedVersion,
                    currentVersion: publishedCurrentVersion,
                    bundleMeta: publishedBundleMeta
                  }}
                />
              </Card>
            ) : null}
          </Space>
        )}
      </Panel>

      <Panel title="核心表编辑器" kicker="Editor Workspace">
        {!selectedGameId ? (
          <EmptyState title="还没有选择 gameId" description="后台编辑器会围绕当前游戏加载核心表。" />
        ) : !token ? (
          <EmptyState title="还没有 Bearer token" description="填写 JWT 后即可读取详情并提交 PUT / PATCH。" />
        ) : (
          <Tabs activeTab={activeResource} onChange={(value) => handleResourceChange(value as ResourceKind)}>
            {RESOURCE_KINDS.map((kind) => {
              const tabColumns = getResourceColumns(kind);
              const tabRows = buildResourceRows(snapshot, kind);
              const tabEditor = editors[kind];

              return (
                <TabPane
                  key={kind}
                  title={
                    <Space size={8}>
                      <span>{getResourceLabel(kind)}</span>
                      <Tag color="arcoblue">{getResourceItems(snapshot, kind).length}</Tag>
                    </Space>
                  }
                >
                  <Row gutter={[16, 16]}>
                    <Col xs={24} xl={10}>
                      <Card size="small" title={`${getResourceLabel(kind)} List`}>
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          <Typography.Text type="secondary">{getResourceDescription(kind)}</Typography.Text>
                          <Table
                            columns={[
                              { title: tabColumns[0], render: (_: unknown, record: ResourceListRow) => record.primary },
                              { title: tabColumns[1], render: (_: unknown, record: ResourceListRow) => record.secondary },
                              { title: tabColumns[2], render: (_: unknown, record: ResourceListRow) => record.tertiary },
                              { title: tabColumns[3], render: (_: unknown, record: ResourceListRow) => record.quaternary },
                              {
                                title: 'Actions',
                                width: 120,
                                render: (_: unknown, record: ResourceListRow) => (
                                  <Button
                                    size="mini"
                                    type={tabEditor.selectedKey === record.key && tabEditor.mode !== 'create' ? 'primary' : 'secondary'}
                                    onClick={() => {
                                      handleResourceChange(kind);
                                      setEditors((current) => ({
                                        ...current,
                                        [kind]: {
                                          ...current[kind],
                                          mode: 'put',
                                          selectedKey: record.key,
                                          detailState: 'idle',
                                          detailError: null,
                                          submitError: null,
                                          successMessage: null
                                        }
                                      }));
                                    }}
                                  >
                                    {tabEditor.selectedKey === record.key && tabEditor.mode !== 'create' ? '当前' : '打开'}
                                  </Button>
                                )
                              }
                            ]}
                            data={tabRows}
                            pagination={false}
                            rowKey="key"
                            scroll={{ x: '100%' }}
                          />
                        </Space>
                      </Card>
                    </Col>

                    <Col xs={24} xl={14}>
                      <Card size="small" title={`${getResourceLabel(kind)} Detail`}>
                        {activeResource !== kind ? null : (
                          <Space direction="vertical" size={16} style={{ width: '100%' }}>
                            <Space align="center" size={12} wrap>
                              <Button
                                type={activeEditor.mode === 'create' ? 'primary' : 'secondary'}
                                onClick={() => handleStartCreate(activeResource)}
                              >
                                新增
                              </Button>
                              <Button
                                type={activeEditor.mode === 'put' && activeEditor.selectedKey ? 'primary' : 'secondary'}
                                disabled={!activeEditor.selectedKey}
                                onClick={() => handleSwitchToPut(activeResource)}
                              >
                                编辑
                              </Button>
                              <Button
                                type={activeEditor.mode === 'patch' && activeEditor.selectedKey ? 'primary' : 'secondary'}
                                disabled={!activeEditor.selectedKey}
                                onClick={() => handleSwitchToPatch(activeResource)}
                              >
                                修改(PATCH)
                              </Button>
                              {activeEditor.selectedKey ? (
                                <>
                                  <Tag color="arcoblue">{activeEditor.selectedKey}</Tag>
                                  <Tag color={activeEditor.detailState === 'success' ? 'green' : 'gray'}>{activeEditor.detailState}</Tag>
                                  <Button size="mini" onClick={() => void loadEditorDetail(activeResource, activeEditor.selectedKey!)}>
                                    重新加载
                                  </Button>
                                </>
                              ) : (
                                <Tag color="gray">新建模式</Tag>
                              )}
                            </Space>

                            {activeEditor.detailError ? <Alert type="error" content={activeEditor.detailError} /> : null}
                            {activeEditor.submitError ? <Alert type="error" content={activeEditor.submitError} /> : null}
                            {activeEditor.successMessage ? <Alert type="success" content={activeEditor.successMessage} /> : null}

                            {activeEditor.mode === 'create' ? (
                              <Form layout="vertical">
                                <Typography.Text type="secondary">
                                  当前后端没有单独的 POST 创建接口，新建会使用你填写的新 key 走 PUT 创建。
                                </Typography.Text>

                                <Row gutter={[12, 12]}>
                                  {getCreateFieldSchema(activeResource).map((fieldConfig) => (
                                    <Col xs={24} md={activeResource === 'formulaBindings' ? 8 : 24} key={fieldConfig.field}>
                                      <Form.Item label={fieldConfig.label}>
                                        <Input
                                          value={activeEditor.createDraft[fieldConfig.field]}
                                          onChange={(value) => updateCreateDraft(fieldConfig.field, value)}
                                          placeholder={fieldConfig.placeholder}
                                        />
                                      </Form.Item>
                                    </Col>
                                  ))}
                                </Row>

                                <Form.Item label="PUT create payload">
                                  <Input.TextArea
                                    autoSize={{ minRows: 14, maxRows: 22 }}
                                    value={activeEditor.draftText}
                                    onChange={(value) => updateEditorText('draftText', value)}
                                    placeholder="New entity JSON"
                                  />
                                </Form.Item>

                                <Space wrap>
                                  <Button onClick={() =>
                                    updateEditorText('draftText', stringifyJson(buildCreatePayload(activeResource, activeEditor.createDraft)))
                                  }>
                                    生成新建草稿
                                  </Button>
                                  <Button type="primary" onClick={() => void handleCreate()} loading={activeEditor.submitState === 'loading'}>
                                    使用 PUT 新增
                                  </Button>
                                </Space>
                              </Form>
                            ) : !activeEditor.selectedKey ? (
                              <EmptyState title="当前没有可编辑记录" description="先从左侧列表选择一条记录，或者直接点击上方“新增”。" />
                            ) : activeEditor.mode === 'patch' ? (
                              <Form layout="vertical">
                                <Form.Item label="PATCH payload">
                                  <Input.TextArea
                                    autoSize={{ minRows: 10, maxRows: 16 }}
                                    value={activeEditor.patchText}
                                    onChange={(value) => updateEditorText('patchText', value)}
                                    placeholder="Partial patch JSON"
                                  />
                                </Form.Item>

                                <Space wrap>
                                  <Button type="primary" onClick={() => void handleSave('patch')} loading={activeEditor.submitState === 'loading'}>
                                    提交修改
                                  </Button>
                                  <Button onClick={() => updateEditorText('patchText', EMPTY_PATCH_TEXT)}>清空 PATCH</Button>
                                </Space>
                              </Form>
                            ) : (
                              <Form layout="vertical">
                                <Form.Item label="PUT payload">
                                  <Input.TextArea
                                    autoSize={{ minRows: 14, maxRows: 22 }}
                                    value={activeEditor.draftText}
                                    onChange={(value) => updateEditorText('draftText', value)}
                                    placeholder="Full entity JSON"
                                  />
                                </Form.Item>
                                <Button type="primary" onClick={() => void handleSave('put')} loading={activeEditor.submitState === 'loading'}>
                                  保存编辑
                                </Button>
                              </Form>
                            )}

                            <Card size="small">
                              <JsonBlock value={currentSelectedSummary} />
                            </Card>
                          </Space>
                        )}
                      </Card>
                    </Col>
                  </Row>
                </TabPane>
              );
            })}
          </Tabs>
        )}
      </Panel>
    </div>
  );
}

async function fetchResourceDetail(
  kind: ResourceKind,
  apiBaseUrl: string,
  gameId: string,
  key: string,
  token: string
): Promise<FormulaProfile | FormulaBinding | CoefficientBucket | StatusActionControlRule> {
  switch (kind) {
    case 'formulaProfiles':
      return (await getFormulaProfile(apiBaseUrl, gameId, key, token)).data;
    case 'formulaBindings': {
      const binding = decodeFormulaBindingKey(key);
      return (await getFormulaBinding(apiBaseUrl, gameId, binding.targetCategory, binding.targetId, binding.bindingKey, token)).data;
    }
    case 'coefficientBuckets':
      return (await getCoefficientBucket(apiBaseUrl, gameId, key, token)).data;
    case 'statusActionControlRules':
      return (await getStatusActionControlRule(apiBaseUrl, gameId, key, token)).data;
  }
}

async function saveResource(
  kind: ResourceKind,
  mode: 'put' | 'patch',
  apiBaseUrl: string,
  gameId: string,
  key: string,
  token: string,
  payload: JsonObject
): Promise<FormulaProfile | FormulaBinding | CoefficientBucket | StatusActionControlRule> {
  switch (kind) {
    case 'formulaProfiles':
      return mode === 'put'
        ? (await putFormulaProfile(apiBaseUrl, gameId, key, token, payload)).data
        : (await patchFormulaProfile(apiBaseUrl, gameId, key, token, payload)).data;
    case 'formulaBindings': {
      const binding = decodeFormulaBindingKey(key);
      return mode === 'put'
        ? (await putFormulaBinding(apiBaseUrl, gameId, binding.targetCategory, binding.targetId, binding.bindingKey, token, payload)).data
        : (await patchFormulaBinding(apiBaseUrl, gameId, binding.targetCategory, binding.targetId, binding.bindingKey, token, payload))
            .data;
    }
    case 'coefficientBuckets':
      return mode === 'put'
        ? (await putCoefficientBucket(apiBaseUrl, gameId, key, token, payload)).data
        : (await patchCoefficientBucket(apiBaseUrl, gameId, key, token, payload)).data;
    case 'statusActionControlRules':
      return mode === 'put'
        ? (await putStatusActionControlRule(apiBaseUrl, gameId, key, token, payload)).data
        : (await patchStatusActionControlRule(apiBaseUrl, gameId, key, token, payload)).data;
  }
}
