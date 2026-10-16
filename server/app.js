import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { AppError, validateParticipant, toCsv } from './validation.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
export function createApp(store, { publicOrigin = '', trustProxy = 0 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'upgrade-insecure-requests': null } }, strictTransportSecurity: publicOrigin.startsWith('https:') ? undefined : false }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('X-Tawper-Request') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site') return next(new AppError(403, 'Requisição não permitida.'));
      const origin = req.get('Origin');
      const allowedOrigin = publicOrigin || `${req.protocol}://${req.get('host')}`;
      if (origin && origin !== allowedOrigin) return next(new AppError(403, 'Origem não permitida.'));
      if (!req.is('application/json')) return next(new AppError(415, 'Envie os dados em JSON.'));
    }
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  const requests = new Map();
  app.post('/api/registrations', (req, res, next) => {
    const now = Date.now();
    for (const [key, item] of requests) if (item.until < now) requests.delete(key);
    const key = req.ip;
    const entry = requests.get(key) || { count: 0, until: now + 60_000 };
    requests.set(key, entry);
    if (++entry.count > 120) { res.set('Retry-After', '60'); return next(new AppError(429, 'Muitas tentativas. Aguarde um minuto e tente novamente.')); }
    if (req.body?.website) return next(new AppError(422, 'Não foi possível confirmar o cadastro.'));
    if (req.body?.consent !== true) return next(new AppError(422, 'Confirme que leu a informação sobre o uso dos dados.', { consent: 'Confirme para participar.' }));
    res.status(201).json(store.register(validateParticipant(req.body)));
  });
  app.get('/api/event', (req, res) => res.json(store.publicStatus()));
  app.get('/api/admin/dashboard', (req, res) => res.json(store.dashboard(String(req.query.q || '').slice(0, 150))));
  app.get('/api/admin/export.csv', (req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="tawper-participantes-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv(store.export(String(req.query.q || '').slice(0, 150))));
  });
  app.patch('/api/admin/event', (req, res) => {
    if (typeof req.body?.registrationOpen !== 'boolean') throw new AppError(422, 'Informe o estado das inscrições.');
    res.json(store.setOpen(req.body.registrationOpen));
  });
  app.patch('/api/admin/participants/:id', (req, res) => res.json(store.update(req.params.id, validateParticipant(req.body, { requireAnswers: false }))));
  app.delete('/api/admin/participants/:id', (req, res) => res.json(store.remove(req.params.id)));
  app.post('/api/admin/draws', (req, res) => {
    const key = req.body?.requestKey;
    if (typeof key !== 'string' || !/^[a-z0-9-]{36}$/i.test(key)) throw new AppError(422, 'Identificador do sorteio inválido.');
    res.status(201).json(store.startDraw(key));
  });
  app.get('/api/admin/draws/:id', (req, res) => res.json(store.draw(req.params.id)));
  app.get('/health', (req, res) => { store.publicStatus(); res.json({ ok: true }); });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.get(['/admin', '/admin/'], (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    res.sendFile('admin.html', { root: publicDir });
  });
  app.use(express.static(publicDir, { extensions: false, maxAge: '1h', setHeaders: (res, path) => {
    if (path.endsWith('.html')) res.set('Cache-Control', 'no-cache');
    if (path.endsWith('admin.html')) res.set('X-Robots-Tag', 'noindex, nofollow');
  } }));
  app.use((req, res) => res.status(404).send('Página não encontrada.'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message, fields: error.fields });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Dados acima do tamanho permitido.' });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'Dados inválidos.' });
    console.error('Falha na aplicação:', error.code || error.name);
    res.status(500).json({ error: 'Não foi possível concluir. Tente novamente em instantes.' });
  });
  return app;
}
