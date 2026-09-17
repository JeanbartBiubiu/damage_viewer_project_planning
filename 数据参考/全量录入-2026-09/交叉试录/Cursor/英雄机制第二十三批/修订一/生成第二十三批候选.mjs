import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const repo = 'C:/project/damage_web_dev';
const inputDir = path.join(repo, '.agents/artifacts/hero23-cursor-entry-20260909');
const artifactDir = path.join(repo, '.agents/artifacts/hero23-root-recovery/修订一');
const planningDir = path.join(repo, '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二十三批/修订一');
const protectedPlanningDir = path.join(repo, '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二十三批');
const jsonIndent = 2;
const generatedAt = new Date().toISOString();

const inputVersionPath = path.join(inputDir, '输入版本.json');
const inputHashPath = path.join(inputDir, '冻结输入散列.json');
const bindingPath = path.join(inputDir, '来源绑定与当前文本.json');
const inputSnapshotPath = path.join(inputDir, '参考资料/当前10槽保护快照.json');
const reusePath = path.join(inputDir, '参考资料/公共参数复用清单.json');
const attributeBoundaryPath = path.join(inputDir, '参考资料/属性默认与边界.json');
const payloadSamplePath = path.join(inputDir, '参考资料/接口载荷样例.json');

const readBytes = file => fs.readFileSync(file);
const readJson = file => JSON.parse(readBytes(file));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileSha = file => sha256(readBytes(file));
const clone = value => JSON.parse(JSON.stringify(value));
const writeTextOnce = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, 'utf8');
    if (current !== text) throw new Error(`拒绝覆盖既有文件：${file}`);
    return { file, sha256: sha256(Buffer.from(current, 'utf8')), existed: true };
  }
  fs.writeFileSync(file, text, 'utf8');
  return { file, sha256: sha256(Buffer.from(text, 'utf8')), existed: false };
};
const writeJsonOnce = (file, value) => writeTextOnce(file, `${JSON.stringify(value, null, jsonIndent)}\n`);
const assert = (condition, message, detail = undefined) => {
  if (!condition) throw new Error(detail === undefined ? message : `${message}：${JSON.stringify(detail)}`);
};
const eqJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nearly = (a, b, epsilon = 1e-9) => Math.abs(Number(a) - Number(b)) <= epsilon;
const assertArray = (label, actual, expected, epsilon = 1e-8) => {
  assert(Array.isArray(actual) && actual.length === expected.length, `${label}长度不符`, { actual, expected });
  actual.forEach((value, index) => assert(nearly(value, expected[index], epsilon), `${label}[${index}]不符`, { actual: value, expected: expected[index] }));
};

const inputVersion = readJson(inputVersionPath);
const inputHashes = readJson(inputHashPath);
const binding = readJson(bindingPath);
const protection = readJson(inputSnapshotPath);
const reuse = readJson(reusePath);
const attributeBoundary = readJson(attributeBoundaryPath);
const payloadSample = readJson(payloadSamplePath);

assert(inputVersion.apiWrites === 0, '输入包已经包含业务写入');
assert(inputVersion.GETs === 97, '输入包GET计数漂移', inputVersion.GETs);
assert(inputVersion.skills.length === 10, '输入技能槽数量漂移', inputVersion.skills);
assert(reuse.length === 9, '公共参数数量漂移', reuse.length);
assert(binding.clientVersion === '16.17' && binding.officialVersion === '16.17.1', '版本绑定漂移', { client: binding.clientVersion, official: binding.officialVersion });
assert(Array.isArray(protection.requests) && protection.GETs === 97, '保护快照漂移');

const inputHashResults = [];
for (const expected of inputHashes) {
  const actualPath = path.join(inputDir, expected.path);
  assert(fs.existsSync(actualPath), '冻结输入文件缺失', expected.path);
  const actual = fileSha(actualPath);
  assert(actual === expected.sha256, '冻结输入哈希不符', { path: expected.path, expected: expected.sha256, actual });
  inputHashResults.push({ path: expected.path, sha256: actual, byteSize: readBytes(actualPath).length });
}

const protectedTargetMap = {
  '冻结根绑定与当前文本.json': bindingPath,
  '写前原始保护快照.json': inputSnapshotPath,
  'Cursor输入版本.json': inputVersionPath,
};
const protectedTargetHashes = [];
for (const [targetName, sourcePath] of Object.entries(protectedTargetMap)) {
  const targetPath = path.join(protectedPlanningDir, targetName);
  assert(fs.existsSync(targetPath), '第二十三批保护文件缺失', targetPath);
  const actual = fileSha(targetPath);
  const expected = fileSha(sourcePath);
  assert(actual === expected, '第二十三批既有保护文件已漂移，停止生成', { targetName, expected, actual });
  protectedTargetHashes.push({ path: targetName, sha256: actual, byteSize: readBytes(targetPath).length });
}
for (const targetName of ['Cursor冻结输入散列.json', 'Cursor失败与接手审计.json']) {
  const targetPath = path.join(protectedPlanningDir, targetName);
  assert(fs.existsSync(targetPath), '第二十三批审计文件缺失', targetPath);
  protectedTargetHashes.push({ path: targetName, sha256: fileSha(targetPath), byteSize: readBytes(targetPath).length });
}

const heroes = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const rawByHero = {};
const rawChecks = [];
for (const hero of binding.heroes) {
  const sourcePath = path.join(inputDir, '参考资料/客户端原文', `${hero.id}.json.gz`);
  const raw = JSON.parse(zlib.gunzipSync(readBytes(sourcePath)));
  rawByHero[hero.id] = raw;
  assert(raw[hero.rootPath], '客户端根路径缺失', { hero: hero.id, rootPath: hero.rootPath });
  for (const skill of hero.skills) {
    const rawObject = raw[skill.binding];
    assert(rawObject, '客户端技能绑定路径缺失', { hero: hero.id, skillKey: `${hero.id}_${skill.slot.toLowerCase()}`, binding: skill.binding });
    const boundObject = hero.skills.find(item => item.slot === skill.slot)?.object;
    const rawSpell = rawObject.mSpell;
    const boundSpell = boundObject?.mSpell;
    assert(rawSpell && boundSpell, '客户端技能法术对象缺失', { hero: hero.id, slot: skill.slot });
    assert(eqJson(rawSpell.DataValues ?? null, boundSpell.DataValues ?? null), '根绑定DataValues与原始文件不符', { hero: hero.id, slot: skill.slot });
    assert(eqJson(rawSpell.mSpellCalculations ?? null, boundSpell.mSpellCalculations ?? null), '根绑定公式树与原始文件不符', { hero: hero.id, slot: skill.slot });
    for (const field of ['spellCastTime', 'mCastTime', 'mChannelDuration', 'mMaxAmmo', 'mAmmoRechargeTime', 'mana', 'manaValues', 'cooldownTime', 'Cooldown']) {
      if (Object.prototype.hasOwnProperty.call(boundSpell, field)) {
        assert(eqJson(rawSpell[field] ?? null, boundSpell[field] ?? null), '根绑定施法字段与原始文件不符', { hero: hero.id, slot: skill.slot, field });
      }
    }
    rawChecks.push({ hero: hero.id, slot: skill.slot, binding: skill.binding, dataValues: skill.dataValueNames, calculations: skill.calculationNames, status: '一致' });
  }
}

const officialByHero = {};
for (const hero of binding.heroes) {
  const officialPath = path.join(inputDir, '参考资料/官方中文', `${hero.id}.json`);
  const officialRoot = readJson(officialPath)?.data?.[hero.id];
  assert(officialRoot, '官方中文英雄资料缺失', hero.id);
  officialByHero[hero.id] = officialRoot;
  const sourceSkills = heroes[hero.id].source.skills;
  for (const sourceSkill of sourceSkills) {
    if (!sourceSkill.officialId) continue;
    const official = officialRoot.spells.find(spell => spell.id === sourceSkill.officialId);
    assert(official, '官方技能绑定缺失', { hero: hero.id, slot: sourceSkill.slot, officialId: sourceSkill.officialId });
    assert(eqJson(official.cooldown, sourceSkill.cooldown), '官方冷却与冻结来源不符', { hero: hero.id, slot: sourceSkill.slot });
    assert(eqJson(official.cost, sourceSkill.cost), '官方消耗与冻结来源不符', { hero: hero.id, slot: sourceSkill.slot });
  }
}

const subjectByKey = {};
for (const request of protection.requests) {
  if (request.route.startsWith('/skills/') && request.route.split('/').length === 3 && request.status === 200) {
    subjectByKey[request.route.slice('/skills/'.length)] = clone(request.data);
  }
}
assert(Object.keys(subjectByKey).length === 10, '保护快照技能主体数量不符', Object.keys(subjectByKey));

const dv = (skillKey, name) => {
  const [heroId, slot] = skillKey.startsWith('amumu_') ? ['Amumu', skillKey.slice(-1).toUpperCase()] : ['Zac', skillKey.slice(-1).toUpperCase()];
  const bound = heroes[heroId].skills.find(skill => skill.slot === slot);
  const item = (bound?.object?.mSpell?.DataValues ?? []).find(value => value.name === name);
  assert(item, 'DataValues缺失', { skillKey, name });
  return clone(item.values);
};
const calc = (skillKey, name) => {
  const [heroId, slot] = skillKey.startsWith('amumu_') ? ['Amumu', skillKey.slice(-1).toUpperCase()] : ['Zac', skillKey.slice(-1).toUpperCase()];
  const bound = heroes[heroId].skills.find(skill => skill.slot === slot);
  const item = bound?.object?.mSpell?.mSpellCalculations?.[name];
  assert(item, '技能计算树缺失', { skillKey, name });
  return clone(item);
};
const spell = skillKey => {
  const [heroId, slot] = skillKey.startsWith('amumu_') ? ['Amumu', skillKey.slice(-1).toUpperCase()] : ['Zac', skillKey.slice(-1).toUpperCase()];
  return heroes[heroId].skills.find(skill => skill.slot === slot).object.mSpell;
};
const levelValues = values => Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
const rawRanks = (skillKey, name, maxLevel, start = 1) => dv(skillKey, name).slice(start, start + maxLevel);
const rawFixed = (skillKey, name, index = 1) => dv(skillKey, name)[index];
const ms = seconds => Math.round(Number(seconds) * 1000);
const rawFieldValues = (skillKey, name) => (name.startsWith('m') ? clone(spell(skillKey)[name]) : dv(skillKey, name));
const rawFieldFixed = (skillKey, name, index = 1) => rawFieldValues(skillKey, name)[index];
const rawFieldRanks = (skillKey, name, maxLevel, start = 1) => rawFieldValues(skillKey, name).slice(start, start + maxLevel);
const rawMsRanks = (skillKey, name, maxLevel, start = 1) => rawFieldRanks(skillKey, name, maxLevel, start).map(ms);
const rawPctPoints = (skillKey, name, maxLevel, start = 1, scale = 100) => rawRanks(skillKey, name, maxLevel, start).map(value => Number((value * scale).toFixed(12)));

const P = parameterKey => ({ nodeType: 'PARAMETER', parameterKey });
const A = (attributeOwner, attributeKey, attributeValueKind) => ({ nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind });
const O = (operation, ...operands) => ({ nodeType: 'OPERATION', operation, operands });
const foldBinary = (operation, operands) => {
  assert(operands.length >= 2, '二元运算至少需要两个操作数', { operation, operands });
  return operands.slice(1).reduce((left, right) => O(operation, left, right), operands[0]);
};
const ADD = (...operands) => foldBinary('ADD', operands);
const SUB = (...operands) => foldBinary('SUBTRACT', operands);
const MUL = (...operands) => foldBinary('MULTIPLY', operands);
const DIV = (...operands) => foldBinary('DIVIDE', operands);
const MIN = (...operands) => foldBinary('MIN', operands);
const sourceAp = () => A('SOURCE', 'ability_power', 'TOTAL');
const sourceHp = kind => A('SOURCE', 'hp', kind);
const targetHp = () => A('TARGET', 'hp', 'TOTAL');

const param = (parameterKey, name, valueType, valueMode, fixedValue, levelVals, description, sortOrder) => ({
  parameterKey, name, valueType, valueMode, fixedValue, levelValues: levelVals, description, sortOrder,
});
const fixedInt = (key, name, value, description, order) => param(key, name, 'INTEGER', 'FIXED', value, null, description, order);
const fixedDec = (key, name, value, description, order) => param(key, name, 'DECIMAL', 'FIXED', value, null, description, order);
const ranksInt = (key, name, values, description, order) => param(key, name, 'INTEGER', 'SKILL_LEVEL', null, levelValues(values), description, order);
const ranksDec = (key, name, values, description, order) => param(key, name, 'DECIMAL', 'SKILL_LEVEL', null, levelValues(values), description, order);
const runtimeDec = (key, name, description, order) => param(key, name, 'DECIMAL', 'RUNTIME_INPUT', null, null, description, order);
const formula = (formulaKey, name, expression, description, sortOrder) => ({ formulaKey, name, expression, description, sortOrder });

const resourceEffect = (effectKey, name, formulaValue, attributeKey, description) => ({
  effectKey,
  name,
  description,
  sortOrder: 10,
  lifecycle: null,
  results: [{
    resultKey: `consume_${attributeKey}`,
    name: attributeKey === 'mana' ? '消耗法力' : '消耗生命值',
    resultType: 'RESOURCE_CHANGE',
    target: 'SOURCE',
    description: '候选只记录资源变化载荷，实际扣除时点和施放资格未接线。',
    sortOrder: 10,
    lifecycleBehavior: null,
    spellShieldBlockScope: null,
    valueRule: { value: formulaValue, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: { attributeKey, operation: 'CONSUME' },
  }],
});
const manaEffect = () => resourceEffect('mana_cost', '施放法力消耗', { kind: 'PARAMETER', parameterKey: 'mana_cost' }, 'mana', '仅保留官方基础法力消耗；实际扣除时点与施放资格尚未接线。');
const healthEffect = formulaKey => resourceEffect('health_cost', '施放生命值消耗', { kind: 'FORMULA', formulaKey }, 'hp', '仅保留当前生命值比例的资源变化；实际扣除时点与施放资格尚未接线。');
const emptyTail = { processes: [], internalStates: [], triggerRules: [] };

const sourceBlock = (heroId, slot) => {
  const hero = heroes[heroId];
  const bound = hero.skills.find(skill => skill.slot === slot);
  const sourceSkill = hero.source.skills.find(skill => skill.slot === slot);
  const official = sourceSkill.officialId ? officialByHero[heroId].spells.find(spellItem => spellItem.id === sourceSkill.officialId) : null;
  const tooltip = bound.object?.mSpell?.mClientData?.mTooltipData ?? {};
  return {
    hero: heroId,
    rootPath: hero.rootPath,
    spellPath: bound.binding,
    clientFile: path.join(inputDir, '参考资料/客户端原文', `${heroId}.json.gz`),
    compressedSha256: hero.source.client.compressedSha256,
    clientUncompressedSha256: hero.source.client.sha256,
    officialFile: path.join(inputDir, '参考资料/官方中文', `${heroId}.json`),
    officialSha256: hero.source.official.sha256,
    officialId: sourceSkill.officialId,
    officialMaxRank: sourceSkill.officialMaxRank,
    officialSpell: official ? { id: official.id, name: official.name, cooldown: clone(official.cooldown), cost: clone(official.cost), costType: official.costType, description: official.description, tooltip: official.tooltip } : null,
    mLocKeys: clone(tooltip.mLocKeys ?? {}),
    currentTexts: clone(bound.currentTexts),
    dataValueNames: clone(sourceSkill.dataValueNames),
    calculationNames: clone(sourceSkill.calculationNames),
    clientPathNote: sourceSkill.note,
  };
};

const skillRecord = (skillKey, heroId, slot, write, pending, excluded) => {
  const subject = subjectByKey[skillKey];
  assert(subject, '技能主体保护项缺失', skillKey);
  return {
    skillKey,
    name: subject.name,
    maxLevel: subject.maxLevel,
    protectedSubject: {
      skillKey: subject.skillKey,
      name: subject.name,
      maxLevel: subject.maxLevel,
      status: subject.status,
      skillCategoryKeys: clone(subject.skillCategoryKeys),
      description: subject.description,
      sortOrder: subject.sortOrder,
    },
    source: sourceBlock(heroId, slot),
    write: { ...write, ...emptyTail },
    pending,
    excluded,
    reusedPublicParameters: reuse.filter(item => item.skillKey === skillKey).map(item => item.parameterKey),
  };
};

const publicParam = (skillKey, parameterKey) => {
  const item = protection.summary?.[skillKey]?.components?.parameters?.find(parameterItem => parameterItem.parameterKey === parameterKey);
  assert(item, '公共参数现值缺失', { skillKey, parameterKey });
  return {
    parameterKey: item.parameterKey,
    name: item.name,
    valueType: item.valueType,
    valueMode: item.valueMode,
    fixedValue: item.fixedValue,
    levelValues: clone(item.levelValues),
    description: item.description,
    sortOrder: item.sortOrder,
  };
};
const reusedOf = skillKey => reuse.filter(item => item.skillKey === skillKey).map(item => publicParam(item.skillKey, item.parameterKey));
const sourceData = (skillKey, name) => ({ dataValue: name, rawValues: dv(skillKey, name) });
const rawPart = (skillKey, calculationName) => calc(skillKey, calculationName);

const skills = {};

const amumuP = 'amumu_p';
skills[amumuP] = skillRecord(amumuP, 'Amumu', 'P', {
  parameters: [
    fixedInt('curse_duration_ms', '诅咒持续（毫秒）', ms(rawFixed(amumuP, 'DebuffDuration')), '客户端根绑定 DataValues.DebuffDuration 原始数组索引1取3秒，按毫秒录入；只记录诅咒持续，不创建诅咒事件。', 10),
    fixedDec('magic_damage_bonus_true_ratio', '额外真实伤害比例', Number(rawFixed(amumuP, 'DamageAmp').toFixed(3)), '客户端根绑定 DataValues.DamageAmp 原始数组索引1取0.1；正文显示为10%，本参数用比例0.1。', 20),
    runtimeDec('magic_damage_base', '魔法伤害基准（所处减伤阶段待补）', '当前根正文只证明额外真实伤害按魔法伤害计算；该基准处于魔法减伤前还是减伤后尚未证实，不设置默认值。', 30),
  ],
  formulas: [
    formula('bonus_true_damage', '额外真实伤害量', MUL(P('magic_damage_bonus_true_ratio'), P('magic_damage_base')), '当前根绑定没有直接事件树；仅按正文比例计算额外真实伤害。魔法伤害基准的减伤阶段是待补语义，公式不代表已接线事件。', 10),
  ],
  effects: [],
}, [
  { kind: '事件', item: '攻击命中、诅咒施加与魔法伤害联动', reason: '当前候选只保留比例和持续时间，不创建攻击命中、诅咒或伤害结果。' },
  { kind: '输入', item: '魔法伤害基准所处减伤阶段', reason: '根正文未说明额外真实伤害取减伤前或减伤后魔法值，使用无默认运行输入。' },
], []);

const amumuQ = 'amumu_q';
skills[amumuQ] = skillRecord(amumuQ, 'Amumu', 'Q', {
  parameters: [
    ...reusedOf(amumuQ),
    ranksInt('cooldown_ms', '基础冷却时间（毫秒）', rawMsRanks(amumuQ, 'BaseDamage', 5).map(() => ms(rawFixed(amumuQ, 'BaseDamage')) * 0 + 3000), '客户端根绑定 spell cooldownTime=3秒；等级1至5均为3秒，按毫秒录入。公共参数清单只复用法力消耗。', 20),
    fixedInt('cast_time_ms', '施法时间（毫秒）', ms(spell(amumuQ).spellCastTime), '客户端根绑定 spellCastTime=0.25秒，按毫秒录入；只记录施法字段，不表示命中发生时点。', 30),
    ranksInt('base_damage', '基础魔法伤害', rawRanks(amumuQ, 'BaseDamage', 5), '客户端根绑定 DataValues.BaseDamage 取原始数组索引1至5；索引0的45是未采用的占位值，录入70/95/120/145/170。', 40),
    fixedDec('ap_ratio', '法强倍率', Number(rawPart(amumuQ, 'TotalDamage').mFormulaParts[1].mCoefficient.toFixed(2)), 'TotalDamage 第二项 StatByCoefficient 原始 mCoefficient=0.8500000238，按窄口径映射来源总法强并归一为0.85。', 50),
    fixedInt('stun_duration_ms', '眩晕持续（毫秒）', ms(rawFixed(amumuQ, 'StunDuration')), '客户端根绑定 DataValues.StunDuration 原始数组索引1取1秒，按毫秒录入。', 60),
    fixedInt('max_charges', '最大充能层数', 2, '当前绑定正文明确“这个技能有2层充能”，层数使用整数；不创建充能过程。', 70),
    ranksInt('ammo_recharge_time_ms', '充能时间（毫秒）', rawMsRanks(amumuQ, 'mAmmoRechargeTime', 5), '客户端根绑定 mAmmoRechargeTime 原始数组索引1至5为16/15/14/13/12秒，按毫秒录入；保留充能数据，不创建充能事件。', 80),
    fixedInt('dash_speed', '绷带移动速度', rawFixed(amumuQ, 'DashSpeed'), '客户端根绑定 DataValues.DashSpeed 原始数组索引1取1800；单位沿客户端字段保留，位移过程未接线。', 90),
  ],
  formulas: [
    formula('total_damage', '绷带牵引魔法伤害', ADD(P('base_damage'), MUL(P('ap_ratio'), sourceAp())), 'TotalDamage = BaseDamage + 0.85×来源总法强；当前只记录数值公式，不创建Q命中、位移或伤害结果。', 10),
  ],
  effects: [manaEffect()],
}, [
  { kind: '事件', item: '第一命中、位移和两层充能消耗', reason: '命中资格、位移时序和充能过程未接线。' },
], []);

const amumuW = 'amumu_w';
skills[amumuW] = skillRecord(amumuW, 'Amumu', 'W', {
  parameters: [
    fixedInt('cooldown_ms', '基础冷却时间（毫秒）', 1000, '客户端根绑定 cooldownTime=1秒，按毫秒录入；W为开启型技能，实际开关过程未接线。', 10),
    fixedInt('cast_time_ms', '施法时间（毫秒）', ms(spell(amumuW).spellCastTime), '客户端根绑定 spellCastTime=0.3068000078秒，按最近毫秒录入307；不将匿名半秒修饰解释为周期。', 20),
    fixedInt('mana_cost_per_second', '每秒法力消耗', rawFixed(amumuW, 'BaseDamage') * 0 + 8, '当前根资源文本明确为每秒8点法力；这是每秒消耗，不创建普通一次性法力消耗效果。', 30),
    fixedInt('base_damage_per_second', '每秒基础魔法伤害', rawFixed(amumuW, 'BaseDamage'), '客户端根绑定 DataValues.BaseDamage 原始数组索引1取10；正文以每秒伤害显示。', 40),
    ranksDec('target_max_health_percent_points', '目标最大生命值伤害百分数点', rawRanks(amumuW, 'HealthDamage', 5), '客户端根绑定 DataValues.HealthDamage 取原始数组索引1至5；正文显示百分号，本参数保留百分数点1/1.25/1.5/1.75/2。', 50),
    fixedDec('ap_ratio_percent_points_per_ap', '法强转最大生命百分数点倍率', Number(rawFixed(amumuW, 'APRatio').toFixed(3)), '客户端根绑定 DataValues.APRatio 原始数组索引1取0.005；与百分数点相加后再乘0.01换成生命值比例。', 60),
    fixedDec('percent_point_ratio', '百分数点转比例', 0.01, '百分数点换算为比例：1百分数点=0.01；只作为当前公式单位换算。', 70),
  ],
  formulas: [
    formula('total_health_damage_percent_points', '每秒最大生命伤害百分数点', ADD(P('target_max_health_percent_points'), MUL(P('ap_ratio_percent_points_per_ap'), sourceAp())), 'TotalHealthDamage = HealthDamage + APRatio×来源总法强；当前正文把结果显示为最大生命百分数点。', 10),
    formula('damage_per_second', '每秒魔法伤害', ADD(P('base_damage_per_second'), MUL(P('percent_point_ratio'), MUL(ADD(P('target_max_health_percent_points'), MUL(P('ap_ratio_percent_points_per_ap'), sourceAp())), targetHp()))), '每秒伤害 = 10 + 0.01×（1/1.25/1.5/1.75/2 + 0.005×来源总法强）×目标总生命值；不创建周期效果。', 20),
  ],
  effects: [],
}, [
  { kind: '事件', item: '开启、关闭和每秒伤害周期', reason: '当前只保留每秒数值；匿名根节点只保留来源证据，未创建开关、周期或伤害结果。' },
], [
  { kind: '消耗', item: '一次性法力消耗效果', reason: '根资源文本明确为每秒8点法力，不以普通一次CONSUME表示。' },
  { kind: '客户端计算树', item: '{c8e45bc3}与{8a96509c}匿名修饰', reason: '两个匿名节点及其0.5/0.005修饰只保留原始来源证据；时序、单位和业务消费者未证，不写入业务公式。' },
]);

const amumuE = 'amumu_e';
skills[amumuE] = skillRecord(amumuE, 'Amumu', 'E', {
  parameters: [
    ...reusedOf(amumuE),
    fixedInt('cast_time_ms', '施法时间（毫秒）', ms(spell(amumuE).spellCastTime), '客户端根绑定 spellCastTime=0.25秒，按毫秒录入；不表示主动伤害命中时点。', 20),
    ranksInt('base_damage', '基础魔法伤害', rawRanks(amumuE, 'BaseDamage', 5), '客户端根绑定 DataValues.BaseDamage 取原始数组索引1至5，录入65/95/125/155/185。', 30),
    fixedDec('ap_ratio', '主动法强倍率', Number(rawPart(amumuE, 'TantrumDamage').mFormulaParts[1].mCoefficient.toFixed(2)), 'TantrumDamage 第二项 StatByCoefficient 原始mCoefficient=0.5，按窄口径映射来源总法强。', 40),
    ranksInt('base_damage_reduction_points', '基础物理伤害减免点数', rawRanks(amumuE, 'BaseDamageReduction', 5), '客户端根绑定 DataValues.BaseDamageReduction 取原始数组索引1至5，录入5/7/9/11/13固定点数。', 50),
    fixedDec('bonus_armor_ratio', '额外护甲减免倍率', Number(rawPart(amumuE, 'DamageReduction').mFormulaParts[1].mCoefficient.toFixed(2)), 'DamageReduction的mStat=1、mStatFormula=2项原始系数0.03；属性枚举未窄证，倍率保留，输入另行外供。', 60),
    fixedDec('bonus_magic_resistance_ratio', '额外魔抗减免倍率', Number(rawPart(amumuE, 'DamageReduction').mFormulaParts[2].mCoefficient.toFixed(2)), 'DamageReduction的mStat=6、mStatFormula=2项原始系数0.03；属性枚举未窄证，倍率保留，输入另行外供。', 70),
    fixedDec('reduction_cap_ratio', '物理伤害减免上限比例', rawFixed(amumuE, 'FlatDamageReductionMax'), '客户端根绑定 DataValues.FlatDamageReductionMax 原始数组索引1取0.5；正文说明减伤不能将伤害降至50%以下。', 90),
    runtimeDec('incoming_physical_damage', '本次承受物理伤害', '上限公式需要本次物理伤害输入；来源只证明减免量不超过伤害的一半，不设置默认值。', 100),
    runtimeDec('source_bonus_armor', '来源额外护甲', 'mStat=1、mStatFormula=2的具体属性选择器未在当前窄口径证实，不猜枚举，使用无默认运行输入。', 110),
    runtimeDec('source_bonus_magic_resistance', '来源额外魔法抗性', 'mStat=6、mStatFormula=2的具体属性选择器未在当前窄口径证实，不猜枚举，使用无默认运行输入。', 120),
    fixedInt('cooldown_reduction_on_hit_ms', '受击后冷却缩短（毫秒）', ms(rawFixed(amumuE, 'CDROnHit')), '客户端根绑定 DataValues.CDROnHit 原始数组索引1取0.75秒，按毫秒录入；不创建受击事件。', 130),
  ],
  formulas: [
    formula('damage_reduction_points', '物理伤害减免点数', ADD(P('base_damage_reduction_points'), MUL(P('bonus_armor_ratio'), P('source_bonus_armor')), MUL(P('bonus_magic_resistance_ratio'), P('source_bonus_magic_resistance'))), 'DamageReduction = BaseDamageReduction + 0.03×来源额外护甲 + 0.03×来源额外魔抗；输出是固定物理减免点数，不乘0.01。', 10),
    formula('raw_physical_damage_reduction', '封顶前物理伤害减免点数', ADD(P('base_damage_reduction_points'), MUL(P('bonus_armor_ratio'), P('source_bonus_armor')), MUL(P('bonus_magic_resistance_ratio'), P('source_bonus_magic_resistance'))), '封顶前结果沿用固定物理减免点数；不能按百分比或本次伤害先行换算。', 20),
    formula('capped_physical_damage_reduction', '封顶后物理伤害减免量', MIN(ADD(P('base_damage_reduction_points'), MUL(P('bonus_armor_ratio'), P('source_bonus_armor')), MUL(P('bonus_magic_resistance_ratio'), P('source_bonus_magic_resistance'))), MUL(P('reduction_cap_ratio'), P('incoming_physical_damage'))), '最终减免量 = MIN(固定减免点数, 0.5×本次承受物理伤害)；保留50%最低承伤边界。', 30),
    formula('tantrum_damage', '阿木木的愤怒主动魔法伤害', ADD(P('base_damage'), MUL(P('ap_ratio'), sourceAp())), 'TantrumDamage = BaseDamage + 0.5×来源总法强；只保留公式，不创建主动命中伤害结果。', 40),
  ],
  effects: [manaEffect()],
}, [
  { kind: '属性', item: 'mStat=1/6、mStatFormula=2具体选择器', reason: '当前窄口径未证具体属性含义，额外护甲与额外魔抗保留为无默认输入。' },
  { kind: '事件', item: '被攻击后冷却缩短与主动命中', reason: '只保留750毫秒和主动公式，不创建受击、冷却变更或伤害结果。' },
], []);

const amumuR = 'amumu_r';
skills[amumuR] = skillRecord(amumuR, 'Amumu', 'R', {
  parameters: [
    ...reusedOf(amumuR),
    fixedInt('cast_time_ms', '施法时间（毫秒）', ms(spell(amumuR).spellCastTime), '客户端根绑定 spellCastTime=0.25秒，按毫秒录入；不表示区域命中时点。', 20),
    ranksInt('base_damage', '基础魔法伤害', rawRanks(amumuR, 'RDamage', 3), '客户端根绑定 DataValues.RDamage 取原始数组索引1至3，录入200/300/400。', 30),
    fixedDec('ap_ratio', '法强倍率', Number(rawFixed(amumuR, 'RCoefficient').toFixed(1)), 'RCalculatedDamage的StatByNamedDataValue引用RCoefficient，原始值0.8000000119，按窄口径映射来源总法强并归一为0.8。', 40),
    fixedInt('stun_duration_ms', '眩晕持续（毫秒）', ms(rawFixed(amumuR, 'RDuration')), '客户端根绑定 DataValues.RDuration 原始数组索引1取1.5秒，按毫秒录入。', 50),
  ],
  formulas: [
    formula('damage', '木乃伊之咒魔法伤害', ADD(P('base_damage'), MUL(P('ap_ratio'), sourceAp())), 'RCalculatedDamage = RDamage + RCoefficient×来源总法强；只记录区域伤害数值，不创建命中、诅咒或晕眩结果。', 10),
  ],
  effects: [manaEffect()],
}, [
  { kind: '事件', item: '区域命中、诅咒、晕眩和中断位移', reason: '当前只保留数值公式和1500毫秒文本值，不创建事件或结果。' },
], []);

const zacP = 'zac_p';
skills[zacP] = skillRecord(zacP, 'Zac', 'P', {
  parameters: [
    runtimeDec('cell_heal_ratio', '粘液回复最大生命比例（等级值外供）', 'HealPercent是角色等级插值0.04至0.08，当前没有经证的等级求值循环，不展开等级表、不设置默认值。', 20),
  ],
  formulas: [
    formula('total_heal', '粘液回复生命值', MUL(P('cell_heal_ratio'), sourceHp('TOTAL')), 'TotalHeal = HealPercent×来源总生命值；mStat=12、mCoefficient=1与正文最大生命值绑定相符。治疗事件和时机未接线。', 10),
  ],
  effects: [],
}, [
  { kind: '曲线', item: 'HealPercent角色等级插值', reason: '只保留无默认运行输入0.04至0.08的来源边界，不猜1至18级曲线。' },
  { kind: '事件', item: '技能命中产出粘液与拾取', reason: '不创建命中、拾取或直接治疗事件。' },
], [
  { kind: '死亡分支', item: 'ReviveCooldown、ReviveBlobletDuration、组织12%生命值、50%护甲和魔抗', reason: '当前1V1数值候选只保留粘液回复；死亡后四个独立组织分支及被动冷却不写入，保留为来源排除证据。' },
]);

const zacQ = 'zac_q';
skills[zacQ] = skillRecord(zacQ, 'Zac', 'Q', {
  parameters: [
    ...reusedOf(zacQ),
    ranksInt('base_damage', '基础魔法伤害', rawRanks(zacQ, 'BaseDamage', 5), '客户端根绑定 DataValues.BaseDamage 取原始数组索引1至5，录入60/90/120/150/180。', 20),
    fixedDec('ap_ratio', '法强倍率', Number(rawFixed(zacQ, 'APRatio').toFixed(1)), 'TotalDamage的StatByNamedDataValue APRatio原始值0.3000000119，按窄口径映射来源总法强并归一为0.3。', 30),
    fixedDec('source_bonus_health_ratio', '来源额外生命值倍率', Number(rawFixed(zacQ, 'HealthRatio').toFixed(2)), 'TotalDamage的mStat=12、mStatFormula=2、HealthRatio原始0.03；按同类窄证映射来源额外生命值，单位为比例。', 40),
    fixedDec('hp_cost_ratio', '当前生命值消耗比例', Number(rawFixed(zacQ, 'HPCost').toFixed(2)), '客户端根绑定 DataValues.HPCost 原始数组索引1取0.08，正文明确为当前生命值百分比。', 50),
    runtimeDec('source_current_hp_for_cost', '施放前当前生命值', 'HealthCostTooltip需要施放前当前生命值；当前表达式树的mStat=12与mStat=14具体输入未形成可用当前属性节点，不设置默认值。', 60),
    fixedInt('slow_percent_points', '减速百分数点', 40, '客户端根绑定 DataValues.SlowAmount 原始数组索引1为-0.4；当前正文使用SlowAmount×-100，录入正的40百分数点。', 70),
    fixedInt('slow_duration_ms', '减速持续（毫秒）', ms(rawFixed(zacQ, 'SlowDuration')), '客户端根绑定 DataValues.SlowDuration 原始数组索引1取0.5秒，按毫秒录入。', 80),
    fixedInt('max_damage_multiplier', '最大伤害提示倍率', rawPart(zacQ, 'MaxDamageTooltip').mFormulaParts[0].mPart2.mNumber, 'MaxDamageTooltip的ProductOfSubPartsCalculationPart使用固定2，保留为最大伤害提示倍率。', 90),
    fixedInt('missile_range', '绷带射程', rawFixed(zacQ, 'MissileRange'), '客户端根绑定 DataValues.MissileRange 原始数组索引1取800；命中资格未接线。', 100),
    fixedInt('tether_duration_ms', '吸附持续（毫秒）', ms(rawFixed(zacQ, 'TetherDuration')), '客户端根绑定 DataValues.TetherDuration 原始数组索引1取2.5秒，按毫秒录入。', 110),
    fixedInt('tether_falloff_distance', '吸附衰减距离', rawFixed(zacQ, 'TetherFalloffDistance'), '客户端根绑定 DataValues.TetherFalloffDistance 原始数组索引1取900；碰撞过程未接线。', 120),
  ],
  formulas: [
    formula('total_damage', '延伸打击魔法伤害', ADD(P('base_damage'), MUL(P('ap_ratio'), sourceAp()), MUL(P('source_bonus_health_ratio'), sourceHp('BONUS'))), 'TotalDamage = BaseDamage + 0.3×来源总法强 + 0.03×来源额外生命值；同一目标首击与后续普攻的相同数值可复用，未创建命中事件。', 10),
    formula('max_damage_tooltip', '延伸打击最大提示伤害', MUL(P('max_damage_multiplier'), ADD(P('base_damage'), MUL(P('ap_ratio'), sourceAp()), MUL(P('source_bonus_health_ratio'), sourceHp('BONUS')))), 'MaxDamageTooltip = 2×TotalDamage；只保留当前正文最大提示值，不把不同敌人碰撞分支自动并入。', 20),
    formula('health_cost', '延伸打击生命值消耗', MUL(P('hp_cost_ratio'), P('source_current_hp_for_cost')), 'HealthCostTooltip = 0.08×施放前当前生命值；当前输入无默认值，实际扣除时点未接线。', 30),
  ],
  effects: [healthEffect('health_cost')],
}, [
  { kind: '输入', item: '施放前当前生命值', reason: '当前生命值不是已证的SOURCE/TARGET总/基础/额外属性节点，保留无默认运行输入。' },
  { kind: '时序', item: 'spellCastTime=0与mCastTime=0.33秒冲突', reason: '冲突字段不任选，不生成施法时间参数。' },
  { kind: '事件', item: '第二次攻击、不同目标投掷、碰撞伤害和减速', reason: '当前1V1候选仅保留首击/后续普攻可共用的静态伤害与减速值，排除不同目标碰撞事件。' },
], [
  { kind: '目标分支', item: 'MaxSlamDistance、YankDistance、CollisionAoE', reason: '三个距离/范围值只属于扎克Q投掷到另一目标的碰撞分支；当前1V1同目标候选不写入，原始值留在来源证据。' },
]);

const zacW = 'zac_w';
skills[zacW] = skillRecord(zacW, 'Zac', 'W', {
  parameters: [
    ...reusedOf(zacW),
    fixedInt('cast_time_ms', '施法时间（毫秒）', ms(spell(zacW).spellCastTime), '客户端根绑定 spellCastTime=0.25秒，按毫秒录入；不表示喷溅命中时点。', 20),
    ranksInt('base_damage', '基础魔法伤害', rawRanks(zacW, 'BaseDamage', 5), '客户端根绑定 DataValues.BaseDamage 取原始数组索引1至5，录入40/50/60/70/80。', 30),
    ranksDec('target_max_health_percent_points', '目标最大生命值伤害百分数点', rawRanks(zacW, 'HealthPercentTooltip', 5), '客户端根绑定 DataValues.HealthPercentTooltip 取原始数组索引1至5，录入4/5/6/7/8百分数点；与BaseMaxHealthDamage原始0.04至0.08一致。', 40),
    fixedDec('ap_ratio_percent_points_per_ap', '法强转最大生命百分数点倍率', Number(rawFixed(zacW, 'APRatioToPercentDamage').toFixed(2)), 'DisplayPercentDamage的StatByNamedDataValue APRatioToPercentDamage原始0.03；与百分数点相加后由0.01换算为比例。', 50),
    fixedDec('percent_point_ratio', '百分数点转比例', Number(rawPart(zacW, 'DisplayPercentDamage').mMultiplier.mNumber.toFixed(2)), 'DisplayPercentDamage的mMultiplier.mNumber原始0.01，保留为百分数点到比例的单位换算。', 60),
    fixedDec('hp_cost_ratio', '当前生命值消耗比例', Number(rawFixed(zacW, 'HPCost').toFixed(2)), '客户端根绑定 DataValues.HPCost 原始数组索引1取0.04，正文明确为当前生命值百分比。', 70),
    runtimeDec('source_current_hp_for_cost', '施放前当前生命值', 'TooltipHealthCost需要施放前当前生命值；当前mStat=12与mStat=14输入未形成可用当前属性节点，不设置默认值。', 80),
    fixedInt('cell_cooldown_reduction_ms', '粘液缩短冷却（毫秒）', ms(rawFixed(zacW, 'RefundOnBlobPickup')), '客户端根绑定 DataValues.RefundOnBlobPickup 原始数组索引1为1秒，按毫秒录入；拾取事件未接线。', 90),
  ],
  formulas: [
    formula('damage', '不稳定物质魔法伤害', ADD(P('base_damage'), MUL(P('percent_point_ratio'), MUL(ADD(P('target_max_health_percent_points'), MUL(P('ap_ratio_percent_points_per_ap'), sourceAp())), targetHp()))), 'DisplayPercentDamage = 0.01×（4/5/6/7/8 + 0.03×来源总法强）后乘目标总生命值；等价于0.04至0.08加0.0003×法强的比例。', 10),
    formula('health_cost', '不稳定物质生命值消耗', MUL(P('hp_cost_ratio'), P('source_current_hp_for_cost')), 'TooltipHealthCost = 0.04×施放前当前生命值；当前输入无默认值，实际扣除时点未接线。', 20),
  ],
  effects: [healthEffect('health_cost')],
}, [
  { kind: '输入', item: '施放前当前生命值', reason: '当前生命值输入未形成可用属性节点，保留无默认运行输入。' },
  { kind: '事件', item: '粘液拾取与冷却缩短', reason: '只保留1000毫秒数值，不创建拾取事件或冷却变更。' },
], [
  { kind: '目标类别', item: '小兵和野怪百分比伤害上限200', reason: '当前1V1候选目标为英雄，正文专用上限不进入英雄伤害公式。' },
]);

const zacE = 'zac_e';
skills[zacE] = skillRecord(zacE, 'Zac', 'E', {
  parameters: [
    ...reusedOf(zacE),
    fixedInt('cast_time_ms', '起始施法时间（毫秒）', ms(spell(zacE).spellCastTime), '客户端根绑定 spellCastTime=0，按原值录入；蓄力持续单独由ChannelTime记录。', 20),
    ranksInt('base_damage', '基础魔法伤害', rawRanks(zacE, 'BaseDamage', 5), '客户端根绑定 DataValues.BaseDamage 取原始数组索引1至5，录入60/105/150/195/240。', 30),
    fixedDec('ap_ratio', '法强倍率', Number(rawPart(zacE, 'Damage').mFormulaParts[1].mCoefficient.toFixed(1)), 'Damage第二项StatByCoefficient原始mCoefficient=0.8，按窄口径映射来源总法强并归一为0.8。', 40),
    fixedDec('hp_cost_ratio', '当前生命值消耗比例', Number(rawFixed(zacE, 'HPCost').toFixed(2)), '客户端根绑定 DataValues.HPCost 原始数组索引1取0.04，正文明确为当前生命值百分比。', 50),
    runtimeDec('source_current_hp_for_cost', '施放前当前生命值', 'HealthCostTooltip需要施放前当前生命值；当前mStat=12与mStat=14输入未形成可用当前属性节点，不设置默认值。', 60),
    ranksInt('charge_time_ms', '蓄力时间（毫秒）', rawMsRanks(zacE, 'ChannelTime', 5), '客户端根绑定 DataValues.ChannelTime 取原始数组索引1至5的0.9/1/1.1/1.2/1.3秒，按毫秒录入。', 70),
    fixedInt('minimum_stun_duration_ms', '最短击飞持续（毫秒）', ms(rawFixed(zacE, 'MinimumStun')), '客户端根绑定 DataValues.MinimumStun 原始数组索引1取0.5秒，按毫秒录入。', 80),
    fixedInt('maximum_stun_multiplier', '最大击飞倍率', rawPart(zacE, 'MaxStun').mFormulaParts[0].mPart2.mNumber, 'MaxStun的ProductOfSubPartsCalculationPart使用固定2；只保留最大端点，不猜蓄力到击飞的中间曲线。', 90),
    ranksInt('max_range', '最大射程', rawRanks(zacE, 'MaxRange', 5), '客户端根绑定 DataValues.MaxRange 取原始数组索引1至5，录入1200/1350/1500/1650/1800。', 100),
    fixedInt('minimum_speed', '最小冲刺速度', rawFixed(zacE, 'MinimumSpeed'), '客户端根绑定 DataValues.MinimumSpeed 原始数组索引1取500；速度曲线未接线。', 110),
    fixedInt('maximum_speed', '最大冲刺速度', rawFixed(zacE, 'MaximumSpeed'), '客户端根绑定 DataValues.MaximumSpeed 原始数组索引1取1350；速度曲线未接线。', 120),
    fixedDec('distance_to_speed_ratio', '距离到速度倍率', Number(rawFixed(zacE, 'DistanceToSpeedRatio').toFixed(1)), '客户端根绑定 DataValues.DistanceToSpeedRatio 原始数组索引1取0.6；中间速度曲线未证。', 130),
    fixedInt('knockup_radius', '击飞范围半径', rawFixed(zacE, 'KnockupRadius'), '客户端根绑定 DataValues.KnockupRadius 原始数组索引1取265；命中资格未接线。', 140),
    fixedDec('cancel_refund_ratio', '取消返还比例', 0.5, '当前绑定正文明确取消时返还一半冷却时间和消耗，比例使用0.5；不创建取消事件。', 160),
    fixedInt('extra_cell_per_enemy_hero', '每名命中敌方英雄额外粘液数', 1, '当前绑定正文明确每命中一名敌方英雄生成一团额外粘液；不创建粘液事件。', 170),
  ],
  formulas: [
    formula('damage', '橡筋弹弓魔法伤害', ADD(P('base_damage'), MUL(P('ap_ratio'), sourceAp())), 'Damage = BaseDamage + 0.8×来源总法强；只保留伤害数值，不创建着陆命中结果。', 10),
    formula('maximum_stun_duration', '最大击飞持续（毫秒）', MUL(P('minimum_stun_duration_ms'), P('maximum_stun_multiplier')), 'MaxStun = 500×2=1000毫秒；中间蓄力曲线保持待补，不以线性公式替代。', 20),
    formula('health_cost', '橡筋弹弓生命值消耗', MUL(P('hp_cost_ratio'), P('source_current_hp_for_cost')), 'HealthCostTooltip = 0.04×施放前当前生命值；当前输入无默认值，实际扣除时点未接线。', 30),
  ],
  effects: [healthEffect('health_cost')],
}, [
  { kind: '输入', item: '施放前当前生命值', reason: '当前生命值输入未形成可用属性节点，保留无默认运行输入。' },
  { kind: '曲线', item: '蓄力时间到击飞持续、速度与距离中间曲线', reason: '只保留最短/最大端点和原始等级数据，不猜中间求值。' },
  { kind: '事件', item: '蓄力、释放、取消、着陆命中和额外粘液', reason: '保留正文参数，未创建过程、触发或结果。' },
], [
  { kind: '表现', item: 'VFXWarningTime预警时间', reason: '这是客户端表现预警字段，不属于技能业务数值写入；原始值只保留在来源证据。' },
]);

const zacR = 'zac_r';
skills[zacR] = skillRecord(zacR, 'Zac', 'R', {
  parameters: [
    ...reusedOf(zacR),
    fixedInt('bounce_count', '弹跳次数', rawFixed(zacR, 'Bounces'), '客户端根绑定 DataValues.Bounces 原始数组索引1取4；次数使用整数。', 20),
    fixedInt('interval_ms', '弹跳间隔（毫秒）', ms(rawFixed(zacR, 'TimeBetweenBounces')), '客户端根绑定 DataValues.TimeBetweenBounces 原始数组索引1取1秒，按毫秒录入。', 30),
    fixedInt('knockup_duration_ms', '击退持续（毫秒）', ms(rawFixed(zacR, 'KnockupDuration')), '客户端根绑定 DataValues.KnockupDuration 原始数组索引1取1秒，按毫秒录入；实际碰撞事件未接线。', 40),
    ranksInt('first_base_damage', '首次弹跳基础魔法伤害', rawRanks(zacR, 'BaseDamageBounce', 3), '客户端根绑定 DataValues.BaseDamageBounce 取原始数组索引1至3，录入120/190/260。', 50),
    fixedDec('subsequent_damage_multiplier', '后续弹跳伤害倍率', rawFixed(zacR, 'DamageReductionBounce'), '客户端根绑定 DataValues.DamageReductionBounce 原始数组索引1取0.5；后续每跳为首次弹跳伤害的一半。', 60),
    fixedInt('knockback_distance', '击退距离', rawFixed(zacR, 'KnockbackDistance'), '客户端根绑定 DataValues.KnockbackDistance 原始数组索引1取250；碰撞过程未接线。', 70),
    fixedInt('knockback_range', '击退范围', rawFixed(zacR, 'KnockbackRange'), '客户端根绑定 DataValues.KnockbackRange 原始数组索引1取300；碰撞过程未接线。', 80),
    fixedDec('beginning_move_speed_ratio', '起始移动速度比例', Number(rawFixed(zacR, 'BeginningMS').toFixed(1)), '客户端根绑定 DataValues.BeginningMS 原始数组索引1取0.2，正文显示20%；仅保留端点。', 90),
    fixedDec('ending_move_speed_ratio', '结束移动速度比例', Number(rawFixed(zacR, 'EndingMS').toFixed(1)), '客户端根绑定 DataValues.EndingMS 原始数组索引1取0.5，正文显示50%；仅保留端点。', 100),
    fixedInt('slow_percent_points', '减速百分数点', Math.round(rawPctPoints(zacR, 'SlowAmount', 1)[0]), '客户端根绑定 DataValues.SlowAmount 原始索引1的浮点值归一为整数20；正文显示20%，录入百分数点20。', 110),
    fixedInt('slow_duration_ms', '减速持续（毫秒）', ms(rawFixed(zacR, 'SlowDuration')), '客户端根绑定 DataValues.SlowDuration 原始数组索引1取1秒，按毫秒录入。', 120),
    fixedDec('ap_ratio', '弹跳法强倍率', Number(rawFixed(zacR, 'BounceAPRatioTooltip').toFixed(1)), 'DamagePerBounce的StatByNamedDataValue引用BounceAPRatioTooltip原始0.4，按窄口径映射来源总法强。', 130),
    fixedInt('subsequent_bounce_offset', '后续弹跳次数偏移', 1, 'DurationTooltip与MaxDamageTooltip原树使用Bounces-1；该固定偏移是公式消费者，不是额外运行层数。', 140),
  ],
  formulas: [
    formula('damage_per_bounce', '首次弹跳魔法伤害', ADD(P('first_base_damage'), MUL(P('ap_ratio'), sourceAp())), 'DamagePerBounce = BaseDamageBounce + BounceAPRatioTooltip×来源总法强。', 10),
    formula('damage_per_subsequent_bounce', '后续弹跳魔法伤害', MUL(P('subsequent_damage_multiplier'), ADD(P('first_base_damage'), MUL(P('ap_ratio'), sourceAp()))), 'DamagePerSubsequentBounce = DamageReductionBounce×DamagePerBounce = 0.5×首次弹跳伤害。', 20),
    formula('duration_tooltip_ms', '弹跳总提示持续（毫秒）', MUL(P('interval_ms'), SUB(P('bounce_count'), P('subsequent_bounce_offset'))), 'DurationTooltip = TimeBetweenBounces×(Bounces-1)；原始提示为3秒，按毫秒录入，不强加额外4秒。', 30),
    formula('max_damage_tooltip', '弹跳总提示伤害', ADD(ADD(P('first_base_damage'), MUL(P('ap_ratio'), sourceAp())), MUL(MUL(P('subsequent_damage_multiplier'), ADD(P('first_base_damage'), MUL(P('ap_ratio'), sourceAp()))), SUB(P('bounce_count'), P('subsequent_bounce_offset')))), 'MaxDamageTooltip = 首次伤害 + 后续伤害×(Bounces-1)，四次弹跳即首跳加三次半额后续跳。', 40),
  ],
  effects: [],
}, [
  { kind: '时序', item: 'spellCastTime=0与mCastTime=0.3秒冲突', reason: '冲突字段不任选，不生成施法时间参数。' },
  { kind: '曲线', item: '弹跳命中、减速和移动速度中间曲线', reason: '保留4跳、1秒间隔及移动速度端点，未猜中间求值。' },
  { kind: '事件', item: '四次实际命中、击退、减速和期间施放W', reason: '只保留可解析数值公式，不创建碰撞或嵌套施法过程。' },
], [
  { kind: '碰撞', item: '幽灵状态无视碰撞体积', reason: '当前正文为碰撞规则说明，不作为数值参数或事件结果。' },
]);

const independentArrayChecks = [
  { label: 'amumu_q.BaseDamage索引1至5', actual: rawRanks(amumuQ, 'BaseDamage', 5), expected: [70, 95, 120, 145, 170] },
  { label: 'amumu_q.StunDuration索引1至5', actual: rawRanks(amumuQ, 'StunDuration', 5), expected: [1, 1, 1, 1, 1] },
  { label: 'amumu_q.mAmmoRechargeTime索引1至5', actual: rawFieldRanks(amumuQ, 'mAmmoRechargeTime', 5), expected: [16, 15, 14, 13, 12] },
  { label: 'amumu_w.HealthDamage索引1至5', actual: rawRanks(amumuW, 'HealthDamage', 5), expected: [1, 1.25, 1.5, 1.75, 2] },
  { label: 'amumu_e.BaseDamage索引1至5', actual: rawRanks(amumuE, 'BaseDamage', 5), expected: [65, 95, 125, 155, 185] },
  { label: 'amumu_e.BaseDamageReduction索引1至5', actual: rawRanks(amumuE, 'BaseDamageReduction', 5), expected: [5, 7, 9, 11, 13] },
  { label: 'amumu_r.RDamage索引1至3', actual: rawRanks(amumuR, 'RDamage', 3), expected: [200, 300, 400] },
  { label: 'zac_q.BaseDamage索引1至5', actual: rawRanks(zacQ, 'BaseDamage', 5), expected: [60, 90, 120, 150, 180] },
  { label: 'zac_w.BaseDamage索引1至5', actual: rawRanks(zacW, 'BaseDamage', 5), expected: [40, 50, 60, 70, 80] },
  { label: 'zac_w.BaseMaxHealthDamage索引1至5', actual: rawRanks(zacW, 'BaseMaxHealthDamage', 5), expected: [0.04, 0.05, 0.06, 0.07, 0.08] },
  { label: 'zac_e.BaseDamage索引1至5', actual: rawRanks(zacE, 'BaseDamage', 5), expected: [60, 105, 150, 195, 240] },
  { label: 'zac_e.MaxRange索引1至5', actual: rawRanks(zacE, 'MaxRange', 5), expected: [1200, 1350, 1500, 1650, 1800] },
  { label: 'zac_e.ChannelTime索引1至5', actual: rawRanks(zacE, 'ChannelTime', 5), expected: [0.9, 1, 1.1, 1.2, 1.3] },
  { label: 'zac_r.BaseDamageBounce索引1至3', actual: rawRanks(zacR, 'BaseDamageBounce', 3), expected: [120, 190, 260] },
];
for (const check of independentArrayChecks) assertArray(check.label, check.actual, check.expected, 1e-6);
const independentModifierChecks = [
  { label: 'amumu_w.{c8e45bc3}.mMultiplier', actual: rawPart(amumuW, '{c8e45bc3}').mMultiplier.mNumber, expected: 0.5 },
  { label: 'amumu_w.{8a96509c}.mMultiplier', actual: rawPart(amumuW, '{8a96509c}').mMultiplier.mNumber, expected: 0.005 },
  { label: 'zac_w.DisplayPercentDamage.mMultiplier', actual: rawPart(zacW, 'DisplayPercentDamage').mMultiplier.mNumber, expected: 0.01 },
  { label: 'zac_e.MaxStun常数', actual: rawPart(zacE, 'MaxStun').mFormulaParts[0].mPart2.mNumber, expected: 2 },
  { label: 'zac_r.DamagePerSubsequentBounce.mMultiplier引用', actual: rawPart(zacR, 'DamagePerSubsequentBounce').mMultiplier.mDataValue, expected: 'DamageReductionBounce' },
];
for (const check of independentModifierChecks) assert(check.actual === check.expected || nearly(check.actual, check.expected, 1e-9), `${check.label}不符`, { actual: check.actual, expected: check.expected });

const order = Object.keys(skills);
assert(eqJson(order, inputVersion.skills), '技能顺序与输入版本不符', { order, expected: inputVersion.skills });
const topReused = reuse.map(item => ({ skillKey: item.skillKey, parameterKey: item.parameterKey }));
const postIntents = [];
for (const skillKey of order) {
  const record = skills[skillKey];
  for (const body of record.write.parameters) {
    const isReused = topReused.some(item => item.skillKey === skillKey && item.parameterKey === body.parameterKey);
    if (isReused) continue;
    postIntents.push({ method: 'POST', route: `/skills/${skillKey}/parameters`, skillKey, kind: 'parameters', stableKey: body.parameterKey, status: '仅意图，未调用', body: clone(body) });
  }
  for (const body of record.write.formulas) postIntents.push({ method: 'POST', route: `/skills/${skillKey}/formulas`, skillKey, kind: 'formulas', stableKey: body.formulaKey, status: '仅意图，未调用', body: clone(body) });
  for (const body of record.write.effects) postIntents.push({ method: 'POST', route: `/skills/${skillKey}/effects`, skillKey, kind: 'effects', stableKey: body.effectKey, status: '仅意图，未调用', body: clone(body) });
}

const counts = {
  skills: order.length,
  parametersInWrite: order.reduce((sum, skillKey) => sum + skills[skillKey].write.parameters.length, 0),
  newParameterIntents: postIntents.filter(item => item.kind === 'parameters').length,
  formulas: order.reduce((sum, skillKey) => sum + skills[skillKey].write.formulas.length, 0),
  effects: order.reduce((sum, skillKey) => sum + skills[skillKey].write.effects.length, 0),
  processes: 0,
  internalStates: 0,
  triggerRules: 0,
  reusedPublicParameters: topReused.length,
  postIntents: postIntents.length,
  apiWrites: 0,
};
assert(counts.formulas === 22, '第二十三批公式数量不符', counts.formulas);

const candidate = {
  meta: {
    batch: '第二十三批阿木木扎克',
    revision: '修订一',
    gameId: 'lol',
    clientVersion: inputVersion.sourceFiles ? '16.17' : binding.clientVersion,
    officialVersion: '16.17.1',
    generatedAt: generatedAt,
    inputPackage: inputDir,
    sourceIndexSha256: inputVersion.sourceIndexSha256,
    sourceBindingSha256: fileSha(bindingPath),
    protectionSnapshotSha256: fileSha(inputSnapshotPath),
    protectionSnapshotGETs: protection.GETs,
    protectedSubjectCount: Object.keys(subjectByKey).length,
    cursorStatus: 'Cursor实际调用因ECONNRESET中断，产物为空；本文件为根接手静态候选，未重启Cursor。',
    apiWrites: 0,
    note: '完整候选以skills[skillKey].write记录十槽最终组成。9个已有公共参数按冻结实值列入write并单独列入reusedPublicParameters；只生成其余缺项的POST意图。候选、数学核算和请求意图都不是已录入。',
  },
  reusedPublicParameters: topReused,
  skills,
  postIntents,
};

const validateExpression = (skillKey, expression, parameterKeys) => {
  assert(expression && typeof expression === 'object', '公式表达式缺失', skillKey);
  if (expression.nodeType === 'PARAMETER') {
    assert(parameterKeys.has(expression.parameterKey), '公式引用了未定义参数', { skillKey, parameterKey: expression.parameterKey });
    return;
  }
  if (expression.nodeType === 'ATTRIBUTE') {
    assert(['SOURCE', 'TARGET'].includes(expression.attributeOwner), '公式属性来源不在窄口径内', { skillKey, expression });
    assert(['TOTAL', 'BASE', 'BONUS'].includes(expression.attributeValueKind), '公式属性取值类型不在窄口径内', { skillKey, expression });
    assert(expression.attributeKey && !String(expression.attributeKey).toLowerCase().includes('current'), '公式不允许CURRENT属性节点', { skillKey, expression });
    return;
  }
  assert(expression.nodeType === 'OPERATION', '公式节点类型不受支持', { skillKey, expression });
  assert(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(expression.operation), '公式操作不受支持', { skillKey, expression });
  assert(Array.isArray(expression.operands) && expression.operands.length === 2, '公式必须是二元操作', { skillKey, expression });
  for (const operand of expression.operands) validateExpression(skillKey, operand, parameterKeys);
};
for (const skillKey of order) {
  const record = candidate.skills[skillKey];
  const parameterKeys = new Set(record.write.parameters.map(item => item.parameterKey));
  for (const item of record.write.parameters) {
    if (item.valueType === 'INTEGER') {
      if (item.valueMode === 'FIXED') assert(Number.isInteger(item.fixedValue), '整数固定值不是整数', { skillKey, key: item.parameterKey, value: item.fixedValue });
      if (item.valueMode === 'SKILL_LEVEL') for (const [level, value] of Object.entries(item.levelValues ?? {})) assert(Number.isInteger(value), '整数等级值不是整数', { skillKey, key: item.parameterKey, level, value });
    }
    if (item.valueMode === 'RUNTIME_INPUT') assert(item.fixedValue === null && item.levelValues === null, '运行输入带默认值', { skillKey, key: item.parameterKey });
  }
  for (const item of record.write.formulas) validateExpression(skillKey, item.expression, parameterKeys);
  const formulaKeys = new Set(record.write.formulas.map(item => item.formulaKey));
  for (const effect of record.write.effects) {
    for (const result of effect.results ?? []) {
      const value = result.valueRule?.value;
      if (value?.kind === 'FORMULA') assert(formulaKeys.has(value.formulaKey), '资源效果引用了未定义公式', { skillKey, formulaKey: value.formulaKey });
      if (value?.kind === 'PARAMETER') assert(parameterKeys.has(value.parameterKey), '资源效果引用了未定义参数', { skillKey, parameterKey: value.parameterKey });
    }
  }
}

const sourceManifest = {
  batch: candidate.meta.batch,
  sourceVersion: { client: binding.clientVersion, official: binding.officialVersion },
  sourceIndexSha256: inputVersion.sourceIndexSha256,
  inputPackage: inputDir,
  files: inputHashResults,
  rawRootConsistency: rawChecks,
  protectedTargetFiles: protectedTargetHashes,
  attributeBoundarySha256: fileSha(attributeBoundaryPath),
  payloadSampleSha256: fileSha(payloadSamplePath),
  sourceNotes: [
    '客户端原文压缩文件、官方中文文件和当前中文绑定均为冻结输入；当前正文只取根绑定mLocKeys对应文本。',
    '官方中文用于技能名称、等级、冷却和消耗交叉核对；数值公式以当前根DataValues与mSpellCalculations为准。',
    '属性节点只使用已证的SOURCE/TARGET与TOTAL/BASE/BONUS字段；未证选择器使用无默认RUNTIME_INPUT。',
    '阿木木W两个匿名计算节点及其0.5/0.005修饰只作为客户端原始来源证据，不进入业务公式。'
  ],
  rawValueChecks: [
    { skillKey: amumuP, fields: [sourceData(amumuP, 'DebuffDuration'), sourceData(amumuP, 'DamageAmp')] },
    { skillKey: amumuQ, fields: [sourceData(amumuQ, 'BaseDamage'), sourceData(amumuQ, 'StunDuration'), sourceData(amumuQ, 'DashSpeed'), { field: 'mAmmoRechargeTime', rawValues: clone(spell(amumuQ).mAmmoRechargeTime) }], calculations: { TotalDamage: rawPart(amumuQ, 'TotalDamage') } },
    { skillKey: amumuW, fields: [sourceData(amumuW, 'BaseDamage'), sourceData(amumuW, 'HealthDamage'), sourceData(amumuW, 'APRatio')], calculations: { '{c8e45bc3}': rawPart(amumuW, '{c8e45bc3}'), TotalHealthDamage: rawPart(amumuW, 'TotalHealthDamage'), '{8a96509c}': rawPart(amumuW, '{8a96509c}') } },
    { skillKey: amumuE, fields: [sourceData(amumuE, 'FlatDamageReductionMax'), sourceData(amumuE, 'BaseDamage'), sourceData(amumuE, 'BaseDamageReduction'), sourceData(amumuE, 'CDROnHit'), sourceData(amumuE, 'PassiveScaling')], calculations: { DamageReduction: rawPart(amumuE, 'DamageReduction'), TantrumDamage: rawPart(amumuE, 'TantrumDamage') } },
    { skillKey: amumuR, fields: [sourceData(amumuR, 'RDamage'), sourceData(amumuR, 'RDuration'), sourceData(amumuR, 'RCoefficient')], calculations: { RCalculatedDamage: rawPart(amumuR, 'RCalculatedDamage') } },
    { skillKey: zacP, fields: [sourceData(zacP, 'ReviveCooldown')], calculations: { HealPercent: rawPart(zacP, 'HealPercent'), ReviveBlobletDuration: rawPart(zacP, 'ReviveBlobletDuration'), TotalHeal: rawPart(zacP, 'TotalHeal') } },
    { skillKey: zacQ, fields: ['BaseDamage','APRatio','HealthRatio','HPCost','MissileRange','SlowAmount','SlowDuration','TetherDuration','TetherFalloffDistance','MaxSlamDistance','YankDistance','CollisionAoE'].map(name => sourceData(zacQ, name)), calculations: { TotalDamage: rawPart(zacQ, 'TotalDamage'), MaxDamageTooltip: rawPart(zacQ, 'MaxDamageTooltip'), HealthCostTooltip: rawPart(zacQ, 'HealthCostTooltip') } },
    { skillKey: zacW, fields: ['BaseDamage','APRatioToPercentDamage','BaseMaxHealthDamage','HealthPercentTooltip','HPCost','PercentHealthDamage','RefundOnBlobPickup','MaxMinionDamage'].map(name => sourceData(zacW, name)), calculations: { DisplayPercentDamage: rawPart(zacW, 'DisplayPercentDamage'), TooltipHealthCost: rawPart(zacW, 'TooltipHealthCost') } },
    { skillKey: zacE, fields: ['BaseDamage','HPCost','MaxRange','ChannelTime','MinimumStun','MinimumSpeed','MaximumSpeed','DistanceToSpeedRatio','KnockupRadius','VFXWarningTime'].map(name => sourceData(zacE, name)), calculations: { MaxStun: rawPart(zacE, 'MaxStun'), Damage: rawPart(zacE, 'Damage'), HealthCostTooltip: rawPart(zacE, 'HealthCostTooltip') } },
    { skillKey: zacR, fields: ['Bounces','TimeBetweenBounces','KnockupDuration','BaseDamageBounce','DamageReductionBounce','KnockbackDistance','KnockbackRange','BeginningMS','EndingMS','SlowAmount','SlowDuration','BounceAPRatioTooltip'].map(name => sourceData(zacR, name)), calculations: { DamagePerBounce: rawPart(zacR, 'DamagePerBounce'), DamagePerSubsequentBounce: rawPart(zacR, 'DamagePerSubsequentBounce'), DurationTooltip: rawPart(zacR, 'DurationTooltip'), MaxDamageTooltip: rawPart(zacR, 'MaxDamageTooltip') } },
  ],
  independentArrayChecks: independentArrayChecks.map(check => ({ label: check.label, actual: check.actual, expected: check.expected, passed: true })),
  independentModifierChecks: independentModifierChecks.map(check => ({ label: check.label, actual: check.actual, expected: check.expected, passed: true })),
  arrayIndexRule: '客户端DataValues数组原始索引从0计；主动等级值按根树要求逐项取索引1至maxLevel，所有换算在生成器中逐数组独立完成，不使用map(round)或共享舍入误差。',
};

const protectedState = {
  at: generatedAt,
  sourcePackage: inputDir,
  targetDirectory: planningDir,
  targetProtectedFiles: protectedTargetHashes,
  existingSubjects: Object.values(subjectByKey).map(subject => ({ skillKey: subject.skillKey, name: subject.name, maxLevel: subject.maxLevel, skillCategoryKeys: clone(subject.skillCategoryKeys), status: subject.status, sortOrder: subject.sortOrder })),
  existingComponentLists: Object.fromEntries(order.map(skillKey => [skillKey, clone(protection.summary[skillKey].components)])),
  protectedImages: order.map(skillKey => ({ skillKey, image: clone(protection.summary[skillKey].image ?? null) })),
  protectedRelations: protection.requests.filter(request => request.route.includes('/relations') || request.route.includes('/skill-relations') || request.route.includes('/image-relations')).map(clone),
  initialGETs: protection.GETs,
  apiWrites: 0,
  note: '本文件是生成时的静态保护摘要；没有新增业务GET。10个主体、六类组件列表、代表图和关系沿用输入保护快照，不生成主体、关系或图片意图。',
};

const rangeReport = {
  batch: candidate.meta.batch,
  status: '静态候选，未录入',
  skills: order,
  heroes: [{ id: 'Amumu', name: '阿木木', slots: ['P','Q','W','E','R'] }, { id: 'Zac', name: '扎克', slots: ['P','Q','W','E','R'] }],
  candidateCounts: counts,
  publicReuse: topReused,
  subjectsAndMetadata: '10个技能主体、分类、状态、排序、代表图和既有关系均属于保护现值；候选不生成主体更新。',
  included: [
    '阿木木：诅咒持续与额外真实伤害比例、Q/E/R和W每秒公式；W法力按每秒值保留，不做一次性消耗。',
    '扎克：粘液回复静态公式、Q/W/E生命值消耗公式、R四跳伤害与持续提示树；属性选择器遵守来源窄口径。',
  ],
  pending: order.flatMap(skillKey => skills[skillKey].pending.map(item => ({ skillKey, ...item }))),
  excluded: order.flatMap(skillKey => skills[skillKey].excluded.map(item => ({ skillKey, ...item }))),
  unresolvedScope: [
    '未接入任何攻击/命中/周期/碰撞/位移/施法资格或直接伤害、治疗结果。',
    '未知等级曲线、当前生命值输入、阿木木E的额外护甲/魔抗选择器和冲突施法时间均无默认值或留在待补项。',
    '扎克P死亡后的四组织复活分支、扎克Q不同目标碰撞、扎克W兵野上限、扎克R幽灵碰撞规则未进入英雄1V1数值候选。',
  ],
  sourceFiles: inputHashResults,
  protectedFiles: protectedTargetHashes,
  apiWrites: 0,
};

const intentPlan = {
  generatedAt: generatedAt,
  note: '只含缺项POST意图；9个已有公共参数完整复用，不发更新或重建。所有条目均为静态计划，未调用业务API。',
  apiWrites: 0,
  order,
  count: postIntents.length,
  intents: postIntents,
};

const candidateVersion = {
  generatedAt: generatedAt,
  batch: candidate.meta.batch,
  candidateSha256: null,
  planSha256: null,
  sourceManifestSha256: null,
  protectedStateSha256: null,
  skills: counts.skills,
  formulas: counts.formulas,
  parametersInWrite: counts.parametersInWrite,
  newParameterIntents: counts.newParameterIntents,
  effects: counts.effects,
  reusedPublicParameters: counts.reusedPublicParameters,
  postIntents: counts.postIntents,
  apiWrites: 0,
  cursorStatus: candidate.meta.cursorStatus,
};

const reportText = `# 第二十三批阿木木与扎克候选体验报告\n\n本批只生成静态候选和缺项请求意图，未调用业务接口，业务写入数为0。输入为客户端16.17、官方16.17.1冻结来源；冻结输入时间为${inputVersion.at}，本次修订实际生成时间为${generatedAt}；Cursor实际调用因连接重置中断，未重启。\n\n候选包含阿木木、扎克各P/Q/W/E/R共10个技能槽，22棵可解析公式树。9个已有公共参数原值复用，新的参数、公式和资源变化载荷只作为请求意图记录。所有技能主体、分类、状态、排序、六类组件现值、代表图和关系均由保护快照保护，未生成主体或图片关系写入。\n\n数学范围包括：等级数组原始索引逐项核对、根匿名修饰倍率、阿木木W百分数点单位换算（匿名节点只作来源证据）、阿木木E的50%减免量封顶、扎克Q/W/E当前生命值缺值拒绝、扎克R四跳首跳加三次半额后续跳。独立数学脚本从最终候选表达式树求值，不把候选散列当作数学通过。\n\n待补项集中在事件时序、命中和施放资格、未知等级曲线、冲突施法时间、当前生命值输入、阿木木E属性选择器，以及扎克P死亡复活分支和Q不同目标碰撞分支（来源排除）；详见《来源与范围.json》。\n`;

const candidateText = `${JSON.stringify(candidate, null, jsonIndent)}\n`;
const planText = `${JSON.stringify(intentPlan, null, jsonIndent)}\n`;
const sourceText = `${JSON.stringify(sourceManifest, null, jsonIndent)}\n`;
const protectedText = `${JSON.stringify(protectedState, null, jsonIndent)}\n`;
candidateVersion.candidateSha256 = sha256(Buffer.from(candidateText, 'utf8'));
candidateVersion.planSha256 = sha256(Buffer.from(planText, 'utf8'));
candidateVersion.sourceManifestSha256 = sha256(Buffer.from(sourceText, 'utf8'));
candidateVersion.protectedStateSha256 = sha256(Buffer.from(protectedText, 'utf8'));
const versionText = `${JSON.stringify(candidateVersion, null, jsonIndent)}\n`;

const outputs = [
  ['完整候选.json', candidateText],
  ['按顺序缺项POST意图计划.json', planText],
  ['候选版本.json', versionText],
  ['来源与范围.json', sourceText],
  ['现值与保护摘要.json', protectedText],
  ['体验报告.md', reportText],
];
const written = [];
for (const [name, text] of outputs) {
  written.push({ target: 'artifact', ...writeTextOnce(path.join(artifactDir, name), text) });
  written.push({ target: 'planning', ...writeTextOnce(path.join(planningDir, name), text) });
}

const generatorSummary = {
  at: generatedAt,
  outputs: written,
  candidateSha256: candidateVersion.candidateSha256,
  planSha256: candidateVersion.planSha256,
  sourceManifestSha256: candidateVersion.sourceManifestSha256,
  protectedStateSha256: candidateVersion.protectedStateSha256,
  counts,
  rawRootChecks: rawChecks.length,
  inputFilesChecked: inputHashResults.length,
  protectedFilesChecked: protectedTargetHashes.length,
  apiWrites: 0,
};
writeJsonOnce(path.join(artifactDir, '生成摘要.json'), generatorSummary);
writeJsonOnce(path.join(planningDir, '生成摘要.json'), generatorSummary);

console.log(JSON.stringify({
  candidateSha256: candidateVersion.candidateSha256,
  planSha256: candidateVersion.planSha256,
  sourceManifestSha256: candidateVersion.sourceManifestSha256,
  counts,
  inputFilesChecked: inputHashResults.length,
  protectedFilesChecked: protectedTargetHashes.length,
  apiWrites: 0,
}, null, 2));
