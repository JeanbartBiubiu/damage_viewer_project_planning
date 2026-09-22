import { Form, Select } from '@arco-design/web-react';
import type { SkillProcessFailureReason, SkillProcessMomentType } from '../../../../types/skillProcess';
import type { SkillProcessStepDraft } from './processForm';
import {
  MISSING_CATALOG_LABEL,
  PROCESS_FAILURE_REASON_ANY_LABEL,
  PROCESS_FAILURE_REASON_LABELS,
  PROCESS_FAILURE_REASONS,
  SKILL_PROCESS_MOMENT_TYPE_LABELS,
  SKILL_PROCESS_MOMENT_TYPES,
  isProcessLevelMoment,
  listStepOptions,
  stepExecutionMomentHint
} from './processForm';

type MomentFieldsProps = {
  momentType: SkillProcessMomentType;
  stepKey: string;
  failureReason?: SkillProcessFailureReason | '';
  steps: SkillProcessStepDraft[];
  momentError?: string;
  stepKeyError?: string;
  failureReasonError?: string;
  disabled?: boolean;
  onMomentTypeChange: (value: SkillProcessMomentType) => void;
  onStepKeyChange: (value: string) => void;
  onFailureReasonChange?: (value: SkillProcessFailureReason | '') => void;
};

export function SkillProcessMomentFields({
  momentType,
  stepKey,
  failureReason = '',
  steps,
  momentError,
  stepKeyError,
  failureReasonError,
  disabled,
  onMomentTypeChange,
  onStepKeyChange,
  onFailureReasonChange
}: MomentFieldsProps) {
  const needsStep = !isProcessLevelMoment(momentType);
  const selectedStep = steps.find((item) => item.stepKey.trim() === stepKey.trim());
  const executionHint = needsStep && momentType === 'STEP_EXECUTION'
    ? stepExecutionMomentHint(selectedStep?.stepType)
    : null;
  const stepOptions = listStepOptions(steps, stepKey).map((option) => {
    const step = steps.find((item) => item.stepKey.trim() === option.key);
    return {
      value: option.key,
      label: option.source === 'unknown'
        ? `${option.key}（${MISSING_CATALOG_LABEL}）`
        : (step?.name || option.key),
      disabled: option.source === 'unknown'
    };
  });

  return (
    <>
      <Form.Item
        label="过程时点"
        required
        extra={executionHint}
        validateStatus={momentError ? 'error' : undefined}
        help={momentError}
      >
        <Select
          aria-label="过程时点"
          value={momentType}
          disabled={disabled}
          options={SKILL_PROCESS_MOMENT_TYPES.map((value) => ({
            value,
            label: SKILL_PROCESS_MOMENT_TYPE_LABELS[value]
          }))}
          onChange={(value) => onMomentTypeChange(value as SkillProcessMomentType)}
        />
      </Form.Item>
      {needsStep ? (
        <Form.Item
          label="步骤"
          required
          validateStatus={stepKeyError ? 'error' : undefined}
          help={stepKeyError}
        >
          <Select
            aria-label="步骤"
            value={stepKey || undefined}
            disabled={disabled}
            options={stepOptions}
            placeholder="请选择步骤"
            onChange={(value) => onStepKeyChange(String(value ?? ''))}
          />
        </Form.Item>
      ) : null}
      {momentType === 'PROCESS_FAILURE' ? (
        <Form.Item
          label="失败原因"
          validateStatus={failureReasonError ? 'error' : undefined}
          help={failureReasonError}
        >
          <Select
            aria-label="失败原因"
            allowClear
            value={failureReason || undefined}
            disabled={disabled}
            placeholder={PROCESS_FAILURE_REASON_ANY_LABEL}
            options={PROCESS_FAILURE_REASONS.map((value) => ({
              value,
              label: PROCESS_FAILURE_REASON_LABELS[value]
            }))}
            onChange={(value) => onFailureReasonChange?.(
              value ? value as SkillProcessFailureReason : ''
            )}
          />
        </Form.Item>
      ) : null}
    </>
  );
}
