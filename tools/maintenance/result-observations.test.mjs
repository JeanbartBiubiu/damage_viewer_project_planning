import test from 'node:test';
import assert from 'node:assert/strict';
import { passiveProcessObservations } from './result-observations.mjs';

const compile = { sharedProviders: [{ processes: [{ entryKind: 'SKILL_HIT_PASSIVE' }] }] };
test('被动观测只选择原始实例并按真实身份和开始时刻稳定排序，不改写原数组', () => {
  const later = { owner: 'source', providerRef: 'p', processKey: 'wait', useKey: 'child2', startedAtMs: 600,
    passiveOrigin: { useKey: 'original2' } };
  const earlier = { ...later, useKey: 'child1', startedAtMs: 500, passiveOrigin: { useKey: 'original1' } };
  const active = { owner: 'source', providerRef: 'active', useKey: 'original1' };
  const done = { finalSnapshot: { processInstances: [later, active, earlier] } }, frozen = structuredClone(done);
  assert.deepEqual(passiveProcessObservations(compile, done), [earlier, later]);
  assert.deepEqual(done, frozen);
});
test('声明了被动过程却缺少过程快照时失败，不能以空数组冒充已观察到零个', () => {
  for (const processInstances of [undefined, null, {}]) {
    assert.throws(() => passiveProcessObservations(compile, { finalSnapshot: { processInstances } }), /缺少实际过程快照/);
  }
  assert.deepEqual(passiveProcessObservations(compile, { finalSnapshot: { processInstances: [] } }), []);
});
test('没有该变体的普通配置不产生被动观测，也不猜造过程状态', () => {
  assert.deepEqual(passiveProcessObservations({ sharedProviders: [{ processes: [{ processKey: 'normal' }] }] }, {}), []);
});
