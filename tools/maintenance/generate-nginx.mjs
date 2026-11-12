import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, requireValue, exactKeys, options } from './artifacts.mjs';

const PUBLIC = new Set(['PUBLIC_READ', 'PUBLIC_ACCOUNT', 'PUBLIC_REPORT']);
const ACCESS = new Set([...PUBLIC, 'MAINTENANCE', 'DEPLOYMENT', 'ACCOUNT_INTERNAL']);
export function routePattern(path) {
  requireValue(typeof path === 'string' && /^\/(?:api|internal)\//.test(path) && !/[\s;"'\\?#%]/.test(path), '接口路径不能安全导出。');
  const parts = path.split('/').map(part => /^\{[A-Za-z][A-Za-z0-9]*\}$/.test(part)
    ? '[A-Za-z0-9_-]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return parts.join('/');
}
export function publicRoutes(catalog) {
  exactKeys(catalog, ['version', 'routes']);
  requireValue(catalog.version === 1 && Array.isArray(catalog.routes) && catalog.routes.length > 0, '接口分类清单无效。');
  const seen = new Set(), rows = [];
  for (const route of catalog.routes) {
    exactKeys(route, ['method', 'path', 'access']);
    requireValue(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(route.method) && ACCESS.has(route.access), '接口分类或方法未知。');
    routePattern(route.path);
    const key = `${route.method}:${route.path}`;
    requireValue(!seen.has(key), '接口分类重复。'); seen.add(key);
    if (!PUBLIC.has(route.access)) continue;
    requireValue(route.path.startsWith('/api/'), '内部接口不能公开。');
    if (route.access === 'PUBLIC_READ') requireValue(route.method === 'GET' || route.method === 'HEAD'
      || route.method === 'POST' && /^\/api\/admin\/games\/\{gameId\}\/simulation-snapshot$/.test(route.path), '未知公共读取副作用。');
    if (route.access === 'PUBLIC_ACCOUNT') requireValue(route.path.startsWith('/api/auth/'), '账号路由分类错误。');
    if (route.access === 'PUBLIC_REPORT') requireValue(route.path === '/api/visits' && route.method === 'POST', '上报路由分类错误。');
    rows.push(route);
    if (route.method === 'GET' && !seen.has(`HEAD:${route.path}`)) rows.push({ ...route, method: 'HEAD' });
  }
  return rows;
}
export function renderNginx(catalog) {
  const routes = publicRoutes(catalog), lines = routes.map(route => `    ~^${route.method}:${routePattern(route.path)}$ 1;`);
  const reads = routes.filter(route => route.access === 'PUBLIC_READ' || route.path === '/api/auth/wasm-grant')
    .map(route => `    ~^${route.method}:${routePattern(route.path)}$ 1;`);
  return { maps: '# 由后端唯一接口分类生成，放入 http 上下文。\n'
      + 'map "$request_method:$uri" $damage_public_api {\n    default 0;\n' + [...new Set(lines)].sort().join('\n') + '\n}\n'
      + 'map "$request_method:$uri" $damage_window_request {\n    default 0;\n' + [...new Set(reads)].sort().join('\n') + '\n}\n'
      + 'map "$damage_maintenance:$damage_window_request" $damage_window_blocked {\n    default 0;\n    "1:1" 1;\n}\n',
    gate: '# 放入公网 /api/ 的 location，后接现行 proxy_pass。\n'
      + 'if ($damage_public_api = 0) { return 403; }\n'
      + 'if ($damage_window_blocked = 1) { return 503; }\n'
      + 'proxy_set_header X-Damage-Maintenance-Token "";\n'
      + 'proxy_set_header X-Damage-Maintenance-Batch "";\n'
      + 'proxy_set_header X-Damage-Deployment-Token "";\n'
      + 'proxy_set_header X-Damage-Internal-Token "";\n',
    setup: '# 放入公网 server；维护标记在部署目录内跨重启保存。\n'
      + 'set $damage_maintenance 0;\n'
      + 'if (-f /opt/damage-viewer/maintenance) { set $damage_maintenance 1; }\n'
      + 'if ($request_uri ~* "^[^?]*%(25|2f|5c|3b|00|2e)") { return 400; }\n'
      + 'if ($request_uri ~ "^[^?]*;") { return 400; }\n'
      + 'if ($request_uri ~ "^[^?]*//") { return 400; }\n' };
}
function main(args) {
  if (!args.length || args[0] === '--help') {
    console.log('从唯一接口清单生成Nginx公共入口白名单。\nnode tools/maintenance/generate-nginx.mjs --catalog <api-access.json> --output <新目录>'); return;
  }
  const opts = options(args, ['--catalog', '--output']), files = renderNginx(readJson(opts['--catalog']));
  mkdirSync(opts['--output']);
  // 配置内容不是 JSON，独占创建且不覆盖已有部署产物。
  return import('node:fs').then(({ writeFileSync }) => {
    for (const [name, contents] of Object.entries(files)) writeFileSync(resolve(opts['--output'], `viewer-api-${name}.conf`), contents, { flag: 'wx' });
    console.log(JSON.stringify({ publicRoutes: publicRoutes(readJson(opts['--catalog'])).length, files: 3 }));
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) Promise.resolve().then(() => main(process.argv.slice(2))).catch(() => {
  console.error('公网接口导出失败；未生成可放行的替代配置。'); process.exitCode = 1;
});
