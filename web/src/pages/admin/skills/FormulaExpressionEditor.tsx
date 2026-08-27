import { Alert, Card, Radio, Select, Space, Typography } from '@arco-design/web-react';
import type { Attribute } from '../../../types/attribute';
import type {
  FormulaAttributeOwner,
  FormulaAttributeValueKind,
  FormulaOperation
} from '../../../types/skillFormula';
import type { SkillParameter } from '../../../types/skillParameter';
import {
  FORMULA_ATTRIBUTE_VALUE_KINDS,
  FORMULA_OPERATIONS,
  attributeOwnerLabel,
  attributeValueKindLabel,
  canExpandOperationChild,
  operationLabel,
  switchNodeType,
  type FormulaNodeDraft,
  type FormulaNodeKind
} from './formulaExpression';

type FormulaExpressionEditorProps = {
  root: FormulaNodeDraft;
  path: string;
  node: FormulaNodeDraft;
  readOnly: boolean;
  disabled: boolean;
  parameters: SkillParameter[];
  attributes: Attribute[];
  retainedDisabledAttributeKeys: Set<string>;
  nodeIssues: Array<{ path: string; message: string }>;
  updateAtPath: (path: string, next: FormulaNodeDraft) => void;
  onNodeIssue: (issue: { path: string; message: string }) => void;
};

export function FormulaExpressionEditor({
  root,
  path,
  node,
  readOnly,
  disabled,
  parameters,
  attributes,
  retainedDisabledAttributeKeys,
  nodeIssues,
  updateAtPath,
  onNodeIssue
}: FormulaExpressionEditorProps) {
  const issue = nodeIssues.find((item) => item.path === path);
  const kind: FormulaNodeKind = node.nodeType;

  const changeKind = (nextKind: FormulaNodeKind) => {
    if (nextKind === kind) return;
    if (nextKind === 'OPERATION') {
      const allowed = canExpandOperationChild(root, path);
      if (!allowed.ok) {
        onNodeIssue({ path: allowed.path, message: allowed.message });
        return;
      }
    }
    const next = switchNodeType(node, nextKind);
    updateAtPath(path, next);
  };

  const attributeOptions = attributes
    .filter((item) => item.status === 'ENABLED' || retainedDisabledAttributeKeys.has(item.attributeKey))
    .map((item) => ({
      value: item.attributeKey,
      label: item.status === 'DISABLED'
        ? `${item.name}（${item.attributeKey}）已停用`
        : `${item.name}（${item.attributeKey}）`
    }));

  return (
    <Card
      size="small"
      style={{ marginTop: path === 'expression' ? 0 : 8, width: '100%' }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        {issue ? <Alert type="error" content={issue.message} /> : null}
        <div>
          <Typography.Text type="secondary">节点类型</Typography.Text>
          <Radio.Group
            aria-label={`${path}节点类型`}
            value={kind === 'empty' ? undefined : kind}
            disabled={readOnly || disabled}
            onChange={(value) => changeKind(value as FormulaNodeKind)}
            style={{ display: 'block', marginTop: 6 }}
          >
            <Radio value="OPERATION">运算</Radio>
            <Radio value="PARAMETER">技能参数</Radio>
            <Radio value="ATTRIBUTE">属性</Radio>
          </Radio.Group>
        </div>

        {node.nodeType === 'OPERATION' ? (
          <>
            <div>
              <Typography.Text type="secondary">运算</Typography.Text>
              <Select
                aria-label={`${path}运算`}
                value={node.operation || undefined}
                disabled={readOnly || disabled}
                style={{ width: '100%', marginTop: 6 }}
                options={FORMULA_OPERATIONS.map((operation) => ({
                  value: operation,
                  label: operationLabel(operation)
                }))}
                onChange={(value) => {
                  updateAtPath(path, {
                    ...node,
                    operation: value as FormulaOperation
                  });
                }}
              />
            </div>
            <div>
              <Typography.Text type="secondary">左值</Typography.Text>
              <FormulaExpressionEditor
                root={root}
                path={`${path}.operands[0]`}
                node={node.left}
                readOnly={readOnly}
                disabled={disabled}
                parameters={parameters}
                attributes={attributes}
                retainedDisabledAttributeKeys={retainedDisabledAttributeKeys}
                nodeIssues={nodeIssues}
                updateAtPath={updateAtPath}
                onNodeIssue={onNodeIssue}
              />
            </div>
            <div>
              <Typography.Text type="secondary">右值</Typography.Text>
              <FormulaExpressionEditor
                root={root}
                path={`${path}.operands[1]`}
                node={node.right}
                readOnly={readOnly}
                disabled={disabled}
                parameters={parameters}
                attributes={attributes}
                retainedDisabledAttributeKeys={retainedDisabledAttributeKeys}
                nodeIssues={nodeIssues}
                updateAtPath={updateAtPath}
                onNodeIssue={onNodeIssue}
              />
            </div>
          </>
        ) : null}

        {node.nodeType === 'PARAMETER' ? (
          <div>
            <Typography.Text type="secondary">技能参数</Typography.Text>
            <Select
              aria-label={`${path}技能参数`}
              value={node.parameterKey || undefined}
              disabled={readOnly || disabled}
              style={{ width: '100%', marginTop: 6 }}
              options={parameters.map((item) => ({
                value: item.parameterKey,
                label: item.valueMode === 'RUNTIME_INPUT'
                  ? `${item.name}（${item.parameterKey}）计算时传入`
                  : `${item.name}（${item.parameterKey}）`
              }))}
              onChange={(value) => {
                updateAtPath(path, {
                  nodeType: 'PARAMETER',
                  parameterKey: String(value)
                });
              }}
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
                disabled={readOnly || disabled}
                style={{ display: 'block', marginTop: 6 }}
                onChange={(value) => {
                  updateAtPath(path, {
                    ...node,
                    attributeOwner: value as FormulaAttributeOwner
                  });
                }}
              >
                <Radio value="SOURCE">{attributeOwnerLabel('SOURCE')}</Radio>
                <Radio value="TARGET">{attributeOwnerLabel('TARGET')}</Radio>
              </Radio.Group>
            </div>
            <div>
              <Typography.Text type="secondary">属性</Typography.Text>
              <Select
                aria-label={`${path}属性`}
                value={node.attributeKey || undefined}
                disabled={readOnly || disabled}
                style={{ width: '100%', marginTop: 6 }}
                options={attributeOptions}
                onChange={(value) => {
                  updateAtPath(path, {
                    ...node,
                    attributeKey: String(value)
                  });
                }}
              />
            </div>
            <div>
              <Typography.Text type="secondary">取值方式</Typography.Text>
              <Select
                aria-label={`${path}属性取值方式`}
                value={node.attributeValueKind || undefined}
                disabled={readOnly || disabled}
                style={{ width: '100%', marginTop: 6 }}
                options={FORMULA_ATTRIBUTE_VALUE_KINDS.map((kindValue) => ({
                  value: kindValue,
                  label: attributeValueKindLabel(kindValue)
                }))}
                onChange={(value) => {
                  updateAtPath(path, {
                    ...node,
                    attributeValueKind: value as FormulaAttributeValueKind
                  });
                }}
              />
            </div>
          </>
        ) : null}
      </Space>
    </Card>
  );
}
