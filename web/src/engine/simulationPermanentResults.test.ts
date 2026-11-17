import { describe, expect, it } from 'vitest';
import { cappedPhysicalReductionSample } from '../../tests/fixtures/cappedPhysicalReduction';
import { permanentModifier } from './simulationPermanentResults';

function reduction(ratio = 0.1) {
  const input = cappedPhysicalReductionSample();
  delete input.result.detail.maximumReductionRatioValue;
  input.result.valueRule!.value = { kind: 'FIXED', value: ratio };
  const zone = input.snapshot.catalogs.modifierZones.find(row => row.modifierZoneKey === input.result.detail.modifierZoneKey)!;
  zone.calculationMode = 'RATIO_MULTIPLY';
  zone.applicationStage = 'DAMAGE_POST_DEFENSE';
  return { ...input, zone };
}

function lower(input: ReturnType<typeof reduction>) {
  return permanentModifier({ ...input, formulaNamespace: 'static-reduction' }, input.result, 'reduction');
}

describe('自身常驻的指定伤害类型减免', () => {
  it('承受方向在防御后按剩余比例相乘，不进入同组增伤', () => {
    expect(lower(reduction())).toMatchObject({ kind: 'pipeline', command: 'damage',
      stage: 'incoming_post_mitigation', valuePolicy: 'multiply', value: { op: 'const', value: 0.9 },
      condition: { op: 'read', path: 'damage.type.physics' } });
  });

  it.each([0, 1])('保留合法减免边界 %s', ratio => {
    expect(lower(reduction(ratio))).toMatchObject({ value: { op: 'const', value: 1 - ratio } });
  });

  it.each([-0.1, 1.1])('拒绝越界比例 %s', ratio => {
    const input = reduction(ratio);
    input.result.valueRule!.fixedMinValue = null;
    expect(() => lower(input)).toThrow('0到1');
  });

  it('不把防御前区域、未接入过滤或失效伤害类型解释为同一减免', () => {
    const before = reduction(); before.zone.applicationStage = 'DAMAGE_PRE_DEFENSE';
    expect(() => lower(before)).toThrow('防御后');
    const filter = reduction(); filter.result.detail.deliveryKind = 'SKILL';
    expect(() => lower(filter)).toThrow('过滤或条件');
    const disabled = reduction();
    disabled.snapshot.catalogs.damageTypes.find(row => row.type.damageTypeKey === 'physics')!.type.status = 'DISABLED';
    expect(() => lower(disabled)).toThrow('真实伤害类型');
  });
});
