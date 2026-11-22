import { isAbsolute, relative, resolve } from 'node:path';
import { normalizePath, type Plugin, type RenderBuiltAssetUrl } from 'vite';
import type { OutputAsset, OutputBundle, OutputChunk } from 'rolldown';

export const siteHtml = { viewer: 'index.html', maintenance: 'maintenance.html' } as const;
export const siteBuildDir = 'output/site-build';

type OutputFile = {
  kind: 'chunk' | 'asset' | 'html';
  sources: string[];
  imports: string[];
  dynamicImports: string[];
  assets: string[];
};

function fileGraph(root: string, output: OutputChunk | OutputAsset): OutputFile {
  // Keep Vite query suffixes in the inventory, including worker and asset modules.
  const sourcePath = (id: string) => {
    const source = id.replace(/^\0/, '');
    return normalizePath(isAbsolute(source) ? relative(root, source) : source);
  };
  const metadata = output.viteMetadata;
  return {
    kind: output.type,
    sources: [...new Set((output.type === 'chunk' ? output.moduleIds : output.originalFileNames).map(sourcePath))].sort(),
    imports: output.type === 'chunk' ? [...output.imports] : [],
    dynamicImports: output.type === 'chunk' ? [...output.dynamicImports] : [],
    assets: [...new Set([...(metadata?.importedAssets ?? []), ...(metadata?.importedCss ?? [])])].sort()
  };
}

export function traceSiteBuild(root: string) {
  const workers = new Map<string, OutputFile>();
  const htmlAssets = new Map<string, Set<string>>();
  const publicAssets = new Set<string>();

  // Vite emits worker chunks as assets in the outer build. Record their real modules
  // and edges while the worker build still exposes them as chunks.
  const workerPlugin = (): Plugin => ({
    name: 'damage-worker-graph',
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        for (const output of Object.values(bundle)) workers.set(output.fileName, fileGraph(root, output));
      }
    }
  });

  const renderBuiltUrl: RenderBuiltAssetUrl = (file, { hostId, hostType, type }) => {
    if (type === 'public') publicAssets.add(file);
    if (hostType !== 'html') return;
    const html = normalizePath(relative(root, resolve(root, hostId)));
    const dependencies = htmlAssets.get(html) ?? new Set<string>();
    dependencies.add(file);
    htmlAssets.set(html, dependencies);
    return undefined;
  };

  function collectFiles(bundle: OutputBundle): Map<string, OutputFile> {
    const files = new Map<string, OutputFile>();
    for (const output of Object.values(bundle)) {
      files.set(output.fileName, workers.get(output.fileName) ?? fileGraph(root, output));
    }
    for (const file of publicAssets) {
      if (!files.has(file)) files.set(file, { kind: 'asset', sources: [`public/${file}`], imports: [], dynamicImports: [], assets: [] });
    }
    for (const entry of Object.values(siteHtml)) {
      const html = files.get(entry);
      const dependencies = htmlAssets.get(entry);
      if (!html || !dependencies?.size) throw new Error(`缺少实际的站点入口资源记录 ${entry}`);
      html.kind = 'html';
      html.assets = [...dependencies].sort();
    }
    return files;
  }

  const plugin: Plugin = {
    name: 'damage-site-graph',
    generateBundle: {
      order: 'post',
      handler(options, bundle) {
        if (options.sourcemap) this.error('站点构建禁止生成源码映射。');
        const files = collectFiles(bundle);
        this.emitFile({
          type: 'asset', fileName: '.vite/site-graph.json',
          source: JSON.stringify({ entries: siteHtml, files: Object.fromEntries(files) }, null, 2)
        });
      }
    }
  };
  return { plugin, workerPlugin, renderBuiltUrl };
}
