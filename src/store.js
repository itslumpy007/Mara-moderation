import { DatabaseSync } from 'node:sqlite';
export function createStore(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  return {
    get(key, fallback = null) { const row = db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; },
    set(key, value) { db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); },
    close() { db.close(); }
  };
}
