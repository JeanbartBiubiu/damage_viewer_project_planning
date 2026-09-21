import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Space,
  Typography
} from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  createSkillParameter,
  updateSkillParameter
} from '../../../services/skillParameterClient';
import type {
  SkillParameter,
  SkillParameterValueMode,
  SkillParameterValueType
} from '../../../types/skillParameter';
import {
  applyValueModeReset,
  applyPastedLevelValues,
  buildCreateParameterRequest,
  buildUpdateParameterRequest,
  createEmptyParameterDraft,
  fillArithmeticLevelValues,
  fillFixedLevelValues,
  mapParameterFieldIssues,
  parameterToDraft,
  validateParameterDraft,
  type LevelRange,
  type SkillParameterDraft,
  type SkillParameterDraftErrors
} from './parameterForm';

export type SkillParameterEditorMode = 'create' | 'view' | 'edit';

type SkillParameterEditorModalProps = {
  visible: boolean;
  mode: SkillParameterEditorMode;
  parameter: SkillParameter | null;
  skillMaxLevel: number;
  characterLevelRange: LevelRange | null;
  characterLevelUnavailableMessage?: string;
  apiBaseUrl: string;
  selectedGameId: string;
  skillKey: string;
  adminToken: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onSkillMissing: () => void;
};

function titleFor(mode: SkillParameterEditorMode): string {
  if (mode === 'create') return '新增参数';
  if (mode === 'edit') return '编辑参数';
  return '查看参数';
}

export function SkillParameterEditorModal({
  visible,
  mode,
  parameter,
  skillMaxLevel,
  characterLevelRange,
  characterLevelUnavailableMessage = '请先设置游戏等级范围',
  apiBaseUrl,
  selectedGameId,
  skillKey,
  adminToken,
  onClose,
  onSaved,
  onSkillMissing
}: SkillParameterEditorModalProps) {
  const skillLevelRange = useMemo<LevelRange>(
    () => ({ minLevel: 1, maxLevel: skillMaxLevel }),
    [skillMaxLevel]
  );
  const initial = useMemo(() => {
    if (parameter) {
      const range = parameter.valueMode === 'CHARACTER_LEVEL'
        ? characterLevelRange
        : parameter.valueMode === 'SKILL_LEVEL'
          ? skillLevelRange
          : null;
      return parameterToDraft(parameter, range);
    }
    return createEmptyParameterDraft('FIXED', skillLevelRange);
  }, [characterLevelRange, parameter, skillLevelRange]);

  const [draft, setDraft] = useState<SkillParameterDraft>(initial);
  const [errors, setErrors] = useState<SkillParameterDraftErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fillValue, setFillValue] = useState<number | undefined>(0);
  const [arithStart, setArithStart] = useState<number | undefined>(0);
  const [arithStep, setArithStep] = useState<number | undefined>(0);
  const [bulkLevelText, setBulkLevelText] = useState('');
  const [bulkLevelError, setBulkLevelError] = useState<string | null>(null);
  const readOnly = mode === 'view';

  const activeLevelRange = draft.valueMode === 'SKILL_LEVEL'
    ? skillLevelRange
    : draft.valueMode === 'CHARACTER_LEVEL'
      ? characterLevelRange
      : null;

  useEffect(() => {
    if (!visible) return;
    setDraft(initial);
    setErrors({});
    setSaveError(null);
    setSaving(false);
    setFillValue(0);
    setArithStart(0);
    setArithStep(0);
    setBulkLevelText('');
    setBulkLevelError(null);
  }, [initial, mode, visible]);

  const patchDraft = <K extends keyof SkillParameterDraft>(
    field: K,
    value: SkillParameterDraft[K]
  ) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError(null);
  };

  const changeValueMode = (nextMode: SkillParameterValueMode) => {
    if (nextMode === draft.valueMode) return;
    const range = nextMode === 'SKILL_LEVEL'
      ? skillLevelRange
      : nextMode === 'CHARACTER_LEVEL'
        ? characterLevelRange
        : null;
    setDraft((current) => applyValueModeReset(current, nextMode, range));
    setErrors({});
    setSaveError(null);
    setBulkLevelText('');
    setBulkLevelError(null);
  };

  const changeValueType = (nextType: SkillParameterValueType) => {
    patchDraft('valueType', nextType);
    setErrors((current) => ({ ...current, levelValues: undefined }));
    if (!bulkLevelText.trim() || !activeLevelRange) {
      setBulkLevelError(null);
      return;
    }
    const result = applyPastedLevelValues(
      draft.levelValues,
      bulkLevelText,
      activeLevelRange.minLevel,
      activeLevelRange.maxLevel,
      nextType
    );
    setBulkLevelError(result.ok ? null : result.message);
  };

  const close = () => {
    if (saving) return;
    onClose();
  };

  const applyFixedFill = () => {
    if (!activeLevelRange || fillValue === undefined) return;
    patchDraft(
      'levelValues',
      fillFixedLevelValues(activeLevelRange.minLevel, activeLevelRange.maxLevel, fillValue)
    );
  };

  const applyArithmeticFill = () => {
    if (!activeLevelRange || arithStart === undefined || arithStep === undefined) return;
    patchDraft(
      'levelValues',
      fillArithmeticLevelValues(
        activeLevelRange.minLevel,
        activeLevelRange.maxLevel,
        arithStart,
        arithStep
      )
    );
  };

  const applyBulkLevelValues = () => {
    if (!activeLevelRange) return;
    const result = applyPastedLevelValues(
      draft.levelValues,
      bulkLevelText,
      activeLevelRange.minLevel,
      activeLevelRange.maxLevel,
      draft.valueType
    );
    if (!result.ok) {
      setErrors((current) => ({ ...current, levelValues: undefined }));
      setBulkLevelError(result.message);
      return;
    }
    patchDraft('levelValues', result.levelValues);
    setBulkLevelText('');
    setBulkLevelError(null);
  };

  const save = async () => {
    if (bulkLevelText.trim()) {
      if (!bulkLevelError) {
        setBulkLevelError('已填写整列等级数值但尚未应用，请先点击“应用整列数值”。');
      }
      setSaveError(null);
      return;
    }
    const rangeForValidation = draft.valueMode === 'SKILL_LEVEL'
      ? skillLevelRange
      : draft.valueMode === 'CHARACTER_LEVEL'
        ? characterLevelRange
        : null;
    const validation = validateParameterDraft(draft, mode === 'create', rangeForValidation);
    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setSaveError('请先配置 Admin Token。');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'create') {
        await createSkillParameter(
          apiBaseUrl,
          selectedGameId,
          skillKey,
          token,
          buildCreateParameterRequest(validation.normalized)
        );
      } else {
        await updateSkillParameter(
          apiBaseUrl,
          selectedGameId,
          skillKey,
          parameter!.parameterKey,
          token,
          buildUpdateParameterRequest(validation.normalized)
        );
      }
      await onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND') {
        onSkillMissing();
        return;
      }
      if (error instanceof ApiRequestError && error.code === '409.LEVEL_CONFIG_REQUIRED') {
        setSaveError('请先设置游戏等级范围');
        return;
      }
      const mapped = mapParameterFieldIssues(error);
      setErrors(mapped.fieldErrors);
      if (mapped.unmappedMessages.length > 0) {
        setSaveError([getErrorMessage(error), ...mapped.unmappedMessages].join('；'));
      } else {
        setSaveError(getErrorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const levels = activeLevelRange
    ? Array.from(
      { length: activeLevelRange.maxLevel - activeLevelRange.minLevel + 1 },
      (_, index) => activeLevelRange.minLevel + index
    )
    : [];
  const levelValuesError = errors.levelValues ?? bulkLevelError;

  return (
    <Modal
      title={titleFor(mode)}
      visible={visible}
      maskClosable
      onCancel={close}
      style={{ width: 720 }}
      footer={
        <Space>
          <Button onClick={close} disabled={saving}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button type="primary" loading={saving} onClick={() => void save()}>保存</Button>
          ) : null}
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {saveError ? <Alert type="error" content={saveError} /> : null}
        <Form layout="vertical">
          <Form.Item
            label="稳定标识"
            required
            validateStatus={errors.parameterKey ? 'error' : undefined}
            help={errors.parameterKey}
          >
            <Input
              aria-label="稳定标识"
              value={draft.parameterKey}
              disabled={readOnly || mode !== 'create' || saving}
              maxLength={64}
              onChange={(value) => patchDraft('parameterKey', value)}
            />
          </Form.Item>
          <Form.Item
            label="参数名称"
            required
            validateStatus={errors.name ? 'error' : undefined}
            help={errors.name}
          >
            <Input
              aria-label="参数名称"
              value={draft.name}
              disabled={readOnly || saving}
              maxLength={100}
              onChange={(value) => patchDraft('name', value)}
            />
          </Form.Item>
          <Form.Item
            label="数值类型"
            required
            validateStatus={errors.valueType ? 'error' : undefined}
            help={errors.valueType}
          >
            <Radio.Group
              aria-label="数值类型"
              value={draft.valueType}
              disabled={readOnly || saving}
              onChange={(value) => changeValueType(value as SkillParameterValueType)}
            >
              <Radio value="INTEGER">整数</Radio>
              <Radio value="DECIMAL">小数</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label="取值方式"
            required
            validateStatus={errors.valueMode ? 'error' : undefined}
            help={errors.valueMode}
          >
            <Radio.Group
              aria-label="取值方式"
              value={draft.valueMode}
              disabled={readOnly || saving}
              onChange={(value) => changeValueMode(value as SkillParameterValueMode)}
            >
              <Radio value="FIXED">固定值</Radio>
              <Radio value="SKILL_LEVEL">按技能等级</Radio>
              <Radio value="CHARACTER_LEVEL" disabled={readOnly || saving || !characterLevelRange}>
                按角色等级
              </Radio>
              <Radio value="RUNTIME_INPUT">计算时传入</Radio>
            </Radio.Group>
            {!characterLevelRange ? (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                {characterLevelUnavailableMessage}
              </Typography.Text>
            ) : null}
          </Form.Item>

          {draft.valueMode === 'FIXED' ? (
            <Form.Item
              label="固定值"
              required
              validateStatus={errors.fixedValue ? 'error' : undefined}
              help={errors.fixedValue}
            >
              <InputNumber
                aria-label="固定值"
                value={draft.fixedValue.trim() ? Number(draft.fixedValue) : undefined}
                disabled={readOnly || saving}
                style={{ width: '100%' }}
                onChange={(value) => patchDraft('fixedValue', value === undefined ? '' : String(value))}
              />
            </Form.Item>
          ) : null}

          {draft.valueMode === 'SKILL_LEVEL' || draft.valueMode === 'CHARACTER_LEVEL' ? (
            <Form.Item
              label="等级数值"
              required
              validateStatus={levelValuesError ? 'error' : undefined}
              help={levelValuesError}
            >
              {!activeLevelRange ? (
                <Alert type="error" content={characterLevelUnavailableMessage} />
              ) : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {!readOnly ? (
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Typography.Text type="secondary">
                        按 Lv{activeLevelRange.minLevel}～Lv{activeLevelRange.maxLevel} 顺序输入 {levels.length} 个数值，应用后再保存。
                      </Typography.Text>
                      <Input.TextArea
                        aria-label="整列等级数值"
                        value={bulkLevelText}
                        disabled={saving}
                        placeholder="按当前等级从低到高粘贴，使用换行、制表符或逗号分隔"
                        autoSize={{ minRows: 2, maxRows: 6 }}
                        onChange={(value) => {
                          setBulkLevelText(value);
                          setBulkLevelError(null);
                          setErrors((current) => ({ ...current, levelValues: undefined }));
                          setSaveError(null);
                        }}
                      />
                      <Button onClick={applyBulkLevelValues} disabled={saving}>应用整列数值</Button>
                      <Space wrap>
                        <InputNumber
                          aria-label="固定填充值"
                          value={fillValue}
                          disabled={saving}
                          onChange={setFillValue}
                        />
                        <Button onClick={applyFixedFill} disabled={saving}>固定填充</Button>
                        <InputNumber
                          aria-label="等差起始值"
                          value={arithStart}
                          disabled={saving}
                          onChange={setArithStart}
                        />
                        <InputNumber
                          aria-label="每级增加值"
                          value={arithStep}
                          disabled={saving}
                          onChange={setArithStep}
                        />
                        <Button onClick={applyArithmeticFill} disabled={saving}>等差递增</Button>
                      </Space>
                    </Space>
                  ) : null}
                  <div style={{ overflowX: 'auto' }}>
                    <Space wrap size="medium">
                      {levels.map((level) => (
                        <label
                          key={level}
                          style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 88 }}
                        >
                          <span>Lv{level}</span>
                          <InputNumber
                            aria-label={`等级${level}数值`}
                            value={draft.levelValues[String(level)]?.trim()
                              ? Number(draft.levelValues[String(level)])
                              : undefined}
                            disabled={readOnly || saving}
                            onChange={(value) => {
                              patchDraft('levelValues', {
                                ...draft.levelValues,
                                [String(level)]: value === undefined ? '' : String(value)
                              });
                            }}
                          />
                        </label>
                      ))}
                    </Space>
                  </div>
                </Space>
              )}
            </Form.Item>
          ) : null}

          <Form.Item
            label="说明"
            validateStatus={errors.description ? 'error' : undefined}
            help={errors.description}
          >
            <Input.TextArea
              aria-label="说明"
              value={draft.description}
              disabled={readOnly || saving}
              maxLength={2000}
              showWordLimit
              autoSize={{ minRows: 2, maxRows: 6 }}
              onChange={(value) => patchDraft('description', value)}
            />
          </Form.Item>
          <Form.Item
            label="排序"
            required
            validateStatus={errors.sortOrder ? 'error' : undefined}
            help={errors.sortOrder}
          >
            <InputNumber
              aria-label="排序"
              value={draft.sortOrder.trim() ? Number(draft.sortOrder) : undefined}
              disabled={readOnly || saving}
              min={0}
              precision={0}
              style={{ width: '100%' }}
              onChange={(value) => patchDraft('sortOrder', value === undefined ? '' : String(value))}
            />
          </Form.Item>
        </Form>
      </Space>
    </Modal>
  );
}
