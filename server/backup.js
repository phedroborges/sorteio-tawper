import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const databasePath = resolve(process.env.DATABASE_PATH || './data/tawper.sqlite');
const backupDirectory = join(dirname(databasePath), 'backups');
mkdirSync(backupDirectory, { recursive: true });
const destination = join(backupDirectory, `tawper-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
try {
  await backup(db, destination);
  console.log(`Backup concluído: ${destination}`);
} finally { db.close(); }
