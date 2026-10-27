#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PATHS, prepareReports, writeOrCheckReports, ReadinessError } from './readiness.mjs';

try {
  const { values } = parseArgs({ options: {
    'repo-root': { type: 'string', default: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..') },
    output: { type: 'string', default: PATHS.output },
    'proof-manifest': { type: 'string', default: PATHS.proof },
    check: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  }, allowPositionals: false, strict: true });
  if (values.help) {
    console.log('离线资料准备与只读对账（Node.js 20，无第三方依赖）\n'
      + 'node tools/data-readiness/cli.mjs [--repo-root <仓库根>] [--output output/<独立报告目录>]\n'
      + '  [--proof-manifest <相对仓库根的正式证明文件>] [--check]\n'
      + '生成不会覆盖不同产物；--check 重新校验全部引用原文、审核卡与已有报告，不写文件。\n'
      + '本工具不抓取网络、不连接数据库、不调用接口、不改账本和正式证明。');
  } else {
    const prepared = prepareReports({ repoRoot: values['repo-root'], proofManifest: values['proof-manifest'] });
    console.log(JSON.stringify({ ok: true, ...writeOrCheckReports(prepared, { output: values.output, check: values.check }) }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false,
    code: error instanceof ReadinessError ? error.code : error.code ?? 'READINESS_FAILED',
    message: error instanceof ReadinessError ? error.message : '命令参数或文件操作失败。',
    details: error instanceof ReadinessError ? error.details : {},
  }, null, 2));
  process.exitCode = 1;
}
