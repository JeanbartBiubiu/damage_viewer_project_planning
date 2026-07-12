import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Message,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Typography
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../../components/EmptyState';
import { Panel } from '../../../components/Panel';
import { getErrorMessage } from '../../../services/apiClient';
import { formatCombatDataError, putEffectStep } from '../../../services/combatDataClient';
import {
  EffectStepEditor,
  buildEffectStepPutFromEditor,
  createEmptyEffectStepEditorState,
  recordToEffectStepEditorState,
  type EffectStepEditorState
} from './EffectStepEditor';
import {
  createEmptyForm,
  getCombatDataResource,
  getRecordRowKey,
  pickDisplayColumns,
  recordToForm,
  validateResourceForm,
  type FieldDef,
  type ResourceFormValues
} from './resourceRegistry';

type CombatDataResourcePageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  resourceId: string;
  /** True when GET /api/games already succeeded for this API base. */
  gamesReachable?: boolean;
  /**
   * When true, skip the outer Panel title/summary (parent CombatDataPage already shows them).
   * Table actions and modal still render.
   */
  hideHeaderSummary?: boolean;
};

type ModalMode = 'create' | 'edit' | 'view';

function formatCellValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '--';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function ResourceFieldInput({
  field,
  value,
  disabled,
  onChange
}: {
  field: FieldDef;
  value: string | number | boolean;
  disabled: boolean;
  onChange: (next: string | number | boolean) => void;
}) {
  if (field.kind === 'boolean') {
    return <Switch checked={Boolean(value)} disabled={disabled} onChange={(checked) => onChange(checked)} />;
  }

  if (field.kind === 'number') {
    return (
      <InputNumber
        value={value === '' || value === undefined ? undefined : Number(value)}
        disabled={disabled}
        placeholder={field.placeholder}
        onChange={(next) => onChange(next ?? '')}
        style={{ width: '100%' }}
      />
    );
  }

  if (field.kind === 'select') {
    return (
      <Select
        value={value === '' ? undefined : String(value)}
        disabled={disabled}
        placeholder={field.placeholder}
        options={field.options}
        allowClear={!field.required}
        onChange={(next) => onChange(next ?? '')}
      />
    );
  }

  if (field.kind === 'json' || field.kind === 'textarea') {
    return (
      <Input.TextArea
        value={String(value ?? '')}
        disabled={disabled}
        placeholder={field.placeholder}
        autoSize={{ minRows: field.kind === 'json' ? 4 : 3, maxRows: 10 }}
        onChange={(next) => onChange(next)}
      />
    );
  }

  return (
    <Input
      value={String(value ?? '')}
      disabled={disabled}
      placeholder={field.placeholder}
      onChange={(next) => onChange(next)}
    />
  );
}

export function CombatDataResourcePage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  resourceId,
  gamesReachable = false,
  hideHeaderSummary = false
}: CombatDataResourcePageProps) {
  const config = getCombatDataResource(resourceId);
  const token = adminToken.trim();
  const saveDisabled = !selectedGameId || !token;
  const listDisabled = !selectedGameId;
  const isEffectStep = config?.kind === 'effect-step';
  const isSingleton = config?.kind === 'singleton';

  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [listRevision, setListRevision] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [form, setForm] = useState<ResourceFormValues>({});
  const [effectState, setEffectState] = useState<EffectStepEditorState>(createEmptyEffectStepEditorState());
  const [saving, setSaving] = useState(false);

  const refreshList = useCallback(async () => {
    if (!config || !selectedGameId) {
      setRecords([]);
      setListRevision(undefined);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await config.list(apiBaseUrl, selectedGameId);
      setRecords(Array.isArray(result.records) ? result.records : []);
      setListRevision(result.currentRevision);
    } catch (err) {
      setRecords([]);
      setError(
        formatCombatDataError(err, 'contract-entry', {
          apiBaseUrl,
          gamesReachable
        })
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, config, gamesReachable, selectedGameId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const openCreate = useCallback(() => {
    if (!config) {
      return;
    }
    setModalMode('create');
    if (config.kind === 'effect-step') {
      setEffectState(createEmptyEffectStepEditorState());
    } else if (config.kind === 'singleton' && records[0]) {
      setForm(recordToForm(records[0], config.fields));
    } else {
      setForm(createEmptyForm(config.fields));
    }
    setModalVisible(true);
  }, [config, records]);

  const openEdit = useCallback(
    (record: Record<string, unknown>) => {
      if (!config) {
        return;
      }
      setModalMode('edit');
      if (config.kind === 'effect-step') {
        setEffectState(recordToEffectStepEditorState(record));
      } else {
        setForm(recordToForm(record, config.fields));
      }
      setModalVisible(true);
    },
    [config]
  );

  const openView = useCallback(
    (record: Record<string, unknown>) => {
      if (!config) {
        return;
      }
      setModalMode('view');
      if (config.kind === 'effect-step') {
        setEffectState(recordToEffectStepEditorState(record));
      } else {
        setForm(recordToForm(record, config.fields));
      }
      setModalVisible(true);
    },
    [config]
  );

  const columns = useMemo<TableColumnProps[]>(() => {
    if (!config) {
      return [];
    }
    const displayFields = pickDisplayColumns(config.fields, config.pathKeys);
    const cols: TableColumnProps[] = displayFields.map((field) => ({
      title: field.label,
      dataIndex: field.name,
      width: 160,
      render: (value: unknown) => formatCellValue(value)
    }));
    cols.push({
      title: '操作',
      width: 160,
      fixed: 'right',
      render: (_: unknown, record: Record<string, unknown>) => (
        <Space>
          <Button size="mini" onClick={() => openView(record)}>
            查看
          </Button>
          <Button size="mini" type="primary" disabled={saveDisabled} onClick={() => openEdit(record)}>
            编辑
          </Button>
        </Space>
      )
    });
    return cols;
  }, [config, openEdit, openView, saveDisabled]);

  const submitModal = async () => {
    if (!config) {
      return;
    }
    if (!selectedGameId) {
      Message.warning('请先选择当前 gameId。');
      return;
    }
    if (!token) {
      Message.warning('请先在顶部会话区域填写 Admin Token。');
      return;
    }

    try {
      setSaving(true);

      if (config.kind === 'effect-step') {
        const body = buildEffectStepPutFromEditor(effectState);
        const stepId = String(effectState.common.stepId ?? '').trim();
        const result = await putEffectStep(apiBaseUrl, selectedGameId, stepId, token, body);
        Message.success(`保存成功，currentRevision=${result.data.currentRevision}`);
      } else {
        const validationError = validateResourceForm(config, form);
        if (validationError) {
          Message.error(validationError);
          return;
        }
        const result = await config.put(apiBaseUrl, selectedGameId, token, form);
        Message.success(`保存成功，currentRevision=${result.currentRevision}`);
      }

      setModalVisible(false);
      await refreshList();
    } catch (err) {
      Message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return <Alert type="error" content={`未知资源：${resourceId}`} />;
  }

  const readOnly = modalMode === 'view';
  const lockPathKeys = modalMode !== 'create';
  const blockerMessage = !selectedGameId
    ? '请先选择当前 gameId。'
    : !token
      ? '填写 Admin Token 后可保存；列表可在无 Token 时通过公开 GET 加载。'
      : null;

  const listActions = (
    <Space>
      <Button onClick={() => void refreshList()} disabled={listDisabled} loading={loading}>
        刷新
      </Button>
      <Button type="primary" onClick={openCreate} disabled={saveDisabled}>
        {isSingleton ? '写入 / 覆盖' : '新增'}
      </Button>
    </Space>
  );

  const table = (
    <Table
      className="data-table-shell"
      loading={loading}
      columns={columns}
      data={records}
      pagination={false}
      rowKey={(record: Record<string, unknown>) => getRecordRowKey(record, config.pathKeys, 0)}
      scroll={{ x: Math.max(960, columns.length * 160) }}
      noDataElement={
        <EmptyState title={`暂无${config.label}`} description="列表为空时可直接新增；公开 GET 无数据时不会崩溃。" />
      }
    />
  );

  return (
    <div className="page-admin-resource page-stack">
      {blockerMessage ? <Alert type="warning" content={blockerMessage} className="resource-warning-alert" /> : null}
      {error ? <Alert type="error" content={error} className="resource-warning-alert" /> : null}

      {hideHeaderSummary ? (
        <Panel title="资源列表" kicker="Public GET / Admin PUT" actions={listActions}>
          {listRevision !== undefined ? (
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              列表 envelope currentRevision={listRevision}
            </Typography.Text>
          ) : null}
          {table}
        </Panel>
      ) : (
        <Panel title={config.label} kicker="Combat Data" actions={listActions}>
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            {config.summary}
            {listRevision !== undefined ? ` · 列表 envelope currentRevision=${listRevision}` : null}
          </Typography.Paragraph>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
            后端基础约束（结构/非空） vs 当前 Wasm 能力校验（组装时）
          </Typography.Text>
          {table}
        </Panel>
      )}

      <Modal
        title={
          modalMode === 'create'
            ? `新增 ${config.label}`
            : modalMode === 'edit'
              ? `编辑 ${config.label}`
              : `查看 ${config.label}`
        }
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setModalVisible(false)}>{readOnly ? '关闭' : '取消'}</Button>
            {!readOnly ? (
              <Button type="primary" loading={saving} disabled={saveDisabled} onClick={() => void submitModal()}>
                保存
              </Button>
            ) : null}
          </Space>
        }
        autoFocus={false}
        focusLock
        style={{ width: '90vw', maxWidth: 880 }}
      >
        {isEffectStep ? (
          <EffectStepEditor
            value={effectState}
            readOnly={readOnly}
            lockPathKeys={lockPathKeys}
            onChange={setEffectState}
          />
        ) : (
          <Form layout="vertical">
            {config.fields.map((field) => {
              const locked = lockPathKeys && (field.lockedOnEdit || config.pathKeys.includes(field.name));
              return (
                <Form.Item key={field.name} label={field.label} required={field.required} extra={field.helper}>
                  <ResourceFieldInput
                    field={field}
                    value={form[field.name] ?? (field.kind === 'boolean' ? false : '')}
                    disabled={readOnly || locked}
                    onChange={(next) => setForm((prev) => ({ ...prev, [field.name]: next }))}
                  />
                </Form.Item>
              );
            })}
          </Form>
        )}
      </Modal>
    </div>
  );
}
