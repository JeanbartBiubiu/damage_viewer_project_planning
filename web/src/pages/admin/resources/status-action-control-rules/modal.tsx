import { Alert, Button, Collapse, Form, Input, Modal, Select, Space, Typography } from '@arco-design/web-react';
import { useMemo } from 'react';
import { TypeIdSelector } from '../../../../components/TypeIdSelector';
import type { TypeDefinition } from '../../../../types/api';
import { parseJsonNumberArrayText, stringifyJson } from '../shared/json';
import { STATUS_ACTION_CONTROL_RULE_KIND_OPTIONS } from './constants';
import type { StatusActionControlRulesFormData } from './types';

type StatusActionControlRulesModalProps = {
  typeDefinitions: TypeDefinition[];
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: StatusActionControlRulesFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof StatusActionControlRulesFormData>(
    field: K,
    value: StatusActionControlRulesFormData[K]
  ) => void;
  onSubmit: () => Promise<void>;
};

function useParsedTypeIds(text: string, label: string) {
  return useMemo(() => {
    try {
      return {
        value: parseJsonNumberArrayText(text, label),
        error: null as string | null
      };
    } catch (error) {
      return {
        value: [] as number[],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }, [label, text]);
}

export function StatusActionControlRulesModal({
  typeDefinitions,
  visible,
  mode,
  formData,
  saving,
  onClose,
  onFieldChange,
  onSubmit
}: StatusActionControlRulesModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';
  const statusTypeIdState = useMemo(() => {
    const trimmed = formData.statusTypeId.trim();
    if (!trimmed) {
      return { value: undefined as number | undefined, error: null as string | null };
    }

    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return { value: undefined as number | undefined, error: 'statusTypeId 必须是数字。' };
    }

    return { value: numeric, error: null as string | null };
  }, [formData.statusTypeId]);
  const actionTypeIdsState = useParsedTypeIds(formData.actionTypeIdsText, 'actionTypeIds');
  const actionMatchTypeIdsState = useParsedTypeIds(formData.actionMatchTypeIdsText, 'actionMatchTypeIds');
  const interruptPhaseTypeIdsState = useParsedTypeIds(formData.interruptPhaseTypeIdsText, 'interruptPhaseTypeIds');
  const interruptRule = formData.ruleKind === 'interrupt';

  return (
    <Modal
      title={
        mode === 'create'
          ? '新增状态动作控制规则'
          : mode === 'edit'
            ? '编辑状态动作控制规则'
            : '查看状态动作控制规则'
      }
      visible={visible}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button type="primary" loading={saving} onClick={() => void onSubmit()}>
              保存
            </Button>
          ) : null}
        </Space>
      }
      autoFocus={false}
      focusLock
      style={{ width: 960 }}
    >
      <Form layout="vertical">
        <div className="crud-form-grid">
          <Form.Item label="规则 ID（ruleId）">
            <Input
              value={formData.ruleId}
              disabled={readOnly || editingExisting}
              onChange={(value) => onFieldChange('ruleId', value)}
              placeholder="例如 status_stun_forbid_cast"
            />
          </Form.Item>

          <Form.Item label="状态类型 ID（statusTypeId）">
            {statusTypeIdState.error ? (
              <Alert type="error" content={statusTypeIdState.error} style={{ marginBottom: 12 }} />
            ) : null}
            <TypeIdSelector
              definitions={typeDefinitions}
              value={statusTypeIdState.value}
              disabled={readOnly || !!statusTypeIdState.error}
              allowClear={false}
              placeholder="选择状态类型"
              helperText="主路径优先使用类型目录；如果需要直接填写数字 ID，可以在下方高级区回退编辑。"
              onChange={(value) => onFieldChange('statusTypeId', value == null ? '' : String(value))}
            />
          </Form.Item>
        </div>

        <div className="crud-form-grid">
          <Form.Item label="规则类型（ruleKind）">
            <Select
              disabled={readOnly}
              value={formData.ruleKind || undefined}
              onChange={(value) => {
                const nextRuleKind = String(value ?? '');
                onFieldChange('ruleKind', nextRuleKind);
                if (nextRuleKind === 'forbid') {
                  onFieldChange('interruptPhaseTypeIdsText', stringifyJson([]));
                }
              }}
              placeholder="选择规则类型"
            >
              {STATUS_ACTION_CONTROL_RULE_KIND_OPTIONS.map((option) => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item label="优先级（priority）">
            <Input
              value={formData.priority}
              disabled={readOnly}
              onChange={(value) => onFieldChange('priority', value)}
              placeholder="例如 100"
            />
          </Form.Item>
        </div>

        <Form.Item label="动作类型列表（actionTypeIds）">
          {actionTypeIdsState.error ? (
            <Alert type="error" content={`actionTypeIds 解析失败：${actionTypeIdsState.error}`} style={{ marginBottom: 12 }} />
          ) : null}
          <TypeIdSelector
            definitions={typeDefinitions}
            mode="multiple"
            value={actionTypeIdsState.value}
            disabled={readOnly || !!actionTypeIdsState.error}
            placeholder="选择动作类型"
            helperText="后端要求至少配置一个 actionTypeId。"
            onChange={(value) => onFieldChange('actionTypeIdsText', stringifyJson(value))}
          />
        </Form.Item>

        <Form.Item label="附加匹配类型（actionMatchTypeIds）">
          {actionMatchTypeIdsState.error ? (
            <Alert
              type="error"
              content={`actionMatchTypeIds 解析失败：${actionMatchTypeIdsState.error}`}
              style={{ marginBottom: 12 }}
            />
          ) : null}
          <TypeIdSelector
            definitions={typeDefinitions}
            mode="multiple"
            value={actionMatchTypeIdsState.value}
            disabled={readOnly || !!actionMatchTypeIdsState.error}
            placeholder="选择附加匹配类型"
            helperText="可选，用于进一步缩小动作匹配范围。"
            onChange={(value) => onFieldChange('actionMatchTypeIdsText', stringifyJson(value))}
          />
        </Form.Item>

        <Form.Item label="可打断阶段类型（interruptPhaseTypeIds）">
          {interruptPhaseTypeIdsState.error ? (
            <Alert
              type="error"
              content={`interruptPhaseTypeIds 解析失败：${interruptPhaseTypeIdsState.error}`}
              style={{ marginBottom: 12 }}
            />
          ) : null}
          <TypeIdSelector
            definitions={typeDefinitions}
            mode="multiple"
            value={interruptPhaseTypeIdsState.value}
            disabled={readOnly || !interruptRule || !!interruptPhaseTypeIdsState.error}
            placeholder={interruptRule ? '选择可打断的阶段类型' : '仅当 ruleKind=interrupt 时可用'}
            helperText={
              interruptRule
                ? '只有 interrupt 规则允许设置该字段；切回 forbid 时会自动清空。'
                : '当前规则不是 interrupt，后端要求该列表保持为空。'
            }
            onChange={(value) => onFieldChange('interruptPhaseTypeIdsText', stringifyJson(value))}
          />
        </Form.Item>

        <Form.Item label="说明（description）">
          <Input.TextArea
            value={formData.description}
            disabled={readOnly}
            autoSize={{ minRows: 3, maxRows: 5 }}
            onChange={(value) => onFieldChange('description', value)}
            placeholder="可选说明"
          />
        </Form.Item>

        <Form.Item label="扩展字段（extend）">
          <Input.TextArea
            value={formData.extendText}
            disabled={readOnly}
            autoSize={{ minRows: 6, maxRows: 12 }}
            onChange={(value) => onFieldChange('extendText', value)}
            placeholder="{\n  \n}"
            className="admin-json-input"
          />
        </Form.Item>

        <Collapse defaultActiveKey={[]} style={{ marginTop: 8 }}>
          <Collapse.Item name="advanced-json" header="高级 JSON 回退">
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              上面的结构化选择器会和这些原始字段保持同步。如果类型目录还没同步，或者你需要直接填写数字 ID，可以在这里编辑。
            </Typography.Text>

            <Form.Item label="状态类型 ID 原始值（statusTypeId）">
              <Input
                value={formData.statusTypeId}
                disabled={readOnly}
                onChange={(value) => onFieldChange('statusTypeId', value)}
                placeholder="例如 50101"
              />
            </Form.Item>

            <Form.Item label="动作类型 JSON（actionTypeIds）">
              <Input.TextArea
                value={formData.actionTypeIdsText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('actionTypeIdsText', value)}
                placeholder="[\n  50101\n]"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="附加匹配类型 JSON（actionMatchTypeIds）">
              <Input.TextArea
                value={formData.actionMatchTypeIdsText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('actionMatchTypeIdsText', value)}
                placeholder="[\n  \n]"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="可打断阶段 JSON（interruptPhaseTypeIds）">
              <Input.TextArea
                value={formData.interruptPhaseTypeIdsText}
                disabled={readOnly}
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(value) => onFieldChange('interruptPhaseTypeIdsText', value)}
                placeholder="[\n  \n]"
                className="admin-json-input"
              />
            </Form.Item>
          </Collapse.Item>
        </Collapse>
      </Form>
    </Modal>
  );
}
