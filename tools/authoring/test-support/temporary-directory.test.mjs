import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { removeFixtureDirectory } from './temporary-directory.mjs';

test('只删除精确临时目录，拒绝父目录、兄弟目录和未分配的前缀', () => {
  const parentPrefix = path.join(tmpdir(), 'damage-fixture-cleanup-');
  const parent = fs.mkdtempSync(parentPrefix);
  const prefix = path.join(parent, 'batch-');
  const directory = fs.mkdtempSync(prefix);
  const sibling = path.join(parent, 'preserve.txt');
  fs.writeFileSync(sibling, 'keep');
  fs.writeFileSync(path.join(directory, 'fixture.json'), '{}');
  try {
    for (const outside of [parent, sibling, prefix]) {
      assert.throws(() => removeFixtureDirectory(outside, prefix), /拒绝清理/);
      assert.equal(fs.readFileSync(sibling, 'utf8'), 'keep');
      assert.equal(fs.readFileSync(path.join(directory, 'fixture.json'), 'utf8'), '{}');
    }
    removeFixtureDirectory(directory, prefix);
    assert.equal(fs.existsSync(directory), false);
    assert.equal(fs.readFileSync(sibling, 'utf8'), 'keep');
  } finally { removeFixtureDirectory(parent, parentPrefix); }
});
