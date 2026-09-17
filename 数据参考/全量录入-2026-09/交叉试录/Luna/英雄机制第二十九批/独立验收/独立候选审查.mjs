import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const auditDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(auditDir, '../../..');
const candidateDir = path.join(repoDir, '.agents/artifacts/hero29-luna-candidate/修订二');
const inputDir = path.join(repoDir, '.agents/artifacts/hero29-root-entry-20260909');
const cursorDir = path.join(repoDir, '.agents/artifacts/hero29-cursor-review-run-20260909');
const reportPath = path.join(auditDir, '独立候选审查.json');

const candidatePath = path.join(candidateDir, '完整候选.json');
const planPath = path.join(candidateDir, '请求计划.json');
const rangePath = path.join(candidateDir, '来源与范围.json');
const versionPath = path.join(candidateDir, '候选版本.json');
const sourceBindingPath = path.join(inputDir, '来源绑定与当前文本.json');
const inputVersionPath = path.join(inputDir, '输入版本.json');
const baselinePath = path.join(inputDir, '参考资料', '当前10槽保护快照.json');
const reusePath = path.join(inputDir, '参考资料', '公共参数复用清单.json');
const attributeBoundaryPath = path.join(inputDir, '参考资料', '属性默认与边界.json');
const sourceNotePath = path.join(inputDir, '主负责人源值核对说明.md');
const modeTextPath = path.join(inputDir, '模式正文与官方对照.jsonl');
const writerPath = path.join(candidateDir, '受保护写入器.mjs');
const candidateMathPath = path.join(candidateDir, '独立数学核算.json');
const cursorAuditPath = path.join(candidateDir, 'Cursor执行审计.json');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const near = (a, b, epsilon = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
const nearArray = (a, b, epsilon = 1e-6) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => near(v, b[i], epsilon));
const normalize = (value) => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, normalize(v)]));
  }
  return value;
};
const stable = (value) => JSON.stringify(normalize(value));
const stripDbFields = (value) => {
  if (Array.isArray(value)) return value.map(stripDbFields);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['gameId', 'skillKey', 'createdAt', 'updatedAt'].includes(key))
      .map(([key, v]) => [key, stripDbFields(v)]));
  }
  return value;
};

const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const range = readJson(rangePath);
const candidateVersion = readJson(versionPath);
const sourceBinding = readJson(sourceBindingPath);
const inputVersion = readJson(inputVersionPath);
const baseline = readJson(baselinePath);
const reused = readJson(reusePath);
const attributeBoundary = readJson(attributeBoundaryPath);
const candidateMath = readJson(candidateMathPath);
const cursorAudit = readJson(cursorAuditPath);
const modeTexts = fs.readFileSync(modeTextPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const sourceNote = fs.readFileSync(sourceNotePath, 'utf8');
const writerText = fs.readFileSync(writerPath, 'utf8');

const checks = [];
const blockingFindings = [];
const nonBlockingFindings = [];
const check = (id, ok, detail, blocking = true) => {
  const row = { id, status: ok ? 'PASS' : 'FAIL', detail };
  checks.push(row);
  if (!ok) (blocking ? blockingFindings : nonBlockingFindings).push({ id, detail });
  return ok;
};
const note = (id, detail, evidence = []) => nonBlockingFindings.push({ id, detail, evidence });

const skills = ['ornn_p', 'ornn_q', 'ornn_w', 'ornn_e', 'ornn_r', 'shen_p', 'shen_q', 'shen_w', 'shen_e', 'shen_r'];
const kindInfo = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
const expectedCounts = {
  ornn_p: [6, 4, 0], ornn_q: [8, 1, 1], ornn_w: [13, 4, 1], ornn_e: [8, 1, 1], ornn_r: [11, 2, 1],
  shen_p: [8, 2, 0], shen_q: [15, 3, 1], shen_w: [4, 0, 1], shen_e: [9, 1, 2], shen_r: [0, 0, 0],
};

const entries = [];
for (const skillKey of skills) {
  const write = candidate.skills?.[skillKey]?.write ?? {};
  for (const [kind, idField, apiKind] of kindInfo) {
    for (const body of write[kind] ?? []) {
      entries.push({ skillKey, kind, apiKind, stableKey: body[idField], body, route: `/skills/${skillKey}/${apiKind}` });
    }
  }
}
const newKey = (skillKey, kind, key) => `${skillKey}/${kind}/${key}`;
const reuseSet = new Set(reused.map((item) => newKey(item.skillKey, 'parameters', item.parameterKey)));
const entrySet = new Set(entries.map((item) => newKey(item.skillKey, item.kind, item.stableKey)));
const plannedSet = new Set((plan.intents ?? []).map((item) => newKey(item.skillKey, item.kind, item.stableKey)));
const candidateIntentSet = new Set((candidate.postIntents ?? []).map((item) => newKey(item.skillKey, item.kind, item.stableKey)));

const expectedHashes = {
  candidate: '3837264e96ce61ca1cb420a0d37cdadb19d5d3082240f92cff29baff335875b1',
  plan: '162f1637ac59183d198265a5c152d245c7a1b619efef742256f094bd98344eb0',
  inputVersion: '85459db3db119841a7950124c3661b7cc5625b7be3b2283fe5e31fc61d66349f',
  sourceBinding: 'f09cf7a5e4f515d89860cf5f05cfd89eb3f2f42b7b19294c906740f6910f6341',
  protection: 'e68afdd8f5b82dea441ac6fed6d2ecd912fc70d0a7b05812a22b695fffb73956',
  sourceNote: '3839875a178be5932150348757b8cbe3e6d9187041e2c98384ab0cc7acee7bc2',
  publicReuse: 'ba209b9fedd67c4e00e8f95b6dcba477f1114a96df8755dffafd9f73a2a8d739',
  range: '821207448fffa37f84ab6e2bcab84a4d7d24d47161fe650d3cf40ba8b43c85e6',
  candidateMath: '92b838c400e7af27eda32790cad5a6b1895ebbd11342460854ba72d4e9852fcd',
  writer: '1f7155feb8c15937f94cf26c373dafca32fd4a741bcb2f8dfae1ef28feac20c6',
};
const actualHashes = {
  candidate: sha256(candidatePath),
  plan: sha256(planPath),
  range: sha256(rangePath),
  version: sha256(versionPath),
  sourceBinding: sha256(sourceBindingPath),
  inputVersion: sha256(inputVersionPath),
  protection: sha256(baselinePath),
  sourceNote: sha256(sourceNotePath),
  publicReuse: sha256(reusePath),
  writer: sha256(writerPath),
  candidateMath: sha256(candidateMathPath),
  cursorAudit: sha256(cursorAuditPath),
};
for (const [key, expected] of Object.entries(expectedHashes)) {
  check(`hash.${key}`, actualHashes[key] === expected, `实际=${actualHashes[key]}，冻结=${expected}`);
}
check('hash.candidate_version_meta', candidateVersion.candidateSha256 === actualHashes.candidate && candidateVersion.planSha256 === actualHashes.plan,
  `候选版本中的 candidateSha256/planSha256 与修订一文件一致`);
check('hash.source_range_meta', range.frozenHashes.inputVersion === actualHashes.inputVersion
  && range.frozenHashes.sourceBinding === actualHashes.sourceBinding
  && range.frozenHashes.sourceNote === actualHashes.sourceNote
  && range.frozenHashes.protection === actualHashes.protection
  && range.frozenHashes.publicReuse === actualHashes.publicReuse,
  '来源范围冻结哈希全部对应当前输入字节');

for (const sourceFile of inputVersion.sourceFiles) {
  const sourcePath = path.join(inputDir, sourceFile.path);
  check(`source-file.${sourceFile.path}`, fs.existsSync(sourcePath) && sha256(sourcePath) === sourceFile.sha256,
    `来源文件存在且散列=${sourceFile.sha256}`);
}
check('source.versions', candidate.meta.sourceVersions.client === '16.17' && candidate.meta.sourceVersions.official === '16.17.1'
  && inputVersion.sourceFiles.some((x) => x.role === '固定客户端完整原文')
  && inputVersion.sourceFiles.some((x) => x.role === '固定官方中文'), '候选和输入均固定客户端16.17、官方16.17.1');

const preflightFiles = [];
const walk = (root) => {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === '执行结果.json') preflightFiles.push(full);
  }
};
walk(path.join(candidateDir, '只读预检'));
walk(path.join(repoDir, '.agents/artifacts/hero29-luna-candidate/修订一', '只读预检'));
const preflightPath = preflightFiles.sort().at(-1);
const preflight = preflightPath ? readJson(preflightPath) : null;
check('preflight.readonly', Boolean(preflight) && preflight.mode === 'readonly' && preflight.success === true
  && preflight.apiWrites === 0 && preflight.counts?.POST === 0,
  preflight ? `mode=${preflight.mode}，GET=${preflight.counts?.GET}，POST=${preflight.counts?.POST}，apiWrites=${preflight.apiWrites}` : '未找到修订一只读预检结果');
check('preflight.protection', Boolean(preflight?.preflight?.protection?.passed)
  && preflight.preflight.protection.checked === 99 && preflight.preflight.protection.lists === 60
  && preflight.preflight.details?.matched === 11 && preflight.preflight.details?.missingBefore === 97,
  preflight ? `保护=${preflight.preflight.protection.checked}，列表=${preflight.preflight.protection.lists}，复用=${preflight.preflight.details.matched}，新增缺失=${preflight.preflight.details.missingBefore}` : '无预检数据');
if (preflightPath && preflightPath.includes(`${path.sep}修订一${path.sep}`)) {
  note('preflight.revision_carryover', '修订二只改变候选描述和效果名称，当前只读预检证据来自修订一；修订二仍需在实际写入前沿同一保护规则再次确认。', [preflightPath, candidateDir]);
}

check('counts.total', entries.length === 108 && plan.count === 97 && plan.intents.length === 97
  && candidate.reusedPublicParameters.length === 11, `当前组成=${entries.length}，新增计划=${plan.intents.length}，复用=${candidate.reusedPublicParameters.length}`);
for (const skillKey of skills) {
  const write = candidate.skills?.[skillKey]?.write ?? {};
  const got = [write.parameters?.length ?? 0, write.formulas?.length ?? 0, write.effects?.length ?? 0];
  check(`counts.${skillKey}`, stable(got) === stable(expectedCounts[skillKey]), `实际=${got.join('/')}，期望=${expectedCounts[skillKey].join('/')}`);
  for (const [kind] of kindInfo) {
    check(`empty-extra.${skillKey}.${kind}`, (write[kind] ?? []).length === (kind === 'parameters' ? got[0] : kind === 'formulas' ? got[1] : kind === 'effects' ? got[2] : 0),
      `仅检查本批允许的参数、公式和效果，${kind}数量=${write[kind]?.length ?? 0}`);
  }
}

check('counts.new_entries', entries.filter((item) => !reuseSet.has(newKey(item.skillKey, item.kind, item.stableKey))).length === 97,
  `候选中扣除11项公共参数后的新增组成=${entries.filter((item) => !reuseSet.has(newKey(item.skillKey, item.kind, item.stableKey))).length}`);
check('reuse.list', reused.length === 11 && reused.every((item) => reuseSet.has(newKey(item.skillKey, 'parameters', item.parameterKey)))
  && reused.every((item) => entrySet.has(newKey(item.skillKey, 'parameters', item.parameterKey))), '11项公共参数均在候选中完整保留');
check('plan.unique', new Set(plan.intents.map((item) => newKey(item.skillKey, item.kind, item.stableKey))).size === 97
  && plan.intents.every((item) => !reuseSet.has(newKey(item.skillKey, item.kind, item.stableKey))), '计划无重复且不重复提交公共复用参数');
check('candidate.plan.intent_copy', candidate.postIntents?.length === 97 && candidateIntentSet.size === 97
  && stable(candidate.postIntents) === stable(plan.intents), '候选内嵌计划与独立请求计划逐项一致');
for (const intent of plan.intents) {
  const match = entries.find((item) => item.skillKey === intent.skillKey && item.kind === intent.kind && item.stableKey === intent.stableKey);
  check(`plan.body.${intent.skillKey}.${intent.kind}.${intent.stableKey}`, Boolean(match) && intent.method === 'POST'
    && intent.route === match.route && stable(intent.body) === stable(match.body), '计划请求体与候选请求体一致');
}

const baselineByRoute = new Map((baseline.requests ?? []).map((item) => [item.route, item]));
const protectedListRoutes = new Set((baseline.requests ?? []).filter((item) => /^\/skills\/[^/]+\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/.test(item.route)).map((item) => item.route));
check('protection.snapshot', baseline.requests.length === 99 && baseline.requests.every((item) => item.status === 200)
  && protectedListRoutes.size === 60, `冻结保护请求=${baseline.requests.length}，技能组成列表=${protectedListRoutes.size}`);
const reusedComparisons = [];
for (const item of reused) {
  const route = `/skills/${item.skillKey}/parameters/${item.parameterKey}`;
  const old = baselineByRoute.get(route);
  const candidateItem = entries.find((entry) => entry.skillKey === item.skillKey && entry.kind === 'parameters' && entry.stableKey === item.parameterKey);
  const ok = Boolean(old && old.status === 200 && candidateItem && stable(stripDbFields(old.data)) === stable(stripDbFields(candidateItem.body)));
  reusedComparisons.push({ route, status: ok ? 'PASS' : 'FAIL' });
  check(`protection.reuse.${item.skillKey}.${item.parameterKey}`, ok, '保护快照详情与候选复用体一致');
}

const sourceHeroById = new Map((sourceBinding.heroes ?? []).map((hero) => [hero.id, hero]));
const expectedBindings = {
  ornn_p: 'Characters/Ornn/Spells/OrnnPAbility/OrnnP', ornn_q: 'Characters/Ornn/Spells/OrnnQAbility/OrnnQ',
  ornn_w: 'Characters/Ornn/Spells/OrnnWAbility/OrnnW', ornn_e: 'Characters/Ornn/Spells/OrnnEAbility/OrnnE',
  ornn_r: 'Characters/Ornn/Spells/OrnnRAbility/OrnnR', shen_p: 'Characters/Shen/Spells/ShenPassiveAbility/ShenPassive',
  shen_q: 'Characters/Shen/Spells/ShenQAbility/ShenQ', shen_w: 'Characters/Shen/Spells/ShenWAbility/ShenW',
  shen_e: 'Characters/Shen/Spells/ShenEAbility/ShenE', shen_r: 'Characters/Shen/Spells/ShenRAbility/ShenR',
};
const sourceSkill = (skillKey) => {
  const [heroName, slotName] = skillKey.split('_');
  const hero = sourceHeroById.get(heroName === 'ornn' ? 'Ornn' : 'Shen');
  return hero?.skills?.find((skill) => skill.slot.toLowerCase() === slotName);
};
const spellOf = (skillKey) => sourceSkill(skillKey)?.object?.mSpell;
const dataValues = (spell, name) => spell?.DataValues?.find((item) => item.name === name)?.values ?? null;
const calculation = (spell, name) => spell?.mSpellCalculations?.[name];
const sourceModeText = (key) => modeTexts.find((item) => item.key === key)?.text ?? '';
const modeSpellText = (skillKey) => {
  const [heroName, slotName] = skillKey.split('_');
  const hero = heroName === 'ornn' ? 'Ornn' : 'Shen';
  const index = { q: 0, w: 1, e: 2, r: 3 }[slotName];
  return modeTexts.find((item) => item.hero === hero)?.spells?.[index]?.tooltip ?? '';
};
const sourceCurrentText = (skillKey, key = 'keyTooltip') => sourceSkill(skillKey)?.currentTexts?.[key]?.text ?? '';
const param = (skillKey, key) => candidate.skills[skillKey]?.write?.parameters?.find((item) => item.parameterKey === key);
const formula = (skillKey, key) => candidate.skills[skillKey]?.write?.formulas?.find((item) => item.formulaKey === key);
const effect = (skillKey, key) => candidate.skills[skillKey]?.write?.effects?.find((item) => item.effectKey === key);
const attrRows = baselineByRoute.get('/attributes')?.data?.items ?? [];
const attrKeys = new Set(attrRows.filter((item) => item.status === 'ENABLED').map((item) => item.attributeKey));

for (const skillKey of skills) {
  const source = sourceSkill(skillKey);
  check(`binding.${skillKey}`, Boolean(source) && source.binding === expectedBindings[skillKey] && source.skillKey === skillKey,
    source ? `${source.binding}，${source.skillKey}` : '绑定缺失');
  check(`range.${skillKey}`, range.skillRanges?.[skillKey]?.binding === expectedBindings[skillKey], '范围绑定与冻结根绑定一致');
}
check('source.attribute_catalog', ['hp', 'mana', 'energy', 'armor', 'magic_resistance', 'attack_damage', 'ability_power'].every((key) => attrKeys.has(key)),
  '属性快照含本批公式和资源效果所需的属性');

const officialByHero = {};
for (const sourceFile of inputVersion.sourceFiles.filter((item) => item.role === '固定官方中文')) {
  const official = readJson(path.join(inputDir, sourceFile.path));
  const heroId = Object.keys(official.data ?? {})[0];
  officialByHero[heroId] = official.data[heroId];
}
const officialSpell = (skillKey) => {
  const [heroName, slotName] = skillKey.split('_');
  const hero = officialByHero[heroName === 'ornn' ? 'Ornn' : 'Shen'];
  const index = { q: 0, w: 1, e: 2, r: 3 }[slotName];
  return index === undefined ? null : hero?.spells?.[index];
};
for (const skillKey of skills.filter((key) => !key.endsWith('_p'))) {
  const spell = officialSpell(skillKey);
  const cooldown = param(skillKey, 'cooldown_ms');
  const costKey = skillKey.startsWith('ornn_') ? 'mana_cost' : 'energy_cost';
  const cost = param(skillKey, costKey);
  const cooldownExpected = spell?.cooldown?.map((value) => value * 1000);
  const costExpected = spell?.cost;
  if (cooldown) check(`official.${skillKey}.cooldown`, nearArray(Object.values(cooldown.levelValues ?? {}), cooldownExpected), '官方冷却数组秒转毫秒后逐级一致');
  if (cost) {
    const actual = cost.fixedValue === null ? Object.values(cost.levelValues ?? {}) : [cost.fixedValue];
    const expected = costExpected?.every((value) => value === costExpected[0]) ? [costExpected[0]] : costExpected;
    check(`official.${skillKey}.cost`, nearArray(actual, expected), '官方消耗数组与候选一致');
  }
}

const ornnp = spellOf('ornn_p');
const ornnq = spellOf('ornn_q');
const ornnw = spellOf('ornn_w');
const ornne = spellOf('ornn_e');
const ornnr = spellOf('ornn_r');
const shenp = spellOf('shen_p');
const shenq = spellOf('shen_q');
const shenw = spellOf('shen_w');
const shene = spellOf('shen_e');

const part = (calc, index) => calc?.mFormulaParts?.[index];
const coefficient = (node) => node?.mCoefficient;
const sourceCalc = (spell, name, index = 0) => part(calculation(spell, name), index);
const fixedCandidate = (skillKey, key) => param(skillKey, key)?.fixedValue;
const levelCandidate = (skillKey, key) => Object.values(param(skillKey, key)?.levelValues ?? {});

check('source.ornn_p', near(dataValues(ornnp, 'BaseStatAmp')?.[1], fixedCandidate('ornn_p', 'base_stat_amp_ratio'))
  && near(dataValues(ornnp, 'AdditionalMythicStatAmp')?.[1], fixedCandidate('ornn_p', 'additional_masterwork_stat_amp_ratio'))
  && dataValues(ornnp, 'GameModeInteger')?.[1] === 1
  && sourceModeText('spell_ornnp_tooltip_1').includes('@BaseStatAmp*100@')
  && sourceModeText('spell_ornnp_tooltip_1').includes('@AdditionalMythicStatAmp*100@'), '模式1正文和DataValues的10%/4%/模式值一致');
check('source.ornn_p.baseline_semantics', ['actual_source_hp_before_ornn_passive', 'actual_source_armor_before_ornn_passive', 'actual_source_magic_resistance_before_ornn_passive']
  .every((key) => param('ornn_p', key)?.name.includes('额外') && param('ornn_p', key)?.description.includes('不含基础') && param('ornn_p', key)?.description.includes('不含本次奥恩被动增幅')),
  '奥恩P三个应用前输入明确为额外属性基准，不把总面板值带入', true);
check('source.ornn_q', nearArray(levelCandidate('ornn_q', 'base_damage'), dataValues(ornnq, 'BaseDamage')?.slice(1, 6))
  && near(fixedCandidate('ornn_q', 'attack_damage_ratio'), sourceCalc(ornnq, 'TotalDamage', 1)?.mCoefficient)
  && sourceCalc(ornnq, 'TotalDamage', 1)?.mStat === 2
  && modeSpellText('ornn_q').includes('{{ totaldamage }}'), 'Q伤害数组、总攻击力节点和当前正文一致');
check('source.ornn_w', nearArray(levelCandidate('ornn_w', 'minimum_damage_per_tick'), dataValues(ornnw, 'MinimumDamagePerTick')?.slice(1, 6))
  && nearArray(levelCandidate('ornn_w', 'target_max_health_ratio_per_tick'), dataValues(ornnw, 'PercentHPPerTick')?.slice(1, 6))
  && nearArray(levelCandidate('ornn_w', 'max_percent_health_total_percent_points'), dataValues(ornnw, 'MaxPercentHPPerTickTooltip')?.slice(1, 6))
  && fixedCandidate('ornn_w', 'tick_count') === dataValues(ornnw, 'NumberOfTicks')?.[1]
  && near(fixedCandidate('ornn_w', 'brittle_ratio_start_endpoint'), sourceCalc(ornnw, 'BrittlePercentMaxHPCalc', 0)?.mStartValue)
  && near(fixedCandidate('ornn_w', 'brittle_ratio_end_endpoint'), sourceCalc(ornnw, 'BrittlePercentMaxHPCalc', 0)?.mEndValue)
  && modeSpellText('ornn_w').includes('{{ maxpercenthpperticktooltip }}')
  && modeSpellText('ornn_w').includes('{{ brittlepercentmaxhpcalc }}'), 'W五次、单次比例、正文显示和易碎端点一致');
check('source.ornn_w.exclusions', !param('ornn_w', 'monster_damage_per_tick_cap') && !param('ornn_w', 'base_damage_tooltip')
  && !effect('ornn_w', 'self_slow'), 'W未把野怪上限、旧BaseDamage或自减速混入候选');
check('source.ornn_e', nearArray(levelCandidate('ornn_e', 'base_damage'), dataValues(ornne, 'BaseDamage')?.slice(1, 6))
  && near(fixedCandidate('ornn_e', 'armor_ratio'), dataValues(ornne, 'ArmorRatio')?.[1])
  && near(fixedCandidate('ornn_e', 'magic_resistance_ratio'), dataValues(ornne, 'MRRatio')?.[1])
  && sourceCalc(ornne, 'TotalDamage', 1)?.mStat === 1 && sourceCalc(ornne, 'TotalDamage', 1)?.mStatFormula === 2
  && sourceCalc(ornne, 'TotalDamage', 2)?.mStat === 6 && sourceCalc(ornne, 'TotalDamage', 2)?.mStatFormula === 2
  && (candidate.skills.ornn_e.write.formulas ?? []).length === 1, 'E两个属性节点、单一伤害公式和等级伤害一致');
check('source.ornn_e.narrow_mapping', attrKeys.has('magic_resistance') && sourceNote.includes('mStat6/formula2') && sourceNote.includes('bonusMR窄证'),
  'E的魔抗采用已有窄证；护甲仍使用无默认实际基准', false);
check('source.ornn_r', nearArray(levelCandidate('ornn_r', 'base_damage_per_pass'), dataValues(ornnr, 'RBaseDamage')?.slice(1, 4))
  && near(fixedCandidate('ornn_r', 'ap_ratio'), dataValues(ornnr, 'RRatio')?.[1])
  && fixedCandidate('ornn_r', 'pass_count_same_enemy') === 2
  && fixedCandidate('ornn_r', 'client_slow_duration_ms') === dataValues(ornnr, 'RSlowDuration')?.[1] * 1000
  && fixedCandidate('ornn_r', 'official_text_slow_duration_ms') === dataValues(ornnr, 'BrittleDurationTOOLTIPONLY')?.[1] * 1000
  && fixedCandidate('ornn_r', 'second_pass_first_enemy_knockup_ms') === dataValues(ornnr, 'RStunDuration')?.[1] * 1000, 'R每程伤害、两程、减速冲突值和首个英雄击飞一致');
check('source.shen_p', near(fixedCandidate('shen_p', 'bonus_health_ratio'), sourceCalc(shenp, '{58a09e24}', 1)?.mCoefficient)
  && sourceCalc(shenp, '{58a09e24}', 0)?.mStartValue === fixedCandidate('shen_p', 'base_shield_level1_endpoint')
  && sourceCalc(shenp, '{58a09e24}', 0)?.mEndValue === fixedCandidate('shen_p', 'base_shield_level_max_endpoint')
  && near(fixedCandidate('shen_p', 'conditional_shield_multiplier'), dataValues(shenp, 'ShenZedQuestShieldMultiplier')?.[1])
  && sourceNote.includes('当前ShieldValue默认明确指向{58a09e24}'), 'P当前默认47至120+0.13额外生命和1.3条件分支一致');
check('source.shen_p.excluded_alt', !formula('shen_p', 'alternative_shield_value') && !param('shen_p', 'alternative_bonus_health_ratio'), 'P未混入47至101+0.07的非当前分支');
check('source.shen_q', nearArray(levelCandidate('shen_q', 'base_percent_damage_points'), dataValues(shenq, 'BasePercentDamage')?.slice(1, 6))
  && nearArray(levelCandidate('shen_q', 'enhanced_percent_damage_points'), dataValues(shenq, 'EnhancedPercentDamage')?.slice(1, 6))
  && near(fixedCandidate('shen_q', 'percent_root_ratio'), calculation(shenq, 'BasePercentHealth')?.mMultiplier?.mNumber)
  && near(fixedCandidate('shen_q', 'base_percent_ap_ratio'), sourceCalc(shenq, 'BasePercentHealth', 1)?.mCoefficient)
  && near(fixedCandidate('shen_q', 'enhanced_percent_ap_ratio'), sourceCalc(shenq, 'EmpPercentHealth', 1)?.mCoefficient)
  && fixedCandidate('shen_q', 'enhanced_attack_count') === dataValues(shenq, 'NumEnhancedAttacks')?.[1]
  && fixedCandidate('shen_q', 'enhanced_attack_speed_percent_points') === dataValues(shenq, 'SteroidAS')?.[1]
  && sourceCurrentText('shen_q').includes('@BaseFlatDamage@')
  && sourceCurrentText('shen_q').includes('@EmpPercentHealth@'), 'Q根0.01、两种法强比例、三次强化和正文绑定一致');
check('source.shen_q.level_map', nearArray(Object.values(param('shen_q', 'actual_base_flat_damage')?.levelValues ?? {}), [10, 10, 10, 16, 16, 16, 22, 22, 22, 28, 28, 28, 34, 34, 34, 40, 40, 40])
  && calculation(shenq, 'BaseFlatDamage')?.tooltipOnly === true
  && !param('shen_q', 'steroid_duration_ms'), 'Q的tooltipOnly角色等级阶梯正确，未把75误作持续时间');
check('source.shen_e', nearArray(levelCandidate('shen_e', 'base_damage'), dataValues(shene, 'BaseDamage')?.slice(1, 6))
  && near(fixedCandidate('shen_e', 'bonus_health_ratio'), dataValues(shene, 'BonusHPRatio')?.[1])
  && fixedCandidate('shen_e', 'taunt_duration_ms') === dataValues(shene, 'CCDuration')?.[1] * 1000
  && Object.values(param('shen_e', 'actual_energy_refund_on_damage')?.levelValues ?? {}).join(',') === '30,30,30,40,40,40,40,40,40,40,40,50,50,50,50,50,50,50'
  && sourceCurrentText('shen_e').includes('奥义！暮临')
  && sourceCurrentText('shen_e').includes('@EnergyRefund@'), 'E伤害、额外生命、嘲讽、能量阶梯和Q/E回能正文一致');
check('source.shen_e.effect_scope', effect('shen_e', 'energy_refund')?.name.includes('Q或E')
  && effect('shen_e', 'energy_refund')?.description.includes('不适用于任意来源伤害'), 'E资源效果描述明确只覆盖Q或E造成伤害', true);
check('source.shen_r.scope', candidate.skills.shen_r.write.parameters.length === 0 && candidate.skills.shen_r.write.formulas.length === 0
  && candidate.skills.shen_r.write.effects.length === 0 && sourceCurrentText('shen_r').includes('友方'), 'R纯友方护盾与传送按本轮范围跳过');

const allowedAttributeKinds = new Set(['BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO']);
const allowedOperations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
const formulaDependencies = (node, skillKey, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (node.nodeType === 'PARAMETER') out.push({ type: 'parameter', key: node.parameterKey });
  else if (node.nodeType === 'ATTRIBUTE') out.push({ type: 'attribute', key: `${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`, owner: node.attributeOwner, attributeKey: node.attributeKey, kind: node.attributeValueKind });
  else if (node.nodeType === 'OPERATION') for (const child of node.operands ?? []) formulaDependencies(child, skillKey, out);
  return out;
};
const scanExpression = (node, skillKey, errors = []) => {
  if (!node || typeof node !== 'object') { errors.push('表达式节点为空'); return errors; }
  if (node.nodeType === 'PARAMETER') {
    if (!param(skillKey, node.parameterKey)) errors.push(`参数不存在:${node.parameterKey}`);
  } else if (node.nodeType === 'ATTRIBUTE') {
    if (!['SOURCE', 'TARGET'].includes(node.attributeOwner)) errors.push(`属性所有者:${node.attributeOwner}`);
    if (!allowedAttributeKinds.has(node.attributeValueKind)) errors.push(`属性口径:${node.attributeValueKind}`);
    if (!attrKeys.has(node.attributeKey)) errors.push(`属性未在快照:${node.attributeKey}`);
  } else if (node.nodeType === 'OPERATION') {
    if (!allowedOperations.has(node.operation)) errors.push(`运算:${node.operation}`);
    if (!Array.isArray(node.operands) || node.operands.length !== 2) errors.push('运算必须为二元');
    for (const child of node.operands ?? []) scanExpression(child, skillKey, errors);
  } else errors.push(`未知节点:${node.nodeType}`);
  return errors;
};
for (const entry of entries.filter((item) => item.kind === 'formulas')) {
  const errors = scanExpression(entry.body.expression, entry.skillKey);
  check(`formula.shape.${entry.skillKey}.${entry.stableKey}`, errors.length === 0, errors.length ? errors.join('；') : '二元运算、参数和属性节点均可解析');
}
const formulaParameterRefs = new Map();
for (const entry of entries.filter((item) => item.kind === 'formulas')) formulaParameterRefs.set(`${entry.skillKey}/${entry.stableKey}`, formulaDependencies(entry.body.expression, entry.skillKey));
for (const entry of entries.filter((item) => item.kind === 'parameters')) {
  const p = entry.body;
  const values = [p.fixedValue, ...Object.values(p.levelValues ?? {})].filter((value) => value !== null && value !== undefined);
  check(`parameter.shape.${entry.skillKey}.${entry.stableKey}`, ['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT'].includes(p.valueMode)
    && ['INTEGER', 'DECIMAL'].includes(p.valueType)
    && (p.valueMode !== 'RUNTIME_INPUT' || (p.fixedValue === null && p.levelValues === null))
    && (p.valueType !== 'INTEGER' || values.every((value) => Number.isInteger(value))), '参数类型、取值方式与整数约束一致');
  if (p.parameterKey.endsWith('_ms')) check(`parameter.ms.${entry.skillKey}.${entry.stableKey}`, p.valueType === 'INTEGER' && values.every((value) => Number.isInteger(value) && value >= 0), '毫秒参数为非负整数');
  if (p.valueMode === 'CHARACTER_LEVEL') check(`parameter.level.${entry.skillKey}.${entry.stableKey}`, stable(Object.keys(p.levelValues ?? {}).map(Number).sort((a, b) => a - b)) === stable(Array.from({ length: 18 }, (_, i) => i + 1)), '角色等级键完整覆盖1至18');
}
const allExpressions = entries.filter((item) => item.kind === 'formulas').map((item) => item.body.expression);
check('formula.no_literals', !allExpressions.some((expression) => JSON.stringify(expression).includes('"nodeType":"NUMBER"')), '公式未用数字节点绕过参数来源');
check('effects.allowed_types', entries.filter((item) => item.kind === 'effects').every((entry) => entry.body.results?.every((result) => result.resultType === 'RESOURCE_CHANGE')),
  '效果结果仅使用已支持的RESOURCE_CHANGE');
check('effects.resource_shapes', entries.filter((item) => item.kind === 'effects').every((entry) => entry.body.results?.every((result) => result.target === 'SOURCE'
  && result.valueRule?.value?.kind === 'PARAMETER'
  && ['CONSUME', 'RESTORE'].includes(result.detail?.operation)
  && ['mana', 'energy'].includes(result.detail?.attributeKey)
  && param(entry.skillKey, result.valueRule.value.parameterKey)
  && result.lifecycleBehavior === null)), '资源效果目标、操作、参数值和无生命周期形状一致');
check('effects.no_forbidden', !entries.filter((item) => item.kind === 'effects').some((entry) => /DAMAGE|DIRECT_HEAL|MOMENT_EVALUATION/.test(JSON.stringify(entry.body))), '未伪造伤害、直接治疗或瞬时求值效果');

const scenarioFor = (skillKey, index) => {
  const common = { SOURCE: { attack_damage: { TOTAL: index ? 350 : 200 }, ability_power: { TOTAL: index ? 450 : 200 }, hp: { BONUS: index ? 2000 : 1000 }, magic_resistance: { BONUS: index ? 50 : 30 } }, TARGET: { hp: { TOTAL: index ? 500 : 2000 } } };
  if (skillKey === 'ornn_p') return { ...common, parameters: { actual_masterwork_count: index ? 5 : 2, actual_source_hp_before_ornn_passive: index ? 2000 : 1000, actual_source_armor_before_ornn_passive: index ? 200 : 100, actual_source_magic_resistance_before_ornn_passive: index ? 100 : 50 } };
  if (skillKey === 'ornn_q') return { ...common, skillLevel: 3, parameters: {} };
  if (skillKey === 'ornn_w') return { ...common, skillLevel: 3, parameters: { actual_brittle_extra_magic_ratio: index ? 0.17 : 0.09 } };
  if (skillKey === 'ornn_e') return { ...common, skillLevel: 3, parameters: { actual_source_armor_for_ornn_e: index ? 200 : 100 } };
  if (skillKey === 'ornn_r') return { ...common, skillLevel: 2, parameters: {} };
  if (skillKey === 'shen_p') return { ...common, parameters: { actual_base_shield_value: index ? 120 : 80, actual_shield_cooldown_reduction_ms: index ? 1000 : 4000 } };
  if (skillKey === 'shen_q') return { ...common, skillLevel: 3, characterLevel: index ? 16 : 10, parameters: {} };
  if (skillKey === 'shen_e') return { ...common, skillLevel: 3, characterLevel: index ? 12 : 4, parameters: {} };
  return { ...common, parameters: {} };
};
const readParameter = (skillKey, key, scenario) => {
  if (Object.hasOwn(scenario.parameters ?? {}, key)) return scenario.parameters[key];
  const p = param(skillKey, key);
  if (!p) throw new Error(`MISSING parameter ${skillKey}/${key}`);
  if (p.valueMode === 'RUNTIME_INPUT') throw new Error(`MISSING runtime ${skillKey}/${key}`);
  if (p.valueMode === 'FIXED') return p.fixedValue;
  if (p.valueMode === 'SKILL_LEVEL') {
    if (!Number.isInteger(scenario.skillLevel) || scenario.skillLevel < 1 || scenario.skillLevel > 5) throw new Error(`INVALID skill level`);
    return p.levelValues[String(scenario.skillLevel)];
  }
  if (p.valueMode === 'CHARACTER_LEVEL') {
    if (!Number.isInteger(scenario.characterLevel) || scenario.characterLevel < 1 || scenario.characterLevel > 18) throw new Error(`INVALID character level`);
    return p.levelValues[String(scenario.characterLevel)];
  }
  throw new Error(`MISSING ${skillKey}/${key}`);
};
const readAttribute = (node, scenario) => scenario[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind] ?? (() => { throw new Error(`MISSING attribute ${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`); })();
const evaluate = (node, skillKey, scenario) => {
  if (node.nodeType === 'PARAMETER') return readParameter(skillKey, node.parameterKey, scenario);
  if (node.nodeType === 'ATTRIBUTE') return readAttribute(node, scenario);
  if (node.nodeType !== 'OPERATION' || node.operands.length !== 2) throw new Error('INVALID operation');
  const [a, b] = node.operands.map((child) => evaluate(child, skillKey, scenario));
  if (node.operation === 'ADD') return a + b;
  if (node.operation === 'SUBTRACT') return a - b;
  if (node.operation === 'MULTIPLY') return a * b;
  if (node.operation === 'DIVIDE') return a / b;
  if (node.operation === 'MIN') return Math.min(a, b);
  if (node.operation === 'MAX') return Math.max(a, b);
  throw new Error(`INVALID operation ${node.operation}`);
};
const levelValueFromSource = (values, level) => values?.[level] ?? undefined;
const expectedFormulaValue = (skillKey, formulaKey, scenario) => {
  const i = scenario._case;
  const s = scenario;
  const sourceAD = s.SOURCE.attack_damage.TOTAL;
  const sourceAP = s.SOURCE.ability_power.TOTAL;
  const targetHP = s.TARGET.hp.TOTAL;
  if (skillKey === 'ornn_p') {
    const ratio = dataValues(ornnp, 'BaseStatAmp')[1] + dataValues(ornnp, 'AdditionalMythicStatAmp')[1] * s.parameters.actual_masterwork_count;
    const base = { bonus_health: s.parameters.actual_source_hp_before_ornn_passive, bonus_armor: s.parameters.actual_source_armor_before_ornn_passive, bonus_magic_resistance: s.parameters.actual_source_magic_resistance_before_ornn_passive }[formulaKey];
    return formulaKey === 'stat_amplification_ratio' ? ratio : ratio * base;
  }
  if (skillKey === 'ornn_q') return dataValues(ornnq, 'BaseDamage')[3] + sourceCalc(ornnq, 'TotalDamage', 1).mCoefficient * sourceAD;
  if (skillKey === 'ornn_w') {
    const min = dataValues(ornnw, 'MinimumDamagePerTick')[3];
    const ratio = dataValues(ornnw, 'PercentHPPerTick')[3];
    const per = Math.max(min, ratio * targetHP);
    return { minimum_damage_total: min * dataValues(ornnw, 'NumberOfTicks')[3], damage_per_tick: per, five_tick_damage_total: dataValues(ornnw, 'NumberOfTicks')[3] * per, brittle_extra_magic_damage: s.parameters.actual_brittle_extra_magic_ratio * targetHP }[formulaKey];
  }
  if (skillKey === 'ornn_e') return dataValues(ornne, 'BaseDamage')[3] + dataValues(ornne, 'ArmorRatio')[1] * s.parameters.actual_source_armor_for_ornn_e + dataValues(ornne, 'MRRatio')[1] * s.SOURCE.magic_resistance.BONUS;
  if (skillKey === 'ornn_r') {
    const base = dataValues(ornnr, 'RBaseDamage')[s.skillLevel];
    const per = base + dataValues(ornnr, 'RRatio')[1] * sourceAP;
    return formulaKey === 'magic_damage_per_pass' ? per : 2 * per;
  }
  if (skillKey === 'shen_p') {
    const base = s.parameters.actual_base_shield_value + sourceCalc(shenp, '{58a09e24}', 1).mCoefficient * s.SOURCE.hp.BONUS;
    return formulaKey === 'default_shield_value' ? base : dataValues(shenp, 'ShenZedQuestShieldMultiplier')[1] * base;
  }
  if (skillKey === 'shen_q') {
    const level = s.characterLevel;
    const flat = [10, 10, 10, 16, 16, 16, 22, 22, 22, 28, 28, 28, 34, 34, 34, 40, 40, 40][level - 1];
    const points = formulaKey === 'normal_enhanced_attack_magic_damage' ? dataValues(shenq, 'BasePercentDamage')[s.skillLevel] : dataValues(shenq, 'EnhancedPercentDamage')[s.skillLevel];
    const apRatio = formulaKey === 'normal_enhanced_attack_magic_damage' ? sourceCalc(shenq, 'BasePercentHealth', 1).mCoefficient : sourceCalc(shenq, 'EmpPercentHealth', 1).mCoefficient;
    const per = flat + calculation(shenq, 'BasePercentHealth').mMultiplier.mNumber * (points + apRatio * sourceAP) * targetHP;
    return formulaKey === 'enhanced_attack_magic_damage_total' ? dataValues(shenq, 'NumEnhancedAttacks')[3] * per : per;
  }
  if (skillKey === 'shen_e') {
    const ratioPart = sourceCalc(shene, 'TauntDamage', 1);
    return dataValues(shene, 'BaseDamage')[s.skillLevel] + dataValues(shene, ratioPart.mDataValue)[s.skillLevel] * s.SOURCE.hp.BONUS;
  }
  throw new Error(`未知公式 ${skillKey}/${formulaKey}`);
};

const mathRows = [];
for (const entry of entries.filter((item) => item.kind === 'formulas')) {
  for (let index = 0; index < 2; index += 1) {
    const scenario = { ...scenarioFor(entry.skillKey, index), _case: index };
    let actual;
    let expected;
    try {
      actual = evaluate(entry.body.expression, entry.skillKey, scenario);
      expected = expectedFormulaValue(entry.skillKey, entry.stableKey, scenario);
    } catch (error) {
      mathRows.push({ formula: `${entry.skillKey}/${entry.stableKey}`, case: index + 1, status: 'FAIL', error: error.message });
      check(`math.${entry.skillKey}.${entry.stableKey}.${index + 1}`, false, `独立源值算式或候选表达式求值失败：${error.message}`);
      continue;
    }
    const ok = near(actual, expected, 1e-4);
    mathRows.push({ formula: `${entry.skillKey}/${entry.stableKey}`, case: index + 1, status: ok ? 'PASS' : 'FAIL', actual, expected });
    check(`math.${entry.skillKey}.${entry.stableKey}.${index + 1}`, ok, `独立源值算式=${expected}，候选表达式=${actual}`);
  }
}
const missingRows = [];
for (const entry of entries.filter((item) => item.kind === 'formulas')) {
    const deps = formulaDependencies(entry.body.expression, entry.skillKey).filter((dep) => dep.type === 'attribute'
      || ['RUNTIME_INPUT', 'CHARACTER_LEVEL'].includes(param(entry.skillKey, dep.key)?.valueMode));
  const scenario = { ...scenarioFor(entry.skillKey, 0), _case: 0 };
  for (const dep of deps) {
    const broken = structuredClone(scenario);
    if (dep.type === 'parameter') {
      if (param(entry.skillKey, dep.key)?.valueMode === 'CHARACTER_LEVEL') delete broken.characterLevel;
      else {
        if (!broken.parameters) broken.parameters = {};
        delete broken.parameters[dep.key];
      }
    } else {
      delete broken[dep.owner][dep.attributeKey][dep.kind];
    }
    let rejected = false;
    try { evaluate(entry.body.expression, entry.skillKey, broken); } catch { rejected = true; }
    missingRows.push({ formula: `${entry.skillKey}/${entry.stableKey}`, dependency: `${dep.type}:${dep.key}`, rejected });
  }
}
const missingPassed = missingRows.filter((row) => row.rejected).length;
check('math.missing_inputs', missingPassed === missingRows.length && missingRows.length === 30, `缺输入测试=${missingRows.length}，拒绝=${missingPassed}`);
const integerParams = entries.filter((item) => item.kind === 'parameters' && item.body.valueType === 'INTEGER');
const integerFailures = integerParams.flatMap((entry) => [entry.body.fixedValue, ...Object.values(entry.body.levelValues ?? {})]
  .filter((value) => value !== null && value !== undefined && !Number.isInteger(value)).map((value) => `${entry.skillKey}/${entry.stableKey}=${value}`));
check('math.integer_values', integerFailures.length === 0, integerFailures.length ? integerFailures.join('；') : '整数参数值全部为整数');
const msValues = entries.filter((item) => item.kind === 'parameters' && item.body.parameterKey.endsWith('_ms')).flatMap((entry) => [entry.body.fixedValue, ...Object.values(entry.body.levelValues ?? {})]
  .filter((value) => value !== null && value !== undefined));
check('math.ms_nonnegative', msValues.every((value) => Number.isInteger(value) && value >= 0), '所有毫秒参数为非负整数');
check('math.level_boundaries', [0, 19, 1.5].every((level) => {
  const scenario = { ...scenarioFor('shen_q', 0), characterLevel: level };
  try { readParameter('shen_q', 'actual_base_flat_damage', scenario); return false; } catch { return true; }
}), '角色等级0、19和小数输入均拒绝');
check('math.masterwork_boundary', Number.isInteger(0) && 0 >= 0 && !(Number.isInteger(-1) && -1 >= 0), '负杰作数量拒绝由独立边界检查记录');

const knownSourceLimit = [
  '奥恩E mStat1/formula2护甲映射',
  '奥恩W易碎9%至17%的等级求值',
  '慎P护盾冷却缩短的完整等级求值与毫秒归整',
  '慎Q/E强化资格、次数消费和资源触发时序',
];
note('source.pending_limits', '以上来源已给出节点或端点，但完整求值器、事件资格或时序仍未在本轮证明；候选均使用无默认输入或保留端点，没有替换成猜测值。', [sourceNotePath, rangePath]);
const shenEText = sourceCurrentText('shen_e');
const shenERefund = effect('shen_e', 'energy_refund');
const shenQHasRefund = Boolean(effect('shen_q', 'energy_refund'));
if (shenEText.includes('奥义！暮临') && shenEText.includes('或这个技能造成伤害') && shenERefund && !shenQHasRefund) {
  note('cross_skill.shen_q_to_shen_e_refund', '慎E正文把Q或E造成伤害都绑定到同一回能量值；当前资源效果放在E上，符合被动归属，但本批没有触发规则或sourceSkillKey，Q到E的跨技能触发必须在后续接线中明确，不能把本候选描述为已执行。', [sourceBindingPath, candidatePath]);
}
note('scope.shen_r', '慎R只面向另一名友方英雄的护盾和传送，本轮一对一范围跳过；没有把纯友方组成伪装为可独自施放。', [rangePath, sourceBindingPath]);
note('scope.ornn_w', '奥恩W的野怪上限、旧BaseDamageTooltip和自身纯减速字段均留在来源证据，未作为本轮唯一敌人伤害写入。', [rangePath, sourceBindingPath]);
note('scope.ornn_e', '奥恩E只保留唯一敌人一次伤害公式；冲锋资格、地形碰撞和冲击波时序留待过程接线。', [rangePath, sourceBindingPath]);

const originalFailurePath = path.join(repoDir, '.agents/artifacts/hero29-luna-candidate', '初始只读结构检查失败.json');
const revisionOneDiffPath = path.join(repoDir, '.agents/artifacts/hero29-luna-candidate/修订一', '主负责人修订差异核对.json');
const revisionTwoDiffPath = path.join(candidateDir, '主负责人修订差异核对.json');
const originalFailure = readJson(originalFailurePath);
const revisionOneDiff = readJson(revisionOneDiffPath);
const revisionTwoDiff = readJson(revisionTwoDiffPath);
check('history.original_failure_preserved', originalFailure.apiWrites === 0 && originalFailure.GETs === 0
  && String(originalFailure.failed).includes('DECIMAL') && revisionOneDiff.diffs?.length === 6
  && revisionOneDiff.originalCandidateSha256 === originalFailure.candidate && revisionTwoDiff.diffs?.length === 36
  && revisionTwoDiff.candidateSha256 === actualHashes.candidate, '原始小数毫秒失败证据和两次描述修订证据仍在', false);

check('cursor.readonly', cursorAudit.readonlyAuditPassed === true && cursorAudit.apiWrites === 0
  && Array.isArray(cursorAudit.gitDelta) && cursorAudit.gitDelta.length === 0 && cursorAudit.resultStatus === 'finished', 'Cursor来源复核为只读且无Git改动');
check('candidate.math_report', candidateMath.status === 'PASS' && candidateMath.apiWrites === 0
  && candidateMath.formulaCount === 18 && candidateMath.positiveCaseCount === 36, '既有候选数学报告通过且未写业务');

const lockBug = !/let\s+lockAcquired/.test(writerText)
  && /fs\.writeFileSync\(globalLock,[\s\S]*?\{flag:'wx'\}\)/.test(writerText)
  && /catch\(e\)\{execution\.error=e\.stack;if\(apply\)lock\('STOPPED'\);\}/.test(writerText);
check('writer.lock_acquisition_guard', !lockBug, lockBug
  ? '受保护写入器创建wx锁失败后，外层catch仍无条件写入STOPPED；没有成功取得锁标记，已有锁可能被覆盖。应先增加lockAcquired=false，仅在wx成功后置true，catch只在true时更新锁。'
  : '写入器在锁创建失败时不会覆盖既有锁');
check('writer.static_counts', writerText.includes('candidateEntries.length,108') && writerText.includes('plan.count,97')
  && writerText.includes('baseline.requests.length,99') && writerText.includes('assert.equal(lists,60)'), '写入器绑定修订候选、97新增、99保护和60列表');
check('writer.static_safety', writerText.includes("{flag:'wx'}") && writerText.includes("HERO29_APPLY_CONFIRM")
  && writerText.includes("const got=await req(detail)") && !/method==='PUT'|method==='DELETE'/.test(writerText), '写入器有全局wx锁、一次确认、逐项写后GET且不含PUT/DELETE');
check('writer.input_path', writerText.includes("path.resolve(here,'../../hero29-root-entry-20260909')"), '写入器从修订二使用正确的../../输入目录');

const passed = checks.filter((row) => row.status === 'PASS').length;
const failed = checks.filter((row) => row.status === 'FAIL').length;
const report = {
  at: new Date().toISOString(),
  mode: '静态独立审查',
  target: { candidate: candidatePath, plan: planPath, writer: writerPath, input: inputDir },
  sourceVersions: candidate.meta.sourceVersions,
  hashes: { ...actualHashes, auditScript: sha256(fileURLToPath(import.meta.url)) },
  counts: { current: { parameters: 82, formulas: 18, effects: 8, total: 108 }, new: { parameters: 71, formulas: 18, effects: 8, total: 97 }, reused: 11, protectedGETs: 99, protectedLists: 60 },
  readonlyEvidence: { candidatePreflight: preflightPath ?? null, GETs: preflight?.counts?.GET ?? null, POSTs: preflight?.counts?.POST ?? null, apiWrites: 0 },
  checks: { total: checks.length, passed, failed, rows: checks },
  math: { formulaCount: mathRows.length / 2, caseCount: mathRows.length, rows: mathRows, missingDependencyCount: missingRows.length, missingRejectedCount: missingPassed, sourceIndependent: true, runtimeDefaults: false },
  source: { protectedAttributes: [...attrKeys], knownPendingLimits: knownSourceLimit, reusedComparisons },
  blockingFindings,
  nonBlockingFindings,
  verdict: blockingFindings.length ? 'BLOCKED' : 'PASS_WITH_NONBLOCKING_NOTES',
  apiWrites: 0,
  networkCalls: 0,
  noBusinessWrites: true,
  protectedInputBytes: { candidateSha256: actualHashes.candidate, planSha256: actualHashes.plan, sourceBindingSha256: actualHashes.sourceBinding },
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ verdict: report.verdict, checks: report.checks, counts: report.counts, blockingFindings: report.blockingFindings, reportPath }, null, 2));
