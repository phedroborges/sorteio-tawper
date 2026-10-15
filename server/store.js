import { DatabaseSync } from 'node:sqlite';
import { randomInt, randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppError } from './validation.js';

export const DRAW_DURATION = 10_000;

export function createStore(path, { now = Date.now, choose = randomInt } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS participants (
      number INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      company TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), registration_open INTEGER NOT NULL DEFAULT 1);
    INSERT OR IGNORE INTO settings(id) VALUES (1);
    CREATE TABLE IF NOT EXISTS draws (
      id TEXT PRIMARY KEY,
      request_key TEXT NOT NULL UNIQUE,
      started_at INTEGER NOT NULL,
      reveal_at INTEGER NOT NULL,
      pool TEXT NOT NULL,
      pool_hash TEXT NOT NULL,
      winner_index INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','completed'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_running_draw ON draws(status) WHERE status = 'running';
  `);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const settle = () => db.prepare("UPDATE draws SET status = 'completed' WHERE status = 'running' AND reveal_at <= ?").run(now());
  const running = () => db.prepare("SELECT * FROM draws WHERE status = 'running'").get();
  const allDraws = () => db.prepare('SELECT * FROM draws ORDER BY started_at DESC, rowid DESC').all();
  const winners = () => {
    const records = allDraws().filter(d => d.status === 'completed').map(d => JSON.parse(d.pool)[d.winner_index]);
    return { phones: new Set(records.map(p => p.phone)), ids: new Set(records.map(p => p.id)) };
  };
  const mapParticipant = (p, previous) => ({ id: p.id, number: p.number, name: p.name, phone: p.phone, role: p.role, company: p.company, createdAt: p.created_at, won: previous.phones.has(p.phone) || previous.ids.has(p.id) });
  const participants = (query = '') => {
    const phones = winners();
    const q = query.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
    return db.prepare('SELECT * FROM participants ORDER BY number DESC').all().map(p => mapParticipant(p, phones)).filter(p => !q || [p.name, p.company, p.role, p.phone, p.number].some(v => String(v).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').includes(q)));
  };
  const registrationOpen = () => Boolean(db.prepare('SELECT registration_open FROM settings WHERE id = 1').get().registration_open);
  const serializeDraw = row => {
    if (!row) return null;
    const pool = JSON.parse(row.pool);
    const result = {
      id: row.id, startedAt: row.started_at, revealAt: row.reveal_at, status: row.status,
      count: pool.length, poolHash: row.pool_hash,
      firstNames: pool.map(p => p.name.split(/\s+/u)[0])
    };
    if (row.status === 'completed') result.winner = pool[row.winner_index];
    return result;
  };
  const mutationAllowed = () => {
    settle();
    if (running()) throw new AppError(409, 'Aguarde o sorteio terminar para editar ou excluir cadastros.');
  };
  const uniqueError = err => {
    if (String(err.message).includes('participants.phone')) throw new AppError(409, 'Este telefone já está cadastrado. Cada telefone tem uma participação.', { phone: 'Este telefone já está cadastrado.' });
    throw err;
  };

  return {
    db,
    close: () => db.close(),
    publicStatus: () => ({ registrationOpen: registrationOpen() }),
    register(data) {
      return transaction(() => {
        if (!registrationOpen()) throw new AppError(409, 'As inscrições estão encerradas.');
        const id = randomUUID();
        const timestamp = now();
        let inserted;
        try { inserted = db.prepare('INSERT INTO participants(id,name,phone,role,company,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, data.name, data.phone, data.role, data.company, timestamp, timestamp); }
        catch (err) { uniqueError(err); }
        return { id, number: Number(inserted.lastInsertRowid), firstName: data.name.split(/\s+/u)[0] };
      });
    },
    dashboard(query = '') {
      settle();
      const all = participants();
      const draws = allDraws().map(serializeDraw);
      return {
        serverTime: now(), registrationOpen: registrationOpen(),
        total: all.length, eligible: all.filter(p => !p.won).length,
        companies: new Set(all.map(p => p.company.toLocaleLowerCase('pt-BR'))).size,
        participants: query ? participants(query) : all,
        activeDraw: draws.find(d => d.status === 'running') || null,
        draws: draws.filter(d => d.status === 'completed')
      };
    },
    export(query = '') { settle(); return participants(query); },
    setOpen(value) {
      db.prepare('UPDATE settings SET registration_open = ? WHERE id = 1').run(value ? 1 : 0);
      return { registrationOpen: registrationOpen() };
    },
    update(id, data) {
      return transaction(() => {
        mutationAllowed();
        if (!db.prepare('SELECT id FROM participants WHERE id = ?').get(id)) throw new AppError(404, 'Cadastro não encontrado.');
        try { db.prepare('UPDATE participants SET name=?,phone=?,role=?,company=?,updated_at=? WHERE id=?').run(data.name, data.phone, data.role, data.company, now(), id); }
        catch (err) { uniqueError(err); }
        return { ok: true };
      });
    },
    remove(id) {
      return transaction(() => {
        mutationAllowed();
        const result = db.prepare('DELETE FROM participants WHERE id = ?').run(id);
        if (!result.changes) throw new AppError(404, 'Cadastro não encontrado.');
        return { ok: true };
      });
    },
    startDraw(requestKey) {
      return transaction(() => {
        settle();
        const existing = db.prepare('SELECT * FROM draws WHERE request_key = ?').get(requestKey);
        if (existing) return { ...serializeDraw(existing), serverTime: now() };
        if (running()) throw new AppError(409, 'Já existe um sorteio em andamento.');
        const pool = participants().filter(p => !p.won).reverse().map(({ id, number, name, company, phone }) => ({ id, number, name, company, phone }));
        if (!pool.length) throw new AppError(409, 'Não há participantes disponíveis para sortear.');
        const json = JSON.stringify(pool);
        const id = randomUUID();
        const start = now();
        // crypto.randomInt uses rejection sampling (no modulo bias). One equal chance per unique phone.
        db.prepare('INSERT INTO draws(id,request_key,started_at,reveal_at,pool,pool_hash,winner_index,status) VALUES (?,?,?,?,?,?,?,?)')
          .run(id, requestKey, start, start + DRAW_DURATION, json, createHash('sha256').update(json).digest('hex'), choose(pool.length), 'running');
        return { ...serializeDraw(db.prepare('SELECT * FROM draws WHERE id = ?').get(id)), serverTime: now() };
      });
    },
    draw(id) {
      settle();
      const row = db.prepare('SELECT * FROM draws WHERE id = ?').get(id);
      if (!row) throw new AppError(404, 'Sorteio não encontrado.');
      return { ...serializeDraw(row), serverTime: now() };
    }
  };
}
