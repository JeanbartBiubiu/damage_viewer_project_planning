import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const destinations = { viewer: 'dist', maintenance: 'dist-maintenance' };
const wasmSource = 'src/engine/wasm/tinygo_engine_v2.wasm';
const workerSource = 'src/workers/genericEngineWorker.ts';
const privateSource = /^src\/(?:pages\/(?:admin|maintenance)\/|services\/maintenance|engine\/maintenance|config\/navigation\.ts$|maintenance(?:App|Main)\.tsx$)/i;

function assertFileName(file) {
  if (typeof file !== 'string' || /[:\\?#\0]/.test(file)
    || file.split('/').some(part => !part || part === '.' || part === '..') || posix.isAbsolute(file)) {
    throw new Error(`非法的站点资源路径 ${file}`);
  }
}

export function siteClosure(graph, site) {
  const root = graph.entries[site];
  if (graph.files[root]?.kind !== 'html') throw new Error(`缺少站点入口 ${root}`);
  const visited = new Set();
  const pending = [root];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    assertFileName(file);
    const item = Object.hasOwn(graph.files, file) && graph.files[file];
    if (!item) throw new Error(`${site} 缺少资源记录 ${file}`);
    if (file.endsWith('.map') || (item.kind === 'html' && file !== root)) throw new Error(`${site} 含非本站发布文件 ${file}`);
    if (/\.[cm]?js$/.test(file) && (item.kind !== 'chunk' || !item.sources.length)) {
      throw new Error(`${site} 脚本分块缺少源码清单 ${file}`);
    }
    if (site === 'viewer') {
      const source = item.sources.find(id => privateSource.test(id.split('?', 1)[0]));
      if (source) throw new Error(`公共产物 ${file} 引用了维护源码 ${source}`);
    }
    visited.add(file);
    pending.push(...item.imports, ...item.dynamicImports, ...item.assets);
  }
  return visited;
}

async function assertDirectory(path) {
  const stat = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return false;
  if (!stat.isDirectory() || relative(path, await realpath(path))) throw new Error(`站点目录不在预定位置 ${path}`);
  return true;
}

async function distribute() {
  const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  const buildDir = join(root, 'output/site-build');
  if (!await assertDirectory(buildDir)) throw new Error('缺少本次构建目录。');
  const graph = JSON.parse(await readFile(join(buildDir, '.vite/site-graph.json'), 'utf8'));
  const wasmBytes = await readFile(join(root, wasmSource));
  const output = [];
  for (const [site, directory] of Object.entries(destinations)) {
    const files = siteClosure(graph, site);
    const wasm = [...files].filter(file => graph.files[file].sources.includes(wasmSource) && file.endsWith('.wasm'));
    const workers = [...files].filter(file => graph.files[file].sources.includes(workerSource));
    if (wasm.length !== 1 || workers.length !== 1 || ![...files].some(file => file.endsWith('.css'))
      || !files.has('favicon.ico') || !files.has('favicon.svg')) {
      throw new Error(`${site} 缺少预定的 Wasm、工作线程、样式或图标。`);
    }
    if (!(await readFile(join(buildDir, wasm[0]))).equals(wasmBytes)) throw new Error(`${site} 的 Wasm 与分发源文件不同。`);
    const destination = join(root, directory);
    output.push({ site, files, destination, existing: await assertDirectory(destination) });
  }

  const temp = await mkdtemp(join(buildDir, 'sites-'));
  try {
    for (const { site, files } of output) {
      const stage = join(temp, site);
      await mkdir(stage);
      for (const file of files) {
        const source = join(buildDir, file);
        if (!(await lstat(source)).isFile() || relative(source, await realpath(source))) {
          throw new Error(`构建中缺少常规文件 ${file}`);
        }
        const target = join(stage, file === graph.entries[site] ? 'index.html' : file);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
      }
    }
    for (const { site, files, destination, existing } of output) {
      if (existing && await assertDirectory(destination)) await rm(destination, { recursive: true });
      await rename(join(temp, site), destination);
      const scripts = [...files].filter(file => graph.files[file].kind === 'chunk').length;
      console.log(`站点 ${site} 校验通过，${files.size} 个文件（${scripts} 个脚本分块），Wasm 与源文件一致。`);
    }
  } finally {
    if (await assertDirectory(temp)) await rm(temp, { recursive: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await distribute();
