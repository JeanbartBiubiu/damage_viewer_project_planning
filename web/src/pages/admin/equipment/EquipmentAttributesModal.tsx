import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Typography
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { listAttributes } from '../../../services/attributeClient';
import {
  getEquipmentAttributes,
  updateEquipmentAttributes
} from '../../../services/equipmentClient';
import type { Attribute } from '../../../types/attribute';
import type { Equipment, EquipmentAttributeValues } from '../../../types/equipment';
import {
  equipmentFieldIssues,
  isEquipmentAttributeConfigured,
  normalizeEquipmentAttributeValues,
  removeEquipmentAttribute
} from './equipmentForm';

type EquipmentAttributesModalProps = {
  visible: boolean;
  equipment: Equipment | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(8)));
}

export function EquipmentAttributesModal({
  visible,
  equipment,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onDirtyChange
}: EquipmentAttributesModalProps) {
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [values, setValues] = useState<EquipmentAttributeValues>({});
  const [baseline, setBaseline] = useState('');
  const [search, setSearch] = useState('');
  const [onlyConfigured, setOnlyConfigured] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingAttributeKey, setEditingAttributeKey] = useState('');
  const [editingExisting, setEditingExisting] = useState(false);
  const [editingValue, setEditingValue] = useState<number | undefined>();
  const [editingError, setEditingError] = useState<string | null>(null);

  const configuredCount = useMemo(() => attributes.filter((attribute) =>
    isEquipmentAttributeConfigured(values, attribute.attributeKey)
  ).length, [attributes, values]);

  const unconfiguredAttributes = useMemo(() => attributes.filter((attribute) =>
    !isEquipmentAttributeConfigured(values, attribute.attributeKey)
  ), [attributes, values]);

  const visibleAttributes = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return attributes.filter((attribute) => {
      const configured = isEquipmentAttributeConfigured(values, attribute.attributeKey);
      if (onlyConfigured && !configured) return false;
      return !keyword
        || attribute.name.toLocaleLowerCase().includes(keyword)
        || attribute.attributeKey.toLocaleLowerCase().includes(keyword);
    });
  }, [attributes, onlyConfigured, search, values]);

  useEffect(() => {
    if (!visible || !selectedGameId || !equipment) return;
    const token = adminToken.trim();
    if (!token) {
      setLoadError('请先配置 Admin Token。');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setRowErrors({});
    setSearch('');
    setOnlyConfigured(false);
    setEditorVisible(false);
    onDirtyChange(false);

    void Promise.all([
      getEquipmentAttributes(apiBaseUrl, selectedGameId, equipment.equipmentKey, token),
      listAttributes(apiBaseUrl, selectedGameId, token)
    ]).then(([valuesResult, attributesResult]) => {
      if (cancelled) return;
      const normalized = normalizeEquipmentAttributeValues(
        attributesResult.data.items,
        valuesResult.data.attributeValues
      );
      setAttributes(attributesResult.data.items);
      setValues(normalized);
      setBaseline(JSON.stringify(normalized));
    }).catch((error) => {
      if (!cancelled) setLoadError(getErrorMessage(error));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [adminToken, apiBaseUrl, equipment, onDirtyChange, selectedGameId, visible]);

  const close = () => {
    if (saving) return;
    onDirtyChange(false);
    onClose();
  };

  const openEditor = (attribute?: Attribute) => {
    const selected = attribute ?? unconfiguredAttributes[0];
    if (!selected) return;
    const configured = isEquipmentAttributeConfigured(values, selected.attributeKey);
    setEditingAttributeKey(selected.attributeKey);
    setEditingExisting(configured);
    setEditingValue(configured ? values[selected.attributeKey] : 0);
    setEditingError(null);
    setEditorVisible(true);
  };

  const selectNewAttribute = (attributeKey: string) => {
    setEditingAttributeKey(attributeKey);
    setEditingValue(0);
    setEditingError(null);
  };

  const applyEditor = () => {
    const attribute = attributes.find((item) => item.attributeKey === editingAttributeKey);
    if (!attribute || editingValue === undefined) {
      setEditingError('属性数值不能为空。');
      return;
    }
    if (attribute.valueType === 'INTEGER' && !Number.isInteger(editingValue)) {
      setEditingError('该属性只允许整数。');
      return;
    }
    if ((attribute.minValue !== null && editingValue < attribute.minValue)
      || (attribute.maxValue !== null && editingValue > attribute.maxValue)) {
      setEditingError('属性数值超出允许范围。');
      return;
    }
    const next = { ...values, [attribute.attributeKey]: Number(editingValue.toFixed(8)) };
    setValues(next);
    setRowErrors((current) => {
      const copy = { ...current };
      delete copy[attribute.attributeKey];
      return copy;
    });
    setSaveError(null);
    setEditorVisible(false);
    onDirtyChange(JSON.stringify(next) !== baseline);
  };

  const removeAttribute = () => {
    const next = removeEquipmentAttribute(values, editingAttributeKey);
    setValues(next);
    setEditorVisible(false);
    setSaveError(null);
    onDirtyChange(JSON.stringify(next) !== baseline);
  };

  const save = async () => {
    if (!selectedGameId || !equipment) return;
    const token = adminToken.trim();
    if (!token) {
      setSaveError('请先配置 Admin Token。');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setRowErrors({});
    try {
      const result = await updateEquipmentAttributes(
        apiBaseUrl,
        selectedGameId,
        equipment.equipmentKey,
        token,
        { attributeValues: values }
      );
      const normalized = normalizeEquipmentAttributeValues(attributes, result.data.attributeValues);
      setValues(normalized);
      setBaseline(JSON.stringify(normalized));
      onDirtyChange(false);
      onSaved();
      onClose();
    } catch (error) {
      const nextErrors: Record<string, string> = {};
      for (const issue of equipmentFieldIssues(error)) {
        const attributeKey = issue.field.split('/')[2];
        if (attributeKey) nextErrors[attributeKey] = issue.message;
      }
      setRowErrors(nextErrors);
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumnProps[] = [
    {
      title: '属性名称',
      render: (_value, record: Attribute) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{record.name}</Typography.Text>
          <Typography.Text type="secondary">{record.attributeKey}</Typography.Text>
          {rowErrors[record.attributeKey] ? <Typography.Text type="error">{rowErrors[record.attributeKey]}</Typography.Text> : null}
        </Space>
      )
    },
    {
      title: '数值',
      width: 180,
      render: (_value, record: Attribute) => isEquipmentAttributeConfigured(values, record.attributeKey)
        ? formatValue(values[record.attributeKey]!)
        : '—'
    },
    {
      title: '操作',
      width: 90,
      render: (_value, record: Attribute) => {
        const configured = isEquipmentAttributeConfigured(values, record.attributeKey);
        return (
          <Button size="mini" type={configured ? 'secondary' : 'primary'} onClick={() => openEditor(record)}>
            {configured ? '编辑' : '设置'}
          </Button>
        );
      }
    }
  ];

  const editingAttribute = attributes.find((item) => item.attributeKey === editingAttributeKey);

  return (
    <>
      <Modal
        title={equipment ? `装备属性 - ${equipment.name}` : '装备属性'}
        visible={visible}
        maskClosable
        onCancel={close}
        footer={
          <Space>
            <Button onClick={close} disabled={saving}>取消</Button>
            <Button type="primary" loading={saving} disabled={loading || Boolean(loadError)} onClick={() => void save()}>
              保存
            </Button>
          </Space>
        }
      >
        <Spin loading={loading} style={{ width: '100%' }}>
          <Space direction="vertical" size="medium" style={{ width: '100%' }}>
            {loadError ? <Alert type="error" content={loadError} /> : null}
            {saveError ? <Alert type="error" content={saveError} /> : null}
            {!loadError ? (
              <>
                <Space wrap>
                  <Input
                    aria-label="搜索属性"
                    value={search}
                    allowClear
                    placeholder="搜索属性..."
                    onChange={setSearch}
                  />
                  <Checkbox checked={onlyConfigured} onChange={setOnlyConfigured}>只显示已配置</Checkbox>
                  <Button type="primary" disabled={unconfiguredAttributes.length === 0} onClick={() => openEditor()}>
                    + 添加属性
                  </Button>
                </Space>
                <Table
                  borderCell
                  columns={columns}
                  data={visibleAttributes}
                  pagination={false}
                  rowKey={(record: Attribute) => record.attributeKey}
                />
                <Typography.Text type="secondary">
                  {configuredCount} 个属性已配置 / {attributes.length - configuredCount} 个属性未配置
                </Typography.Text>
              </>
            ) : null}
          </Space>
        </Spin>
      </Modal>

      <Modal
        title={`${editingExisting ? '编辑' : '设置'}属性${editingAttribute ? ` - ${editingAttribute.name}` : ''}`}
        visible={editorVisible}
        maskClosable
        onCancel={() => setEditorVisible(false)}
        footer={
          <Space>
            {editingExisting ? <Button status="danger" onClick={removeAttribute}>取消配置</Button> : null}
            <Button onClick={() => setEditorVisible(false)}>取消</Button>
            <Button type="primary" onClick={applyEditor}>应用</Button>
          </Space>
        }
      >
        <Space direction="vertical" size="medium" style={{ width: '100%' }}>
          {editingError ? <Alert type="error" content={editingError} /> : null}
          <Form layout="vertical">
            <Form.Item label="属性" required>
              <Select
                aria-label="设置属性"
                value={editingAttributeKey}
                disabled={editingExisting}
                options={(editingExisting ? attributes : unconfiguredAttributes).map((attribute) => ({
                  label: `${attribute.name} (${attribute.attributeKey})`,
                  value: attribute.attributeKey
                }))}
                onChange={selectNewAttribute}
              />
            </Form.Item>
            <Form.Item label="数值" required>
              <InputNumber
                aria-label="属性数值"
                value={editingValue}
                precision={editingAttribute?.valueType === 'INTEGER' ? 0 : undefined}
                style={{ width: '100%' }}
                onChange={setEditingValue}
              />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </>
  );
}
