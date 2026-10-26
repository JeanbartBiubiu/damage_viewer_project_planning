// 仅在被忽略的独立源码副本中插桩；正式引擎不增加计数器、分配或导出。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');

export function isMeasurementSource(path) {
  return (path.endsWith('.go') && !path.endsWith('_test.go')) || path === 'go.mod' || path === 'go.sum' || path.startsWith('targets/') || ['scripts/build-wasm.ps1', 'scripts/build-wasm.sh'].includes(path);
}

export function measurementSourceDigest(rows) {
  const files = rows.filter(row => isMeasurementSource(row.path)).map(({ path, sha256 }) => ({ path, sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files, sourceDigest: hash(JSON.stringify(files)) };
}

export function replaceRequired(source, needle, replacement, count = 1) {
  const found = source.split(needle).length - 1;
  assert.equal(found, count, `测量锚点数量变化，拒绝生成不完整插桩：${needle.slice(0, 100)}`);
  return source.split(needle).join(replacement);
}

function insertImport(source, alias, path) {
  return source.replace(/^(package \w+)(\r?\n)/m, `$1\n\nimport ${alias} "${path}"\n`);
}

export function instrumentAttribute(table, editor) {
  table = replaceRequired(table, 'type tableData struct {', 'type tableData struct {\n measurementOwner string');
  table = replaceRequired(table, 'func newTableData(layout *Layout, length int) *tableData {', 'func newTableData(layout *Layout, length int) *tableData {\n measureDirectory()');
  table = replaceRequired(table, '\tpage, offset := t.data.pages[index/PageSize], index%PageSize', '\tmeasureRead(t.data, index)\n page, offset := t.data.pages[index/PageSize], index%PageSize');
  for (const visit of ['t.data.layout.Key(pageIndex*PageSize+offset)', 'pageIndex*PageSize+offset']) {
    table = replaceRequired(table,
      `\t\t\tif page.present&(1<<uint(offset)) != 0 && !visit(${visit}, page.slots[offset]) {\n\t\t\t\treturn\n\t\t\t}`,
      `\t\t\tif page.present&(1<<uint(offset)) != 0 {\n measureRead(t.data, pageIndex*PageSize+offset)\n if !visit(${visit}, page.slots[offset]) { return }\n }`);
  }
  table = replaceRequired(table, 'func (t Table) withIndex(layout *Layout, index int, slot model.AttributeSlotDef) Table {', 'func (t Table) withIndex(layout *Layout, index int, slot model.AttributeSlotDef) Table {\n measureWrite(t.data, index)');
  table = replaceRequired(table, '\tout := newTableData(layout, t.Len())', '\tout := newTableData(layout, t.Len())\n if t.data != nil { out.measurementOwner = t.data.measurementOwner }');
  table = replaceRequired(table, 'copy(out.pages, t.data.pages)', 'measureDirectoryCopy(len(t.data.pages))\n copy(out.pages, t.data.pages)', 2);
  table = replaceRequired(table, '\t*page = *old', '\tmeasurePageCopy()\n *page = *old', 2);
  table = replaceRequired(table, '\tout := newTableData(t.data.layout, t.data.length-1)', '\tmeasureWrite(t.data, index)\n out := newTableData(t.data.layout, t.data.length-1)\n out.measurementOwner = t.data.measurementOwner');
  const pageAllocations = table.split('&slotPage{}').length - 1;
  assert.equal(pageAllocations, 3, '属性表新建页锚点变化');
  table = table.replaceAll('&slotPage{}', 'measureNewPage()');

  editor = replaceRequired(editor, '\tpage, offset := work.pages[index/PageSize], index%PageSize', '\tmeasureRead(work, index)\n page, offset := work.pages[index/PageSize], index%PageSize');
  editor = replaceRequired(editor, '\tstate := e.prepareWork()\n\tpageIndex, offset := index/PageSize, index%PageSize', '\tmeasureWrite(e.measurementData(), index)\n state := e.prepareWork()\n pageIndex, offset := index/PageSize, index%PageSize');
  editor = replaceRequired(editor, '\t\t\t*page = *old', '\t\t\tmeasurePageCopy()\n *page = *old');
  editor = replaceRequired(editor, '\t\tstate.setPageOwned(pageIndex, true)\n\t}', '\t\tstate.setPageOwned(pageIndex, true)\n\t} else { measureEditorReuse() }');
  editor = replaceRequired(editor, 'copy(state.work.pages, base.data.pages)', 'state.work.measurementOwner = base.data.measurementOwner\n measureDirectoryCopy(len(base.data.pages))\n copy(state.work.pages, base.data.pages)');
  editor = replaceRequired(editor, '&slotPage{}', 'measureNewPage()');
  editor = replaceRequired(editor, '\tchanged := false\n\tfor offset := 0; offset < PageSize; offset++ {', '\tchanged := false\n var measurementChangedMask uint8\n for offset := 0; offset < PageSize; offset++ {');
  editor = replaceRequired(editor, '\t\tbefore, after := page.slots[offset], source.slots[offset]', '\t\tmeasureRead(current.data, pageIndex*PageSize+offset)\n measureRead(cached.data, pageIndex*PageSize+offset)\n before, after := page.slots[offset], source.slots[offset]');
  editor = replaceRequired(editor, '\t\tif mask&bit != 0 {', '\t\tif mask&bit != 0 {\n if math.Float64bits(before.Resolved) != math.Float64bits(after.Resolved) { measurementChangedMask |= bit }');
  editor = replaceRequired(editor, '\tstate.work.pages[pageIndex] = source', '\tfor measurementOffset := 0; measurementOffset < PageSize; measurementOffset++ {\n if measurementChangedMask&(1<<uint(measurementOffset)) != 0 { measureWrite(current.data, pageIndex*PageSize+measurementOffset) }\n }\n state.work.pages[pageIndex] = source');
  return { table, editor, measurement: attributeMeasurement };
}

export function instrumentFrameMethods(source) {
  let methods = 0;
  source = source.replace(/(^func \((\w+) \*(?:executionFrame|Frame)\) [^{}]*\{\r?\n)/gm, (signature, _, receiver) => {
    methods++;
    return `${signature} previousMeasurementFrame := attributeMeasurement.MeasureEnterFrame(${receiver}.frameID)\n defer attributeMeasurement.MeasureLeaveFrame(previousMeasurementFrame)\n`;
  });
  if (methods) source = insertImport(source, 'attributeMeasurement', 'tinygo_engine_v2/internal/base/attribute');
  return { source, methods };
}

const attributeMeasurement = `package attribute

// 本文件仅存在于独立测量副本。固定数组防止逐帧记录自身引入容器分配。
type measurementFrame struct {
  counters [5]uint64
  reads [3][4]uint64
  writes [3][4]uint64
}
var measurementFrames [4096]measurementFrame
var measurementActive uint64
var measurementMaxFrame uint64
var measurementOverflow uint64
var measurementLayouts [3]*Layout

func MeasureReset() {
  for i := uint64(0); i <= measurementMaxFrame && i < uint64(len(measurementFrames)); i++ { measurementFrames[i] = measurementFrame{} }
  measurementActive, measurementMaxFrame, measurementOverflow = 0, 0, 0
  measurementLayouts = [3]*Layout{}
}
func MeasureEnterFrame(id uint64) uint64 {
  previous := measurementActive
  if id >= uint64(len(measurementFrames)) { measurementOverflow++; measurementActive = 0; return previous }
  measurementActive = id
  if id > measurementMaxFrame { measurementMaxFrame = id }
  return previous
}
func MeasureLeaveFrame(previous uint64) { measurementActive = previous }
func measureFrame() *measurementFrame { return &measurementFrames[measurementActive] }
func measureDirectory() { measureFrame().counters[0]++ }
func measureDirectoryCopy(count int) { measureFrame().counters[1] += uint64(count) }
func measureNewPage() *slotPage { measureFrame().counters[2]++; return &slotPage{} }
func measurePageCopy() { measureFrame().counters[3]++ }
func measureEditorReuse() { measureFrame().counters[4]++ }
func measurementOwner(data *tableData) int {
  if data != nil { if data.measurementOwner == "source" { return 1 }; if data.measurementOwner == "target" { return 2 } }
  return 0
}
func (t Table) MeasureSetOwner(key string) {
  if t.data != nil { t.data.measurementOwner = key; measurementLayouts[measurementOwner(t.data)] = t.data.layout }
}
func MeasureLayoutKey(owner, index uint32) uint64 {
  if owner >= uint32(len(measurementLayouts)) { return 0 }
  layout := measurementLayouts[owner]
  if layout == nil { return 0 }
  if index == 0 { return uint64(layout.Len()) }
  key := layout.Key(int(index)-1)
  if key == "" { return 0 }
  value := uint64(14695981039346656037)
  for i := 0; i < len(key); i++ { value ^= uint64(key[i]); value *= 1099511628211 }
  return value
}
func measurementRememberLayout(data *tableData) {
  if data != nil { measurementLayouts[measurementOwner(data)] = data.layout }
}
func (e Editor) measurementData() *tableData {
  if e.state == nil { return e.base.data }
  if e.state.work != nil { return e.state.work }
  return e.state.base.data
}
func measureRead(data *tableData, index int) {
  measurementRememberLayout(data)
  if index < 0 { return }
  if index >= 256 { measurementOverflow++; return }
  measureFrame().reads[measurementOwner(data)][index/64] |= uint64(1) << uint(index%64)
}
func measureWrite(data *tableData, index int) {
  measurementRememberLayout(data)
  if index < 0 { return }
  if index >= 256 { measurementOverflow++; return }
  measureFrame().writes[measurementOwner(data)][index/64] |= uint64(1) << uint(index%64)
}
func MeasureCounter(frame, index uint32) uint64 {
  if index == 29 { return measurementMaxFrame }
  if index == 30 { return measurementOverflow }
  if frame >= uint32(len(measurementFrames)) { return 0 }
  row := &measurementFrames[frame]
  if index < 5 { return row.counters[index] }
  if index < 17 { offset := index-5; return row.reads[offset/4][offset%4] }
  if index < 29 { offset := index-17; return row.writes[offset/4][offset%4] }
  return 0
}
`;

function runtimeMeasurement(mode) {
  return `package runtime

import (
  goruntime "runtime"
  "time"
  ${mode === 'pages' ? '"tinygo_engine_v2/internal/base/attribute"' : ''}
)
var measurementBefore, measurementAfter, measurementMemory goruntime.MemStats
var measurementCoreNs uint64
var measurementStart time.Time
func measurementBegin() {
  ${mode === 'pages' ? 'attribute.MeasureReset()' : ''}
  goruntime.ReadMemStats(&measurementBefore)
  measurementStart = time.Now()
}
func measurementEnd() {
  measurementCoreNs = uint64(time.Since(measurementStart).Nanoseconds())
  goruntime.ReadMemStats(&measurementAfter)
}
func MeasurementCore(index uint32) uint64 {
  switch index {
  case 0: return measurementAfter.Mallocs-measurementBefore.Mallocs
  case 1: return measurementAfter.TotalAlloc-measurementBefore.TotalAlloc
  case 2: return measurementBefore.HeapAlloc
  case 3: return measurementAfter.HeapAlloc
  case 4: return measurementAfter.Frees-measurementBefore.Frees
  case 5: return measurementAfter.HeapSys
  case 6: return measurementCoreNs
  }
  return 0
}
func MeasurementMemory(index uint32) uint64 {
  if index == 0 { goruntime.ReadMemStats(&measurementMemory) }
  switch index {
  case 0: return measurementMemory.TotalAlloc
  case 1: return measurementMemory.Mallocs
  case 2: return measurementMemory.HeapAlloc
  case 3: return measurementMemory.HeapSys
  case 4: return measurementMemory.Frees
  }
  return 0
}
`;
}

function sourceFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['target', 'dist', 'build', 'output', 'node_modules', '.git'].includes(entry.name)) return [];
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return sourceFiles(resolve(directory, entry.name), path);
    if (!entry.isFile()) return [];
    return isMeasurementSource(path) ? [path] : [];
  });
}

export function createMeasurementSources(contents, mode) {
  assert(['pages', 'timing'].includes(mode), '测量模式只支持 pages 或 timing');
  const modified = new Map();
  let frameMethods = 0;
  if (mode === 'pages') {
    const tablePath = 'internal/base/attribute/table.go';
    const editorPath = 'internal/base/attribute/editor.go';
    const result = instrumentAttribute(contents.get(tablePath).toString(), contents.get(editorPath).toString());
    modified.set(tablePath, result.table);
    modified.set(editorPath, result.editor);
    const actorPath = 'internal/runtime/actor/state.go';
    modified.set(actorPath, replaceRequired(contents.get(actorPath).toString(), '\treturn State{key: key, attributes: attributes,', '\tattributes.MeasureSetOwner(key)\n return State{key: key, attributes: attributes,'));
    for (const [path, content] of contents) {
      if (!path.startsWith('internal/runtime/') || !path.endsWith('.go')) continue;
      const framed = instrumentFrameMethods(content.toString());
      frameMethods += framed.methods;
      if (framed.methods) modified.set(path, framed.source);
    }
    assert(frameMethods > 20, '没有找到实际执行帧，拒绝以零帧指标代替测量');
    modified.set('internal/base/attribute/measurement.go', attributeMeasurement);
  }
  const sessionPath = 'internal/runtime/session.go';
  modified.set(sessionPath, replaceRequired(contents.get(sessionPath).toString(), '\tdone, runErr := RunGeneric(entry.compiled, req)', '\tmeasurementBegin()\n done, runErr := RunGeneric(entry.compiled, req)\n measurementEnd()'));
  const exportsPath = 'cmd/engine_wasm/main.go';
  let exports = contents.get(exportsPath).toString();
  if (mode === 'pages') {
    exports = insertImport(exports, 'attributeMeasurement', 'tinygo_engine_v2/internal/base/attribute');
    exports += `
//export engine_page_measure
func engine_page_measure(frame, index uint32) uint64 { return attributeMeasurement.MeasureCounter(frame, index) }
//export engine_page_layout_key
func engine_page_layout_key(owner, index uint32) uint64 { return attributeMeasurement.MeasureLayoutKey(owner, index) }
`;
  }
  exports += `
//export engine_profile_memory
func engine_profile_memory(index uint32) uint64 { return runtime.MeasurementCore(index) }
//export engine_memory_read
func engine_memory_read(index uint32) uint64 { return runtime.MeasurementMemory(index) }
`;
  modified.set(exportsPath, exports);
  modified.set('internal/runtime/page_measurement.go', runtimeMeasurement(mode));
  return { modified, frameMethods };
}

export function prepareMeasurement(stage, { mode = 'pages', source = moduleRoot } = {}) {
  assert.match(stage ?? '', /^[a-z][a-z0-9_-]{0,63}$/, '需要唯一的本次测量名称');
  const sourceRoot = resolve(source);
  assert(existsSync(resolve(sourceRoot, 'go.mod')), '测量来源必须是明确的引擎模块目录');
  const output = resolve(moduleRoot, 'target/page-measurements', stage);
  assert(!existsSync(output), '测量目录已存在，拒绝覆盖已有证据');
  const files = sourceFiles(sourceRoot).sort();
  const contents = new Map(files.map(path => [path, readFileSync(resolve(sourceRoot, path))]));
  const { modified, frameMethods } = createMeasurementSources(contents, mode);
  mkdirSync(output, { recursive: true });
  for (const [path, content] of new Map([...contents, ...modified])) {
    const destination = resolve(output, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  const manifest = {
    instrumentation: mode === 'pages' ? 'attribute-pages-v3' : 'run-only-timing-v1', mode, sourceRoot,
    instrumentationSha256: hash(readFileSync(fileURLToPath(import.meta.url))), frameMethods, formalTiming: false,
    note: mode === 'pages'
      ? '页与槽计数副本；耗时及分配包含逐帧插桩，不用于判断正式产物收益'
      : '仅在RunGeneric边界读取时钟及内存统计；不含JSON编解码和宿主往返，仍须独立验证正式产物及浏览器Worker',
    files: files.map(path => ({ path, sha256: hash(contents.get(path)) })),
    modifiedFiles: [...modified].map(([path, content]) => ({ path, sha256: hash(content) })),
  };
  manifest.sourceDigest = hash(JSON.stringify(manifest.files));
  writeFileSync(resolve(output, 'measurement-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { output, sourceDigest: manifest.sourceDigest, frameMethods, mode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [stage, ...options] = process.argv.slice(2);
  const parsed = {};
  assert.equal(options.length % 2, 0, '选项需要名称和值');
  for (let index = 0; index < options.length; index += 2) {
    const key = options[index].slice(2);
    assert(options[index].startsWith('--') && ['mode', 'source'].includes(key) && !(key in parsed), '用法：node scripts/prepare-page-measurement.mjs <唯一测量名称> [--mode pages|timing] [--source <冻结模块>]');
    parsed[key] = options[index + 1];
  }
  console.log(JSON.stringify(prepareMeasurement(stage, parsed), null, 2));
}
