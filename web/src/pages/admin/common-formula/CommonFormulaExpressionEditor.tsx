import { Alert, Card, Input, InputNumber, Select, Space, Typography } from '@arco-design/web-react';
import {
  COMMON_FORMULA_OPERATIONS, canReplaceCommonFormulaNode, commonFormulaOperationLabel,
  commonFormulaNode, type CommonFormulaDraft, type CommonFormulaNodeDraft,
  type CommonFormulaNodeIssue, type CommonFormulaNodeKind
} from './commonFormulaForm';

type Props = {
  draft: CommonFormulaDraft;
  path: string;
  label: string;
  node: CommonFormulaNodeDraft;
  readOnly: boolean;
  disabled: boolean;
  focusPath?: string | null;
  nodeIssues: readonly CommonFormulaNodeIssue[];
  onChange: (path: string, next: CommonFormulaNodeDraft) => void;
  onRejectExpand: (issue: CommonFormulaNodeIssue) => void;
};
const LEAVES = [
  { value: 'const', label: '固定值' }, { value: 'read', label: '输入值' }, { value: 'ref', label: '结果引用' }
];
export function CommonFormulaExpressionEditor(props: Props) {
  const { draft, path, label, node, readOnly, disabled, nodeIssues, onChange, onRejectExpand } = props;
  const locked = readOnly || disabled;
  const changeKind = (kind: CommonFormulaNodeKind) => {
    if (locked || kind === node.op) return;
    const next = commonFormulaNode(kind);
    const allowed = canReplaceCommonFormulaNode(draft, path, next);
    if (!allowed.ok) { onRejectExpand(allowed); return; }
    onChange(path, next);
  };
  const inputOptions = draft.inputs.filter(input => input.key).map(input => ({ value: input.key, label: input.key }));
  const resultOptions = draft.stages.filter(stage => stage.key).map(stage => ({ value: stage.key, label: `${stage.name || '未命名结果'}（${stage.key}）` }));
  if (node.op === 'read' && node.inputKey && !inputOptions.some(option => option.value === node.inputKey)) {
    inputOptions.push({ value: node.inputKey, label: `${node.inputKey}（不存在，请修复）` });
  }
  if (node.op === 'ref' && node.stageKey && !resultOptions.some(option => option.value === node.stageKey)) {
    resultOptions.push({ value: node.stageKey, label: `${node.stageKey}（不存在，请修复）` });
  }
  return (
    <Card size="small" data-authoring-field={path} className={props.focusPath === path ? 'authoring-field-active' : undefined} style={{ width: '100%' }}>
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        {nodeIssues.filter(issue => issue.path === path).map((issue, index) => <Alert key={index} type="error" content={issue.message} />)}
        <Typography.Text type="secondary">节点类型</Typography.Text>
        <Select aria-label={`${label}节点类型`} value={node.op === 'empty' ? undefined : node.op} disabled={locked}
          placeholder="选择固定值、输入、结果或运算" style={{ width: '100%' }}
          options={[...LEAVES, ...COMMON_FORMULA_OPERATIONS.map(operation => ({ value: operation, label: commonFormulaOperationLabel(operation) }))]}
          onChange={value => changeKind(value as CommonFormulaNodeKind)} />
        {node.op === 'const' ? <>
          <Typography.Text type="secondary">十进制常量（保持原文，不接受科学计数法）</Typography.Text>
          <Input aria-label={`${label}固定值`} value={node.value} disabled={locked}
            onChange={value => onChange(path, { op: 'const', value })} />
        </> : null}
        {node.op === 'read' ? <Select aria-label={`${label}输入值`} value={node.inputKey || undefined} options={inputOptions}
          placeholder="选择已声明输入" disabled={locked} style={{ width: '100%' }}
          onChange={value => onChange(path, { op: 'read', inputKey: String(value) })} /> : null}
        {node.op === 'ref' ? <Select aria-label={`${label}结果引用`} value={node.stageKey || undefined} options={resultOptions}
          placeholder="选择任意具名结果" disabled={locked} style={{ width: '100%' }}
          onChange={value => onChange(path, { op: 'ref', stageKey: String(value) })} /> : null}
        {'args' in node ? <>
          {node.op === 'if' ? <Typography.Text type="secondary">第1项是条件，第2项为成立时取值，第3项为不成立时取值。</Typography.Text> : null}
          {node.op === 'clamp' ? <Typography.Text type="secondary">第1项是原值，第2项为下界，第3项为上界。</Typography.Text> : null}
          {node.op === 'round' ? <InputNumber aria-label={`${label}小数位数`} min={0} max={12} precision={0}
            value={node.decimals} disabled={locked} onChange={decimals => onChange(path, { ...node, decimals })} /> : null}
          {node.args.map((argument, index) => <div key={index} style={{ width: '100%' }}>
            <Typography.Text type="secondary">第{index + 1}项</Typography.Text>
            <CommonFormulaExpressionEditor {...props} path={`${path}/args/${index}`} label={`${label}第${index + 1}项`} node={argument} />
          </div>)}
        </> : null}
      </Space>
    </Card>
  );
}
