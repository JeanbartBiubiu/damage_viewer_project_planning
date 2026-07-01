import { Alert, Button, Collapse, Form, Input, Modal, Select, Space, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { FormulaBindingTargetFields } from '../../../../components/formula-editor/FormulaBindingTargetFields';
import { FormulaParamsEditor } from '../../../../components/formula-editor/FormulaParamsEditor';
import { getErrorMessage, getFormulaProfiles } from '../../../../services/apiClient';
import type { FormulaProfile } from '../../../../types/api';
import type { FormulaBindingsFormData } from './types';

type FormulaBindingsModalProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: FormulaBindingsFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof FormulaBindingsFormData>(field: K, value: FormulaBindingsFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

export function FormulaBindingsModal({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  visible,
  mode,
  formData,
  saving,
  onClose,
  onFieldChange,
  onSubmit
}: FormulaBindingsModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';
  const token = adminToken.trim();
  const [formulaProfiles, setFormulaProfiles] = useState<FormulaProfile[]>([]);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [loadingProfiles, setLoadingProfiles] = useState(false);

  useEffect(() => {
    if (!visible || !selectedGameId || !token) {
      setFormulaProfiles([]);
      setProfilesError(null);
      setLoadingProfiles(false);
      return;
    }

    let cancelled = false;
    setLoadingProfiles(true);
    setProfilesError(null);

    getFormulaProfiles(apiBaseUrl, selectedGameId, token)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setFormulaProfiles(result.data.formulaProfiles);
        setLoadingProfiles(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setFormulaProfiles([]);
        setProfilesError(getErrorMessage(error));
        setLoadingProfiles(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId, token, visible]);

  const formulaProfileOptions = useMemo(() => {
    const baseOptions = formulaProfiles.map((profile) => ({
      label: `${profile.formulaId}${profile.formulaType ? ` / ${profile.formulaType}` : ''}`,
      value: profile.formulaId
    }));
    const trimmed = formData.formulaId.trim();
    if (!trimmed || baseOptions.some((option) => option.value === trimmed)) {
      return baseOptions;
    }
    return [...baseOptions, { label: `${trimmed}（当前值）`, value: trimmed }];
  }, [formData.formulaId, formulaProfiles]);

  return (
    <Modal
      title={mode === 'create' ? '新增公式绑定' : mode === 'edit' ? '编辑公式绑定' : '查看公式绑定'}
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
      style={{ width: '90vw', maxWidth: 1280 }}
    >
      <Form layout="vertical">
        <Form.Item label="目标绑定">
          <FormulaBindingTargetFields
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            targetCategory={formData.targetCategory}
            targetId={formData.targetId}
            disabled={readOnly}
            identityLocked={editingExisting}
            onTargetCategoryChange={(value) => onFieldChange('targetCategory', value)}
            onTargetIdChange={(value) => onFieldChange('targetId', value)}
          />
        </Form.Item>

        <div className="crud-form-grid">
          <Form.Item label="绑定键">
            <Input
              value={formData.bindingKey}
              disabled={readOnly || editingExisting}
              onChange={(value) => onFieldChange('bindingKey', value)}
              placeholder="例如 mitigation.magic"
            />
          </Form.Item>

          <Form.Item label="公式档案选择">
            <Select
              showSearch
              allowClear
              value={formData.formulaId || undefined}
              disabled={readOnly || !selectedGameId || !token}
              loading={loadingProfiles}
              options={formulaProfileOptions}
              placeholder="搜索并选择公式 ID"
              onChange={(value) => onFieldChange('formulaId', String(value ?? ''))}
              filterOption={(inputValue, option) => {
                const optionData = option as { value?: unknown; label?: unknown } | undefined;
                const searchText = `${String(optionData?.value ?? '')} ${String(optionData?.label ?? '')}`.toLowerCase();
                return searchText.includes(inputValue.trim().toLowerCase());
              }}
            />
          </Form.Item>
        </div>

        <Form.Item label="公式 ID">
          <Input
            value={formData.formulaId}
            disabled={readOnly}
            onChange={(value) => onFieldChange('formulaId', value)}
            placeholder="也可以直接填写公式 ID"
          />
        </Form.Item>

        {profilesError ? <Alert type="error" content={`公式档案列表加载失败：${profilesError}`} style={{ marginBottom: 16 }} /> : null}
        {!profilesError ? (
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
            保存时会浅合并 `profile.params + overrideParams`，同名顶层字段由 `overrideParams` 覆盖。
          </Typography.Text>
        ) : null}

        <Form.Item label="覆写参数">
          <FormulaParamsEditor
            title="覆写参数"
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            value={formData.overrideParamsText}
            disabled={readOnly}
            showPreview={false}
            onChange={(value) => onFieldChange('overrideParamsText', value)}
          />
        </Form.Item>

        <Collapse defaultActiveKey={[]} style={{ marginTop: 8 }}>
          <Collapse.Item name="extra-fields" header="额外顶层字段">
            <Input.TextArea
              value={formData.extraFieldsText}
              disabled={readOnly}
              autoSize={{ minRows: 6, maxRows: 12 }}
              onChange={(value) => onFieldChange('extraFieldsText', value)}
              placeholder="{\n  \n}"
              className="admin-json-input"
            />
          </Collapse.Item>
        </Collapse>
      </Form>
    </Modal>
  );
}
