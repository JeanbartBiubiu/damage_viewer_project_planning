import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const ledgerPath = path.join(here, '../阶段进度.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')), before = structuredClone(ledger);
const scope = ledger.heroes.priorityScope;
const heroes = scope.batches.flatMap(batch => batch.heroes), skills = heroes.flatMap(hero => hero.skillKeys);
assert.equal(heroes.length, 50); assert.equal(new Set(heroes.map(hero => hero.characterKey)).size, 50);
assert.equal(skills.length, 250); assert.equal(new Set(skills).size, 250);
const mainDoc = '文档记录/详细设计/项目/英雄装备符文全量实录.md';
const continuationDoc = '文档记录/测试记录/项目/英雄装备符文实录续记-2026-09-24.md';
const markdown = fs.readFileSync(path.join(root, mainDoc), 'utf8');
const section = markdown.split('### 当前优先的50名英雄')[1].split('## 问题记录')[0];
const rows = [...section.matchAll(/^\|\s*(\d{1,2})\s*\|\s*([^|]+?)\s*\|/gm)].map(match => ({ order: Number(match[1]), name: match[2].trim() }));
assert.deepEqual(rows.map(row => row.order), Array.from({ length: 50 }, (_, i) => i + 1));
assert.deepEqual(rows.map(row => row.name), heroes.map(hero => hero.name));
const recent = ['annie_q', 'garen_r', 'neeko_e', 'soraka_r', 'sivir_r', 'masteryi_r', 'chogath_q', 'chogath_w', 'vi_q'];
const checked = recent.map(skillKey => {
  const owner = heroes.find(hero => hero.skillKeys.includes(skillKey)); assert(owner, skillKey);
  return { skillKey, characterKey: owner.characterKey, name: owner.name, inSelected50: true };
});
const selectionSha256 = crypto.createHash('sha256').update(JSON.stringify(scope.batches)).digest('hex');
scope.status = '既有50名英雄范围内真实页面录入与能力验证进行中；不自动扩为全部英雄';
scope.purpose = '本次英雄工作集严格限于既有50名及其250个来源技能槽，在已定1V1边界内补齐数据并通过实际录入发现和修复系统不足；不横向铺开其余英雄';
scope.completionBoundary = '每名英雄本轮1V1范围内的主体、完整等级属性、关系、图片及P/Q/W/E/R相关分支完成管理配置、独立回读和适当页面验收；原明确排除分支保留依据。管理完整与运行证据分开，必要宿主或Wasm修复按真实录入需要推进，不把完整技能模拟作为所有页面录入的统一前置。';
scope.scopeConfirmation = {
  at: new Date().toISOString(), heroCount: 50, sourceSkillSlots: 250,
  selectionUnchanged: true, evidence: '数据参考/全量录入-2026-09/真实页面恢复-2026-09-24/60-五十名范围核对与续记入口.json',
  mainDoc, continuationDoc,
  selectionRule: '选批及批准英雄写入前核对skillKey属于本名单；共享机制依赖、只读目录或通用代码修复不增加英雄名额',
  otherCategories: '装备与符文沿主文档原清单，本次确认不扩大其范围'
};
assert.deepEqual(scope.batches, before.heroes.priorityScope.batches);
assert.deepEqual(scope.selectionSnapshot, before.heroes.priorityScope.selectionSnapshot);
assert.deepEqual(ledger.inventoryConclusions, before.inventoryConclusions);
const check = structuredClone(ledger); check.heroes.priorityScope = before.heroes.priorityScope; assert.deepEqual(check, before);
const proof = { at: new Date().toISOString(), heroCount: 50, uniqueHeroCount: 50, skillSlots: 250, uniqueSkillSlots: 250,
  mainDocMatchesLedger: true, selectionSha256, recentChecks: checked, addedHeroes: 0,
  correctedStalePauseText: true, necessaryRuntimeWorkStillSeparateFromManagementCompletion: true,
  mainDoc, continuationDoc, progressTruth: '数据参考/全量录入-2026-09/阶段进度.json',
  sharedMechanismPlan: '文档记录/详细设计/项目/管理页面与共性机制迭代计划.md',
  businessWrites: 0, coverageChanged: false };
assert(fs.existsSync(path.join(root, continuationDoc)));
fs.writeFileSync(path.join(here, '60-五十名范围核对与续记入口.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ heroes: 50, skills: 250, recentChecked: checked.length, addedHeroes: 0, selectionUnchanged: true }));
