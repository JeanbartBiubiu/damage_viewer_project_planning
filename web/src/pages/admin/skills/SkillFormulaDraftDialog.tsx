import { Alert, Button, Form, Input, InputNumber, Modal, Space, Typography } from '@arco-design/web-react';
import { useMemo, useState } from 'react';
import type { Attribute } from '../../../types/attribute';
import type { AuthoringLocation } from '../../../types/authoringLocation';
import type { SkillFormula } from '../../../types/skillFormula';
import type { SkillParameter } from '../../../types/skillParameter';
import { AuthoringFieldAnchor } from './AuthoringFieldAnchor';
import {
  authoringLocateMessage,
  formulaNodePathFromResolved,
  lastFieldName,
  shouldDegradeUnsupportedAnchor
} from './authoringFocus';
import { resolveAuthoringLocation } from './authoringLocation';
import { FormulaExpressionEditor } from './FormulaExpressionEditor';
import {
  collectReferencedAttributeKeys,
  previewFormulaExpression,
  updateNodeAtPath,
  validateFormulaDraft,
  type FormulaNodeIssue,
  type SkillFormulaDraft,
  type SkillFormulaDraftErrors
} from './formulaExpression';

type Props = {
  initial: SkillFormulaDraft;
  original: SkillFormula | null;
  parameters: SkillParameter[];
  attributes: Attribute[];
  attributesReady: boolean;
  attributeError: string | null;
  initialErrors?: SkillFormulaDraftErrors;
  initialNodeIssues?: FormulaNodeIssue[];
  authoringLocation?: AuthoringLocation | null;
  onApply: (draft: SkillFormulaDraft) => string | null;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

export function SkillFormulaDraftDialog({
  initial, original, parameters, attributes, attributesReady, attributeError,
  initialErrors = {}, initialNodeIssues = [], authoringLocation,
  onApply, onClose, onDirtyChange
}: Props) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<SkillFormulaDraftErrors>(initialErrors);
  const [nodeIssues, setNodeIssues] = useState<FormulaNodeIssue[]>(initialNodeIssues);
  const [applyError, setApplyError] = useState<string | null>(null);
  const resolved = authoringLocation && original ? resolveAuthoringLocation(authoringLocation, original) : null;
  const unsupported = resolved && authoringLocation
    ? shouldDegradeUnsupportedAnchor(authoringLocation.editor, resolved.matchedSegments, resolved.precision) : false;
  const field = resolved?.precision === 'FIELD' && !resolved.reason && !unsupported
    ? lastFieldName(resolved.matchedSegments) : null;
  const focusPath = resolved?.precision === 'FIELD' && resolved.path[0] === 'expression' && !resolved.reason && !unsupported
    ? formulaNodePathFromResolved(resolved.path) : null;
  const locateNotice = authoringLocation && (resolved?.reason || unsupported || resolved?.precision !== 'FIELD')
    ? authoringLocateMessage({
      originalFieldPath: authoringLocation.fieldPath,
      reason: resolved?.reason ?? (original ? null : 'OBJECT_MISSING'),
      unsupportedAnchor: Boolean(unsupported), reportChanged: resolved?.reportChanged
    }) : null;
  const retainedDisabledAttributeKeys = useMemo(() => {
    const retained = new Set<string>();
    for (const key of collectReferencedAttributeKeys(initial.expression)) {
      if (attributes.find((item) => item.attributeKey === key)?.status === 'DISABLED') retained.add(key);
    }
    return retained;
  }, [attributes, initial.expression]);
  const preview = previewFormulaExpression(draft.expression, { parameters, attributes });
  const reportDirty = (next: SkillFormulaDraft) => {
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(initial));
  };
  const patch = <K extends keyof SkillFormulaDraft>(fieldName: K, value: SkillFormulaDraft[K]) => {
    const next = { ...draft, [fieldName]: value };
    setDraft(next);
    setErrors((current) => ({ ...current, [fieldName]: undefined }));
    setApplyError(null);
    reportDirty(next);
  };
  const close = () => {
    if (JSON.stringify(draft) !== JSON.stringify(initial)
      && !window.confirm('当前公式修改尚未确认，确定放弃吗？')) return;
    onDirtyChange(false);
    onClose();
  };
  const apply = () => {
    if (!attributesReady) {
      setApplyError(attributeError ?? '属性目录尚未读取完成，不能确认公式。');
      return;
    }
    const validation = validateFormulaDraft(draft, !original, { parameters, attributes });
    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      setNodeIssues(validation.nodeIssues);
      return;
    }
    const error = onApply(draft);
    if (error) {
      setApplyError(error);
      return;
    }
    onDirtyChange(false);
  };

  return <Modal title={original ? `编辑公式 · ${original.name}` : '新增公式'} visible style={{ width: 840 }}
    maskClosable onCancel={close}
    footer={<Space><Button onClick={close}>取消</Button>
      <Button type="primary" disabled={!attributesReady} onClick={apply}>确认到技能草稿</Button></Space>}>
    <Space direction="vertical" size="medium" style={{ width: '100%' }}>
      {locateNotice ? <Alert type="warning" content={locateNotice} /> : null}
      {attributeError ? <Alert type="error" content={`属性目录读取失败：${attributeError}`} /> : null}
      {applyError ? <Alert type="error" content={applyError} /> : null}
      <Form layout="vertical">
        <AuthoringFieldAnchor field="formulaKey" active={field === 'formulaKey'}>
          <Form.Item label="稳定标识" required validateStatus={errors.formulaKey ? 'error' : undefined} help={errors.formulaKey}>
            <Input aria-label="公式稳定标识" value={draft.formulaKey} disabled={Boolean(original)} maxLength={64}
              onChange={(value) => patch('formulaKey', value)} />
          </Form.Item>
        </AuthoringFieldAnchor>
        <AuthoringFieldAnchor field="name" active={field === 'name'}>
          <Form.Item label="公式名称" required validateStatus={errors.name ? 'error' : undefined} help={errors.name}>
            <Input aria-label="公式名称" value={draft.name} maxLength={100} onChange={(value) => patch('name', value)} />
          </Form.Item>
        </AuthoringFieldAnchor>
        <AuthoringFieldAnchor field="description" active={field === 'description'}>
          <Form.Item label="说明" validateStatus={errors.description ? 'error' : undefined} help={errors.description}>
            <Input.TextArea aria-label="公式说明" value={draft.description} maxLength={2000} showWordLimit
              autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => patch('description', value)} />
          </Form.Item>
        </AuthoringFieldAnchor>
        <AuthoringFieldAnchor field="sortOrder" active={field === 'sortOrder'}>
          <Form.Item label="排序" required validateStatus={errors.sortOrder ? 'error' : undefined} help={errors.sortOrder}>
            <InputNumber aria-label="公式排序" value={draft.sortOrder.trim() ? Number(draft.sortOrder) : undefined}
              min={0} precision={0} style={{ width: '100%' }}
              onChange={(value) => patch('sortOrder', value === undefined ? '' : String(value))} />
          </Form.Item>
        </AuthoringFieldAnchor>
        <AuthoringFieldAnchor field="expression" active={field === 'expression' && !focusPath}>
          <Form.Item label="公式结构" validateStatus={errors.expression ? 'error' : undefined} help={errors.expression}>
            <FormulaExpressionEditor root={draft.expression} path="expression" node={draft.expression}
              readOnly={false} disabled={!attributesReady} parameters={parameters} attributes={attributes}
              retainedDisabledAttributeKeys={retainedDisabledAttributeKeys}
              nodeIssues={nodeIssues} focusPath={focusPath}
              updateAtPath={(path, nextNode) => {
                const next = { ...draft, expression: updateNodeAtPath(draft.expression, path, nextNode) };
                setDraft(next);
                setNodeIssues([]);
                setErrors((current) => ({ ...current, expression: undefined }));
                setApplyError(null);
                reportDirty(next);
              }}
              onNodeIssue={(issue) => setNodeIssues((current) => [
                ...current.filter((item) => item.path !== issue.path), issue
              ])} />
          </Form.Item>
        </AuthoringFieldAnchor>
        <Form.Item label="中文预览"><Typography.Paragraph style={{ marginBottom: 0 }}>
          {preview.map((segment, index) => <Typography.Text key={`${index}-${segment.text}`}
            type={segment.error ? 'error' : undefined}>{segment.text}</Typography.Text>)}
        </Typography.Paragraph></Form.Item>
      </Form>
    </Space>
  </Modal>;
}
