import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const batchDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(batchDirectory, '..', '..', '..', '..');
const backendRoot = path.resolve(repoRoot, '..', 'damage_backend_dev');
const outputFile = path.join(batchDirectory, '02-纯GET核对.json');
const browserFile = path.join(batchDirectory, '03-页面验收.json');
const manifestFile = path.join(batchDirectory, '04-证据清单.json');
const mode = process.argv[2];
if (!['capture', 'manifest'].includes(mode)) throw new Error('用法：node 只读核对.mjs capture|manifest');

const targets = [
  {
    skillKey: 'vi_q',
    skillName: '蔚·强能冲拳',
    ownerKey: 'champion_vi',
    sourceFile: '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第七批/完整候选.json',
    sourceSha256: 'b3908f6740ea02c32828e52044b78f4c6ed080fea7d7a3e6188641fcf3766b35',
    conclusion: '资料待核',
    entryDisposition: '系统暂缓',
    reason: '当前过程只表示蓄力开始且没有普通冷却；SKILL_USED无法区分蓄力开始、正常释放和取消，不能决定法力、正常冷却、取消冷却与返还的唯一时点。'
  },
  {
    skillKey: 'lux_e',
    skillName: '拉克丝·透光奇点',
    ownerKey: 'champion_lux',
    sourceFile: '数据参考/全量录入-2026-09/交叉试录/Cursor/拉克丝机制第一批/候选.json',
    sourceSha256: 'd12ce83ef0a000c8b854045d7065089cf43687818d617ddbb8968829f6baf9fd',
    conclusion: '系统暂缓',
    entryDisposition: '系统暂缓',
    reason: '首次施放生成区域，再次施放或到期才爆炸；SKILL_USED无法区分首次与再次施放，无条件启动cast会在再次施放时重复成本与冷却。'
  },
  {
    skillKey: 'warwick_e',
    skillName: '沃里克·远祖嗥叫',
    ownerKey: 'champion_warwick',
    sourceFile: '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第五批/完整候选.json',
    sourceSha256: '45a9e350cee18e57166d7de166dbcc44035e32b4a224da749e7d2189f96f6fef',
    conclusion: '系统暂缓',
    entryDisposition: '系统暂缓',
    reason: '首次施放开始减伤，再次施放或自然结束只应嗥叫一次且不重付初次成本；SKILL_USED无法区分这些阶段。'
  },
  {
    skillKey: 'jax_e',
    skillName: '贾克斯·反击风暴',
    ownerKey: 'champion_jax',
    sourceFile: '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第六批/完整候选.json',
    sourceSha256: 'a593bd1f49c1ab6f424bd76b7ad4dbef1e0e7154f00d0347dc90c7c1e39126ac',
    conclusion: '系统暂缓',
    entryDisposition: '系统暂缓',
    reason: '首次施放开始防御，再次施放或自然结束触发一次反击；SKILL_USED无法区分首次与再次施放，无条件启动cast会错误重付成本并重启冷却。'
  }
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function stripManaged(value) {
  if (Array.isArray(value)) return value.map(stripManaged);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['createdAt', 'updatedAt', 'gameId', 'skillKey'].includes(key))
    .map(([key, item]) => [key, stripManaged(item)]));
}

const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = file => shaBytes(fs.readFileSync(file));
const canonicalSha = value => shaBytes(JSON.stringify(canonical(value)));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const lineOf = (text, needle) => text.slice(0, text.indexOf(needle)).split(/\r?\n/).length;

async function mapLimit(values, limit, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await worker(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
  return output;
}

function sourceProcess(target) {
  const file = path.join(repoRoot, ...target.sourceFile.split('/'));
  assert.equal(fileSha(file), target.sourceSha256, '固定来源散列漂移：' + target.sourceFile);
  const skill = readJson(file).skills[target.skillKey];
  assert(skill, '固定来源缺少技能：' + target.skillKey);
  const process = skill.write.processes.find(item => item.processKey === 'cast');
  assert(process, '固定来源缺少cast过程：' + target.skillKey);
  return { file, skill, process };
}

function staticContractEvidence() {
  const files = [
    { root: repoRoot, relativePath: 'web/src/types/skillTriggerRule.ts' },
    { root: repoRoot, relativePath: 'web/src/pages/admin/skills/triggers/triggerRuleForm.ts' },
    { root: backendRoot, relativePath: 'server/data_manage/src/main/java/xyz/game/datamanage/model/skilltrigger/SkillTriggerSkillEventDetail.java' },
    { root: backendRoot, relativePath: 'server/data_manage/src/main/java/xyz/game/datamanage/service/skilltrigger/SkillTriggerRuleService.java' }
  ].map(item => {
    const file = path.join(item.root, ...item.relativePath.split('/'));
    return { ...item, file, text: fs.readFileSync(file, 'utf8'), sha256: fileSha(file) };
  });
  const [webType, webForm, backendDetail, backendService] = files;
  const usedType = webType.text.match(/export type SkillTriggerSkillUsedEventDetail = \{([\s\S]*?)\};/)?.[1];
  assert(usedType?.includes('sourceSkillKey: string | null;'));
  assert(usedType?.includes('useKind: SkillTriggerEventUseKind;'));
  assert(!/(phase|stage|recast|cancel)/i.test(usedType));
  const usedForm = webForm.text.slice(webForm.text.indexOf('SKILL_USED: {'), webForm.text.indexOf('BASIC_ATTACK_START: {'));
  assert(usedForm.includes("detailFields: ['sourceSkillKey', 'useKind']"));
  assert(!/(phase|stage|recast|cancel)/i.test(usedForm));
  assert(backendDetail.text.includes('String sourceSkillKey,'));
  assert(backendDetail.text.includes('SkillTriggerEventUseKind useKind,'));
  assert(backendDetail.text.includes('@JsonAnySetter Map<String, JsonNode> unknown'));
  assert(backendService.text.includes('collectDetailNoise(bodyIssues, "eventSource.detail"'));
  assert(backendService.text.includes('throwIfInvalidBody(bodyIssues);'));
  assert(backendService.text.includes('"UNKNOWN_FIELD", "明细包含未知字段"'));
  return {
    status: 'PASS',
    conclusion: '当前SKILL_USED只保存sourceSkillKey和useKind；没有施放阶段字段，未知字段会在后端写入校验中被拒绝。',
    files: [
      { worktree: 'damage_web_dev', relativePath: webType.relativePath, sha256: webType.sha256, line: lineOf(webType.text, 'export type SkillTriggerSkillUsedEventDetail') },
      { worktree: 'damage_web_dev', relativePath: webForm.relativePath, sha256: webForm.sha256, line: lineOf(webForm.text, 'SKILL_USED: {') },
      { worktree: 'damage_backend_dev', relativePath: backendDetail.relativePath, sha256: backendDetail.sha256, line: lineOf(backendDetail.text, 'public record SkillTriggerSkillEventDetail') },
      { worktree: 'damage_backend_dev', relativePath: backendService.relativePath, sha256: backendService.sha256, lines: [lineOf(backendService.text, 'collectDetailNoise(bodyIssues, "eventSource.detail"'), lineOf(backendService.text, 'throwIfInvalidBody(bodyIssues);'), lineOf(backendService.text, '"UNKNOWN_FIELD", "明细包含未知字段"')] }
    ]
  };
}

async function capture() {
  if (fs.existsSync(outputFile)) throw new Error('02-纯GET核对.json 已存在，拒绝覆盖。');
  const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
  if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
  const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
  const log = [];
  async function request(relativePath) {
    const response = await fetch(baseUrl + relativePath, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    log.push({ method: 'GET', path: relativePath, status: response.status });
    return { status: response.status, data };
  }
  async function get(relativePath) {
    const result = await request(relativePath);
    assert.equal(result.status, 200, relativePath + ' 状态不符');
    return result.data;
  }
  const skills = await get('/skills');
  assert.equal(skills.total, 1062);
  assert.equal(skills.items.length, 1062);
  const rows = await mapLimit(skills.items, 8, async skill => {
    const key = encodeURIComponent(skill.skillKey);
    const [rules, processes] = await Promise.all([get('/skills/' + key + '/trigger-rules'), get('/skills/' + key + '/processes')]);
    return { skillKey: skill.skillKey, name: skill.name, rules, processes };
  });
  const candidates = rows.filter(item => item.rules.length === 0 && item.processes.some(process => process.activationType === 'ACTIVE'))
    .map(item => ({ skillKey: item.skillKey, name: item.name, processes: stripManaged(item.processes) }))
    .sort((left, right) => left.skillKey.localeCompare(right.skillKey));
  assert.deepEqual(candidates.map(item => item.skillKey), ['jax_e', 'lux_e', 'vi_q', 'warwick_e']);
  const allRules = rows.flatMap(item => item.rules);
  assert.equal(allRules.length, 168);
  assert.equal(allRules.filter(item => item.eventType === 'SOURCE_INITIALIZED').length, 29);
  const details = [];
  for (const target of targets) {
    const source = sourceProcess(target);
    const prefix = '/skills/' + encodeURIComponent(target.skillKey);
    const [process, relation, image, missingRule] = await Promise.all([
      get(prefix + '/processes/cast'),
      get('/character-skill-relations?skillKey=' + encodeURIComponent(target.skillKey)),
      get(prefix + '/representative-image'),
      request(prefix + '/trigger-rules/on_used')
    ]);
    assert.equal(missingRule.status, 404, target.skillKey + '目标规则应为404');
    assert.deepEqual(canonical(stripManaged(process)), canonical(source.process), target.skillKey + '过程与固定来源不符');
    assert.equal(relation.total, 1);
    assert.equal(relation.items[0].characterKey, target.ownerKey);
    assert.equal(image.image?.enabled, true);
    details.push({
      ...target,
      sourceOpenItems: source.skill.pending ?? source.skill.skipped ?? [],
      sourceExcluded: source.skill.excluded ?? [],
      process: stripManaged(process),
      processSha256: canonicalSha(source.process),
      ruleListCount: 0,
      ruleDetailStatus: 404,
      relation: { total: relation.total, characterKey: relation.items[0].characterKey, skillStatus: relation.items[0].skillStatus },
      representativeImage: { imageKey: image.image.imageKey, enabled: image.image.enabled }
    });
  }
  assert.equal(log.length, 2141);
  assert(log.every(item => item.method === 'GET'));
  const statusCounts = {};
  for (const item of log) statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  assert.deepEqual(statusCounts, { 200: 2137, 404: 4 });
  const output = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    businessWrites: 0,
    requestAudit: { getCount: log.length, statusCounts, nonGetRequests: [] },
    current: { skillCount: skills.total, ruleCount: allRules.length, sourceInitializedCount: 29, activeProcessWithoutRuleCount: candidates.length, candidates },
    staticContract: staticContractEvidence(),
    targets: details,
    boundary: '四项只因当前施放阶段不可区分而关闭简单入口候选；不删除已有过程，不写规则，不改变整技能唯一结论。'
  };
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: output.status, getCount: log.length, skillCount: skills.total, ruleCount: allRules.length, sourceInitializedCount: 29, candidates: candidates.map(item => item.skillKey), targetCount: details.length, staticContract: output.staticContract.conclusion, businessWrites: 0 }, null, 2));
}

function manifest() {
  if (fs.existsSync(manifestFile)) throw new Error('04-证据清单.json 已存在，拒绝覆盖。');
  const capture = readJson(outputFile);
  const browser = readJson(browserFile);
  assert.equal(capture.status, 'PASS');
  assert.equal(capture.requestAudit.getCount, 2141);
  assert.equal(capture.current.activeProcessWithoutRuleCount, 4);
  assert.equal(capture.businessWrites, 0);
  assert.equal(browser.status, 'PASS');
  assert.equal(browser.targetCount, 4);
  assert.equal(browser.businessWrites, 0);
  assert.equal(browser.nonGetRequests, 0);
  assert.equal(browser.consoleErrors, 0);
  assert.equal(browser.consoleWarnings, 0);
  assert.equal(browser.pageErrors, 0);
  assert.equal(browser.failedRequests, 0);
  assert(browser.targets.every(item => item.matched && item.ruleListCount === 0));
  const names = ['01-核对说明.md', 'README.md', '只读核对.mjs', '02-纯GET核对.json', '03-页面验收.json', '核对体验报告.md'];
  const output = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    scope: '蔚Q、拉克丝E、沃里克E和贾克斯E复杂施法过程入口暂缓核对',
    current: capture.current,
    requestAudit: capture.requestAudit,
    staticContract: capture.staticContract,
    browser: { targetCount: browser.targetCount, screenshots: browser.screenshots.length, consoleErrors: browser.consoleErrors, consoleWarnings: browser.consoleWarnings, pageErrors: browser.pageErrors, failedRequests: browser.failedRequests, businessWrites: browser.businessWrites },
    conclusions: capture.targets.map(item => ({ skillKey: item.skillKey, conclusion: item.conclusion, entryDisposition: item.entryDisposition, reason: item.reason })),
    files: names.map(name => ({ name, sha256: fileSha(path.join(batchDirectory, name)), byteSize: fs.statSync(path.join(batchDirectory, name)).size })),
    boundary: capture.boundary
  };
  fs.writeFileSync(manifestFile, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: output.status, scope: output.scope, getCount: output.requestAudit.getCount, candidates: output.current.candidates.map(item => item.skillKey), browser: output.browser, conclusions: output.conclusions, fileCount: output.files.length }, null, 2));
}

if (mode === 'capture') await capture();
else manifest();
