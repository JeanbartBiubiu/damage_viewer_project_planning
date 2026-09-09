import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const inputDir = path.join(here, '输入包');
const batchDir = path.resolve(here, '..', '..', '..', '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第二十五批');
const sourceFile = path.join(here, '源值解析-初稿.json');
const inputVersion = readJson(path.join(inputDir, '输入版本.json'));
const source = readJson(sourceFile);
const currentSnapshot = readJson(path.join(inputDir, '参考资料', '当前10槽保护快照.json'));
const reuseList = readJson(path.join(inputDir, '参考资料', '公共参数复用清单.json'));

const order = [
  'drmundo_p', 'drmundo_q', 'drmundo_w', 'drmundo_e', 'drmundo_r',
  'tryndamere_p', 'tryndamere_q', 'tryndamere_w', 'tryndamere_e', 'tryndamere_r'
];
const endpointByKind = {
  parameters: 'parameters',
  formulas: 'formulas',
  effects: 'effects',
  processes: 'processes',
  internalStates: 'internal-states',
  triggerRules: 'trigger-rules',
};
const fieldByKind = {
  parameters: 'parameterKey',
  formulas: 'formulaKey',
  effects: 'effectKey',
  processes: 'processKey',
  internalStates: 'stateKey',
  triggerRules: 'ruleKey',
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function sameNumber(actual, expected, tolerance = 1e-6) {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;
}

function sourceSkill(skillKey) {
  for (const hero of Object.values(source.heroes)) {
    if (hero.skills?.[skillKey]) return { hero, skill: hero.skills[skillKey] };
  }
  throw new Error(`来源中缺少技能 ${skillKey}`);
}

function dataValues(skillKey, name, maxLevel = null) {
  const { skill } = sourceSkill(skillKey);
  const row = (skill.rawSpell?.DataValues ?? []).find(item => item.name === name);
  if (!row) throw new Error(`来源中缺少 DataValues.${name}: ${skillKey}`);
  const count = maxLevel ?? skill.rawSpell?.mClientData?.mTooltipData?.mLists?.LevelUp?.levelCount ?? null;
  if (!count) throw new Error(`无法确定等级数: ${skillKey}/${name}`);
  return row.values.slice(1, count + 1);
}

function assertSeries(skillKey, name, expected, tolerance = 1e-6) {
  const actual = dataValues(skillKey, name, expected.length);
  if (actual.length !== expected.length || actual.some((value, index) => !sameNumber(value, expected[index], tolerance))) {
    throw new Error(`来源值不匹配 ${skillKey}/${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
  return expected.slice();
}

function levels(values) {
  return Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
}

function p(parameterKey, name, valueType, valueMode, value, description, sortOrder) {
  if (valueMode === 'FIXED') {
    return { parameterKey, name, valueType, valueMode, fixedValue: value, levelValues: null, description, sortOrder };
  }
  if (valueMode === 'SKILL_LEVEL') {
    if (!Array.isArray(value)) throw new Error(`技能等级参数必须为数组 ${parameterKey}`);
    return { parameterKey, name, valueType, valueMode, fixedValue: null, levelValues: levels(value), description, sortOrder };
  }
  if (valueMode === 'RUNTIME_INPUT') {
    return { parameterKey, name, valueType, valueMode, fixedValue: null, levelValues: null, description, sortOrder };
  }
  throw new Error(`未知参数取值模式 ${valueMode}`);
}

function param(parameterKey) {
  return { nodeType: 'PARAMETER', parameterKey };
}

function attr(attributeOwner, attributeKey, attributeValueKind) {
  return { nodeType: 'ATTRIBUTE', attributeOwner, attributeKey, attributeValueKind };
}

function op(operation, left, right) {
  return { nodeType: 'OPERATION', operation, operands: [left, right] };
}

const add = (left, right) => op('ADD', left, right);
const subtract = (left, right) => op('SUBTRACT', left, right);
const multiply = (left, right) => op('MULTIPLY', left, right);
const min = (left, right) => op('MIN', left, right);
const max = (left, right) => op('MAX', left, right);

function f(formulaKey, name, expression, description, sortOrder) {
  return { formulaKey, name, expression, description, sortOrder };
}

function valueRule(kind, key) {
  const value = kind === 'PARAMETER' ? { kind, parameterKey: key } : { kind, formulaKey: key };
  return { value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null };
}

function timedLifecycle(durationParameterKey, instanceScope = 'TARGET') {
  return {
    durationValue: { kind: 'PARAMETER', parameterKey: durationParameterKey },
    maxStacksValue: { kind: 'FIXED', value: 1 },
    applicationStacksValue: { kind: 'FIXED', value: 1 },
    instanceScope,
    reapplicationStackMode: 'KEEP',
    reapplicationDurationMode: 'REFRESH_ALL',
    expiryMode: 'ALL_AT_ONCE',
    periodicIntervalValue: null,
    firstPeriodicExecution: null,
  };
}

function permanentLifecycle(instanceScope = 'SOURCE') {
  return {
    durationValue: null,
    maxStacksValue: { kind: 'FIXED', value: 1 },
    applicationStacksValue: { kind: 'FIXED', value: 1 },
    instanceScope,
    reapplicationStackMode: 'KEEP',
    reapplicationDurationMode: null,
    expiryMode: 'EXPLICIT_ONLY',
    periodicIntervalValue: null,
    firstPeriodicExecution: null,
  };
}

function persistentBehavior(reapplicationValueMode = 'REPLACE') {
  return {
    moment: 'PERSISTENT',
    valueReadMode: 'APPLICATION_SNAPSHOT',
    stackValueMode: 'SHARED',
    reapplicationValueMode,
    periodicExecutionMode: null,
  };
}

function resourceEffect(effectKey, name, parameterOrFormula, attributeKey, operation, description, sortOrder = 10) {
  const kind = parameterOrFormula.kind;
  return {
    effectKey,
    name,
    description,
    sortOrder,
    lifecycle: null,
    results: [{
      resultKey: 'resource',
      name,
      resultType: 'RESOURCE_CHANGE',
      target: 'SOURCE',
      description: null,
      sortOrder: 10,
      lifecycleBehavior: null,
      spellShieldBlockScope: null,
      valueRule: valueRule(kind, parameterOrFormula.key),
      detail: { attributeKey, operation },
    }],
  };
}

function attributeEffect(effectKey, name, parameterOrFormula, attributeKey, operation, durationParameterKey, target, description, sortOrder = 10, permanent = false) {
  const kind = parameterOrFormula.kind;
  return {
    effectKey,
    name,
    description,
    sortOrder,
    lifecycle: permanent ? permanentLifecycle(target) : timedLifecycle(durationParameterKey, target),
    results: [{
      resultKey: 'attribute',
      name,
      resultType: 'ATTRIBUTE_CHANGE',
      target,
      description: null,
      sortOrder: 10,
      lifecycleBehavior: persistentBehavior(),
      spellShieldBlockScope: null,
      valueRule: valueRule(kind, parameterOrFormula.key),
      detail: { attributeKey, operation, modifierZoneKey: 'attribute_flat_add' },
    }],
  };
}

function cooldownEffect(effectKey, name, parameterKey, skillKeys, description, sortOrder = 10) {
  return {
    effectKey,
    name,
    description,
    sortOrder,
    lifecycle: null,
    results: [{
      resultKey: 'cooldown',
      name,
      resultType: 'COOLDOWN_CHANGE',
      target: 'SOURCE',
      description: null,
      sortOrder: 10,
      lifecycleBehavior: null,
      spellShieldBlockScope: null,
      valueRule: valueRule('PARAMETER', parameterKey),
      detail: {
        affectedSkillScope: { mode: 'SKILLS', skillKeys, skillCategoryKeys: [] },
        operation: 'REDUCE',
      },
    }],
  };
}

function sourceRecord(skillKey) {
  const { hero, skill } = sourceSkill(skillKey);
  const client = hero.source.client;
  const officialZh = hero.source.official;
  const officialEnFile = inputVersion.sourceFiles.find(item => item.path === `参考资料/官方英文/${hero.id}.json`);
  const clientFile = inputVersion.sourceFiles.find(item => item.path === `参考资料/客户端原文/${hero.id}.json.gz`);
  const officialZhFile = inputVersion.sourceFiles.find(item => item.path === `参考资料/官方中文/${hero.id}.json`);
  return {
    hero: hero.id,
    heroName: hero.name,
    heroKey: hero.key,
    resourceType: hero.source.resourceType,
    rootPath: hero.rootPath,
    spellPath: skill.binding,
    clientFile: clientFile?.path ?? client.path,
    clientSha256: client.sha256,
    clientCompressedSha256: client.compressedSha256,
    clientBuild: client.contentVersion,
    officialZhFile: officialZhFile?.path ?? officialZh.path,
    officialZhSha256: officialZhFile?.sha256 ?? officialZh.sha256,
    officialEnFile: officialEnFile?.path ?? null,
    officialEnSha256: officialEnFile?.sha256 ?? null,
    currentBoundText: skill.currentTexts,
    rawSpell: skill.rawSpell,
    rawSpellKeys: skill.rawSpellKeys,
    rawObjectKeys: skill.rawObjectKeys,
  };
}

function proof(skillKey, facts, sourceNote) {
  const { skill } = sourceSkill(skillKey);
  return {
    binding: sourceRecord(skillKey),
    currentBoundText: skill.currentTexts,
    sourceFacts: facts,
    sourceNote,
  };
}

function skillEntry(skillKey, write, facts, pending, excluded) {
  const { hero, skill } = sourceSkill(skillKey);
  const snapshot = currentSnapshot.summary?.[skillKey];
  if (!snapshot?.subject) throw new Error(`当前保护快照缺少主体 ${skillKey}`);
  const reusedParameters = reuseList.filter(item => item.skillKey === skillKey);
  return {
    skillKey,
    name: snapshot.subject.name,
    maxLevel: snapshot.subject.maxLevel,
    source: sourceRecord(skillKey),
    write,
    proofs: [proof(skillKey, facts, `固定客户端16.17当前根绑定 ${hero.rootPath} -> ${skill.binding}；仅使用当前正文和当前技能对象的DataValues/计算树。`)],
    pending,
    excluded,
    reusedParameters,
    protectedExisting: true,
    existingSubject: snapshot.subject,
    existingCompositionCounts: Object.fromEntries(Object.entries(snapshot.components ?? {}).map(([key, value]) => [key, value.length])),
    status: '候选待审，未调用业务接口',
  };
}

const sourceSeries = {};
const recordSeries = (skillKey, name, values) => { sourceSeries[`${skillKey}/${name}`] = assertSeries(skillKey, name, values); return values.slice(); };
const sourceTransformations = {};
const recordTransformedSeries = (skillKey, name, sourceValuesExpected, transform, transformDescription) => {
  const raw = assertSeries(skillKey, name, sourceValuesExpected);
  const transformed = raw.map(transform);
  sourceSeries[`${skillKey}/${name}`] = transformed.slice();
  sourceTransformations[`${skillKey}/${name}`] = {
    raw: raw.slice(),
    candidate: transformed.slice(),
    transform: transformDescription,
  };
  return transformed;
};

function buildCandidate() {
  const skills = {};

  const mundoPCurrentLoss = recordSeries('drmundo_p', 'CurrentHealthLoss', [0.04]);
  const mundoPMaxGain = recordSeries('drmundo_p', 'MaxHealthGain', [0.04]);
  skills.drmundo_p = skillEntry('drmundo_p', {
    parameters: [
      p('current_health_loss_ratio', '抵抗定身时当前生命损失比例', 'DECIMAL', 'FIXED', mundoPCurrentLoss[0], '客户端当前根绑定 DataValues.CurrentHealthLoss；正文以 *100 显示百分数，0.04 表示4%；使用来源当前生命输入，不能默认当前生命。', 10),
      p('canister_ground_duration_ms', '化学药剂留存时间（毫秒）', 'INTEGER', 'FIXED', 7000, '客户端当前根绑定 DataValues.CannisterGroundDuration=7秒；单位换算为7000毫秒。', 20),
      p('passive_cooldown_refund_ms', '拾取药剂减少被动冷却（毫秒）', 'INTEGER', 'FIXED', 15000, '客户端当前根绑定 DataValues.PassiveCooldownRefund=15秒；单位换算为15000毫秒。', 30),
      p('max_health_gain_ratio', '拾取药剂最大生命回复比例', 'DECIMAL', 'FIXED', mundoPMaxGain[0], '客户端当前根绑定 DataValues.MaxHealthGain；正文以 *100 显示百分数，0.04表示4%最大生命。', 40),
      p('max_health_regen_interval_ms', '被动生命回复间隔（毫秒）', 'INTEGER', 'FIXED', 5000, '当前正文明确“每5秒回复”；只记录间隔，不创建周期过程。', 50),
      p('passive_cooldown_ms', '被动冷却实际值（毫秒，等级曲线外供）', 'INTEGER', 'RUNTIME_INPUT', null, '当前计算树 PassiveCooldown 的等级1值为60秒，并在3、6、9、12、15、21级各有-9秒断点；求值循环未证，转换为无默认实际毫秒输入，不能线性展开或猜测等级值。', 60),
      p('max_health_regen_ratio', '每5秒最大生命回复比例（等级曲线外供）', 'DECIMAL', 'RUNTIME_INPUT', null, '当前计算树 MaxHealthRegen 的等级断点曲线以百分数显示；求值规则未证，保留无默认比例输入。原始起点约0.004，仅作来源证据，不作为全等级固定值。', 70),
    ],
    formulas: [
      f('health_loss_amount', '抵抗定身当前生命损失量', multiply(param('current_health_loss_ratio'), attr('SOURCE', 'hp', 'CURRENT')), '当前正文 CurrentHealthLoss*100%当前生命值；实际当前生命由属性输入提供。', 10),
      f('max_health_gain_amount', '拾取药剂最大生命回复量', multiply(param('max_health_gain_ratio'), attr('SOURCE', 'hp', 'TOTAL')), '当前正文 MaxHealthGain*100%最大生命值；只建立计算量，不创建直接治疗结果。', 20),
      f('max_health_regen_amount', '每5秒最大生命回复量', multiply(param('max_health_regen_ratio'), attr('SOURCE', 'hp', 'TOTAL')), '当前正文 MaxHealthRegen最大生命值；等级曲线通过无默认比例输入提供，不把曲线端点连成线。', 30),
    ],
    effects: [
      resourceEffect('health_cost', '抵抗定身当前生命损失', { kind: 'FORMULA', key: 'health_loss_amount' }, 'hp', 'CONSUME', '只定义当前生命损失这一非即时资源组成；定身抵抗触发与拾取时点仍待事件接线，不自动扣除。'),
    ],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { CurrentHealthLoss: mundoPCurrentLoss, MaxHealthGain: mundoPMaxGain, CannisterGroundDuration: [7], PassiveCooldownRefund: [15] },
    calculations: ['PassiveCooldown:ByCharLevelBreakpoints(60秒；3/6/9/12/15/21级各-9秒)', 'MaxHealthRegen:ByCharLevelBreakpoints(mLevel1Value约0.004；mInitialBonusPerLevel约0.0005；7/13/16级斜率断点)'],
    units: ['秒→毫秒仅用于明确时间参数', '正文百分数乘100显示，比例参数保留0.04'],
  }, [], [
    { item: '罐子拾取半径、生成距离、最大角度、视觉指示距离', reason: '当前DataValues为几何/显示信息，本轮不建无消费者组成。' },
  ]);
  skills.drmundo_p.pending.push(
    { item: '第一个定身免疫与药剂拾取触发', reason: '正文明确机制，但当前候选范围没有对应状态触发/事件接线；保留来源，不伪造瞬时结果。' },
    { item: '拾取后的4%最大生命回复与被动冷却变化', reason: '数值和计算量已保留；直接治疗结果及冷却触发时点未接线。' },
    { item: 'PassiveCooldown、MaxHealthRegen等级曲线', reason: '只读到断点构造，未证求值循环；实际输入无默认。' },
  );

  const mundoQDamage = recordSeries('drmundo_q', 'CurrentHealthDamage', [0.2, 0.225, 0.25, 0.275, 0.3]);
  const mundoQMin = recordSeries('drmundo_q', 'MinimumDamage', [80, 130, 180, 230, 280]);
  const mundoQCost = recordSeries('drmundo_q', 'HealthCost', [50, 60, 70, 80, 90]);
  const mundoQRefund = recordSeries('drmundo_q', 'HealthRefundOnHitChampionMonsterPercent', [1]);
  const mundoQSlow = recordSeries('drmundo_q', 'SlowAmount', [0.4]);
  skills.drmundo_q = skillEntry('drmundo_q', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', 250, '当前根 spellCastTime=0.25秒；仅保存字段，不表示命中发生在施法结束。', 10),
      p('slow_duration_ms', '减速持续（毫秒）', 'INTEGER', 'FIXED', 2000, '客户端当前根绑定 DataValues.SlowDuration=2秒；单位换算为2000毫秒。', 20),
      p('slow_ratio', '减速比例', 'DECIMAL', 'FIXED', mundoQSlow[0], '客户端当前根绑定 DataValues.SlowAmount；正文为 @SlowAmount*100@%，0.4表示40%减速。', 30),
      p('current_health_damage_ratio', '目标当前生命伤害比例', 'DECIMAL', 'SKILL_LEVEL', mundoQDamage, '客户端当前根绑定 DataValues.CurrentHealthDamage，等级1至5为20%、22.5%、25%、27.5%、30%；正文为 *100 显示。', 40),
      p('minimum_damage', '最低魔法伤害', 'INTEGER', 'SKILL_LEVEL', mundoQMin, '客户端当前根绑定 DataValues.MinimumDamage，等级1至5取索引1至5；用于最终MAX封顶下界。', 50),
      p('health_cost', '生命值消耗', 'INTEGER', 'SKILL_LEVEL', mundoQCost, '客户端当前根绑定 DataValues.HealthCost，等级1至5取索引1至5；正文明确生命值代价。', 60),
      p('health_refund_on_champion_monster_ratio', '命中英雄或野怪生命回复比例', 'DECIMAL', 'FIXED', mundoQRefund[0], '客户端当前根绑定 DataValues.HealthRefundOnHitChampionMonsterPercent=1；只保留命中英雄/野怪这一正文分支的计算参数。', 70),
    ],
    formulas: [
      f('magic_damage', '病毒屠刀首个敌人魔法伤害', max(param('minimum_damage'), multiply(param('current_health_damage_ratio'), attr('TARGET', 'hp', 'CURRENT'))), '当前正文与扩展正文共同确定最终值=MAX(最低伤害, 当前生命比例×目标当前生命)；不使用目标最大生命或默认当前生命。', 10),
      f('health_refund_on_champion_monster', '命中英雄或野怪生命回复量', multiply(param('health_refund_on_champion_monster_ratio'), param('health_cost')), '当前计算树 HealthRestoreOnHitChampionMonster=HealthRefundOnHitChampionMonsterPercent×HealthCost；直接治疗结果留待事件接线。', 20),
    ],
    effects: [
      resourceEffect('health_cost', '病毒屠刀生命值消耗', { kind: 'PARAMETER', key: 'health_cost' }, 'hp', 'CONSUME', '只记录一次施放的生命值代价；实际扣除时点与资源不足处理待事件接线。'),
      attributeEffect('slow', '病毒屠刀目标减速', { kind: 'PARAMETER', key: 'slow_ratio' }, 'move_speed_percent', 'DECREASE', 'slow_duration_ms', 'TARGET', '正文明确对命中的第一个敌人施加40%减速；减速幅度保持正值，使用DECREASE避免负值重复取反。', 20),
    ],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { CurrentHealthDamage: mundoQDamage, MinimumDamage: mundoQMin, HealthCost: mundoQCost, HealthRefundOnHitChampionMonsterPercent: mundoQRefund, SlowAmount: mundoQSlow, SlowDuration: [2] },
    calculations: ['HealthRestoreOnHitChampionMonster=HealthRefundOnHitChampionMonsterPercent×HealthCost', 'HealthRestoreOnHitMinion=HealthRefundOnHitMinionPercent×HealthCost（范围外）'],
    units: ['SlowAmount正文*100，参数保存比例0.4', 'SlowDuration秒→2000毫秒'],
  }, [], [
    { item: 'MaximumMonsterDamage', reason: '扩展正文明确为对野怪的伤害上限，属于兵野专用分支，本轮不写。' },
    { item: 'HealthRefundOnHitMinionPercent及HealthRestoreOnHitMinion', reason: '正文明确非英雄非野怪小兵回复分支，属于兵野专用治疗分支，本轮不写。' },
  ]);
  skills.drmundo_q.pending.push({ item: '命中回复直接治疗及命中事件', reason: '数值公式已保留；禁止创建DIRECT_HEAL或瞬时结果，待事件接线。' });

  const mundoWDamageTick = recordSeries('drmundo_w', 'DamagePerTick', [5, 8.75, 12.5, 16.25, 20]);
  const mundoWRecast = recordSeries('drmundo_w', 'RecastBaseDamage', [20, 35, 50, 65, 80]);
  const mundoWCost = recordSeries('drmundo_w', 'CurrentHealthCost', [0.08]);
  const mundoWStorage = recordSeries('drmundo_w', 'GrayHealthStorage', [0.25]);
  const mundoWInitial = recordSeries('drmundo_w', 'GrayHealthInitialDuration', [0.75]);
  const mundoWBig = recordSeries('drmundo_w', 'GrayHealthBigMod', [1]);
  const mundoWSmall = recordSeries('drmundo_w', 'GrayHealthSmallMod', [0.5]);
  skills.drmundo_w = skillEntry('drmundo_w', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', 0, '当前根 spellCastTime=0；保留整数毫秒字段，不表示过程已经接线。', 10),
      p('duration_ms', '电击疗法持续（毫秒）', 'INTEGER', 'FIXED', 3000, '客户端当前根绑定 DataValues.Duration=3秒；单位换算为3000毫秒。', 20),
      p('current_health_cost_ratio', '当前生命消耗比例', 'DECIMAL', 'FIXED', mundoWCost[0], '客户端当前根绑定 DataValues.CurrentHealthCost；正文为*100%当前生命值，0.08表示8%。', 30),
      p('gray_health_initial_duration_ms', '灰色生命首段储存时长（毫秒）', 'INTEGER', 'FIXED', 750, '客户端当前根绑定 DataValues.GrayHealthInitialDuration=0.75秒；单位换算为750毫秒。', 40),
      p('gray_health_storage_ratio', '灰色生命后续储存比例', 'DECIMAL', 'FIXED', mundoWStorage[0], '客户端当前根绑定 DataValues.GrayHealthStorage=0.25；正文以*100显示25%。', 50),
      p('gray_health_initial_storage_ratio', '灰色生命首段储存比例（等级曲线外供）', 'DECIMAL', 'RUNTIME_INPUT', null, '当前计算树 GrayHealthStorageInitial 为等级插值约0.8至0.95；未证等级求值，不线性猜测，保留无默认比例输入。', 60),
      p('gray_health_hero_restore_ratio', '命中敌方英雄灰色生命回复比例', 'DECIMAL', 'FIXED', mundoWBig[0], '客户端当前根绑定 DataValues.GrayHealthBigMod=1；只记录比例，不创建灰色生命直接回复结果。', 70),
      p('gray_health_nonhero_restore_ratio', '未命中敌方英雄灰色生命回复比例', 'DECIMAL', 'FIXED', mundoWSmall[0], '客户端当前根绑定 DataValues.GrayHealthSmallMod=0.5；条件分支保留来源，灰色生命属性尚无字典。', 80),
      p('second_cast_lockout_ms', '再次施放锁定时间（毫秒）', 'INTEGER', 'FIXED', 500, '客户端当前根绑定 DataValues.SecondCastLockout=0.5秒；单位换算为500毫秒。', 90),
      p('damage_per_tick', '单节拍基础魔法伤害', 'DECIMAL', 'SKILL_LEVEL', mundoWDamageTick, '客户端当前根绑定 DataValues.DamagePerTick，等级1至5取索引1至5；正文明确每秒显示为该值×4，不能据此推定实际事件排程。', 100),
      p('ticks_per_second', '正文每秒倍率', 'INTEGER', 'FIXED', 4, '当前正文明确 @DamagePerTick*4@ 每秒；这是显示计算倍率，保持次数为INTEGER，不表示实际tick数量或时长。', 110),
      p('recast_base_damage', '重施放基础魔法伤害', 'INTEGER', 'SKILL_LEVEL', mundoWRecast, '客户端当前根绑定 DataValues.RecastBaseDamage，等级1至5取索引1至5。', 120),
      p('recast_bonus_health_ratio', '重施放额外生命倍率', 'DECIMAL', 'FIXED', 0.07, '当前W主对象 TotalDamage树为RecastBaseDamage+0.07×来源额外生命；不被旧重施放对象的旧树替代。', 130),
      p('initial_damage_taken', '首段实际承受伤害输入', 'DECIMAL', 'RUNTIME_INPUT', null, '灰色生命首750毫秒存储的实际伤害量；无默认值，独立于后续阶段。', 140),
      p('subsequent_damage_taken', '后续实际承受伤害输入', 'DECIMAL', 'RUNTIME_INPUT', null, '灰色生命首段结束后的实际伤害量；无默认值，不能与首段合并。', 150),
      p('stored_gray_health', '当前已储存灰色生命输入', 'DECIMAL', 'RUNTIME_INPUT', null, '灰色生命资源尚未进入属性字典；恢复量公式只接受外供实际灰色生命，不能用普通生命或缺失生命代替。', 160),
    ],
    formulas: [
      f('health_cost', '电击疗法当前生命消耗量', multiply(param('current_health_cost_ratio'), attr('SOURCE', 'hp', 'CURRENT')), '当前正文为CurrentHealthCost*100%当前生命值；当前生命由属性输入提供。', 10),
      f('damage_per_second', '电击疗法每秒魔法伤害显示量', multiply(param('damage_per_tick'), param('ticks_per_second')), '当前正文明确DamagePerTick×4每秒；仅保存显示量，不宣称每秒事件、节拍间隔或实际命中次数。', 20),
      f('initial_gray_health_storage', '首750毫秒灰色生命储存量', multiply(param('gray_health_initial_storage_ratio'), param('initial_damage_taken')), '首段储存=首段实际承受伤害×首段比例；首段比例和伤害都无默认输入。', 30),
      f('subsequent_gray_health_storage', '后续灰色生命储存量', multiply(param('gray_health_storage_ratio'), param('subsequent_damage_taken')), '后续储存=后续实际承受伤害×25%；与首段输入分开。', 40),
      f('hero_gray_health_restore_amount', '命中敌方英雄灰色生命回复量', multiply(param('gray_health_hero_restore_ratio'), param('stored_gray_health')), '命中敌方英雄时按100%已储存灰色生命计算；灰色生命属性缺失，保留外供输入，不创建直接回复结果。', 50),
      f('nonhero_gray_health_restore_amount', '未命中敌方英雄灰色生命回复量', multiply(param('gray_health_nonhero_restore_ratio'), param('stored_gray_health')), '未命中敌方英雄时按50%已储存灰色生命计算；不把该分支误写成普通生命回复。', 60),
      f('recast_magic_damage', '电击疗法重施放魔法伤害', add(param('recast_base_damage'), multiply(param('recast_bonus_health_ratio'), attr('SOURCE', 'hp', 'BONUS'))), '当前W主对象TotalDamage=RecastBaseDamage+0.07×来源额外生命；不使用旧额外对象的旧FlatHeal/总AD树替代。', 70),
    ],
    effects: [
      resourceEffect('health_cost', '电击疗法当前生命消耗', { kind: 'FORMULA', key: 'health_cost' }, 'hp', 'CONSUME', '只定义当前生命消耗；实际施放和资源不足处理待事件接线。'),
    ],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { Duration: [3], CurrentHealthCost: mundoWCost, GrayHealthStorage: mundoWStorage, GrayHealthInitialDuration: mundoWInitial, GrayHealthBigMod: mundoWBig, GrayHealthSmallMod: mundoWSmall, DamagePerTick: mundoWDamageTick, RecastBaseDamage: mundoWRecast, SecondCastLockout: [0.5] },
    calculations: ['TotalDamage=RecastBaseDamage+StatByCoefficient(mStat12,mStatFormula2,mCoefficient0.07)', 'GrayHealthStorageInitial=ByCharLevelInterpolation(约0.8→0.95)，mDisplayAsPercent=true'],
    units: ['Duration/GrayHealthInitialDuration/SecondCastLockout秒→毫秒', 'DamagePerTick正文*4为每秒显示倍率'],
  }, [], []);
  skills.drmundo_w.pending.push(
    { item: '灰色生命资源结果', reason: '当前属性目录没有gray_hp；四个灰色生命公式保留外供输入，不伪装为hp RESOURCE_CHANGE。' },
    { item: 'W持续伤害和重施放命中事件', reason: '数值公式已保留；禁止创建DAMAGE或周期过程，等待事件接线。' },
    { item: '旧重施放额外对象', reason: '独立审计提示旧对象含旧FlatHeal/总AD树；本候选以当前W主对象.07额外生命重施放树为准，旧对象只作来源待核。' },
  );
  skills.drmundo_w.excluded.push({ item: 'SecondCastRange', reason: '当前DataValues为范围/几何信息，本轮不建无消费者组成。' });

  const mundoEFlatCost = recordSeries('drmundo_e', 'FlatHealthCost', [10, 25, 40, 55, 70]);
  const mundoEBaseDamage = recordSeries('drmundo_e', 'BaseDamage', [5, 15, 25, 35, 45]);
  const mundoEHealthToAD = recordSeries('drmundo_e', 'HealthToADRatio', [2, 2.3, 2.6, 2.9, 3.2]);
  const mundoEBonusHp = recordSeries('drmundo_e', 'BonusHealthRatio', [0.05]);
  const mundoEMissingThreshold = recordSeries('drmundo_e', 'MaxMissingHealthThreshold', [0.7]);
  const mundoEMaxAmp = recordSeries('drmundo_e', 'MaxDamageAmp', [1.4]);
  skills.drmundo_e = skillEntry('drmundo_e', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', 1000, '当前根spellCastTime=1秒且mCastTime=1秒；两字段一致，单位换算为1000毫秒。', 10),
      p('attack_override_duration_ms', '强化攻击窗口（毫秒）', 'INTEGER', 'FIXED', 4000, '客户端当前根绑定 DataValues.AttackOverrideDuration=4秒；只记录下次攻击窗口。', 20),
      p('flat_health_cost', '生命值消耗', 'INTEGER', 'SKILL_LEVEL', mundoEFlatCost, '客户端当前根绑定 DataValues.FlatHealthCost，等级1至5取索引1至5；保留正值生命代价。', 30),
      p('base_damage', '额外物理伤害基础值', 'INTEGER', 'SKILL_LEVEL', mundoEBaseDamage, '客户端当前根绑定 DataValues.BaseDamage，等级1至5取索引1至5。', 40),
      p('bonus_health_ratio', '额外生命倍率', 'DECIMAL', 'FIXED', mundoEBonusHp[0], '客户端当前根绑定 DataValues.BonusHealthRatio=0.05；当前AdditionalDamage树使用来源额外生命。', 50),
      p('max_missing_health_threshold_ratio', '达到最高增幅的已损失生命阈值', 'DECIMAL', 'FIXED', mundoEMissingThreshold[0], '客户端扩展正文明确70%已损失生命阈值；当前主计算树未给出中间曲线，不用此值猜测增幅过程。', 60),
      p('max_damage_amp', '最高伤害倍率端点', 'DECIMAL', 'FIXED', mundoEMaxAmp[0], '客户端当前根绑定 DataValues.MaxDamageAmp=1.4；这是最高端点，不是当前伤害倍率默认值。', 70),
      p('health_to_ad_ratio', '最大生命转攻击力倍率', 'DECIMAL', 'SKILL_LEVEL', mundoEHealthToAD, '客户端当前根绑定 DataValues.HealthToADRatio，等级1至5取索引1至5；当前PassiveBonusAD树另有0.01乘数。', 80),
      p('unity', '单位倍率1', 'INTEGER', 'FIXED', 1, '用于复刻MaxDamageAmpTooltip树中的减1操作；不是伤害倍率默认值。', 90),
    ],
    formulas: [
      f('additional_physical_damage', '大力行医强化攻击额外物理伤害', add(param('base_damage'), multiply(param('bonus_health_ratio'), attr('SOURCE', 'hp', 'BONUS'))), '当前AdditionalDamage树=BaseDamage+0.05×来源额外生命；已损失生命提升的中间过程仅由正文端点描述，未并入此基础组成。', 10),
      f('passive_bonus_attack_damage', '大力行医被动额外攻击力', multiply(multiply(param('health_to_ad_ratio'), param('health_to_ad_scale')), attr('SOURCE', 'hp', 'TOTAL')), '当前PassiveBonusAD树为0.01×HealthToADRatio×来源总生命；保留实际根乘数，不把总生命和额外生命混淆。', 20),
      f('maximum_damage_amplification_bonus_ratio', '最高伤害增幅比例端点', subtract(param('max_damage_amp'), param('unity')), '当前MaxDamageAmpTooltip树=MaxDamageAmp+Number(-1)，1.4端点转换为0.4增幅；不表示当前攻击默认乘1.4。', 30),
    ],
    effects: [
      resourceEffect('health_cost', '大力行医生命值消耗', { kind: 'PARAMETER', key: 'flat_health_cost' }, 'hp', 'CONSUME', '只定义主动生命值代价；实际施放与下次攻击事件待接线。'),
      attributeEffect('passive_bonus_attack_damage', '大力行医被动额外攻击力', { kind: 'FORMULA', key: 'passive_bonus_attack_damage' }, 'attack_damage', 'INCREASE', null, 'SOURCE', '独立定义当前根被动额外攻击力；不创建自动初始化或触发，应用时读取公式。', 20, true),
    ],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { FlatHealthCost: mundoEFlatCost, BaseDamage: mundoEBaseDamage, BonusHealthRatio: mundoEBonusHp, MaxMissingHealthThreshold: mundoEMissingThreshold, MaxDamageAmp: mundoEMaxAmp, HealthToADRatio: mundoEHealthToAD, AttackOverrideDuration: [4] },
    calculations: ['AdditionalDamage=BaseDamage+StatByNamedDataValue(mStat12,mStatFormula2,BonusHealthRatio)', 'MaxDamageAmpTooltip=MaxDamageAmp+Number(-1)', 'PassiveBonusAD=Number(0.01)×StatByNamedDataValue(mStat12,HealthToADRatio)'],
    units: ['spellCastTime/mCastTime秒→1000毫秒', 'MaxDamageAmp最高端点1.4，tooltip树输出增幅0.4'],
  }, [], [
    { item: 'MinionMod、MonsterMod', reason: '当前扩展正文明确小兵/野怪专用伤害修正，本轮唯一敌人范围不写。' },
    { item: 'MissileDistance', reason: '当前DataValues为距离/几何信息，本轮不建无消费者组成。' },
    { item: '击杀目标后的拍飞与途经敌人伤害', reason: '当前正文要求击杀后多目标路径分支，超出唯一敌人单目标范围。' },
  ]);
  skills.drmundo_e.pending.push(
    { item: '已损失生命到MaxDamageAmp的中间曲线', reason: '当前只证70%阈值和1.4端点，不能线性展开；保留阈值和端点，未制造中间公式。' },
    { item: '强化攻击事件', reason: '基础额外伤害公式和4000毫秒窗口已保留；禁止创建DAMAGE/自动触发。' },
  );
  skills.drmundo_e.write.parameters.push(p('health_to_ad_scale', '生命转攻击力根乘数', 'DECIMAL', 'FIXED', 0.01, '当前PassiveBonusAD计算树直接给出Number(0.01)；与HealthToADRatio相乘。', 85));

  const mundoRSpeed = recordSeries('drmundo_r', 'SpeedBoostAmount', [0.15, 0.25, 0.35]);
  const mundoRMissingHeal = recordSeries('drmundo_r', 'MissingHealthHeal', [0.15, 0.2, 0.25]);
  const mundoRHot = recordSeries('drmundo_r', 'MaxHealthHoT', [0.2, 0.4, 0.6]);
  const mundoRBonus = recordSeries('drmundo_r', 'BonusPerNearbyChampion', [0.05]);
  skills.drmundo_r = skillEntry('drmundo_r', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', 250, '当前根spellCastTime=0.25秒；仅保存字段，不表示治疗发生在施法结束。', 10),
      p('duration_ms', '极限剂量持续（毫秒）', 'INTEGER', 'FIXED', 10000, '客户端当前根绑定 DataValues.Duration=10秒；单位换算为10000毫秒。', 20),
      p('speed_boost_ratio', '移动速度增加比例', 'DECIMAL', 'SKILL_LEVEL', mundoRSpeed, '客户端当前根绑定 DataValues.SpeedBoostAmount，等级1至3取索引1至3；正文以*100显示。', 30),
      p('missing_health_heal_ratio', '已损失生命治疗比例', 'DECIMAL', 'SKILL_LEVEL', mundoRMissingHeal, '客户端当前根绑定 DataValues.MissingHealthHeal，等级1至3取索引1至3；按施放前实际已损失生命计算。', 40),
      p('max_health_hot_ratio', '最大生命持续治疗比例', 'DECIMAL', 'SKILL_LEVEL', mundoRHot, '客户端当前根绑定 DataValues.MaxHealthHoT，等级1至3取索引1至3；按施放前最大生命计算总量。', 50),
      p('bonus_per_nearby_champion_ratio', '三级附近敌方英雄治疗增幅', 'DECIMAL', 'FIXED', mundoRBonus[0], '客户端当前根绑定 DataValues.BonusPerNearbyChampion=0.05；当前正文仅在3级说明附近每个敌方英雄额外增幅。', 60),
      p('nearby_enemy_champion_count', '合资格附近敌方英雄数', 'INTEGER', 'RUNTIME_INPUT', null, '本轮1v1最多外供0或1；R等级1/2必须外供0，R等级3才可外供附近敌方英雄实际数量；不默认存在敌人。', 70),
      p('takedown_duration_extension_ms', '参与击杀延长持续（毫秒）', 'INTEGER', 'FIXED', 2000, '客户端当前根绑定 DataValues.TakedownDurationExtension=2秒；当前根正文/计算树没有已接消费者，保留数值待补。', 80),
      p('unity', '单位倍率1', 'INTEGER', 'FIXED', 1, '用于附近英雄治疗倍率的加法基准。', 90),
    ],
    formulas: [
      f('nearby_champion_heal_multiplier', '三级附近英雄治疗倍率', add(param('unity'), multiply(param('bonus_per_nearby_champion_ratio'), param('nearby_enemy_champion_count'))), '仅在R等级3且附近敌方英雄数由外部资格输入提供时使用；等级1/2应输入0。', 10),
      f('missing_health_heal_amount', '极限剂量已损失生命治疗量', multiply(multiply(param('missing_health_heal_ratio'), attr('SOURCE', 'hp', 'MISSING')), add(param('unity'), multiply(param('bonus_per_nearby_champion_ratio'), param('nearby_enemy_champion_count')))), '治疗基数为施放前已损失生命；附近英雄增幅作为独立倍率，新增最大生命不会反馈到本次基数。', 20),
      f('max_health_hot_total_amount', '极限剂量最大生命持续治疗总量', multiply(multiply(param('max_health_hot_ratio'), attr('SOURCE', 'hp', 'TOTAL')), add(param('unity'), multiply(param('bonus_per_nearby_champion_ratio'), param('nearby_enemy_champion_count')))), '治疗基数为施放前最大生命；持续总量与已损失生命治疗分开，新增最大生命不会反馈到本次基数。', 30),
    ],
    effects: [
      attributeEffect('speed_boost', '极限剂量自身移动速度', { kind: 'PARAMETER', key: 'speed_boost_ratio' }, 'move_speed_percent', 'INCREASE', 'duration_ms', 'SOURCE', '正文明确自身获得持续10秒移动速度；只定义持续属性效果，施放触发待接线。'),
    ],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { Duration: [10], SpeedBoostAmount: mundoRSpeed, MissingHealthHeal: mundoRMissingHeal, MaxHealthHoT: mundoRHot, BonusPerNearbyChampion: mundoRBonus, TakedownDurationExtension: [2] },
    calculations: ['当前根没有mSpellCalculations；治疗比例与附近英雄倍率直接来自DataValues/正文。'],
    units: ['Duration/TakedownDurationExtension秒→毫秒', '正文比例*100显示，参数保留比例'],
  }, [], []);
  skills.drmundo_r.pending.push(
    { item: '最大生命增益的属性结果与应用顺序', reason: '正文明确获得相当于已损失生命的最大生命，但当前没有max_hp属性和应用顺序；只按施放前阶段计算两项治疗，不制造HP自动反馈。' },
    { item: '两项治疗的直接结果与周期过程', reason: '计算量已保留；禁止DIRECT_HEAL/MOMENT结果，等待事件接线。' },
    { item: '三级附近敌方英雄资格与击杀延长消费者', reason: '资格由无默认输入提供；TakedownDurationExtension当前无消费者。' },
  );

  const tryndP = [0.5];
  skills.tryndamere_p = skillEntry('tryndamere_p', {
    parameters: [
      p('attack_fury_gain', '普通攻击获得怒气', 'INTEGER', 'FIXED', 5, '当前根绑定正文明确普通攻击获得5怒气；怒气资源尚无属性字典，不建立资源结果。', 10),
      p('critical_attack_fury_gain', '暴击攻击获得怒气', 'INTEGER', 'FIXED', 10, '当前根绑定正文明确暴击攻击获得10怒气；仅记录来源值。', 20),
      p('kill_unit_fury_gain', '击杀单位获得怒气', 'INTEGER', 'FIXED', 10, '当前根绑定正文明确击杀单位获得10怒气；仅记录来源值。', 30),
      p('out_of_combat_delay_ms', '脱战后怒气衰减等待（毫秒）', 'INTEGER', 'FIXED', 8000, '当前根绑定正文明确脱战8秒后开始衰减；单位换算为8000毫秒。', 40),
      p('fury_decay_per_second', '每秒怒气衰减', 'INTEGER', 'FIXED', 5, '当前根绑定正文明确每秒损失5怒气；保持次数/资源点数为INTEGER。', 50),
      p('crit_chance_per_fury_ratio', '每点怒气暴击几率比例', 'DECIMAL', 'FIXED', tryndP[0] / 100, '当前计算树给Number(0.5)，正文以@PassiveCritConversionTooltip@%显示；0.5百分数点换算为比例0.005。', 60),
      p('current_fury', '实际怒气输入', 'INTEGER', 'RUNTIME_INPUT', null, '实际怒气由运行时提供且无默认值；不依据arIncrements把满怒固定为100。', 70),
    ],
    formulas: [
      f('crit_chance_from_fury', '怒气提供的暴击几率', multiply(param('crit_chance_per_fury_ratio'), param('current_fury')), '每点怒气提供0.5百分数点暴击几率，换算为0.005比例后乘实际怒气；不默认满怒。', 10),
    ],
    effects: [], processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { PassiveCritConversionTooltip: tryndP, FuryGain: [5, 10, 10], FuryDecay: [5], OutOfCombatDelay: [8] },
    calculations: ['PassiveCritConversionTooltip=Number(0.5)，mPrecision=1；正文末尾带百分号。'],
    units: ['0.5百分数点→0.005比例', '脱战8秒→8000毫秒'],
  }, [], [
    { item: 'CherryFuryModifier', reason: '客户端DataValuesModeOverride专属模式修正，不属于本轮标准召唤峡谷正文。' },
  ]);
  skills.tryndamere_p.pending.push(
    { item: '怒气资源变化与动态暴击属性应用', reason: '当前属性目录没有fury；只保留无默认实际怒气输入和数学公式，不把怒气伪装成mana或自动更新暴击。' },
    { item: '怒气上限', reason: '角色根记录存在arType/arIncrements，但本轮未证arIncrements为上限，不固定100。' },
  );

  const tryndQBase = recordSeries('tryndamere_q', 'BaseHealing', [30, 40, 50, 60, 70]);
  const tryndQPerFury = recordSeries('tryndamere_q', 'BonusHealPerFury', [0.5, 0.95, 1.4, 1.85, 2.3]);
  const tryndQAP = recordSeries('tryndamere_q', 'APRatio', [0.3]);
  const tryndQAPFury = recordSeries('tryndamere_q', 'APRatioPerFury', [0.012]);
  const tryndQMaxAD = recordSeries('tryndamere_q', 'MaximumBonusAD', [20, 35, 50, 65, 80]);
  const tryndQThreshold = recordSeries('tryndamere_q', 'RemainingHealthThreshold', [0.1]);
  skills.tryndamere_q = skillEntry('tryndamere_q', {
    parameters: [
      p('base_healing', '基础治疗', 'INTEGER', 'SKILL_LEVEL', tryndQBase, '客户端当前根绑定 DataValues.BaseHealing，等级1至5取索引1至5。', 10),
      p('bonus_heal_per_fury', '每点怒气额外治疗', 'DECIMAL', 'SKILL_LEVEL', tryndQPerFury, '客户端当前根绑定 DataValues.BonusHealPerFury，等级1至5取索引1至5；实际治疗按外供怒气。', 20),
      p('ap_ratio', '基础治疗法强倍率', 'DECIMAL', 'FIXED', tryndQAP[0], '客户端当前根绑定 DataValues.APRatio；当前BaseHeal树省略统计选择器，按同版窄证mStat0=法强。', 30),
      p('ap_ratio_per_fury', '每点怒气治疗法强倍率', 'DECIMAL', 'FIXED', tryndQAPFury[0], '客户端当前根绑定 DataValues.APRatioPerFury；当前HealPerFury树省略统计选择器，按同版窄证mStat0=法强。', 40),
      p('maximum_bonus_attack_damage', '最高额外攻击力', 'INTEGER', 'SKILL_LEVEL', tryndQMaxAD, '客户端当前根绑定 DataValues.MaximumBonusAD，等级1至5取索引1至5；只记录最高端点。', 50),
      p('remaining_health_threshold_ratio', '达到最高额外攻击力的剩余生命比例', 'DECIMAL', 'FIXED', tryndQThreshold[0], '客户端当前根绑定 DataValues.RemainingHealthThreshold=0.1；中间已损失生命曲线未证，不线性展开。', 60),
      p('actual_fury_consumed', '本次实际消耗怒气', 'INTEGER', 'RUNTIME_INPUT', null, 'Q主动实际消耗怒气由运行时提供且无默认值；不把MaximumHeal树的资源节点擅自映射为满怒。', 70),
    ],
    formulas: [
      f('base_heal', '嗜血杀戮基础治疗量', add(param('base_healing'), multiply(param('ap_ratio'), attr('SOURCE', 'ability_power', 'TOTAL'))), '当前BaseHeal树=BaseHealing+APRatio×来源总法强；不创建直接治疗结果。', 10),
      f('heal_per_fury', '嗜血杀戮每怒气治疗量', add(param('bonus_heal_per_fury'), multiply(param('ap_ratio_per_fury'), attr('SOURCE', 'ability_power', 'TOTAL'))), '当前HealPerFury树=BonusHealPerFury+APRatioPerFury×来源总法强。', 20),
      f('active_heal_amount', '嗜血杀戮按实际怒气治疗量', add(add(param('base_healing'), multiply(param('ap_ratio'), attr('SOURCE', 'ability_power', 'TOTAL'))), multiply(add(param('bonus_heal_per_fury'), multiply(param('ap_ratio_per_fury'), attr('SOURCE', 'ability_power', 'TOTAL'))), param('actual_fury_consumed'))), '主动治疗=基础治疗项+实际消耗怒气×每怒气治疗项；实际怒气无默认，禁止用满怒替代。', 30),
    ],
    effects: [], processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { BaseHealing: tryndQBase, BonusHealPerFury: tryndQPerFury, APRatio: tryndQAP, APRatioPerFury: tryndQAPFury, MaximumBonusAD: tryndQMaxAD, RemainingHealthThreshold: tryndQThreshold },
    calculations: ['BaseHeal=BaseHealing+APRatio', 'HealPerFury=BonusHealPerFury+APRatioPerFury', 'MaximumHeal=BaseHealing+APRatio+AbilityResourceByCoefficient(mCoefficient1,mAbilityResource4)×(BonusHealPerFury+APRatioPerFury)'],
    units: ['APRatio/文字无百分号按比例使用', '怒气和治疗次数为INTEGER输入/DECIMAL结果'],
  }, [], []);
  skills.tryndamere_q.pending.push(
    { item: 'MaximumHeal资源节点', reason: '当前树引用mAbilityResource4但未证资源上限与运行映射；保留实际怒气治疗公式，不创建满怒默认或MaximumHeal公式。' },
    { item: '基于已损失生命的额外攻击力中间曲线', reason: '仅证最高值和10%剩余生命阈值，不能猜中间曲线；不制造自动攻击力结果。' },
    { item: '怒气消耗与直接治疗事件', reason: '当前属性目录没有fury且禁止DIRECT_HEAL；保留参数/公式等待事件接线。' },
  );

  const tryndWAd = recordTransformedSeries('tryndamere_w', 'ADReduction', [-20, -35, -50, -65, -80], value => -value, '原始负值取相反数后作为正的DECREASE幅度');
  const tryndWSlow = recordTransformedSeries('tryndamere_w', 'SlowPotency', [-0.3, -0.35, -0.4, -0.45, -0.5], value => -value, '原始负值取相反数后作为正的DECREASE比例');
  skills.tryndamere_w = skillEntry('tryndamere_w', {
    parameters: [
      p('cast_time_ms', '施法时间（毫秒）', 'INTEGER', 'FIXED', 250, '当前根spellCastTime=0.25秒；单位换算为250毫秒。', 10),
      p('attack_damage_reduction', '目标攻击力降低值', 'INTEGER', 'SKILL_LEVEL', tryndWAd, '客户端原始ADReduction为-20至-80，当前正文使用ADReduction*-1显示；候选保存正的20至80并使用DECREASE，避免双重负号。', 20),
      p('slow_ratio', '背对目标减速比例', 'DECIMAL', 'SKILL_LEVEL', tryndWSlow, '客户端原始SlowPotency为-0.3至-0.5，当前正文使用SlowPotency*-100显示；候选保存正的0.3至0.5并使用DECREASE。', 30),
      p('reduction_duration_ms', '攻击力降低持续（毫秒）', 'INTEGER', 'FIXED', 4000, '客户端当前根绑定 DataValues.ReductionDuration=4秒；单位换算为4000毫秒。', 40),
      p('slow_duration_ms', '背对减速持续（毫秒）', 'INTEGER', 'FIXED', 3250, '客户端当前根绑定 DataValues.SlowDuration=3.25秒；单位换算为3250毫秒。', 50),
    ],
    formulas: [],
    effects: [
      attributeEffect('attack_damage_reduction', '蔑视目标攻击力降低', { kind: 'PARAMETER', key: 'attack_damage_reduction' }, 'attack_damage', 'DECREASE', 'reduction_duration_ms', 'TARGET', '正文明确附近敌方英雄降低攻击力；候选幅度为正值，操作为DECREASE。'),
      attributeEffect('flee_slow', '蔑视背对目标减速', { kind: 'PARAMETER', key: 'slow_ratio' }, 'move_speed_percent', 'DECREASE', 'slow_duration_ms', 'TARGET', '正文明确仅对逃离泰达米尔的敌人减速；背对资格由事件条件提供，幅度为正值，操作为DECREASE。', 20),
    ],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { ADReduction: [-20, -35, -50, -65, -80], SlowPotency: [-0.3, -0.35, -0.4, -0.45, -0.5], ReductionDuration: [4], SlowDuration: [3.25] },
    calculations: ['当前无mSpellCalculations；Tooltip列表对ADReduction使用-1，对SlowPotency使用-100。'],
    units: ['原始负修正转换为正幅度后再DECREASE，禁止再次取负', '3.25秒→3250毫秒'],
  }, [], []);
  skills.tryndamere_w.pending.push({ item: '背对/逃离条件', reason: '效果主体和数值已定义；目标朝向条件未接入事件，不能自动施加。' });

  const tryndEDamage = recordSeries('tryndamere_e', 'Damage', [80, 120, 160, 200, 240]);
  const tryndEAD = recordSeries('tryndamere_e', 'ADRatio', [1]);
  const tryndEAP = recordSeries('tryndamere_e', 'APRatio', [0.8]);
  const tryndEChampCD = recordSeries('tryndamere_e', 'ChampCDRefund', [1.5]);
  const tryndEChampFury = recordSeries('tryndamere_e', 'ChampFuryGain', [5]);
  skills.tryndamere_e = skillEntry('tryndamere_e', {
    parameters: [
      p('damage_base', '旋风斩基础物理伤害', 'INTEGER', 'SKILL_LEVEL', tryndEDamage, '客户端当前根绑定 DataValues.Damage，等级1至5取索引1至5。', 10),
      p('ad_ratio', '旋风斩额外攻击力倍率', 'DECIMAL', 'FIXED', tryndEAD[0], '客户端当前根绑定 DataValues.ADRatio=1；当前TotalDamage树mStat2/mStatFormula2按同版窄证为来源额外攻击力。', 20),
      p('ap_ratio', '旋风斩法强倍率', 'DECIMAL', 'FIXED', tryndEAP[0], '客户端当前根绑定 DataValues.APRatio=0.8；省略统计选择器按同版窄证mStat0=来源总法强。', 30),
      p('champion_crit_cooldown_refund_ms', '对英雄暴击减少冷却（毫秒）', 'INTEGER', 'FIXED', 1500, '客户端当前根绑定 DataValues.ChampCDRefund=1.5秒；仅保留对英雄暴击分支，单位换算为1500毫秒。', 40),
      p('champion_fury_gain', '命中敌方英雄获得怒气', 'INTEGER', 'FIXED', tryndEChampFury[0], '客户端当前根绑定 DataValues.ChampFuryGain=5；怒气资源未进入属性字典，保留参数不创建资源结果。', 50),
    ],
    formulas: [
      f('physical_damage', '旋风斩物理伤害', add(add(param('damage_base'), multiply(param('ad_ratio'), attr('SOURCE', 'attack_damage', 'BONUS'))), multiply(param('ap_ratio'), attr('SOURCE', 'ability_power', 'TOTAL'))), '当前TotalDamage树=Damage+1×来源额外攻击力+0.8×来源总法强；只保留数值公式，不创建DAMAGE结果。', 10),
    ],
    effects: [
      cooldownEffect('champion_crit_cooldown_refund', '对英雄暴击缩短旋风斩冷却', 'champion_crit_cooldown_refund_ms', ['tryndamere_e'], '正文明确对英雄暴击缩短旋风斩冷却；效果只定义数值和技能范围，暴击事件待接线。'),
    ],
    processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { Damage: tryndEDamage, ADRatio: tryndEAD, APRatio: tryndEAP, ChampCDRefund: tryndEChampCD, ChampFuryGain: tryndEChampFury },
    calculations: ['TotalDamage=Damage+StatByNamedDataValue(mStat2,mStatFormula2,ADRatio)+StatByNamedDataValue(APRatio)'],
    units: ['ChampCDRefund秒→1500毫秒', 'mStat2/2按同版窄证为额外攻击力，mStat0按同版窄证为法强'],
  }, [], [
    { item: 'NonChampCDRefund、NonChampFuryGain', reason: '当前来源为普通非英雄命中/暴击分支；本轮唯一敌方英雄范围不混入该支路。' },
    { item: 'DamageAoE', reason: '当前DataValues为伤害范围/几何信息，本轮不建无消费者组成。' },
  ]);
  skills.tryndamere_e.pending.push(
    { item: '命中英雄获得怒气', reason: '数值参数保留；当前属性目录没有fury，不伪装成mana RESOURCE_CHANGE。' },
    { item: '旋风斩物理伤害事件与英雄暴击条件', reason: '公式和冷却减少效果已保留；DAMAGE结果和触发规则待事件接线。' },
  );

  const tryndRDuration = recordSeries('tryndamere_r', 'TryndRDuration', [5]);
  const tryndRMinHealth = recordSeries('tryndamere_r', 'TryndRMinHealth', [30, 50, 70]);
  const tryndRFury = recordSeries('tryndamere_r', 'TryndRFuryGain', [50, 75, 100]);
  skills.tryndamere_r = skillEntry('tryndamere_r', {
    parameters: [
      p('duration_ms', '无尽怒火持续（毫秒）', 'INTEGER', 'FIXED', 5000, '客户端当前根绑定 DataValues.TryndRDuration=5秒；单位换算为5000毫秒。', 10),
      p('minimum_health', '生命下限', 'INTEGER', 'SKILL_LEVEL', tryndRMinHealth, '客户端当前根绑定 DataValues.TryndRMinHealth，等级1至3取索引1至3；只记录明确生命下限。', 20),
      p('fury_gain', '立即获得怒气', 'INTEGER', 'SKILL_LEVEL', tryndRFury, '客户端当前根绑定 DataValues.TryndRFuryGain，等级1至3取索引1至3；怒气资源未进入属性字典。', 30),
    ],
    formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [],
  }, {
    dataValues: { TryndRDuration: tryndRDuration, TryndRMinHealth: tryndRMinHealth, TryndRFuryGain: tryndRFury },
    calculations: ['当前根无mSpellCalculations；mEffectAmount重复部分不替代DataValues，候选按当前正文DataValues取值。'],
    units: ['TryndRDuration秒→5000毫秒', '生命下限和怒气为INTEGER点数'],
  }, [], []);
  skills.tryndamere_r.pending.push(
    { item: '死亡免疫/不死规则', reason: '当前正文明确死亡完全免疫，但本轮没有只针对致死的成熟事件结果类型；保留持续时间和生命下限，不因名称排除，也不伪成全伤害免疫。' },
    { item: '生命下限应用与怒气资源变化', reason: '明确数值已保留；应用时点、资源资格和事件接线未证，不创建HEALTH_FLOOR或RESOURCE_CHANGE。' },
    { item: '被限制时施放', reason: '当前扩展正文明确可在被限制时施放；不新增布尔参数或触发规则。' },
  );

  const counts = { parameters: 0, formulas: 0, effects: 0, processes: 0, internalStates: 0, triggerRules: 0 };
  for (const skillKey of order) for (const kind of Object.keys(counts)) counts[kind] += skills[skillKey].write[kind].length;
  if (counts.parameters !== 76 || counts.formulas !== 23 || counts.effects !== 10) throw new Error(`候选计数异常 ${JSON.stringify(counts)}`);

  const copiedSnapshotSha256 = sha256File(path.join(inputDir, '参考资料', '当前10槽保护快照.json'));
  const candidate = {
    meta: {
      generatedAt: new Date().toISOString(),
      batch: '英雄机制第二十五批',
      status: '候选待主负责人审查，未调用业务接口',
      gameId: 'lol',
      apiBase: 'http://127.0.0.1:8080/api/admin/games/lol',
      sourceVersion: { clientVersion: '16.17', officialVersion: '16.17.1', build: '16.17.8104348+branch.releases-16-17.content.release' },
      scope: '蒙多医生、泰达米尔10个技能槽；只新增来源明确参数、二元公式和成熟非即时/自身效果；不写主体、分类、关系、图片、公共参数，不建DAMAGE/DIRECT_HEAL/MOMENT结果。',
      sourcePolicy: '固定客户端16.17与官方16.17.1；沿当前角色根绑定正文和计算树，不换新版；未知等级曲线和运行输入不猜、不设默认。',
      inputPackage: '输入包/',
      sourceExtraction: '源值解析-初稿.json',
      currentSnapshot: '输入包/参考资料/当前10槽保护快照.json',
      currentSnapshotSha256: copiedSnapshotSha256,
      businessWrites: 0,
      apiCalls: 0,
      tokenStored: false,
      candidateSha256: null,
    },
    skills,
    order,
    reusedPublicParameters: reuseList.map(item => ({ ...item, source: '输入包/参考资料/公共参数复用清单.json', post: false })),
    reusedExistingParameters: reuseList.map(item => ({ ...item, post: false })),
    counts,
    apiWrites: 0,
    sourceFiles: inputVersion.sourceFiles,
    protectedObjects: {
      subjects: order.map(skillKey => ({ skillKey, source: '输入包/参考资料/当前10槽保护快照.json' })),
      currentCompositionLists: order.flatMap(skillKey => Object.keys(endpointByKind).map(kind => ({ skillKey, kind }))),
      reusedPublicParameters: reuseList,
    },
    revision: 'hero25-source-v1-candidate',
  };

  const sourceValues = {
    generatedAt: candidate.meta.generatedAt,
    status: '独立源值摘要，未调用业务接口',
    sourceVersion: source.sourceVersion,
    sourcePackage: '输入包/',
    sourceSeries,
    sourceTransformations,
    skills: Object.fromEntries(order.map(skillKey => {
      const { skill } = sourceSkill(skillKey);
      return [skillKey, {
        binding: skill.binding,
        currentBoundText: skill.currentTexts,
        dataValues: Object.fromEntries((skill.rawSpell.DataValues ?? []).map(row => [row.name, row.values])),
        calculations: skill.rawSpell.mSpellCalculations ?? {},
        candidateFormulaKeys: skills[skillKey].write.formulas.map(row => row.formulaKey),
        candidateParameterKeys: skills[skillKey].write.parameters.map(row => row.parameterKey),
        pending: skills[skillKey].pending,
        excluded: skills[skillKey].excluded,
      }];
    })),
    noWrites: true,
  };

  const sourceManifest = buildSourceManifest();
  fs.mkdirSync(here, { recursive: true });
  fs.mkdirSync(batchDir, { recursive: true });
  writeJson(path.join(here, '完整候选.json'), candidate);
  writeJson(path.join(here, '独立源值与算例.json'), sourceValues);
  writeJson(path.join(here, '来源哈希汇总.json'), sourceManifest);
  const candidateSha256 = sha256File(path.join(here, '完整候选.json'));
  const sourceValuesSha256 = sha256File(path.join(here, '独立源值与算例.json'));
  const sourceManifestSha256 = sha256File(path.join(here, '来源哈希汇总.json'));

  const requests = [];
  for (const skillKey of order) {
    const write = skills[skillKey].write;
    for (const kind of ['parameters', 'formulas', 'effects']) {
      for (const body of write[kind]) {
        const id = body[fieldByKind[kind]];
        requests.push({
          sequence: requests.length + 1,
          method: 'POST',
          route: `/skills/${skillKey}/${endpointByKind[kind]}`,
          detailRoute: `/skills/${skillKey}/${endpointByKind[kind]}/${encodeURIComponent(id)}`,
          skillKey,
          kind,
          stableKey: id,
          status: '仅意图，未调用',
          body,
        });
      }
    }
  }
  const requestCounts = { parameters: 0, formulas: 0, effects: 0, processes: 0, internalStates: 0, triggerRules: 0 };
  for (const request of requests) requestCounts[request.kind] += 1;
  const plan = {
    generatedAt: candidate.meta.generatedAt,
    status: '仅写入意图，未调用业务接口',
    batch: '英雄机制第二十五批',
    apiBase: candidate.meta.apiBase,
    businessWrites: 0,
    candidateSha256,
    currentSnapshotSha256: copiedSnapshotSha256,
    requestCount: requests.length,
    requestCounts,
    reusedPublicParameters: reuseList,
    protectedSkills: order,
    requests,
    noApiCalls: true,
  };
  writeJson(path.join(here, '写前请求计划.json'), plan);
  const planSha256 = sha256File(path.join(here, '写前请求计划.json'));
  const version = {
    generatedAt: candidate.meta.generatedAt,
    status: '候选待审',
    batch: '英雄机制第二十五批',
    sourceRevision: 'hero25-source-v1-candidate',
    candidateSha256,
    requestPlanSha256: planSha256,
    sourceValuesSha256,
    sourceManifestSha256,
    currentSnapshotSha256: copiedSnapshotSha256,
    counts,
    requestCount: requests.length,
    businessWrites: 0,
    strictMathSha256: null,
  };
  writeJson(path.join(here, '候选版本.json'), version);
  const lock = {
    generatedAt: candidate.meta.generatedAt,
    status: '候选已生成，等待主负责人审查；未授权业务写入',
    batch: '英雄机制第二十五批',
    candidateSha256,
    requestPlanSha256: planSha256,
    sourceValuesSha256,
    sourceManifestSha256,
    currentSnapshotSha256: copiedSnapshotSha256,
    strictMathSha256: null,
    counts,
    requestCount: requests.length,
    businessWrites: 0,
    apiCalls: 0,
    protectedCoverage: { subjects: 10, componentLists: 60, publicParameters: 7, currentSnapshotFiles: 1 },
    reusedPublicParameters: reuseList,
    sourceFilesCopied: true,
    noApiCalls: true,
  };
  writeJson(path.join(here, '冻结候选锁.json'), lock);

  fs.copyFileSync(path.join(here, '完整候选.json'), path.join(batchDir, '完整候选.json'));
  fs.copyFileSync(path.join(here, '写前请求计划.json'), path.join(batchDir, '写前请求计划.json'));
  fs.copyFileSync(path.join(here, '独立源值与算例.json'), path.join(batchDir, '独立源值与算例.json'));
  console.log(JSON.stringify({ candidateSha256, planSha256, sourceValuesSha256, sourceManifestSha256, counts, requestCount: requests.length, batchDir }, null, 2));
}

function buildSourceManifest() {
  const files = [];
  function walk(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(absolute, next);
      else files.push({ relative: next.replaceAll('\\', '/'), bytes: fs.statSync(absolute).size, sha256: sha256File(absolute) });
    }
  }
  walk(inputDir);
  const expected = inputVersion.sourceFiles.map(item => ({ ...item }));
  return {
    generatedAt: new Date().toISOString(),
    batch: '英雄机制第二十五批',
    clientVersion: '16.17',
    officialVersion: '16.17.1',
    build: '16.17.8104348+branch.releases-16-17.content.release',
    policy: '只接受输入包内固定来源；当前正文由根绑定技能对象的mLocKeys提供；不写业务接口。',
    sourceIndexSha256: inputVersion.sourceIndexSha256,
    inputPackageExpectedFiles: expected,
    inputPackageActualFiles: files,
    inputPackageFileCount: files.length,
    inputPackageMatchesExpected: expected.every(item => files.some(actual => actual.relative === item.path && actual.sha256 === item.sha256 && actual.bytes === item.byteSize)),
    copiedCursorReview: 'hero25-cursor-review-run-20260909/review.md与主负责人执行审计.json已由外层归档（若存在）。',
  };
}

buildCandidate();
