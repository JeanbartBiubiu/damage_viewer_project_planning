import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';

const artifactDir = dirname(fileURLToPath(import.meta.url));
const webRoot = 'C:/project/damage_web_dev';
const planningRoot = 'C:/project/damage_viewer_project_planning';
const proofPath = join(webRoot, '数据参考', '全量录入-2026-09', '交叉试录', '通用公式来源补证', '基础攻击力具名补证.json');
const proofExpectedSha256 = 'ac40d33aba90f99e4faebe3ab4a8ff8a0a8ca542b6a8e58d651479d3720e7d6f';
const results = [];
const issues = [];

const sha256 = value => createHash('sha256').update(value).digest('hex');
const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-7;
const check = (name, ok, detail, severity = '一般') => {
  const item = { name, ok: Boolean(ok), severity, detail };
  results.push(item);
  if (!ok) issues.push(item);
  return Boolean(ok);
};
const atPath = (object, sourcePath) => sourcePath.split('/').filter(Boolean).reduce((value, key) => value?.[key], object);
const fnv1a32 = value => {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(value, 'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const proofBytes = await readFile(proofPath);
const proof = JSON.parse(proofBytes);
check('补证文件散列固定', sha256(proofBytes) === proofExpectedSha256, { expected: proofExpectedSha256, actual: sha256(proofBytes) }, '阻塞');

const itemSource = proof.sources.find(item => item.file.endsWith('items-16.17.cdtb.bin.json.gz'));
const stringSource = proof.sources.find(item => item.file.endsWith('lol-16.17-zh_CN.stringtable.json.gz'));
const itemBytes = await readFile(itemSource.file);
const itemRaw = gunzipSync(itemBytes);
const items = JSON.parse(itemRaw);
const stringBytes = await readFile(stringSource.file);
const stringRaw = gunzipSync(stringBytes);
const stringTable = JSON.parse(stringRaw);
check('装备源压缩散列一致', sha256(itemBytes) === itemSource.compressedSha256, { expected: itemSource.compressedSha256, actual: sha256(itemBytes) });
check('装备源解压散列一致', sha256(itemRaw) === itemSource.rawSha256, { expected: itemSource.rawSha256, actual: sha256(itemRaw) });
check('中文字符串表压缩散列一致', sha256(stringBytes) === stringSource.compressedSha256, { expected: stringSource.compressedSha256, actual: sha256(stringBytes) });
check('中文字符串表解压散列一致', sha256(stringRaw) === stringSource.rawSha256, { expected: stringSource.rawSha256, actual: sha256(stringRaw) });

const directProofs = [];
for (const itemProof of proof.proofs.filter(item => [773025, 773078].includes(item.id))) {
  const rootPath = `Items/${itemProof.id}`;
  const actual = items[rootPath];
  const actualHash = actual ? sha256(Buffer.from(JSON.stringify(actual))) : null;
  const direct = {
    id: itemProof.id,
    rootPath,
    expectedRootObjectSha256: itemProof.rootObjectSha256,
    actualRootObjectSha256: actualHash,
    tooltipKey: itemProof.tooltipKey,
    tooltip: itemProof.tooltip,
    calculation: itemProof.calculation,
    coefficientParameter: itemProof.coefficientParameter,
    sourceObjectEqual: isDeepStrictEqual(itemProof.object, actual),
  };
  directProofs.push(direct);
  check(`根对象散列 ${itemProof.id}`, actualHash === itemProof.rootObjectSha256, direct);
  check(`补证完整根对象 ${itemProof.id}`, direct.sourceObjectEqual, { proofObject: itemProof.object, actualObject: actual });
  const tooltipValue = stringTable.entries?.[itemProof.tooltipKey.toLowerCase()];
  check(`中文绑定文本 ${itemProof.id}`, tooltipValue === itemProof.tooltip, { key: itemProof.tooltipKey.toLowerCase(), proof: itemProof.tooltip, actual: tooltipValue });
  const calc = actual?.mItemCalculations?.SpellbladeDamage?.mFormulaParts?.[0];
  check(`Spellblade计算节点 ${itemProof.id}`, isDeepStrictEqual(calc, itemProof.calculation.mFormulaParts[0]), { proof: itemProof.calculation.mFormulaParts[0], actual: calc });
  check(`基础攻击力文本 ${itemProof.id}`, /基础攻击力/.test(itemProof.tooltip), itemProof.tooltip);
}

const frozenById = new Map(directProofs.map(item => [item.id, item]));
const frozen3025 = frozenById.get(773025);
const frozen3078 = frozenById.get(773078);
const root3025 = items['Items/773025'];
const root3078 = items['Items/773078'];
const data3025 = root3025?.mDataValues?.find(item => item.mName?.toLowerCase() === 'spellblademultiplier'.toLowerCase());
const calc3025 = root3025?.mItemCalculations?.SpellbladeDamage?.mFormulaParts?.[0];
check('773025参数大小写仅为同名', data3025?.mName === 'SpellBladeMultiplier' && calc3025?.mDataValue === 'SpellbladeMultiplier' && data3025.mName.toLowerCase() === calc3025.mDataValue.toLowerCase(), { dataName: data3025?.mName, calculationName: calc3025?.mDataValue });
check('773025大小写折叠后的FNV1a一致', fnv1a32(data3025?.mName?.toLowerCase() ?? '') === fnv1a32(calc3025?.mDataValue?.toLowerCase() ?? ''), { data: fnv1a32(data3025?.mName?.toLowerCase() ?? ''), calculation: fnv1a32(calc3025?.mDataValue?.toLowerCase() ?? '') });
check('773025基础攻击力倍率和节点一致', near(data3025?.mValue, 1.25) && calc3025?.mStat === 2 && calc3025?.mStatFormula === 1 && calc3025?.__type === 'StatByNamedDataValueCalculationPart', { coefficient: data3025?.mValue, node: calc3025 });
const data3078 = root3078?.mDataValues?.find(item => item.mName === 'SpellbladeCooldown');
const calc3078 = root3078?.mItemCalculations?.SpellbladeDamage?.mFormulaParts?.[0];
check('773078固定系数和节点一致', calc3078?.mCoefficient === 2 && calc3078?.mStat === 2 && calc3078?.mStatFormula === 1 && calc3078?.__type === 'StatByCoefficientCalculationPart', { coefficient: calc3078?.mCoefficient, node: calc3078, unrelatedCooldown: data3078?.mValue });
check('两个根均明确基础攻击力文本', /基础攻击力/.test(frozen3025?.tooltip ?? '') && /基础攻击力/.test(frozen3078?.tooltip ?? ''), { 773025: frozen3025?.tooltip, 773078: frozen3078?.tooltip });
check('两个根计算节点均为2/1', calc3025?.mStat === 2 && calc3025?.mStatFormula === 1 && calc3078?.mStat === 2 && calc3078?.mStatFormula === 1, { 773025: calc3025, 773078: calc3078 });

const crossChecks = [];
for (const cross of proof.crossChecks ?? []) {
  const rootPath = `Items/${cross.id}`;
  const actual = items[rootPath];
  const actualHash = actual ? sha256(Buffer.from(JSON.stringify(actual))) : null;
  const nodeResults = [];
  for (const entry of cross.nodes ?? []) {
    const actualNode = atPath(actual, entry.path);
    const equal = isDeepStrictEqual(actualNode, entry.node);
    nodeResults.push({ path: entry.path, expected: entry.node, actual: actualNode, equal });
    check(`同构节点 ${cross.id}${entry.path}`, equal, { expected: entry.node, actual: actualNode });
  }
  const summary = { id: cross.id, rootObjectSha256: cross.rootObjectSha256, actualRootObjectSha256: actualHash, rootEqual: actualHash === cross.rootObjectSha256, nodes: nodeResults };
  crossChecks.push(summary);
  check(`同构根对象散列 ${cross.id}`, summary.rootEqual, summary);
  check(`同构节点为2/1 ${cross.id}`, nodeResults.length > 0 && nodeResults.every(entry => entry.actual?.mStat === 2 && entry.actual?.mStatFormula === 1), nodeResults);
}
check('七个同版本交叉根全部核对', crossChecks.length === 7 && crossChecks.every(item => item.rootEqual && item.nodes.every(node => node.equal)), crossChecks);

const conclusion = {
  mapping: {
    condition: '同构建、旧StatByCoefficient或StatByNamedDataValue节点、mStat=2、mStatFormula=1',
    attributeOwner: 'SOURCE',
    attributeKey: 'attack_damage',
    attributeValueKind: 'BASE',
  },
  basis: '773025和773078中文文本均明确基础攻击力，且原始根计算节点分别用1.25命名参数与2固定系数；另7个当前根同形核对通过。',
  limits: [
    '仅作来源与类型一致性推断，不录入这9件模式物品，也不复制其数值。',
    '不推广到mStat12/0、mStat29、AbilityResource或其他未核节点。',
    '本报告没有业务接口写入、客户端运行或战斗引擎验证。',
  ],
  businessWrites: 0,
};
const report = {
  generatedAt: new Date().toISOString(),
  proofPath,
  proofSha256: sha256(proofBytes),
  sources: proof.sources,
  directProofs,
  crossChecks,
  conclusion,
  checkCount: results.length,
  issueCount: issues.length,
  issues,
  results,
  pass: issues.length === 0,
};
await writeFile(join(artifactDir, '基础攻击力具名补证核对.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ pass: report.pass, checkCount: report.checkCount, issueCount: report.issueCount, crossCheckCount: crossChecks.length, output: join(artifactDir, '基础攻击力具名补证核对.json') }));
