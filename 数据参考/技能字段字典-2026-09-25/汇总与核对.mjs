import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(p, 'utf8');
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const inventory = JSON.parse(read(path.join(root, '物理字段清单.json')));
const order = ['00-范围与阅读说明.md', '01-物理表字段.md', '05-数值公式公共目录与引用.md', '02-效果与生命周期.md', '04-过程与内部状态.md', '03-事件条件与触发.md'];
const sections = order.map((name, index) => {
  let body = read(path.join(root, '分章', name)).replace(/\]\(<?C:\//g, x => x.includes('<') ? '](</C:/' : '](/C:/');
  body = body.replace('本节正式字段仅列当前完整生效的九项', '本节列出既有生命周期结构的九项字段');
  if (index > 0 && /^# /m.test(body)) body = body.replace(/^(#{1,5}) /gm, '$1# ');
  return { name, body };
});
let combined = sections.map(x => x.body.trim()).join('\n\n---\n\n') + '\n';
const headings = [...combined.matchAll(/^## (.+)$/gm)].map(m => m[1]);
const toc = ['## 目录', '', ...headings.map((title, i) => '- [' + title.replaceAll('`','') + '](#section-' + (i + 1) + ')'), '', '补充资料：[逐表数据库约束原文](/C:/project/damage_viewer_project_planning/数据参考/技能字段字典-2026-09-25/数据库约束原文.md)、[物理字段机器清单](/C:/project/damage_viewer_project_planning/数据参考/技能字段字典-2026-09-25/物理字段清单.json)、[来源与覆盖核对](/C:/project/damage_viewer_project_planning/数据参考/技能字段字典-2026-09-25/来源与覆盖核对.json)。', ''].join('\n');
let h = 0;
combined = combined.replace(/^## (.+)$/gm, (_, title) => '<a id="section-' + (++h) + '"></a>\n\n## ' + title);
combined = combined.replace(/^(# .+\n)/, '$1\n' + toc + '\n');

const constraintLines = ['# 数据库约束原文', '', '本附件按建表脚本逐表摘录，不是迁移脚本。字段含义和组合约束的中文解释见主字典；此处保留全部数据库检查、外键及索引，便于准确核对边界。', ''];
for (const t of inventory.tables) {
  constraintLines.push('## ' + t.name + ' — ' + t.title, '', '```sql', ...t.columns.filter(c => /PRIMARY KEY|CHECK|REFERENCES/.test(c.definition)).map(c => c.definition + ';'), ...t.constraints.map(c => c + ';'), ...t.alterConstraints, ...t.indexes, '```', '');
}
fs.writeFileSync(path.join(root, '数据库约束原文.md'), constraintLines.join('\n'));
fs.writeFileSync(path.join(root, '技能配置数据库字段字典.md'), combined);

const physical = sections.find(x => x.name.startsWith('01')).body;
const missingColumns = inventory.tables.flatMap(t => t.columns.filter(c => !physical.includes('`' + t.name + '.' + c.name + '`')).map(c => t.name + '.' + c.name));
assert.equal(missingColumns.length, 0);
assert.equal(inventory.columnCount, 219);
assert.equal(inventory.sha256, hash(read(inventory.source)));

const references = new Map();
for (const m of combined.matchAll(/\]\(<?\/?(C:\/[^)>]+)>?\)/g)) {
  const item = m[1].match(/^(.*?)(?::([0-9]+))?$/);
  const sourcePath = item[1], line = item[2] ? Number(item[2]) : null;
  if (sourcePath.startsWith(root.replaceAll('\\','/'))) continue;
  assert(fs.existsSync(sourcePath), 'Missing link: ' + sourcePath);
  const data = read(sourcePath), lines = data.split('\n').length;
  assert(line === null || line <= lines, 'Invalid line: ' + sourcePath + ':' + line);
  if (!references.has(sourcePath)) references.set(sourcePath, { path: sourcePath, sha256: hash(data), lineCount: lines, referencedLines: [] });
  if (line !== null && !references.get(sourcePath).referencedLines.includes(line)) references.get(sourcePath).referencedLines.push(line);
}
const modelRoot = 'C:/project/damage_backend_dev/server/data_manage/src/main/java/xyz/game/datamanage/model';
const modelDirs = ['skilleffect', 'skillprocess', 'skillinternalstate', 'skilltrigger', 'skillformula', 'skillparameter', 'value', 'attribute', 'gamevamp', 'modifierzone', 'status', 'rune', 'skill'];
const enumChecks = [];
for (const dir of modelDirs) {
  if (!fs.existsSync(path.join(modelRoot, dir))) continue;
  for (const name of fs.readdirSync(path.join(modelRoot, dir))) {
    if (!name.endsWith('.java')) continue;
    const sourcePath = path.join(modelRoot, dir, name);
    const data = read(sourcePath);
    const enumMatch = data.match(/public enum (\w+)\s*\{([\s\S]*?)(?:;|\})/);
    if (!enumMatch) continue;
    const normalizedPath = sourcePath.replaceAll('\\','/');
    if (!references.has(normalizedPath)) references.set(normalizedPath, { path: normalizedPath, sha256: hash(data), lineCount: data.split('\n').length, referencedLines: [], usage: '枚举名称覆盖核对' });
    const body = enumMatch[2].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const values = [...body.matchAll(/\b([A-Z][A-Z_0-9]+)\b/g)].map(m => m[1]);
    const unique = [...new Set(values)];
    enumChecks.push({ name: enumMatch[1], sourcePath: sourcePath.replaceAll('\\','/'), values: unique, missing: unique.filter(v => !combined.includes(v)) });
  }
}
const report = { observedAt: new Date().toISOString(), evidence: '静态代码快照；未访问实库、未测试接口或运行时。物理列及枚举名称核对是机械覆盖检查，不代替语义审查。', schema: { source: inventory.source, sha256: inventory.sha256, tableCount: inventory.tableCount, columnCount: inventory.columnCount, missingColumns }, chapters: sections.map(s => ({ file: s.name, sha256: hash(s.body) })), enumChecks, sources: [...references.values()].sort((a,b) => a.path.localeCompare(b.path)), artifact: { file: '技能配置数据库字段字典.md', sha256: hash(combined), bytes: Buffer.byteLength(combined) } };
fs.writeFileSync(path.join(root, '来源与覆盖核对.json'), JSON.stringify(report,null,2) + '\n');
console.log(JSON.stringify({ physicalColumns: inventory.columnCount, sourceFiles: references.size, enums: enumChecks.length, missingEnums: enumChecks.filter(e => e.missing.length), bytes: report.artifact.bytes },null,2));
