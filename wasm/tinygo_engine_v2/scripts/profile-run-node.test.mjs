import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCpuProfile } from './profile-run-node.mjs';

const node = (id, functionName, children = [], url = '') => ({ id, callFrame: { functionName, url }, children });

test('主循环采样只归因真正的叶节点，不混入初始化和宿主时间', () => {
  for (const name of ['(*tinygo_engine_v2/internal/scheduler.Loop).Run', 'tinygo_engine_v2/internal/scheduler.(*Loop).Run']) {
    const report = summarizeCpuProfile({
      startTime: 0, endTime: 1000,
      nodes: [node(1, '(root)', [2]), node(2, 'tinygo_engine_v2/internal/runtime.RunGeneric', [3, 5]), node(3, name, [4, 6]), node(4, 'tinygo_engine_v2/internal/runtime/execution.(*Engine).HandleLoopEvent'), node(5, 'tinygo_engine_v2/internal/runtime/execution.New'), node(6, 'hostCallback', [], 'host.js')],
      samples: [4, 5, 6], timeDeltas: [100, 200, 300],
    });
    assert.equal(report.samples.runLoopStack, 2);
    assert.equal(report.samples.goLeafSelf, 1);
    assert.equal(report.timeUs.runLoopStack, 400);
    assert.equal(report.timeUs.goLeafSelf, 100);
  }
});

test('缺少主循环符号时不扩大到整个运行入口', () => {
  const report = summarizeCpuProfile({ startTime: 0, endTime: 100, nodes: [node(1, 'tinygo_engine_v2/internal/runtime.RunGeneric', [2]), node(2, 'tinygo_engine_v2/internal/runtime/execution.New')], samples: [2], timeDeltas: [100] });
  assert.equal(report.samples.runLoopStack, 0);
  assert.equal(report.timeUs.runLoopStack, 0);
  assert.equal(report.warnings.length, 1);
});
