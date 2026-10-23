import { SKILL_TRIGGER_EVENT_TYPE_LABELS } from '../../types/skillSystemEnums.generated';
import { Checkbox, Select, Table, Typography } from '@arco-design/web-react';
import { simulationSkillSourceIdentity } from '../../services/simulationSkillSourceIdentity';
import type { SimulationSkillInactiveReason, SimulationSkillSetting, SimulationSkillSource, SimulationSnapshot } from '../../types/simulationSnapshot';

type Props = {
  side: 'source' | 'target';
  snapshot: SimulationSnapshot | null;
  sources: SimulationSkillSource[];
  settings: SimulationSkillSetting[];
  basicAttackSkillKey: string;
  basicAttackLevel: number | undefined;
  stale: boolean;
  clearedLevels: Record<string, boolean>;
  disabled: boolean;
  onChange: (source: SimulationSkillSource, patch: { enabled?: boolean; skillLevel?: number }) => void;
};

const reasonLabels: Record<SimulationSkillInactiveReason, string> = {
  GLOBAL_DISABLED: '全局禁用，本场不能重开', SCENE_DISABLED: '本场关闭', UNLEARNED: '未学（等级0）',
  NO_AUTONOMOUS_ATTACK: '本场没有该来源的自身攻击入口', ACTIVE_DEFERRED: '仅主动入口，阶段6暂缓',
  NO_REACHABLE_EVENT: '本场无可达事件',
  CONFIGURATION_INCOMPLETE: '自然程序尚未配置完整', LEVEL_REQUIRED: '自然程序仍需明确技能等级'
};
export function SimulationSkillSources({ side, snapshot, sources, settings, basicAttackSkillKey, basicAttackLevel, stale, clearedLevels, disabled, onChange }: Props) {
  const label = side === 'source' ? '攻击方' : '目标';
  return <section className="simulation-skill-sources" aria-label={`${label}默认技能来源`}>
    <Typography.Title heading={6}>默认技能来源</Typography.Title>
    <Typography.Paragraph type="secondary">角色来源技能默认最高等级，可改低或选0未学；关闭不删除原关系、装备属性或构筑选择。{stale ? '来源设置已改变，需重新读取快照。' : ''}</Typography.Paragraph>
    {!snapshot ? <Typography.Paragraph type="secondary">读取场景快照后自动列出角色、装备及构筑的实际绑定。</Typography.Paragraph> : null}
    {(['CHARACTER', 'EQUIPMENT', 'BUILD_OPTION'] as const).map(kind => {
      const rows = sources.filter(source => source.origin.kind === kind);
      return <section key={kind} aria-label={`${label}${kind === 'CHARACTER' ? '角色' : kind === 'EQUIPMENT' ? '装备' : '构筑'}技能来源`}>
        <Typography.Text>{kind === 'CHARACTER' ? '角色绑定' : kind === 'EQUIPMENT' ? '已选装备' : '已选构筑'}</Typography.Text>
        {rows.length ? <Table<SimulationSkillSource> data={rows} pagination={false} scroll={{ x: 680 }}
          rowKey={row => simulationSkillSourceIdentity(row.origin, row.skillKey)} columns={[
            { title: '来源／技能', width: 200, render: (_, source) => {
              const origin = source.origin;
              const name = origin.kind === 'CHARACTER' ? origin.characterKey : origin.kind === 'EQUIPMENT' ? origin.equipmentKey
                : `${origin.systemKey}／${origin.roleKey}／${origin.groupKey}／${origin.slotKey}／${origin.optionKey}`;
              return <span>{source.skillName}（{source.skillKey}）<br /><Typography.Text type="secondary">{name}</Typography.Text></span>;
            } },
            { title: '本场开关', width: 90, render: (_, source) => {
              const setting = settings.find(item => simulationSkillSourceIdentity(item.origin, item.skillKey) === simulationSkillSourceIdentity(source.origin, source.skillKey));
              return <Checkbox aria-label={`${label}来源 ${simulationSkillSourceIdentity(source.origin, source.skillKey)} 开启`}
                checked={setting?.enabled ?? (stale ? true : source.enabled)} disabled={disabled || source.skillStatus === 'DISABLED'}
                onChange={enabled => onChange(source, { enabled })}>开启</Checkbox>;
            } },
            { title: '最终等级', width: 140, render: (_, source) => {
              const setting = settings.find(item => simulationSkillSourceIdentity(item.origin, item.skillKey) === simulationSkillSourceIdentity(source.origin, source.skillKey));
              const selectedAttack = side === 'source' && source.origin.kind === 'CHARACTER' && source.skillKey === basicAttackSkillKey;
              const level = selectedAttack ? basicAttackLevel : clearedLevels[`${side}:${simulationSkillSourceIdentity(source.origin, source.skillKey)}`] ? null : setting?.skillLevel ?? source.skillLevel;
              const maximum = snapshot?.skillConfigurations.find(configuration => configuration.skill.skillKey === source.skillKey)?.skill.maxLevel;
              if (source.origin.kind !== 'CHARACTER' || selectedAttack) return level == null ? '未供值' : `${level}${selectedAttack ? '（沿所选普攻）' : ''}`;
              return <Select aria-label={`${label}来源 ${simulationSkillSourceIdentity(source.origin, source.skillKey)} 等级`} value={level ?? undefined}
                allowClear disabled={disabled || source.skillStatus === 'DISABLED' || maximum === undefined}
                options={maximum === undefined ? [] : Array.from({ length: maximum + 1 }, (_, rank) => ({ value: rank, label: rank === 0 ? '0（未学）' : String(rank) }))}
                placeholder="需明确供值" onChange={(skillLevel: number | undefined) => onChange(source, { skillLevel })} />;
            } },
            { title: '自然入口／未执行原因', render: (_, source) => {
              const setting = settings.find(item => simulationSkillSourceIdentity(item.origin, item.skillKey) === simulationSkillSourceIdentity(source.origin, source.skillKey));
              const selectedAttack = side === 'source' && source.origin.kind === 'CHARACTER' && source.skillKey === basicAttackSkillKey;
              const level = selectedAttack ? basicAttackLevel : clearedLevels[`${side}:${simulationSkillSourceIdentity(source.origin, source.skillKey)}`] ? null : setting?.skillLevel ?? source.skillLevel;
              const reason = source.skillStatus === 'DISABLED' ? 'GLOBAL_DISABLED' : (setting?.enabled ?? (stale ? true : source.enabled)) === false ? 'SCENE_DISABLED'
                : level === 0 ? 'UNLEARNED' : stale ? null : source.inactiveReason;
              const configuration = snapshot?.skillConfigurations.find(item => item.skill.skillKey === source.skillKey);
              const roots = source.enabledRuleKeys.map(ruleKey => {
                const event = configuration?.triggerRules.find(rule => rule.ruleKey === ruleKey)?.eventSource.eventType;
                return `${event ? SKILL_TRIGGER_EVENT_TYPE_LABELS[event] : '入口'}（${ruleKey}）`;
              });
              const activeDeferred = configuration?.triggerRules.some(rule => !source.enabledRuleKeys.includes(rule.ruleKey)
                && (rule.eventSource.eventType === 'SKILL_USED' || rule.eventSource.eventType === 'SKILL_HIT'));
              return <span>{reason ? reasonLabels[reason] : stale ? '等待重新读取自然入口与最终等级' : roots.join('；') || '没有本期可执行自然入口'}
                {activeDeferred && source.inactiveReason !== 'ACTIVE_DEFERRED' ? <><br />主动使用／技能命中入口暂缓，不自动施放。</> : null}
                {selectedAttack ? <><br />所选普攻仅驱动一次，不作为附加技能重编。</> : null}</span>;
            } }
          ]} /> : <Typography.Paragraph type="secondary">尚无此类来源。</Typography.Paragraph>}
      </section>;
    })}
    <section aria-label={`${label}额外技能与强化`} className="simulation-extra-skill-placeholder">
      <Typography.Text>额外技能与强化</Typography.Text>
      <Typography.Paragraph type="secondary">未开放；仅保留位置，不提供选择器或额外请求字段。</Typography.Paragraph>
    </section>
  </section>;
}
