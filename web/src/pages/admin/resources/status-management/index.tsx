import { Alert, Button, Form, Input, Message, Select, Space, Tabs, Tag, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { Panel } from '../../../../components/Panel';
import {
  getControlStateProfiles,
  getErrorMessage,
  getStatusAttributeModifiers,
  getStatusDefinitions,
  getStatusModifierGroups,
  getStatusPeriodicHpEffects,
  putControlStateProfile,
  putStatusAttributeModifier,
  putStatusDefinition,
  putStatusModifierGroup,
  putStatusPeriodicHpEffect
} from '../../../../services/apiClient';
import type {
  ControlStateProfile,
  LoadState,
  StatusAttributeModifier,
  StatusDefinition,
  StatusModifierGroup,
  StatusPeriodicHpEffect
} from '../../../../types/api';
import {
  createControlStateProfileFormData,
  createStatusAttributeModifierFormData,
  createStatusDefinitionFormData,
  createStatusModifierGroupFormData,
  createStatusPeriodicHpEffectFormData,
  EMPTY_STATUS_SNAPSHOT,
  RESOURCE_LABELS,
  RESOURCE_ORDER
} from './constants';
import { StatusResourceModal } from './modal';
import {
  ControlStateProfilesTable,
  StatusAttributeModifiersTable,
  StatusDefinitionsTable,
  StatusModifierGroupsTable,
  StatusPeriodicHpEffectsTable
} from './table';
import type {
  ControlStateProfileFormData,
  CreateFormDataContext,
  OpenRecordModal,
  ResourceConfig,
  StatusAttributeModifierFormData,
  StatusDefinitionFormData,
  StatusModalState,
  StatusModifierGroupFormData,
  StatusPeriodicHpEffectFormData,
  StatusResourceId,
  StatusSnapshot
} from './types';
import {
  buildControlStateProfilePayload,
  buildStatusAttributeModifierPayload,
  buildStatusDefinitionPayload,
  buildStatusModifierGroupPayload,
  buildStatusPeriodicHpEffectPayload,
  toControlStateProfileFormData,
  toStatusAttributeModifierFormData,
  toStatusDefinitionFormData,
  toStatusModifierGroupFormData,
  toStatusPeriodicHpEffectFormData
} from './transforms';

type StatusManagementPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

// 资源配置表：把 create/toForm/buildPayload/save 四类派发逻辑统一为同一种签名，
// 消除 index.tsx 里原本的 5 分支 if-else 分发链。
const RESOURCE_CONFIG: Record<
  StatusResourceId,
  ResourceConfig<unknown, unknown>
> = {
  statusDefinitions: {
    createFormData: (ctx) => createStatusDefinitionFormData(ctx),
    toFormData: (record) => toStatusDefinitionFormData(record as StatusDefinition),
    save: (apiBaseUrl, gameId, token, formData) =>
      putStatusDefinition(apiBaseUrl, gameId, (formData as StatusDefinitionFormData).statusId.trim(), token, buildStatusDefinitionPayload(formData as StatusDefinitionFormData))
  },
  controlStateProfiles: {
    createFormData: () => createControlStateProfileFormData(),
    toFormData: (record) => toControlStateProfileFormData(record as ControlStateProfile),
    save: (apiBaseUrl, gameId, token, formData) =>
      putControlStateProfile(apiBaseUrl, gameId, (formData as ControlStateProfileFormData).controlProfileId.trim(), token, buildControlStateProfilePayload(formData as ControlStateProfileFormData))
  },
  statusModifierGroups: {
    createFormData: (ctx) => createStatusModifierGroupFormData(ctx),
    toFormData: (record) => toStatusModifierGroupFormData(record as StatusModifierGroup),
    save: (apiBaseUrl, gameId, token, formData) => {
      const fd = formData as StatusModifierGroupFormData;
      return putStatusModifierGroup(apiBaseUrl, gameId, fd.statusId.trim(), fd.groupKey.trim(), token, buildStatusModifierGroupPayload(fd));
    }
  },
  statusAttributeModifiers: {
    createFormData: (ctx) => createStatusAttributeModifierFormData(ctx),
    toFormData: (record) => toStatusAttributeModifierFormData(record as StatusAttributeModifier),
    save: (apiBaseUrl, gameId, token, formData) => {
      const fd = formData as StatusAttributeModifierFormData;
      return putStatusAttributeModifier(apiBaseUrl, gameId, fd.statusId.trim(), fd.groupKey.trim(), fd.modifierId.trim(), token, buildStatusAttributeModifierPayload(fd));
    }
  },
  statusPeriodicHpEffects: {
    createFormData: (ctx) => createStatusPeriodicHpEffectFormData(ctx),
    toFormData: (record) => toStatusPeriodicHpEffectFormData(record as StatusPeriodicHpEffect),
    save: (apiBaseUrl, gameId, token, formData) => {
      const fd = formData as StatusPeriodicHpEffectFormData;
      return putStatusPeriodicHpEffect(apiBaseUrl, gameId, fd.statusId.trim(), fd.groupKey.trim(), fd.effectId.trim(), token, buildStatusPeriodicHpEffectPayload(fd));
    }
  }
};

export function StatusManagementPage({ apiBaseUrl, selectedGameId, adminToken }: StatusManagementPageProps) {
  const token = adminToken.trim();
  const actionsDisabled = !selectedGameId || !token;
  const blockerMessage = !selectedGameId
    ? '请先选择当前 gameId。'
    : !token
      ? '请先在顶部会话区域填写 Admin Token。'
      : null;

  const [snapshot, setSnapshot] = useState<StatusSnapshot>(EMPTY_STATUS_SNAPSHOT);
  const [recordsState, setRecordsState] = useState<LoadState>('idle');
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [activeResource, setActiveResource] = useState<StatusResourceId>('statusDefinitions');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');
  const [modal, setModal] = useState<StatusModalState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedGameId || !token) {
      setSnapshot(EMPTY_STATUS_SNAPSHOT);
      setRecordsState('idle');
      setRecordsError(null);
      return;
    }

    let cancelled = false;
    const gameId = selectedGameId;
    setRecordsState('loading');
    setRecordsError(null);

    Promise.all([
      getStatusDefinitions(apiBaseUrl, gameId, token),
      getControlStateProfiles(apiBaseUrl, gameId, token),
      getStatusModifierGroups(apiBaseUrl, gameId, token),
      getStatusAttributeModifiers(apiBaseUrl, gameId, token),
      getStatusPeriodicHpEffects(apiBaseUrl, gameId, token)
    ])
      .then(([definitions, controlProfiles, groups, attributeModifiers, periodicHpEffects]) => {
        if (cancelled) {
          return;
        }
        setSnapshot({
          statusDefinitions: definitions.data.statusDefinitions,
          controlStateProfiles: controlProfiles.data.controlStateProfiles,
          statusModifierGroups: groups.data.statusModifierGroups,
          statusAttributeModifiers: attributeModifiers.data.statusAttributeModifiers,
          statusPeriodicHpEffects: periodicHpEffects.data.statusPeriodicHpEffects
        });
        setRecordsState('success');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSnapshot(EMPTY_STATUS_SNAPSHOT);
        setRecordsState('error');
        setRecordsError(getErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, refreshSeed, selectedGameId, token]);

  const statusOptions = useMemo(
    () =>
      snapshot.statusDefinitions.map((status) => ({
        label: `${status.statusId}${status.name ? ` / ${status.name}` : ''}`,
        value: status.statusId
      })),
    [snapshot.statusDefinitions]
  );

  const groupOptions = useMemo(() => {
    const groups = statusFilter
      ? snapshot.statusModifierGroups.filter((group) => group.statusId === statusFilter)
      : snapshot.statusModifierGroups;
    return groups.map((group) => ({
      label: `${group.statusId} / ${group.groupKey}${group.groupName ? ` / ${group.groupName}` : ''}`,
      value: `${group.statusId}|${group.groupKey}`
    }));
  }, [snapshot.statusModifierGroups, statusFilter]);

  const selectedStatus = useMemo(
    () => snapshot.statusDefinitions.find((status) => status.statusId === statusFilter),
    [snapshot.statusDefinitions, statusFilter]
  );

  function refreshAll() {
    setRefreshSeed((value) => value + 1);
  }

  function updateModalField(field: string, value: string | boolean) {
    setModal((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        formData: {
          ...current.formData,
          [field]: value
        }
      } as StatusModalState;
    });
  }

  function openCreateModal(resourceId: StatusResourceId) {
    const selectedGroup = statusFilter
      ? snapshot.statusModifierGroups.find((group) => group.statusId === statusFilter)
      : snapshot.statusModifierGroups[0];
    const ctx: CreateFormDataContext = { statusFilter, selectedGroup };
    const formData = RESOURCE_CONFIG[resourceId].createFormData(ctx);
    setModal({ resourceId, mode: 'create', formData } as StatusModalState);
  }

  const openRecordModal: OpenRecordModal = (resourceId, mode, record) => {
    const formData = RESOURCE_CONFIG[resourceId].toFormData(record);
    setModal({ resourceId, mode, formData } as StatusModalState);
  };

  async function submitModal() {
    if (!modal || !selectedGameId || !token || modal.mode === 'view') {
      return;
    }

    setSaving(true);
    try {
      await RESOURCE_CONFIG[modal.resourceId].save(apiBaseUrl, selectedGameId, token, modal.formData);
      Message.success(`${RESOURCE_LABELS[modal.resourceId]}保存成功`);
      setModal(null);
      refreshAll();
    } catch (error) {
      Message.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}

      <Panel title="状态管理" kicker="Status">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="crud-toolbar">
            <div className="crud-toolbar-copy">
              <Typography.Title heading={6} style={{ margin: 0 }}>
                统一状态资源工作台
              </Typography.Title>
              <Typography.Text type="secondary">
                写入仍调用拆分后的后端接口；页面按状态、控制语义、效果组和效果明细组合查看。
              </Typography.Text>
            </div>
            <Space>
              <Button onClick={refreshAll} disabled={actionsDisabled} loading={recordsState === 'loading'}>
                刷新
              </Button>
            </Space>
          </div>

          <Space wrap size={12}>
            {RESOURCE_ORDER.map((resourceId) => (
              <Tag key={resourceId} color={activeResource === resourceId ? 'arcoblue' : 'gray'}>
                {RESOURCE_LABELS[resourceId]} {snapshot[resourceId].length}
              </Tag>
            ))}
          </Space>

          <div className="crud-search-form">
            <Form.Item label="状态上下文">
              <Select
                allowClear
                showSearch
                value={statusFilter}
                disabled={actionsDisabled}
                options={statusOptions}
                placeholder="按状态 ID 聚焦相关资源"
                onChange={(value) => setStatusFilter(value ? String(value) : undefined)}
                filterOption={(inputValue, option) => {
                  const optionData = option as { value?: unknown; label?: unknown } | undefined;
                  return `${String(optionData?.value ?? '')} ${String(optionData?.label ?? '')}`
                    .toLowerCase()
                    .includes(inputValue.trim().toLowerCase());
                }}
                style={{ width: 360 }}
              />
            </Form.Item>
            <Form.Item label="快速搜索">
              <Input
                value={searchText}
                onChange={setSearchText}
                placeholder="搜索当前 Tab 的任意字段"
                style={{ width: 320 }}
              />
            </Form.Item>
          </div>
        </Space>
      </Panel>

      <Panel title={RESOURCE_LABELS[activeResource]} kicker="Resources">
        {recordsError ? <Alert type="error" content={recordsError} style={{ marginBottom: 16 }} /> : null}
        <Tabs activeTab={activeResource} onChange={(key) => setActiveResource(key as StatusResourceId)}>
          <Tabs.TabPane key="statusDefinitions" title="状态定义">
            <StatusDefinitionsTable
              snapshot={snapshot}
              statusFilter={statusFilter}
              searchText={searchText}
              recordsState={recordsState}
              actionsDisabled={actionsDisabled}
              onCreate={openCreateModal}
              openRecordModal={openRecordModal}
            />
          </Tabs.TabPane>
          <Tabs.TabPane key="controlStateProfiles" title="控制语义">
            <ControlStateProfilesTable
              snapshot={snapshot}
              selectedStatus={selectedStatus}
              searchText={searchText}
              recordsState={recordsState}
              actionsDisabled={actionsDisabled}
              onCreate={openCreateModal}
              openRecordModal={openRecordModal}
            />
          </Tabs.TabPane>
          <Tabs.TabPane key="statusModifierGroups" title="效果组">
            <StatusModifierGroupsTable
              snapshot={snapshot}
              statusFilter={statusFilter}
              searchText={searchText}
              recordsState={recordsState}
              actionsDisabled={actionsDisabled}
              onCreate={openCreateModal}
              openRecordModal={openRecordModal}
            />
          </Tabs.TabPane>
          <Tabs.TabPane key="statusAttributeModifiers" title="属性修饰">
            <StatusAttributeModifiersTable
              snapshot={snapshot}
              statusFilter={statusFilter}
              searchText={searchText}
              recordsState={recordsState}
              actionsDisabled={actionsDisabled}
              onCreate={openCreateModal}
              openRecordModal={openRecordModal}
            />
          </Tabs.TabPane>
          <Tabs.TabPane key="statusPeriodicHpEffects" title="周期生命效果">
            <StatusPeriodicHpEffectsTable
              snapshot={snapshot}
              statusFilter={statusFilter}
              searchText={searchText}
              recordsState={recordsState}
              actionsDisabled={actionsDisabled}
              onCreate={openCreateModal}
              openRecordModal={openRecordModal}
            />
          </Tabs.TabPane>
        </Tabs>
      </Panel>

      <StatusResourceModal
        snapshot={snapshot}
        groupOptions={groupOptions}
        modal={modal}
        saving={saving}
        onClose={() => setModal(null)}
        onFieldChange={updateModalField}
        onSubmit={submitModal}
      />
    </div>
  );
}
