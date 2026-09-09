import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// 只生成不可覆盖的写入准备冻结清单；不访问接口，不发送业务请求。
const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = name => createHash('sha256').update(fs.readFileSync(path.join(here, name))).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const freezeName = '写入准备冻结.json';
if (fs.existsSync(path.join(here, freezeName))) throw Error('写入准备冻结.json已存在，拒绝覆盖');
const candidate = read('完整候选.json');
const version = read('候选版本.json');
const plan = read('写入请求计划.json');
const snapshot = read('写前现值.json');
const oldCandidate = '历史版本/冻结前-114907e0419ad5df34d0251a035493d57a736b0dd5901b3422eee4a5f62f528f/完整候选.json';
const intermediateCandidate = '历史版本/修订前-c031418bd72a457f38f71ad0ef0ad1516052099a9da74a5cb94defc5862b6193/完整候选.json';
const sourceNames = [
  '完整候选.json',
  '候选版本.json',
  '写入请求计划.json',
  '写前现值.json',
  '根绑定与数值证据.json',
  '补充文本证据.json',
  '来源冻结/来源与哈希汇总.json',
  '来源冻结/主技能数值展开.json',
  '来源冻结/主技能原始展开.json',
  '候选.mjs',
  '英雄组成.mjs',
  '生成候选.mjs',
  '独立数学核对.mjs',
  '独立数学核对.json',
  '生成写入计划.mjs',
];
const sourceHashes = Object.fromEntries(sourceNames.map(name => [name, sha256(name)]));
const freeze = {
  schemaVersion: 1,
  status: 'PREPARED_NOT_APPLIED',
  mode: '第二十四批最终候选写入准备冻结；等待根负责人另行授权--apply',
  gameId: 'lol',
  apiBase: 'http://127.0.0.1:8080/api/admin/games/lol',
  sourceVersion: 'client16.17/official16.17.1',
  candidateSha256: sha256('完整候选.json'),
  candidateVersionSha256: sha256('候选版本.json'),
  candidateInternalPlanSha256: version.planSha256,
  requestPlanSha256: sha256('写入请求计划.json'),
  snapshotSha256: sha256('写前现值.json'),
  sourceHashes,
  historicalCandidates: {
    previousFinal: { path: oldCandidate, sha256: sha256(oldCandidate) },
    priorIntermediate: { path: intermediateCandidate, sha256: sha256(intermediateCandidate) },
    originalMentionedByRoot: { sha256: 'cba4e4…', localFound: false, note: '在本工作树本批目录及制品目录未找到该散列原件；本次未覆盖或删除。' },
  },
  protection: {
    heroes: 4,
    subjects: 20,
    componentLists: 120,
    existingComponentDetails: 29,
    existingByKind: snapshot.summary?.countsByKind,
    protectedFields: '写前现值.json中的目录、20个技能主体、120个六类列表、29个现有参数列表行及详情逐字段保留；其它三类组成现值为空，出现计划外项即停止。',
    reuseParameters: plan.reuseParameters,
  },
  counts: {
    candidate: plan.candidateCounts,
    reusedParameters: 29,
    newByKind: plan.newCounts,
    plannedPostCount: plan.plannedPostCount,
    apiWritesAtFreeze: 0,
  },
  policy: plan.policy,
  frozenAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(here, freezeName), JSON.stringify(freeze, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ file: freezeName, sha256: sha256(freezeName), candidateSha256: freeze.candidateSha256, requestPlanSha256: freeze.requestPlanSha256, counts: freeze.counts, historicalCandidates: freeze.historicalCandidates }, null, 2));
