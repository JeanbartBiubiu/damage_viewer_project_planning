import { Alert, Button, Collapse, Form, Input, Modal, Space, Typography } from '@arco-design/web-react';
import { useMemo } from 'react';
import { TypeTagEditor } from '../../../../components/TypeTagEditor';
import { BaseStatsEditor } from '../../../../components/hero-editor/BaseStatsEditor';
import { StatsByLevelEditor } from '../../../../components/hero-editor/StatsByLevelEditor';
import {
  parseBaseStatsRows,
  parseStatsByLevelRows,
  stringifyBaseStatsRows,
  stringifyStatsByLevelRows
} from '../../../../components/hero-editor/heroStats';
import type { TypeDefinition } from '../../../../types/api';
import type { HeroesFormData } from './types';

type HeroesModalProps = {
  typeDefinitions: TypeDefinition[];
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  visible: boolean;
  mode: 'create' | 'view' | 'edit';
  formData: HeroesFormData;
  saving: boolean;
  onClose: () => void;
  onFieldChange: <K extends keyof HeroesFormData>(field: K, value: HeroesFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

export function HeroesModal({
  typeDefinitions,
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
}: HeroesModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';

  const baseStatsState = useMemo(() => {
    try {
      return { rows: parseBaseStatsRows(formData.baseStatsText), error: null as string | null };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.baseStatsText]);

  const statsByLevelState = useMemo(() => {
    try {
      return { rows: parseStatsByLevelRows(formData.statsByLevelText), error: null as string | null };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [formData.statsByLevelText]);

  return (
    <Modal
      title={mode === 'create' ? '新增英雄' : mode === 'edit' ? '编辑英雄' : '查看英雄'}
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
      style={{ width: 1280 }}
    >
      <Form layout="vertical">
        <Form.Item label="heroId">
          <Input
            value={formData.heroId}
            disabled={readOnly || editingExisting}
            onChange={(value) => onFieldChange('heroId', value)}
            placeholder="请输入 heroId"
          />
        </Form.Item>

        <div className="crud-form-grid">
          <Form.Item label="名称">
            <Input value={formData.name} disabled={readOnly} onChange={(value) => onFieldChange('name', value)} placeholder="请输入名称" />
          </Form.Item>

          <Form.Item label="称号">
            <Input value={formData.title} disabled={readOnly} onChange={(value) => onFieldChange('title', value)} placeholder="请输入称号" />
          </Form.Item>
        </div>

        <Form.Item label="avatarUrl">
          <Input
            value={formData.avatarUrl}
            disabled={readOnly}
            onChange={(value) => onFieldChange('avatarUrl', value)}
            placeholder="可选"
          />
        </Form.Item>

        <Form.Item label="类型标签">
          <TypeTagEditor
            definitions={typeDefinitions}
            persistedTypeIds={formData.persistedTypeIds}
            value={formData.selectedTypeIds}
            onChange={(value) => onFieldChange('selectedTypeIds', value)}
            disabled={readOnly || (mode === 'create' && !formData.heroId.trim())}
          />
        </Form.Item>

        <Form.Item label="baseStats 结构化编辑">
          {baseStatsState.error ? <Alert type="error" content={`baseStats 解析失败：${baseStatsState.error}`} style={{ marginBottom: 12 }} /> : null}
          <BaseStatsEditor
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            rows={baseStatsState.rows}
            disabled={readOnly || !!baseStatsState.error}
            onChange={(rows) => onFieldChange('baseStatsText', stringifyBaseStatsRows(rows))}
          />
        </Form.Item>

        <Form.Item label="statsByLevel 结构化编辑">
          {statsByLevelState.error ? <Alert type="error" content={`statsByLevel 解析失败：${statsByLevelState.error}`} style={{ marginBottom: 12 }} /> : null}
          <StatsByLevelEditor
            apiBaseUrl={apiBaseUrl}
            selectedGameId={selectedGameId}
            adminToken={adminToken}
            rows={statsByLevelState.rows}
            disabled={readOnly || !!statsByLevelState.error}
            onChange={(rows) => onFieldChange('statsByLevelText', stringifyStatsByLevelRows(rows))}
          />
        </Form.Item>

        <Collapse defaultActiveKey={[]} style={{ marginTop: 8 }}>
          <Collapse.Item name="advanced-json" header="高级 JSON 编辑（双向同步）">
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              结构化编辑与下方 JSON 文本双向同步。若手动修改 JSON 导致解析失败，结构化区会暂时禁用并显示错误。
            </Typography.Text>

            <Form.Item label="baseStats JSON">
              <Input.TextArea
                value={formData.baseStatsText}
                disabled={readOnly}
                autoSize={{ minRows: 8, maxRows: 14 }}
                onChange={(value) => onFieldChange('baseStatsText', value)}
                placeholder="{\n  \n}"
                className="admin-json-input"
              />
            </Form.Item>

            <Form.Item label="statsByLevel JSON">
              <Input.TextArea
                value={formData.statsByLevelText}
                disabled={readOnly}
                autoSize={{ minRows: 8, maxRows: 14 }}
                onChange={(value) => onFieldChange('statsByLevelText', value)}
                placeholder="{\n  \n}"
                className="admin-json-input"
              />
            </Form.Item>
          </Collapse.Item>
        </Collapse>
      </Form>
    </Modal>
  );
}
