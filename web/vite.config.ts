import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { devApiProxy, devSiteEntry } from './build/devSite.ts';
import { siteBuildDir, siteHtml, traceSiteBuild } from './build/siteGraph.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, root, '');
  if (command === 'build') {
    const graph = traceSiteBuild(root);
    return {
      root,
      appType: 'mpa',
      plugins: [react(), graph.plugin],
      build: {
        outDir: siteBuildDir,
        manifest: true,
        sourcemap: false,
        rolldownOptions: { input: Object.values(siteHtml).map(file => resolve(root, file)) }
      },
      worker: { format: 'es', plugins: () => [graph.workerPlugin()] },
      experimental: { renderBuiltUrl: graph.renderBuiltUrl }
    };
  }

  const maintenance = mode === 'maintenance';
  const keyPath = env.DEV_HTTPS_KEY_PATH?.trim();
  const certPath = env.DEV_HTTPS_CERT_PATH?.trim();
  if (Boolean(keyPath) !== Boolean(certPath)) throw new Error('本地 HTTPS 需要同时配置证书及私钥路径。');
  const host = maintenance ? '127.0.0.1' : '0.0.0.0';
  const target = maintenance ? env.DEV_MAINTENANCE_API_TARGET?.trim() || 'http://127.0.0.1:8081'
    : env.DEV_API_TARGET?.trim() || 'http://127.0.0.1:8080';
  return {
    root,
    appType: 'mpa',
    plugins: [react(), devSiteEntry(maintenance, isPreview === true)],
    build: { outDir: maintenance ? 'dist-maintenance' : 'dist' },
    server: {
      host,
      port: 5173,
      ...(keyPath && certPath ? { https: { key: readFileSync(resolve(root, keyPath)), cert: readFileSync(resolve(root, certPath)) } } : {}),
      proxy: devApiProxy(maintenance, target)
    },
    preview: { host }
  };
});
