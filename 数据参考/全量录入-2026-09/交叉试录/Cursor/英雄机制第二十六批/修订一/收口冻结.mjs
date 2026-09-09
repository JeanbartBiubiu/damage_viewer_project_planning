import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const batchDir = path.resolve(here, '..', '..', '..', '..', '数据参考', '全量录入-2026-09', '交叉试录', 'Cursor', '英雄机制第二十六批', '修订一');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const file = name => path.join(here, name);

const candidateSha256 = hash(file('完整候选.json'));
const planSha256 = hash(file('写前请求计划.json'));
const sourceValuesSha256 = hash(file('源值解析.json'));
const sourceManifestSha256 = hash(file('来源哈希汇总.json'));
const strictMathSha256 = hash(file('严格数学.json'));
const candidate = readJson(file('完整候选.json'));
const plan = readJson(file('写前请求计划.json'));
const version = readJson(file('候选版本.json'));
const lock = readJson(file('冻结候选锁.json'));
const index = readJson(file('候选交付索引.json'));
if (version.candidateSha256 !== candidateSha256 || plan.candidateSha256 !== candidateSha256 || lock.candidateSha256 !== candidateSha256) throw new Error('候选散列引用不一致');
if (version.requestPlanSha256 !== planSha256 || lock.requestPlanSha256 !== planSha256) throw new Error('请求计划散列引用不一致');
if (version.sourceValuesSha256 !== sourceValuesSha256 || lock.sourceValuesSha256 !== sourceValuesSha256) throw new Error('源值散列引用不一致');
if (version.sourceManifestSha256 !== sourceManifestSha256 || lock.sourceManifestSha256 !== sourceManifestSha256) throw new Error('来源散列引用不一致');
if (plan.requestCount !== 78 || candidate.counts.parameters !== 57 || candidate.counts.formulas !== 10 || candidate.counts.effects !== 11) throw new Error('候选计数不符合本批修订一冻结范围');
const strictMath = readJson(file('严格数学.json'));
if (!strictMath.passed || strictMath.candidateSha256 !== candidateSha256 || strictMath.counts.formulas !== 10 || strictMath.counts.formulaCases !== 20 || strictMath.counts.rejectionCases !== 10) throw new Error('严格数学未通过或引用不一致');

version.strictMathSha256 = strictMathSha256;
version.status = '修订一候选已冻结，严格数学通过，未调用业务接口';
version.noApiCalls = true;
lock.strictMathSha256 = strictMathSha256;
lock.status = '修订一候选已冻结，等待主负责人审查；未授权业务写入';
lock.noApiCalls = true;
index.strictMath = '严格数学.json';
index.strictMathSha256 = strictMathSha256;
index.finalStatus = '修订一候选已冻结，严格数学通过，未调用业务接口';
writeJson(file('候选版本.json'), version);
writeJson(file('冻结候选锁.json'), lock);
writeJson(file('候选交付索引.json'), index);

const range = {
  batch: '英雄机制第二十六批/修订一',
  status: '修订一候选已冻结，严格数学通过，未调用业务接口',
  sourceVersion: candidate.meta.sourceVersion,
  sourceIndexSha256: candidate.meta.sourceIndexSha256,
  sourcePolicy: candidate.meta.sourcePolicy,
  included: [
    '阿利斯塔：自身治疗、单一敌方魔法伤害、控制持续、践踏持续总量、满层参数和R减伤公式。',
    '布里茨：自身护盾、单一敌方魔法伤害、W独立攻击速度效果与结束后减速参数、E整次强化攻击公式、R被动/主动伤害公式和沉默持续。W移动速度只保留起始/最低比例与2500毫秒衰减窗口，不创建固定5000毫秒移动速度效果；E冷却按技能等级索引1至5和官方数组修正。',
    '明确的一次法力消耗组成、来源明确的冷却/施法/持续时间参数。',
  ],
  excludedOrPending: [
    '第三友军治疗、兵野专用规则、范围和位移几何、纯碰撞/视觉规则、匿名旧公式。',
    '伤害结果、直接治疗结果、瞬时求值、周期过程和自动触发。',
    '未证等级断点中间曲线、W移动速度中间衰减曲线与结束自动衔接、能力资源类型及当前/总值资格、命中/控制/净化/标记/护盾移除事件。',
    '阿利斯塔R减伤效果：当前乘区目录无可复用伤害减免乘区，本轮不新建乘区。',
  ],
  counts: { ...candidate.counts, requestCount: plan.requestCount, reusedPublicParameters: 13, protectedSubjects: 10, protectedCompositionLists: 60 },
  hashes: { candidateSha256, planSha256, sourceValuesSha256, sourceManifestSha256, strictMathSha256 },
  noApiCalls: true,
};
writeJson(file('来源与范围.json'), range);

const copyNames = [
  '完整候选.json', '写前请求计划.json', '源值解析.json', '来源哈希汇总.json', '严格数学.json',
  '候选版本.json', '冻结候选锁.json', '候选交付索引.json', '来源与范围.json',
  '生成候选.mjs', '独立源值数学.mjs', '收口冻结.mjs', '生成修订差异.mjs', '修订差异.json', '修订差异.md', 'README.md', '体验报告.md',
];
fs.mkdirSync(batchDir, { recursive: true });
for (const name of copyNames) fs.copyFileSync(file(name), path.join(batchDir, name));
const finalHashes = {
  generatedAt: new Date().toISOString(),
  status: '修订一候选已冻结，严格数学通过，未调用业务接口',
  batch: '英雄机制第二十六批/修订一',
  files: Object.fromEntries(copyNames.map(name => [name, hash(file(name))])),
  counts: range.counts,
  noApiCalls: true,
};
writeJson(file('最终哈希汇总.json'), finalHashes);
fs.copyFileSync(file('最终哈希汇总.json'), path.join(batchDir, '最终哈希汇总.json'));
console.log(JSON.stringify({ artifactDir: here, batchDir, hashes: range.hashes, counts: range.counts }, null, 2));
