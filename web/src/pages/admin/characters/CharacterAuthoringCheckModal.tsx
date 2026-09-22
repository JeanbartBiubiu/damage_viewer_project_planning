import { Alert, Button, Empty, Modal, Space, Table, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../../services/apiClient';
import { getCharacterAuthoringCheck } from '../../../services/characterAuthoringCheckClient';
import type { Character } from '../../../types/character';
import type { AuthoringLocation } from '../../../types/authoringLocation';
import type { AuthoringCheckIssue, AuthoringCheckReference, AuthoringCheckSkill, CharacterAuthoringCheck } from '../../../types/characterAuthoringCheck';
import {
  CATALOG_DISABLED_TEXT,
  CATALOG_MISSING_TEXT,
  collapsedItems,
  expandReferenceButtonLabel,
  referenceListNeedsToggle
} from '../shared/referenceListModel';
import { authoringLocationFor } from '../skills/authoringFocus';
import {
  loadAuthoringReferenceNames, referenceNameLabel, referenceSource, referenceTarget,
  type ReferenceName
} from './authoringReferenceNames';

type Props = {
  visible: boolean;
  character: Character | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onEditCharacter: () => void;
  onEditAttributes: () => void;
  onEditRelations: () => void;
  onLocate: (location: AuthoringLocation) => void;
};

const kindNames: Record<string, string> = {
  CHARACTER: '角色', ATTRIBUTE: '属性', SKILL: '技能', FORMULA: '公式', PARAMETER: '参数',
  EFFECT: '效果', RESULT: '结果', PROCESS: '过程', STEP: '步骤', STATE: '内部状态',
  TRIGGER: '触发规则', STATUS: '状态', DAMAGE_TYPE: '伤害类型', MODIFIER_ZONE: '乘区',
  SKILL_CATEGORY: '技能分类', OPTION: '模式选项', ACTION: '动作', LIFECYCLE: '生命周期'
};
const kindName = (kind: string) => kindNames[kind] ?? kind;

function skillLabel(skills: readonly AuthoringCheckSkill[], skillKey: string): string {
  const skill = skills.find((item) => item.skillKey === skillKey);
  if (!skill || skill.name === null) return `${CATALOG_MISSING_TEXT}（${skillKey}）`;
  const disabled = skill.status === 'DISABLED' ? `（${CATALOG_DISABLED_TEXT}）` : '';
  return `${skill.name}（${skillKey}）${disabled}`;
}

export function CharacterAuthoringCheckModal({
  visible, character, apiBaseUrl, selectedGameId, adminToken, onClose,
  onEditCharacter, onEditAttributes, onEditRelations, onLocate
}: Props) {
  const [report, setReport] = useState<CharacterAuthoringCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [referencesExpanded, setReferencesExpanded] = useState(false);
  const [referenceNames, setReferenceNames] = useState(new Map<string, ReferenceName>());
  const serial = useRef(0);
  const characterKey = character?.characterKey;
  const load = useCallback(async () => {
    const request = ++serial.current;
    setReport(null);
    setError(null);
    setReferencesExpanded(false);
    if (!visible || !selectedGameId || !characterKey || !adminToken.trim()) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await getCharacterAuthoringCheck(apiBaseUrl, selectedGameId, characterKey, adminToken.trim());
      if (serial.current === request) setReport(result.data);
    } catch (failure) {
      if (serial.current === request) setError(getErrorMessage(failure));
    } finally {
      if (serial.current === request) setLoading(false);
    }
  }, [adminToken, apiBaseUrl, characterKey, selectedGameId, visible]);
  useEffect(() => { void load(); return () => { serial.current++; }; }, [load]);
  const ready = visible && report?.gameId === selectedGameId && report?.characterKey === characterKey ? report : null;
  useEffect(() => {
    let current = true;
    setReferenceNames(new Map());
    if (ready && selectedGameId) {
      void loadAuthoringReferenceNames(ready.references, {
        apiBaseUrl, gameId: selectedGameId, token: adminToken.trim()
      }, () => current).then(names => { if (current) setReferenceNames(names); });
    }
    return () => { current = false; };
  }, [ready, apiBaseUrl, selectedGameId, adminToken]);

  const locate = (location: AuthoringLocation, skillKey: string | null) => {
    if (location.editor === 'CHARACTER_BASIC') {
      onEditCharacter();
      return;
    }
    if (location.editor === 'CHARACTER_ATTRIBUTES') {
      onEditAttributes();
      return;
    }
    if (location.editor === 'CHARACTER_RELATIONS' || !skillKey) {
      onEditRelations();
      return;
    }
    const skill = ready?.skills.find((item) => item.skillKey === skillKey);
    if (!skill || skill.name === null) {
      onEditRelations();
      return;
    }
    onLocate(location);
  };

  const visibleReferences = ready ? collapsedItems(ready.references, referencesExpanded) : [];
  const canToggleReferences = ready ? referenceListNeedsToggle(ready.references.length) : false;

  return <Modal title={`录入检查 · ${character?.name ?? ''}`} visible={visible && !!character} onCancel={onClose}
    style={{ width: 'calc(100vw - 80px)', maxWidth: 1500 }} footer={<Button onClick={onClose}>关闭</Button>}>
    <Space direction="vertical" style={{ width: '100%' }} size="medium">
      <Space wrap>
        <Button loading={loading} disabled={!adminToken.trim() || !selectedGameId} onClick={() => void load()}>重新检查</Button>
        <Button onClick={onEditCharacter}>编辑基础资料</Button>
        <Button onClick={onEditAttributes}>维护等级属性</Button>
        <Button onClick={onEditRelations}>维护关联技能</Button>
      </Space>
      {!adminToken.trim() ? <Alert type="warning" content="请先配置管理令牌。" /> : null}
      {loading ? <Typography.Text>正在读取角色与挂载技能…</Typography.Text> : null}
      {error ? <Alert type="error" content={error} /> : null}
      {ready ? <>
        <Alert type={ready.summary.errorCount ? 'error' : ready.summary.reviewCount ? 'warning' : 'success'}
          content={`结构检查：${ready.summary.errorCount ? `发现 ${ready.summary.errorCount} 项错误` : '未发现错误'}；${ready.summary.reviewCount} 项待核对。机制完整性：待人工核对。战斗运行：未执行。`} />
        <Typography.Text type="secondary">检查时间：{new Date(ready.checkedAt).toLocaleString('zh-CN', { hour12: false })}。已挂载 {ready.summary.attachedSkillCount} 个技能，已配置 {ready.summary.configuredAttributeCount} 项等级属性。</Typography.Text>
        <Typography.Title heading={6}>问题与待核对项</Typography.Title>
        <Table data={ready.issues} pagination={false} rowKey={item => JSON.stringify([item.code, item.skillKey, item.objectType, item.objectKey, item.fieldPath])}
          noDataElement={<Empty description="本次结构检查未发现问题" />} columns={[
            { title: '级别', width: 85, render: (_value, item: AuthoringCheckIssue) => item.severity === 'ERROR' ? '错误' : '待核对' },
            { title: '位置', width: 250, render: (_value, item: AuthoringCheckIssue) => [item.skillKey, kindName(item.objectType), item.objectKey, item.fieldPath].filter(Boolean).join(' / ') },
            { title: '说明', dataIndex: 'message' },
            { title: '操作', width: 110, render: (_value, item: AuthoringCheckIssue) => (
              <Button size="mini" onClick={() => locate(item.location, item.skillKey)}>定位问题</Button>
            ) }
          ]} />
        <Typography.Title heading={6}>挂载技能</Typography.Title>
        <Table data={ready.skills} pagination={false} rowKey="skillKey" noDataElement={<Empty description="尚未挂载技能" />} columns={[
          { title: '技能', render: (_value, item: AuthoringCheckSkill) => skillLabel(ready.skills, item.skillKey) },
          { title: '状态', width: 100, render: (_value, item: AuthoringCheckSkill) => item.status === 'ENABLED' ? '启用' : item.status === 'DISABLED' ? '停用' : item.status === null ? '缺失' : `异常（${item.status}）` },
          { title: '最高等级', dataIndex: 'maxLevel', width: 90 },
          { title: '效果', dataIndex: 'effectCount', width: 70 },
          { title: '过程', dataIndex: 'processCount', width: 70 },
          { title: '规则', dataIndex: 'triggerRuleCount', width: 70 },
          { title: '操作', width: 100, render: (_value, item: AuthoringCheckSkill) => (
            <Button
              size="mini"
              disabled={item.name === null}
              onClick={() => onLocate(authoringLocationFor(item.skillKey, 'SKILL', item.skillKey, 'SKILL_BASIC', 'skillKey'))}
            >
              录入技能
            </Button>
          ) }
        ]} />
        <Typography.Title heading={6}>直接引用（{ready.references.length}）</Typography.Title>
        <Table
          data={[...visibleReferences]}
          pagination={false}
          rowKey={item => JSON.stringify(item)}
          noDataElement={<Empty description="没有直接引用" />}
          columns={[
            {
              title: '引用来源',
              render: (_value, item: AuthoringCheckReference) => `${skillLabel(ready.skills, item.sourceSkillKey)} / ${kindName(item.sourceType)}：${referenceNameLabel(referenceSource(item), referenceNames)}`
            },
            { title: '原字段', dataIndex: 'fieldPath' },
            {
              title: '引用目标',
              render: (_value, item: AuthoringCheckReference) => [kindName(item.targetType), item.targetSkillKey, referenceNameLabel(referenceTarget(item), referenceNames)].filter(Boolean).join(' / ')
            },
            {
              title: '操作',
              width: 120,
              render: (_value, item: AuthoringCheckReference) => (
                <Button size="mini" onClick={() => locate(item.location, item.sourceSkillKey)}>定位引用处</Button>
              )
            }
          ]}
        />
        {canToggleReferences ? (
          <Button
            type="text"
            aria-expanded={referencesExpanded}
            aria-label={expandReferenceButtonLabel(ready.references.length, referencesExpanded)}
            onClick={() => setReferencesExpanded((current) => !current)}
          >
            {referencesExpanded ? '收起全部' : `展开全部（共 ${ready.references.length} 项）`}
          </Button>
        ) : null}
        <Typography.Text type="secondary">逐项人工核对资料版本、施法消耗、实际命中与目标范围、持续和提前结束、动态输入来源及护盾交互。结构检查不判断完整游戏机制；没有直接执行入口的对象也可能需要保留。</Typography.Text>
      </> : null}
    </Space>
  </Modal>;
}
