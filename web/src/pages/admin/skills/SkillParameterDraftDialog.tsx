import { Alert, Button, Form, Input, InputNumber, Modal, Radio, Space, Typography } from '@arco-design/web-react';
import { useState } from 'react';
import type { AuthoringLocation } from '../../../types/authoringLocation';
import type { SkillParameter, SkillParameterValueMode, SkillParameterValueType } from '../../../types/skillParameter';
import { AuthoringFieldAnchor } from './AuthoringFieldAnchor';
import { authoringLocateMessage, lastFieldName, shouldDegradeUnsupportedAnchor } from './authoringFocus';
import { resolveAuthoringLocation } from './authoringLocation';
import {
  applyPastedLevelValues,
  applyValueModeReset,
  fillArithmeticLevelValues,
  fillFixedLevelValues,
  validateParameterDraft,
  type LevelRange,
  type SkillParameterDraft,
  type SkillParameterDraftErrors
} from './parameterForm';
import { visibleParameterDraft } from './skillConfigurationDraft';

type Props = {
  initial: SkillParameterDraft;
  original: SkillParameter | null;
  skillMaxLevel: number;
  characterLevelRange: LevelRange | null;
  characterLevelError: string | null;
  initialErrors?: SkillParameterDraftErrors;
  authoringLocation?: AuthoringLocation | null;
  onApply: (draft: SkillParameterDraft) => string | null;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

export function SkillParameterDraftDialog({
  initial, original, skillMaxLevel, characterLevelRange, characterLevelError,
  initialErrors = {}, authoringLocation, onApply, onClose, onDirtyChange
}: Props) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<SkillParameterDraftErrors>(initialErrors);
  const [bulkText, setBulkText] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [fillValue, setFillValue] = useState<number | undefined>();
  const [arithStart, setArithStart] = useState<number | undefined>();
  const [arithStep, setArithStep] = useState<number | undefined>();
  const [applyError, setApplyError] = useState<string | null>(null);
  const resolved = authoringLocation && original ? resolveAuthoringLocation(authoringLocation, original) : null;
  const unsupported = resolved && authoringLocation
    ? shouldDegradeUnsupportedAnchor(authoringLocation.editor, resolved.matchedSegments, resolved.precision)
    : false;
  const focusField = resolved?.precision === 'FIELD' && !resolved.reason && !unsupported
    ? lastFieldName(resolved.matchedSegments) : null;
  const locateNotice = authoringLocation && (resolved?.reason || unsupported || resolved?.precision !== 'FIELD')
    ? authoringLocateMessage({
      originalFieldPath: authoringLocation.fieldPath,
      reason: resolved?.reason ?? (original ? null : 'OBJECT_MISSING'),
      unsupportedAnchor: Boolean(unsupported),
      reportChanged: resolved?.reportChanged
    }) : null;
  const levelRange = draft.valueMode === 'SKILL_LEVEL'
    ? { minLevel: 1, maxLevel: skillMaxLevel }
    : draft.valueMode === 'CHARACTER_LEVEL' ? characterLevelRange : null;
  const levels = levelRange
    ? Array.from({ length: levelRange.maxLevel - levelRange.minLevel + 1 }, (_, index) => levelRange.minLevel + index)
    : [];

  const reportDirty = (next: SkillParameterDraft, text = bulkText) => {
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(initial) || Boolean(text.trim()));
  };
  const patch = <K extends keyof SkillParameterDraft>(field: K, value: SkillParameterDraft[K]) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    setErrors((current) => ({ ...current, [field]: undefined }));
    setApplyError(null);
    reportDirty(next);
  };
  const changeMode = (mode: SkillParameterValueMode) => {
    if (mode === draft.valueMode) return;
    const range = mode === 'SKILL_LEVEL'
      ? { minLevel: 1, maxLevel: skillMaxLevel }
      : mode === 'CHARACTER_LEVEL' ? characterLevelRange : null;
    const next = applyValueModeReset(draft, mode, range);
    setDraft(next);
    setErrors({});
    setBulkText('');
    setBulkError(null);
    setApplyError(null);
    reportDirty(next, '');
  };
  const changeType = (type: SkillParameterValueType) => {
    patch('valueType', type);
    if (bulkText.trim() && levelRange) {
      const result = applyPastedLevelValues(draft.levelValues, bulkText, levelRange.minLevel, levelRange.maxLevel, type);
      setBulkError(result.ok ? null : result.message);
    }
  };
  const applyBulk = () => {
    if (!levelRange) return;
    const result = applyPastedLevelValues(draft.levelValues, bulkText, levelRange.minLevel, levelRange.maxLevel, draft.valueType);
    if (!result.ok) {
      setBulkError(result.message);
      return;
    }
    const next = { ...draft, levelValues: result.levelValues };
    setDraft(next);
    setErrors((current) => ({ ...current, levelValues: undefined }));
    setBulkText('');
    setBulkError(null);
    reportDirty(next, '');
  };
  const close = () => {
    if ((JSON.stringify(draft) !== JSON.stringify(initial) || bulkText.trim())
      && !window.confirm('当前参数修改尚未确认，确定放弃吗？')) return;
    onDirtyChange(false);
    onClose();
  };
  const apply = () => {
    if (bulkText.trim()) {
      setBulkError('整列等级数值尚未应用，请先点击“应用整列数值”。');
      return;
    }
    const projected = visibleParameterDraft(draft, skillMaxLevel, characterLevelRange);
    const validation = validateParameterDraft(projected, !original, levelRange);
    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      return;
    }
    const error = onApply(draft);
    if (error) {
      setApplyError(error);
      return;
    }
    onDirtyChange(false);
  };

  return <Modal
    title={original ? `编辑参数 · ${original.name}` : '新增参数'}
    visible
    style={{ width: 760 }}
    maskClosable
    onCancel={close}
    footer={<Space><Button onClick={close}>取消</Button><Button type="primary" onClick={apply}>确认到技能草稿</Button></Space>}
  >
    <Space direction="vertical" size="medium" style={{ width: '100%' }}>
      {locateNotice ? <Alert type="warning" content={locateNotice} /> : null}
      {applyError ? <Alert type="error" content={applyError} /> : null}
      <Form layout="vertical">
        <AuthoringFieldAnchor field="parameterKey" active={focusField === 'parameterKey'}>
          <Form.Item label="稳定标识" required validateStatus={errors.parameterKey ? 'error' : undefined} help={errors.parameterKey}>
            <Input aria-label="稳定标识" value={draft.parameterKey} disabled={Boolean(original)} maxLength={64}
              onChange={(value) => patch('parameterKey', value)} />
          </Form.Item>
        </AuthoringFieldAnchor>
        <AuthoringFieldAnchor field="name" active={focusField === 'name'}>
          <Form.Item label="参数名称" required validateStatus={errors.name ? 'error' : undefined} help={errors.name}>
            <Input aria-label="参数名称" value={draft.name} maxLength={100} onChange={(value) => patch('name', value)} />
          </Form.Item>
        </AuthoringFieldAnchor>
        <AuthoringFieldAnchor field="valueType" active={focusField === 'valueType'}>
          <Form.Item label="数值类型" required validateStatus={errors.valueType ? 'error' : undefined} help={errors.valueType}>
            <Radio.Group aria-label="数值类型" value={draft.valueType} onChange={(value) => changeType(value as SkillParameterValueType)}>
              <Radio value="INTEGER">整数</Radio><Radio value="DECIMAL">小数</Radio>
            </Radio.Group>
          </Form.Item>
        </AuthoringFieldAnchor>
        <AuthoringFieldAnchor field="valueMode" active={focusField === 'valueMode'}>
          <Form.Item label="取值方式" required validateStatus={errors.valueMode ? 'error' : undefined} help={errors.valueMode}>
            <Radio.Group aria-label="取值方式" value={draft.valueMode} onChange={(value) => changeMode(value as SkillParameterValueMode)}>
              <Radio value="FIXED">固定值</Radio><Radio value="SKILL_LEVEL">按技能等级</Radio>
              <Radio value="CHARACTER_LEVEL" disabled={!characterLevelRange}>按角色等级</Radio>
              <Radio value="RUNTIME_INPUT">计算时传入</Radio>
            </Radio.Group>
            {!characterLevelRange ? <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              {characterLevelError ?? '游戏等级范围尚未配置或读取。'}
            </Typography.Text> : null}
          </Form.Item>
        </AuthoringFieldAnchor>
        {draft.valueMode === 'FIXED' ? <AuthoringFieldAnchor field="fixedValue" active={focusField === 'fixedValue' || focusField === 'value'}>
          <Form.Item label="固定值" required validateStatus={errors.fixedValue ? 'error' : undefined} help={errors.fixedValue}>
            <InputNumber aria-label="固定值" placeholder="请明确填写，0 也是有效数值" style={{ width: '100%' }}
              value={draft.fixedValue.trim() ? Number(draft.fixedValue) : undefined}
              onChange={(value) => patch('fixedValue', value === undefined ? '' : String(value))} />
          </Form.Item>
        </AuthoringFieldAnchor> : null}
        {(draft.valueMode === 'SKILL_LEVEL' || draft.valueMode === 'CHARACTER_LEVEL') ? <AuthoringFieldAnchor field="levelValues" active={focusField === 'levelValues'}>
          <Form.Item label="等级数值" required validateStatus={errors.levelValues || bulkError ? 'error' : undefined}
            help={errors.levelValues ?? bulkError}>
            {levelRange ? <Space direction="vertical" style={{ width: '100%' }}>
              <Typography.Text type="secondary">按 Lv{levelRange.minLevel}～Lv{levelRange.maxLevel} 输入 {levels.length} 个值。空白须填写，0 有效。</Typography.Text>
              <Input.TextArea aria-label="整列等级数值" value={bulkText}
                placeholder="换行、制表符或逗号分隔；应用后写入草稿"
                autoSize={{ minRows: 2, maxRows: 5 }}
                onChange={(text) => {
                  setBulkText(text);
                  setBulkError(null);
                  reportDirty(draft, text);
                }} />
              <Button onClick={applyBulk}>应用整列数值</Button>
              <Space wrap>
                <InputNumber aria-label="固定填充值" placeholder="填充值，可填 0" value={fillValue} onChange={setFillValue} />
                <Button disabled={fillValue === undefined} onClick={() => {
                  if (fillValue !== undefined) patch('levelValues', { ...draft.levelValues, ...fillFixedLevelValues(levelRange.minLevel, levelRange.maxLevel, fillValue) });
                }}>固定填充</Button>
                <InputNumber aria-label="等差起始值" placeholder="起始值，可填 0" value={arithStart} onChange={setArithStart} />
                <InputNumber aria-label="每级增加值" placeholder="每级增加值，可填 0" value={arithStep} onChange={setArithStep} />
                <Button disabled={arithStart === undefined || arithStep === undefined} onClick={() => {
                  if (arithStart !== undefined && arithStep !== undefined) patch('levelValues', {
                    ...draft.levelValues,
                    ...fillArithmeticLevelValues(levelRange.minLevel, levelRange.maxLevel, arithStart, arithStep)
                  });
                }}>等差递增</Button>
              </Space>
              <div style={{ overflowX: 'auto' }}><Space wrap size="medium">
                {levels.map((level) => <label key={level} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 90 }}>
                  <span>Lv{level}</span>
                  <InputNumber aria-label={`等级${level}数值`} placeholder="待填写"
                    value={draft.levelValues[String(level)]?.trim() ? Number(draft.levelValues[String(level)]) : undefined}
                    onChange={(value) => patch('levelValues', { ...draft.levelValues, [String(level)]: value === undefined ? '' : String(value) })} />
                </label>)}
              </Space></div>
            </Space> : <Alert type="warning" content={characterLevelError ?? '请先设置游戏等级范围。'} />}
          </Form.Item>
        </AuthoringFieldAnchor> : null}
        <AuthoringFieldAnchor field="description" active={focusField === 'description'}>
          <Form.Item label="说明" validateStatus={errors.description ? 'error' : undefined} help={errors.description}>
            <Input.TextArea aria-label="参数说明" value={draft.description} maxLength={2000} showWordLimit
              autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => patch('description', value)} />
          </Form.Item>
        </AuthoringFieldAnchor>
        <AuthoringFieldAnchor field="sortOrder" active={focusField === 'sortOrder'}>
          <Form.Item label="排序" required validateStatus={errors.sortOrder ? 'error' : undefined} help={errors.sortOrder}>
            <InputNumber aria-label="参数排序" min={0} precision={0} style={{ width: '100%' }}
              value={draft.sortOrder.trim() ? Number(draft.sortOrder) : undefined}
              onChange={(value) => patch('sortOrder', value === undefined ? '' : String(value))} />
          </Form.Item>
        </AuthoringFieldAnchor>
      </Form>
    </Space>
  </Modal>;
}
