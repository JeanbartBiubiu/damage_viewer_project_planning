// 只复核已经落地的原始GET证据，完整保留原失败执行报告。
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {here,compareListSummary} from './录入工具.mjs';
const path='执行记录/2026-09-09T04-26-26-132Z/执行结果.json',bytes=await readFile(new URL(path,here)),old=JSON.parse(bytes),checks=[];
assert.equal(old.final.conflicts.length,70);assert.ok(old.final.conflicts.every(x=>x.listDetailMismatch));assert.ok(old.final.readbacks.every(x=>x.match));assert.equal(old.events.filter(x=>x.postStatus===201&&x.match).length,213);
for(const l of old.final.lists)for(const item of l.items){const detail=old.final.readbacks.find(x=>x.skillKey===l.skillKey&&x.kind===l.kind&&x.id===(item.parameterKey??item.formulaKey??item.effectKey));assert.ok(detail);const mismatch=compareListSummary(item,detail.actual);checks.push({skillKey:l.skillKey,kind:l.kind,id:detail.id,pass:!mismatch,diff:mismatch});assert.equal(mismatch,null);}
const report={at:new Date().toISOString(),businessHttp:0,businessWrites:0,pass:true,originalReport:path,originalReportSha256:createHash('sha256').update(bytes).digest('hex'),confirmedWrites:213,actualDetailMatches:240,previousFalseConflicts:{formulas:49,effects:21},cause:'公式列表无expression，效果列表无results/lifecycle并有派生摘要resultCount/lifecycleEnabled；列表不应与完整详情要求相同字段集合。',correction:'列表全部实际字段逐项核对详情，效果结果数和生命周期开关从详情独立派生；完整详情仍逐字段对候选及原保护对象核对。',checks,next:'只运行全量独立回读.mjs，禁止重放录入 --apply；原失败报告保留不改。'};
await writeFile(new URL('列表摘要断言纠错.json',here),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({pass:true,businessHttp:0,businessWrites:0,checks:checks.length,previousFalseConflicts:70,originalReportSha256:report.originalReportSha256}));
