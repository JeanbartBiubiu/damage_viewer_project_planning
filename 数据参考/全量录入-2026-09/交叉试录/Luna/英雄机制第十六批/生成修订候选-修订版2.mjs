import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const originalBytes = fs.readFileSync(new URL('完整候选-修订版.json', here));
const original = JSON.parse(originalBytes);
const candidate = structuredClone(original);
const baseSha256 = createHash('sha256').update(originalBytes).digest('hex');

function proofFor(skill, key) {
  return skill.proofs.find(value => value.parameterKey === key);
}
function excludeParameter(skill, key, reason) {
  skill.write.parameters = skill.write.parameters.filter(value => value.parameterKey !== key);
  const proof = proofFor(skill, key);
  if (proof) {
    delete proof.parameterKey;
    proof.excluded = true;
    proof.semantic = reason;
  }
  skill.excluded.push({ component: key, source: proof?.source ?? `候选参数:${key}`, reason });
}
function excludeFormula(skill, key, reason, source) {
  skill.write.formulas = skill.write.formulas.filter(value => value.formulaKey !== key);
  const proof = skill.proofs.find(value => value.source === source);
  if (proof) {
    proof.excluded = true;
    proof.semantic = reason;
  }
  skill.excluded.push({ component: `公式:${key}`, source: source ?? `候选公式:${key}`, reason });
}
function resetDisposition(skill) {
  skill.disposition = {
    范围外: skill.excluded,
    来源待核: skill.pending.filter(value => value.kind === '来源'),
    系统缺口: skill.pending.filter(value => value.kind === '系统'),
    尚未接线: skill.pending.filter(value => !['来源', '系统'].includes(value.kind))
  };
  skill.status = '修订版2组成候选；未保存、未接线和范围外分支不表示完整战斗机制';
}

// 艾尼维亚P只有完整蛋形态专用组成；完整蛋形态在本批范围外时不写其参数或反号显示公式。
{
  const skill = candidate.skills.anivia_p;
  const reasons = {
    egg_cooldown_ms: '完整蛋形态的重生冷却属于范围外；仅保留原始字段证据。',
    bonus_resists: '完整蛋形态额外双抗等级曲线属于范围外；未知等级算法不展开。',
    minus_one: '完整蛋形态双抗显示反号常量只服务范围外显示公式；不单独入库。',
    revive_survival_ms: '完整蛋形态复活等待属于范围外；仅保留官方文本证据。'
  };
  for (const key of Object.keys(reasons)) excludeParameter(skill, key, reasons[key]);
  excludeFormula(skill, 'bonus_resists_display', '完整蛋形态双抗反号显示公式只服务范围外形态；不影响普通形态或其他技能，本批不写入。', 'mSpellCalculations.BonusResistsTooltip');
  skill.excluded = skill.excluded.filter(value => value.component !== '完整蛋形态变形、复活、受击与目标选择');
  skill.excluded.push({
    component: '完整蛋形态、复活、额外双抗和反号显示',
    source: '当前中文绑定被动文本；DataValues.Cooldown；mSpellCalculations.BonusResists/BonusResistsTooltip',
    reason: '完整蛋形态及其专用参数、反号显示和受击复活过程按本批范围外处理；角色名称、根绑定和来源元信息仍保留。'
  });
  skill.pending = [];
  resetDisposition(skill);
}

// 卡尔萨斯P的死亡状态属于本批待接范围；只把事件放入系统缺口，不列为范围外。
{
  const skill = candidate.skills.karthus_p;
  skill.excluded = [];
  skill.pending = [{
    kind: '系统',
    component: '死亡状态下Q/W/E/R可施放与无消耗覆盖',
    reason: '正文证明阵亡后持续7秒可继续施放技能且无消耗；死亡触发、灵体状态、Q/W/E/R可施放资格、无消耗覆盖和窗口结束属于本批范围内的系统接线，Q/W/E/R正常技能主体和资源限制已分别保留，不新增假过程。'
  }];
  resetDisposition(skill);
}

candidate.meta.generatedAt = new Date().toISOString();
candidate.meta.apiWrites = 0;
candidate.meta.executor = '第十六批修订版2由Codex执行代理准备；仅修订候选与范围分类，未业务写入';
candidate.meta.scope = '修订版2：玛尔扎哈、艾尼维亚、丽桑卓、卡尔萨斯各P/Q/W/E/R共20个技能位。保留本技能可独立核验数值、混合技能自身收益、单一敌人==1分支、非英雄前置进度和资源依赖；独立虚灵、独立冰奴、纯冰墙和完整蛋形态专用组成按逐支路排除。卡尔萨斯P死亡后7秒继续施法和无消耗说明属于本批范围内系统待接，Q/W/E/R主体仍保留。';
candidate.meta.attributeBoundary = '法强和攻击力仅按当前同版本计算树的窄口径留候选；省略统计选择器的具名节点只有在同版本mStat0默认法强或2/2额外攻击力证据支持时才使用。丽桑卓R HealAmount的PercentMissingHPRatio按mStat0默认法强窄证进入基础治疗；SelfCastMissingHPRatio与SelfCastMissingHPPerAbove只记录正文提升参数，不绑定缺失生命输入、分段算法或hp。';
candidate.meta.revision = {
  baseCandidate: '完整候选-修订版.json',
  baseCandidateSha256: baseSha256,
  revisionNumber: 2,
  changes: [
    '艾尼维亚P完整蛋形态专用参数和双抗反号显示公式移到范围外证据，不影响普通形态或其他技能。',
    '卡尔萨斯P死亡后继续施法、7秒窗口和无消耗说明归入本批系统待接范围，清空范围外分类。'
  ],
  historicalCandidatePreserved: true,
  historicalCandidates: ['完整候选.json', '完整候选-修订版.json'],
  historicalLocks: ['冻结候选锁.json', '冻结候选锁-修订版.json']
};

const bytes = Buffer.from(JSON.stringify(candidate, null, 2) + '\n');
fs.writeFileSync(new URL('完整候选-修订版2.json', here), bytes);
const counts = Object.fromEntries(Object.keys(candidate.skills[Object.keys(candidate.skills)[0]].write).map(kind => [kind, Object.values(candidate.skills).reduce((sum, skill) => sum + skill.write[kind].length, 0)]));
const reused = Object.values(candidate.skills).flatMap(skill => skill.reusedParameters ?? []);
const report = {
  generatedAt: candidate.meta.generatedAt,
  fileSha256: createHash('sha256').update(bytes).digest('hex'),
  planSha256: createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),
  baseCandidateSha256: baseSha256,
  skills: Object.keys(candidate.skills).length,
  order: Object.keys(candidate.skills),
  reusedParameters: reused.length,
  counts,
  apiWrites: 0,
  historicalCandidatePreserved: true,
  source: 'client16.17/official16.17.1'
};
fs.writeFileSync(new URL('候选版本-修订版2.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
