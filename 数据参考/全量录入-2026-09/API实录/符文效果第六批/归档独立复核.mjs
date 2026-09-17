import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const source = 'C:/project/damage_web_dev/.agents/artifacts/rune6-final-independent';
const target = path.join(here, '独立复核');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const files = ['独立复核.mjs', '独立来源绑定.json', '最终独立审查.md', '最终独立审查结论.json'];
fs.mkdirSync(target, { recursive: true });
const copies = [];
for (const name of files) {
  const input = fs.readFileSync(path.join(source, name));
  const output = path.join(target, name);
  if (fs.existsSync(output)) assert.deepEqual(fs.readFileSync(output), input, '已有归档异值，禁止覆盖');
  else fs.writeFileSync(output, input, { flag: 'wx' });
  assert.deepEqual(fs.readFileSync(output), input);
  copies.push({ name, bytes: input.length, sha256: sha(input) });
}
const report = JSON.parse(fs.readFileSync(path.join(target, '最终独立审查结论.json')));
const reportSha256 = copies.find(v => v.name === '最终独立审查结论.json').sha256;
assert.equal(report.status, 'READY');
assert.equal(reportSha256, '2ee88cfe8a329c06f05c2fb49634152c461d7880ec01db0383f9bd96e6b70d6e');
assert.equal(report.planSha256, sha(fs.readFileSync(path.join(here, '最终请求.json'))));
const gate = {
  at: new Date().toISOString(), verdict: 'READY',
  requestSha256: '424ae390c61108adc692de63e95926c847e72e855607176bc8703621491eda02',
  candidateSha256: report.candidateSha256,
  originalReport: '独立复核/最终独立审查结论.json', originalReportSha256: reportSha256,
  explanation: '显式将独立报告的 status/planSha256 转为执行工具要求的 verdict/requestSha256；原独立报告按字节保存，未修改字段。',
  archivedFiles: copies, businessWrites: 0
};
fs.writeFileSync(path.join(here, '最终独立结论.json'), JSON.stringify(gate, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ archived: copies.length, verdict: gate.verdict, requestSha256: gate.requestSha256, originalReportSha256: reportSha256 }));
