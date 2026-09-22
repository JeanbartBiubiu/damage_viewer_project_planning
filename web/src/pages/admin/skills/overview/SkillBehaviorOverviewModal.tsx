import { Alert, Button, Empty, Modal, Space, Table, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthoringLocation } from '../../../../types/authoringLocation';
import type { Skill } from '../../../../types/skill';
import { AUTHORING_NOT_BATTLE_VERIFIED } from '../authoringFocus';
import { loadSkillBehaviorOverview, overviewIncompleteReasons, type SkillBehaviorOverviewBundle } from './loadSkillBehaviorOverview';
import {
  SKILL_BEHAVIOR_AUXILIARY_LABEL,
  SKILL_BEHAVIOR_GROUP_IDS,
  SKILL_BEHAVIOR_GROUP_LABELS,
  SKILL_BEHAVIOR_SUPPLEMENT_LABEL,
  buildSkillBehaviorOverview,
  type SkillBehaviorEntry,
  type SkillBehaviorGroupId
} from './skillBehaviorOverview';

type Props = {
  visible: boolean;
  skill: Skill | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  refreshNonce?: number;
  onClose: () => void;
  onEdit: (location: AuthoringLocation) => void;
};

function entryColumns(onEdit: (location: AuthoringLocation) => void) {
  return [
    { title: '来源', render: (_value: unknown, item: SkillBehaviorEntry) => `${item.sourceKindLabel}：${item.sourceName}（${item.sourceKey}）` },
    { title: '事件/过程时点', width: 220, render: (_value: unknown, item: SkillBehaviorEntry) => item.momentLabel ?? '—' },
    { title: '作用对象', width: 140, render: (_value: unknown, item: SkillBehaviorEntry) => item.targetLabel ?? '—' },
    { title: '数值或引用来源', width: 220, render: (_value: unknown, item: SkillBehaviorEntry) => item.valueSourceLabel ?? '—' },
    {
      title: '说明',
      width: 260,
      render: (_value: unknown, item: SkillBehaviorEntry) => item.notes.join('；') || '—'
    },
    {
      title: '操作',
      width: 100,
      render: (_value: unknown, item: SkillBehaviorEntry) => (
        <Button size="mini" onClick={() => onEdit(item.location)}>编辑</Button>
      )
    }
  ];
}

export function SkillBehaviorOverviewModal({
  visible, skill, apiBaseUrl, selectedGameId, adminToken, refreshNonce = 0, onClose, onEdit
}: Props) {
  const [bundle, setBundle] = useState<SkillBehaviorOverviewBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const context = JSON.stringify([apiBaseUrl, selectedGameId, adminToken, skill?.skillKey, refreshNonce]);
  const skillKey = skill?.skillKey ?? null;

  const load = useCallback(async () => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    setError(null);
    setBundle(null);
    if (!visible || !selectedGameId || !skillKey || !adminToken.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await loadSkillBehaviorOverview({
        apiBaseUrl,
        gameId: selectedGameId,
        skillKey,
        token: adminToken.trim(),
        generation: requestGeneration
      }, (value) => generation.current === value);
      if (generation.current !== requestGeneration) return;
      if (!result) return;
      setBundle(result);
    } catch (failure) {
      if (generation.current === requestGeneration) setError(failure instanceof Error ? failure.message : '总览读取失败');
    } finally {
      if (generation.current === requestGeneration) setLoading(false);
    }
  }, [adminToken, apiBaseUrl, selectedGameId, skillKey, visible]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load, context]);

  const model = bundle && skillKey
    ? buildSkillBehaviorOverview({
      skillKey,
      skillName: skill?.name ?? skillKey,
      parameters: bundle.parameters.items,
      formulas: bundle.formulas.items,
      effects: bundle.effects.details,
      processes: bundle.processes.details,
      internalStates: bundle.internalStates.details,
      rules: bundle.rules.details,
      detailsComplete: bundle.complete
    })
    : null;
  const incomplete = bundle ? overviewIncompleteReasons(bundle) : [];
  const edit = (itemLocation: AuthoringLocation) => {
    onEdit(itemLocation);
  };

  return (
    <Modal
      title={skill ? `行为总览 · ${skill.name}` : '行为总览'}
      visible={visible && !!skill}
      onCancel={onClose}
      style={{ width: 'calc(100vw - 80px)', maxWidth: 1500 }}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="medium">
        <Space wrap>
          <Button loading={loading} disabled={!adminToken.trim() || !selectedGameId} onClick={() => void load()}>重试</Button>
        </Space>
        <Alert type="info" content={AUTHORING_NOT_BATTLE_VERIFIED} />
        {loading ? <Typography.Text>正在读取技能、效果、过程与规则…</Typography.Text> : null}
        {error ? <Alert type="error" content={error} /> : null}
        {incomplete.length ? <Alert type="warning" content={`总览不完整：${incomplete.join('；')}。已保留成功读取的部分。`} /> : null}
        {model ? SKILL_BEHAVIOR_GROUP_IDS.map((group: SkillBehaviorGroupId) => (
          <div key={group}>
            <Typography.Title heading={6}>{SKILL_BEHAVIOR_GROUP_LABELS[group]}</Typography.Title>
            <Table
              data={model.groups[group]}
              pagination={false}
              rowKey="id"
              columns={entryColumns(edit)}
              noDataElement={<Empty description={`没有已归入「${SKILL_BEHAVIOR_GROUP_LABELS[group]}」的已保存配置`} />}
            />
          </div>
        )) : null}
        {model ? (
          <div>
            <Typography.Title heading={6}>{SKILL_BEHAVIOR_SUPPLEMENT_LABEL}</Typography.Title>
            <Table
              data={model.supplement}
              pagination={false}
              rowKey="id"
              columns={entryColumns(edit)}
              noDataElement={<Empty description="没有未归类规则、未挂接效果或五组未覆盖的过程" />}
            />
          </div>
        ) : null}
        {model ? (
          <div>
            <Typography.Title heading={6}>{SKILL_BEHAVIOR_AUXILIARY_LABEL}</Typography.Title>
            <Table
              data={model.auxiliary}
              pagination={false}
              rowKey="id"
              columns={entryColumns(edit)}
              noDataElement={<Empty description="没有参数、公式或内部状态" />}
            />
          </div>
        ) : null}
      </Space>
    </Modal>
  );
}
