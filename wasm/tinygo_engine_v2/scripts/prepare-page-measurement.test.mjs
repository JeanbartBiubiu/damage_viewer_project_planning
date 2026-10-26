import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createMeasurementSources, instrumentAttribute, instrumentFrameMethods, measurementSourceDigest, replaceRequired } from './prepare-page-measurement.mjs';

test('缺失或重复测量锚点拒绝产生零指标的假证据', () => {
  assert.throws(() => replaceRequired('other function', 'actual anchor', 'replacement'), /测量锚点/);
  assert.throws(() => replaceRequired('anchor anchor', 'anchor', 'replacement'), /测量锚点/);
});

test('当前属性实现的全部建页与两类目录复制都进入独立插桩', () => {
  const table = readFileSync(new URL('../internal/base/attribute/table.go', import.meta.url), 'utf8');
  const editor = readFileSync(new URL('../internal/base/attribute/editor.go', import.meta.url), 'utf8');
  const measured = instrumentAttribute(table, editor);
  assert(!measured.table.includes('&slotPage{}'));
  assert(!measured.editor.includes('&slotPage{}'));
  assert.equal(measured.table.match(/measureNewPage\(\)/g)?.length, 3);
  assert.equal(measured.editor.match(/measureNewPage\(\)/g)?.length, 1);
  assert.equal(measured.table.match(/measureDirectoryCopy\(/g)?.length, 2);
  assert.equal(measured.editor.match(/measureDirectoryCopy\(/g)?.length, 1);
  assert.equal(measured.editor.match(/measureEditorReuse\(/g)?.length, 1);
});

test('嵌套帧方法显式保存并恢复当前测量身份，不给生产源码增加导出', () => {
  const original = 'package execution\n\nfunc (f *executionFrame) commit() {\n child.commit()\n}\nfunc ordinary() {}\n';
  const measured = instrumentFrameMethods(original);
  assert.equal(measured.methods, 1);
  assert.match(measured.source, /MeasureEnterFrame\(f.frameID\)/);
  assert.match(measured.source, /defer attributeMeasurement.MeasureLeaveFrame\(previousMeasurementFrame\)/);
  assert.equal(original.includes('MeasureEnterFrame'), false);
});

test('仅计时副本不修改属性、角色或执行帧，也不导出逐帧计数', () => {
  const session = 'package runtime\nfunc run() {\n\tdone, runErr := RunGeneric(entry.compiled, req)\n output(done, runErr)\n}\n';
  const exports = 'package main\nimport "tinygo_engine_v2/internal/runtime"\n';
  const contents = new Map([
    ['internal/runtime/session.go', session], ['cmd/engine_wasm/main.go', exports],
    ['internal/runtime/execution/frame.go', 'package execution\nfunc (f *Frame) commit() {\n}\n'],
    ['internal/base/attribute/table.go', 'unchanged table'],
  ]);
  const { modified, frameMethods } = createMeasurementSources(contents, 'timing');
  assert.equal(frameMethods, 0);
  assert.deepEqual([...modified.keys()].sort(), ['cmd/engine_wasm/main.go', 'internal/runtime/page_measurement.go', 'internal/runtime/session.go']);
  assert.equal(contents.get('internal/runtime/session.go'), session);
  assert.match(modified.get('internal/runtime/session.go'), /measurementBegin\(\)\n done, runErr := RunGeneric\(entry.compiled, req\)\n measurementEnd\(\)\n output/);
  const boundary = modified.get('internal/runtime/page_measurement.go');
  assert(!boundary.includes('attribute'));
  assert(!boundary.includes('MeasureReset'));
  assert(boundary.indexOf('ReadMemStats(&measurementBefore)') < boundary.indexOf('measurementStart = time.Now()'));
  assert(boundary.indexOf('time.Since(measurementStart)') < boundary.indexOf('ReadMemStats(&measurementAfter)'));
  assert(!modified.get('cmd/engine_wasm/main.go').includes('engine_page_measure'));
  assert.match(modified.get('cmd/engine_wasm/main.go'), /engine_profile_memory/);
  assert.throws(() => createMeasurementSources(contents, 'unknown'), /测量模式/);
  assert.throws(() => createMeasurementSources(new Map([...contents, ['internal/runtime/session.go', session.replace('RunGeneric', 'changedRun')]]), 'timing'), /测量锚点/);
});

test('拆分前后的执行帧类型均可被计数，普通接线函数保持原字节', () => {
  for (const name of ['executionFrame', 'Frame']) {
    const source = `package execution\nfunc (f *${name}) commit() {\n}\nfunc ordinary() {}\n`;
    const result = instrumentFrameMethods(source);
    assert.equal(result.methods, 1);
    assert(result.source.endsWith('func ordinary() {}\n'));
  }
});

test('冻结清单只按实际生产与构建输入比较，节点脚本及排列不改变源码身份', () => {
  const a = { path: 'internal/a.go', sha256: 'a' }, b = { path: 'internal/b.go', sha256: 'b' };
  assert.equal(measurementSourceDigest([b, { path: 'scripts/bench-node.mjs', sha256: 'tool' }, a]).sourceDigest, measurementSourceDigest([a, b]).sourceDigest);
  assert.notEqual(measurementSourceDigest([a, b]).sourceDigest, measurementSourceDigest([a, { ...b, sha256: 'changed' }]).sourceDigest);
  assert.equal(measurementSourceDigest([a, { path: 'internal/b_test.go', sha256: 'test' }]).files.length, 1);
});

test('实际插桩属性包覆盖枚举提前退出与缓存页精确恢复，失败和相同值不伪报写入', () => {
  const module = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const target = resolve(module, 'target');
  mkdirSync(target, { recursive: true });
  const directory = mkdtempSync(resolve(target, 'page-sensor-test-'));
  const attributeDirectory = resolve(directory, 'internal/base/attribute');
  const modelDirectory = resolve(directory, 'internal/model');
  mkdirSync(attributeDirectory, { recursive: true });
  mkdirSync(modelDirectory, { recursive: true });
  writeFileSync(resolve(directory, 'go.mod'), readFileSync(resolve(module, 'go.mod')));
  for (const file of readdirSync(resolve(module, 'internal/model')).filter(name => name.endsWith('.go') && !name.endsWith('_test.go'))) {
    writeFileSync(resolve(modelDirectory, file), readFileSync(resolve(module, 'internal/model', file)));
  }
  const sources = instrumentAttribute(readFileSync(resolve(module, 'internal/base/attribute/table.go'), 'utf8'), readFileSync(resolve(module, 'internal/base/attribute/editor.go'), 'utf8'));
  writeFileSync(resolve(attributeDirectory, 'table.go'), sources.table);
  writeFileSync(resolve(attributeDirectory, 'editor.go'), sources.editor);
  writeFileSync(resolve(attributeDirectory, 'measurement.go'), sources.measurement);
  writeFileSync(resolve(attributeDirectory, 'measurement_test.go'), `package attribute
import (
 "testing"
 "tinygo_engine_v2/internal/model"
)
func testMeasurementTable() Table {
 base := FromMap(map[string]model.AttributeSlotDef{
  "a": {Base:10, Current:10, Max:100, Resolved:10},
  "b": {Base:10, Current:10, Max:100, Resolved:10},
  "c": {Base:10, Current:10, Max:100, Resolved:10},
 })
 base.MeasureSetOwner("source")
 return base
}
func startMeasurementFrame() { MeasureReset(); MeasureEnterFrame(1) }
func TestEnumerationOnlyReadsPresentVisitedSlots(t *testing.T) {
 base := testMeasurementTable().Without("b")
 startMeasurementFrame()
 visits := 0
 base.Range(func(_ string, _ model.AttributeSlotDef) bool { visits++; return false })
 if visits != 1 || MeasureCounter(1,9) != 1 || MeasureCounter(1,21) != 0 { t.Fatal("Range read unvisited or absent slots", visits, MeasureCounter(1,9), MeasureCounter(1,21)) }
 startMeasurementFrame()
 base.RangeIndex(func(_ int, _ model.AttributeSlotDef) bool { return true })
 if MeasureCounter(1,9) != 5 { t.Fatal("RangeIndex missed present slots or read absent b", MeasureCounter(1,9)) }
}
func TestLookupAndNoOpSetKeepReadAndWriteSetsDistinct(t *testing.T) {
 base := testMeasurementTable()
 slot := base.AtIndex(0)
 startMeasurementFrame()
 base.LookupIndex(-1); base.LookupIndex(100)
 editor := base.Edit()
 editor.LookupIndex(-1); editor.SetIndex(100,slot); editor.SetIndex(0,slot)
 if MeasureCounter(1,9) != 1 || MeasureCounter(1,21) != 0 || MeasureCounter(1,3) != 0 || MeasureCounter(0,30) != 0 { t.Fatal("invalid/no-op attempt became write or overflow", MeasureCounter(1,9), MeasureCounter(1,21), MeasureCounter(1,3), MeasureCounter(0,30)) }
 slot.Resolved++
 editor.SetIndex(0,slot)
 startMeasurementFrame()
 editor.LookupIndex(100)
 if MeasureCounter(1,9) != 0 { t.Fatal("work-page lookup read outside layout") }
}
func TestCachedPageOnlyPublishesActuallyChangedMaskedSlots(t *testing.T) {
 base := testMeasurementTable()
 a, c := base.AtIndex(0), base.AtIndex(2)
 a.Resolved, c.Resolved = 20, 30
 cached := base.WithIndex(0,a).WithIndex(2,c)
 startMeasurementFrame()
 editor := base.Edit()
 if !editor.ReuseResolvedPage(cached,0,7) { t.Fatal("valid cached page rejected") }
 if MeasureCounter(1,9) != 7 || MeasureCounter(1,21) != 5 || MeasureCounter(1,3) != 0 { t.Fatal("cached recovery did not use actual changed mask", MeasureCounter(1,9), MeasureCounter(1,21), MeasureCounter(1,3)) }
 startMeasurementFrame()
 equal := base.Edit()
 if !equal.ReuseResolvedPage(base,0,7) || MeasureCounter(1,21) != 0 || MeasureCounter(1,0) != 0 { t.Fatal("equal page reported writes") }
 bad := cached.AtIndex(1); bad.Current++
 invalid := cached.WithIndex(1,bad)
 startMeasurementFrame()
 rejected := base.Edit()
 if rejected.ReuseResolvedPage(invalid,0,7) || MeasureCounter(1,21) != 0 || MeasureCounter(1,0) != 0 { t.Fatal("failed recovery reported writes") }
 if MeasureCounter(1,9) != 3 { t.Fatal("failed recovery read beyond its early exit", MeasureCounter(1,9)) }
}
`);
  const result = spawnSync('go', ['-C', directory, 'test', '-count=1', './internal/base/attribute'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}\n诊断测试目录：${directory}`);
  // 只清理本测试刚创建的目录；失败时保留完整源码和输出以便复现。
  assert(resolve(directory).startsWith(target + sep));
  rmSync(directory, { recursive: true });
});
