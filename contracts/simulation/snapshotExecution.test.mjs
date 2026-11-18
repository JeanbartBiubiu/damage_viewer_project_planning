import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotExecutionSkillKeys } from './snapshotExecution.mjs';

function fixture() {
  return { executionSkillKeys: ['reader'], skillConfigurations: ['producer', 'reader'].map(skillKey => ({
    skill: { skillKey, status: 'ENABLED' }
  })), source: { skillSources: ['producer', 'reader'].map(skillKey => ({ skillKey, skillStatus: 'ENABLED',
    skillLevel: 1, enabled: skillKey === 'reader', inactiveReason: skillKey === 'reader' ? null : 'SCENE_DISABLED' })) },
  target: { skillSources: [] } };
}

test('保留完整只读定义且不把它加入执行键，返回值不借用原数组', () => {
  const input = fixture(), result = snapshotExecutionSkillKeys(input);
  assert.deepEqual(result, ['reader']); result.push('producer');
  assert.deepEqual(input.executionSkillKeys, ['reader']);
});

test('空执行表合法，普通和预检响应均不能省略或猜测该表', () => {
  const input = fixture(); input.executionSkillKeys = [];
  assert.deepEqual(snapshotExecutionSkillKeys(input), []);
  for (const value of [undefined, null, {}, 'reader']) {
    const malformed = fixture(); malformed.executionSkillKeys = value;
    assert.throws(() => snapshotExecutionSkillKeys(malformed), /executionSkillKeys/);
  }
});

test('缺失定义、非法标识、重复和乱序均精确指向执行字段', () => {
  for (const keys of [['missing'], ['bad key'], ['reader', 'reader'], ['reader', 'producer']]) {
    const malformed = fixture(); malformed.executionSkillKeys = keys;
    assert.throws(() => snapshotExecutionSkillKeys(malformed), /executionSkillKeys\[/);
  }
});

test('关闭、零级、未计划和全局停用的来源不能冒充执行', () => {
  for (const patch of [{ enabled: false }, { skillLevel: 0 }, { skillStatus: 'DISABLED' },
    { inactiveReason: 'ACTIVE_DEFERRED' }, { inactiveReason: 'SCENE_DISABLED' }, { skillLevel: undefined }]) {
    const malformed = fixture(); Object.assign(malformed.source.skillSources[1], patch);
    assert.throws(() => snapshotExecutionSkillKeys(malformed), /真实来源/);
  }
});

test('按实际来源判断，另一方的合法实例可执行，无等级技能允许明确空等级', () => {
  const input = fixture(); input.source.skillSources[1].enabled = false;
  input.target.skillSources.push({ ...input.source.skillSources[1], enabled: true, skillLevel: null });
  assert.deepEqual(snapshotExecutionSkillKeys(input), ['reader']);
});

test('实际技能必须存在且启用，错误可以由调用方映射为自己的边界异常', () => {
  const input = fixture(); input.skillConfigurations[1].skill.status = 'DISABLED';
  assert.throws(() => snapshotExecutionSkillKeys(input, path => { throw new Error(`快照.${path}`); }), /快照.executionSkillKeys\[0\]/);
});
