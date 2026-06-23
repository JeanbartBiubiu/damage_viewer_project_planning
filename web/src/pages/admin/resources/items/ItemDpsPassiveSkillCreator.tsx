import { Alert, Button, Checkbox, Input, InputNumber, Select, Space, Typography } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import {
  buildItemCreatorOperationPatch,
  buildItemOwnedDpsPassiveSkillPayload,
  getDpsPassiveTemplateOptions,
  suggestItemOwnedDpsSkillMeta,
  templateRequiresItemCreatorParams,
  type DpsPassiveTemplateId
} from '../../../../components/skill-editor/dpsPassiveTemplates';
import { hasDpsPassiveValidationErrors, validateDpsPassiveEffects } from '../../../../components/skill-editor/skillModels';
import { getErrorMessage, putSkill } from '../../../../services/apiClient';
import type { JsonObject } from '../../../../types/api';

type ItemDpsPassiveSkillCreatorProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  itemId: string;
  itemName: string;
  currentSkillRefs: string[];
  readOnly: boolean;
  onAppendSkillRef: (skillId: string) => void;
};

export function ItemDpsPassiveSkillCreator({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  itemId,
  itemName,
  currentSkillRefs,
  readOnly,
  onAppendSkillRef
}: ItemDpsPassiveSkillCreatorProps) {
  const templateOptions = useMemo(() => getDpsPassiveTemplateOptions(), []);
  const [selectedTemplateId, setSelectedTemplateId] = useState<DpsPassiveTemplateId>('attacker_on_hit_damage');
  const [skillId, setSkillId] = useState('');
  const [skillKey, setSkillKey] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [thresholdValueText, setThresholdValueText] = useState('');
  const [forceCrit, setForceCrit] = useState(false);
  const [critMultiplierOverrideText, setCritMultiplierOverrideText] = useState('');
  const [critMultiplierScaleText, setCritMultiplierScaleText] = useState('');
  const [bucketKey, setBucketKey] = useState('');

  const canCreate = Boolean(itemId.trim() && selectedGameId && adminToken.trim() && !readOnly);
  const showTemplateParams = templateRequiresItemCreatorParams(selectedTemplateId);

  const creatorParamState = useMemo(
    () => ({
      thresholdValueText,
      forceCrit,
      critMultiplierOverrideText,
      critMultiplierScaleText,
      bucketKey
    }),
    [thresholdValueText, forceCrit, critMultiplierOverrideText, critMultiplierScaleText, bucketKey]
  );

  const operationPatch = useMemo(
    () => buildItemCreatorOperationPatch(selectedTemplateId, creatorParamState),
    [selectedTemplateId, creatorParamState]
  );

  const draftPayload = useMemo(() => {
    const normalizedSkillId = skillId.trim();
    if (!itemId.trim() || !normalizedSkillId) {
      return null;
    }
    return buildItemOwnedDpsPassiveSkillPayload({
      itemId: itemId.trim(),
      skillId: normalizedSkillId,
      skillKey: skillKey.trim() || normalizedSkillId,
      name: name.trim() || normalizedSkillId,
      templateId: selectedTemplateId,
      operationPatch
    });
  }, [itemId, skillId, skillKey, name, selectedTemplateId, operationPatch]);

  const draftValidationIssues = useMemo(() => {
    const mechanicsConfig = draftPayload?.mechanicsConfig;
    if (!mechanicsConfig || typeof mechanicsConfig !== 'object' || Array.isArray(mechanicsConfig)) {
      return [];
    }
    return validateDpsPassiveEffects(mechanicsConfig as JsonObject);
  }, [draftPayload]);

  const draftValidationErrors = useMemo(
    () => draftValidationIssues.filter((issue) => issue.severity === 'error'),
    [draftValidationIssues]
  );
  const draftValidationWarnings = useMemo(
    () => draftValidationIssues.filter((issue) => issue.severity === 'warning'),
    [draftValidationIssues]
  );
  const createBlockedByValidation = draftValidationErrors.length > 0;

  useEffect(() => {
    const suggested = suggestItemOwnedDpsSkillMeta(itemId, selectedTemplateId, itemName);
    setSkillId(suggested.skillId);
    setSkillKey(suggested.skillKey);
    setName(suggested.name);
    setThresholdValueText('');
    setForceCrit(false);
    setCritMultiplierOverrideText('');
    setCritMultiplierScaleText('');
    setBucketKey('');
    setError(null);
    setSuccess(null);
  }, [itemId, itemName, selectedTemplateId]);

  const handleCreate = async () => {
    if (!canCreate || !selectedGameId || createBlockedByValidation) {
      return;
    }
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const normalizedSkillId = skillId.trim();
      if (!normalizedSkillId) {
        throw new Error('技能 ID 不能为空。');
      }
      const payload = buildItemOwnedDpsPassiveSkillPayload({
        itemId: itemId.trim(),
        skillId: normalizedSkillId,
        skillKey: skillKey.trim() || normalizedSkillId,
        name: name.trim() || normalizedSkillId,
        templateId: selectedTemplateId,
        operationPatch
      });
      const mechanicsConfig = payload.mechanicsConfig;
      if (!mechanicsConfig || typeof mechanicsConfig !== 'object' || Array.isArray(mechanicsConfig)) {
        throw new Error('生成的 mechanicsConfig 无效。');
      }
      const validationIssues = validateDpsPassiveEffects(mechanicsConfig as JsonObject);
      if (hasDpsPassiveValidationErrors(validationIssues)) {
        const messages = validationIssues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('；');
        throw new Error(`每秒伤害被动校验失败：${messages}`);
      }
      await putSkill(apiBaseUrl, selectedGameId, normalizedSkillId, adminToken.trim(), payload);
      onAppendSkillRef(normalizedSkillId);
      setSuccess(`已创建技能 ${normalizedSkillId} 并加入技能引用草稿；请点击「保存」保存装备。`);
    } catch (createError) {
      setError(getErrorMessage(createError));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ border: '1px dashed var(--color-border-3)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Typography.Text bold style={{ fontSize: 12 }}>
          从 DPS 模板创建 item-owned skill
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          仅创建 skill 并回填 skillRefs 草稿，不会自动保存 item。数值字段为模板草稿，需在 skill 页确认。
        </Typography.Text>
        {!itemId.trim() ? (
          <Alert type="warning" content="请先填写装备 ID。" />
        ) : null}
        {!selectedGameId || !adminToken.trim() ? (
          <Alert type="warning" content="需要已选游戏 ID 与 Admin Token。" />
        ) : null}
        <div className="crud-form-grid">
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              DPS passive 模板
            </Typography.Text>
            <Select
              value={selectedTemplateId}
              disabled={!canCreate}
              options={templateOptions}
              onChange={(value) => setSelectedTemplateId(String(value) as DpsPassiveTemplateId)}
            />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              技能 ID
            </Typography.Text>
            <Input value={skillId} disabled={!canCreate} onChange={setSkillId} />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              技能 Key
            </Typography.Text>
            <Input value={skillKey} disabled={!canCreate} onChange={setSkillKey} />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
              名称
            </Typography.Text>
            <Input value={name} disabled={!canCreate} onChange={setName} />
          </div>
        </div>
        {showTemplateParams ? (
          <div style={{ border: '1px solid var(--color-border-2)', borderRadius: 6, padding: 10 }}>
            <Typography.Text bold style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
              模板必填参数
            </Typography.Text>
            {selectedTemplateId === 'attacker_execute_threshold' ? (
              <div>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                  阈值（必填，无默认值）
                </Typography.Text>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  value={thresholdValueText.trim() ? Number(thresholdValueText) : undefined}
                  disabled={!canCreate}
                  placeholder="例如 0.05"
                  onChange={(value) => setThresholdValueText(value === undefined || value === null ? '' : String(value))}
                />
              </div>
            ) : null}
            {selectedTemplateId === 'attacker_crit_context_modifier' ? (
              <div className="crud-form-grid">
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <Checkbox checked={forceCrit} disabled={!canCreate} onChange={setForceCrit}>
                    强制暴击
                  </Checkbox>
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    暴击倍率覆盖
                  </Typography.Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    value={critMultiplierOverrideText.trim() ? Number(critMultiplierOverrideText) : undefined}
                    disabled={!canCreate}
                    placeholder="未设置"
                    onChange={(value) => {
                      setCritMultiplierOverrideText(value === undefined || value === null ? '' : String(value));
                      if (value !== undefined && value !== null) {
                        setCritMultiplierScaleText('');
                      }
                    }}
                  />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                    暴击倍率缩放
                  </Typography.Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    value={critMultiplierScaleText.trim() ? Number(critMultiplierScaleText) : undefined}
                    disabled={!canCreate}
                    placeholder="未设置"
                    onChange={(value) => {
                      setCritMultiplierScaleText(value === undefined || value === null ? '' : String(value));
                      if (value !== undefined && value !== null) {
                        setCritMultiplierOverrideText('');
                      }
                    }}
                  />
                </div>
              </div>
            ) : null}
            {selectedTemplateId === 'bucket_damage_modifier' ? (
              <div>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                  乘区 Key（必填，无默认值）
                </Typography.Text>
                <Input
                  value={bucketKey}
                  disabled={!canCreate}
                  placeholder="请输入乘区 Key"
                  onChange={setBucketKey}
                />
              </div>
            ) : null}
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              {selectedTemplateId === 'attacker_execute_threshold'
                ? 'thresholdValue 必须由数据来源确认后填写；未填时无法创建。'
                : selectedTemplateId === 'attacker_crit_context_modifier'
                  ? 'forceCrit、critMultiplierOverride、critMultiplierScale 至少填写一项有效值后方可创建；override 与 scale 不可同时填写。'
                  : 'bucketKey 必须显式填写；未填时无法创建。'}
            </Typography.Text>
          </div>
        ) : null}
        {draftValidationErrors.map((issue, issueIndex) => (
          <Alert
            key={`draft-error:${issueIndex}:${issue.path}:${issue.message}`}
            type="error"
            content={`${issue.path}: ${issue.message}`}
          />
        ))}
        {draftValidationWarnings.map((issue, issueIndex) => (
          <Alert
            key={`draft-warning:${issueIndex}:${issue.path}:${issue.message}`}
            type="warning"
            content={`${issue.path}: ${issue.message}`}
          />
        ))}
        {currentSkillRefs.includes(skillId.trim()) && skillId.trim() ? (
          <Alert type="warning" content={`skillRefs 已包含 ${skillId.trim()}；创建成功后将不会重复追加。`} />
        ) : null}
        {error ? <Alert type="error" content={error} /> : null}
        {success ? <Alert type="success" content={success} /> : null}
        <Button
          type="primary"
          size="small"
          loading={creating}
          disabled={!canCreate || createBlockedByValidation}
          onClick={() => void handleCreate()}
        >
          创建 skill 并加入 skillRefs
        </Button>
      </Space>
    </div>
  );
}
