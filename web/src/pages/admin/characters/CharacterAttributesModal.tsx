import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
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
  getCharacterAttributes,
  getLevelConfig,
  updateCharacterAttributes
} from '../../../services/characterClient';
import type { Attribute } from '../../../types/attribute';
import type { Character, CharacterLevelValues } from '../../../types/character';
import {
  characterFieldIssues,
  describeAttributeProgression,
  generateIncrementingLevelValues,
  generatePerLevelValues,
  getAttributeGenerationMode,
  isAttributeConfigured,
  normalizeLevelValues,
  removeConfiguredAttribute,
  type AttributeGenerationMode
} from './characterForm';

type CharacterAttributesModalProps = {
  visible: boolean;
  character: Character | null;
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

export function CharacterAttributesModal({
  visible,
  character,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onDirtyChange
}: CharacterAttributesModalProps) {
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [minLevel, setMinLevel] = useState(1);
  const [maxLevel, setMaxLevel] = useState(1);
  const [values, setValues] = useState<CharacterLevelValues>({});
  const [baseline, setBaseline] = useState('');
  const [search, setSearch] = useState('');
  const [onlyConfigured, setOnlyConfigured] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attributeEditorVisible, setAttributeEditorVisible] = useState(false);
  const [editingAttributeKey, setEditingAttributeKey] = useState('');
  const [editingExisting, setEditingExisting] = useState(false);
  const [generationMode, setGenerationMode] = useState<AttributeGenerationMode>('fixed');
  const [generationStart, setGenerationStart] = useState<number | undefined>();
  const [generationIncrement, setGenerationIncrement] = useState<number | undefined>(0);
  const [generationLevelText, setGenerationLevelText] = useState('');
  const [generationError, setGenerationError] = useState<string | null>(null);

  const levels = useMemo(() => Array.from(
    { length: maxLevel - minLevel + 1 },
    (_, index) => minLevel + index
  ), [maxLevel, minLevel]);

  const configuredCount = useMemo(() => attributes.filter((attribute) =>
    isAttributeConfigured(values, attribute.attributeKey, minLevel, maxLevel)
  ).length, [attributes, maxLevel, minLevel, values]);

  const unconfiguredAttributes = useMemo(() => attributes.filter((attribute) =>
    !isAttributeConfigured(values, attribute.attributeKey, minLevel, maxLevel)
  ), [attributes, maxLevel, minLevel, values]);

  const visibleAttributes = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return attributes.filter((attribute) => {
      const configured = isAttributeConfigured(values, attribute.attributeKey, minLevel, maxLevel);
      if (onlyConfigured && !configured) return false;
      return !keyword
        || attribute.name.toLocaleLowerCase().includes(keyword)
        || attribute.attributeKey.toLocaleLowerCase().includes(keyword);
    });
  }, [attributes, maxLevel, minLevel, onlyConfigured, search, values]);

  useEffect(() => {
    if (!visible || !selectedGameId || !character) return;
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
    setAttributeEditorVisible(false);
    onDirtyChange(false);

    void Promise.all([
      getLevelConfig(apiBaseUrl, selectedGameId, token),
      getCharacterAttributes(apiBaseUrl, selectedGameId, character.characterKey, token),
      listAttributes(apiBaseUrl, selectedGameId, token)
    ]).then(([configResult, valuesResult, attributesResult]) => {
      if (cancelled) return;
      const config = configResult.data;
      const normalized = normalizeLevelValues(
        config.minLevel,
        config.maxLevel,
        attributesResult.data.items,
        valuesResult.data.levelValues
      );
      setAttributes(attributesResult.data.items);
      setMinLevel(config.minLevel);
      setMaxLevel(config.maxLevel);
      setValues(normalized);
      setBaseline(JSON.stringify(normalized));
    }).catch((error) => {
      if (!cancelled) setLoadError(getErrorMessage(error));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [adminToken, apiBaseUrl, character, onDirtyChange, selectedGameId, visible]);

  const close = () => {
    if (saving) return;
    onDirtyChange(false);
    onClose();
  };

  const openAttributeEditor = (attribute?: Attribute) => {
    const selected = attribute ?? unconfiguredAttributes[0];
    if (!selected) return;
    const configured = isAttributeConfigured(values, selected.attributeKey, minLevel, maxLevel);
    const start = configured ? values[String(minLevel)]?.[selected.attributeKey] ?? 0 : 0;
    const second = configured && minLevel < maxLevel
      ? values[String(minLevel + 1)]?.[selected.attributeKey]
      : undefined;
    setEditingAttributeKey(selected.attributeKey);
    setEditingExisting(configured);
    setGenerationMode(getAttributeGenerationMode(values, selected.attributeKey, minLevel, maxLevel));
    setGenerationStart(start);
    setGenerationIncrement(second === undefined ? 0 : Number((second - start).toFixed(8)));
    setGenerationLevelText(configured ? levels.map((level) => String(values[String(level)]![selected.attributeKey]!)).join('\n') : '');
    setGenerationError(null);
    setAttributeEditorVisible(true);
  };

  const selectNewAttribute = (attributeKey: string) => {
    setEditingAttributeKey(attributeKey);
    setGenerationMode('fixed');
    setGenerationStart(0);
    setGenerationIncrement(0);
    setGenerationLevelText('');
    setGenerationError(null);
  };

  const applyAttributeEditor = () => {
    const attribute = attributes.find((item) => item.attributeKey === editingAttributeKey);
    if (!attribute) {
      setGenerationError('请选择属性。');
      return;
    }
    let next: CharacterLevelValues;
    if (generationMode === 'levels') {
      const result = generatePerLevelValues(values, attribute, minLevel, maxLevel, generationLevelText);
      if (result.error !== null) {
        setGenerationError(result.error);
        return;
      }
      next = result.levelValues;
    } else {
      const increment = generationMode === 'fixed' ? 0 : generationIncrement;
      if (generationStart === undefined || increment === undefined) {
        setGenerationError('属性数值不能为空。');
        return;
      }
      if (!Number.isFinite(generationStart) || !Number.isFinite(increment)) {
        setGenerationError('属性数值和每级增量必须为有限数。');
        return;
      }
      if (attribute.valueType === 'INTEGER'
        && (!Number.isInteger(generationStart) || !Number.isInteger(increment))) {
        setGenerationError('整数属性的数值和每级增量必须是整数。');
        return;
      }
      next = generateIncrementingLevelValues(values, attribute.attributeKey, minLevel, maxLevel, generationStart, increment);
    }
    for (const level of levels) {
      const value = next[String(level)]?.[attribute.attributeKey] ?? 0;
      if (!Number.isFinite(value)) {
        setGenerationError(`Lv${level} 的数值必须为有限数。`);
        return;
      }
      if ((attribute.minValue !== null && value < attribute.minValue)
        || (attribute.maxValue !== null && value > attribute.maxValue)) {
        setGenerationError(`Lv${level} 的数值超出属性范围。`);
        return;
      }
    }
    setValues(next);
    setRowErrors((current) => {
      const copy = { ...current };
      delete copy[attribute.attributeKey];
      return copy;
    });
    setSaveError(null);
    setAttributeEditorVisible(false);
    onDirtyChange(JSON.stringify(next) !== baseline);
  };

  const removeAttribute = () => {
    const next = removeConfiguredAttribute(values, editingAttributeKey);
    setValues(next);
    setAttributeEditorVisible(false);
    setSaveError(null);
    onDirtyChange(JSON.stringify(next) !== baseline);
  };

  const save = async () => {
    if (!selectedGameId || !character) return;
    const token = adminToken.trim();
    if (!token) {
      setSaveError('请先配置 Admin Token。');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setRowErrors({});
    try {
      const result = await updateCharacterAttributes(
        apiBaseUrl,
        selectedGameId,
        character.characterKey,
        token,
        { levelValues: values }
      );
      const normalized = normalizeLevelValues(minLevel, maxLevel, attributes, result.data.levelValues);
      setValues(normalized);
      setBaseline(JSON.stringify(normalized));
      onDirtyChange(false);
      onSaved();
      onClose();
    } catch (error) {
      const nextErrors: Record<string, string> = {};
      for (const issue of characterFieldIssues(error)) {
        const attributeKey = issue.field.split('/')[3];
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
      title: '属性',
      width: 210,
      fixed: 'left',
      render: (_value, record: Attribute) => (
        <Space direction="vertical" size={2}>
          <Typography.Text bold>{record.name}</Typography.Text>
          <Typography.Text type="secondary">{record.attributeKey}</Typography.Text>
          <Typography.Text type={rowErrors[record.attributeKey] ? 'error' : 'secondary'}>
            {rowErrors[record.attributeKey]
              ?? describeAttributeProgression(values, record.attributeKey, minLevel, maxLevel)}
          </Typography.Text>
        </Space>
      )
    },
    ...levels.map<TableColumnProps>((level) => ({
      title: `Lv${level}`,
      width: 82,
      align: 'center',
      render: (_value, record: Attribute) => {
        const configured = isAttributeConfigured(values, record.attributeKey, minLevel, maxLevel);
        return configured ? formatValue(values[String(level)]![record.attributeKey]!) : '—';
      }
    })),
    {
      title: '操作',
      width: 90,
      fixed: 'right',
      render: (_value, record: Attribute) => {
        const configured = isAttributeConfigured(values, record.attributeKey, minLevel, maxLevel);
        return (
          <Button size="mini" type={configured ? 'secondary' : 'primary'} onClick={() => openAttributeEditor(record)}>
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
        title={character ? `等级属性 - ${character.name}` : '等级属性'}
        visible={visible}
        style={{ width: 'calc(100vw - 48px)', maxWidth: 1280 }}
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
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Input
                    aria-label="搜索属性"
                    value={search}
                    allowClear
                    placeholder="搜索属性..."
                    style={{ width: 240 }}
                    onChange={setSearch}
                  />
                  <Checkbox checked={onlyConfigured} onChange={setOnlyConfigured}>
                    只显示已配置
                  </Checkbox>
                  <Button type="primary" disabled={unconfiguredAttributes.length === 0} onClick={() => openAttributeEditor()}>
                    + 添加属性
                  </Button>
                </div>

                <Table
                  borderCell
                  columns={columns}
                  data={visibleAttributes}
                  pagination={false}
                  rowKey={(record: Attribute) => record.attributeKey}
                  scroll={{ x: 300 + levels.length * 82 }}
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
        visible={attributeEditorVisible}
        maskClosable
        onCancel={() => setAttributeEditorVisible(false)}
        footer={
          <Space>
            {editingExisting ? <Button status="danger" onClick={removeAttribute}>取消配置</Button> : null}
            <Button onClick={() => setAttributeEditorVisible(false)}>取消</Button>
            <Button type="primary" onClick={applyAttributeEditor}>应用</Button>
          </Space>
        }
      >
        <Space direction="vertical" size="medium" style={{ width: '100%' }}>
          {generationError ? <Alert type="error" content={generationError} /> : null}
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
            <Form.Item label="生成方式" required>
              <Radio.Group
                aria-label="属性录入方式"
                type="button"
                value={generationMode}
                onChange={(value) => {
                  setGenerationMode(value === 'levels' ? 'levels' : value === 'increment' ? 'increment' : 'fixed');
                  setGenerationError(null);
                }}
              >
                <Radio value="fixed">固定</Radio>
                <Radio value="increment">每级递增</Radio>
                <Radio value="levels">逐级录入</Radio>
              </Radio.Group>
            </Form.Item>
            {generationMode === 'levels' ? (
              <Form.Item label="各级数值" required extra={`按 Lv${minLevel} 至 Lv${maxLevel} 顺序输入 ${levels.length} 个数值，可用空白、换行或中英文逗号分隔。`}>
                <Input.TextArea
                  aria-label="各级数值"
                  value={generationLevelText}
                  autoSize={{ minRows: 4, maxRows: 12 }}
                  onChange={setGenerationLevelText}
                />
              </Form.Item>
            ) : <Form.Item label={`Lv${minLevel} 数值`} required>
              <InputNumber
                aria-label={`Lv${minLevel} 数值`}
                value={generationStart}
                precision={editingAttribute?.valueType === 'INTEGER' ? 0 : undefined}
                style={{ width: '100%' }}
                onChange={setGenerationStart}
              />
            </Form.Item>}
            {generationMode === 'increment' ? (
              <Form.Item label="每级增量" required>
                <InputNumber
                  aria-label="每级增量"
                  value={generationIncrement}
                  precision={editingAttribute?.valueType === 'INTEGER' ? 0 : undefined}
                  style={{ width: '100%' }}
                  onChange={setGenerationIncrement}
                />
              </Form.Item>
            ) : null}
          </Form>
        </Space>
      </Modal>
    </>
  );
}
