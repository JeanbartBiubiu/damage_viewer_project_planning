import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const base = 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const json = p => JSON.parse(fs.readFileSync(p));
const candidateFiles = ['符文效果第一批/候选与边界.json', '符文效果第二批/可审查请求.json', '符文效果第三批/可审查候选.json', '符文效果第四批/可审查候选.json', '符文效果第五批/可审查候选.json'];
const candidates = candidateFiles.map(file => { const bytes = fs.readFileSync(path.join(base, 'API实录', file)); return { file, sha256: sha(bytes), object: JSON.parse(bytes) }; });
const staticMatches = [];
function scan(v, p, file) {
  if (!v || typeof v !== 'object') return;
  if (v.parameterKey && v.valueMode && /max.*(stack|count|hit)|maximum_legend_stacks|maximum_stacks/i.test(v.parameterKey)) staticMatches.push({ file, path: p, parameter: v });
  for (const [k, child] of Object.entries(v)) if (child && typeof child === 'object') scan(child, `${p}/${k}`, file);
}
for (const c of candidates) scan(c.object, '', c.file);
const sourceFiles = [];
function gz(relative) { const p = path.join(base, relative), bytes = fs.readFileSync(p), raw = zlib.gunzipSync(bytes); sourceFiles.push({ file: relative, compressedSha256: sha(bytes), rawSha256: sha(raw) }); return JSON.parse(raw); }
const perks = gz('API实录/符文客户端数值补证/perks-16.17.cdtb.bin.json.gz');
const texts = gz('装备效果补证/客户端原始资料/lol-16.17-zh_CN.stringtable.json.gz').entries;
const officialFile = '装备符文/官方原始资料/runesReforged-16.17.1-zh_CN.json';
const official = json(path.join(base, officialFile)).flatMap(p => p.slots.flatMap(s => s.runes));
sourceFiles.push({ file: officialFile, sha256: sha(fs.readFileSync(path.join(base, officialFile))) });
const ids = [9103, 9104, 8010, 8008, 8226];
const selected = ids.map(id => {
  const [sourcePath, raw] = Object.entries(perks).find(([, v]) => v?.mPerkId === id);
  const bindings = Object.fromEntries(['mDisplayNameLocalizationKey', 'mLongDescLocalizationKey', 'mTooltipNameLocalizationKey'].map(k => [k, { sourceKey: raw[k], text: texts[raw[k].toLowerCase()] }]));
  return { id, skillKey: `rune_${id}_passive`, sourcePath, sourceObjectSha256: sha(Buffer.from(JSON.stringify(raw))), raw, bindings, official: official.find(v => v.id === id) };
});
fs.writeFileSync(path.join(here, '来源与静态筛选.json'), JSON.stringify({ at: new Date().toISOString(), versions: { client: '16.17', official: '16.17.1' }, sourceFiles, candidateFiles: candidates.map(({ object, ...x }) => x), staticMatches, selected, boundary: '指定9103/9104/8010；额外仅8008及8226。9923重置额外次数仅登记本地筛选，不扩为第六个实值对象。' }, null, 2) + '\n', { flag: 'wx' });
const auth = process.env.RUNE_CAP_API_TOKEN; assert.ok(auth, '缺只读环境认证');
const report = { at: new Date().toISOString(), selected: ids, reads: [], skills: [], businessWrites: 0 };
const save = () => fs.writeFileSync(path.join(here, '实际五项回读.json'), JSON.stringify(report, null, 2) + '\n');
async function get(route) {
  const res = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, { headers: { Authorization: 'Bearer ' + auth }, signal: AbortSignal.timeout(30000) });
  const data = await res.json(); report.reads.push({ at: new Date().toISOString(), method: 'GET', route, status: res.status, data }); save(); assert.equal(res.status, 200, route); return data;
}
const groups = [['parameters', 'parameterKey'], ['formulas', 'formulaKey'], ['effects', 'effectKey'], ['processes', 'processKey'], ['internal-states', 'stateKey'], ['trigger-rules', 'ruleKey']];
try {
  for (const id of ids) {
    const key = `rune_${id}_passive`, skill = { id, key, body: await get(`/skills/${key}`), collections: {}, details: {} };
    for (const [kind, stableKey] of groups) {
      skill.collections[kind] = await get(`/skills/${key}/${kind}`); assert.ok(Array.isArray(skill.collections[kind])); skill.details[kind] = [];
      for (const row of skill.collections[kind]) skill.details[kind].push(await get(`/skills/${key}/${kind}/${row[stableKey]}`));
    }
    report.skills.push(skill); save();
  }
  report.summary = { passed: true, actualGET: report.reads.length, skills: report.skills.length, businessWrites: 0, allStatus200: report.reads.every(v => v.status === 200) }; save();
  console.log(JSON.stringify({ ...report.summary, counts: report.skills.map(s => ({ id: s.id, counts: Object.fromEntries(Object.entries(s.details).map(([k, v]) => [k, v.length])) })) }));
} catch (e) { report.failure = { name: e.name, message: e.message }; save(); console.error(JSON.stringify(report.failure)); process.exitCode = 1; }
