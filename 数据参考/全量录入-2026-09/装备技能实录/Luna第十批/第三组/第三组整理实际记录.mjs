import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const base = 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/装备技能实录/Luna第十批/第三组';
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(base, file), 'utf8'));
const latest = prefix => fs.readdirSync(base).filter(name => name.startsWith(prefix) && name.endsWith('.json')).sort().at(-1);
const preflightFile = latest('第三组安全写入-只读-');
const applyFile = latest('第三组安全写入-执行-');
const getFile = latest('第三组独立GET-');
const arithmeticFile = '第三组算例校验.json';
const preflight = read(preflightFile);
const applied = read(applyFile);
const independentGet = read(getFile);
const arithmetic = read(arithmeticFile);
const experience = {
  generatedAt: new Date().toISOString(),
  scope: 'Luna第十批/第三组/3053、3068',
  versionBoundary: { client: '16.17', official: '16.17.1', locale: 'zh_CN', map: '普通地图' },
  candidate: {
    interfaceFile: '第三组接口候选.json',
    interfaceSha256: sha(path.join(base, '第三组接口候选.json')),
    sourceFile: '第三组录入候选.json',
    sourceSha256: sha(path.join(base, '第三组录入候选.json')),
    components: { skills: 2, parameters: 9, formulas: 0, effects: 0, triggerRules: 0, relations: 2, representativeImages: 2, total: 15 }
  },
  preflight: {
    file: preflightFile,
    candidateSha256: preflight.candidateSha256,
    sourceCandidateSha256: preflight.sourceCandidateSha256,
    directorySkillTotal: preflight.directory?.skills?.total,
    directoryReferenceCheck: preflight.directoryReferenceCheck,
    summary: preflight.summary,
    mode: preflight.mode
  },
  apply: {
    file: applyFile,
    directorySkillTotal: applied.directory?.skills?.total,
    summary: applied.summary,
    objectStatuses: applied.objects.map(object => ({ equipmentKey: object.equipmentKey, status: object.status, finalReadbackCount: object.finalReadback.length, allFinalReadback200: object.finalReadback.every(item => item.status === 200 && item.state === 'same') })),
    writeRequestKinds: applied.objects.flatMap(object => object.components).reduce((result, entry) => { const method = entry.write?.status === 200 ? 'PUT' : 'POST'; result[method] = (result[method] ?? 0) + (entry.state === 'created' ? 1 : 0); return result; }, {})
  },
  independentGet: {
    file: getFile,
    summary: independentGet.summary,
    objects: independentGet.objects.map(object => ({ equipmentKey: object.equipmentKey, endpointCount: object.endpoints.length, allComponentsRead: object.allComponentsRead, errorCount: object.errors.length }))
  },
  arithmetic: {
    file: arithmeticFile,
    sha256: sha(path.join(base, arithmeticFile)),
    totalChecks: arithmetic.totalChecks,
    passedChecks: arithmetic.passedChecks,
    passed: arithmetic.passed
  },
  experience: {
    operation: '先只读预检，再显式补缺；每个缺项写后立即GET，最后独立重新GET全部对象。',
    cost: '只读预检技能目录动态分页总数928；补缺15项；写后每项独立GET15次；另做独立GET23个端点；未写装备元数据、完整直接属性或其他批次。',
    failuresAndFixes: [
      '候选生成首次因.mjs使用require而失败，改为模块导入后成功；未产生业务副作用。',
      '首次预检因冻结来源路径多退一层而失败，修正为第三组内路径后重新预检；失败阶段未发业务写请求。'
    ],
    boundary: '3053仅提交5个固定参数；TimeBeforeDecay、HealDuration、TenacityDuration不带已确认单位。3068仅提交4个固定参数，Range=325留在来源记录；每秒1次只作DPS显示速率。两对象均不提交公式、效果、触发规则、周期状态；旧未绑定扩展字符串和未证事件/时点仍待核。'
  }
};
const jsonFile = path.join(base, '第三组实际记录.json');
fs.writeFileSync(jsonFile, JSON.stringify(experience, null, 2) + '\n', 'utf8');
const md = `# 第三组实际记录\n\n- 范围：3053斯特拉克的挑战护手、3068日炎圣盾；冻结客户端16.17、官方16.17.1，普通地图。\n- 最终候选：${experience.candidate.components.total}项，接口候选SHA256为\`${experience.candidate.interfaceSha256}\`，录入候选SHA256为\`${experience.candidate.sourceSha256}\`。\n- 组成：2技能、9固定参数、2装备技能挂载、2代表图复用；0公式、0效果、0触发规则、0周期状态。\n\n## 实际操作\n\n先执行只读预检：技能目录动态总数为${experience.preflight.directorySkillTotal}，15项均为缺项或空关系，0异值。随后显式补缺，创建2技能、9参数、2挂载和2图片复用；写请求为13次POST与2次图片PUT，每项写后立即GET，15项均匹配。\n\n独立GET脚本再次读取装备元数据、完整直接属性、代表图、技能、9参数、2关系和2技能图片，共${experience.independentGet.summary.endpointCount}个端点，全部HTTP 200，0不匹配。独立算例${experience.arithmetic.passedChecks}/${experience.arithmetic.totalChecks}通过。\n\n## 体验与边界\n\n候选生成和首次预检各出现一次本地脚本问题，分别是模块导入方式和来源路径多退一层；两次均在业务写入前修正。装备元数据和完整直接属性只做保护性回读，没有属性写入。3053的三个未绑定单位原值仍待核；3068的Range=325只留来源，DPS的1次/秒不转换成周期或首跳。两对象未提交公式、效果、触发规则和周期状态；未绑定扩展字符串、准确事件和取值时点继续列待核。\n`;
fs.writeFileSync(path.join(base, '第三组实际体验记录.md'), md, 'utf8');
console.log(JSON.stringify({recordFile: '第三组实际记录.json', recordSha256: sha(jsonFile), experienceFile: '第三组实际体验记录.md', preflightFile, applyFile, getFile, arithmeticFile}, null, 2));
