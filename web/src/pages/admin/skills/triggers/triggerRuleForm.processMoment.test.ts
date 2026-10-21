import { describe, expect, it } from 'vitest';
import type { SkillProcess } from '../../../../types/skillProcess';
import type { SkillTriggerRuleDetail } from '../../../../types/skillTriggerRule';
import { fixedValue } from '../../../../types/numericValue';
import { fromDetail, toCreateRequest, toUpdateRequest, validateSkillTriggerDraft } from './triggerRuleForm';

const process: SkillProcess = { gameId: 'lab', skillKey: 'configured_skill', processKey: 'cast', name: '有限施放', activationType: 'ACTIVE',
  description: null, sortOrder: 0, cooldown: null, effectBindings: [], stateOperations: [], createdAt: '', updatedAt: '',
  steps: ['first', 'second'].map((stepKey, sortOrder) => ({ stepKey, sortOrder, name: stepKey, description: null, stepType: 'DELAY',
    occupiesAction: true, detail: { delayValue: fixedValue(250) } })) };
const detail: SkillTriggerRuleDetail = { ruleKey: 'phase_hit', name: '阶段命中', description: null, sortOrder: 0,
  eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: process.skillKey, processMoment: {
    processKey: process.processKey, moment: { momentType: 'STEP_EXECUTION', stepKey: 'second' }, requiresPriorStepKey: 'first'
  } } }, conditionGroups: [], actions: [{ actionKey: 'hit', name: '命中', actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'hit' },
    sortOrder: 0, targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }],
  perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null };

it('阶段命中编辑往返保持完整时点和资格依赖', () => {
  const draft = fromDetail(structuredClone(detail), process.skillKey);
  expect(toCreateRequest(draft).eventSource).toEqual(detail.eventSource);
  draft.name = '只改名称';
  expect(toUpdateRequest(draft).eventSource).toEqual(detail.eventSource);
});

describe('阶段命中表单边界', () => {
  it.each(['valid', 'foreign_skill', 'foreign_process', 'missing_step', 'forward'])(
    '保留本技能真实阶段约束：%s', kind => {
      const draft = fromDetail(structuredClone(detail), process.skillKey);
      if (draft.eventSource.eventType !== 'SKILL_HIT') throw new Error('fixture');
      if (kind === 'foreign_skill') draft.eventSource.detail.sourceSkillKey = 'other';
      if (kind === 'foreign_process') draft.eventSource.detail.processMoment!.processKey = 'other';
      if (kind === 'missing_step') draft.eventSource.detail.processMoment!.moment.stepKey = 'missing';
      if (kind === 'forward') draft.eventSource.detail.processMoment!.requiresPriorStepKey = 'second';
      const validation = validateSkillTriggerDraft(draft, { includeRuleKey: true, skillKey: process.skillKey,
        processesByKey: new Map([[process.processKey, process]]) });
      const errors = validation.ok ? [] : validation.nestedErrors.filter(error => error.path.startsWith('eventSource.detail.processMoment'));
      expect(errors.length > 0).toBe(kind !== 'valid');
    }
  );
});
