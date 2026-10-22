import type { ProcessDefinition, ProcessInstanceSnapshot, SkillActionBinding } from '../types/genericEngine';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillParameter } from '../types/skillParameter';
import { tryFoldConstant } from './numericAdapter';

export function recastProofLevels(parameters: readonly SkillParameter[], skillLevel: number, characterLevel: number) {
  const levels = (kind: 'SKILL_LEVEL' | 'CHARACTER_LEVEL', selected: number) => [...new Set([selected,
    ...parameters.filter(p => p.valueMode === kind).flatMap(p => Object.keys(p.levelValues ?? {}).map(Number))])];
  return levels('SKILL_LEVEL', skillLevel).flatMap(skillLevel => levels('CHARACTER_LEVEL', characterLevel).map(characterLevel => ({ skillLevel, characterLevel })));
}

/** 只识别已声明的零占用首发与末尾有限重施，不放宽其它复杂图。 */
export function finiteRecastShape(steps: readonly { stepType: string; occupiesAction?: boolean | null }[]): boolean {
  return steps.length === 2 && steps[0]!.stepType === 'IMMEDIATE' && steps[1]!.stepType === 'RECAST'
    && steps.every(step => step.occupiesAction === false);
}

export function finiteRecastDefinition(process: ProcessDefinition): { maximum: number; interval: number; window: number } | null {
  if (!finiteRecastShape(process.steps)) return null;
  return recastDefinition(process);
}

export function recastDefinition(process: ProcessDefinition): { maximum: number; interval: number; window: number } | null {
  const terminal = process.steps[process.steps.length - 1];
  if (!terminal || terminal.stepType !== 'RECAST') return null;
  const maximum = terminal.maximumRecastCount && tryFoldConstant(terminal.maximumRecastCount);
  const window = terminal.windowMs && tryFoldConstant(terminal.windowMs);
  const interval = terminal.intervalMs === undefined ? 0 : terminal.intervalMs === null ? null : tryFoldConstant(terminal.intervalMs);
  if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 63
    || typeof window !== 'number' || !Number.isSafeInteger(window) || window <= 0
    || typeof interval !== 'number' || !Number.isSafeInteger(interval) || interval < 0
    || terminal.intervalMs !== undefined && interval === 0) throw new Error('有限重施必须有静态次数1～63、正窗口及未配置或正间隔');
  if (maximum > 1 && !finiteRecastShape(process.steps)) throw new Error('多次重施仅接受明确两步零占用图');
  return { maximum, interval, window };
}

export function automaticSkillPhases(configuration: SkillConfiguration): ('INITIAL' | 'RECAST')[] {
  const initial = configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_USED'
    && rule.eventSource.detail.sourceSkillKey === configuration.skill.skillKey && rule.eventSource.detail.castPhase === 'INITIAL');
  const starts = initial.flatMap(rule => rule.actions.filter(action => action.actionType === 'START_PROCESS'));
  const process = starts.length === 1 ? configuration.processes.find(x => x.processKey === starts[0]!.detail.processKey) : undefined;
  if (!process || !finiteRecastShape([...process.steps].sort((a, b) => a.sortOrder - b.sortOrder))) return ['INITIAL'];
  const advances = configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_USED'
    && rule.eventSource.detail.sourceSkillKey === configuration.skill.skillKey && rule.eventSource.detail.castPhase === 'RECAST'
    && rule.actions.some(action => action.actionType === 'ADVANCE_PROCESS' && action.detail.processKey === process.processKey));
  if (advances.length !== 1) throw new Error('有限自动重施需要唯一真实RECAST入口');
  return ['INITIAL', 'RECAST'];
}

export function finiteRecastControls(binding: SkillActionBinding, process: ProcessDefinition): boolean {
  if (!finiteRecastDefinition(process)) return false;
  return binding.controls.length === 2 && ['INITIAL', 'RECAST'].every(action => binding.controls.filter(c => c.action === action && c.processKey === process.processKey).length === 1);
}

export function recastUseRef(window: string, ordinal: number): string {
  if (!window.startsWith('skill:') || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 63) throw new Error('重施使用必须来自真实首次和有界序号');
  return ordinal === 0 ? window : `recast:${window}:${ordinal}`;
}

/** 只在已确定的真实过程上核字面关系；字符串本身不授予过程或来源资格。 */
export function recastUseOrdinal(process: ProcessInstanceSnapshot, definition: ProcessDefinition, ref: string): number | null {
  const shape = recastDefinition(definition);
  if (!shape || !process.useKey.startsWith('skill:')) return null;
  if (ref === process.useKey) return 0;
  if (!ref.startsWith('recast:')) return null;
  const cut = ref.lastIndexOf(':'), parent = ref.slice(7, cut), suffix = ref.slice(cut + 1);
  if (parent !== process.useKey || !/^[1-9][0-9]*$/.test(suffix)) return null;
  const ordinal = Number(suffix);
  return Number.isSafeInteger(ordinal) && ordinal <= shape.maximum && ordinal <= process.stepExecutionIndex
    && process.stepVersion === definition.steps.length
    && (process.skillHitStages === undefined ? shape.maximum === 1 && ordinal === 1
      : !!process.skillHitStages.filter(f => f.stepKey === definition.steps[definition.steps.length - 1]!.stepKey)[ordinal - 1]) ? ordinal : null;
}

export function processForSkillUse(processes: readonly ProcessInstanceSnapshot[], definitions: readonly ProcessDefinition[], ref: string): ProcessInstanceSnapshot | undefined {
  const matches = processes.filter(process => process.useKey === ref || definitions.some(definition => definition.processKey === process.processKey
    && definition.skillKey === process.skillKey && recastUseOrdinal(process, definition, ref) !== null));
  return matches.length === 1 ? matches[0] : undefined;
}
