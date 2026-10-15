import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, DRAW_DURATION } from '../server/store.js';
import { createApp } from '../server/app.js';
import { validateParticipant, toCsv } from '../server/validation.js';

const person = (index = 0) => ({ name: ['Ana Teste', 'Bruno Teste', 'Carla Teste'][index] || `Pessoa Teste ${index}`, phone: `+551198765${String(1000 + index)}`, role: 'Engenharia', company: 'Empresa de Teste' });
function fixture(t, options = {}) { const store = createStore(':memory:', options); t.after(() => store.close()); return store; }

test('valida telefone brasileiro, normaliza E.164 e rejeita dados inválidos', () => {
  const data = validateParticipant({ ...person(), phone: '(11) 98765-1000' });
  assert.equal(data.phone, '+5511987651000');
  assert.equal(validateParticipant({ ...person(), phone: '+55 11 98765-1000' }).phone, data.phone);
  assert.equal(validateParticipant({ ...person(), phone: '(11) 3456-7890' }).phone, '+551134567890');
  for (const phone of ['123', '(00) 99999-9999', '+1 202 555 0123', 'ligue 11987651000']) assert.throws(() => validateParticipant({ ...person(), phone }), { status: 422 });
  assert.throws(() => validateParticipant({ ...person(), name: 'Ana' }), { status: 422 });
  assert.throws(() => validateParticipant({ ...person(), company: '<script>' }), { status: 422 });
});
test('um cadastro por telefone, mesmo com formatações distintas', t => {
  const store = fixture(t);
  store.register(validateParticipant({ ...person(), phone: '(11) 98765-1000' }));
  assert.throws(() => store.register(validateParticipant(person())), { status: 409 });
  assert.equal(store.dashboard().total, 1);
});
test('sorteio congela participantes e esconde ganhador até os 10 segundos', t => {
  let time = 100_000;
  const store = fixture(t, { now: () => time, choose: n => n - 1 });
  store.register(person(0)); store.register(person(1));
  const draw = store.startDraw(randomUUID());
  assert.equal(draw.count, 2);
  assert.equal(draw.revealAt - draw.startedAt, DRAW_DURATION);
  assert.equal(draw.winner, undefined);
  assert.equal(draw.winner_index, undefined);
  assert.deepEqual(draw.firstNames, ['Ana', 'Bruno']);
  store.register(person(2));
  time += 9999;
  assert.equal(store.draw(draw.id).winner, undefined);
  assert.equal(store.dashboard().draws.length, 0);
  time++;
  const result = store.draw(draw.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.winner.name, 'Bruno Teste');
  assert.equal(result.count, 2);
  assert.equal(store.dashboard().total, 3);
  assert.equal(store.dashboard().eligible, 2);
});
test('requisição repetida mantém o mesmo sorteio e dois sorteios não começam juntos', t => {
  const store = fixture(t);
  store.register(person());
  const key = randomUUID();
  const draw = store.startDraw(key);
  assert.equal(store.startDraw(key).id, draw.id);
  assert.throws(() => store.startDraw(randomUUID()), { status: 409 });
  assert.equal(store.db.prepare('SELECT count(*) AS count FROM draws').get().count, 1);
});
test('bloqueia edição e exclusão durante sorteio; exclui ganhador de próximas rodadas', t => {
  let time = 0;
  const store = fixture(t, { now: () => time, choose: () => 0 });
  const first = store.register(person(0)); store.register(person(1));
  store.startDraw(randomUUID());
  assert.throws(() => store.remove(first.id), { status: 409 });
  assert.throws(() => store.update(first.id, person(2)), { status: 409 });
  time += DRAW_DURATION;
  store.update(first.id, { ...person(0), phone: person(2).phone });
  assert.equal(store.dashboard().eligible, 1, 'mesmo cadastro vencedor continua excluído se o telefone for corrigido');
  const second = store.startDraw(randomUUID());
  assert.equal(second.count, 1);
  time += DRAW_DURATION;
  assert.equal(store.draw(second.id).winner.name, 'Bruno Teste');
  assert.throws(() => store.startDraw(randomUUID()), { status: 409 });
});
test('encerramento impede novos cadastros e reabertura funciona', t => {
  const store = fixture(t);
  store.setOpen(false);
  assert.throws(() => store.register(person()), { status: 409 });
  store.setOpen(true);
  store.register(person());
  assert.equal(store.dashboard().total, 1);
});
test('busca por acento, edição, conflito de telefone e exclusão', t => {
  const store = fixture(t);
  const first = store.register({ ...person(), name: 'Álvaro Teste' });
  store.register(person(1));
  assert.equal(store.dashboard('alvaro').participants.length, 1);
  assert.throws(() => store.update(first.id, person(1)), { status: 409 });
  store.update(first.id, { ...person(), company: 'Usina Atualizada' });
  assert.equal(store.dashboard('atualizada').participants.length, 1);
  store.remove(first.id);
  assert.equal(store.dashboard().total, 1);
});
test('cadastros e resultado sobrevivem à reinicialização do banco', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tawper-test-'));
  const path = join(directory, 'test.sqlite');
  let time = 500;
  let store = createStore(path, { now: () => time });
  try {
    store.register(person());
    store.setOpen(false);
    const draw = store.startDraw(randomUUID());
    store.close();
    time += DRAW_DURATION;
    store = createStore(path, { now: () => time });
    assert.equal(store.dashboard().total, 1);
    assert.equal(store.publicStatus().registrationOpen, false);
    assert.equal(store.draw(draw.id).winner.name, person().name);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('CSV tem BOM, caracteres especiais preservados e proteção contra fórmulas', () => {
  const csv = toCsv([{ number: 1, name: 'José "Teste"', phone: '+5511987651000', role: '=1+2', company: 'Usina; São João', createdAt: 0, won: false }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"José ""Teste"""'));
  assert.ok(csv.includes('"\'=1+2"'));
  assert.ok(csv.includes('"Usina; São João"'));
  assert.ok(csv.includes('31/12/1969'));
});
test('integração HTTP: cadastro, admin, CSV, consentimento e proteção de origem', async t => {
  const store = fixture(t);
  const app = createApp(store);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const send = (path, data, headers = {}) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tawper-Request': '1', ...headers }, body: JSON.stringify(data) });
  const home = await (await fetch(url)).text();
  assert.ok(!home.includes('/admin'));
  assert.equal((await fetch(url + '/admin')).headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await send('/api/registrations', { ...person(), consent: false })).status, 422);
  assert.equal((await send('/api/registrations', { ...person(), consent: true }, { Origin: 'https://outra-origem.test' })).status, 403);
  assert.equal((await send('/api/registrations', { ...person(), consent: true })).status, 201);
  assert.equal((await send('/api/registrations', { ...person(), consent: true })).status, 409);
  const dashboard = await (await fetch(url + '/api/admin/dashboard')).json();
  assert.equal(dashboard.total, 1);
  const csv = await fetch(url + '/api/admin/export.csv');
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  assert.match(await csv.text(), /Ana Teste/);
  const [first, second] = await Promise.all([send('/api/admin/draws', { requestKey: randomUUID() }), send('/api/admin/draws', { requestKey: randomUUID() })]);
  assert.deepEqual([first.status, second.status].sort(), [201, 409]);
  const draw = await (first.status === 201 ? first : second).json();
  assert.equal(draw.winner, undefined);
  assert.equal((await fetch(url + '/health')).status, 200);
});
