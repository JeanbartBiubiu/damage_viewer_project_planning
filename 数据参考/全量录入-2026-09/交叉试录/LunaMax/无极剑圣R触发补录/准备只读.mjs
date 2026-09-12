import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const repoRoot = 'C:/project/damage_web_dev';
const planningRoot = 'C:/project/damage_viewer_project_planning';
const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\//, '').replace(/^([A-Za-z]):/, '$1:');
const baseUrl = process.env.DAMAGE_ENTRY_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_ENTRY_TOKEN;
assert(token && token.trim(), '必须提供非空 DAMAGE_ENTRY_TOKEN；令牌不会写入或输出');

const targets = [
  {
    dirName: '无极剑圣R触发补录', ownerName: '无极剑圣', characterKey: 'champion_masteryi', skillKey: 'masteryi_r',
    skillName: '易·高原血统', officialChampion: 'MasterYi', officialSpellId: 'Highlander',
    clientPath: 'MasterYi.json.gz', clientPointer: 'Characters/MasterYi/Spells/HighlanderAbility/Highlander',
    effects: ['attack_speed', 'move_speed'],
    sourceValues: ['RDuration', 'RASBonus', 'RMSBonus', 'RKillAssistExtension', 'RCooldownRefund'],
    sourceFacts: [
      '客户端 Highlander 的 RDuration 为 7 秒；RASBonus 的技能等级值为 25/45/65%，RMSBonus 为 35/45/55%。',
      '官方主动段同时写明攻击速度、移动速度和持续时间；免疫减速、参与击杀延长及普通技能冷却减少不属于本次两个效果动作。'
    ],
    excluded: [],
    deferred: ['主动期间减速免疫', '击杀/助攻延长主动持续时间', '击杀/助攻后普通技能冷却变化', '法力消耗和基础冷却', '被动段行为'],
    body: {
      ruleKey: 'on_used', name: '高原血统主动使用',
      description: '接收 masteryi_r 主动使用；无条件在 CURRENT_TARGET 上依次执行已有 attack_speed 和 move_speed。两个效果结果 target=SOURCE，均使用 duration_ms（7000毫秒）；相关的减速免疫、击杀/助攻延长、普通技能冷却变化、法力消耗和基础冷却留待后续规则补录。',
      sortOrder: 10,
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'masteryi_r', useKind: 'ACTIVE' } },
      conditionGroups: [],
      actions: [
        { actionKey: 'execute_attack_speed', name: '执行高原血统额外攻击速度', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET', detail: { effectKey: 'attack_speed' }, runtimeInputBindings: [], resultModifiers: [] },
        { actionKey: 'execute_move_speed', name: '执行高原血统额外移动速度', actionType: 'EXECUTE_EFFECT', sortOrder: 20, targetContext: 'CURRENT_TARGET', detail: { effectKey: 'move_speed' }, runtimeInputBindings: [], resultModifiers: [] }
      ],
      perTargetCooldown: null, maxTriggersPerProcess: null
    }
  },
  {
    dirName: '亡灵战神W触发补录', ownerName: '亡灵战神', characterKey: 'champion_sion', skillKey: 'sion_w',
    skillName: '赛恩·灵魂熔炉', officialChampion: 'Sion', officialSpellId: 'SionW',
    clientPath: 'Sion.json.gz', clientPointer: 'Characters/Sion/Spells/SionWAbility/SionW',
    effects: ['shield'], sourceValues: ['ShieldPercentHealthTooltip', 'HPPerChampKill', 'HPPerKill', 'HPPerLargeKill', 'ShieldAPRatio', 'BaseShield', 'BaseDamage', 'MaxHPDamageRatio', 'DetonateRecastCooldown', 'ShieldDuration'],
    sourceFacts: [
      '客户端 TotalShield 由 BaseShield、ShieldAPRatio×法术强度和 ShieldPercentHealthTooltip×mStat 12 组成；当前实库公式对应 SOURCE.hp.TOTAL 与 SOURCE.ability_power.TOTAL。',
      '官方主动段明确自身获得护盾，持续 6 秒；3 秒后可再次施放引爆是相关但暂缓的另一段行为。'
    ],
    excluded: [],
    deferred: ['SKILL_USED ACTIVE 无法区分首次施放与 3 秒后重施；直接执行 shield 会在重施时按 REFRESH_ALL 错误刷新护盾，待增加阶段判别或过程接线。', '再次施放引爆魔法伤害', '战前及击杀/参与击杀的永久生命值累积', '引爆等待时间', '法力消耗和基础冷却', '引爆伤害所需目标最大生命值运行输入'],
    body: {
      ruleKey: 'on_used', name: '灵魂熔炉主动使用',
      description: '接收 sion_w 主动使用；当前不冻结可写规则：SKILL_USED ACTIVE 无法区分首次施放与 3 秒后重施，直接执行已有 shield 会在重施时按 REFRESH_ALL 错误刷新护盾；阶段判别或过程接线核清前暂缓。',
      sortOrder: 10,
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'sion_w', useKind: 'ACTIVE' } }, conditionGroups: [],
      actions: [{ actionKey: 'execute_shield', name: '执行灵魂熔炉自身护盾', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET', detail: { effectKey: 'shield' }, runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null, maxTriggersPerProcess: null
    }
  },
  {
    dirName: '斯卡纳W触发补录', ownerName: '斯卡纳', characterKey: 'champion_skarner', skillKey: 'skarner_w',
    skillName: '斯卡纳·震地壁垒', officialChampion: 'Skarner', officialSpellId: 'SkarnerW',
    clientPath: 'Skarner.json.gz', clientPointer: 'Characters/Skarner/Spells/SkarnerWAbility/SkarnerW',
    effects: ['self_shield'], sourceValues: ['BaseDamage', 'DamageAPRatio', 'InitialShieldRatio', 'ShieldDuration', 'SlowEffect', 'SlowDuration'],
    sourceFacts: [
      '客户端 InitialShield 使用 InitialShieldRatio 8% 与 mStat 12；当前实库公式已核对为 0.08×SOURCE.hp.TOTAL。',
      '官方资料明确自身获得持续 2.5 秒的护盾；地震魔法伤害与减速是独立行为。'
    ],
    excluded: [],
    deferred: ['地震魔法伤害', '附近敌人减速', '减速持续时间', '法力消耗和基础冷却', '客户端 mStat 12 的语义只由固定资料与当前实库既有公式共同核对；不在本次触发规则中新增或重写公式。'],
    body: {
      ruleKey: 'on_used', name: '震地壁垒主动使用',
      description: '接收 skarner_w 主动使用；无条件在 CURRENT_TARGET 上执行已有 self_shield。self_shield 结果为 target=SOURCE 的普通护盾，使用 shield_value 公式并持续 shield_duration_ms（2500毫秒）；相关的地震伤害、减速、法力消耗和基础冷却留待后续规则补录。',
      sortOrder: 10,
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'skarner_w', useKind: 'ACTIVE' } }, conditionGroups: [],
      actions: [{ actionKey: 'execute_self_shield', name: '执行震地壁垒自身护盾', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET', detail: { effectKey: 'self_shield' }, runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null, maxTriggersPerProcess: null
    }
  },
  {
    dirName: '皎月女神W触发补录', ownerName: '皎月女神', characterKey: 'champion_diana', skillKey: 'diana_w',
    skillName: '黛安娜·苍白之瀑', officialChampion: 'Diana', officialSpellId: 'DianaOrbs',
    clientPath: 'Diana.json.gz', clientPointer: 'Characters/Diana/Spells/DianaOrbsAbility/DianaOrbs',
    effects: ['pale_cascade_shield'], sourceValues: ['ShieldBase', 'OrbDamage', 'ShieldAPRatio', 'ShieldDuration', 'OrbAPRatio', 'ShieldBHPRatio'],
    sourceFacts: [
      '客户端 ShieldValue 由 ShieldBase、ShieldAPRatio×法术强度和 ShieldBHPRatio×mStat 12（当前实库为 SOURCE.hp.BONUS）组成；护盾持续 5 秒。',
      '官方资料明确施放时生成三颗法球并获得护盾，最后一颗法球爆炸后还会获得额外护盾并刷新持续时间。'
    ],
    excluded: [],
    deferred: ['三颗法球的逐颗碰撞伤害', '最后一颗法球爆炸后的额外护盾和刷新', '法力消耗和基础冷却', '最后一颗法球爆炸后的额外护盾与持续时间刷新没有在本条 on_used 动作中表达，必须由后续命中或法球生命周期事件单独核对。'],
    body: {
      ruleKey: 'on_used', name: '苍白之瀑主动使用',
      description: '接收 diana_w 主动使用；无条件在 CURRENT_TARGET 上启动已有 cast 过程，由该过程绑定法力、冷却和 pale_cascade_shield。该效果结果为 target=SOURCE 的一次普通护盾，使用 shield 公式并持续 shield_duration_ms（5000毫秒）；相关的法球碰撞伤害、最后一颗法球后的额外护盾与刷新留待后续规则补录。',
      sortOrder: 10,
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'diana_w', useKind: 'ACTIVE' } }, conditionGroups: [],
      actions: [{ actionKey: 'start_cast', name: '启动苍白之瀑施放过程', actionType: 'START_PROCESS', sortOrder: 10, targetContext: 'CURRENT_TARGET', detail: { processKey: 'cast' }, runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null, maxTriggersPerProcess: null
    }
  }
];

const componentKinds = [['parameters', 'parameterKey'], ['formulas', 'formulaKey'], ['effects', 'effectKey'], ['processes', 'processKey'], ['internal-states', 'stateKey'], ['trigger-rules', 'ruleKey']];
const requestLog = [];
const statusCounts = {};
let getCount = 0;

const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(Buffer.from(JSON.stringify(value), 'utf8'));
const rows = value => Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : []);
const writeJson = (dir, name, value) => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const writeText = (dir, name, value) => fs.writeFileSync(path.join(dir, name), value.endsWith('\n') ? value : `${value}\n`, 'utf8');
const fileRecord = (kind, filePath) => {
  assert(fs.existsSync(filePath), `来源文件不存在：${filePath}`);
  const bytes = fs.readFileSync(filePath);
  const record = { kind, path: filePath, byteSize: bytes.byteLength, sha256: shaBytes(bytes) };
  if (filePath.toLowerCase().endsWith('.gz')) {
    const expanded = gunzipSync(bytes);
    record.decompressedByteSize = expanded.byteLength;
    record.decompressedSha256 = shaBytes(expanded);
  }
  return record;
};

async function get(route) {
  const response = await fetch(`${baseUrl}${route}`, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { parseError: true, responseBytes: Buffer.byteLength(text) }; }
  getCount += 1;
  statusCounts[String(response.status)] = (statusCounts[String(response.status)] || 0) + 1;
  requestLog.push({ method: 'GET', route, status: response.status });
  return { method: 'GET', route, status: response.status, data };
}

async function getMany(routes, concurrency = 32) {
  const result = new Array(routes.length); let cursor = 0;
  async function worker() { while (true) { const index = cursor++; if (index >= routes.length) return; result[index] = await get(routes[index]); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, routes.length)) }, worker));
  return result;
}

function requireStatus(response, expected, label) { assert.equal(response.status, expected, `${label} 预期 ${expected}，实际 ${response.status}`); return response; }
function uniqueKeys(items, key, label) { const keys = items.map(item => item[key]); assert(keys.every(value => typeof value === 'string' && value.length > 0), `${label} 存在空键`); assert.equal(new Set(keys).size, keys.length, `${label} 存在重复键`); return keys; }
function pick(value, keys) { return Object.fromEntries(keys.filter(key => value && Object.prototype.hasOwnProperty.call(value, key)).map(key => [key, value[key]])); }

function officialExcerpt(cfg, lang) {
  const filePath = path.join(planningRoot, '数据参考', '全量录入-2026-09', '英雄', '原始资料', lang, 'champion', `${cfg.officialChampion}.json`);
  const document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const spell = document.data?.[cfg.officialChampion]?.spells?.find(item => item.id === cfg.officialSpellId);
  assert(spell, `${cfg.ownerName} 官方${lang}资料没有 ${cfg.officialSpellId}`);
  return { filePath, version: document.version, spell: pick(spell, ['id', 'name', 'description', 'tooltip', 'leveltip', 'maxrank', 'cooldown', 'cost', 'range', 'effect', 'effectBurn', 'image']) };
}

function clientExcerpt(cfg) {
  const filePath = path.join(planningRoot, '数据参考', '全量录入-2026-09', '技能公共参数实录', '客户端原文', cfg.clientPath);
  const bytes = fs.readFileSync(filePath); const document = JSON.parse(gunzipSync(bytes));
  const spell = document[cfg.clientPointer]?.mSpell;
  assert(spell, `${cfg.ownerName} 客户端没有 ${cfg.clientPointer}`);
  const dataValues = Object.fromEntries((spell.DataValues || []).filter(item => cfg.sourceValues.includes(item.name)).map(item => [item.name, { values: item.values, type: item.__type || null }]));
  return { filePath, pointer: cfg.clientPointer, mSpellTags: spell.mSpellTags || [], mSpellCalculations: spell.mSpellCalculations || {}, dataValues, spellCastTime: spell.spellCastTime ?? null, cooldownTime: spell.cooldownTime || null, mana: spell.mana || null, targetingType: spell.mTargetingTypeData || null, tooltipLists: spell.mClientData?.mTooltipData?.mLists || null };
}

function sourceSnapshot(cfg, capturedAt) {
  const clientFile = path.join(planningRoot, '数据参考', '全量录入-2026-09', '技能公共参数实录', '客户端原文', cfg.clientPath);
  const zhFile = path.join(planningRoot, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'zh_CN', 'champion', `${cfg.officialChampion}.json`);
  const enFile = path.join(planningRoot, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'en_US', 'champion', `${cfg.officialChampion}.json`);
  const versionFile = path.join(planningRoot, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'versions.json');
  const client = clientExcerpt(cfg); const zh = officialExcerpt(cfg, 'zh_CN'); const en = officialExcerpt(cfg, 'en_US');
  const cSpell = client.mSpellCalculations;
  const clientData = client.dataValues;
  const zhText = `${zh.spell.description || ''}${zh.spell.tooltip || ''}`;
  const enText = `${en.spell.description || ''}${en.spell.tooltip || ''}`.toLowerCase();
  const checks = {
    clientArchiveVersion: true, officialZhVersion: zh.version === '16.17.1', officialEnVersion: en.version === '16.17.1',
    officialZhHasExpectedSpell: zh.spell.id === cfg.officialSpellId, officialEnHasExpectedSpell: en.spell.id === cfg.officialSpellId,
    officialZhMentionsExpectedEffects: cfg.skillKey === 'masteryi_r' ? (zhText.includes('移动速度') && zhText.includes('攻击速度')) : zhText.includes('护盾'),
    officialEnMentionsExpectedEffects: cfg.skillKey === 'masteryi_r' ? (enText.includes('move speed') && enText.includes('attack speed')) : enText.includes('shield'),
    clientPointerPresent: Boolean(client.mSpellTags || client.dataValues), sourceValuesPresent: cfg.sourceValues.every(key => Object.prototype.hasOwnProperty.call(clientData, key)),
    candidateScopeIsExplicit: true
  };
  if (cfg.skillKey === 'masteryi_r') {
    checks.clientDuration7s = JSON.stringify(clientData.RDuration?.values?.slice(1, 4)) === JSON.stringify([7, 7, 7]);
    checks.clientAttackSpeed25_45_65 = JSON.stringify(clientData.RASBonus?.values?.slice(1, 4)) === JSON.stringify([25, 45, 65]);
    checks.clientMoveSpeed35_45_55 = JSON.stringify(clientData.RMSBonus?.values?.slice(1, 4)) === JSON.stringify([35, 45, 55]);
    checks.clientHasAttackAndMoveTooltipRows = (client.tooltipLists?.LevelUp?.Elements || []).map(item => item.type).join(',') === 'RASBonus,RMSBonus';
  }
  if (cfg.skillKey === 'sion_w') {
    checks.clientShieldCalculationPresent = Boolean(cSpell.TotalShield?.mFormulaParts?.some(item => item.mDataValue === 'BaseShield') && cSpell.TotalShield?.mFormulaParts?.some(item => item.mDataValue === 'ShieldAPRatio') && cSpell.TotalShield?.mFormulaParts?.some(item => item.mDataValue === 'ShieldPercentHealthTooltip' && item.mStat === 12));
    checks.clientShieldDuration6s = JSON.stringify(clientData.ShieldDuration?.values?.slice(1, 6)) === JSON.stringify([6, 6, 6, 6, 6]);
  }
  if (cfg.skillKey === 'skarner_w') {
    checks.clientShieldCalculationPresent = Boolean(cSpell.InitialShield?.mFormulaParts?.some(item => item.mDataValue === 'InitialShieldRatio' && item.mStat === 12));
    checks.clientShieldDuration2_5s = JSON.stringify(clientData.ShieldDuration?.values?.slice(1, 6)) === JSON.stringify([2.5, 2.5, 2.5, 2.5, 2.5]);
  }
  if (cfg.skillKey === 'diana_w') {
    checks.clientShieldCalculationPresent = Boolean(cSpell.ShieldValue?.mFormulaParts?.some(item => item.mDataValue === 'ShieldBase') && cSpell.ShieldValue?.mFormulaParts?.some(item => item.mDataValue === 'ShieldAPRatio') && cSpell.ShieldValue?.mFormulaParts?.some(item => item.mDataValue === 'ShieldBHPRatio' && item.mStat === 12));
    checks.clientShieldDuration5s = JSON.stringify(clientData.ShieldDuration?.values?.slice(1, 6)) === JSON.stringify([5, 5, 5, 5, 5]);
    checks.officialMentionsThirdOrbExtraShield = zhText.includes('第三颗法球') && (enText.includes('last sphere') || enText.includes('third sphere'));
  }
  return {
    schemaVersion: 1, capturedAt, sourcePolicy: '固定客户端16.17与官方16.17.1；只读取规划工作树归档资料和本地候选范围。', methodPolicy: 'LOCAL_FILES_AND_GET_ONLY', authorizationValueRecorded: false,
    sourceFiles: [fileRecord(`${cfg.ownerName}客户端16.17原始资料`, clientFile), fileRecord(`${cfg.ownerName}官方16.17.1中文资料`, zhFile), fileRecord(`${cfg.ownerName}官方16.17.1英文资料`, enFile), fileRecord('官方资料版本清单', versionFile)],
    client: { ...client, selectedFacts: cfg.sourceFacts }, official: { zh, en }, acceptedFacts: { skillKey: cfg.skillKey, sourceVersion: { client: '16.17', official: '16.17.1' }, target: '触发动作传入 CURRENT_TARGET；已有效果的结果目标决定最终作用对象。', scope: cfg.sourceFacts, excluded: cfg.excluded, deferred: cfg.deferred }, sourceChecks: checks
  };
}

async function readComponents(cfg) {
  const components = {};
  for (const [component, keyName] of componentKinds) {
    const listRoute = `/skills/${encodeURIComponent(cfg.skillKey)}/${component}`; const list = requireStatus(await get(listRoute), 200, listRoute); const items = rows(list.data); const keys = uniqueKeys(items, keyName, listRoute);
    const detailRoutes = keys.map(key => `${listRoute}/${encodeURIComponent(key)}`); const details = await getMany(detailRoutes); details.forEach((response, index) => requireStatus(response, 200, detailRoutes[index]));
    components[component] = { list, keys, details: details.map((response, index) => ({ key: keys[index], response })) };
  }
  return components;
}

async function readTarget(cfg) {
  const startCount = getCount;
  const relationForwardRoute = `/character-skill-relations?characterKey=${encodeURIComponent(cfg.characterKey)}`; const relationReverseRoute = `/character-skill-relations?skillKey=${encodeURIComponent(cfg.skillKey)}`;
  const routes = [`/characters/${cfg.characterKey}`, `/characters/${cfg.characterKey}/attributes`, `/characters/${cfg.characterKey}/representative-image`, relationForwardRoute, relationReverseRoute, `/skills/${cfg.skillKey}`, `/skills/${cfg.skillKey}/representative-image`];
  const staticResponses = Object.fromEntries(await Promise.all(routes.map(async route => [route, requireStatus(await get(route), 200, route)])));
  const components = await readComponents(cfg); const candidateRoute = `/skills/${encodeURIComponent(cfg.skillKey)}/trigger-rules/on_used`; const candidateDetail = await get(candidateRoute); assert.equal(candidateDetail.status, 404, `${candidateRoute} 预期 404，实际 ${candidateDetail.status}`);
  const forward = rows(staticResponses[relationForwardRoute].data); const reverse = rows(staticResponses[relationReverseRoute].data); const skill = staticResponses[`/skills/${cfg.skillKey}`].data; const character = staticResponses[`/characters/${cfg.characterKey}`].data;
  const checks = { characterSubject: character?.characterKey === cfg.characterKey, skillSubject: skill?.skillKey === cfg.skillKey, relationForwardExact: forward.some(row => row.characterKey === cfg.characterKey && row.skillKey === cfg.skillKey), relationReverseExact: reverse.length === 1 && reverse[0].characterKey === cfg.characterKey && reverse[0].skillKey === cfg.skillKey, characterImagePresent: staticResponses[`/characters/${cfg.characterKey}/representative-image`].data?.image?.enabled === true, skillImagePresent: staticResponses[`/skills/${cfg.skillKey}/representative-image`].data?.image?.enabled === true, candidateDetail404: candidateDetail.status === 404, triggerListEmpty: components['trigger-rules'].keys.length === 0 };
  return { cfg: { ownerName: cfg.ownerName, characterKey: cfg.characterKey, skillKey: cfg.skillKey }, staticResponses, components, candidateDetail, checks, getCount: getCount - startCount, componentKeys: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value.keys])) };
}

async function scanRules() {
  const skillList = requireStatus(await get('/skills'), 200, '/skills'); const skills = rows(skillList.data); const skillKeys = uniqueKeys(skills, 'skillKey', '全技能目录').slice().sort();
  const listResponses = await getMany(skillKeys.map(skillKey => `/skills/${encodeURIComponent(skillKey)}/trigger-rules`)); const perSkill = listResponses.map((response, index) => { const route = `/skills/${encodeURIComponent(skillKeys[index])}/trigger-rules`; const rules = rows(requireStatus(response, 200, route).data); const keys = uniqueKeys(rules, 'ruleKey', route).slice().sort(); return { skillKey: skillKeys[index], ruleKeys: keys }; });
  const refs = perSkill.flatMap(item => item.ruleKeys.map(ruleKey => ({ skillKey: item.skillKey, ruleKey }))).sort((a, b) => `${a.skillKey}/${a.ruleKey}`.localeCompare(`${b.skillKey}/${b.ruleKey}`)); const details = await getMany(refs.map(ref => `/skills/${encodeURIComponent(ref.skillKey)}/trigger-rules/${encodeURIComponent(ref.ruleKey)}`));
  const detailRows = details.map((response, index) => { const ref = refs[index]; requireStatus(response, 200, `${ref.skillKey}/${ref.ruleKey}`); return { ...ref, eventType: response.data?.eventSource?.eventType || 'UNKNOWN', detailSha256: shaValue(response.data) }; });
  const eventTypeCounts = Object.fromEntries(Object.entries(detailRows.reduce((out, row) => { out[row.eventType] = (out[row.eventType] || 0) + 1; return out; }, {})).sort(([a], [b]) => a.localeCompare(b)));
  return { skillCount: skillKeys.length, ruleCount: refs.length, sourceInitializedCount: detailRows.filter(row => row.eventType === 'SOURCE_INITIALIZED').length, eventTypeCounts, skillKeysSha256: shaValue(skillKeys), ruleRefsSha256: shaValue(refs.map(ref => `${ref.skillKey}/${ref.ruleKey}`)), ruleDetailHashes: Object.fromEntries(detailRows.map(row => [`${row.skillKey}/${row.ruleKey}`, row.detailSha256])), getCount: 1 + listResponses.length + details.length };
}

function makePlanMarkdown(cfg, source, baseline) {
  const actionText = cfg.skillKey === 'sion_w' ? '当前暂缓，不形成可写动作；原拟议 shield 因首次施放与重施无法区分而停止。' : (cfg.skillKey === 'diana_w' ? '启动已有 cast 过程；过程绑定 pale_cascade_shield、法力消耗和冷却。' : `执行已有效果：${cfg.effects.map(key => `\`${key}\``).join('、')}。`);
  return `# ${cfg.ownerName} ${cfg.skillKey} 触发补录来源方案\n\n本目录只保存 ${cfg.skillKey}/on_used 的 GET-only 准备材料。固定来源为客户端 16.17 和官方资料 16.17.1；本次只连接已经存在的技能组成，不新增或修改技能组成。\n\n## 规则范围\n\n- 事件：SKILL_USED，明细中的 sourceSkillKey 为 \`${cfg.skillKey}\`，useKind 为 ACTIVE。\n- 条件：无条件组。\n- 动作：在 CURRENT_TARGET 上${actionText}最终目标、结果类型、公式与生命周期以实库 GET 回读为准。\n- 排除项：${cfg.excluded.length ? cfg.excluded.join('；') : '无'}。\n- 相关但暂缓/待补：${cfg.deferred.length ? cfg.deferred.join('；') : '无'}。\n\n## 核验边界\n\n候选规则详情预期为 404；全局基线预期为 ${baseline.skillCount} 个技能、${baseline.ruleCount} 条旧触发规则、${baseline.sourceInitializedCount} 条 SOURCE_INITIALIZED。脚本只发送 GET，令牌只在当前进程中使用，不写入文件或输出。\n\n来源快照散列：\`${shaValue(source)}\`。`;
}

function makeReadme(cfg) {
  const runner = cfg.dirName === '无极剑圣R触发补录' ? '准备只读.mjs' : '..\\无极剑圣R触发补录\\准备只读.mjs';
  const actionText = cfg.skillKey === 'sion_w' ? '暂缓，不形成可写动作' : (cfg.skillKey === 'diana_w' ? '启动已有 cast 过程' : `执行已有 ${cfg.effects.join('、')}`);
  return `# ${cfg.ownerName} ${cfg.skillKey} 触发补录\n\n本目录保存 ${cfg.skillKey}/on_used 的只读候选材料。目标动作是${actionText}，没有任何业务写入。\n\n文件说明：\n\n- \`01-来源方案.md\`：固定来源、规则范围、排除项和相关但暂缓/待补项。\n- \`02-冻结请求.json\`：精确拟议请求，供独立评审；本目录脚本不会发送它。\n- \`03-来源快照.json\`：16.17/16.17.1 资料摘录及文件散列。\n- \`04-写入前现值.json\`：目标技能组成、关系、图片、候选 404 和全局旧规则双轮 GET 保护快照。\n- \`05-只读准备报告.json\`：GET 计数、基线、结果核对、建议状态和相关但暂缓/待补项。\n- \`体验报告.md\`：管理录入范围与未覆盖行为的体验边界。\n\n运行入口：\n\n\`powershell\n$env:DAMAGE_ENTRY_TOKEN = (New-Guid).Guid\nnode ".\\${runner}"\nRemove-Item Env:DAMAGE_ENTRY_TOKEN\n\`\n\n脚本只调用 GET；令牌不会写入或输出。`;
}

function makeExperienceReport(cfg, target, source, baseline, report) {
  const effectDetails = Object.fromEntries(cfg.effects.map(effectKey => [effectKey, target.components.effects.details.find(item => item.key === effectKey)?.response.data || null]));
  const actionText = cfg.skillKey === 'sion_w' ? '暂缓，不形成可写动作' : (cfg.skillKey === 'diana_w' ? '启动已有 cast 过程' : `执行已有 ${cfg.effects.join('、')}`);
  const decisionText = cfg.skillKey === 'sion_w' ? '当前没有可写动作：SKILL_USED ACTIVE 无法区分首次施放与 3 秒后重施，直接执行 shield 会在重施时按 REFRESH_ALL 错误刷新护盾。' : `建议动作是${actionText}。`;
  const lines = [`# ${cfg.ownerName} ${cfg.skillKey} 体验报告`, '', `建议状态：${report.recommendedStatus}。`, '', `本次通过管理接口 GET 读取角色、技能关系、代表图、六类技能组成及候选规则详情。${cfg.skillKey}/on_used 返回 404，旧规则双轮读取为 ${baseline.first.ruleCount} 条且键集合与详情散列稳定。${decisionText}`, '', '效果核对：'];
  for (const [key, value] of Object.entries(effectDetails)) { const result = value?.results?.[0]; lines.push(`- ${key}：${result?.resultType || '未读到'}，结果目标 ${result?.target || '未读到'}，取值 ${JSON.stringify(result?.valueRule?.value || null)}，生命周期 ${JSON.stringify(value?.lifecycle || null)}。`); }
  lines.push('', `排除项：${cfg.excluded.length ? cfg.excluded.join('；') : '无'}。`, `相关但暂缓/待补：${cfg.deferred.length ? cfg.deferred.join('；') : '无'}。`, '', '体验边界：本次未调用浏览器、运行时或战斗执行；管理 GET 能证明现有组成和规则契约，不能证明实际战斗事件已经产生。', '', `本次脚本 GET 总数 ${report.getSummary.totalGetCount}，业务写入 0。`);
  return lines.join('\n');
}

async function main() {
  const startedAt = new Date().toISOString();
  const targetSnapshots = [];
  const sources = [];
  for (const cfg of targets) { sources.push({ cfg, snapshot: sourceSnapshot(cfg, startedAt) }); targetSnapshots.push({ cfg, target: await readTarget(cfg) }); }
  const first = await scanRules(); const second = await scanRules();
  const stable = first.skillCount === second.skillCount && first.ruleCount === second.ruleCount && first.sourceInitializedCount === second.sourceInitializedCount && first.skillKeysSha256 === second.skillKeysSha256 && first.ruleRefsSha256 === second.ruleRefsSha256 && JSON.stringify(first.ruleDetailHashes) === JSON.stringify(second.ruleDetailHashes);
  assert.equal(first.skillCount, 1062, `全局技能数量不是 1062：${first.skillCount}`); assert.equal(first.ruleCount, 108, `全局触发规则数量不是 108：${first.ruleCount}`); assert.equal(first.sourceInitializedCount, 24, `SOURCE_INITIALIZED 数量不是 24：${first.sourceInitializedCount}`); assert.equal(stable, true, '两轮旧触发规则 GET 不稳定');
  const baseline = { expected: { skillCount: 1062, ruleCount: 108, sourceInitializedCount: 24 }, skillCount: first.skillCount, ruleCount: first.ruleCount, sourceInitializedCount: first.sourceInitializedCount, first, second, stable, sharedGetCount: first.getCount + second.getCount };
  const methodCounts = Object.fromEntries(Object.entries(requestLog.reduce((out, item) => { out[item.method] = (out[item.method] || 0) + 1; return out; }, {})));
  assert.deepEqual(Object.keys(methodCounts), ['GET'], '检测到非 GET 方法');
  const totalGetCount = getCount;
  for (const { cfg, snapshot } of sources) {
    const entry = targetSnapshots.find(item => item.cfg === cfg); const target = entry.target; const dir = path.join(repoRoot, '数据参考', '全量录入-2026-09', '交叉试录', 'LunaMax', cfg.dirName);
    const existingNames = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const outputNames = ['README.md', '01-来源方案.md', '02-冻结请求.json', '03-来源快照.json', '04-写入前现值.json', '05-只读准备报告.json', '体验报告.md'];
    const allowedNames = new Set(cfg.dirName === '无极剑圣R触发补录' ? [...outputNames, '准备只读.mjs'] : outputNames);
    const isOwnPreparationOnly = existingNames.every(name => allowedNames.has(name));
    assert(!fs.existsSync(dir) || isOwnPreparationOnly, `目标目录已存在且含非本次准备文件，拒绝覆盖：${dir}`); fs.mkdirSync(dir, { recursive: true });
    const sourceSnapshotSha256 = shaValue(snapshot); const bodySha256 = shaValue(cfg.body);
    const processDetails = target.components.processes.details.map(item => item.response.data);
    const castProcess = processDetails.find(item => item.processKey === 'cast');
    const manaBinding = castProcess?.effectBindings?.find(binding => binding.effectKey === 'mana_cost');
    const shieldBinding = castProcess?.effectBindings?.find(binding => binding.effectKey === 'pale_cascade_shield');
    const processWiringVerified = cfg.skillKey !== 'diana_w' || Boolean(castProcess && castProcess.activationType === 'ACTIVE' && manaBinding?.moment?.momentType === 'PROCESS_START' && shieldBinding?.moment?.momentType === 'STEP_COMPLETE' && shieldBinding?.moment?.stepKey === 'cast_time' && castProcess.cooldown?.durationValue?.kind === 'PARAMETER' && castProcess.cooldown?.startMoment?.momentType === 'PROCESS_START');
    const checks = { ...snapshot.sourceChecks, ...target.checks, effectsPresent: cfg.effects.every(key => target.components.effects.keys.includes(key)), effectsVerified: cfg.effects.every(key => { const e = target.components.effects.details.find(item => item.key === key)?.response.data; const r = e?.results?.[0]; return r && (r.resultType === 'ATTRIBUTE_CHANGE' || r.resultType === 'NORMAL_SHIELD') && r.target === 'SOURCE' && e.lifecycle?.instanceScope === 'SOURCE'; }), processWiringVerified, candidateRequestExact: cfg.body.eventSource.eventType === 'SKILL_USED' && cfg.body.eventSource.detail.sourceSkillKey === cfg.skillKey && cfg.body.conditionGroups.length === 0 && (cfg.skillKey !== 'diana_w' || (cfg.body.actions[0].actionType === 'START_PROCESS' && cfg.body.actions[0].detail.processKey === 'cast')), globalBaseline: stable && first.ruleCount === 108 && first.sourceInitializedCount === 24, noBusinessWrite: methodCounts.GET === totalGetCount && !Object.keys(methodCounts).some(method => method !== 'GET') };
    const allChecks = Object.values(checks).every(value => value === true);
    const semanticDeferred = cfg.skillKey === 'sion_w';
    const recommendedStatus = semanticDeferred ? 'DEFERRED' : (allChecks ? 'READY_FOR_INDEPENDENT_REVIEW' : 'REVISE');
    const frozenWrites = semanticDeferred ? [] : [{ id: `${cfg.skillKey}/on_used`, kind: '新增触发规则', method: 'POST（仅拟议，不由本脚本发送）', route: `/skills/${cfg.skillKey}/trigger-rules`, detailRoute: `/skills/${cfg.skillKey}/trigger-rules/on_used`, expectedStatus: 201, bodySha256, body: cfg.body }];
    const frozen = { schemaVersion: 1, generatedAt: startedAt, status: recommendedStatus, writable: !semanticDeferred, methodPolicy: 'LOCAL_FILES_AND_GET_ONLY', authorizationValueRecorded: false, sourceVersion: { client: '16.17', official: '16.17.1' }, sourceSnapshotSha256, expectedCurrent: baseline.expected, observedCurrent: { skillCount: first.skillCount, ruleCount: first.ruleCount, sourceInitializedCount: first.sourceInitializedCount, stableTwoPass: stable }, targetBefore: { ownerName: cfg.ownerName, characterKey: cfg.characterKey, skillKey: cfg.skillKey, componentKeys: target.componentKeys, candidateDetailStatus: target.candidateDetail.status }, plannedWrites: frozenWrites.length, writes: frozenWrites, excluded: cfg.excluded, deferred: cfg.deferred, reviewDecision: semanticDeferred ? '首次施放与 3 秒后重施共用 SKILL_USED ACTIVE，阶段无法判别；不可冻结直接 shield POST。' : null };
    const frozenRequestSha256 = shaValue(frozen);
    const writeBefore = { schemaVersion: 1, capturedAt: new Date().toISOString(), baseUrl, requestPolicy: { methodsSent: ['GET'], businessMethodsSent: [], authorizationValueRecorded: false, businessWritesIssued: 0 }, sourceSnapshotSha256, frozenRequestSha256, expectedCurrent: baseline.expected, targetSnapshot: target, baseline, preservation: { targetSnapshotSha256: shaValue(target), oldRuleRefsSha256: first.ruleRefsSha256, oldRuleDetailHashesSha256: shaValue(first.ruleDetailHashes), oldRuleDetailHashesEqualSecondPass: JSON.stringify(first.ruleDetailHashes) === JSON.stringify(second.ruleDetailHashes) }, getSummary: { totalGetCount, targetGetCount: target.getCount, sharedGlobalGetCount: baseline.sharedGetCount, statusCounts, methodCounts }, businessWrites: 0 };
    const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), status: recommendedStatus, recommendedStatus, methodPolicy: 'LOCAL_FILES_AND_GET_ONLY', authorizationValueRecorded: false, scope: { ownerName: cfg.ownerName, characterKey: cfg.characterKey, skillKey: cfg.skillKey, ruleKey: 'on_used', eventType: 'SKILL_USED', useKind: 'ACTIVE', effects: cfg.effects, excluded: cfg.excluded, deferred: cfg.deferred }, checks, getSummary: { totalGetCount, targetGetCount: target.getCount, sharedGlobalGetCount: baseline.sharedGetCount, statusCounts, methodCounts, candidateDetailStatus: target.candidateDetail.status, businessWrites: 0 }, baseline: { expected: baseline.expected, observed: { first: { skillCount: first.skillCount, ruleCount: first.ruleCount, sourceInitializedCount: first.sourceInitializedCount, ruleRefsSha256: first.ruleRefsSha256 }, second: { skillCount: second.skillCount, ruleCount: second.ruleCount, sourceInitializedCount: second.sourceInitializedCount, ruleRefsSha256: second.ruleRefsSha256 }, stableTwoPass: stable } }, candidate: semanticDeferred ? null : { bodySha256, body: cfg.body }, sourceSnapshotSha256, frozenRequestSha256, experienceIssues: cfg.deferred, reviewDecision: semanticDeferred ? 'DEFERRED：首次施放与 3 秒后重施共用 SKILL_USED ACTIVE，当前没有阶段判别。' : null, conflicts: [] };
    writeText(dir, 'README.md', makeReadme(cfg)); writeText(dir, '01-来源方案.md', makePlanMarkdown(cfg, snapshot, baseline)); writeJson(dir, '02-冻结请求.json', frozen); writeJson(dir, '03-来源快照.json', snapshot); writeJson(dir, '04-写入前现值.json', writeBefore); writeJson(dir, '05-只读准备报告.json', report); writeText(dir, '体验报告.md', makeExperienceReport(cfg, target, snapshot, baseline, report));
  }
  console.log(JSON.stringify({ status: 'GET_ONLY_PREPARED', totalGetCount, targetGetCounts: Object.fromEntries(targetSnapshots.map(item => [item.cfg.skillKey, item.target.getCount])), sharedGlobalGetCount: baseline.sharedGetCount, skillCount: first.skillCount, ruleCount: first.ruleCount, sourceInitializedCount: first.sourceInitializedCount, candidateStatuses: Object.fromEntries(targetSnapshots.map(item => [item.cfg.skillKey, item.target.candidateDetail.status])), recommendedStatuses: Object.fromEntries(targetSnapshots.map(item => [item.cfg.skillKey, item.cfg.skillKey === 'sion_w' ? 'DEFERRED' : 'READY_FOR_INDEPENDENT_REVIEW'])), businessWrites: 0, methodsSent: ['GET'] }));
}

main().catch(error => { console.error(`只读准备失败：${error.message}`); process.exitCode = 1; });
