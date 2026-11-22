import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));

async function listenUpstream(t) {
  const received = [];
  const server = createHttpServer((request, response) => {
    received.push(`${request.method} ${request.url}`);
    response.writeHead(204).end();
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return { url: `http://127.0.0.1:${server.address().port}`, received };
}

test('查看与维护开发服务按清单将请求送至各自的连接器', async t => {
  const publicApi = await listenUpstream(t);
  const maintenanceApi = await listenUpstream(t);
  const env = { DEV_API_TARGET: publicApi.url, DEV_MAINTENANCE_API_TARGET: maintenanceApi.url, DEV_HTTPS_KEY_PATH: '', DEV_HTTPS_CERT_PATH: '' };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    process.env[key] = value;
  }
  const start = async mode => {
    const server = await createServer({ root, mode, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, ws: false }, optimizeDeps: { noDiscovery: true } });
    t.after(() => server.close());
    await server.listen();
    return server.resolvedUrls.local[0];
  };

  const publicOrigin = await start('development');
  const maintenanceOrigin = await start('maintenance');
  const read = async (origin, path, method = 'GET') => (await fetch(new URL(path, origin), { method })).status;
  const snapshots = '/api/admin/games/lol/simulation-snapshot';
  const images = '/api/games/lol/images?updatedAfter=0';
  const identity = '/internal/maintenance/me';
  const attributes = '/api/admin/games/lol/attributes';
  assert.match(await (await fetch(publicOrigin)).text(), /\/src\/main\.tsx/);
  assert.match(await (await fetch(maintenanceOrigin)).text(), /\/src\/maintenanceMain\.tsx/);
  assert.equal(await read(publicOrigin, '/maintenance.html'), 404);
  assert.equal(await read(publicOrigin, images), 204);
  assert.equal(await read(publicOrigin, '/api/games', 'HEAD'), 204);
  assert.equal(await read(publicOrigin, snapshots, 'POST'), 204);
  assert.equal(await read(publicOrigin, '/api/auth/login', 'POST'), 204);
  assert.equal(await read(publicOrigin, '/api/visits', 'POST'), 204);
  assert.equal(await read(publicOrigin, attributes, 'POST'), 404);
  assert.equal(await read(publicOrigin, snapshots, 'GET'), 404);
  assert.equal(await read(publicOrigin, identity), 404);
  assert.equal(await read(publicOrigin, '/api/unknown'), 404);
  assert.equal(await read(publicOrigin, '/api/games/lol%2Ffoo/images'), 404);
  assert.deepEqual(publicApi.received, [`GET ${images}`, 'HEAD /api/games', `POST ${snapshots}`, 'POST /api/auth/login', 'POST /api/visits']);
  assert.deepEqual(maintenanceApi.received, []);

  assert.equal(await read(maintenanceOrigin, identity), 204);
  assert.equal(await read(maintenanceOrigin, images), 204);
  assert.equal(await read(maintenanceOrigin, attributes, 'POST'), 204);
  assert.equal(await read(maintenanceOrigin, '/api/auth/login', 'POST'), 404);
  assert.equal(await read(maintenanceOrigin, '/internal/maintenance/batches/fixture/open', 'POST'), 404);
  assert.deepEqual(maintenanceApi.received, [`GET ${identity}`, `GET ${images}`, `POST ${attributes}`]);

  await assert.rejects(createServer({ root, mode: 'maintenance', server: { host: '0.0.0.0' } }), /只允许绑定回环地址/);
});
