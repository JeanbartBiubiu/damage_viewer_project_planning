import { Alert, Button, Card, Input, Select, Space, Typography } from '@arco-design/web-react';
import type { Attribute } from '../../../types/attribute';
import type { SkillParameter } from '../../../types/skillParameter';
import { SKILL_FORMULA_VALUE_KINDS } from '../../../services/skillFormulaContract';
import { CommonFormulaExpressionEditor } from '../common-formula/CommonFormulaExpressionEditor';
import type { CommonFormulaDraft, CommonFormulaInputDraft, CommonFormulaNodeDraft, CommonFormulaNodeIssue } from '../common-formula/commonFormulaForm';
import { attributeValueKindLabel } from './formulaExpression';
type Props = {
  root: CommonFormulaDraft; path: string; node: CommonFormulaDraft;
  readOnly: boolean; disabled: boolean; parameters: SkillParameter[]; attributes: Attribute[];
  retainedDisabledAttributeKeys: Set<string>; nodeIssues: CommonFormulaNodeIssue[];
  focusPath?: string | null; skillKey?: string;
  updateAtPath: (path: string, next: CommonFormulaDraft | CommonFormulaNodeDraft) => void;
  onNodeIssue: (issue: CommonFormulaNodeIssue) => void;
};
export function FormulaExpressionEditor(props: Props) {
  const { root, readOnly, disabled, parameters, attributes, nodeIssues, updateAtPath, onNodeIssue } = props;
  const locked = readOnly || disabled;
  const skillKey = props.skillKey ?? parameters[0]?.skillKey ?? '';
  const change = (next: CommonFormulaDraft) => updateAtPath('expression', next);
  const inputChange = (index: number, input: CommonFormulaInputDraft) => change({ ...root, inputs: root.inputs.map((row, i) => i === index ? input : row) });
  const stageChange = (index: number, next: Partial<CommonFormulaDraft['stages'][number]>) => change({ ...root, stages: root.stages.map((stage, i) => i === index ? { ...stage, ...next } : stage) });
  const move = (index: number, delta: number) => {
    const target = index + delta; if (target < 0 || target >= root.stages.length) return;
    const stages = [...root.stages]; [stages[index], stages[target]] = [stages[target]!, stages[index]!]; change({ ...root, stages });
  };
  return <Space direction="vertical" size="medium" style={{ width: '100%' }}>
    {nodeIssues.filter(issue => !issue.path.includes('/stages/') || !issue.path.includes('/expression')).map((issue, index) => <Alert key={index} type="error" content={issue.message} />)}
    <Typography.Text>输入声明参与引用保护；只有最终输出可达的读取要求动作供值。公式只预览结构。</Typography.Text>
    <Button disabled={locked || root.inputs.length >= 64} onClick={() => change({ ...root, inputs: [...root.inputs, { key: '', binding: { kind: 'parameter', skillKey, parameterKey: '' } }] })}>添加公式输入</Button>
    {root.inputs.map((input, index) => {
      const binding = input.binding;
      const attributeOptions = attributes.filter(row => row.status === 'ENABLED').map(row => ({ value: row.attributeKey, label: row.name + '（' + row.attributeKey + '）' }));
      if (binding.kind === 'attribute' && binding.attributeKey && !attributeOptions.some(row => row.value === binding.attributeKey)) attributeOptions.push({ value: binding.attributeKey, label: binding.attributeKey + '（已停用或不存在，请修复）' });
      const parameterOptions = parameters.filter(row => row.skillKey === skillKey).map(row => ({ value: row.parameterKey, label: row.name + '（' + row.parameterKey + '）' + (row.valueMode === 'RUNTIME_INPUT' ? '计算时传入' : '') }));
      if (binding.kind === 'parameter' && binding.parameterKey && !parameterOptions.some(row => row.value === binding.parameterKey)) parameterOptions.push({ value: binding.parameterKey, label: binding.parameterKey + '（不存在或属于其他技能，请修复）' });
      const label = '公式输入' + (index + 1);
      return <Card key={index} size="small" data-authoring-field={'/expression/inputs/' + index} style={{ width: '100%' }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input aria-label={label + '标识'} value={input.key} disabled={locked} placeholder="输入标识" onChange={key => inputChange(index, { ...input, key })} />
          <Select aria-label={label + '来源'} value={binding.kind} disabled={locked} options={[{ value: 'parameter', label: '技能参数' }, { value: 'attribute', label: '属性' }]}
            onChange={kind => inputChange(index, { ...input, binding: kind === 'parameter' ? { kind: 'parameter', skillKey, parameterKey: '' } : { kind: 'attribute', object: 'source', attributeKey: '', valueKind: 'TOTAL', view: 'current_frame' } })} />
          {binding.kind === 'parameter' ? <Select aria-label={label + '技能参数'} value={binding.parameterKey || undefined} disabled={locked} options={parameterOptions} onChange={parameterKey => inputChange(index, { ...input, binding: { ...binding, parameterKey: String(parameterKey) } })} /> : null}
          {binding.kind === 'attribute' ? <>
            <Select aria-label={label + '对象'} value={binding.object || undefined} disabled={locked} options={[{ value: 'source', label: '施法者' }, { value: 'target', label: '目标' }]} onChange={object => inputChange(index, { ...input, binding: { ...binding, object } })} />
            <Select aria-label={label + '属性'} value={binding.attributeKey || undefined} disabled={locked} options={attributeOptions} onChange={attributeKey => inputChange(index, { ...input, binding: { ...binding, attributeKey: String(attributeKey) } })} />
            <Select aria-label={label + '取值口径'} value={binding.valueKind || undefined} disabled={locked} options={SKILL_FORMULA_VALUE_KINDS.map(value => ({ value, label: attributeValueKindLabel(value) }))} onChange={valueKind => inputChange(index, { ...input, binding: { ...binding, valueKind } })} />
            <Typography.Text type="secondary">当前帧</Typography.Text>
          </> : null}
          <Button status="danger" disabled={locked} onClick={() => change({ ...root, inputs: root.inputs.filter((_row, i) => i !== index) })}>删除公式输入{index + 1}</Button>
        </Space>
      </Card>;
    })}
    <Button disabled={locked || root.stages.length >= 64} onClick={() => change({ ...root, stages: [...root.stages, { key: '', name: '', expression: { op: 'empty' } }] })}>添加公式结果</Button>
    {root.stages.map((stage, index) => <Card key={index} size="small" data-authoring-field={'/expression/stages/' + index} style={{ width: '100%' }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Input aria-label={'公式结果' + (index + 1) + '标识'} value={stage.key} disabled={locked} placeholder="结果标识" onChange={key => stageChange(index, { key })} />
        <Input aria-label={'公式结果' + (index + 1) + '名称'} value={stage.name} disabled={locked} placeholder="结果名称" onChange={name => stageChange(index, { name })} />
        <CommonFormulaExpressionEditor draft={root} path={'/expression/stages/' + index + '/expression'} label={'公式结果' + (index + 1)} node={stage.expression} readOnly={readOnly} disabled={disabled} nodeIssues={nodeIssues} focusPath={props.focusPath} onChange={updateAtPath} onRejectExpand={onNodeIssue} />
        <Space><Button disabled={locked || index === 0} onClick={() => move(index, -1)}>上移公式结果{index + 1}</Button>
          <Button disabled={locked || index === root.stages.length - 1} onClick={() => move(index, 1)}>下移公式结果{index + 1}</Button>
          <Button status="danger" disabled={locked} onClick={() => change({ ...root, stages: root.stages.filter((_row, i) => i !== index) })}>删除公式结果{index + 1}</Button></Space>
      </Space>
    </Card>)}
    <Select aria-label="公式最终输出" value={root.outputStageKey || undefined} disabled={locked} placeholder="选择最终输出结果" options={root.stages.filter(row => row.key).map(row => ({ value: row.key, label: row.name + '（' + row.key + '）' }))} onChange={outputStageKey => change({ ...root, outputStageKey: String(outputStageKey) })} />
  </Space>;
}
