import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageGaps } from './lib/verificationRegression.mjs';

const entry = { kind: 'CHARACTER', key: 'synthetic_actor', outcome: 'PASSED', contentDigest: 'content-a', externalDigest: 'external-a' };
const proof = { entries: [entry] };
const dependency = { contentDigest: entry.contentDigest, externalDigest: entry.externalDigest, mechanisms: ['damage.true'], rationale: '合成固定真实伤害' };
const coverage = () => ({ schemaVersion: 'mechanism-coverage-v1', games: { lab: { 'CHARACTER:synthetic_actor': structuredClone(dependency) } } });
const covered = new Set(['damage.true']);

test('完整机制依赖允许刷新；配置改变、漏填及未知机制均拒绝', () => {
  assert.deepEqual(coverageGaps(proof, coverage(), 'lab', covered), []);
  const stale = coverage(); stale.games.lab['CHARACTER:synthetic_actor'].contentDigest = 'old';
  assert.match(coverageGaps(proof, stale, 'lab', covered).join('\n'), /配置摘要已变/);
  assert.match(coverageGaps(proof, { ...coverage(), games: {} }, 'lab', covered).join('\n'), /未声明/);
  assert.match(coverageGaps(proof, coverage(), 'lab', new Set()).join('\n'), /还没有用例/);
});

test('空通过清单、重复对象、空机制及过期对象声明不能生成空泛证明', () => {
  assert.throws(() => coverageGaps({ entries: [] }, coverage(), 'lab', covered), /没有 PASSED/);
  assert.match(coverageGaps({ entries: [entry, entry] }, coverage(), 'lab', covered).join('\n'), /重复/);
  const empty = coverage(); empty.games.lab['CHARACTER:synthetic_actor'].mechanisms = [];
  assert.match(coverageGaps(proof, empty, 'lab', covered).join('\n'), /非空/);
  const orphan = coverage(); orphan.games.lab['EQUIPMENT:removed'] = dependency;
  assert.match(coverageGaps(proof, orphan, 'lab', covered).join('\n'), /没有对应/);
});
