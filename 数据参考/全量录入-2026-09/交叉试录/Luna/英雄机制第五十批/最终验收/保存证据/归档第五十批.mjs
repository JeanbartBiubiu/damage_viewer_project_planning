import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const artifactRoot = path.join(root, '.agents', 'artifacts');
const batchRoot = path.join(
  root,
  '数据参考',
  '全量录入-2026-09',
  '交叉试录',
  'Luna',
  '英雄机制第五十批',
);
const finalRoot = path.join(batchRoot, '最终验收');

const sources = {
  candidate: path.join(artifactRoot, 'hero50-luna-candidate'),
  fixedInput: path.join(artifactRoot, 'hero50-root-entry-20260910'),
  rootAudit: path.join(artifactRoot, 'hero50-final-root-audit'),
  save: path.join(artifactRoot, 'hero50-root-execution'),
  independent: path.join(artifactRoot, 'hero50-independent-review'),
  math: path.join(artifactRoot, 'hero50-independent-source-math'),
  cursor: path.join(artifactRoot, 'hero50-cursor-review-run-20260910'),
};

const expectedHashes = {
  candidate: '0ce76bd47383a74900ed3c2b6e3a7a070c3608c741c30016595ecad0b56b5dba',
  plan: '403cf72c8dc50c1e203d1a5fdf1fccb8b0b4a6253e9c19865095909af12ba69f',
  math: '3670d59bc151c9ecdd459a7b0f6c13a85862e3a8b2742a9a0fab7cb9e05acec9',
};

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

for (const [name, source] of Object.entries(sources)) {
  const sourceStat = await stat(source).catch(() => null);
  assert(sourceStat?.isDirectory(), `缺少归档来源：${name}`);
}
assert(!(await stat(finalRoot).catch(() => null)), '最终验收目录已存在，拒绝覆盖');

const candidateFile = path.join(sources.candidate, '修订二', '完整候选.json');
const planFile = path.join(sources.candidate, '修订二', '请求计划.json');
const writerResultFile = path.join(
  sources.save,
  '实际写入',
  '2026-09-10T06-23-10-502Z',
  '执行结果.json',
);
const preflightFile = path.join(
  sources.save,
  '只读预检',
  '2026-09-10T06-22-18-647Z',
  '执行结果.json',
);
const independentFile = path.join(
  sources.independent,
  '实际回读',
  '2026-09-10T13-47-55-982Z',
  '独立全量GET.json',
);
const mathFile = path.join(sources.math, '独立数学报告.json');
const pageFile = path.join(sources.save, '页面验收.json');
const cursorAuditFile = path.join(sources.cursor, '主负责人执行审计.json');

assert((await sha256(candidateFile)) === expectedHashes.candidate, '修订二候选散列变化');
assert((await sha256(planFile)) === expectedHashes.plan, '修订二计划散列变化');
assert((await sha256(mathFile)) === expectedHashes.math, '实际数学报告散列变化');

const candidate = await readJson(candidateFile);
const writer = await readJson(writerResultFile);
const preflight = await readJson(preflightFile);
const independent = await readJson(independentFile);
const math = await readJson(mathFile);
const pages = await readJson(pageFile);
const cursor = await readJson(cursorAuditFile);

assert(candidate.counts.newTotal === 170, '候选新增数量不是170');
assert(candidate.counts.protectedExistingComponents === 120, '保护组成数量不是120');
assert(candidate.counts.conceptualAllComponents === 290, '最终组成数量不是290');
assert(writer.success === true && writer.apiWrites === 170 && writer.confirmed === 170, '实际保存未完整通过');
assert(writer.counts.GET === 1504 && writer.counts.POST === 170, '实际保存请求计数不符');
assert(preflight.success === true && preflight.counts.GET === 582 && preflight.apiWrites === 0, '只读预检不符');
assert(independent.status === 'PASS' && independent.actual.calls === 582, '独立回读不通过');
assert(independent.actual.statuses['200'] === 582 && independent.failures.length === 0, '独立回读存在失败');
assert(independent.actual.protectionPassed === 292 && independent.actual.detailsPassed === 290, '独立保护或详情不完整');
assert(math.status === 'PASS' && math.actualGETCoverage.calls === 582, '实际数学核验不通过');
assert(math.formulaChecks.formulaCount === 24 && math.formulaChecks.scenarioCount === 48, '公式数学覆盖不符');
assert(math.effectChecks.finalValueCount === 52, '效果最终值覆盖不符');
assert(pages.status === 'PASS' && pages.representativePages.length === 4, '页面验收不完整');
assert(cursor.readonlyAuditPassed === true && cursor.gitDelta.length === 0, 'Cursor只读审计不通过');

await mkdir(finalRoot, { recursive: true });
await cp(sources.candidate, path.join(finalRoot, '候选过程'), { recursive: true, force: false, errorOnExist: true });
await cp(sources.fixedInput, path.join(finalRoot, '固定来源输入'), { recursive: true, force: false, errorOnExist: true });
await cp(sources.rootAudit, path.join(finalRoot, '主负责人逐效果审计'), { recursive: true, force: false, errorOnExist: true });
await cp(sources.save, path.join(finalRoot, '保存证据'), { recursive: true, force: false, errorOnExist: true });
await cp(sources.independent, path.join(finalRoot, '独立回读证据'), { recursive: true, force: false, errorOnExist: true });
await cp(sources.math, path.join(finalRoot, '实际数学证据'), { recursive: true, force: false, errorOnExist: true });

const cursorDest = path.join(finalRoot, 'Cursor来源审计');
await mkdir(cursorDest, { recursive: true });
for (const entry of await readdir(sources.cursor, { withFileTypes: true })) {
  if (entry.isFile()) {
    await cp(path.join(sources.cursor, entry.name), path.join(cursorDest, entry.name), {
      force: false,
      errorOnExist: true,
    });
  }
}

const currentState = {
  at: new Date().toISOString(),
  batch: '英雄机制第五十批',
  status: '来源明确组成已保存；受保护写入、独立回读、实际数学和四个代表页面通过；未证事件与四个乌迪尔效果继续单列',
  heroes: ['Udyr', 'Azir', 'Ashe', 'Ezreal'],
  skills: candidate.order,
  newCounts: {
    parameters: 120,
    formulas: 24,
    effects: 26,
  },
  protectedCounts: {
    parameters: 79,
    formulas: 8,
    effects: 16,
    processes: 4,
    internalStates: 0,
    triggerRules: 13,
  },
  created: 170,
  businessWrites: 170,
  protectedExistingComponents: 120,
  currentTotalComponents: 290,
  candidateFile: '最终验收/候选过程/修订二/完整候选.json',
  candidateFileSha256: expectedHashes.candidate,
  writePlan: '最终验收/候选过程/修订二/请求计划.json',
  writePlanSha256: expectedHashes.plan,
  save: {
    readonlyPreflight: {
      GETs: 582,
      status200: 412,
      expectedMissing404: 170,
      businessWrites: 0,
      file: '最终验收/保存证据/只读预检/2026-09-10T06-22-18-647Z/执行结果.json',
    },
    actual: {
      GETs: 1504,
      status200: 1164,
      expectedMissing404: 340,
      POSTs: 170,
      successfulPOSTs: 170,
      confirmedUnique: 170,
      unexpectedFailures: 0,
      file: '最终验收/保存证据/实际写入/2026-09-10T06-23-10-502Z/执行结果.json',
    },
  },
  independentReadback: {
    GETs: 582,
    status200: 582,
    protectionRoutes: 292,
    protectionPassed: 292,
    reusedDetails: 120,
    newDetails: 170,
    details: 290,
    detailsPassed: 290,
    failures: 0,
    file: '最终验收/独立回读证据/实际回读/2026-09-10T13-47-55-982Z/独立全量GET.json',
    sha256: await sha256(independentFile),
  },
  strictMath: {
    reusedIndependentGETs: 582,
    extraGETs: 0,
    actualDetails: 290,
    formulas: 24,
    formulaCases: 48,
    effects: 26,
    effectValueCases: 52,
    missingParameterCasesRejected: 24,
    missingRuntimeCasesRejected: 9,
    integerParameters: 57,
    integerValues: 92,
    file: '最终验收/实际数学证据/独立数学报告.json',
    sha256: expectedHashes.math,
    passed: true,
  },
  browser: {
    representativePages: 4,
    skills: ['udyr_w', 'ashe_q', 'azir_e', 'ez_r'],
    businessWrites: 0,
    file: '最终验收/保存证据/页面验收.json',
    passed: true,
  },
  cursorAudit: {
    verdict: 'READY',
    reviewedPlanRevision: cursor.reviewedPlanRev,
    events: cursor.events,
    uniqueTools: cursor.uniqueTools,
    inputsChecked: cursor.inputsChecked,
    apiWrites: cursor.apiWrites,
    gitDelta: cursor.gitDelta,
  },
  experienceIssues: [
    {
      issue: '新参数规则不能倒查旧参数类型',
      detail: '初版写入器把本批新增的毫秒整数规则误用于14个受保护旧小数参数，静态检查在任何接口请求前终止；修订后只检查新增参数，旧对象仍按保护快照逐项回读。',
    },
    {
      issue: '稳定标识必须按真实对象使用',
      detail: '伊泽瑞尔角色与技能沿用现有 ez、ez_p 至 ez_r，不能凭英雄英文名猜成 ezreal_r；页面验收按实际稳定标识完成。',
    },
    {
      issue: '可证明公式不等于可证明效果资格',
      detail: '乌迪尔Q三项普攻伤害与R脉冲已有参数和公式，但缺逐效果法术护盾证据，因此四个效果未进入正常保存集。',
    },
  ],
  pending: [
    '乌迪尔Q standard_on_hit、standard_max_health_hit、empowered_max_health_hit 与乌迪尔R pulse_damage等待逐效果法术护盾证据；参数和公式已经保存。',
    '未知等级曲线、触发次数、事件阶段与完整姿态切换不填默认值。',
    '阿兹尔太阳圆盘与持续士兵链、艾希E视野、伊泽瑞尔R沿途多目标衰减均按本轮1V1范围排除。',
    '静态保存、数学与页面检查不表示战斗运行时已经通过。',
  ],
  runtimeValidation: '未执行',
};

await writeFile(
  path.join(batchRoot, '当前实录状态.json'),
  `${JSON.stringify(currentState, null, 2)}\n`,
  'utf8',
);

const readme = `# 英雄机制第五十批\n\n本批覆盖乌迪尔、阿兹尔、艾希、伊泽瑞尔共20个技能槽，固定客户端16.17和官方16.17.1来源。伊泽瑞尔沿用已有组成，本批新增集中在乌迪尔、阿兹尔与艾希的当前1V1范围。\n\n最终保存120个参数、24个公式和26个效果，共170项；另有120项旧组成受保护，20个技能槽当前共290项。保存前582次只读请求、保存阶段1504次读取与170次新增、独立582次读取、24个公式48个场景、26个效果52个最终值，以及乌迪尔W、艾希Q、阿兹尔E、伊泽瑞尔R四个真实页面均通过。\n\n四个乌迪尔普攻相关效果缺逐效果法术护盾证据，没有用空值或合法枚举代替未知；其参数、公式和来源证据已经保留。阿兹尔完整士兵链、艾希E纯视野、伊泽瑞尔R沿途多目标衰减不属于本轮1V1最小范围。\n\n首次写入器把新增毫秒参数的整数规则错误套到14个旧小数参数上，静态检查在接口调用前停止；修订后仅约束本批新增参数，随后完整保存和回读均通过。\n\n入口：当前实录状态.json、最终验收/候选过程/修订二/完整候选.json、最终验收/保存证据、最终验收/独立回读证据、最终验收/实际数学证据、最终验收/Cursor来源审计。\n\n这些证据证明来源、请求、数据库回读和管理页面一致，不表示战斗运行时已经执行。\n`;
await writeFile(path.join(batchRoot, 'README.md'), readme, 'utf8');
await writeFile(path.join(batchRoot, '.gitattributes'), '*.md whitespace=-blank-at-eol\n', 'utf8');

const collectFiles = async (directory, base = directory) => {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(full, base));
    else if (entry.isFile() && entry.name !== '归档核对.json') {
      result.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return result;
};

const paths = (await collectFiles(batchRoot)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
const manifest = [];
for (const relative of paths) {
  manifest.push({ path: relative, sha256: await sha256(path.join(batchRoot, relative)) });
}

await writeFile(
  path.join(batchRoot, '归档核对.json'),
  `${JSON.stringify({
    at: new Date().toISOString(),
    files: manifest.length,
    manifest,
    candidateFileSha256: expectedHashes.candidate,
    planFileSha256: expectedHashes.plan,
    independentReadbackSha256: await sha256(independentFile),
    mathReportSha256: expectedHashes.math,
    businessWritesDuringArchive: 0,
  }, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify({
  status: 'PASS',
  batchRoot,
  files: manifest.length + 1,
  candidateSha256: expectedHashes.candidate,
  planSha256: expectedHashes.plan,
  independentReadbackSha256: await sha256(independentFile),
  mathReportSha256: expectedHashes.math,
}, null, 2));
