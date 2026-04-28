// server/database/archieCatalog.js
// SQLite store for harvested OAI-PMH inventory records (EAD finding aids).
// Separate from auth db (db.js) so it can be deleted/rebuilt freely.

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_PATH = process.env.ARCHIE_CATALOG_DB
  || (process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'archie_catalog.db')
    : path.join(__dirname, 'archie_catalog.db'))

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inventories (
  guid             TEXT PRIMARY KEY,
  handle           TEXT,
  archive_no       TEXT NOT NULL,
  repository_code  TEXT NOT NULL,
  set_spec         TEXT NOT NULL,
  metadata_prefix  TEXT NOT NULL,
  title            TEXT NOT NULL,
  creator          TEXT,
  date_from        INTEGER,
  date_to          INTEGER,
  scope            TEXT,
  subjects         TEXT,
  language         TEXT,
  datestamp        TEXT NOT NULL,
  fetched_at       TEXT NOT NULL,
  is_deleted       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_inv_archive_no ON inventories(archive_no);
CREATE INDEX IF NOT EXISTS idx_inv_repo       ON inventories(repository_code);
CREATE INDEX IF NOT EXISTS idx_inv_datestamp  ON inventories(datestamp);
CREATE INDEX IF NOT EXISTS idx_inv_setspec    ON inventories(set_spec);

CREATE VIRTUAL TABLE IF NOT EXISTS inventories_fts USING fts5(
  title, scope, creator, subjects,
  content='inventories',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS inv_ai AFTER INSERT ON inventories BEGIN
  INSERT INTO inventories_fts(rowid, title, scope, creator, subjects)
  VALUES (new.rowid, new.title, new.scope, new.creator, new.subjects);
END;

CREATE TRIGGER IF NOT EXISTS inv_ad AFTER DELETE ON inventories BEGIN
  INSERT INTO inventories_fts(inventories_fts, rowid, title, scope, creator, subjects)
  VALUES ('delete', old.rowid, old.title, old.scope, old.creator, old.subjects);
END;

CREATE TRIGGER IF NOT EXISTS inv_au AFTER UPDATE ON inventories BEGIN
  INSERT INTO inventories_fts(inventories_fts, rowid, title, scope, creator, subjects)
  VALUES ('delete', old.rowid, old.title, old.scope, old.creator, old.subjects);
  INSERT INTO inventories_fts(rowid, title, scope, creator, subjects)
  VALUES (new.rowid, new.title, new.scope, new.creator, new.subjects);
END;

CREATE TABLE IF NOT EXISTS items (
  guid             TEXT PRIMARY KEY,
  handle           TEXT,
  archive_no       TEXT NOT NULL,
  repository_code  TEXT NOT NULL,
  title            TEXT NOT NULL,
  creator          TEXT,
  description      TEXT,
  date_from        INTEGER,
  date_to          INTEGER,
  datestamp        TEXT NOT NULL,
  fetched_at       TEXT NOT NULL,
  is_deleted       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_item_archive_no ON items(archive_no);
CREATE INDEX IF NOT EXISTS idx_item_datestamp  ON items(datestamp);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title, description, creator,
  content='items',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS item_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, title, description, creator)
  VALUES (new.rowid, new.title, new.description, new.creator);
END;

CREATE TRIGGER IF NOT EXISTS item_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, description, creator)
  VALUES ('delete', old.rowid, old.title, old.description, old.creator);
END;

CREATE TRIGGER IF NOT EXISTS item_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, description, creator)
  VALUES ('delete', old.rowid, old.title, old.description, old.creator);
  INSERT INTO items_fts(rowid, title, description, creator)
  VALUES (new.rowid, new.title, new.description, new.creator);
END;

CREATE TABLE IF NOT EXISTS harvest_state (
  set_spec              TEXT NOT NULL,
  metadata_prefix       TEXT NOT NULL,
  endpoint              TEXT NOT NULL,
  last_completed_at     TEXT,
  last_datestamp        TEXT,
  last_resumption_token TEXT,
  total_seen            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (endpoint, set_spec, metadata_prefix)
);

CREATE TABLE IF NOT EXISTS harvest_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint          TEXT NOT NULL,
  set_spec          TEXT NOT NULL,
  metadata_prefix   TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  records_seen      INTEGER NOT NULL DEFAULT 0,
  records_inserted  INTEGER NOT NULL DEFAULT 0,
  records_updated   INTEGER NOT NULL DEFAULT 0,
  records_deleted   INTEGER NOT NULL DEFAULT 0,
  from_param        TEXT,
  status            TEXT NOT NULL DEFAULT 'running',
  error             TEXT
);
`

export function openCatalogDb(dbPath = DEFAULT_PATH) {
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

const upsertSql = `
INSERT INTO inventories (
  guid, handle, archive_no, repository_code, set_spec, metadata_prefix,
  title, creator, date_from, date_to, scope, subjects, language,
  datestamp, fetched_at, is_deleted
) VALUES (
  @guid, @handle, @archive_no, @repository_code, @set_spec, @metadata_prefix,
  @title, @creator, @date_from, @date_to, @scope, @subjects, @language,
  @datestamp, @fetched_at, @is_deleted
)
ON CONFLICT(guid) DO UPDATE SET
  handle          = excluded.handle,
  archive_no      = excluded.archive_no,
  repository_code = excluded.repository_code,
  set_spec        = excluded.set_spec,
  metadata_prefix = excluded.metadata_prefix,
  title           = excluded.title,
  creator         = excluded.creator,
  date_from       = excluded.date_from,
  date_to         = excluded.date_to,
  scope           = excluded.scope,
  subjects        = excluded.subjects,
  language        = excluded.language,
  datestamp       = excluded.datestamp,
  fetched_at      = excluded.fetched_at,
  is_deleted      = excluded.is_deleted
`

export function makeUpsert(db) {
  const stmt = db.prepare(upsertSql)
  const existsStmt = db.prepare('SELECT 1 FROM inventories WHERE guid = ?')
  return function upsert(record) {
    const isNew = !existsStmt.get(record.guid)
    stmt.run(record)
    return isNew ? 'inserted' : 'updated'
  }
}

export function markDeleted(db, guid, datestamp, fetchedAt) {
  return db.prepare(`
    UPDATE inventories
       SET is_deleted = 1, datestamp = ?, fetched_at = ?
     WHERE guid = ?
  `).run(datestamp, fetchedAt, guid).changes > 0
}

export function getHarvestState(db, endpoint, setSpec, metadataPrefix) {
  return db.prepare(`
    SELECT * FROM harvest_state
     WHERE endpoint = ? AND set_spec = ? AND metadata_prefix = ?
  `).get(endpoint, setSpec, metadataPrefix)
}

export function saveHarvestState(db, state) {
  db.prepare(`
    INSERT INTO harvest_state (
      endpoint, set_spec, metadata_prefix,
      last_completed_at, last_datestamp, last_resumption_token, total_seen
    ) VALUES (
      @endpoint, @set_spec, @metadata_prefix,
      @last_completed_at, @last_datestamp, @last_resumption_token, @total_seen
    )
    ON CONFLICT(endpoint, set_spec, metadata_prefix) DO UPDATE SET
      last_completed_at     = excluded.last_completed_at,
      last_datestamp        = excluded.last_datestamp,
      last_resumption_token = excluded.last_resumption_token,
      total_seen            = excluded.total_seen
  `).run(state)
}

export function startHarvestRun(db, run) {
  return db.prepare(`
    INSERT INTO harvest_runs (
      endpoint, set_spec, metadata_prefix, started_at, from_param, status
    ) VALUES (?, ?, ?, ?, ?, 'running')
  `).run(run.endpoint, run.set_spec, run.metadata_prefix, run.started_at, run.from_param || null).lastInsertRowid
}

export function finishHarvestRun(db, runId, summary) {
  db.prepare(`
    UPDATE harvest_runs SET
      finished_at      = @finished_at,
      records_seen     = @records_seen,
      records_inserted = @records_inserted,
      records_updated  = @records_updated,
      records_deleted  = @records_deleted,
      status           = @status,
      error            = @error
    WHERE id = @id
  `).run({ id: runId, ...summary })
}

export function search(db, query, limit = 10) {
  return db.prepare(`
    SELECT i.guid, i.handle, i.archive_no, i.repository_code,
           i.title, i.creator, i.date_from, i.date_to,
           snippet(inventories_fts, 1, '«', '»', '…', 12) AS snippet,
           bm25(inventories_fts) AS rank
      FROM inventories_fts
      JOIN inventories i ON i.rowid = inventories_fts.rowid
     WHERE inventories_fts MATCH ?
       AND i.is_deleted = 0
     ORDER BY rank
     LIMIT ?
  `).all(query, limit)
}

export function makeItemUpsert(db) {
  const stmt = db.prepare(`
    INSERT INTO items (
      guid, handle, archive_no, repository_code, title, creator, description,
      date_from, date_to, datestamp, fetched_at, is_deleted
    ) VALUES (
      @guid, @handle, @archive_no, @repository_code, @title, @creator, @description,
      @date_from, @date_to, @datestamp, @fetched_at, @is_deleted
    )
    ON CONFLICT(guid) DO UPDATE SET
      handle          = excluded.handle,
      title           = excluded.title,
      creator         = excluded.creator,
      description     = excluded.description,
      date_from       = excluded.date_from,
      date_to         = excluded.date_to,
      datestamp       = excluded.datestamp,
      fetched_at      = excluded.fetched_at,
      is_deleted      = excluded.is_deleted
  `)
  return function upsert(record) {
    stmt.run(record)
  }
}

export function searchItems(db, query, limit = 10) {
  return db.prepare(`
    SELECT i.guid, i.handle, i.archive_no, i.repository_code,
           i.title, i.creator, i.description, i.date_from, i.date_to,
           snippet(items_fts, 2, '«', '»', '…', 12) AS snippet,
           bm25(items_fts) AS rank
      FROM items_fts
      JOIN items i ON i.rowid = items_fts.rowid
     WHERE items_fts MATCH ?
       AND i.is_deleted = 0
     ORDER BY rank
     LIMIT ?
  `).all(query, limit)
}

export const CATALOG_DB_PATH = DEFAULT_PATH
