import { createApp } from './app.js';
import { createStore } from './store.js';

const store = createStore(process.env.DATABASE_PATH || './data/tawper.sqlite');
const app = createApp(store, {
  publicOrigin: process.env.PUBLIC_ORIGIN?.replace(/\/$/, '') || '',
  trustProxy: Number(process.env.TRUST_PROXY || 0)
});
const server = app.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => {
  console.log(`Tawper: servidor iniciado na porta ${server.address().port}`);
});
const shutdown = () => { server.close(() => { store.close(); process.exit(0); }); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
