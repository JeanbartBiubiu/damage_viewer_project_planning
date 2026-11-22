import { readFileSync } from 'node:fs';
import type { Plugin, ProxyOptions } from 'vite';

type ApiRoute = { method: string; path: string; access: string };
const publicAccess = new Set(['PUBLIC_READ', 'PUBLIC_ACCOUNT', 'PUBLIC_REPORT']);
const maintenanceAccess = new Set(['PUBLIC_READ', 'MAINTENANCE']);
const loopbackHosts = new Set(['127.0.0.1', '::1']);

export function devApiProxy(maintenance: boolean, target: string): Record<string, ProxyOptions> {
  const catalog: { version: number; routes: ApiRoute[] } = JSON.parse(readFileSync(
    new URL('../../server/data_manage/src/main/resources/api-access.json', import.meta.url), 'utf8'
  ));
  if (catalog.version !== 1 || !catalog.routes.length) throw new Error('开发代理缺少有效的接口清单。');
  const access = maintenance ? maintenanceAccess : publicAccess;
  const routes = new Map<string, RegExp[]>();
  for (const row of catalog.routes) {
    if (!access.has(row.access)) continue;
    if (!(maintenance ? /^\/(api|internal)\// : /^\/api\//).test(row.path)) throw new Error(`接口访问分组无效 ${row.path}`);
    const pattern = row.path.split('/').map(part => /^\{[A-Za-z][A-Za-z0-9]*\}$/.test(part)
      ? '[A-Za-z0-9_-]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
    const methodRoutes = routes.get(row.method) ?? [];
    methodRoutes.push(new RegExp(`^${pattern}$`));
    routes.set(row.method, methodRoutes);
  }
  return {
    '^/(?:api|internal)(?:/|\\?|$)': {
      target,
      changeOrigin: false,
      bypass(request, response) {
        if (!response) return false;
        const path = request.url?.split('?', 1)[0] ?? '';
        // 后端和现行代理将 HEAD 归入对应的 GET 规则。
        const method = request.method ?? '';
        const allowed = routes.get(method)?.some(pattern => pattern.test(path))
          || (method === 'HEAD' && routes.get('GET')?.some(pattern => pattern.test(path)));
        if (!allowed) return false;
      }
    }
  };
}

export function devSiteEntry(maintenance: boolean, preview: boolean): Plugin {
  return {
    name: 'damage-dev-site-entry',
    configResolved(config) {
      if (!maintenance) return;
      const host = preview ? config.preview.host : config.server.host;
      if (typeof host !== 'string' || !loopbackHosts.has(host)) throw new Error('维护开发和预览服务只允许绑定回环地址。');
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?', 1)[0];
        if (maintenance && (path === '/' || path === '/index.html')) {
          request.url = `/maintenance.html${request.url?.slice(path.length) ?? ''}`;
        } else if (!maintenance && path === '/maintenance.html') {
          response.statusCode = 404;
          response.end();
          return;
        }
        next();
      });
    }
  };
}
