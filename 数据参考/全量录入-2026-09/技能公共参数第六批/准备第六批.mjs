import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const previous = path.resolve(here, '../技能公共参数第五批');
const selected = ['Teemo','Thresh','Trundle','Tryndamere','TwistedFate','Udyr','Urgot','Varus','Vayne','Velkoz','Vex','Vi','Viego','Viktor','Vladimir','Volibear','Warwick','Xayah','Xerath','XinZhao','Yasuo','Yone','Zac','Zed'];
for (const name of ['生成公共参数候选.mjs','录入公共参数.mjs']) assert.equal(fs.existsSync(path.join(here, name)), false, '已准备，不覆盖后续审查：' + name);
let generator = fs.readFileSync(path.join(previous, '生成公共参数候选.mjs'), 'utf8');
generator = generator.replace(/const selected = \[[^\n]+\];/, 'const selected = ' + JSON.stringify(selected) + ';');
for (const name of ['skipped','scopeNotes']) generator = generator.replace(new RegExp('const ' + name + ' = \\{[\\s\\S]*?\\};'), 'const ' + name + ' = {};');
for (const name of ['reviewedOrdinaryCooldowns','reviewedMixedZeroCosts']) generator = generator.replace(new RegExp('const ' + name + ' = new Set\\([^\\n]+\\);'), 'const ' + name + ' = new Set([]);');
fs.writeFileSync(path.join(here, '生成公共参数候选.mjs'), generator);
fs.copyFileSync(path.join(previous, '录入公共参数.mjs'), path.join(here, '录入公共参数.mjs'));
console.log(JSON.stringify({ selected, status: '仅准备，未调用业务接口' }));
