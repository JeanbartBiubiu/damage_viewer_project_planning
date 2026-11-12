import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const deployment = mode === 'maintenance' ? 'maintenance' : 'viewer';
  const keyPath = env.DEV_HTTPS_KEY_PATH?.trim();
  const certPath = env.DEV_HTTPS_CERT_PATH?.trim();
  if (Boolean(keyPath) !== Boolean(certPath)) throw new Error('本地 HTTPS 需要同时配置证书及私钥路径。');
  return {
  resolve: { alias: { '#damage-workspace': fileURLToPath(new URL(deployment === 'maintenance' ? './src/MaintenanceApp.tsx' : './src/ViewerApp.tsx', import.meta.url)) } },
  define: { __DAMAGE_DEPLOYMENT_MODE__: JSON.stringify(deployment) },
  build: { outDir: deployment === 'maintenance' ? 'dist-maintenance' : 'dist' },
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    ...(keyPath && certPath ? { https: { key: readFileSync(keyPath), cert: readFileSync(certPath) } } : {}),
    proxy: {
      '/api': { target: env.DEV_API_TARGET?.trim() || 'http://127.0.0.1:8080', changeOrigin: false },
      ...(deployment === 'maintenance' ? { '/internal/maintenance': { target: env.DEV_API_TARGET?.trim() || 'http://127.0.0.1:8080', changeOrigin: false } } : {})
    }
  }
  };
});
