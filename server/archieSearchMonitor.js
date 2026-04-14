// server/archieSearchMonitor.js
// Tracks daily Tavily API usage for monitoring purposes.
import { db } from './database/db.js'

const DAILY_LIMIT = 200
const WARN_AT = 150
const URGENT_AT = 190

db.exec(`
  CREATE TABLE IF NOT EXISTS tavily_usage (
    date    TEXT    PRIMARY KEY,
    count   INTEGER NOT NULL DEFAULT 0,
    warned  INTEGER NOT NULL DEFAULT 0
  )
`)

function today() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Call once per outgoing Tavily request.
 * Returns { count, limit, nearLimit, overLimit }.
 */
export function recordSearchRequest() {
  const date = today()

  db.prepare(`
    INSERT INTO tavily_usage (date, count) VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET count = count + 1
  `).run(date)

  const { count } = db.prepare('SELECT count FROM tavily_usage WHERE date = ?').get(date)

  if (count >= URGENT_AT) {
    console.warn(
      `[TAVILY MONITOR] URGENT: ${count}/${DAILY_LIMIT} Tavily search requests used today (${date}).`
    )
  } else if (count >= WARN_AT) {
    console.warn(
      `[TAVILY MONITOR] WARNING: ${count}/${DAILY_LIMIT} Tavily search requests used today (${date}).`
    )
  }

  return buildStatus(count, date)
}

/**
 * Read current status without incrementing.
 */
export function getSearchStatus() {
  const date = today()
  const row = db.prepare('SELECT count FROM tavily_usage WHERE date = ?').get(date)
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
