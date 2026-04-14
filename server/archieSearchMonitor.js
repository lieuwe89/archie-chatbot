// server/archieSearchMonitor.js
// Tracks daily Google Custom Search API usage against the 100 req/day free quota.
import { db } from './database/db.js'

const DAILY_LIMIT = 100
const WARN_AT = 80   // log warning from this count onward
const URGENT_AT = 95 // log urgent warning from this count onward

db.exec(`
  CREATE TABLE IF NOT EXISTS cse_usage (
    date    TEXT    PRIMARY KEY,
    count   INTEGER NOT NULL DEFAULT 0,
    warned  INTEGER NOT NULL DEFAULT 0
  )
`)

function today() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Call once per outgoing CSE request.
 * Returns { count, limit, nearLimit, overLimit }.
 */
export function recordCseRequest() {
  const date = today()

  db.prepare(`
    INSERT INTO cse_usage (date, count) VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET count = count + 1
  `).run(date)

  const { count } = db.prepare('SELECT count FROM cse_usage WHERE date = ?').get(date)

  if (count >= URGENT_AT) {
    console.warn(
      `[CSE MONITOR] URGENT: ${count}/${DAILY_LIMIT} Google Custom Search requests used today (${date}). ` +
      'Quota nearly exhausted — website search will fail if limit is hit.'
    )
  } else if (count >= WARN_AT) {
    console.warn(
      `[CSE MONITOR] WARNING: ${count}/${DAILY_LIMIT} Google Custom Search requests used today (${date}).`
    )
  }

  return buildStatus(count, date)
}

/**
 * Read current status without incrementing.
 */
export function getCseStatus() {
  const date = today()
  const row = db.prepare('SELECT count FROM cse_usage WHERE date = ?').get(date)
  return buildStatus(row?.count ?? 0, date)
}

function buildStatus(count, date) {
  return {
    date,
    count,
    limit: DAILY_LIMIT,
    nearLimit: count >= WARN_AT,
    overLimit: count >= DAILY_LIMIT
  }
}
