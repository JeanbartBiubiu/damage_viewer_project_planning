import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { renderNginx } from './generate-nginx.mjs';
import { readJson, options, requireValue, writeNew } from './artifacts.mjs';

async function listen(server) { await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); }); return server.address().port; }
async function main(args) {
  if (!args.length || args[0] === '--help') {
    console.log('运行真实Nginx及隔离接口替身，验证白名单和维护状态。\nnode tools/maintenance/nginx-smoke.mjs --nginx <nginx可执行文件> --output <新证据目录>'); return;
  }
  const opts = options(args, ['--nginx', '--output']), directory = resolve(opts['--output']);
  mkdirSync(directory); mkdirSync(resolve(directory, 'logs')); mkdirSync(resolve(directory, 'temp'));
  const path = value => value.replaceAll('\\', '/');
  const generated = renderNginx(readJson(new URL('../../server/data_manage/src/main/resources/api-access.json', import.meta.url)));
  const marker = path(resolve(directory, 'maintenance'));
  const backend = createServer((request, response) => {
    const leaked = Object.keys(request.headers).some(key => ['x-damage-maintenance-token', 'x-damage-maintenance-batch', 'x-damage-deployment-token', 'x-damage-internal-token'].includes(key));
    response.writeHead(leaked ? 500 : 200, { 'Content-Type': 'application/json' }).end('{"reached":true}');
  });
  const backendPort = await listen(backend), reservation = createServer(), port = await listen(reservation);
  await new Promise(res => reservation.close(res));
  const prefix = `${path(directory)}/`, config = resolve(directory, 'nginx.conf');
  writeFileSync(config, `worker_processes 1;\nerror_log logs/error.log;\npid logs/nginx.pid;\nevents { worker_connections 64; }\nhttp {\n${generated.maps}\nserver {\nlisten 127.0.0.1:${port};\n`
    + generated.setup.replace('/opt/damage-viewer/maintenance', marker)
    + `location ^~ /api/ {\n${generated.gate}\nproxy_pass http://127.0.0.1:${backendPort};\n}\nlocation / { return 403; }\n}\n}\n`);
  const checked = spawnSync(opts['--nginx'], ['-p', prefix, '-c', path(config), '-t'], { encoding: 'utf8', windowsHide: true });
  if (checked.status !== 0) { backend.close(); throw new Error(`Nginx配置检查失败：${checked.stderr}`); }
  const child = spawn(opts['--nginx'], ['-p', prefix, '-c', path(config)], { windowsHide: true, stdio: 'ignore' });
  let startupError;
  child.on('error', error => { startupError = error; });
  const checks = [];
  try {
    let started = false;
    for (let index = 0; index < 50; index++) {
      if (startupError) throw new Error('Nginx启动失败。');
      try { started = (await fetch(`http://127.0.0.1:${port}/api/games`)).ok; if (started) break; } catch { /* 仅等待本次新进程启动。 */ }
      await delay(100);
    }
    requireValue(started, '本次隔离Nginx没有启动。');
    const check = async (method, route, status, phase) => {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { 'X-Damage-Maintenance-Token': 'synthetic-test',
        'X-Damage-Deployment-Token': 'synthetic-test', 'X-Damage-Maintenance-Batch': 'synthetic-test', 'X-Damage-Internal-Token': 'synthetic-test' } });
      checks.push({ phase, method, route, expected: status, actual: response.status });
      requireValue(response.status === status, `入口断言失败：${method} ${route}`);
    };
    for (const [method, route, status] of [['GET', '/api/games', 200], ['HEAD', '/api/games', 200],
      ['POST', '/api/admin/games/lol/simulation-snapshot', 200], ['POST', '/api/auth/login', 200], ['POST', '/api/auth/wasm-grant', 200],
      ['PATCH', '/api/admin/games/lol/skills/q/configuration', 403], ['POST', '/api/admin/games/lol/skills', 403],
      ['GET', '/internal/maintenance/me', 403], ['GET', '/api/admin/visits/last30days', 403], ['GET', '/api/new-route', 403],
      ['POST', '/api/games', 403], ['GET', '/api/admin/games/lol/skills%2Fq', 400], ['GET', '/api//games', 400]]) {
      await check(method, route, status, 'normal');
    }
    writeFileSync(marker, 'synthetic-maintenance');
    for (const [method, route, status] of [['GET', '/api/games', 503], ['POST', '/api/admin/games/lol/simulation-snapshot', 503],
      ['POST', '/api/auth/wasm-grant', 503], ['POST', '/api/auth/login', 200], ['POST', '/api/auth/logout', 200]]) {
      await check(method, route, status, 'maintenance');
    }
    unlinkSync(marker); await check('GET', '/api/games', 200, 'reopened');
    writeNew(resolve(directory, 'result.json'), { pass: true, nginxConfiguration: true, checks });
    console.log(JSON.stringify({ pass: true, nginx: true, checks: checks.length }));
  } finally {
    spawnSync(opts['--nginx'], ['-p', prefix, '-c', path(config), '-s', 'quit'], { windowsHide: true, stdio: 'ignore' });
    await new Promise(res => backend.close(res));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
