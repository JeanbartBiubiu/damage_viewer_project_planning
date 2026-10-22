import { settledDamageHealSample } from './settledDamageHeal';
import { syncSimulationSkillSources } from './simulationSkillSources';
import type { SkillEffectResult } from '../../src/types/skillEffect';

/** 纯合成作者图：有限区域、独立本笔自疗和独立总冷却比例返还。没有运行或核定值注入。 */
export function finiteImmediatePeriodicSample() {
  const sample = settledDamageHealSample(), { snapshot, configuration, rule } = sample;
  const spell = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'authored_spell_damage')!;
  const auxiliary = structuredClone(spell);
  auxiliary.skill.skillKey = 'auxiliary_spell_damage';
  for (const row of [...auxiliary.effects, ...auxiliary.processes]) row.skillKey = auxiliary.skill.skillKey;
  for (const row of auxiliary.triggerRules) if (row.eventSource.eventType === 'SKILL_USED' || row.eventSource.eventType === 'SKILL_HIT') row.eventSource.detail.sourceSkillKey = auxiliary.skill.skillKey;
  snapshot.skillConfigurations.push(auxiliary);
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills.find(row => row.skillKey === spell.skill.skillKey)!, skillKey: auxiliary.skill.skillKey });
  snapshot.selection.sourceSkillSettings.push({ ...snapshot.selection.sourceSkillSettings.find(row => row.skillKey === spell.skill.skillKey)!, skillKey: auxiliary.skill.skillKey });
  snapshot.selection.plannedSkills.push({ ...snapshot.selection.plannedSkills.find(row => row.skillKey === spell.skill.skillKey)!, skillKey: auxiliary.skill.skillKey });
  const area = spell.effects[0]!; area.effectKey = 'finite_area'; area.name = '有限纯周期区域';
  area.lifecycle = { instanceScope: 'SOURCE_TARGET', durationValue: { kind: 'FIXED', value: 5000 },
    maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 },
    reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE',
    periodicIntervalValue: { kind: 'FIXED', value: 500 }, firstPeriodicExecution: 'IMMEDIATE', endWhenShieldEndsResultKey: null };
  const damage = area.results[0]!;
  if (damage.resultType !== 'DAMAGE') throw new Error('有限区域必须是真实伤害作者');
  damage.detail.damageTypeKey = 'magic';
  const magic = structuredClone(snapshot.catalogs.damageTypes[0]!);
  magic.type.damageTypeKey = 'magic'; magic.type.name = '合成法术伤害'; magic.formula.damageTypeKey = 'magic';
  for (const input of magic.formula.formula!.inputs) if (input.binding.kind === 'attribute') input.binding.attributeKey = input.binding.attributeKey.replace('armor', 'magic_resistance')
    .replace('magic_resistance_pen', 'magic_pen');
  snapshot.catalogs.damageTypes.push(magic);
  damage.spellShieldBlockScope = null;
  damage.lifecycleBehavior = { moment: 'PERIODIC', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: null,
    reapplicationValueMode: null, periodicExecutionMode: 'ONCE_PER_INSTANCE' };
  damage.valueRule = { value: { kind: 'FORMULA', formulaKey: 'current_periodic_damage' }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null };
  spell.formulas = [{ gameId: snapshot.gameId, skillKey: spell.skill.skillKey, formulaKey: 'current_periodic_damage', name: '当前属性逐笔伤害',
    description: null, sortOrder: 0, createdAt: '', updatedAt: '', expression: {
      inputs: [{ key: 'ap', binding: { kind: 'attribute', view: 'current_frame', object: 'source', valueKind: 'TOTAL', attributeKey: 'ability_power' } },
        { key: 'hp', binding: { kind: 'attribute', view: 'current_frame', object: 'target', valueKind: 'CURRENT', attributeKey: 'hp' } },
        { key: 'maximum', binding: { kind: 'attribute', view: 'current_frame', object: 'target', valueKind: 'MAX', attributeKey: 'hp' } }],
      stages: [{ key: 'output', name: '每跳当前法强与目标缺血', expression: { op: 'mul', args: [
        { op: 'div', args: [{ op: 'add', args: [{ op: 'const', value: '18' }, { op: 'mul', args: [{ op: 'const', value: '0.2' }, { op: 'read', inputKey: 'ap' }] }] }, { op: 'const', value: '2' }] },
        { op: 'sub', args: [{ op: 'const', value: '2' }, { op: 'div', args: [{ op: 'read', inputKey: 'hp' }, { op: 'read', inputKey: 'maximum' }] }] }
      ] } }], outputStageKey: 'output' } }];
  spell.triggerRules = [spell.triggerRules[0]!];
  spell.formulas.push({ ...spell.formulas[0]!, formulaKey: 'effective_cooldown', name: '当前急速普通冷却', sortOrder: 1,
    expression: { inputs: [{ key: 'haste', binding: { kind: 'attribute', view: 'current_frame', object: 'source', valueKind: 'TOTAL', attributeKey: 'ability_haste' } }],
      stages: [{ key: 'output', name: '真实过程开始读取急速', expression: { op: 'div', args: [{ op: 'const', value: '1200000' },
        { op: 'add', args: [{ op: 'const', value: '100' }, { op: 'read', inputKey: 'haste' }] }] } }], outputStageKey: 'output' } });
  spell.processes[0]!.cooldown!.durationValue = { kind: 'FORMULA', formulaKey: 'effective_cooldown' };
  spell.processes[0]!.effectBindings = [{ bindingKey: 'apply_area', effectKey: area.effectKey, sortOrder: 0,
    moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } }];
  rule.conditionGroups[0]!.conditions.push({ conditionKey: 'positive', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 1,
    detail: { eventValueKey: 'POST_DEFENSE_DAMAGE', comparator: 'GT', comparisonValue: { kind: 'FIXED', value: 0 } } });
  const refund = structuredClone(configuration.effects[0]!); refund.effectKey = 'refund_committed_total';
  refund.results = [{ ...refund.results[0]!, resultKey: 'refund', resultType: 'COOLDOWN_CHANGE', target: 'SOURCE',
    detail: { operation: 'REDUCE_TOTAL_RATIO', affectedSkillScope: { mode: 'SKILLS', skillKeys: [spell.skill.skillKey], skillCategoryKeys: [] } },
    valueRule: { value: { kind: 'FIXED', value: .05 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null } } satisfies SkillEffectResult];
  configuration.effects.push(refund);
  const refundRule = structuredClone(rule); refundRule.ruleKey = 'on_settled_refund'; refundRule.sortOrder = 20;
  const action = refundRule.actions[0]!;
  if (action.actionType !== 'EXECUTE_EFFECT') throw new Error('合成退款需要独立执行效果');
  action.detail = { effectKey: refund.effectKey }; action.runtimeInputBindings = [];
  configuration.triggerRules.push(refundRule);
  for (const key of ['ability_power', 'ability_haste', 'magic_resistance', 'magic_pen_flat', 'magic_pen_percent']) if (!snapshot.catalogs.attributes.some(row => row.attributeKey === key)) {
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: key, valueType: 'DECIMAL' });
  }
  Object.assign(snapshot.source.selectedLevelValues, { hp: 1000, attack_damage: 10, attack_speed: .1, ability_power: 100, ability_haste: 0,
    armor_pen_flat: 0, armor_pen_percent: 0, magic_pen_flat: 0, magic_pen_percent: 0, critical_strike_chance: 0,
    critical_strike_damage_bonus_percent: 0, life_steal_percent: 0, omnivamp_percent: 0 });
  Object.assign(snapshot.target.selectedLevelValues, { hp: 1000, armor: 0, magic_resistance: 0 });
  syncSimulationSkillSources(snapshot);
  return { ...sample, spell, auxiliary, area, damage, refund, refundRule };
}
