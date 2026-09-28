import { Alert, Space, Tag, Typography } from '@arco-design/web-react';
import type { ReactNode } from 'react';
import type { SkillEffect } from '../../../types/skillEffect';
import type { SkillFormula } from '../../../types/skillFormula';
import type { SkillInternalState } from '../../../types/skillInternalState';
import type { SkillParameter } from '../../../types/skillParameter';
import type { SkillProcess } from '../../../types/skillProcess';
import type { SkillTriggerRuleDetail } from '../../../types/skillTriggerRule';
import type { NumericValue } from '../../../types/numericValue';
import { expressionToDraft, previewFormulaExpression } from './formulaExpression';
import { SKILL_EFFECT_RESULT_TYPE_LABELS, skillEffectResultToDraft } from './effects/effectForm';
import { buildResultReferenceSummary } from './effects/resultReferenceSummary';
import {
  SKILL_PROCESS_ACTIVATION_TYPE_LABELS,
  SKILL_PROCESS_STEP_TYPE_LABELS
} from './processes/processForm';
import { AMMO_RECOVERY_START_CONDITION_LABELS, SKILL_INTERNAL_STATE_SCOPE_LABELS,
  SKILL_INTERNAL_STATE_TYPE_LABELS } from './processes/internalStateForm';
import { SKILL_TRIGGER_EVENT_TYPE_LABELS } from './triggers/triggerRuleForm';

const FIELD_LABELS: Record<string, string> = {
  gameId: '游戏标识', skillKey: '所属技能', name: '名称', description: '说明', sortOrder: '排序',
  createdAt: '创建时间', updatedAt: '更新时间', formulaKey: '公式标识', expression: '表达式',
  effectKey: '效果标识', lifecycle: '生命周期', results: '结果', resultKey: '结果标识',
  resultType: '结果种类', target: '作用对象', valueRule: '数值规则', value: '数值',
  fixedMultiplier: '固定倍率', fixedMinValue: '固定下限', fixedMaxValue: '固定上限',
  detail: '明细', damageTypeKey: '伤害类型', attributeKey: '属性标识', statusKey: '状态标识',
  modifierZoneKey: '乘区标识', operation: '操作', direction: '方向', affectedSkillScope: '技能范围',
  processKey: '过程标识', activationType: '启动方式', cooldown: '主要冷却',
  durationValue: '时长数值', startMoment: '开始时点', steps: '步骤', stepKey: '步骤标识',
  stepType: '步骤种类', effectBindings: '效果挂接', bindingKey: '挂接标识',
  stateOperations: '内部状态操作', stateKey: '状态标识', stateType: '状态种类', scope: '保存范围',
  initialValue: '初始值', maxValue: '最大值', recoveryIntervalValue: '恢复间隔',
  recoveryMode: '恢复方式', options: '候选项', optionKey: '候选标识', initial: '初始项',
  initialEnabled: '初始启用', ruleKey: '规则标识', eventSource: '事件来源',
  conditionGroups: '条件组', conditions: '条件', actions: '动作', actionKey: '动作标识',
  actionType: '动作种类', perTargetCooldown: '单目标冷却', maxTriggersPerProcess: '过程触发上限',
  oncePerUse: '同次使用限制', groupKey: '共享限制键', moment: '执行时点',
  nodeType: '节点种类', operands: '运算子项', parameterKey: '参数标识', formulaKeyRef: '公式标识',
  kind: '取值来源', valueMode: '取值方式', valueType: '数值类型', levelValues: '等级数值',
  fixedValue: '固定值', sourceType: '来源类型', eventType: '事件种类',
  targetContext: '目标上下文', runtimeInputBindings: '运行输入供值', resultModifiers: '结果修正'
};

function displayValue(value: unknown): ReactNode {
  if (value === null) return '未配置';
  if (value === true) return '是';
  if (value === false) return '否';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '—';
}

function DefinitionFields({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (!value.length) return <Typography.Text type="secondary">无</Typography.Text>;
    return <ol style={{ paddingLeft: 24, margin: '6px 0' }}>{value.map((item, index) =>
      <li key={index} style={{ marginBottom: 6 }}><DefinitionFields value={item} /></li>)}</ol>;
  }
  if (value && typeof value === 'object') {
    return <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 180px) minmax(0, 1fr)', gap: '6px 12px', margin: '6px 0' }}>
      {Object.entries(value).map(([key, nested]) => <div key={key} style={{ display: 'contents' }}>
        <dt style={{ color: 'var(--color-text-2)' }}>{FIELD_LABELS[key] ?? `字段 ${key}`}</dt>
        <dd style={{ margin: 0, overflowWrap: 'anywhere' }}><DefinitionFields value={nested} /></dd>
      </div>)}
    </dl>;
  }
  return <>{displayValue(value)}</>;
}

function Card({ name, keyName, summary, value, actions }: { name: string; keyName: string; summary: ReactNode;
  value: unknown; actions?: ReactNode }) {
  return <div style={{ border: '1px solid var(--color-border-2)', borderRadius: 6, padding: 12 }}>
    <Space direction="vertical" style={{ width: '100%' }}>
      <div><Typography.Text bold>{name}</Typography.Text> <Typography.Text type="secondary">（{keyName}）</Typography.Text></div>
      {actions ? <div>{actions}</div> : null}
      <div>{summary}</div>
      <details><summary style={{ cursor: 'pointer' }}>查看全部字段</summary>
        <DefinitionFields value={value} />
      </details>
    </Space>
  </div>;
}

function Section({ label, count, children, notice }: { label: string; count: number; children: ReactNode; notice?: string }) {
  return <Space direction="vertical" size="medium" style={{ width: '100%' }}>
    <Alert type="info" content={notice ?? `${label}本阶段暂只读，完整详情已随技能一起读取。`} />
    <Typography.Text>共 {count} 项</Typography.Text>
    {count ? children : <Typography.Text type="secondary">当前没有{label}。</Typography.Text>}
  </Space>;
}

function numeric(value: NumericValue | null | undefined): string {
  if (!value) return '未配置';
  if (value.kind === 'FIXED') return String(value.value);
  if (value.kind === 'PARAMETER') return `参数 ${value.parameterKey}`;
  return `公式 ${value.formulaKey}`;
}

export function ReadonlyFormulas({ formulas, parameters, notice }: {
  formulas: SkillFormula[]; parameters: SkillParameter[]; notice?: string;
}) {
  return <Section label="公式" count={formulas.length} notice={notice}>
    {formulas.map((formula) => <Card key={formula.formulaKey} name={formula.name} keyName={formula.formulaKey}
      summary={<Space direction="vertical">
        <Typography.Text>中文预览：{previewFormulaExpression(expressionToDraft(formula.expression), {
          parameters, attributes: []
        }).map((segment) => segment.text).join('')}</Typography.Text>
        {formula.description ? <Typography.Text type="secondary">{formula.description}</Typography.Text> : null}
      </Space>} value={formula} />)}
  </Section>;
}

export function ReadonlyEffects({ effects, parameters, formulas, notice, actions }: {
  effects: SkillEffect[]; parameters: SkillParameter[]; formulas: SkillFormula[];
  notice?: string; actions?: (effect: SkillEffect) => ReactNode;
}) {
  const catalogs = {
    parametersLoadState: 'ready' as const,
    formulasLoadState: 'ready' as const,
    effectsLoadState: 'ready' as const,
    parameters: new Map(parameters.map((item) => [item.parameterKey, { key: item.parameterKey, name: item.name, status: 'ENABLED' as const }])),
    formulas: new Map(formulas.map((item) => [item.formulaKey, { key: item.formulaKey, name: item.name, status: 'ENABLED' as const }])),
    effects: new Map(effects.map((item) => [item.effectKey, { key: item.effectKey, name: item.name, status: 'ENABLED' as const }]))
  };
  return <Section label="效果与生命周期" count={effects.length} notice={notice}>
    {effects.map((effect) => <Card key={effect.effectKey} name={effect.name} keyName={effect.effectKey}
      actions={actions?.(effect)}
      summary={<Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text>{effect.lifecycle ? '配置了生命周期' : '即时效果'} · {effect.results.length} 条结果</Typography.Text>
        {effect.lifecycle?.endWhenShieldEndsResultKey
          ? <Typography.Text>随同父护盾结果「{effect.lifecycle.endWhenShieldEndsResultKey}」结束</Typography.Text> : null}
        {effect.results.map((result) => {
          let summary: string;
          try {
            const resolved = buildResultReferenceSummary(skillEffectResultToDraft(result), catalogs);
            summary = `作用对象：${resolved.target} · ${resolved.segments.join(' · ')}`;
          } catch {
            summary = `作用对象：${result.target === 'SOURCE' ? '施法者' : '当前目标'} · 旧配置字段待核对；完整字段见下方`;
          }
          return <div key={result.resultKey}>
            <Tag>{SKILL_EFFECT_RESULT_TYPE_LABELS[result.resultType]}</Tag>
            <Typography.Text>{result.name}（{result.resultKey}） · {summary}</Typography.Text>
          </div>;
        })}
      </Space>} value={effect} />)}
  </Section>;
}

export function ReadonlyProcesses({ processes, notice, actions }: { processes: SkillProcess[];
  notice?: string; actions?: (process: SkillProcess) => ReactNode }) {
  return <Section label="施放过程" count={processes.length} notice={notice}>
    {processes.map((process) => <Card key={process.processKey} name={process.name} keyName={process.processKey}
      actions={actions?.(process)}
      summary={<Space direction="vertical">
        <Typography.Text>{SKILL_PROCESS_ACTIVATION_TYPE_LABELS[process.activationType]} · 主要冷却：{numeric(process.cooldown?.durationValue)} 毫秒</Typography.Text>
        <Typography.Text>步骤：{process.steps.length}；效果挂接：{process.effectBindings.length}；内部状态操作：{process.stateOperations.length}</Typography.Text>
        {process.steps.map((step) => <Typography.Text key={step.stepKey} type="secondary">
          {step.name}（{step.stepKey}） · {SKILL_PROCESS_STEP_TYPE_LABELS[step.stepType]}
        </Typography.Text>)}
      </Space>} value={process} />)}
  </Section>;
}

export function ReadonlyStates({ states, notice, actions }: { states: SkillInternalState[];
  notice?: string; actions?: (state: SkillInternalState) => ReactNode }) {
  return <Section label="内部状态" count={states.length} notice={notice}>
    {states.map((state) => <Card key={state.stateKey} name={state.name} keyName={state.stateKey}
      actions={actions?.(state)}
      summary={<Space direction="vertical">
        <Typography.Text>{SKILL_INTERNAL_STATE_TYPE_LABELS[state.stateType]} · {SKILL_INTERNAL_STATE_SCOPE_LABELS[state.scope]}</Typography.Text>
        {state.stateType === 'COUNTER' || state.stateType === 'AMMO' ? <Typography.Text>
          初始值：{numeric(state.detail.initialValue)}；最大值：{numeric(state.detail.maxValue)}
          {state.stateType === 'AMMO'
            ? `；恢复间隔：${numeric(state.detail.recoveryIntervalValue)} 毫秒；启动条件：${state.detail.recoveryStartCondition
              ? AMMO_RECOVERY_START_CONDITION_LABELS[state.detail.recoveryStartCondition] : '待确认'}` : ''}
        </Typography.Text> : null}
        {state.stateType === 'INTERNAL_COOLDOWN' ? <Typography.Text>时长：{numeric(state.detail.durationValue)} 毫秒</Typography.Text> : null}
        {state.stateType === 'FLAG' ? <Typography.Text>初始启用：{state.detail.initialEnabled ? '是' : '否'}</Typography.Text> : null}
        {state.stateType === 'MODE' ? <Typography.Text>候选项：{state.detail.options.map((item) => `${item.name}（${item.optionKey}）`).join('、') || '无'}</Typography.Text> : null}
      </Space>} value={state} />)}
  </Section>;
}

export function ReadonlyRules({ rules, notice, actions }: { rules: SkillTriggerRuleDetail[];
  notice?: string; actions?: (rule: SkillTriggerRuleDetail) => ReactNode }) {
  return <Section label="条件与触发" count={rules.length} notice={notice}>
    {rules.map((rule) => <Card key={rule.ruleKey} name={rule.name} keyName={rule.ruleKey}
      actions={actions?.(rule)}
      summary={<Space direction="vertical">
        <Typography.Text>事件：{SKILL_TRIGGER_EVENT_TYPE_LABELS[rule.eventSource.eventType]}</Typography.Text>
        <Typography.Text>条件组：{rule.conditionGroups.length}；动作：{rule.actions.length}</Typography.Text>
        {rule.oncePerUse ? <Typography.Text>同次使用限制：{rule.oncePerUse.groupKey}（{rule.oncePerUse.scope === 'TARGET' ? '每个目标' : '整个技能使用'}）</Typography.Text> : null}
      </Space>} value={rule} />)}
  </Section>;
}
