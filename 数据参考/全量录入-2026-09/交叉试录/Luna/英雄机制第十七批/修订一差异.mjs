import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';

const here = new URL('./', import.meta.url);
const read = name => fs.readFileSync(new URL(name, here));
const json = name => JSON.parse(read(name));
const sha = name => createHash('sha256').update(read(name)).digest('hex');
const oldCandidateSha256 = '7a09c5e2597c819aa38c7ac0901e047c2709cfcdb1be6310ebafe9ff926cc14a';
const oldPlanSha256 = 'f468bb9ea7b6e093b87955e669728b8bb0e54ea5ccf62c8fe6b69a57299b78e2';
const oldReadOnlySha256 = 'ba50c2f11595df9c64d95345b4af156f9e468656b3bcdb8634558048bad8b62c';
const oldCandidate = json('完整候选.json');
const revisedCandidate = json('修订一候选.json');
if (sha('完整候选.json') !== oldCandidateSha256) throw Error('旧冻结候选散列变化。');
if (oldCandidate.meta?.apiWrites !== 0 || revisedCandidate.meta?.apiWrites !== 0) throw Error('候选存在业务写入标记。');
if (revisedCandidate.meta?.revision?.baseCandidateSha256 !== oldCandidateSha256) throw Error('修订基线错误。');
if (sha('只读保护与公共参数.json') !== oldReadOnlySha256) throw Error('只读保护散列变化。');
const oldPlan = json('写前计划.json');
const revisedPlan = json('修订一写前计划.json');
if (oldPlan.candidatePlanSha256 !== oldPlanSha256) throw Error('旧计划的候选计划散列变化。');
if (oldPlan.requestCount !== 267 || revisedPlan.requestCount !== 263) throw Error('旧新请求数不是267/263。');
const oldMath = json('独立源值与算例.json');
const revisedMath = json('修订一独立源值与算例.json');
if (oldMath.summary?.independentChecks?.failed !== 0 || revisedMath.summary?.independentChecks?.failed !== 0) throw Error('独立核算存在失败。');
const generation = json('修订一候选生成报告.json');

const order = ['vladimir', 'swain', 'rumble', 'aurelionsol'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const kinds = ['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'];
const counts = candidate => Object.fromEntries(kinds.map(kind => [kind, order.reduce((sum, key) => sum + candidate.skills[key].write[kind].length, 0)]));
const oldCounts = counts(oldCandidate);
const revisedCounts = counts(revisedCandidate);
const newCounts = { ...revisedCounts, parameters: revisedCounts.parameters - revisedPlan.reusedPublicParameters.length };
const get = (candidate, skillKey, kind, key) => candidate.skills[skillKey].write[kind].find(item => (item.parameterKey ?? item.formulaKey ?? item.effectKey) === key);
const has = (candidate, skillKey, kind, key) => Boolean(get(candidate, skillKey, kind, key));
const requireValue = (condition, message) => { if (!condition) throw Error(message); };
const excluded = (candidate, skillKey, text) => candidate.skills[skillKey].excluded.some(item => item.component.includes(text));

requireValue(equal(oldCounts, { parameters: 228, formulas: 47, effects: 14, processes: 0, internalStates: 0, triggerRules: 0 }), '旧计数不匹配。');
requireValue(equal(revisedCounts, { parameters: 224, formulas: 47, effects: 14, processes: 0, internalStates: 0, triggerRules: 0 }), '修订总计数不匹配。');
requireValue(equal(newCounts, { parameters: 202, formulas: 47, effects: 14, processes: 0, internalStates: 0, triggerRules: 0 }), '修订新增计数不匹配。');
requireValue(revisedPlan.reusedPublicParameters.length === 22, '修订复用公共参数数目不匹配。');
requireValue(revisedCandidate.skills.rumble_w.write.effects.every(effect => !effect.lifecycle?.durationValue || effect.lifecycle.durationValue.kind === 'PARAMETER'), '生命周期结构不匹配。');
for (const skillKey of order) {
  requireValue(revisedCandidate.skills[skillKey].write.processes.length === 0 && revisedCandidate.skills[skillKey].write.internalStates.length === 0 && revisedCandidate.skills[skillKey].write.triggerRules.length === 0, `出现禁止的组成 ${skillKey}`);
}
requireValue(!has(revisedCandidate, 'rumble_q', 'parameters', 'minion_damage_ratio') && !has(revisedCandidate, 'rumble_q', 'formulas', 'minion_damage'), 'Rumble Q 小兵分支仍在写入。');
requireValue(!has(revisedCandidate, 'swain_w', 'parameters', 'reveal_duration_ms'), 'Swain W 显形时长仍在写入。');
requireValue(!has(revisedCandidate, 'aurelionsol_e', 'parameters', 'non_champion_gravity'), '奥瑞利安·索尔 E 非英雄引力仍在写入。');
requireValue(!has(revisedCandidate, 'aurelionsol_w', 'parameters', 'fake_cast_time_ms') && !has(revisedCandidate, 'aurelionsol_r', 'parameters', 'stardust_count'), '无消费者参数仍在写入。');
requireValue(has(revisedCandidate, 'rumble_p', 'parameters', 'target_max_health_for_overheat_attack') && has(revisedCandidate, 'rumble_p', 'formulas', 'overheat_attack_flat_damage') && has(revisedCandidate, 'rumble_p', 'formulas', 'overheat_attack_max_health_damage'), '过热攻击拆分不完整。');
for (const [skillKey, text] of [
  ['vladimir_q', '小兵强化治疗'], ['vladimir_w', '小兵治疗'], ['vladimir_r', '额外英雄命中回复比例'],
  ['swain_w', '显形持续时间'], ['swain_w', '小兵伤害比例'], ['swain_r', '小兵/野怪治疗比例'],
  ['rumble_p', '野怪伤害上限'], ['rumble_q', '小兵伤害比例'], ['rumble_q', '野怪伤害上限'],
  ['aurelionsol_q', '附近额外目标'], ['aurelionsol_q', '野怪伤害上限'], ['aurelionsol_e', '非英雄目标引力']
]) requireValue(excluded(revisedCandidate, skillKey, text), `缺少范围外证据 ${skillKey}/${text}`);

// 生成器的变更记录来自实际旧/新对象；这里再按审核主题分组，便于逐项核对。
const groups = [
  { id: 'lifecycle', title: 'Rumble W 生命周期引用结构', match: change => change.path.includes('rumble_w') && change.path.includes('durationValue') },
  { id: 'vladimir_total', title: 'Vladimir W TotalDamage/TotalHeal 总量口径', match: change => change.path.includes('vladimir_w') },
  { id: 'scope', title: '范围外分支移出可写并逐项留据', match: change => change.kind === 'excluded' || change.kind === 'removed' && change.path.includes('write.') },
  { id: 'rumble_p', title: 'Rumble P 过热攻击平伤与最大生命值拆分', match: change => change.path.includes('rumble_p') },
  { id: 'rumble_q', title: 'Rumble Q 小兵分支移除、平伤口径和燃烧时长归一化', match: change => change.path.includes('rumble_q') },
  { id: 'aurelion', title: 'AurelionSol E/W/R 无消费者与兵野边界', match: change => change.path.includes('aurelionsol_') }
];
const assigned = new Set();
const groupedChanges = groups.map(group => {
  const selected = generation.changes.filter(change => {
    const matched = group.match(change);
    if (matched) assigned.add(change);
    return matched;
  });
  return { id: group.id, title: group.title, changes: selected };
});
const otherChanges = generation.changes.filter(change => !assigned.has(change));
if (otherChanges.length) groupedChanges.push({ id: 'other', title: '其它派生元数据或处置视图修订', changes: otherChanges });

const diff = {
  generatedAt: new Date().toISOString(),
  status: '修订一与旧冻结候选精确差异；旧冻结原件未覆盖，未执行业务写入',
  base: {
    candidateSha256: sha('完整候选.json'),
    candidatePlanSha256: oldPlan.candidatePlanSha256,
    candidateFileSha256: sha('完整候选.json'),
    planFileSha256: sha('写前计划.json'),
    mathFileSha256: sha('独立源值与算例.json'),
    requestCount: oldPlan.requestCount,
    counts: oldCounts
  },
  revised: {
    candidateSha256: sha('修订一候选.json'),
    candidatePlanSha256: revisedPlan.candidatePlanSha256,
    candidateFileSha256: sha('修订一候选.json'),
    planFileSha256: sha('修订一写前计划.json'),
    mathFileSha256: sha('修订一独立源值与算例.json'),
    requestCount: revisedPlan.requestCount,
    counts: revisedCounts,
    newCounts,
    reusedPublicParameters: revisedPlan.reusedPublicParameters.length
  },
  unchangedProtection: {
    readOnlySha256: sha('只读保护与公共参数.json'),
    source: 'client16.17/official16.17.1',
    sourceBuild: '16.17.8104348+branch.releases-16-17.content.release',
    businessWrites: 0,
    apiCalls: 0,
    oldFrozenFilesUntouched: true
  },
  preciseChanges: groupedChanges,
  generatorChangeCount: generation.changes.length,
  metadata: {
    oldStatus: oldCandidate.status,
    revisedStatus: revisedCandidate.status,
    revision: revisedCandidate.meta.revision,
    dispositionRebuiltFor: order
  }
};
fs.writeFileSync(new URL('修订一差异.json', here), JSON.stringify(diff, null, 2) + '\n');
const markdown = [
  '# 修订一差异',
  '',
  `旧冻结候选：\`${diff.base.candidateSha256}\`；修订一候选：\`${diff.revised.candidateSha256}\`。`,
  `旧候选总计 ${oldCounts.parameters} 参数、${oldCounts.formulas} 公式、${oldCounts.effects} 效果，新增请求 ${oldPlan.requestCount}；修订一总计 ${revisedCounts.parameters} 参数、${revisedCounts.formulas} 公式、${revisedCounts.effects} 效果，其中新增 ${newCounts.parameters} 参数、${newCounts.formulas} 公式、${newCounts.effects} 效果，复用 ${revisedPlan.reusedPublicParameters.length} 个公共参数，新增请求 ${revisedPlan.requestCount}。`,
  '',
  '修订内容按主题保存在《修订一差异.json》的 `preciseChanges`，每项带实际路径、旧值、新值和变更原因。主要处理：',
  '',
  '- 兰博 W 四个生命周期时长改为接口使用的 `kind:PARAMETER` 结构。',
  '- 弗拉基米尔 W 明确正文 `TotalDamage/TotalHeal` 是持续期间总量，不推断每个节拍或每次命中分配。',
  '- 兰博 P 过热攻击拆成平伤与 4% 目标最大生命值组成，目标生命值为无默认外供输入。',
  '- 兰博 Q、斯维因 W、奥瑞利安·索尔 E/W/R 移出本轮范围外或无消费者组成，并在各技能范围外证据中逐项保留；奥瑞利安·索尔 E 的兵野死亡星尘进度继续保留。',
  '- 兰博 Q 燃烧时长从浮点噪声归一化为整数 600 毫秒，并保留原始值与归一化标记。',
  '',
  '只读保护散列、来源版本和旧冻结文件保持不变；此修订仍是候选阶段，不是实录。',
  ''
].join('\n');
fs.writeFileSync(new URL('修订一差异.md', here), markdown);
console.log(JSON.stringify({
  oldCandidateSha256: diff.base.candidateSha256,
  revisedCandidateSha256: diff.revised.candidateSha256,
  oldPlanSha256: diff.base.candidatePlanSha256,
  revisedPlanSha256: diff.revised.candidatePlanSha256,
  oldMathFileSha256: diff.base.mathFileSha256,
  revisedMathFileSha256: diff.revised.mathFileSha256,
  oldRequestCount: diff.base.requestCount,
  revisedRequestCount: diff.revised.requestCount,
  oldCounts,
  revisedCounts,
  newCounts,
  generatorChangeCount: diff.generatorChangeCount,
  groups: groupedChanges.map(group => ({ id: group.id, changes: group.changes.length })),
  businessWrites: 0
}, null, 2));
