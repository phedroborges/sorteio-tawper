// Executed only by CI after building the production Docker image.
// All records and Docker resources below are disposable, synthetic test fixtures.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const resource = `tawper-ci-${Date.now()}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let base;
function start() {
  docker('run', '-d', '--name', resource, '-p', '127.0.0.1::3000', '--mount', `type=volume,source=${resource},target=/app/data`, 'sorteio-tawper:ci');
  const port = docker('port', resource, '3000/tcp').split(':').at(-1);
  base = `http://127.0.0.1:${port}`;
}
async function healthy() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* Startup in progress. */ }
    await pause(250);
  }
  throw new Error('O container de produção não passou no health check.');
}
try {
  docker('volume', 'create', resource);
  start();
  await healthy();
  const response = await fetch(`${base}/api/registrations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tawper-Request': '1' },
    body: JSON.stringify({ name: 'Pessoa Teste Docker', phone: '11987654321', role: 'Teste', company: 'Empresa Fictícia', consent: true })
  });
  assert.equal(response.status, 201, 'o usuário não root precisa escrever no volume');
  docker('stop', resource);
  docker('rm', resource);
  start();
  await healthy();
  const dashboard = await (await fetch(`${base}/api/admin/dashboard`)).json();
  assert.equal(dashboard.total, 1, 'a recriação do container deve preservar os cadastros');
  console.log('Docker: health check, cadastro e persistência após recriação aprovados.');
} finally {
  try { docker('rm', '-f', resource); } catch { /* It may not have started. */ }
  try { docker('volume', 'rm', resource); } catch { /* It may not have been created. */ }
}
