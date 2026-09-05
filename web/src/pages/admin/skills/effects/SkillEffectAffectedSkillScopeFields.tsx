import { Button, Form, Radio, Select, Space } from '@arco-design/web-react';
import {
  AFFECTED_SKILL_SCOPE_MODE_LABELS,
  AFFECTED_SKILL_SCOPE_MODES,
  applyAffectedSkillScopeModeChange,
  type AffectedSkillScopeDraft,
  type SkillEffectResultDraft,
  type SkillEffectResultDraftErrors
} from './effectForm';
import type { SkillEffectAffectedSkillScopeMode } from '../../../../types/skillEffect';

export type SkillEffectAffectedSkillScopeSelectOption = {
  label: string;
  value: string;
  disabled: boolean;
};

type SkillEffectAffectedSkillScopeFieldsProps = {
  draft: SkillEffectResultDraft;
  errors: SkillEffectResultDraftErrors;
  readOnly: boolean;
  skillOptions: SkillEffectAffectedSkillScopeSelectOption[];
  categoryOptions: SkillEffectAffectedSkillScopeSelectOption[];
  skillsLoading?: boolean;
  categoriesLoading?: boolean;
  onChange: (next: SkillEffectResultDraft) => void;
  onCreateCategory?: () => void;
};

function optionLabel(
  options: SkillEffectAffectedSkillScopeSelectOption[],
  value: unknown
): string {
  const key = typeof value === 'object' && value !== null && 'value' in value
    ? String((value as { value: unknown }).value)
    : String(value);
  return options.find((item) => item.value === key)?.label ?? key;
}

export function SkillEffectAffectedSkillScopeFields({
  draft,
  errors,
  readOnly,
  skillOptions,
  categoryOptions,
  skillsLoading,
  categoriesLoading,
  onChange,
  onCreateCategory
}: SkillEffectAffectedSkillScopeFieldsProps) {
  const scope: AffectedSkillScopeDraft = draft.affectedSkillScope;

  const patchScope = (nextScope: AffectedSkillScopeDraft) => {
    onChange({
      ...draft,
      affectedSkillScope: nextScope
    });
  };

  return (
    <>
      <Form.Item
        label="技能范围"
        required
        validateStatus={
          errors.affectedSkillScopeMode || errors.affectedSkillScope ? 'error' : undefined
        }
        help={errors.affectedSkillScopeMode || errors.affectedSkillScope}
      >
        <Radio.Group
          aria-label="技能范围"
          value={scope.mode}
          disabled={readOnly}
          onChange={(value) => onChange(
            applyAffectedSkillScopeModeChange(draft, value as SkillEffectAffectedSkillScopeMode)
          )}
        >
          {AFFECTED_SKILL_SCOPE_MODES.map((mode) => (
            <Radio key={mode} value={mode}>{AFFECTED_SKILL_SCOPE_MODE_LABELS[mode]}</Radio>
          ))}
        </Radio.Group>
      </Form.Item>
      {scope.mode === 'SKILLS' ? (
        <Form.Item
          label="指定技能"
          required
          validateStatus={errors.affectedSkillKeys ? 'error' : undefined}
          help={errors.affectedSkillKeys}
        >
          <Select
            aria-label="指定技能"
            mode="multiple"
            value={scope.skillKeys}
            disabled={readOnly}
            loading={Boolean(skillsLoading)}
            options={skillOptions}
            placeholder="请选择一个或多个技能"
            renderFormat={(_option, value) => optionLabel(skillOptions, value)}
            onChange={(value) => patchScope({
              ...scope,
              skillKeys: Array.isArray(value) ? value.map(String) : []
            })}
          />
        </Form.Item>
      ) : null}
      {scope.mode === 'CATEGORIES' ? (
        <Form.Item
          label="指定技能分类"
          required
          validateStatus={errors.skillCategoryKeys ? 'error' : undefined}
          help={errors.skillCategoryKeys}
        >
          <Space style={{ width: '100%' }}>
            <Select
              aria-label="指定技能分类"
              mode="multiple"
              value={scope.skillCategoryKeys}
              disabled={readOnly}
              loading={Boolean(categoriesLoading)}
              options={categoryOptions}
              placeholder="请选择一个或多个技能分类"
              style={{ minWidth: 360 }}
              renderFormat={(_option, value) => optionLabel(categoryOptions, value)}
              onChange={(value) => patchScope({
                ...scope,
                skillCategoryKeys: Array.isArray(value) ? value.map(String) : []
              })}
            />
            {!readOnly && onCreateCategory ? (
              <Button onClick={onCreateCategory}>新增技能分类</Button>
            ) : null}
          </Space>
        </Form.Item>
      ) : null}
    </>
  );
}
