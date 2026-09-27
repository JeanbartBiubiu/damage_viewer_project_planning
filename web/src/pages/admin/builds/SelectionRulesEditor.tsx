import { Alert, Button, Input, Select, Space, Typography } from '@arco-design/web-react';
import {
  BUILD_BUDGET_SOURCE_LABELS,
  BUILD_BUDGET_SOURCES,
  type BuildBudgetSource,
  type BuildConfigurationMode,
  type BuildGroup,
  type BuildOption
} from '../../../types/build';
import {
  moveOrdered,
  type BuildFieldErrors,
  type GroupRoleDraft,
  type SelectionRulesDraft
} from './buildForm';

type Props = {
  draft: SelectionRulesDraft;
  groups: BuildGroup[];
  options: BuildOption[];
  mode: BuildConfigurationMode | '';
  disabled: boolean;
  errors: BuildFieldErrors;
  onChange: (draft: SelectionRulesDraft) => void;
};

export function SelectionRulesEditor({ draft, groups, options, mode, disabled, errors, onChange }: Props) {
  const patch = (update: Partial<SelectionRulesDraft>) => onChange({ ...draft, ...update });
  const patchRole = (index: number, update: Partial<GroupRoleDraft>) => patch({
    groupRoles: draft.groupRoles.map((role, roleIndex) => roleIndex === index ? { ...role, ...update } : role)
  });
  const groupOptions = groups.map(group => ({ value: group.groupKey, label: `${group.name} · ${group.groupKey}` }));
  const optionOptions = options.map(option => ({ value: option.optionKey, label: `${option.name} · ${option.optionKey}` }));
  const ruleErrors = Object.entries(errors).filter(([path]) => path.startsWith('selectionRules.'));
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Typography.Paragraph type="secondary">
      规则由分组角色、角色位置、单个预算、前置和互斥组成。按位置选择的投入等级固定为 1；按点投入必须写明目标等级。{mode === 'SLOT_SELECTION' ? '当前是按位置选择。' : mode === 'POINT_ALLOCATION' ? '当前是按点投入。' : '请先选择配置方式。'}
    </Typography.Paragraph>
    {ruleErrors.length ? <Alert type="error" content={<ul style={{ margin: 0, paddingLeft: 20 }}>
      {ruleErrors.map(([path, message]) => <li key={path}>{path}：{message}</li>)}
    </ul>} /> : null}
    {draft.groupRoles.map((role, index) => {
      const prefix = `selectionRules.groupRoles[${index}]`;
      const roleGroups = groups.filter(group => role.groupKeys.includes(group.groupKey));
      return <section key={index} aria-label={`分组角色${index + 1}`} style={{ border: '1px solid var(--color-border-2)', padding: 12 }}>
        <Space wrap>
          <Input aria-label={`分组角色${index + 1}标识`} addBefore="角色标识" value={role.roleKey} disabled={disabled} maxLength={64} onChange={roleKey => patchRole(index, { roleKey })} />
          <Input aria-label={`分组角色${index + 1}名称`} addBefore="名称" value={role.name} disabled={disabled} maxLength={100} onChange={name => patchRole(index, { name })} />
          <Button size="mini" disabled={disabled || index === 0} onClick={() => patch({ groupRoles: moveOrdered(draft.groupRoles, index, -1) })}>上移角色</Button>
          <Button size="mini" disabled={disabled || index === draft.groupRoles.length - 1} onClick={() => patch({ groupRoles: moveOrdered(draft.groupRoles, index, 1) })}>下移角色</Button>
          <Button size="mini" status="danger" disabled={disabled} onClick={() => patch({ groupRoles: draft.groupRoles.filter((_, roleIndex) => roleIndex !== index) })}>删除角色</Button>
        </Space>
        {errors[`${prefix}.roleKey`] ? <Typography.Text type="error">{errors[`${prefix}.roleKey`]}</Typography.Text> : null}
        {errors[`${prefix}.name`] ? <Typography.Text type="error">{errors[`${prefix}.name`]}</Typography.Text> : null}
        <Select aria-label={`分组角色${index + 1}可选分组`} mode="multiple" placeholder="选择允许的分组" style={{ width: '100%', marginTop: 8 }} disabled={disabled} value={role.groupKeys}
          options={withMissing(groupOptions, role.groupKeys)} onChange={(groupKeys: string[]) => patchRole(index, { groupKeys })} />
        {errors[`${prefix}.groupKeys`] ? <Typography.Text type="error">{errors[`${prefix}.groupKeys`]}</Typography.Text> : null}
        <Space wrap style={{ marginTop: 8 }}>
          <Input aria-label={`分组角色${index + 1}最少分组`} addBefore="最少分组" value={role.minimumGroups} disabled={disabled} onChange={minimumGroups => patchRole(index, { minimumGroups })} />
          <Input aria-label={`分组角色${index + 1}最多分组`} addBefore="最多分组" value={role.maximumGroups} disabled={disabled} onChange={maximumGroups => patchRole(index, { maximumGroups })} />
          <Input aria-label={`分组角色${index + 1}最少位置`} addBefore="最少已选位置" value={role.minimumSelectedSlots} disabled={disabled} onChange={minimumSelectedSlots => patchRole(index, { minimumSelectedSlots })} />
          <Input aria-label={`分组角色${index + 1}最多位置`} addBefore="最多已选位置" value={role.maximumSelectedSlots} disabled={disabled} onChange={maximumSelectedSlots => patchRole(index, { maximumSelectedSlots })} />
        </Space>
        <Select aria-label={`分组角色${index + 1}互异角色`} mode="multiple" placeholder="不能选择同一分组的其他角色" style={{ width: '100%', marginTop: 8 }} disabled={disabled} value={role.distinctFromRoleKeys}
          options={draft.groupRoles.filter(item => item.roleKey.trim() && item.roleKey !== role.roleKey).map(item => ({ value: item.roleKey.trim(), label: `${item.name || item.roleKey} · ${item.roleKey.trim()}` }))}
          onChange={(distinctFromRoleKeys: string[]) => patchRole(index, { distinctFromRoleKeys })} />
        {role.slotRules.map((rule, ruleIndex) => {
          const slots = roleGroups.find(group => group.groupKey === rule.groupKey)?.slots ?? [];
          return <Space key={ruleIndex} wrap style={{ marginTop: 8 }}>
            <Select aria-label={`分组角色${index + 1}位置规则${ruleIndex + 1}分组`} style={{ width: 220 }} disabled={disabled} value={rule.groupKey || undefined} placeholder="分组"
              options={withMissing(role.groupKeys.map(groupKey => ({ value: groupKey, label: groupIndexLabel(groups, groupKey) })), rule.groupKey ? [rule.groupKey] : [])}
              onChange={(groupKey: string) => patchRole(index, { slotRules: role.slotRules.map((item, itemIndex) => itemIndex === ruleIndex ? { ...item, groupKey, slotKey: '' } : item) })} />
            <Select aria-label={`分组角色${index + 1}位置规则${ruleIndex + 1}位置`} style={{ width: 220 }} disabled={disabled || !rule.groupKey} value={rule.slotKey || undefined} placeholder="位置"
              options={withMissing(slots.map(slot => ({ value: slot.slotKey, label: `${slot.name} · ${slot.slotKey}` })), rule.slotKey ? [rule.slotKey] : [])}
              onChange={(slotKey: string) => patchRole(index, { slotRules: role.slotRules.map((item, itemIndex) => itemIndex === ruleIndex ? { ...item, slotKey } : item) })} />
            <Input aria-label={`分组角色${index + 1}位置规则${ruleIndex + 1}最少`} addBefore="最少" style={{ width: 140 }} value={rule.minimumSelections} disabled={disabled} onChange={minimumSelections => patchRole(index, { slotRules: role.slotRules.map((item, itemIndex) => itemIndex === ruleIndex ? { ...item, minimumSelections } : item) })} />
            <Input aria-label={`分组角色${index + 1}位置规则${ruleIndex + 1}最多`} addBefore="最多" style={{ width: 140 }} value={rule.maximumSelections} disabled={disabled} onChange={maximumSelections => patchRole(index, { slotRules: role.slotRules.map((item, itemIndex) => itemIndex === ruleIndex ? { ...item, maximumSelections } : item) })} />
            <Button size="mini" status="danger" disabled={disabled} onClick={() => patchRole(index, { slotRules: role.slotRules.filter((_, itemIndex) => itemIndex !== ruleIndex) })}>删除位置规则</Button>
            {errors[`selectionRules.groupRoles[${index}].slotRules[${ruleIndex}].slotKey`] ? <Typography.Text type="error">{errors[`selectionRules.groupRoles[${index}].slotRules[${ruleIndex}].slotKey`]}</Typography.Text> : null}
          </Space>;
        })}
        <Button style={{ marginTop: 8 }} disabled={disabled} onClick={() => patchRole(index, { slotRules: [...role.slotRules, { groupKey: '', slotKey: '', minimumSelections: '', maximumSelections: '' }] })}>添加位置规则</Button>
      </section>;
    })}
    <Button disabled={disabled} onClick={() => patch({ groupRoles: [...draft.groupRoles, { roleKey: '', name: '', groupKeys: [], minimumGroups: '', maximumGroups: '', minimumSelectedSlots: '', maximumSelectedSlots: '', distinctFromRoleKeys: [], slotRules: [] }] })}>添加分组角色</Button>
    <section aria-label="预算规则">
      <Typography.Title heading={6}>预算</Typography.Title>
      <Typography.Paragraph type="secondary">每个构筑系统最多一个预算。不启用时，所有可选项成本必须为 0。场景显式输入的上限留空，由试配当场填写，不会自动补 0。</Typography.Paragraph>
      <Space wrap>
        <Select aria-label="是否启用预算" style={{ width: 180 }} disabled={disabled} value={draft.budgetEnabled ? 'yes' : 'no'}
          options={[{ value: 'no', label: '不使用预算' }, { value: 'yes', label: '使用一个预算' }]}
          onChange={(value: string) => patch({ budgetEnabled: value === 'yes', fixedMaximum: value === 'yes' ? draft.fixedMaximum : '' })} />
        {draft.budgetEnabled ? <>
          <Input aria-label="预算标识" addBefore="预算标识" value={draft.budgetKey} disabled={disabled} maxLength={64} onChange={budgetKey => patch({ budgetKey })} />
          <Input aria-label="预算名称" addBefore="预算名称" value={draft.budgetName} disabled={disabled} maxLength={100} onChange={budgetName => patch({ budgetName })} />
          <Select aria-label="预算上限来源" style={{ width: 180 }} disabled={disabled} value={draft.maximumSource || undefined} placeholder="选择上限来源"
            options={BUILD_BUDGET_SOURCES.map(value => ({ value, label: BUILD_BUDGET_SOURCE_LABELS[value] }))}
            onChange={(maximumSource: BuildBudgetSource) => patch({ maximumSource, fixedMaximum: maximumSource === 'SCENARIO_INPUT' ? '' : draft.fixedMaximum })} />
          {draft.maximumSource === 'FIXED' ? <Input aria-label="固定上限" addBefore="固定上限" value={draft.fixedMaximum} disabled={disabled} onChange={fixedMaximum => patch({ fixedMaximum })} /> : draft.maximumSource === 'SCENARIO_INPUT' ? <Typography.Text type="secondary">上限由场景显式输入</Typography.Text> : null}
        </> : null}
      </Space>
      {errors['selectionRules.budget'] || errors['selectionRules.budget.budgetKey'] || errors['selectionRules.budget.fixedMaximum']
        ? <Typography.Text type="error">{errors['selectionRules.budget'] || errors['selectionRules.budget.budgetKey'] || errors['selectionRules.budget.fixedMaximum']}</Typography.Text> : null}
    </section>
    <section aria-label="前置规则">
      <Typography.Title heading={6}>前置</Typography.Title>
      {draft.prerequisites.map((rule, index) => <Space key={index} wrap style={{ marginBottom: 8 }}>
        <Select aria-label={`前置${index + 1}可选项`} style={{ width: 240 }} showSearch disabled={disabled} value={rule.optionKey || undefined} placeholder="可选项" options={optionOptions} onChange={(optionKey: string) => patch({ prerequisites: draft.prerequisites.map((item, itemIndex) => itemIndex === index ? { ...item, optionKey } : item) })} />
        <Input aria-label={`前置${index + 1}等级`} addBefore="达到" value={rule.minimumRank} disabled={disabled} onChange={minimumRank => patch({ prerequisites: draft.prerequisites.map((item, itemIndex) => itemIndex === index ? { ...item, minimumRank } : item) })} />
        <Select aria-label={`前置${index + 1}要求`} style={{ width: 240 }} showSearch disabled={disabled} value={rule.requiredOptionKey || undefined} placeholder="需要的可选项" options={optionOptions} onChange={(requiredOptionKey: string) => patch({ prerequisites: draft.prerequisites.map((item, itemIndex) => itemIndex === index ? { ...item, requiredOptionKey } : item) })} />
        <Input aria-label={`前置${index + 1}要求等级`} addBefore="至少" value={rule.requiredMinimumRank} disabled={disabled} onChange={requiredMinimumRank => patch({ prerequisites: draft.prerequisites.map((item, itemIndex) => itemIndex === index ? { ...item, requiredMinimumRank } : item) })} />
        <Button size="mini" status="danger" disabled={disabled} onClick={() => patch({ prerequisites: draft.prerequisites.filter((_, itemIndex) => itemIndex !== index) })}>删除前置</Button>
      </Space>)}
      {errors['selectionRules.prerequisites'] ? <Typography.Text type="error">{errors['selectionRules.prerequisites']}</Typography.Text> : null}
      <Button disabled={disabled} onClick={() => patch({ prerequisites: [...draft.prerequisites, { optionKey: '', minimumRank: '', requiredOptionKey: '', requiredMinimumRank: '' }] })}>添加前置</Button>
    </section>
    <section aria-label="互斥规则">
      <Typography.Title heading={6}>互斥</Typography.Title>
      <Typography.Paragraph type="secondary">按不同可选项计数。同一可选项出现在两个位置，只占一个名额。</Typography.Paragraph>
      {draft.exclusions.map((rule, index) => <Space key={index} wrap style={{ marginBottom: 8 }}>
        <Select aria-label={`互斥${index + 1}可选项`} mode="multiple" style={{ width: 420 }} disabled={disabled} value={rule.optionKeys} options={optionOptions} onChange={(optionKeys: string[]) => patch({ exclusions: draft.exclusions.map((item, itemIndex) => itemIndex === index ? { ...item, optionKeys } : item) })} />
        <Input aria-label={`互斥${index + 1}上限`} addBefore="最多" value={rule.maximumSelected} disabled={disabled} onChange={maximumSelected => patch({ exclusions: draft.exclusions.map((item, itemIndex) => itemIndex === index ? { ...item, maximumSelected } : item) })} />
        <Button size="mini" status="danger" disabled={disabled} onClick={() => patch({ exclusions: draft.exclusions.filter((_, itemIndex) => itemIndex !== index) })}>删除互斥</Button>
      </Space>)}
      <Button disabled={disabled} onClick={() => patch({ exclusions: [...draft.exclusions, { optionKeys: [], maximumSelected: '' }] })}>添加互斥</Button>
    </section>
  </Space>;
}

function groupIndexLabel(groups: BuildGroup[], groupKey: string): string {
  const group = groups.find(item => item.groupKey === groupKey);
  return group ? `${group.name} · ${group.groupKey}` : `${groupKey}（未找到）`;
}

function withMissing(options: Array<{ value: string; label: string }>, selected: string[]) {
  const next = [...options];
  for (const value of selected) {
    if (value && !next.some(option => option.value === value)) next.push({ value, label: `${value}（未找到）` });
  }
  return next;
}
