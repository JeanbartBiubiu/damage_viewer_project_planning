import type { ReactNode } from 'react';
import { Alert, Button, Form, Select, Switch } from '@arco-design/web-react';
import { SimulationEntitySelect } from './SimulationEntitySelect';
import { SimulationEquipmentSelect } from './SimulationEquipmentSelect';
import { SimulationEntityOptionLabel } from './SimulationEntityOptionLabel';
import type { SimulationEntityOption, SimulationImageLoader } from './simulationSelectionOptions';

export type CombatSkillRow = {
  key: string;
  name: string;
  maxLevel: number;
  kind: 'basic' | 'active' | 'passive';
  level: number | undefined;
  enabled: boolean;
  disabled?: boolean;
  hint?: string;
};

export type CombatantSetup = {
  characterKey: string;
  level: number | undefined;
  equipmentKeys: string[];
  skills: CombatSkillRow[];
  skillsLoading: boolean;
  basicAttackFallback?: { enabled: boolean; onChange: (enabled: boolean) => void };
  extra: ReactNode;
  onCharacter: (value: string) => void;
  onLevel: (value: number | undefined) => void;
  onEquipment: (keys: string[]) => void;
  onSkill: (key: string, patch: { enabled?: boolean; skillLevel?: number }) => void;
};

export type CombatScenarioSetupProps = {
  source: CombatantSetup;
  target: CombatantSetup;
  characters: SimulationEntityOption[];
  charactersLoading: boolean;
  equipment: SimulationEntityOption[];
  equipmentLoading: boolean;
  levels: number[];
  levelsLoading: boolean;
  imageLoader: SimulationImageLoader | null;
  disabled: boolean;
  unavailable: boolean;
  issues: string[];
  error: string | null;
  runDisabled: boolean;
  onRun: () => void;
  conditions: ReactNode;
  comparison: {
    enabled: boolean; equipmentKeys: string[]; extra: ReactNode;
    onEquipment: (keys: string[]) => void; onCopy: () => void; onClose: () => void;
  };
  onCancel: () => void;
};

const skillKindLabels: Record<CombatSkillRow['kind'], string> = {
  basic: '普攻', active: '主动', passive: '被动'
};

function Combatant({ side, value, comparisonControls, ...shared }: {
  side: 'source' | 'target';
  value: CombatantSetup;
  comparisonControls?: ReactNode;
} & Pick<CombatScenarioSetupProps, 'characters' | 'charactersLoading' | 'equipment' | 'equipmentLoading'
  | 'levels' | 'levelsLoading' | 'imageLoader' | 'disabled' | 'unavailable'>) {
  const label = side === 'source' ? '攻击方' : '目标';
  const disabled = shared.disabled || shared.unavailable;
  return <section className="combat-setup-side" aria-label={`${label}配置`}>
    <header className="combat-setup-side-heading">
      <h3>{side === 'source' ? '攻击方' : '目标方'}</h3>
      <span>{side === 'source' ? '技能与普通攻击' : '受击与防御'}</span>
    </header>

    <div className="combat-setup-identity">
      <Form.Item label={`${label}角色`} required>
        <SimulationEntitySelect label={`${label}角色`} value={value.characterKey} options={shared.characters}
          loading={shared.charactersLoading} disabled={disabled || shared.charactersLoading}
          placeholder="选择角色" loadImage={shared.imageLoader} onChange={value.onCharacter} />
      </Form.Item>
      <Form.Item label={`${label}等级`} required>
        <Select aria-label={`${label}等级`} className="simulation-level-select" allowClear
          value={value.level} loading={shared.levelsLoading}
          disabled={disabled || !value.characterKey || shared.levelsLoading || !shared.levels.length}
          options={shared.levels.map(level => ({ value: level, label: String(level) }))}
          placeholder="等级" onChange={(level: number | undefined) => value.onLevel(level)} />
      </Form.Item>
    </div>

    <Form.Item label={side === 'source' ? '攻击方装备（方案 A）' : '目标装备'} className="combat-setup-equipment">
      <SimulationEquipmentSelect label={`${label}装备`} value={value.equipmentKeys} options={shared.equipment}
        loading={shared.equipmentLoading} disabled={disabled || !value.characterKey || shared.equipmentLoading}
        loadImage={shared.imageLoader} onChange={value.onEquipment} />
    </Form.Item>

    {comparisonControls}

    <section className="combat-setup-skills" aria-label={`${label}角色技能`} aria-busy={value.skillsLoading}>
      {value.basicAttackFallback ? <div className="combat-setup-basic-fallback">
        <span>普通攻击绑定待修正，可关闭后仅计算主动技能。</span>
        <Switch aria-label="开启背景普攻" checked={value.basicAttackFallback.enabled} disabled={disabled}
          onChange={value.basicAttackFallback.onChange} />
      </div> : null}
      <div className="combat-setup-skills-heading" aria-hidden="true">
        <span>角色技能</span><span>启用</span><span>等级</span>
      </div>
      {value.skillsLoading ? <p className="combat-setup-empty" role="status">正在读取角色技能…</p>
        : !value.skills.length ? <p className="combat-setup-empty">{value.characterKey ? '此角色暂无可用技能。' : '选择角色后显示已绑定技能。'}</p>
          : value.skills.map(skill => {
            const hint = [skill.hint, side === 'target' && skill.kind === 'active' ? '本场不主动施放' : null]
              .filter((text, index, all) => text && all.indexOf(text) === index).join('；');
            return <div key={skill.key} className="combat-setup-skill-row" role="group" aria-label={`${label}技能 ${skill.key}`}>
              <div className="combat-setup-skill-identity" title={skill.name}>
                <div className="combat-setup-skill-name">
                  <SimulationEntityOptionLabel option={{ kind: 'skill', key: skill.key, name: skill.name, maxLevel: skill.maxLevel }}
                    loadImage={shared.imageLoader} selected />
                  <span className="combat-setup-skill-kind">{skillKindLabels[skill.kind]}</span>
                </div>
                {hint ? <span className="combat-setup-skill-hint">{hint}</span> : null}
              </div>
              <Switch aria-label={`${label}技能 ${skill.key} 启用`} size="small" checked={skill.enabled}
                disabled={disabled || skill.disabled} checkedText="开" uncheckedText="关"
                onChange={enabled => value.onSkill(skill.key, { enabled })} />
              <Select aria-label={`${label}技能 ${skill.key} 等级`} className="simulation-level-select" allowClear
                value={skill.level} disabled={disabled || skill.disabled} placeholder="等级"
                options={Array.from({ length: skill.maxLevel + 1 }, (_, rank) => ({ value: rank, label: rank === 0 ? '0（未学）' : String(rank) }))}
                onChange={(skillLevel: number | undefined) => value.onSkill(skill.key, { skillLevel })} />
            </div>;
          })}
    </section>

    <details className="combat-setup-extra">
      <summary>构筑与其他来源</summary>
      <div className="combat-setup-extra-content">{value.extra}</div>
    </details>
  </section>;
}

export function CombatScenarioSetup({ source, target, issues, error, runDisabled, onRun, conditions, comparison, onCancel, ...shared }: CombatScenarioSetupProps) {
  const disabled = shared.disabled || shared.unavailable;
  const comparisonControls = comparison.enabled ? <section aria-label="方案 B 装备设置">
    <Form.Item label="攻击方装备（方案 B，仅改 1 件装备）">
      <SimulationEquipmentSelect label="攻击方装备（方案 B）" value={comparison.equipmentKeys} options={shared.equipment}
        loading={shared.equipmentLoading} disabled={disabled || !source.characterKey || shared.equipmentLoading}
        loadImage={shared.imageLoader} onChange={comparison.onEquipment} />
    </Form.Item>
    {comparison.extra}
    <div className="combat-equipment-actions">
      <Button disabled={disabled} onClick={comparison.onCopy}>同步方案 A 装备</Button>
      <Button disabled={disabled} onClick={comparison.onClose}>关闭方案 B</Button>
    </div>
  </section> : <Button disabled={disabled || !source.characterKey} onClick={comparison.onCopy}>复制为方案 B 比较</Button>;
  return <Form layout="vertical" className="combat-scenario-setup" aria-label="混合战斗场景选择" aria-busy={shared.disabled}>
    <div className="combat-setup-sides">
      <Combatant side="source" value={source} comparisonControls={comparisonControls} {...shared} />
      <Combatant side="target" value={target} {...shared} />
    </div>
    {conditions}
    {issues.length ? <div className="combat-setup-issues" role="alert" aria-label="场景配置问题">
      <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
    </div> : null}
    <div className="combat-setup-actions">
      <Button type="primary" disabled={disabled || runDisabled} loading={shared.disabled} onClick={onRun}>
        {comparison.enabled ? '开始比较' : '开始计算'}
      </Button>
      {shared.disabled ? <Button status="danger" onClick={onCancel}>取消当前请求</Button> : null}
    </div>
    {error ? <Alert type="error" content={<span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>} /> : null}
  </Form>;
}
