import { Alert, Button, Collapse, Form, Input, Modal, Space, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { TypeTagEditor } from '../../../../components/TypeTagEditor';
import {
  parseHeroStatsMatrix,
  stringifyHeroStatsMatrix
} from '../../../../components/hero-editor/heroStats';
import { HeroStatsMatrixEditor } from '../../../../components/hero-editor/HeroStatsMatrixEditor';
import { loadAttributeDefinitions } from '../../../../services/attributeDefinitions';
import { getErrorMessage } from '../../../../services/apiClient';
import type { AttributeDefinition, GameProgressionSchema, TypeDefinition } from '../../../../types/api';
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
  progressionSchema?: GameProgressionSchema;
  progressionSchemaError?: string | null;
  onClose: () => void;
  onFieldChange: <K extends keyof HeroesFormData>(field: K, value: HeroesFormData[K]) => void;
  onSubmit: () => Promise<void>;
};

const DEFAULT_PROGRESSION_SCHEMA: GameProgressionSchema = {
  progressionKind: 'LEVEL',
  stageMin: 1,
  stageMax: 18,
  stageLabel: 'Lv',
  requireAllStages: true
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
  progressionSchema = DEFAULT_PROGRESSION_SCHEMA,
  progressionSchemaError = null,
  onClose,
  onFieldChange,
  onSubmit
}: HeroesModalProps) {
  const readOnly = mode === 'view';
  const editingExisting = mode !== 'create';
  const [attributeDefinitions, setAttributeDefinitions] = useState<AttributeDefinition[]>([]);
  const [attributeDefinitionsError, setAttributeDefinitionsError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !selectedGameId || !adminToken.trim()) {
      setAttributeDefinitions([]);
      setAttributeDefinitionsError(null);
      return;
    }

    let cancelled = false;
    loadAttributeDefinitions({
      apiBaseUrl,
      gameId: selectedGameId,
      token: adminToken.trim()
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setAttributeDefinitions(result.definitions);
        setAttributeDefinitionsError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setAttributeDefinitions([]);
        setAttributeDefinitionsError(getErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [adminToken, apiBaseUrl, selectedGameId, visible]);

  const matrixState = useMemo(() => {
    try {
      return {
        rows: parseHeroStatsMatrix(
          formData.baseStatsText,
          formData.statsByLevelText,
          attributeDefinitions,
          progressionSchema.stageMin,
          progressionSchema.stageMax
        ),
        error: null as string | null
      };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [attributeDefinitions, formData.baseStatsText, formData.statsByLevelText, progressionSchema.stageMax, progressionSchema.stageMin]);

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

        <Form.Item label="属性矩阵编辑">
          {progressionSchemaError ? <Alert type="warning" content={`阶段配置读取失败：${progressionSchemaError}`} style={{ marginBottom: 12 }} /> : null}
          {attributeDefinitionsError ? (
            <Alert
              type="warning"
              content={`属性定义读取失败，将按现有 JSON 键回填：${attributeDefinitionsError}`}
              style={{ marginBottom: 12 }}
            />
          ) : null}
          {matrixState.error ? <Alert type="error" content={`矩阵解析失败：${matrixState.error}`} style={{ marginBottom: 12 }} /> : null}
          <HeroStatsMatrixEditor
            rows={matrixState.rows}
            stageMin={progressionSchema.stageMin}
            stageMax={progressionSchema.stageMax}
            stageLabel={progressionSchema.stageLabel}
            disabled={readOnly || !!matrixState.error}
            onChange={(rows) => {
              const next = stringifyHeroStatsMatrix(rows, progressionSchema.stageMin, progressionSchema.stageMax);
              onFieldChange('baseStatsText', next.baseStatsText);
              onFieldChange('statsByLevelText', next.statsByLevelText);
            }}
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
