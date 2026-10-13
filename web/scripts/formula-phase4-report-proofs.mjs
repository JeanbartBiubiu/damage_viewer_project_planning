import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// 将Playwright实际报告里的JSON附件落盘，保留用例、状态和请求证据。
const reportPaths = process.argv.slice(2);
assert.ok(reportPaths.length, '请传入实际Playwright JSON报告路径');
const clean = value => value.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 160);
const output = resolve('output/formula-phase4-affected-proofs');
mkdirSync(output, { recursive: true });
const summaries = [];
for (const reportPath of reportPaths) {
  const report = JSON.parse(readFileSync(resolve(reportPath), 'utf8'));
  const records = [];
  const visit = suite => {
    for (const nested of suite.suites ?? []) visit(nested);
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      const folder = resolve(output, clean(basename(reportPath, '.json')), clean(spec.title));
      mkdirSync(folder, { recursive: true });
      const artifacts = [];
      for (const [resultIndex, result] of (test.results ?? []).entries()) for (const [attachmentIndex, attachment] of (result.attachments ?? []).entries()) {
        if (attachment.contentType !== 'application/json') continue;
        const bytes = attachment.body ? Buffer.from(attachment.body, 'base64') : attachment.path ? readFileSync(attachment.path) : null;
        if (!bytes) continue;
        const data = JSON.parse(bytes.toString('utf8'));
        const file = resolve(folder, `${resultIndex}-${attachmentIndex}-${clean(attachment.name)}.json`);
        writeFileSync(file, JSON.stringify(data, null, 2));
        artifacts.push(file);
      }
      records.push({ title: spec.title, file: spec.file, status: test.status,
        resultStatuses: (test.results ?? []).map(result => result.status), artifacts });
    }
  };
  for (const suite of report.suites ?? []) visit(suite);
  const summary = { reportPath: resolve(reportPath), stats: report.stats, cases: records };
  const file = resolve(output, clean(basename(reportPath)));
  writeFileSync(file, JSON.stringify(summary, null, 2));
  summaries.push({ file, caseCount: records.length, stats: report.stats, artifacts: records.reduce((count, record) => count + record.artifacts.length, 0) });
}
console.log(JSON.stringify(summaries));
