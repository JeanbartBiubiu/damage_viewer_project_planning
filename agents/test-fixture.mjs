import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceRoot } from './local-store.mjs';

// 临时 Git 仓库：复制当前协作配置并为每个角色放一份定义；copyScripts 时带上生产脚本供钩子命令执行。
export function fixture(t, { copyScripts = false } = {}) {
  const directory = mkdtempSync(join(realpathSync.native(tmpdir()), 'damage-coordination-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 3 }));
  const root = join(directory, 'main repo');
  const config = JSON.parse(readFileSync(join(sourceRoot, 'agents', 'coordination.json'), 'utf8'));
  for (const roleId of config.roles) {
    mkdirSync(join(root, 'agents', 'roles', roleId), { recursive: true });
    writeFileSync(join(root, 'agents', 'roles', roleId, 'README.md'), `# ${roleId}\n`);
  }
  copyFileSync(join(sourceRoot, 'agents', 'coordination.json'), join(root, 'agents', 'coordination.json'));
  copyFileSync(join(sourceRoot, '.gitignore'), join(root, '.gitignore'));
  if (copyScripts) {
    for (const name of readdirSync(join(sourceRoot, 'agents')).filter(name => name.endsWith('.mjs') && !name.includes('test'))) {
      copyFileSync(join(sourceRoot, 'agents', name), join(root, 'agents', name));
    }
  }
  execFileSync('git', ['-c', 'init.defaultBranch=master', 'init', '-q'], { cwd: root, stdio: 'pipe' });
  return root;
}

export function isIgnored(root, path) {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd: root, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
