import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('./', import.meta.url);
const baseCandidateName = '完整候选.json';
const baseLockName = '冻结候选锁.json';
const outputName = '修订一候选.json';
const expectedBaseSha256 = '7a09c5e2597c819aa38c7ac0901e047c2709cfcdb1be6310ebafe9ff926cc14a';
const read = name => fs.readFileSync(new URL(name, here));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseBytes = read(baseCandidateName);
const baseSha256 = sha(baseBytes);
if (baseSha256 !== expectedBaseSha256) throw Error(`旧冻结候选散列变化：${baseSha256}`);
const baseLock = JSON.parse(read(baseLockName));
if (baseLock.candidateFileSha256 !== expectedBaseSha256) throw Error('旧冻结锁未指向预期的原始候选。');
if (fs.existsSync(new URL(outputName, here))) throw Error('修订一候选已存在，不覆盖。');

const candidate = JSON.parse(JSON.stringify(JSON.parse(baseBytes)));
const changes = [];
const order = ['vladimir', 'swain', 'rumble', 'aurelionsol'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
if (JSON.stringify(Object.keys(candidate.skills)) !== JSON.stringify(order)) throw Error('旧候选不是固定20个技能位。');

const skill = key => {
  const value = candidate.skills[key];
  if (!value) throw Error(`缺少技能 ${key}`);
  value.write ??= { parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [] };
  value.excluded ??= [];
  value.pending ??= [];
  value.proofs ??= [];
  return value;
};
const find = (rows, key, label) => {
  const row = rows.find(item => (item.parameterKey ?? item.formulaKey ?? item.effectKey) === key);
  if (!row) throw Error(`缺少${label} ${key}`);
  return row;
};
const remove = (rows, key, label) => {
  const index = rows.findIndex(item => (item.parameterKey ?? item.formulaKey ?? item.effectKey) === key);
  if (index < 0) throw Error(`缺少待移除${label} ${key}`);
  const [row] = rows.splice(index, 1);
  return row;
};
const addExcluded = (key, component, reason) => {
  const s = skill(key);
  if (!s.excluded.some(item => item.component === component)) {
    s.excluded.push({ component, reason });
    changes.push({ path: `skills.${key}.excluded`, kind: 'excluded', old: null, new: { component, reason } });
  }
};
const addPending = (key, kind, component, reason) => {
  const s = skill(key);
  if (!s.pending.some(item => item.component === component)) {
    s.pending.push({ kind, component, reason });
    changes.push({ path: `skills.${key}.pending`, kind: 'pending', old: null, new: { kind, component, reason } });
  }
};
const markProof = (key, predicate, patch, changeLabel) => {
  const s = skill(key);
  const proof = s.proofs.find(predicate);
  if (!proof) throw Error(`缺少来源证据 ${key}/${changeLabel}`);
  const old = JSON.parse(JSON.stringify(proof));
  Object.assign(proof, patch);
  changes.push({ path: `skills.${key}.proofs[${changeLabel}]`, kind: 'proof', old, new: proof });
  return proof;
};

// 生命周期时长在接口中是 kind/parameterKey 结构；旧候选的四个兰博 W 效果误用了表达式树节点结构。
for (const key of order) {
  const s = skill(key);
  for (const effect of s.write.effects) {
    const duration = effect.lifecycle?.durationValue;
    if (!duration || !Object.hasOwn(duration, 'nodeType')) continue;
    if (duration.nodeType !== 'PARAMETER' || !duration.parameterKey) throw Error(`发现无法安全修正的生命周期时长 ${key}/${effect.effectKey}`);
    const old = JSON.parse(JSON.stringify(duration));
    effect.lifecycle.durationValue = { kind: 'PARAMETER', parameterKey: duration.parameterKey };
    changes.push({ path: `skills.${key}.write.effects.${effect.effectKey}.lifecycle.durationValue`, kind: 'shape', old, new: effect.lifecycle.durationValue });
  }
}

// 弗拉基米尔 W：正文的 TotalDamage/TotalHeal 是持续期间总量，不能写成每次命中或每个节拍量。
{
  const s = skill('vladimir_w');
  const base = find(s.write.parameters, 'base_damage', '参数');
  const vamp = find(s.write.parameters, 'vamp_ratio', '参数');
  const poolDamage = find(s.write.formulas, 'pool_damage', '公式');
  const poolHeal = find(s.write.formulas, 'pool_heal', '公式');
  const before = { baseName: base.name, vampName: vamp.name, damageName: poolDamage.name, damageDescription: poolDamage.description, healName: poolHeal.name, healDescription: poolHeal.description };
  base.name = '血池持续总伤害基础值';
  base.description = '客户端当前根绑定 DataValues.BaseDamage 取索引1至5；正文 TotalDamage 为血池持续期间总量，不表示每个节拍或每次命中量。';
  vamp.name = '血池持续总回复比例';
  vamp.description = '客户端当前根绑定 DataValues.VampPercent 取索引1至5；正文 TotalHeal 为血池持续期间回复总量，不推断每个节拍或每次命中分配。';
  poolDamage.name = '血池持续总魔法伤害量';
  poolDamage.description = 'TotalDamage = BaseDamage + BonusHealthRatio×来源额外生命值；正文 TotalDamage 为持续期间总魔法伤害量，不表示每个节拍或每次命中。';
  poolHeal.name = '血池持续总回复量';
  poolHeal.description = 'TotalHeal = VampPercent×TotalDamage；正文 TotalHeal 为持续期间回复总量，不推断每个节拍或每次命中分配，不创建瞬时治疗结果。';
  changes.push({ path: 'skills.vladimir_w', kind: 'rename-and-description', old: before, new: { baseName: base.name, vampName: vamp.name, damageName: poolDamage.name, damageDescription: poolDamage.description, healName: poolHeal.name, healDescription: poolHeal.description } });
  const pending = s.pending.find(item => item.component === '不可被选取、幽灵与持续节拍');
  if (!pending) throw Error('缺少 Vladimir W 持续节拍待补项。');
  const oldReason = pending.reason;
  pending.reason = '不可被选取属于1v1相关系统待接；纯碰撞幽灵效果、持续伤害和持续期间总回复量的事件分配需要状态、周期和命中事件。正文以TotalDamage/TotalHeal描述持续期间总量，未证明每个节拍或每次命中分配。本候选只保留持续时间、总量数学和资源代价。';
  changes.push({ path: 'skills.vladimir_w.pending[不可被选取、幽灵与持续节拍].reason', kind: 'description', old: oldReason, new: pending.reason });
}

// 范围外分支逐项进入技能自身 excluded，来源证据继续保留。
addExcluded('vladimir_q', '小兵强化治疗支路（empowered_minion_heal_ratio/MinionHealPercent）', '当前绑定扩展正文和 DataValues.MinionHealPercent 指向小兵强化治疗分支；本轮保留正常单一英雄收益，移出可写参数和公式。');
markProof('vladimir_q', proof => proof.source === 'DataValues.MinionHealPercent', { excluded: true, semantic: '小兵强化治疗支路属于本轮范围外；原始值留源，不生成专用参数或公式。', sourcePending: true }, 'DataValues.MinionHealPercent');

addExcluded('vladimir_w', '小兵治疗效能支路（MinionHealingMod）', 'DataValues.MinionHealingMod 是小兵治疗效能比例；本轮只保留正常单一英雄的持续总回复量。');

addExcluded('vladimir_r', '额外英雄命中回复比例（VampPercentAdditionalChamp）', '额外英雄命中回复属于本轮多目标分摊外支路；本轮只保留首个英雄回复数学。');
addExcluded('vladimir_r', '额外英雄命中回复计算树（SecondaryHealingTooltip）', 'SecondaryHealingTooltip 是额外英雄命中回复树；本轮留在来源证据，不生成多目标专用公式。');
markProof('vladimir_r', proof => proof.source === 'DataValues.VampPercentAdditionalChamp', { excluded: true }, 'DataValues.VampPercentAdditionalChamp');
markProof('vladimir_r', proof => proof.source === 'mSpellCalculations.SecondaryHealingTooltip', { excluded: true }, 'mSpellCalculations.SecondaryHealingTooltip');

// 斯维因 W：去掉纯显形时长和小兵伤害写入；三类来源仍保留并逐项标范围外。
{
  const s = skill('swain_w');
  const removed = remove(s.write.parameters, 'reveal_duration_ms', '参数');
  changes.push({ path: 'skills.swain_w.write.parameters.reveal_duration_ms', kind: 'removed', old: removed, new: null });
  const revealProof = markProof('swain_w', proof => proof.parameterKey === 'reveal_duration_ms', { excluded: true, semantic: '显形持续时间属于本轮纯视野支路；原始字段留源，不生成参数。' }, 'reveal_duration_ms');
  delete revealProof.parameterKey;
  changes.push({ path: 'skills.swain_w.proofs[DataValues.RevealDuration].parameterKey', kind: 'removed', old: 'reveal_duration_ms', new: null });
  addExcluded('swain_w', '显形持续时间参数（reveal_duration_ms/RevealDuration）', '显形持续时间属于本轮纯视野支路；移出可写参数，原始来源证据保留。');
  addExcluded('swain_w', '小兵伤害比例参数（MinionMod）', '小兵伤害属于本轮兵线专用外支路；本轮只保留正常单一英雄命中数学。');
  addExcluded('swain_w', '小兵伤害计算树（MinionDamage）', 'MinionDamage 是小兵专用计算树；本轮留在来源证据，不生成小兵公式。');
  addExcluded('swain_w', '纯显形视野半径（VisionRadius）', '纯显形视野属于本轮纯视觉/视野边界；不生成专用参数。');
  markProof('swain_w', proof => proof.source === 'DataValues.MinionMod', { excluded: true }, 'DataValues.MinionMod');
  markProof('swain_w', proof => proof.source === 'mSpellCalculations.MinionDamage', { excluded: true }, 'mSpellCalculations.MinionDamage');
  markProof('swain_w', proof => proof.source === 'DataValues.VisionRadius', { excluded: true }, 'DataValues.VisionRadius');
  const minionPending = s.pending.findIndex(item => item.component === '伤害结果：minion_damage');
  if (minionPending >= 0) {
    const [removedPending] = s.pending.splice(minionPending, 1);
    changes.push({ path: 'skills.swain_w.pending', kind: 'removed', old: removedPending, new: null });
  }
}

addExcluded('swain_r', '小兵/野怪治疗比例（MinionMonsterHealReduction）', '非英雄目标治疗比例属于本轮兵野治疗外支路；本轮只保留正常单一英雄回复数学。');
addExcluded('swain_r', '小兵/野怪治疗计算树（MinionMonsterHeal）', 'MinionMonsterHeal 是兵野治疗专用计算树；本轮留在来源证据，不生成兵野治疗公式。');
markProof('swain_r', proof => proof.source === 'DataValues.MinionMonsterHealReduction', { excluded: true }, 'DataValues.MinionMonsterHealReduction');
markProof('swain_r', proof => proof.source === 'mSpellCalculations.MinionMonsterHeal', { excluded: true }, 'mSpellCalculations.MinionMonsterHeal');

// 兰博 P：1v1 自我沉默/自动攻击属于系统待接；过热攻击拆成平伤与最大生命值组成。
{
  const s = skill('rumble_p');
  const oldExcluded = s.excluded.findIndex(item => item.component === '自我沉默和自动过热攻击');
  if (oldExcluded < 0) throw Error('缺少 Rumble P 旧范围项。');
  const [removedExcluded] = s.excluded.splice(oldExcluded, 1);
  changes.push({ path: 'skills.rumble_p.excluded', kind: 'moved-to-pending', old: removedExcluded, new: null });
  addPending('rumble_p', '系统', '自我沉默和自动过热攻击', '自我沉默和自动过热攻击属于1v1相关系统行为，需要热量状态、触发和普攻事件接入；本批只保留明确热量数值和过热攻击的独立平伤/最大生命值组成。');
  addExcluded('rumble_p', '野怪伤害上限（MonsterCap/MonsterCapScaling）', '过热攻击野怪伤害上限属于本轮野怪专用外支路；原始参数和计算树留在来源证据，不生成野怪专用组成。');
  const ratio = find(s.write.parameters, 'overheat_bonus_damage_ratio', '参数');
  const oldRatio = { name: ratio.name, description: ratio.description };
  ratio.name = '过热攻击最大生命值伤害比例';
  ratio.description = '正文明确过热攻击另有4%目标最大生命值伤害；客户端当前根绑定 DataValues.OverheatPercBonusDamage 取索引1至1。';
  changes.push({ path: 'skills.rumble_p.write.parameters.overheat_bonus_damage_ratio', kind: 'clarify', old: oldRatio, new: { name: ratio.name, description: ratio.description } });
  const base = find(s.write.parameters, 'overheat_attack_base_damage', '参数');
  const oldBase = { name: base.name, description: base.description };
  base.name = '过热攻击基础平伤输入（实际值外供）';
  base.description = '客户端只提供等级插值节点；用于 TotalBaseDamage 平伤组成，未知等级不猜线性。';
  changes.push({ path: 'skills.rumble_p.write.parameters.overheat_attack_base_damage', kind: 'clarify', old: oldBase, new: { name: base.name, description: base.description } });
  const target = {
    parameterKey: 'target_max_health_for_overheat_attack',
    name: '过热攻击目标最大生命值输入',
    valueType: 'DECIMAL',
    valueMode: 'RUNTIME_INPUT',
    fixedValue: null,
    levelValues: null,
    description: '正文4%最大生命值伤害所需的目标最大生命值外供输入；缺少运行时输入不得默认0。',
    sortOrder: 80
  };
  s.write.parameters.push(target);
  changes.push({ path: 'skills.rumble_p.write.parameters', kind: 'added', old: null, new: target });
  const oldFormula = remove(s.write.formulas, 'overheat_attack_damage', '公式');
  const flatFormula = { ...oldFormula, formulaKey: 'overheat_attack_flat_damage', name: '过热攻击平伤组成', description: 'TotalBaseDamage = 等级基础项 + 0.25×法强；这里仅表示平伤组成，正文另有4%目标最大生命值伤害，不创建DAMAGE结果。' };
  s.write.formulas.push(flatFormula);
  changes.push({ path: 'skills.rumble_p.write.formulas.overheat_attack_damage', kind: 'renamed', old: oldFormula, new: flatFormula });
  const maxHealthFormula = {
    formulaKey: 'overheat_attack_max_health_damage',
    name: '过热攻击最大生命值伤害组成',
    expression: {
      nodeType: 'OPERATION',
      operation: 'MULTIPLY',
      operands: [
        { nodeType: 'PARAMETER', parameterKey: 'overheat_bonus_damage_ratio' },
        { nodeType: 'PARAMETER', parameterKey: 'target_max_health_for_overheat_attack' }
      ]
    },
    description: 'OverheatPercBonusDamage×目标最大生命值；这是正文4%最大生命值伤害的独立组成，目标输入缺失不默认0，不创建DAMAGE结果。',
    sortOrder: 20
  };
  s.write.formulas.push(maxHealthFormula);
  changes.push({ path: 'skills.rumble_p.write.formulas', kind: 'added', old: null, new: maxHealthFormula });
  const oldResultPending = s.pending.findIndex(item => item.component === '伤害结果：overheat_attack_damage');
  if (oldResultPending < 0) throw Error('缺少 Rumble P 旧伤害结果待补项。');
  const [removedPending] = s.pending.splice(oldResultPending, 1);
  const flatPending = { kind: '来源', component: '伤害结果：overheat_attack_flat_damage', reason: '只保存过热攻击平伤组成；没有完整命中、护盾、暴击、吸血与结果资格证据，不创建DAMAGE或自动命中。' };
  const maxHealthPending = { kind: '来源', component: '伤害结果：overheat_attack_max_health_damage', reason: '只保存过热攻击最大生命值伤害组成；目标最大生命值由运行时输入提供且无默认，没有完整结果资格证据，不创建DAMAGE或自动命中。' };
  s.pending.push(flatPending, maxHealthPending);
  changes.push({ path: 'skills.rumble_p.pending', kind: 'replace', old: removedPending, new: [flatPending, maxHealthPending] });
  s.proofs.push({ parameterKey: 'target_max_health_for_overheat_attack', source: '运行输入.target_max_health_for_overheat_attack', values: null, sourcePending: true, semantic: '正文4%最大生命值伤害需要真实目标最大生命值；候选只声明无默认外供输入。' });
  changes.push({ path: 'skills.rumble_p.proofs', kind: 'added', old: null, new: s.proofs.at(-1) });
}

// 兰博 Q：去掉小兵专用分支；平伤与最大生命值比例拆开说明，燃烧时长归一化浮点噪声。
{
  const s = skill('rumble_q');
  const removedParam = remove(s.write.parameters, 'minion_damage_ratio', '参数');
  const removedFormula = remove(s.write.formulas, 'minion_damage', '公式');
  changes.push({ path: 'skills.rumble_q.write.parameters.minion_damage_ratio', kind: 'removed', old: removedParam, new: null });
  changes.push({ path: 'skills.rumble_q.write.formulas.minion_damage', kind: 'removed', old: removedFormula, new: null });
  const minionPendingIndex = s.pending.findIndex(item => item.component === '伤害结果：minion_damage');
  if (minionPendingIndex >= 0) {
    const [removedPending] = s.pending.splice(minionPendingIndex, 1);
    changes.push({ path: 'skills.rumble_q.pending', kind: 'removed', old: removedPending, new: null });
  }
  addExcluded('rumble_q', '小兵伤害比例参数（minion_damage_ratio/MinionMod）', '小兵伤害属于本轮兵线专用外支路；移出可写参数，原始来源证据保留。');
  addExcluded('rumble_q', '小兵伤害计算树（minion_damage）', 'MinionDamage 是小兵专用计算树；本轮不生成小兵公式。');
  addExcluded('rumble_q', '野怪伤害上限计算树（MonsterCap）', '野怪伤害上限属于本轮野怪专用外支路；本轮只保留单一英雄平伤和最大生命值比例组成。');
  markProof('rumble_q', proof => proof.parameterKey === 'minion_damage_ratio', { excluded: true, semantic: '小兵伤害比例属于本轮范围外兵线支路；原始值留源，不生成参数。' }, 'minion_damage_ratio');
  markProof('rumble_q', proof => proof.source === 'mSpellCalculations.MinionDamage', { excluded: true, semantic: '小兵伤害计算树属于本轮范围外兵线支路；原始树留源，不生成公式。' }, 'mSpellCalculations.MinionDamage');
  markProof('rumble_q', proof => proof.source === 'mSpellCalculations.MonsterCap', { excluded: true }, 'mSpellCalculations.MonsterCap');
  const flat = find(s.write.formulas, 'flat_damage', '公式');
  const empowered = find(s.write.formulas, 'empowered_damage', '公式');
  const empoweredRatio = find(s.write.formulas, 'empowered_health_damage_ratio', '公式');
  const oldFormulaText = { flatName: flat.name, flatDescription: flat.description, empoweredName: empowered.name, empoweredDescription: empowered.description, ratioName: empoweredRatio.name, ratioDescription: empoweredRatio.description };
  flat.name = '纵火盛宴平伤组成';
  flat.description = 'FlatDamage = BaseDamage + APRatio×法强；这是平伤组成，最大生命值伤害比例由 max_health_damage_ratio 另行表示，不是完整每秒或总伤害。';
  empowered.name = '危险温度纵火盛宴平伤组成';
  empowered.description = 'EmpoweredFlatDamage = OverheatMulti×FlatDamage；这是平伤组成，最大生命值伤害比例由 empowered_health_damage_ratio 另行表示；危险温度资格待接线。';
  empoweredRatio.name = '危险温度最大生命伤害比例组成';
  empoweredRatio.description = 'EmpoweredMaxHealthDamageRatio = OverheatMulti×HealthDamageRatio；仅表示最大生命值伤害比例，不含平伤，目标事件和伤害结果待接线。';
  changes.push({ path: 'skills.rumble_q.write.formulas', kind: 'clarify', old: oldFormulaText, new: { flatName: flat.name, flatDescription: flat.description, empoweredName: empowered.name, empoweredDescription: empowered.description, ratioName: empoweredRatio.name, ratioDescription: empoweredRatio.description } });
  const burn = find(s.write.parameters, 'burn_duration_ms', '参数');
  const oldBurn = JSON.parse(JSON.stringify(burn));
  burn.valueType = 'INTEGER';
  burn.fixedValue = 600;
  burn.description = '客户端当前根绑定 DataValues.BurnDuration 取索引1至5；0.6000000238秒换算后的600毫秒，已将浮点噪声归一化为600。';
  changes.push({ path: 'skills.rumble_q.write.parameters.burn_duration_ms', kind: 'normalized', old: oldBurn, new: burn });
  markProof('rumble_q', proof => proof.parameterKey === 'burn_duration_ms', { values: [600, 600, 600, 600, 600], normalizedFloatNoise: true, normalization: '浮点噪声归一化为600毫秒', semantic: '原始0.6000000238秒换算约600毫秒；候选规范为整数600毫秒，保留原始浮点值。' }, 'burn_duration_ms');
}

// 奥瑞利安·索尔 E：保留兵野死亡星尘进度，移出非英雄引力专用参数。
{
  const s = skill('aurelionsol_e');
  const removed = remove(s.write.parameters, 'non_champion_gravity', '参数');
  changes.push({ path: 'skills.aurelionsol_e.write.parameters.non_champion_gravity', kind: 'removed', old: removed, new: null });
  addExcluded('aurelionsol_e', '非英雄目标引力参数（non_champion_gravity/NonChampGravity）', '非英雄目标引力属于本轮兵野专用效果支路；原始值留源，不生成参数。小兵和野怪死亡带来的星尘进度仍按已有参数保留。');
  markProof('aurelionsol_e', proof => proof.parameterKey === 'non_champion_gravity', { excluded: true, semantic: '非英雄目标引力属于本轮范围外兵野支路；原始值留源，不生成参数。' }, 'non_champion_gravity');
  const pending = s.pending.find(item => item.component === '星尘吸收、引力、面积与处决');
  if (!pending) throw Error('缺少 AurelionSol E 引力待补项。');
  const oldReason = pending.reason;
  pending.reason = '英雄命中、单位死亡、引力、范围目标和处决资格尚未接线；非英雄目标引力属于本轮兵野专用外支路；含ResultModifier的面积树修饰语义未核，金币经验、纯视觉、多目标分摊和独立召唤不进入本候选。';
  changes.push({ path: 'skills.aurelionsol_e.pending[星尘吸收、引力、面积与处决].reason', kind: 'description', old: oldReason, new: pending.reason });
}

// 奥瑞利安·索尔 Q：保留单一英雄伤害，附近目标分摊和野怪上限逐项留在范围外证据。
addExcluded('aurelionsol_q', '附近额外目标伤害比例（AOEModifier）', '附近敌人范围伤害比例属于本轮多目标分摊外支路；本轮只保留单一英雄命中数学。');
addExcluded('aurelionsol_q', '野怪伤害上限（MonsterDamageCap）', '野怪百分比伤害上限属于本轮兵野专用外支路；本轮只保留单一英雄命中数学。');
markProof('aurelionsol_q', proof => proof.source === 'DataValues.AOEModifier', { excluded: true }, 'DataValues.AOEModifier');
markProof('aurelionsol_q', proof => proof.source === 'DataValues.MonsterDamageCap', { excluded: true }, 'DataValues.MonsterDamageCap');

// 奥瑞利安·索尔 W：伪施法时间只留原始来源待核，不生成重复内部参数。
{
  const s = skill('aurelionsol_w');
  const removed = remove(s.write.parameters, 'fake_cast_time_ms', '参数');
  changes.push({ path: 'skills.aurelionsol_w.write.parameters.fake_cast_time_ms', kind: 'removed', old: removed, new: null });
  const proof = markProof('aurelionsol_w', item => item.parameterKey === 'fake_cast_time_ms' && item.source === 'DataValues.FakeCastTime', { sourcePending: true, semantic: 'DataValues.FakeCastTime 原始值为375毫秒，但用途未证；本轮移除重复内部参数，只留来源待核。' }, 'DataValues.FakeCastTime');
  delete proof.parameterKey;
  changes.push({ path: 'skills.aurelionsol_w.proofs[DataValues.FakeCastTime].parameterKey', kind: 'removed', old: 'fake_cast_time_ms', new: null });
  addPending('aurelionsol_w', '来源', '伪施法时间用途（FakeCastTime）', '当前已有375毫秒原始字段，但用途未证；本轮不生成重复内部参数，保留来源待核。');
}

// 奥瑞利安·索尔 R：没有几何公式消费者时，星尘数量只留来源待补。
{
  const s = skill('aurelionsol_r');
  const removed = remove(s.write.parameters, 'stardust_count', '参数');
  changes.push({ path: 'skills.aurelionsol_r.write.parameters.stardust_count', kind: 'removed', old: removed, new: null });
  s.proofs.push({ source: '运行输入.stardust_count', raw: null, values: null, sourcePending: true, semantic: 'R星尘数量在当前候选没有几何公式消费者；只留来源待补，不生成运行参数。' });
  changes.push({ path: 'skills.aurelionsol_r.proofs', kind: 'added', old: null, new: s.proofs.at(-1) });
  addPending('aurelionsol_r', '来源', 'R星尘数量输入（stardust_count）', '当前候选已移除没有消费者的R星尘运行参数；原始星尘资格/升级来源留待后续核对。');
}

// 重新生成每个技能的处置视图，避免旧候选的范围数组和处置视图不一致。
for (const key of order) {
  const s = skill(key);
  s.disposition = {
    范围外: s.excluded,
    来源待核: s.pending.filter(item => item.kind === '来源'),
    系统缺口: s.pending.filter(item => item.kind === '系统'),
    尚未接线: s.pending.filter(item => !['来源', '系统'].includes(item.kind))
  };
  s.status = '修订一候选；未保存、未接线和范围外分支不表示完整战斗机制';
}

candidate.meta = {
  ...candidate.meta,
  generatedAt: new Date().toISOString(),
  apiWrites: 0,
  revision: {
    name: '修订一',
    baseCandidateSha256: baseSha256,
    reason: '按主负责人复核修正生命周期引用、范围外分支、总量口径、最大生命值组成、浮点噪声和无消费者运行参数；旧冻结原件保持不变。'
  },
  note: '修订一只派生新的候选、写前计划、独立核算和冻结锁；旧冻结候选与其哈希证据不覆盖。来源仍固定为客户端16.17、官方16.17.1和构建16.17.8104348。'
};
candidate.status = '修订一候选已生成，等待主负责人审查；没有业务接口写入';

const bytes = Buffer.from(JSON.stringify(candidate, null, 2) + '\n');
fs.writeFileSync(new URL(outputName, here), bytes);
const revisedSha256 = sha(bytes);
const counts = Object.fromEntries(['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'].map(kind => [kind, order.reduce((sum, key) => sum + candidate.skills[key].write[kind].length, 0)]));
const newCounts = { ...counts, parameters: counts.parameters - (candidate.meta.reuseReport?.publicParameters?.length ?? 0) };
const report = {
  generatedAt: candidate.meta.generatedAt,
  baseCandidateSha256: baseSha256,
  revisedCandidateSha256: revisedSha256,
  counts,
  newCounts,
  reusedPublicParameters: candidate.meta.reuseReport?.publicParameters?.length ?? 0,
  changes,
  apiWrites: 0
};
fs.writeFileSync(new URL('修订一候选生成报告.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ outputName, baseCandidateSha256: baseSha256, revisedCandidateSha256: revisedSha256, counts, newCounts, changes: changes.length, apiWrites: 0 }, null, 2));
