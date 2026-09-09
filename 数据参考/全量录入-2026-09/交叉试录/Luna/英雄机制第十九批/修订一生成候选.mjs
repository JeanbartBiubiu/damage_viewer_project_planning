import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readBytes = name => fs.readFileSync(path.join(here, name));
const readJson = name => JSON.parse(readBytes(name));
const writeJsonNew = (name, value) => {
  const target = path.join(here, name);
  if (fs.existsSync(target)) throw new Error(`${name}已存在，修订一禁止覆盖`);
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  return fs.readFileSync(target);
};

const originalName = '完整候选.json';
const originalBytes = readBytes(originalName);
const originalSha256 = sha256(originalBytes);
const expectedOriginalSha256 = 'cb3dbab26bc3fc5949d1fbc193ac28da71887f0e743c1ead4885a24fc7739824';
if (originalSha256 !== expectedOriginalSha256) throw new Error(`原候选散列变化：${originalSha256}`);

const candidate = JSON.parse(originalBytes);
const aatroxE = candidate.skills?.aatrox_e;
if (!aatroxE) throw new Error('候选缺少 aatrox_e');
const oldParameterKey = 'bonus_healing_ratio_per_unresolved_stat';
const newParameterKey = 'bonus_healing_ratio_per_bonus_health';
const parameter = aatroxE.write.parameters.find(item => item.parameterKey === oldParameterKey);
if (!parameter) throw new Error(`aatrox_e缺少${oldParameterKey}`);
if (aatroxE.write.parameters.some(item => item.parameterKey === newParameterKey)) throw new Error('修订一参数已存在');

const crossSourcePath = path.resolve(here, '..', '英雄机制第十七批', '根绑定与数值证据.json');
const crossSourceBytes = fs.readFileSync(crossSourcePath);
const crossSourceSha256 = sha256(crossSourceBytes);
const expectedCrossSourceSha256 = 'da3d627ae08acf0af922daae667574be76ea0c5bc14d7d5fb0be7eae929e0b7a';
if (crossSourceSha256 !== expectedCrossSourceSha256) throw new Error(`第十七批交叉来源散列变化：${crossSourceSha256}`);
const crossSource = JSON.parse(crossSourceBytes);
const vladimirW = crossSource.heroes?.find(hero => hero.id === 'Vladimir')?.spells?.find(spell => spell.skillKey === 'vladimir_w');
const crossCalculation = vladimirW?.object?.mSpell?.mSpellCalculations?.TotalDamage;
const crossPart = crossCalculation?.mFormulaParts?.find(part => part?.mDataValue === 'BonusHealthRatio');
if (!crossPart || crossPart.mStat !== 12 || crossPart.mStatFormula !== 2) {
  throw new Error('第十七批 Vladimir W TotalDamage 未证明 mStat=12、mStatFormula=2、BonusHealthRatio');
}

parameter.parameterKey = newParameterKey;
parameter.name = '每点额外生命值带来的治疗比例增量';
parameter.fixedValue = 0.00011;
parameter.description = '当前根 DataValues.EVampHPRatio 原值约0.011，TotalEVamp的mMultiplier为0.01；与第十七批Vladimir W的BonusHealthRatio同型mStat=12、mStatFormula=2交叉证明为来源额外生命值，因此每点来源额外生命值的治疗比例增量为0.011×0.01=0.00011。';

for (const proof of aatroxE.proofs) {
  if (proof.parameterKey === oldParameterKey) {
    proof.parameterKey = newParameterKey;
    proof.values = proof.raw.map(value => Math.round(Number(value) * 0.01 * 1000000) / 1000000);
    proof.scale = 0.01;
    proof.semantic = 'DataValues.EVampHPRatio原值按根树mMultiplier=0.01换算；与同型的第十七批Vladimir W BonusHealthRatio交叉证明mStat=12、mStatFormula=2对应SOURCE.hp.BONUS。';
  }
  if (proof.source === 'mSpellCalculations.TotalEVamp') {
    proof.semantic = '根树保留mMultiplier=0.01、ESpellVamp和mStat=12/mStatFormula=2的EVampHPRatio；第十七批Vladimir W TotalDamage以BonusHealthRatio同型节点交叉证明该统计项为来源额外生命值。完整比例为0.16+0.00011×SOURCE.hp.BONUS。';
    proof.crossEvidence = {
      batch: '英雄机制第十七批',
      skillKey: 'vladimir_w',
      sourceFile: '根绑定与数值证据.json',
      sourceFileSha256: crossSourceSha256,
      calculationKey: 'TotalDamage',
      raw: crossCalculation
    };
  }
}

aatroxE.write.formulas.push({
  formulaKey: 'total_healing_ratio',
  name: '暗影冲决完整治疗效果比例',
  expression: {
    nodeType: 'OPERATION',
    operation: 'ADD',
    operands: [
      { nodeType: 'PARAMETER', parameterKey: 'base_healing_ratio' },
      {
        nodeType: 'OPERATION',
        operation: 'MULTIPLY',
        operands: [
          { nodeType: 'PARAMETER', parameterKey: newParameterKey },
          { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'BONUS' }
        ]
      }
    ]
  },
  description: 'TotalEVamp = 0.01×(ESpellVamp + EVampHPRatio×来源额外生命值)；按正文百分比和同型来源树换算为0.16 + 0.00011×SOURCE.hp.BONUS。只保存完整比例公式，不创建治疗效果；来源额外生命值由运行时属性快照提供且没有默认值。',
  sortOrder: 10
});

aatroxE.pending = aatroxE.pending.filter(item => item.component !== '额外治疗统计项归属');
aatroxE.pending.push({
  kind: '配置',
  component: '来源额外生命值读取',
  reason: '完整治疗比例已按SOURCE.hp.BONUS落地；实际来源额外生命值快照、治疗资格和被动命中接线仍需运行时提供，不设置默认值。'
});
aatroxE.disposition = {
  范围外: aatroxE.excluded,
  来源待核: aatroxE.pending.filter(item => item.kind === '来源'),
  系统缺口: aatroxE.pending.filter(item => item.kind === '系统'),
  尚未接线: aatroxE.pending.filter(item => !['来源', '系统'].includes(item.kind))
};

candidate.meta.revision = {
  name: '修订一',
  basedOnCandidateSha256: expectedOriginalSha256,
  reason: '修正 Aatrox E 的EVampHPRatio与根mMultiplier 0.01，并依据第十七批Vladimir W同型节点映射SOURCE.hp.BONUS。',
  apiWrites: 0,
  originalPreserved: true
};
candidate.meta.apiWrites = 0;

const candidateBytes = writeJsonNew('修订一候选.json', candidate);
const counts = Object.fromEntries(['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'].map(kind => [kind, Object.values(candidate.skills).reduce((sum, skill) => sum + skill.write[kind].length, 0)]));
const version = {
  generatedAt: new Date().toISOString(),
  revision: '修订一',
  basedOnCandidateSha256: expectedOriginalSha256,
  fileSha256: sha256(candidateBytes),
  planSha256: sha256(Buffer.from(JSON.stringify(candidate))),
  skills: Object.keys(candidate.skills).length,
  order: Object.keys(candidate.skills),
  reusedParameters: 16,
  counts,
  newComponentIntents: counts.parameters - 16 + counts.formulas + counts.effects,
  apiWrites: 0,
  source: 'client16.17/official16.17.1'
};
const versionBytes = writeJsonNew('修订一候选版本.json', version);
console.log(JSON.stringify({
  candidateFileSha256: version.fileSha256,
  candidatePlanSha256: version.planSha256,
  versionFileSha256: sha256(versionBytes),
  counts,
  reusedParameters: version.reusedParameters,
  newComponentIntents: version.newComponentIntents,
  crossSourceSha256
}, null, 2));
