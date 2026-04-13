const SESSION_TTL_MS = 2 * 60 * 60 * 1000  // 2 hours
const EVICTION_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

// Map<sessionId, { contents: GeminiContent[], lastActive: Date }>
const sessions = new Map()

function getOrCreate(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { contents: [], lastActive: new Date() })
  }
  const session = sessions.get(sessionId)
  session.lastActive = new Date()
  return session
}

function update(sessionId, contents) {
  const session = sessions.get(sessionId)
  if (session) {
    session.contents = contents
    session.lastActive = new Date()
  }
}

function evictStale() {
  const cutoff = Date.now() - SESSION_TTL_MS
  for (const [id, session] of sessions) {
    if (session.lastActive.getTime() < cutoff) {
      sessions.delete(id)
    }
  }
}

// Start TTL eviction loop
setInterval(evictStale, EVICTION_INTERVAL_MS)

export { getOrCreate, update }
