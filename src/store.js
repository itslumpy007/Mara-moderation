import { DatabaseSync, backup } from 'node:sqlite';
export function createStore(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.exec(`
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, target TEXT NOT NULL,
      actor TEXT NOT NULL, reason TEXT NOT NULL, created TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0, revoke_reason TEXT, revoked_by TEXT
    );
    CREATE INDEX IF NOT EXISTS cases_target ON cases(target,id);
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, payload TEXT NOT NULL,
      private INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
    );
  `);
  const addCase = ({type,target,actor,reason,created=new Date().toISOString()}) => Number(db.prepare('INSERT INTO cases(type,target,actor,reason,created) VALUES (?,?,?,?,?)').run(type,target,actor,reason,created).lastInsertRowid);
  const store = {
    get(key, fallback = null) { const row = db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; },
    set(key, value) { db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); },
    list(prefix) { return db.prepare('SELECT key,value FROM kv WHERE substr(key,1,?)=?').all(prefix.length,prefix).map(r=>({key:r.key,value:JSON.parse(r.value)})); },
    delete(key) { db.prepare('DELETE FROM kv WHERE key=?').run(key); },
    addCase,
    case(id) { return db.prepare('SELECT * FROM cases WHERE id=?').get(id) || null; },
    cases({target='',before=Number.MAX_SAFE_INTEGER,limit=20}={}) {
      return db.prepare("SELECT * FROM cases WHERE id < ? AND (? = '' OR target=?) ORDER BY id DESC LIMIT ?").all(before,target,target,Math.min(100,Math.max(1,limit)));
    },
    warningCount(target) { return db.prepare("SELECT count(*) AS n FROM cases WHERE target=? AND type='warn' AND revoked=0").get(target).n; },
    revokeWarning(id, actor, reason) { return db.prepare("UPDATE cases SET revoked=1, revoked_by=?, revoke_reason=? WHERE id=? AND type='warn' AND revoked=0").run(actor,reason,id).changes === 1; },
    enqueue(channel,payload,isPrivate=false) {
      return Number(db.prepare('INSERT INTO outbox(channel,payload,private,created) VALUES (?,?,?,?)').run(channel,JSON.stringify(payload),isPrivate?1:0,Date.now()).lastInsertRowid);
    },
    pending(now=Date.now()) { return db.prepare('SELECT * FROM outbox WHERE next_attempt <= ? ORDER BY id LIMIT 10').all(now); },
    delivered(id) { db.prepare('DELETE FROM outbox WHERE id=?').run(id); },
    failed(id, attempts) { db.prepare('UPDATE outbox SET attempts=?, next_attempt=? WHERE id=?').run(attempts,Date.now()+Math.min(3600000,15000*2**Math.min(attempts,8)),id); },
    queueSize() { return db.prepare('SELECT count(*) AS n FROM outbox').get().n; },
    backup(destination) { return backup(db,destination); },
    close() { db.close(); }
  };
  if (!store.get('migration:cases-v1')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of store.list('warnings:')) for (const w of row.value || []) addCase({type:'warn',target:row.key.slice(9),actor:w.moderator || 'legacy',reason:w.reason || 'Legacy warning',created:w.date || new Date().toISOString()});
      store.set('migration:cases-v1',true); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return store;
}
