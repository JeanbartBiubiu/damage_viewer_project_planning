import assert from 'node:assert/strict';
import { test } from 'node:test';
import { siteClosure } from './distribute-sites.mjs';

function graph() {
  const asset = (sources, assets = []) => ({ kind: 'asset', sources, imports: [], dynamicImports: [], assets });
  const chunk = (sources, imports = [], dynamicImports = [], assets = []) => ({ kind: 'chunk', sources, imports, dynamicImports, assets });
  return {
    entries: { viewer: 'index.html', maintenance: 'maintenance.html' },
    files: {
      'index.html': { ...asset(['index.html'], ['assets/viewer.js', 'favicon.svg']), kind: 'html' },
      'maintenance.html': { ...asset(['maintenance.html'], ['assets/maintenance.js']), kind: 'html' },
      'assets/viewer.js': chunk(['src/main.tsx'], ['assets/shared.js']),
      'assets/maintenance.js': chunk(['src/maintenanceMain.tsx'], ['assets/shared.js']),
      'assets/shared.js': chunk(['src/mountApp.tsx'], [], ['assets/dynamic.js']),
      'assets/dynamic.js': chunk(['src/pages/simulation/Test.tsx'], [], [], ['assets/worker.js', 'assets/theme.css']),
      'assets/worker.js': chunk(['src/workers/genericEngineWorker.ts'], [], [], ['assets/test.wasm']),
      'assets/test.wasm': asset(['src/engine/wasm/tinygo_engine_v2.wasm']),
      'assets/theme.css': asset(['src/styles/theme.css'], ['assets/font.woff2']),
      'assets/font.woff2': asset(['src/styles/font.woff2']),
      'favicon.svg': asset(['public/favicon.svg'])
    }
  };
}

test('按真实依赖递归收集站点文件，覆盖静态分块、动态分块、线程、Wasm、CSS 和图标', () => {
  const closure = siteClosure(graph(), 'viewer');
  assert.deepEqual([...closure].sort(), ['assets/dynamic.js', 'assets/font.woff2', 'assets/shared.js', 'assets/test.wasm',
    'assets/theme.css', 'assets/viewer.js', 'assets/worker.js', 'favicon.svg', 'index.html']);
  assert.ok(siteClosure(graph(), 'maintenance').has('assets/maintenance.js'));
});

for (const file of ['assets/shared.js', 'assets/dynamic.js', 'assets/worker.js', 'assets/theme.css']) {
  test(`拒绝 ${file} 中的维护源码`, () => {
    const input = graph();
    input.files[file].sources.push('src/pages/admin/private-resource?raw');
    assert.throws(() => siteClosure(input, 'viewer'), /引用了维护源码/);
  });
}

test('拒绝未知的脚本来源或任一缺失的可达文件', () => {
  const input = graph();
  input.files['assets/worker.js'].kind = 'asset';
  assert.throws(() => siteClosure(input, 'viewer'), /脚本分块缺少源码清单/);
  delete input.files['assets/worker.js'];
  assert.throws(() => siteClosure(input, 'viewer'), /缺少资源记录/);
});
