import { ApiRequestError } from '../../../services/apiClient';
import { getAttribute } from '../../../services/attributeClient';
import { getDamageType } from '../../../services/damageTypeClient';
import { getModifierZone } from '../../../services/modifierZoneClient';
import { getStatus } from '../../../services/statusClient';
import { getSkillCategory } from '../../../services/skillCategoryClient';
import { getSkill } from '../../../services/skillClient';
import { getSkillEffect } from '../../../services/skillEffectClient';
import { getSkillFormula } from '../../../services/skillFormulaClient';
import { getSkillParameter } from '../../../services/skillParameterClient';
import { getSkillProcess } from '../../../services/skillProcessClient';
import { getSkillInternalState } from '../../../services/skillInternalStateClient';
import { getSkillTriggerRule } from '../../../services/skillTriggerRuleClient';
import type { AuthoringCheckReference } from '../../../types/characterAuthoringCheck';
import { mapWithConcurrency } from '../skills/overview/mapWithConcurrency';

export type ReferenceTarget = { type: string; skillKey: string | null; key: string; subKey: string | null };
export type ReferenceName = { state: 'ready' | 'missing' | 'failed'; name?: string; disabled?: boolean };
export const referenceNameKey = (target: ReferenceTarget): string => JSON.stringify(target);
export const referenceSource = (row: AuthoringCheckReference): ReferenceTarget => ({
  type: row.sourceType, skillKey: row.sourceSkillKey, key: row.sourceKey, subKey: null
});
export const referenceTarget = (row: AuthoringCheckReference): ReferenceTarget => ({
  type: row.targetType, skillKey: row.targetSkillKey, key: row.targetKey, subKey: row.targetSubKey
});

export function referenceNameLabel(target: ReferenceTarget, names: ReadonlyMap<string, ReferenceName>): string {
  const result = names.get(referenceNameKey(target));
  const key = [target.key, target.subKey].filter(Boolean).join('/');
  if (!result) return `加载中（${key}）`;
  if (result.state === 'failed') return `名称加载失败（${key}）`;
  if (result.state === 'missing') return `目录缺失（${key}）`;
  return `${result.name || '名称未填写'}（${key}）${result.disabled ? '（已停用）' : ''}`;
}

type NamedRecord = { name?: unknown; status?: unknown; [key: string]: unknown };
const isRecord = (value: unknown): value is NamedRecord => !!value && typeof value === 'object' && !Array.isArray(value);

export async function loadAuthoringReferenceNames(
  refs: readonly AuthoringCheckReference[],
  context: { apiBaseUrl: string; gameId: string; token: string },
  isCurrent: () => boolean
): Promise<Map<string, ReferenceName>> {
  const { apiBaseUrl: api, gameId: game, token } = context;
  const parents = new Map<string, Promise<unknown>>();
  const distinct = new Map<string, ReferenceTarget>();
  for (const ref of refs) for (const target of [referenceSource(ref), referenceTarget(ref)]) {
    distinct.set(referenceNameKey(target), target);
  }
  const parentType = (type: string) => ({ RESULT: 'EFFECT', LIFECYCLE: 'EFFECT', STEP: 'PROCESS', OPTION: 'STATE', ACTION: 'TRIGGER' }[type] ?? type);
  const readParent = (target: ReferenceTarget): Promise<unknown> => {
    const type = parentType(target.type);
    const id = JSON.stringify([type, target.skillKey, target.key]);
    const existing = parents.get(id);
    if (existing) return existing;
    const scoped = () => {
      if (!target.skillKey) throw new Error('缺少技能身份');
      return target.skillKey;
    };
    const read = async () => {
      switch (type) {
        case 'ATTRIBUTE': return (await getAttribute(api, game, target.key, token)).data;
        case 'DAMAGE_TYPE': return (await getDamageType(api, game, target.key, token)).data;
        case 'MODIFIER_ZONE': return (await getModifierZone(api, game, target.key, token)).data;
        case 'STATUS': return (await getStatus(api, game, target.key, token)).data;
        case 'SKILL_CATEGORY': return (await getSkillCategory(api, game, target.key, token)).data;
        case 'SKILL': return (await getSkill(api, game, target.key, token)).data;
        case 'EFFECT': return (await getSkillEffect(api, game, scoped(), target.key, token)).data;
        case 'FORMULA': return (await getSkillFormula(api, game, scoped(), target.key, token)).data;
        case 'PARAMETER': return (await getSkillParameter(api, game, scoped(), target.key, token)).data;
        case 'PROCESS': return (await getSkillProcess(api, game, scoped(), target.key, token)).data;
        case 'STATE': return (await getSkillInternalState(api, game, scoped(), target.key, token)).data;
        case 'TRIGGER': return (await getSkillTriggerRule(api, game, scoped(), target.key, token)).data;
        default: throw new Error('未支持的引用目录');
      }
    };
    const promise = read();
    parents.set(id, promise);
    return promise;
  };
  const names = new Map<string, ReferenceName>();
  await mapWithConcurrency([...distinct.values()], 4, async target => {
    if (!isCurrent()) return;
    let result: ReferenceName;
    try {
      const parent = await readParent(target);
      if (!isRecord(parent)) throw new Error('引用详情响应不完整');
      let item: NamedRecord = parent;
      if (target.subKey) {
        const child = { RESULT: ['results', 'resultKey'], STEP: ['steps', 'stepKey'], OPTION: ['options', 'optionKey'], ACTION: ['actions', 'actionKey'] }[target.type];
        if (!child) throw new Error('未知子引用');
        const container = target.type === 'OPTION' ? parent.detail : parent;
        const rows = isRecord(container) ? container[child[0]!] : null;
        if (!Array.isArray(rows)) throw new Error('引用子项响应不完整');
        const matches = rows.filter(row => isRecord(row) && row[child[1]!] === target.subKey);
        if (!matches.length) {
          names.set(referenceNameKey(target), { state: 'missing' });
          return;
        }
        if (matches.length !== 1) throw new Error('引用子项标识不唯一');
        item = matches[0] as NamedRecord;
      }
      if (typeof item.name !== 'string' && item.name !== null) throw new Error('引用名称响应不完整');
      result = { state: 'ready', name: typeof item.name === 'string' ? item.name : '', disabled: parent.status === 'DISABLED' };
    } catch (failure) {
      result = { state: failure instanceof ApiRequestError && failure.status === 404 ? 'missing' : 'failed' };
    }
    if (isCurrent()) names.set(referenceNameKey(target), result);
  });
  return names;
}
