import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadMechanismCases, MECHANISM_ROOT } from './mechanismCase';
import { compareMechanismExpectation, runMechanismCase } from './mechanismRunner';

const FAILURE_DIR = resolve(MECHANISM_ROOT, '../../output/mechanisms');
const cases = loadMechanismCases();

describe('机制回归：固定合成用例与手算期望', () => {
  it.each(cases.map(row => [row.caseKey, row] as const))('%s', async (_key, definition) => {
    const { projection } = await runMechanismCase(definition);
    const issues = compareMechanismExpectation(projection, definition.expected);
    if (issues.length) {
      mkdirSync(FAILURE_DIR, { recursive: true });
      writeFileSync(resolve(FAILURE_DIR, `${definition.caseKey}.actual.json`), JSON.stringify(projection, null, 2) + '\n');
    }
    expect(issues, `${definition.title}（实际投影见 web/output/mechanisms/${definition.caseKey}.actual.json）`).toEqual([]);
  }, 60000);
});
