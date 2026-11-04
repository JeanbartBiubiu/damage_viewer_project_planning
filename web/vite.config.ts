import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const keyPath = env.DEV_HTTPS_KEY_PATH?.trim();
  const certPath = env.DEV_HTTPS_CERT_PATH?.trim();
  if (Boolean(keyPath) !== Boolean(certPath)) throw new Error('本地 HTTPS 需要同时配置证书及私钥路径。');
  return {
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    ...(keyPath && certPath ? { https: { key: readFileSync(keyPath), cert: readFileSync(certPath) } } : {}),
    proxy: {
      '/api': { target: env.DEV_API_TARGET?.trim() || 'http://127.0.0.1:8080', changeOrigin: false }
    }
  }
  };
});
