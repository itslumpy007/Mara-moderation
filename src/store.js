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
    CREATE TABLE IF NOT EXISTS moderation_requests (
      id TEXT PRIMARY KEY, guild TEXT NOT NULL, actor TEXT NOT NULL, target TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('kick', 'ban')), reason TEXT NOT NULL,
      expires INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS moderation_requests_expiry ON moderation_requests(expires);
    CREATE TABLE IF NOT EXISTS onboarding (
      guild TEXT NOT NULL, member TEXT NOT NULL, joined_at INTEGER NOT NULL,
      welcomed_at INTEGER, verified_at INTEGER, left_at INTEGER,
      welcome_pending INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(guild, member)
    );
    CREATE INDEX IF NOT EXISTS onboarding_pending
      ON onboarding(guild, welcome_pending, next_attempt) WHERE left_at IS NULL;
    CREATE TABLE IF NOT EXISTS rules_versions (
      guild TEXT NOT NULL, version TEXT NOT NULL, rules TEXT NOT NULL,
      PRIMARY KEY(guild, version)
    );
    CREATE TABLE IF NOT EXISTS rules_acceptances (
      guild TEXT NOT NULL, member TEXT NOT NULL, version TEXT NOT NULL, accepted_at INTEGER NOT NULL,
      PRIMARY KEY(guild, member, version)
    );
    CREATE INDEX IF NOT EXISTS rules_acceptances_latest ON rules_acceptances(guild, member, accepted_at);
    CREATE TABLE IF NOT EXISTS tiktok_live_alerts (
      creator TEXT NOT NULL, room_id TEXT NOT NULL, PRIMARY KEY(creator,room_id)
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, payload TEXT NOT NULL,
      private INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
    );
  `);
  const addCase = ({type,target,actor,reason,created=new Date().toISOString()}) => Number(db.prepare('INSERT INTO cases(type,target,actor,reason,created) VALUES (?,?,?,?,?)').run(type,target,actor,reason,created).lastInsertRowid);
  function recordJoin(guild, member, joinedAt, welcomePending) {
    db.prepare(`INSERT INTO onboarding(guild,member,joined_at,welcome_pending) VALUES (?,?,?,?)
      ON CONFLICT(guild,member) DO UPDATE SET joined_at=excluded.joined_at,
        welcomed_at=NULL, verified_at=NULL, left_at=NULL, welcome_pending=excluded.welcome_pending,
        attempts=0, next_attempt=0
      WHERE excluded.joined_at>onboarding.joined_at`).run(guild,member,joinedAt,Number(welcomePending));
  }
  function recordRulesAcceptance(guild, member, acceptance) {
    if (!acceptance) return;
    db.prepare('INSERT OR IGNORE INTO rules_versions VALUES (?,?,?)').run(guild,acceptance.version,acceptance.rules);
    db.prepare('INSERT OR IGNORE INTO rules_acceptances VALUES (?,?,?,?)')
      .run(guild,member,acceptance.version,acceptance.acceptedAt);
  }
  function markVerified(guild,member,joinedAt,time) {
    recordJoin(guild,member,joinedAt,false);
    db.prepare(`UPDATE onboarding SET verified_at=COALESCE(verified_at,?)
      WHERE guild=? AND member=? AND joined_at=? AND left_at IS NULL`).run(time,guild,member,joinedAt);
  }
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  const store = {
    get(key, fallback = null) { const row = db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; },
    set(key, value) { db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); },
    list(prefix) { return db.prepare('SELECT key,value FROM kv WHERE substr(key,1,?)=?').all(prefix.length,prefix).map(r=>({key:r.key,value:JSON.parse(r.value)})); },
    delete(key) { db.prepare('DELETE FROM kv WHERE key=?').run(key); },
    addCase,
    recordJoin,
    recordDeparture(guild,member,joinedAt,time) {
      db.prepare(`UPDATE onboarding SET left_at=?, welcome_pending=0
        WHERE guild=? AND member=? AND joined_at=? AND left_at IS NULL`).run(time,guild,member,joinedAt);
    },
    onboarding(guild,member) {
      return db.prepare('SELECT * FROM onboarding WHERE guild=? AND member=?').get(guild,member);
    },
    dueWelcomes(guild, now) {
      return db.prepare(`SELECT * FROM onboarding WHERE guild=? AND welcome_pending=1
        AND left_at IS NULL AND next_attempt<=? ORDER BY next_attempt,joined_at LIMIT 10`).all(guild,now);
    },
    welcomeSent({guild,member,joined_at},time) {
      db.prepare(`UPDATE onboarding SET welcomed_at=?, welcome_pending=0
        WHERE guild=? AND member=? AND joined_at=? AND left_at IS NULL`).run(time,guild,member,joined_at);
    },
    postponeWelcome({guild,member,joined_at,attempts},time) {
      const delay = Math.min(3600000,15000*2**Math.min(attempts,8));
      db.prepare(`UPDATE onboarding SET next_attempt=?, attempts=attempts+1
        WHERE guild=? AND member=? AND joined_at=? AND welcome_pending=1`).run(time+delay,guild,member,joined_at);
    },
    latestRulesAcceptance(guild,member) {
      return db.prepare(`SELECT version,accepted_at FROM rules_acceptances WHERE guild=? AND member=?
        ORDER BY accepted_at DESC,rowid DESC LIMIT 1`).get(guild,member);
    },
    finishVerification({guild,member,joinedAt,actor,reason,acceptance,acceptedSinceGrant,journalKey,time}) {
      return transaction(() => {
        recordRulesAcceptance(guild,member,acceptance);
        recordRulesAcceptance(guild,member,acceptedSinceGrant);
        markVerified(guild,member,joinedAt,time);
        store.delete('verify-review:'+member);
        if (journalKey) {
          addCase({type:'verify',target:member,actor,reason,created:new Date(time).toISOString()});
          store.delete(journalKey);
        }
      });
    },
    createModerationRequest({id,guild,actor,target,type,reason,expires}) {
      db.prepare('DELETE FROM moderation_requests WHERE expires <= ?').run(expires - 86400000);
      db.prepare('INSERT INTO moderation_requests(id,guild,actor,target,type,reason,expires) VALUES (?,?,?,?,?,?,?)')
        .run(id,guild,actor,target,type,reason,expires);
    },
    moderationRequest(id) {
      return db.prepare('SELECT * FROM moderation_requests WHERE id=?').get(id);
    },
    claimModerationRequest(id, now) {
      return db.prepare(
        "UPDATE moderation_requests SET status='processing' WHERE id=? AND status='pending' AND expires>?"
      ).run(id,now).changes === 1;
    },
    setModerationRequestStatus(id, status) {
      db.prepare("UPDATE moderation_requests SET status=? WHERE id=? AND status='processing'").run(status,id);
    },
    completeModerationRequest(request) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = db.prepare(
          "UPDATE moderation_requests SET status='completed' WHERE id=? AND status='processing'"
        ).run(request.id);
        if (result.changes !== 1) throw Error('Moderation request is no longer processing.');
        const caseId = addCase(request);
        db.exec('COMMIT');
        return caseId;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    case(id) { return db.prepare('SELECT * FROM cases WHERE id=?').get(id) || null; },
    cases({target='',before=Number.MAX_SAFE_INTEGER,limit=20}={}) {
      return db.prepare("SELECT * FROM cases WHERE id < ? AND (? = '' OR target=?) ORDER BY id DESC LIMIT ?").all(before,target,target,Math.min(100,Math.max(1,limit)));
    },
    warningCount(target) { return db.prepare("SELECT count(*) AS n FROM cases WHERE target=? AND type='warn' AND revoked=0").get(target).n; },
    revokeWarning(id, actor, reason) { return db.prepare("UPDATE cases SET revoked=1, revoked_by=?, revoke_reason=? WHERE id=? AND type='warn' AND revoked=0").run(actor,reason,id).changes === 1; },
    enqueue(channel,payload,isPrivate=false) {
      return Number(db.prepare('INSERT INTO outbox(channel,payload,private,created) VALUES (?,?,?,?)').run(channel,JSON.stringify(payload),isPrivate?1:0,Date.now()).lastInsertRowid);
    },
    enqueueTikTokLive(creator,roomId,channel,payload) {
      return transaction(() => {
        const insert = db.prepare('INSERT OR IGNORE INTO tiktok_live_alerts VALUES (?,?)').run(creator,roomId);
        if (!insert.changes) return false;
        if (store.queueSize() >= 10000) throw Error('Delivery queue is full.');
        store.enqueue(channel,payload);
        return true;
      });
    },
    pending(now=Date.now()) { return db.prepare('SELECT * FROM outbox WHERE next_attempt <= ? ORDER BY id LIMIT 10').all(now); },
    delivered(id) { db.prepare('DELETE FROM outbox WHERE id=?').run(id); },
    failed(id, attempts, now=Date.now()) { db.prepare('UPDATE outbox SET attempts=?, next_attempt=? WHERE id=?').run(attempts,now+Math.min(3600000,15000*2**Math.min(attempts,8)),id); },
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
