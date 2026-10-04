import { Alert, Button, Input, Select, Space, Typography } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../services/apiClient';
import { getBuildDefinition, listBuildSystems } from '../../services/buildClient';
import type { BuildConfiguration, BuildDefinition, SimulationSelectedBuild } from '../../types/simulationSnapshot';
import type { BuildGroupRole, BuildSystem } from '../../types/build';
import { parseBuildConfigurationDocument, validateBuildConfigurations } from '../admin/builds/buildConfiguration';

type Draft = {
  groupAssignments: BuildConfiguration['groupAssignments'];
  selections: Array<Omit<BuildConfiguration['selections'][number], 'rank'> & { rank: string }>;
  scenarioBudget: string;
};

type Props = {
  apiBaseUrl: string;
  gameId: string | null;
  token: string;
  side: 'source' | 'target';
  disabled: boolean;
  selectedBuilds: SimulationSelectedBuild[] | undefined;
  onEdit: (systemKeys: string[]) => void;
  onConfirm: (configurations: BuildConfiguration[], definitions: BuildDefinition[]) => void;
};

const emptyDraft = (): Draft => ({ groupAssignments: [], selections: [], scenarioBudget: '' });

export function SimulationBuildConfigurationEditor({ apiBaseUrl, gameId, token, side, disabled, selectedBuilds, onEdit, onConfirm }: Props) {
  const label = side === 'source' ? '攻击方' : '目标';
  const [systems, setSystems] = useState<BuildSystem[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [definitions, setDefinitions] = useState<Record<string, BuildDefinition>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [loadingDefinitions, setLoadingDefinitions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const active = useRef(true);
  const listRequest = useRef(0);
  const definitionRequest = useRef(0);

  const load = async () => {
    const request = ++listRequest.current;
    if (!gameId || !token) return;
    setLoading(true); setError(null);
    try {
      const result = await listBuildSystems(apiBaseUrl, gameId, token);
      if (active.current && request === listRequest.current) setSystems(result.data.items);
    } catch (cause) {
      if (active.current && request === listRequest.current) setError(getErrorMessage(cause));
    } finally {
      if (active.current && request === listRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    active.current = true;
    setSystems([]); setSelectedKeys([]); setDefinitions({}); setDrafts({});
    setLoading(false); setLoadingDefinitions(false); setError(null); setIssues([]); setConfirmed(false);
    void load();
    return () => { active.current = false; listRequest.current += 1; definitionRequest.current += 1; };
  }, [apiBaseUrl, gameId, token]);

  useEffect(() => {
    if (!selectedBuilds?.length) return;
    setDefinitions(current => ({ ...current, ...Object.fromEntries(selectedBuilds.filter(build => build.definition.system.gameId === gameId)
      .map(build => [build.definition.system.systemKey, build.definition])) }));
  }, [selectedBuilds, gameId]);

  const selectSystems = async (keys: string[]) => {
    if (disabled || !gameId) return;
    const request = ++definitionRequest.current;
    setSelectedKeys(keys);
    setDrafts(current => Object.fromEntries(keys.map(key => [key, current[key] ?? emptyDraft()])));
    setIssues([]); setConfirmed(false); setError(null); onEdit(keys);
    if (!keys.length) { setLoadingDefinitions(false); onConfirm([], []); return; }
    setLoadingDefinitions(true);
    try {
      const loaded = await Promise.all(keys.map(async key => definitions[key] ?? (await getBuildDefinition(apiBaseUrl, gameId, key, token)).data));
      if (active.current && request === definitionRequest.current) {
        setDefinitions(Object.fromEntries(loaded.map(definition => [definition.system.systemKey, definition])));
      }
    } catch (cause) {
      if (active.current && request === definitionRequest.current) setError(getErrorMessage(cause));
    } finally {
      if (active.current && request === definitionRequest.current) setLoadingDefinitions(false);
    }
  };

  const patch = (systemKey: string, next: Draft) => {
    setDrafts(current => ({ ...current, [systemKey]: next }));
    setIssues([]); setConfirmed(false); onEdit(selectedKeys);
  };

  const confirm = () => {
    if (!gameId || disabled || selectedKeys.some(key => !definitions[key])) return;
    try {
      const parsed = parseBuildConfigurationDocument({ buildConfigurations: selectedKeys.map(systemKey => {
        const draft = drafts[systemKey]!;
        const budget = definitions[systemKey]!.system.selectionRules.budget;
        return { systemKey, groupAssignments: draft.groupAssignments,
          selections: draft.selections.map(selection => ({ ...selection, rank: /^\d+$/.test(selection.rank) ? Number(selection.rank) : selection.rank })),
          budgets: budget?.maximumSource === 'SCENARIO_INPUT' && draft.scenarioBudget !== ''
            ? { [budget.budgetKey]: /^\d+$/.test(draft.scenarioBudget) ? Number(draft.scenarioBudget) : draft.scenarioBudget } : {} };
      }) });
      const checked = validateBuildConfigurations(gameId, selectedKeys.map(key => definitions[key]!), parsed.buildConfigurations);
      const errors = checked.errors.filter(issue => issue.message !== '停用技能的授予不能进入可运行配置。');
      setIssues(errors.map(issue => `${issue.path}：${issue.message}`));
      if (errors.length) return;
      onConfirm(parsed.buildConfigurations, selectedKeys.map(key => definitions[key]!));
      setConfirmed(true);
    } catch (cause) { setIssues([getErrorMessage(cause)]); }
  };

  const controlsDisabled = disabled || loadingDefinitions;
  return <section className="simulation-build-editor" aria-label={`${label}构筑配置`}>
    <Typography.Title heading={6}>{label}构筑</Typography.Title>
    <Select aria-label={`${label}构筑系统`} mode="multiple" allowClear showSearch style={{ width: '100%' }}
      value={selectedKeys} loading={loading} disabled={disabled || loading || !gameId || !token}
      options={systems.map(system => ({ value: system.systemKey, label: `${system.name}（${system.systemKey}）` }))}
      placeholder="可留空，不自动选择推荐构筑" onChange={(keys: string[]) => void selectSystems(keys)} />
    {error ? <Alert type="error" content={`构筑读取失败：${error}`} action={<Button size="mini" disabled={disabled || loading}
      onClick={() => selectedKeys.length ? void selectSystems(selectedKeys) : void load()}>重试构筑读取</Button>} /> : null}
    {selectedKeys.map(systemKey => {
      const definition = definitions[systemKey];
      const draft = drafts[systemKey];
      if (!definition || !draft) return null;
      const takenByDistinct = (role: BuildGroupRole) => {
        const distinct = new Set(definition.system.selectionRules.groupRoles.filter(other => role.distinctFromRoleKeys.includes(other.roleKey)
          || other.distinctFromRoleKeys.includes(role.roleKey)).map(other => other.roleKey));
        return new Set(draft.groupAssignments.filter(item => distinct.has(item.roleKey)).map(item => item.groupKey));
      };
      return <section key={systemKey} aria-label={`${label}构筑 ${definition.system.name}`}>
        <Typography.Title heading={6}>{definition.system.name}</Typography.Title>
        {definition.system.selectionRules.groupRoles.map(role => {
          const groups = draft.groupAssignments.filter(item => item.roleKey === role.roleKey).map(item => item.groupKey);
          const blocked = takenByDistinct(role);
          return <div key={role.roleKey}>
            <Typography.Paragraph>{role.name}：分组{role.minimumGroups}～{role.maximumGroups}，已选位置{role.minimumSelectedSlots}～{role.maximumSelectedSlots}。</Typography.Paragraph>
            <Select aria-label={`${label}${definition.system.name}${role.name}分组`} mode="multiple" style={{ width: '100%' }}
              value={groups} disabled={controlsDisabled} options={definition.groups.filter(group => role.groupKeys.includes(group.groupKey))
                .map(group => ({ value: group.groupKey, label: `${group.name}（${group.groupKey}）`, disabled: blocked.has(group.groupKey) }))}
              onChange={(groupKeys: string[]) => patch(systemKey, { ...draft,
                groupAssignments: [...draft.groupAssignments.filter(item => item.roleKey !== role.roleKey), ...groupKeys.map(groupKey => ({ roleKey: role.roleKey, groupKey }))],
                selections: draft.selections.filter(item => item.roleKey !== role.roleKey || groupKeys.includes(item.groupKey)) })} />
            {groups.map(groupKey => {
              const group = definition.groups.find(item => item.groupKey === groupKey);
              if (!group) return null;
              return <div key={groupKey}>
                {role.slotRules.filter(rule => rule.groupKey === groupKey).map(rule => {
                  const slot = group.slots.find(item => item.slotKey === rule.slotKey);
                  if (!slot) return null;
                  const selections = draft.selections.filter(item => item.roleKey === role.roleKey && item.groupKey === groupKey && item.slotKey === slot.slotKey);
                  const slotLabel = `${label}${role.name}${group.name}${slot.name}`;
                  return <div key={slot.slotKey} className="simulation-build-slot">
                    <Typography.Paragraph>{group.name}／{slot.name}：选择{rule.minimumSelections}～{rule.maximumSelections}项。</Typography.Paragraph>
                    {selections.map((selection, index) => <Space wrap key={index} className="simulation-build-selection">
                      <Select aria-label={`${slotLabel}选择${index + 1}`} value={selection.optionKey || undefined} disabled={controlsDisabled}
                        style={{ width: '100%' }} options={slot.optionKeys.map(optionKey => ({ value: optionKey,
                          label: `${definition.options.find(option => option.optionKey === optionKey)?.name ?? optionKey}（${optionKey}）` }))}
                        onChange={(optionKey: string) => patch(systemKey, { ...draft, selections: draft.selections.map(item => item === selection ? { ...item, optionKey } : item) })} />
                      <Input aria-label={`${slotLabel}投入等级${index + 1}`} addBefore="投入等级" value={selection.rank}
                        disabled={controlsDisabled || definition.system.configurationMode === 'SLOT_SELECTION'} placeholder="需明确填写"
                        onChange={rank => patch(systemKey, { ...draft, selections: draft.selections.map(item => item === selection ? { ...item, rank } : item) })} />
                      <Button size="mini" disabled={controlsDisabled} onClick={() => patch(systemKey, { ...draft, selections: draft.selections.filter(item => item !== selection) })}>移除选择</Button>
                    </Space>)}
                    <Button size="mini" disabled={controlsDisabled || selections.length >= rule.maximumSelections || !slot.optionKeys.length}
                      onClick={() => patch(systemKey, { ...draft, selections: [...draft.selections, { roleKey: role.roleKey, groupKey,
                        slotKey: slot.slotKey, optionKey: '', rank: definition.system.configurationMode === 'SLOT_SELECTION' ? '1' : '' }] })}>添加选择</Button>
                  </div>;
                })}
              </div>;
            })}
          </div>;
        })}
        {definition.system.selectionRules.budget?.maximumSource === 'SCENARIO_INPUT' ? <Input aria-label={`${label}${definition.system.name}场景预算`}
          addBefore={definition.system.selectionRules.budget.name} value={draft.scenarioBudget} disabled={controlsDisabled} placeholder="必须明确填写；0不等于未填"
          onChange={scenarioBudget => patch(systemKey, { ...draft, scenarioBudget })} /> : null}
        {definition.system.selectionRules.budget?.maximumSource === 'FIXED' ? <Typography.Paragraph>
          固定预算：{definition.system.selectionRules.budget.fixedMaximum}，不重复提交上限。
        </Typography.Paragraph> : null}
      </section>;
    })}
    {selectedKeys.length ? <Button disabled={controlsDisabled || Boolean(error) || selectedKeys.some(key => !definitions[key])} onClick={confirm}>确认{label}完整构筑</Button> : null}
    {issues.map(issue => <Alert key={issue} type="error" content={issue} />)}
    {confirmed ? <Typography.Paragraph type="secondary">完整选择已确认；重新读取场景后按实际授予生成来源，不另选技能。全局禁用授予保留绑定，不可在本场重开。</Typography.Paragraph> : null}
  </section>;
}
