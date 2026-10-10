import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { describe, expect, it } from 'vitest';
import { equipmentSimulationSample } from '../../tests/fixtures/simulationEquipment';
import { assembleSimulation as raw_assembleSimulation, inspectSimulationSnapshot as raw_inspectSimulationSnapshot, prepareSimulation, singleAttackRequest } from './simulationAdapter';
import { continuousAttackRequest } from './continuousAttackRequest';
import { simulationHealthLimit } from './simulationEquipment';

function inputsFor(snapshot: ReturnType<typeof equipmentSimulationSample>) {
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) {
    if (row.storedValue === undefined && row.attribute.attributeKey !== 'attack_speed_ratio') inputs[row.side][row.attribute.attributeKey] = 0;
  }
  return inputs;
}
const health = { source: 650, target: 590 };

describe('阶段4A纯属性装备装配', () => {
  it('名单外的纯属性装备使用真实属性与独立来源，不要求装备编号或被动关系', () => {
    const snapshot = equipmentSimulationSample(['item_1036']);
    snapshot.selection.sourceEquipmentKeys = ['authored_plain_equipment'];
    const item = snapshot.source.selectedEquipment[0]!;
    item.equipment.equipmentKey = 'authored_plain_equipment';
    item.attributes.equipmentKey = 'authored_plain_equipment';
    const result = assembleSimulation(snapshot, inputsFor(snapshot), health);
    expect(result.compileRequest.combatants[0]!.attributes.attack_damage!.resolved).toBe(70);
    expect(result.equipmentOrigins).toMatchObject([{ equipmentKey: 'authored_plain_equipment', attributeValues: { attack_damage: 10 } }]);
  });
  it('每件仅一份item来源，固定增量只进入add修正，固有值不混装', () => {
    const snapshot = equipmentSimulationSample(['item_1036']);
    const result = assembleSimulation(snapshot, inputsFor(snapshot), health);
    const source = result.compileRequest.combatants[0]!;
    const target = result.compileRequest.combatants[1]!;
    expect(source.attributes.attack_damage).toEqual({ base: 60, current: 70, resolved: 70, max: 70 });
    expect(target.attributes.attack_damage!.resolved).toBe(53);
    expect(source.providers).toHaveLength(2);
    expect(target.providers).toEqual([]);
    const item = result.compileRequest.sharedProviders![1]!;
    expect(item).toMatchObject({ kind: 'item', modifiers: [{ kind: 'attribute', target: 'self.attr.attack_damage', valuePolicy: 'add', value: { op: 'const', value: 10 } }] });
    expect(item.abilities).toBeUndefined();
    expect(result.equipmentOrigins).toMatchObject([{ side: 'source', equipmentKey: 'item_1036', attributeValues: { attack_damage: 10 } }]);
    expect(result.coverage).toContainEqual({ authorPath: 'source.selectedEquipment[item_1036].attributes.attributeValues.attack_damage', compiledPath: 'sharedProviders[1].modifiers[0]' });
  });

  it('双方同装备挂载身份隔离，各自生命只平加一次，当前生命保持显式草稿', () => {
    const snapshot = equipmentSimulationSample(['item_1028', 'item_1036'], ['item_1028', 'item_1036']);
    const result = assembleSimulation(snapshot, inputsFor(snapshot), { source: 711, target: 600 });
    const [source, target] = result.compileRequest.combatants;
    expect(source!.attributes.hp).toEqual({ base: 650, current: 711, max: 800, resolved: 800 });
    expect(target!.attributes.hp).toEqual({ base: 590, current: 600, max: 740, resolved: 740 });
    expect(target!.attributes.attack_damage!.resolved).toBe(63);
    expect(result.equipmentOrigins).toHaveLength(4);
    expect(new Set(result.equipmentOrigins.map(row => row.definitionRef)).size).toBe(4);
    expect(result.equipmentOrigins.filter(row => row.side === 'target').map(row => row.providerRef)).not.toEqual(source!.providers.map(row => row.providerRef));
    expect(singleAttackRequest(result.compileRequest, 'session').initialSnapshot.combatants[1]!.providers).toHaveLength(2);
  });

  it('换装后的生命上限按新装备重新校验，不自动满血、夹取或累加旧上限', () => {
    const snapshot = equipmentSimulationSample(['item_1028']);
    expect(simulationHealthLimit(snapshot, 'source')).toBe(800);
    expect(assembleSimulation(snapshot, inputsFor(snapshot), { ...health, source: 799 }).initialHealth.source).toBe(799);
    expect(() => assembleSimulation(snapshot, inputsFor(snapshot), { ...health, source: 801 })).toThrow(/initialHealth.source/);
    snapshot.source.selectedEquipment = [];
    snapshot.selection.sourceEquipmentKeys = [];
    expect(simulationHealthLimit(snapshot, 'source')).toBe(650);
    expect(() => assembleSimulation(snapshot, inputsFor(snapshot), { ...health, source: 799 })).toThrow(/不自动填满或夹取/);
  });

  it('零生命固有值有效；缺失固有生命仍须补全，不能从装备推定为0', () => {
    const snapshot = equipmentSimulationSample(['item_1028']);
    snapshot.source.selectedLevelValues.hp = 0;
    expect(assembleSimulation(snapshot, inputsFor(snapshot), { ...health, source: 120 }).compileRequest.combatants[0]!.attributes.hp)
      .toEqual({ base: 0, current: 120, max: 150, resolved: 150 });
    delete snapshot.source.selectedLevelValues.hp;
    expect(simulationHealthLimit(snapshot, 'source')).toBeUndefined();
    const inputs = inputsFor(snapshot);
    delete inputs.source.hp;
    expect(() => assembleSimulation(snapshot, inputs, { ...health, source: 120 })).toThrow(/attributeInputs.source.hp/);
    inputs.source.hp = 0;
    expect(simulationHealthLimit(snapshot, 'source', 0)).toBe(150);
    expect(assembleSimulation(snapshot, inputs, { ...health, source: 120 }).compileRequest.combatants[0]!.attributes.hp!.base).toBe(0);
  });

  it('装备攻击力所需baseline未录时要求显式补全，零baseline不回退为总值', () => {
    const snapshot = equipmentSimulationSample(['item_1036']);
    delete snapshot.source.selectedLevelValues.attack_damage;
    const inputs = inputsFor(snapshot);
    delete inputs.source.attack_damage;
    expect(() => assembleSimulation(snapshot, inputs, health)).toThrow(/attributeInputs.source.attack_damage/);
    inputs.source.attack_damage = 0;
    expect(assembleSimulation(snapshot, inputs, health).compileRequest.combatants[0]!.attributes.attack_damage)
      .toEqual({ base: 0, current: 10, max: 10, resolved: 10 });
  });

  it('收益系数目录缺失或停用只拦截装备攻速，不影响长剑与红水晶', () => {
    const snapshot = equipmentSimulationSample(['item_1042']);
    snapshot.catalogs.attributes = snapshot.catalogs.attributes.filter(row => row.attributeKey !== 'attack_speed_ratio');
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/attack_speed_ratio.*缺目录不能运行短剑/);
    const plain = equipmentSimulationSample(['item_1028', 'item_1036']);
    plain.catalogs.attributes = plain.catalogs.attributes.filter(row => row.attributeKey !== 'attack_speed_ratio');
    expect(assembleSimulation(plain, inputsFor(plain), health).compileRequest.rules.attributeDerivations).toBeUndefined();
    const disabled = equipmentSimulationSample(['item_1042']);
    disabled.catalogs.attributes.find(row => row.attributeKey === 'attack_speed_ratio')!.status = 'DISABLED';
    expect(() => inspectSimulationSnapshot(disabled)).toThrow(/attack_speed_ratio/);
  });

  it('收益系数必须小数目录且最小0，不接受伪造定义', () => {
    for (const valueType of ['INTEGER', 'DECIMAL'] as const) {
      const snapshot = equipmentSimulationSample(['item_1042']);
      const ratio = snapshot.catalogs.attributes.find(row => row.attributeKey === 'attack_speed_ratio')!;
      ratio.valueType = valueType;
      ratio.minValue = valueType === 'DECIMAL' ? null : 0;
      expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/小数类型且最小值为0/);
    }
  });

  it('缺失、零或非有限收益系数拒绝，目标侧需求不泄漏到攻击方', () => {
    const snapshot = equipmentSimulationSample([], ['item_1042']);
    const inputs = inputsFor(snapshot);
    expect(inspectSimulationSnapshot(snapshot).requirements.filter(row => row.attribute.attributeKey === 'attack_speed_ratio').map(row => row.side)).toEqual(['target']);
    expect(() => assembleSimulation(snapshot, inputs, health)).toThrow(/attributeInputs.target.attack_speed_ratio/);
    for (const value of [0, -1, Infinity, NaN]) {
      inputs.target.attack_speed_ratio = value;
      expect(() => assembleSimulation(snapshot, inputs, health)).toThrow(/attack_speed_ratio/);
    }
    inputs.target.attack_speed_ratio = 0.668;
    expect(assembleSimulation(snapshot, inputs, health).compileRequest.rules.attributeDerivations!.map(row => row.combatantKey)).toEqual(['target']);
  });

  it('最多每侧一条通用攻速派生，减去固有额外比例，不计算第二套攻击时钟', () => {
    const snapshot = equipmentSimulationSample(['item_1042'], ['item_1042']);
    const inputs = inputsFor(snapshot);
    inputs.source.attack_speed_ratio = 0.651;
    inputs.target.attack_speed_ratio = 0.668;
    const request = assembleSimulation(snapshot, inputs, health).compileRequest;
    expect(request.rules.attributeDerivations).toHaveLength(2);
    expect(request.rules.attributeDerivations![0]).toEqual({ combatantKey: 'source', attributeKey: 'attack_speed', value: {
      op: 'add', args: [{ op: 'read', path: 'source.attr.attack_speed.base' }, { op: 'mul', args: [
        { op: 'read', path: 'source.attr.attack_speed_ratio.resolved' }, { op: 'sub', args: [
          { op: 'read', path: 'source.attr.bonus_attack_speed_percent.resolved' }, { op: 'read', path: 'source.attr.bonus_attack_speed_percent.base' }
        ] }
      ] }]
    } });
    expect(request.combatants[0]!.attributes.bonus_attack_speed_percent!.base).toBe(0.2);
    expect(request.combatants[0]!.attributes.attack_speed!.resolved).toBe(0.651);
    expect(request.sharedProviders![0]!.processes![0]!.cooldown!.durationMs).toEqual({ op: 'ref', ref: 'selected/sample_basic_attack/levels/1/1/interval' });
    snapshot.source.selectedLevelValues.attack_speed = 0;
    expect(assembleSimulation(snapshot, inputs, health).compileRequest.combatants[0]!.attributes.attack_speed!.base).toBe(0);
  });

  it('被动关系必须有完整来源；无被动关系装备不按编号猜能力', () => {
    for (const skillStatus of ['ENABLED', 'DISABLED'] as const) {
      const snapshot = equipmentSimulationSample(['item_1036']);
      snapshot.source.selectedEquipment[0]!.attachedSkills.push({ gameId: 'lol', equipmentKey: 'item_1036', equipmentName: '样例长剑',
        skillKey: 'passive', skillName: '样例被动', skillStatus, sortOrder: 0 });
      expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/默认来源不能被过滤/);
    }
    expect(() => inspectSimulationSnapshot(equipmentSimulationSample(['item_3065']))).not.toThrow();
    const otherGame = equipmentSimulationSample(['item_1036']);
    otherGame.gameId = 'other';
    otherGame.source.selectedEquipment[0]!.equipment.gameId = 'other';
    expect(() => inspectSimulationSnapshot(otherGame)).toThrow(/配置集合只能包含默认来源及实际只读依赖|公式不属于当前游戏和技能/);
  });

  it('未知属性、非有限装备数值、属性范围及不完整所选集合明确失败', () => {
    const snapshot = equipmentSimulationSample(['item_1036']);
    snapshot.source.selectedEquipment[0]!.attributes.attributeValues.unknown = 1;
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/unknown/);
    delete snapshot.source.selectedEquipment[0]!.attributes.attributeValues.unknown;
    snapshot.source.selectedEquipment[0]!.attributes.attributeValues.attack_damage = Infinity;
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/attack_damage/);
    snapshot.source.selectedEquipment[0]!.attributes.attributeValues.attack_damage = 10;
    snapshot.catalogs.attributes.find(row => row.attributeKey === 'attack_damage')!.maxValue = 65;
    expect(() => assembleSimulation(snapshot, inputsFor(snapshot), health)).toThrow(/装备平加后的属性违反真实范围/);
    snapshot.source.selectedEquipment = [];
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/完整集/);
  });

  it('同方重复或超6件及缺少新必填数组拒绝，不接收旧选择协议', () => {
    const snapshot = equipmentSimulationSample(['item_1036']);
    snapshot.selection.sourceEquipmentKeys.push('item_1036');
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/selection.sourceEquipmentKeys/);
    snapshot.selection.sourceEquipmentKeys = Array.from({ length: 7 }, (_, index) => `item_${index}`);
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/selection.sourceEquipmentKeys/);
    delete (snapshot.selection as Partial<typeof snapshot.selection>).sourceEquipmentKeys;
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/selection.sourceEquipmentKeys/);
  });

  it('选择顺序与返回装备顺序不影响规则摘要，双方归属与装备变更改变摘要', async () => {
    const snapshot = equipmentSimulationSample(['item_1036', 'item_1028']);
    const first = await prepareSimulation(snapshot, inputsFor(snapshot), health);
    snapshot.source.selectedEquipment.reverse();
    snapshot.selection.sourceEquipmentKeys.reverse();
    snapshot.readAt = '2026-10-03T01:00:00Z';
    expect((await prepareSimulation(snapshot, inputsFor(snapshot), health)).compileRequest.rulesHash).toBe(first.compileRequest.rulesHash);
    const targetOnly = equipmentSimulationSample([], ['item_1036', 'item_1028']);
    expect((await prepareSimulation(targetOnly, inputsFor(targetOnly), health)).compileRequest.rulesHash).not.toBe(first.compileRequest.rulesHash);
    snapshot.source.selectedEquipment[0]!.attributes.attributeValues.attack_damage = 11;
    expect((await prepareSimulation(snapshot, inputsFor(snapshot), health)).compileRequest.rulesHash).not.toBe(first.compileRequest.rulesHash);
  });

  it('单次与连续按真实引用定位普攻，装备排在第0项仍完整保留双侧来源', async () => {
    const snapshot = equipmentSimulationSample(['item_1036'], ['item_1028']);
    const prepared = await prepareSimulation(snapshot, inputsFor(snapshot), health);
    prepared.compileRequest.sharedProviders!.reverse();
    prepared.compileRequest.combatants[0]!.providers.reverse();
    const single = singleAttackRequest(prepared.compileRequest, 'single');
    expect(single.skillUses![0]!.skillKey).toBe(snapshot.selection.basicAttackSkillKey);
    const continuous = await continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 2 });
    expect(continuous.runRequest.initialSnapshot.combatants.map(row => row.providers.length)).toEqual([2, 1]);
    expect(continuous.runRequest.driverPlan.entries).toEqual([]);
    expect(continuous.runRequest.driverPlan.basicAttack!.startAbilityRef).toBe(prepared.basicAttackBinding.startAbilityRef);
    prepared.compileRequest.combatants[1]!.providers[0]!.definitionRef = 'forged';
    await expect(continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 2 })).rejects.toThrow(/目标挂载/);
  });

  it('连续入口不开放夹带被动；派生有效攻速与上界由原生核对，不前端求值', async () => {
    const snapshot = equipmentSimulationSample(['item_1042']);
    const inputs = inputsFor(snapshot);
    inputs.source.attack_speed_ratio = 0.651;
    const prepared = await prepareSimulation(snapshot, inputs, health);
    const result = await continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 0.66 });
    expect(result.runRequest.driverPlan.basicAttack!.attackSpeedInputMax).toBe(0.66);
    expect(result.runRequest.initialSnapshot.combatants[0]!.attributes.attack_speed!.resolved).toBe(0.651);
    prepared.compileRequest.sharedProviders![1]!.abilities = [{ abilityKey: 'passive', kind: 'active' }];
    await expect(continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 2 })).rejects.toThrow(/不能夹带被动/);
  });
});

const assembleSimulation = (...args: Parameters<typeof raw_assembleSimulation>): ReturnType<typeof raw_assembleSimulation> => { approveSnapshotFixture(args[0]); return raw_assembleSimulation(...args); };
const inspectSimulationSnapshot = (...args: Parameters<typeof raw_inspectSimulationSnapshot>): ReturnType<typeof raw_inspectSimulationSnapshot> => { approveSnapshotFixture(args[0]); return raw_inspectSimulationSnapshot(...args); };
