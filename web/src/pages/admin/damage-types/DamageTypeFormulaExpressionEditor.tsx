import { Alert, Card, Input, Radio, Select, Space, Typography } from '@arco-design/web-react';
import type { FormulaAttributeOwner, FormulaAttributeValueKind, FormulaOperation } from '../../../types/skillFormula';
import type {
  DamageTypeFormulaStageKey,
  DamageTypeFormulaStageResultKey
} from '../../../types/damageTypeFormula';
import {
  canExpandDamageTypeFormulaOperation,
  damageTypeFormulaOperationLabel,
  damageTypeFormulaOwnerLabel,
  damageTypeFormulaValueKindLabel,
  selectableAttributeOptions,
  stageResultOptions,
  switchDamageTypeFormulaNode,
  type DamageTypeFormulaAttributeOption,
  type DamageTypeFormulaAttributeTriple,
  type DamageTypeFormulaNodeDraft,
  type DamageTypeFormulaNodeIssue,
  type DamageTypeFormulaNodeKind
} from './damageTypeFormulaForm';

const ATTRIBUTE_VALUE_KINDS: FormulaAttributeValueKind[] = [
  'BASE',
  'BONUS',
  'TOTAL',
  'CURRENT',
  'MISSING',
  'CURRENT_RATIO',
  'MISSING_RATIO'
];
const OPERATIONS: FormulaOperation[] = ['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'];

type DamageTypeFormulaExpressionEditorProps = {
  stageKey: DamageTypeFormulaStageKey;
  stageRoot: DamageTypeFormulaNodeDraft;
  path: string;
  node: DamageTypeFormulaNodeDraft;
  readOnly: boolean;
  disabled: boolean;
  attributes: readonly DamageTypeFormulaAttributeOption[];
  retainedDisabled: readonly DamageTypeFormulaAttributeTriple[];
  nodeIssues: readonly DamageTypeFormulaNodeIssue[];
  onChange: (path: string, next: DamageTypeFormulaNodeDraft) => void;
  onRejectExpand: (issue: DamageTypeFormulaNodeIssue) => void;
};

export function DamageTypeFormulaExpressionEditor({
  stageKey,
  stageRoot,
  path,
  node,
  readOnly,
  disabled,
  attributes,
  retainedDisabled,
  nodeIssues,
  onChange,
  onRejectExpand
}: DamageTypeFormulaExpressionEditorProps) {
  const issues = nodeIssues.filter((item) => item.path === path);
  const locked = readOnly || disabled;
  const kind: DamageTypeFormulaNodeKind = node.nodeType;

  const changeKind = (nextKind: DamageTypeFormulaNodeKind) => {
    if (locked || nextKind === kind) return;
    if (nextKind === 'OPERATION') {
      const allowed = canExpandDamageTypeFormulaOperation(stageKey, stageRoot, path);
      if (!allowed.ok) {
        onRejectExpand({ path: allowed.path, message: allowed.message });
        return;
      }
    }
    onChange(path, switchDamageTypeFormulaNode(nextKind));
  };

  const attributeOptions = selectableAttributeOptions(attributes, retainedDisabled, node);
  const priorOptions = stageResultOptions(stageKey);

  return (
    <Card size="small" style={{ marginTop: path === `formula.${stageKey}` ? 0 : 8, width: '100%' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        {issues.map((issue, index) => (
          <Alert key={`${issue.path}-${index}`} type="error" content={issue.message} />
        ))}
        <div>
          <Typography.Text type="secondary">节点类型</Typography.Text>
          <Radio.Group
            aria-label={`${path}节点类型`}
            value={kind === 'empty' ? undefined : kind}
            disabled={locked}
            onChange={(value) => changeKind(value as DamageTypeFormulaNodeKind)}
            style={{ display: 'block', marginTop: 6 }}
          >
            <Radio value="OPERATION">运算</Radio>
            <Radio value="FIXED">固定值</Radio>
            <Radio value="ATTRIBUTE">属性</Radio>
            <Radio value="STAGE_RESULT">前序结果</Radio>
          </Radio.Group>
        </div>

        {node.nodeType === 'OPERATION' ? (
          <>
            <div>
              <Typography.Text type="secondary">运算</Typography.Text>
              <Select
                aria-label={`${path}运算`}
                value={node.operation || undefined}
                disabled={locked}
                style={{ width: '100%', marginTop: 6 }}
                options={OPERATIONS.map((operation) => ({
                  value: operation,
                  label: damageTypeFormulaOperationLabel(operation)
                }))}
                onChange={(value) => onChange(path, { ...node, operation: value as FormulaOperation })}
              />
            </div>
            <div>
              <Typography.Text type="secondary">左值</Typography.Text>
              <DamageTypeFormulaExpressionEditor
                stageKey={stageKey}
                stageRoot={stageRoot}
                path={`${path}.operands[0]`}
                node={node.left}
                readOnly={readOnly}
                disabled={disabled}
                attributes={attributes}
                retainedDisabled={retainedDisabled}
                nodeIssues={nodeIssues}
                onChange={onChange}
                onRejectExpand={onRejectExpand}
              />
            </div>
            <div>
              <Typography.Text type="secondary">右值</Typography.Text>
              <DamageTypeFormulaExpressionEditor
                stageKey={stageKey}
                stageRoot={stageRoot}
                path={`${path}.operands[1]`}
                node={node.right}
                readOnly={readOnly}
                disabled={disabled}
                attributes={attributes}
                retainedDisabled={retainedDisabled}
                nodeIssues={nodeIssues}
                onChange={onChange}
                onRejectExpand={onRejectExpand}
              />
            </div>
          </>
        ) : null}

        {node.nodeType === 'FIXED' ? (
          <div>
            <Typography.Text type="secondary">固定值</Typography.Text>
            <Input
              aria-label={`${path}固定值`}
              value={node.value}
              disabled={locked}
              style={{ marginTop: 6 }}
              onChange={(value) => onChange(path, { nodeType: 'FIXED', value })}
            />
          </div>
        ) : null}

        {node.nodeType === 'ATTRIBUTE' ? (
          <>
            <div>
              <Typography.Text type="secondary">对象</Typography.Text>
              <Radio.Group
                aria-label={`${path}属性对象`}
                value={node.attributeOwner || undefined}
                disabled={locked}
                style={{ display: 'block', marginTop: 6 }}
                onChange={(value) => onChange(path, { ...node, attributeOwner: value as FormulaAttributeOwner })}
              >
                <Radio value="SOURCE">{damageTypeFormulaOwnerLabel('SOURCE')}</Radio>
                <Radio value="TARGET">{damageTypeFormulaOwnerLabel('TARGET')}</Radio>
              </Radio.Group>
            </div>
            <div>
              <Typography.Text type="secondary">属性</Typography.Text>
              <Select
                aria-label={`${path}属性`}
                value={node.attributeKey || undefined}
                disabled={locked}
                style={{ width: '100%', marginTop: 6 }}
                options={attributeOptions.map((item) => ({ value: item.attributeKey, label: item.label }))}
                onChange={(value) => onChange(path, { ...node, attributeKey: String(value) })}
              />
            </div>
            <div>
              <Typography.Text type="secondary">取值方式</Typography.Text>
              <Select
                aria-label={`${path}属性取值方式`}
                value={node.attributeValueKind || undefined}
                disabled={locked}
                style={{ width: '100%', marginTop: 6 }}
                options={ATTRIBUTE_VALUE_KINDS.map((kind) => ({
                  value: kind,
                  label: damageTypeFormulaValueKindLabel(kind)
                }))}
                onChange={(value) => onChange(path, {
                  ...node,
                  attributeValueKind: value as FormulaAttributeValueKind
                })}
              />
            </div>
          </>
        ) : null}

        {node.nodeType === 'STAGE_RESULT' ? (
          <div>
            <Typography.Text type="secondary">前序结果</Typography.Text>
            <Select
              aria-label={`${path}前序结果`}
              value={node.stageKey || undefined}
              disabled={locked || priorOptions.length === 0}
              placeholder={priorOptions.length === 0 ? '当前阶段没有前序结果' : '请选择前序结果'}
              style={{ width: '100%', marginTop: 6 }}
              options={priorOptions}
              onChange={(value) => onChange(path, {
                nodeType: 'STAGE_RESULT',
                stageKey: value as DamageTypeFormulaStageResultKey
              })}
            />
          </div>
        ) : null}
      </Space>
    </Card>
  );
}
