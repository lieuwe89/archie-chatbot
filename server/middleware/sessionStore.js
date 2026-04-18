import { Store } from 'express-session';
import { db } from '../database/db.js';

export class SQLiteSessionStore extends Store {
  constructor() {
    super();
  }

  get(sid, callback) {
    try {
      const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?').get(sid, Math.floor(Date.now() / 1000));
      if (!row) return callback(null, null);
      const sess = JSON.parse(row.sess);
      callback(null, sess);
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const expire = Math.floor(Date.now() / 1000) + (sess.cookie.maxAge || 86400000) / 1000;
      const sessJson = JSON.stringify(sess);
      db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expire) VALUES (?, ?, ?)').run(sid, sessJson, expire);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  clear(callback) {
    try {
      db.prepare('DELETE FROM sessions').run();
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  length(callback) {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE expire > ?').get(Math.floor(Date.now() / 1000));
      callback(null, row.count);
    } catch (err) {
      callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      const expire = Math.floor(Date.now() / 1000) + (sess.cookie.maxAge || 86400000) / 1000;
      db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(expire, sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}
