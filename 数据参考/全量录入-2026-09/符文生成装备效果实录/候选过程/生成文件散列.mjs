import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifestName = '文件散列.json';
const sha256 = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const files = fs.readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name !== manifestName)
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, 'zh-CN'))
  .map((name) => ({ file: name, bytes: fs.statSync(path.join(directory, name)).size, sha256: sha256(path.join(directory, name)) }));
const candidate = files.find((row) => row.file === '完整候选.json');
const plan = files.find((row) => row.file === '写前请求计划.json');
const math = files.find((row) => row.file === '独立数学报告.json');
const migration = files.find((row) => row.file === '神奇之鞋迁移意图.json');
if (!candidate || !plan || !math || !migration) throw new Error('关键候选文件缺失，不能生成散列清单');
const manifest = {
  generatedAt: new Date().toISOString(),
  algorithm: 'SHA-256',
  encoding: 'UTF-8',
  byteBasis: '直接读取文件字节后计算，不按文本行或解析后对象计算',
  directory: '.agents/artifacts/rune-equipment-ownership-luna-candidate',
  files,
  keyArtifacts: {
    candidate: { file: candidate.file, bytes: candidate.bytes, sha256: candidate.sha256 },
    writePlan: { file: plan.file, bytes: plan.bytes, sha256: plan.sha256 },
    mathReport: { file: math.file, bytes: math.bytes, sha256: math.sha256 },
    migrationIntent: { file: migration.file, bytes: migration.bytes, sha256: migration.sha256 }
  },
  excludedSelf: manifestName,
  businessApiCalled: false,
  databaseCalled: false,
  browserUsed: false,
  gitUsed: false
};
fs.writeFileSync(path.join(directory, manifestName), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(manifest.keyArtifacts, null, 2));
