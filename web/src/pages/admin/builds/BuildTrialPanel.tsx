import { Alert, Button, Input, Select, Space, Typography } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { getErrorMessage } from '../../../services/apiClient';
import { getBuildDefinition } from '../../../services/buildClient';
import {
  BUILD_CONFIGURATION_MODE_LABELS,
  BUILD_SKILL_LEVEL_MODE_LABELS,
  type BuildConfiguration,
  type BuildDefinition,
  type BuildGroupRole
} from '../../../types/build';
import { activeSkillGrants, parseBuildConfigurationDocument, validateBuildConfigurations } from './buildConfiguration';

type Props = {
  apiBaseUrl: string;
  selectedGameId: string;
  systemKey: string;
  onDirtyChange: (dirty: boolean) => void;
};

type AssignmentDraft = { roleKey: string; groupKey: string };
type SelectionDraft = { roleKey: string; groupKey: string; slotKey: string; optionKey: string; rank: string };
type TrialDraft = { assignments: AssignmentDraft[]; selections: SelectionDraft[]; scenarioBudget: string };
type TrialIssue = { path: string; message: string };

function initialDraft(definition: BuildDefinition): TrialDraft {
  return {
    assignments: definition.system.selectionRules.groupRoles.flatMap(role => (
      role.minimumGroups === role.maximumGroups && role.minimumGroups === role.groupKeys.length
        ? role.groupKeys.map(groupKey => ({ roleKey: role.roleKey, groupKey }))
        : []
    )),
    selections: [],
    scenarioBudget: ''
  };
}

function configurationValue(systemKey: string, draft: TrialDraft, budgetKey: string | null): unknown {
  const budgets: Record<string, number | string> = {};
  if (budgetKey && draft.scenarioBudget.trim() !== '') {
    budgets[budgetKey] = /^\d+$/.test(draft.scenarioBudget.trim()) ? Number(draft.scenarioBudget.trim()) : draft.scenarioBudget;
  }
  return {
    buildConfigurations: [{
      systemKey,
      groupAssignments: draft.assignments,
      selections: draft.selections.map(selection => ({
        roleKey: selection.roleKey,
        groupKey: selection.groupKey,
        slotKey: selection.slotKey,
        optionKey: selection.optionKey,
        rank: /^\d+$/.test(selection.rank.trim()) ? Number(selection.rank.trim()) : selection.rank
      })),
      budgets
    }]
  };
}

export function BuildTrialPanel({ apiBaseUrl, selectedGameId, systemKey, onDirtyChange }: Props) {
  const [definition, setDefinition] = useState<BuildDefinition | null>(null);
  const [draft, setDraft] = useState<TrialDraft>({ assignments: [], selections: [], scenarioBudget: '' });
  const [initial, setInitial] = useState<TrialDraft>({ assignments: [], selections: [], scenarioBudget: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<TrialIssue[] | null>(null);
  const [notices, setNotices] = useState<TrialIssue[]>([]);
  const [checked, setChecked] = useState<BuildConfiguration | null>(null);
  const active = useRef(true);
  const serial = useRef(0);

  const load = async () => {
    const request = ++serial.current;
    setLoading(true); setError(null); setDefinition(null); setIssues(null); setNotices([]); setChecked(null);
    try {
      const result = await getBuildDefinition(apiBaseUrl, selectedGameId, systemKey);
      if (!active.current || request !== serial.current) return;
      setDefinition(result.data);
      const next = initialDraft(result.data);
      setDraft(next);
      setInitial(next);
    } catch (cause) {
      if (active.current && request === serial.current) setError(getErrorMessage(cause));
    } finally {
      if (active.current && request === serial.current) setLoading(false);
    }
  };
  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; serial.current += 1; onDirtyChange(false); };
  }, [apiBaseUrl, selectedGameId, systemKey, onDirtyChange]);
  useEffect(() => { onDirtyChange(JSON.stringify(draft) !== JSON.stringify(initial)); }, [draft, initial, onDirtyChange]);
  const validate = () => {
    if (!definition) return;
    setIssues(null); setNotices([]); setChecked(null);
    const budget = definition.system.selectionRules.budget;
    const budgetKey = budget?.maximumSource === 'SCENARIO_INPUT' ? budget.budgetKey : null;
    let document;
    try {
      document = parseBuildConfigurationDocument(configurationValue(definition.system.systemKey, draft, budgetKey));
    } catch (cause) {
      const path = cause instanceof Error && 'path' in cause && typeof cause.path === 'string' ? cause.path : 'buildConfigurations';
      setIssues([{ path, message: cause instanceof Error ? cause.message : '完整配置不符合约定。' }]);
      return;
    }
    const result = validateBuildConfigurations(selectedGameId, [definition], document.buildConfigurations);
    setIssues(result.errors);
    setNotices(result.notices);
    setChecked(result.ok ? document.buildConfigurations[0] ?? null : null);
  };
  const groupsOf = (role: BuildGroupRole) => definition?.groups.filter(group => role.groupKeys.includes(group.groupKey)) ?? [];
  const takenByDistinct = (role: BuildGroupRole) => {
    const distinctRoles = new Set(definition?.system.selectionRules.groupRoles
      .filter(other => role.distinctFromRoleKeys.includes(other.roleKey) || other.distinctFromRoleKeys.includes(role.roleKey))
      .map(other => other.roleKey) ?? []);
    return new Set(draft.assignments
    .filter(item => distinctRoles.has(item.roleKey))
    .map(item => item.groupKey));
  };
  return <Panel title="试配与校验">
    <Alert type="info" style={{ marginBottom: 12 }} content="试配只在当前页面校验，不会保存方案，也不会调用战斗运行。规则只来自这一次完整定义快照。" />
    {error ? <Alert type="error" content={error} action={<Button size="mini" onClick={() => void load()}>重新读取</Button>} /> : null}
    {loading ? <Typography.Text>正在读取构筑定义。</Typography.Text> : null}
    {definition ? <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text>当前系统：{definition.system.name}（{definition.system.systemKey}）· {BUILD_CONFIGURATION_MODE_LABELS[definition.system.configurationMode]}</Typography.Text>
      {definition.system.selectionRules.groupRoles.map(role => {
        const selected = draft.assignments.filter(item => item.roleKey === role.roleKey).map(item => item.groupKey);
        const blocked = takenByDistinct(role);
        return <section key={role.roleKey} aria-label={`试配角色${role.name}`}>
          <Typography.Title heading={6}>{role.name}（{role.roleKey}）</Typography.Title>
          <Typography.Paragraph type="secondary">选择 {role.minimumGroups}～{role.maximumGroups} 个分组，已选位置 {role.minimumSelectedSlots}～{role.maximumSelectedSlots} 个。</Typography.Paragraph>
          <Select aria-label={`试配角色${role.name}分组`} mode="multiple" style={{ width: '100%' }} value={selected}
            options={groupsOf(role).map(group => ({ value: group.groupKey, label: `${group.name} · ${group.groupKey}`, disabled: blocked.has(group.groupKey) }))}
            onChange={(groupKeys: string[]) => setDraft({
              ...draft,
              assignments: [
                ...draft.assignments.filter(item => item.roleKey !== role.roleKey),
                ...groupKeys.map(groupKey => ({ roleKey: role.roleKey, groupKey }))
              ],
              selections: draft.selections.filter(item => item.roleKey !== role.roleKey || groupKeys.includes(item.groupKey))
            })} />
          {selected.map(groupKey => {
            const group = definition.groups.find(item => item.groupKey === groupKey);
            if (!group) return null;
            return <div key={groupKey} style={{ marginTop: 8 }}>
              <Typography.Text>{group.name}（{group.groupKey}）</Typography.Text>
              {role.slotRules.filter(rule => rule.groupKey === groupKey).map(slotRule => {
                const slot = group.slots.find(item => item.slotKey === slotRule.slotKey);
                if (!slot) return null;
                const rows = draft.selections.filter(item => item.roleKey === role.roleKey && item.groupKey === groupKey && item.slotKey === slot.slotKey);
                return <div key={slot.slotKey} style={{ marginLeft: 12, marginTop: 8 }}>
                  <Typography.Text type="secondary">{slot.name}（{slot.slotKey}）最少 {slotRule.minimumSelections}，最多 {slotRule.maximumSelections}</Typography.Text>
                  {rows.map((row, index) => <Space key={`${slot.slotKey}-${index}`} style={{ marginTop: 8 }}>
                    <Select aria-label={`${slot.name}选择${index + 1}`} style={{ width: 280 }} value={row.optionKey || undefined}
                      options={slot.optionKeys.map(optionKey => {
                        const option = definition.options.find(item => item.optionKey === optionKey);
                        return { value: optionKey, label: option ? `${option.name} · ${optionKey}` : `${optionKey}（未找到）` };
                      })}
                      onChange={(optionKey: string) => setDraft({
                        ...draft,
                        selections: draft.selections.map(item => item === row ? { ...item, optionKey } : item)
                      })} />
                    <Input aria-label={`${slot.name}投入等级${index + 1}`} addBefore="投入等级" style={{ width: 180 }} value={row.rank}
                      disabled={definition.system.configurationMode === 'SLOT_SELECTION'}
                      onChange={rank => setDraft({ ...draft, selections: draft.selections.map(item => item === row ? { ...item, rank } : item) })} />
                    <Button size="mini" onClick={() => setDraft({ ...draft, selections: draft.selections.filter(item => item !== row) })}>移除选择</Button>
                  </Space>)}
                  <Button style={{ marginTop: 8 }} disabled={rows.length >= slotRule.maximumSelections || slot.optionKeys.length === 0} onClick={() => setDraft({
                    ...draft,
                    selections: [...draft.selections, {
                      roleKey: role.roleKey, groupKey, slotKey: slot.slotKey, optionKey: '',
                      rank: definition.system.configurationMode === 'SLOT_SELECTION' ? '1' : ''
                    }]
                  })}>添加选择</Button>
                </div>;
              })}
            </div>;
          })}
        </section>;
      })}
      {definition.system.selectionRules.budget?.maximumSource === 'FIXED'
        ? <Alert type="info" content={`固定预算「${definition.system.selectionRules.budget.name}」上限 ${definition.system.selectionRules.budget.fixedMaximum}。试配不会再次提交这个上限。`} />
        : null}
      {definition.system.selectionRules.budget?.maximumSource === 'SCENARIO_INPUT'
        ? <Input aria-label="场景预算" addBefore={definition.system.selectionRules.budget.name} placeholder="留空表示尚未输入，不会自动补 0" value={draft.scenarioBudget} onChange={scenarioBudget => setDraft({ ...draft, scenarioBudget })} />
        : null}
      <Button type="primary" onClick={validate}>校验当前试配</Button>
      {issues ? <section aria-label="试配结果">
        {issues.length === 0 ? <Alert type="success" content="当前角色构筑通过结构校验。这不表示宿主已装配，也不表示战斗已运行。" /> : issues.map(issue => <Alert key={`${issue.path}:${issue.message}`} type="error" style={{ marginBottom: 8 }} content={`${issue.path}：${issue.message}`} />)}
        {notices.map(issue => <Alert key={`${issue.path}:${issue.message}`} type="warning" style={{ marginTop: 8 }} content={`${issue.path}：${issue.message}`} />)}
        {checked ? checked.selections.map((selection, index) => {
          const grants = activeSkillGrants(definition.skillRelations, selection.optionKey, selection.rank).filter(grant => grant.skillStatus === 'ENABLED');
          if (!grants.length) return null;
          const option = definition.options.find(item => item.optionKey === selection.optionKey);
          return <div key={index}>
            {grants.map(grant => <Typography.Paragraph key={`${grant.skillKey}:${grant.activationRank}`}>
              定义授予：{grant.skillName}（{grant.skillKey}），来自 {option?.name ?? selection.optionKey}（{selection.optionKey}），投入等级 {selection.rank} 时生效，技能等级为{BUILD_SKILL_LEVEL_MODE_LABELS[grant.skillLevelMode]}{grant.fixedSkillLevel === null ? '' : ` ${grant.fixedSkillLevel}`}。这不是战斗计算结果。
            </Typography.Paragraph>)}
          </div>;
        }) : null}
      </section> : null}
    </Space> : null}
  </Panel>;
}
