import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { describe, expect, it } from 'vitest';
import { triggeredEquipmentSimulationSample } from '../../tests/fixtures/simulationTriggeredEquipment';
import { assembleTriggeredEquipment as raw_assembleTriggeredEquipment } from './simulationTriggeredEquipment';
import { assembleSimulation as raw_assembleSimulation, inspectSimulationSnapshot as raw_inspectSimulationSnapshot } from './simulationAdapter';
import type { SkillConfiguration } from '../types/skillConfiguration';

function undrivenEquipment() {
  const snapshot = triggeredEquipmentSimulationSample(['item_1043'], ['item_1043']);
  const source = snapshot.target.skillSources.find(row => row.origin.kind === 'EQUIPMENT')!;
  source.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
  source.enabledRuleKeys = [];
  return snapshot;
}

describe('按场景入口核对装备来源', () => {
  it('目标方无自身普攻时保留真实关系、固定属性和排除审计，不生成被动挂载', () => {
    const snapshot = undrivenEquipment();
    const before = structuredClone(snapshot);
    const triggered = assembleTriggeredEquipment(snapshot);
    expect(triggered.mounts.map(row => row.side)).toEqual(['source']);
    const inspection = inspectSimulationSnapshot(snapshot);
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspection.requirements) if (row.storedValue === undefined) {
      inputs[row.side][row.attribute.attributeKey] = row.attribute.attributeKey === 'attack_speed_ratio' ? .651 : 0;
    }
    const result = assembleSimulation(snapshot, inputs, { source: 650, target: 590 });
    expect(result.equipmentOrigins.filter(row => row.side === 'target')).toMatchObject([{ equipmentKey: 'item_1043' }]);
    expect(result.skillOrigins.find(row => row.side === 'target' && row.origin.kind === 'EQUIPMENT')).toMatchObject({ inactiveReason: 'NO_AUTONOMOUS_ATTACK' });
    expect(result.skillOrigins.find(row => row.side === 'target' && row.origin.kind === 'EQUIPMENT')?.providerRef).toBeUndefined();
    expect(snapshot).toEqual(before);
  });

  it.each(['SOURCE_INITIALIZED', 'BASIC_ATTACK_RECEIVED', 'DAMAGE_TAKEN'] as const)('排除原因不能隐藏真实%s入口', eventType => {
    const snapshot = undrivenEquipment();
    const config = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'item_1043_passive')!;
    config.triggerRules.push({ ...structuredClone(config.triggerRules[0]!), ruleKey: 'real_target_root', eventSource: { eventType, detail: {} } } as SkillConfiguration['triggerRules'][number]);
    if (eventType !== 'BASIC_ATTACK_RECEIVED') snapshot.source.skillSources.find(row => row.origin.kind === 'EQUIPMENT')!.enabledRuleKeys.push('real_target_root');
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/排除原因不能隐藏真实自然入口/);
  });

  it.each(['CONFIGURATION_INCOMPLETE', 'LEVEL_REQUIRED'] as const)('开启装备的%s仍拒绝，不能静默只取固定属性', inactiveReason => {
    const snapshot = triggeredEquipmentSimulationSample();
    snapshot.source.skillSources.find(row => row.origin.kind === 'EQUIPMENT')!.inactiveReason = inactiveReason;
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/开启装备来源缺少完整程序或明确等级/);
  });

  it.each(['SOURCE_INITIALIZED', 'BASIC_ATTACK_RECEIVED', 'DAMAGE_TAKEN'] as const)('开启清单不能漏掉本场真实%s入口', eventType => {
    const snapshot = triggeredEquipmentSimulationSample();
    const side = eventType === 'SOURCE_INITIALIZED' ? 'source' : 'target';
    if (side === 'target') {
      snapshot.selection.targetEquipmentKeys = snapshot.selection.sourceEquipmentKeys;
      snapshot.target.selectedEquipment = structuredClone(snapshot.source.selectedEquipment);
      snapshot.target.skillSources.push({ ...structuredClone(snapshot.source.skillSources.find(row => row.origin.kind === 'EQUIPMENT')!) });
    }
    const config = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'item_1043_passive')!;
    config.triggerRules.push({ ...structuredClone(config.triggerRules[0]!), ruleKey: 'missing_real_root', eventSource: { eventType, detail: {} } } as SkillConfiguration['triggerRules'][number]);
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/开启来源必须完整保留真实自然入口/);
  });

  it('未挂接伤害与独立主动兄弟保留在原快照并审计，不借普攻自动执行', () => {
    const snapshot = triggeredEquipmentSimulationSample();
    const config = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'item_1043_passive')!;
    const orphan = structuredClone(config.effects[0]!);
    orphan.effectKey = 'unbound_damage';
    if (orphan.results[0]!.resultType === 'DAMAGE') orphan.results[0]!.detail.vampQualification = 'UNRESOLVED';
    config.effects.push(orphan);
    config.triggerRules.push({ ...structuredClone(config.triggerRules[0]!), ruleKey: 'separate_active',
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: config.skill.skillKey, castPhase: 'INITIAL', useKind: 'ACTIVE' } },
      actions: [{ ...structuredClone(config.triggerRules[0]!.actions[0]!), detail: { effectKey: orphan.effectKey } }] });
    const before = structuredClone(snapshot);
    const result = assembleTriggeredEquipment(snapshot);
    expect(result.providers[0]!.abilities).toHaveLength(1);
    expect(result.coverage).toContainEqual(expect.objectContaining({ authorPath: `skills.${config.skill.skillKey}.effects.unbound_damage`, note: expect.stringContaining('没有可达入口') }));
    expect(result.coverage).toContainEqual(expect.objectContaining({ authorPath: `skills.${config.skill.skillKey}.triggerRules.separate_active` }));
    expect(snapshot).toEqual(before);
  });

  it('主动暂缓只排除未驱动分支，不能隐藏其它独立未知事件', () => {
    const snapshot = triggeredEquipmentSimulationSample();
    const config = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'item_1043_passive')!;
    config.triggerRules[0]!.eventSource = { eventType: 'SKILL_USED', detail: { sourceSkillKey: config.skill.skillKey, castPhase: 'INITIAL', useKind: 'ACTIVE' } };
    const source = snapshot.source.skillSources.find(row => row.origin.kind === 'EQUIPMENT')!;
    source.inactiveReason = 'ACTIVE_DEFERRED';
    source.enabledRuleKeys = [];
    expect(assembleTriggeredEquipment(snapshot).mounts).toHaveLength(0);
    config.triggerRules.push({ ...structuredClone(config.triggerRules[0]!), ruleKey: 'unknown_independent_event',
      eventSource: { eventType: 'ENTITY_DIED', detail: { subject: 'SOURCE' } } });
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/主动后置原因不能隐藏真实自然入口/);
  });
});

const assembleSimulation = (...args: Parameters<typeof raw_assembleSimulation>): ReturnType<typeof raw_assembleSimulation> => { approveSnapshotFixture(args[0]); return raw_assembleSimulation(...args); };
const inspectSimulationSnapshot = (...args: Parameters<typeof raw_inspectSimulationSnapshot>): ReturnType<typeof raw_inspectSimulationSnapshot> => { approveSnapshotFixture(args[0]); return raw_inspectSimulationSnapshot(...args); };

const assembleTriggeredEquipment = (...args: Parameters<typeof raw_assembleTriggeredEquipment>): ReturnType<typeof raw_assembleTriggeredEquipment> => { approveSnapshotFixture(args[0]); return raw_assembleTriggeredEquipment(...args); };
