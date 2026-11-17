import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeHook } from './coordination-runtime.mjs';

export async function runHook() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('钩子输入超过 1 MiB。');
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('钩子输入必须是 JSON 对象，原始内容不会输出或保存。'); }
  // 不读取 prompt、last_assistant_message、transcript_path 或任何工具载荷。
  const output = nativeHook(payload);
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHook().catch(error => { process.stderr.write(`协作钩子失败：${error.message}\n`); process.exitCode = 1; });
}
