# Archie Intelligence Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Archie from a single-shot keyword search to an agentic multi-turn chatbot with Gemini function calling, in-memory conversation history, LanceDB RAG knowledge retrieval, and a server-rendered admin panel for managing the knowledge base.

**Architecture:** A new `POST /api/archie/chat` endpoint replaces `/api/archie/search`. It loads session history from an in-memory map, retrieves top-5 RAG chunks from LanceDB, builds a system instruction, and runs a Gemini agentic loop until the model stops issuing tool calls. Session history is stored as Gemini `contents[]` format, updated after each exchange. The React frontend sends `{ message, sessionId }` and receives `{ reply, toolCalls[], sessionId }`. An Express-served HTML admin panel at `/archie/admin` manages the LanceDB knowledge base via file upload.

**Tech Stack:** Node.js/Express (ES modules), `@google/generative-ai` ^0.21.0, `@lancedb/lancedb`, `express-session`, `multer` (already installed), `pdf-parse`, React + Tailwind (frontend)

---

## File Map

**Create:**
- `server/archieSession.js` — in-memory session map + TTL eviction
- `server/archieTools.js` — Gemini function declaration definitions for all search tools
- `server/archieRag.js` — LanceDB init, embed with `text-embedding-004`, retrieve, CRUD
- `server/routes/archieAdmin.js` — server-rendered admin panel (login, document list, upload, delete)
- `server/scripts/scrapeGA.js` — one-time scraper for GA website and AlleGroningers help content

**Modify:**
- `server/routes/archie.js` — replace `/search` with `/chat`, wire agentic loop
- `server/index.js` — add `express-session` middleware + mount `/archie/admin` routes before static serving
- `src/utils/api.js` — add `api.archie.chat(message, sessionId)`
- `src/components/ArchieInterface.jsx` — sessionId management, tool call indicators, use `/chat`

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install new packages**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
npm install @lancedb/lancedb pdf-parse express-session
```

Expected: packages added to `node_modules/` and `package.json` dependencies.

- [ ] **Step 2: Verify installation**

```bash
node -e "import('@lancedb/lancedb').then(() => console.log('lancedb ok')); import('pdf-parse').then(() => console.log('pdf-parse ok')); import('express-session').then(() => console.log('express-session ok'))"
```

Expected: three `ok` lines printed.

- [ ] **Step 3: Commit**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
git add package.json package-lock.json
git commit -m "chore: install lancedb, pdf-parse, express-session for Archie intelligence upgrade"
```

---

## Task 2: API Audit — Discover Full AlleGroningers and Beeldbank Filter Params

The spec explicitly requires a thorough API audit before writing tool definitions. This task runs test calls against both APIs and logs the full response structure.

**Files:**
- Create (temporary): `server/scripts/auditApis.js`

- [ ] **Step 1: Create audit script**

```js
// server/scripts/auditApis.js
import fetch from 'node-fetch'

const BEELDBANK_API_KEY = 'fd45b590-346a-11e5-a2cb-0800200c9a66'
const GENEALOGY_API_KEY = '6976bb7e-0c61-4f03-bf5b-df645d5fd086'

async function auditAlleGroningers() {
  console.log('\n=== AlleGroningers API ===')

  // Base response structure
  const base = await fetch(
    `https://webservices.memorix.nl/genealogy/person?apiKey=${GENEALOGY_API_KEY}&q=janssen&rows=2`
  ).then(r => r.json())
  console.log('Base response keys:', Object.keys(base))
  if (base.person?.[0]) {
    console.log('Person keys:', Object.keys(base.person[0]))
    console.log('Metadata keys:', Object.keys(base.person[0].metadata || {}))
    console.log('Sample record:', JSON.stringify(base.person[0], null, 2))
  }

  // Test deed_type filter
  const doop = await fetch(
    `https://webservices.memorix.nl/genealogy/person?apiKey=${GENEALOGY_API_KEY}&q=janssen&rows=2&deed_type=doop`
  ).then(r => r.json())
  console.log('\ndeed_type=doop result count:', doop.person?.length, '(vs base:', base.person?.length, ')')

  // Test gemeente filter
  const gem = await fetch(
    `https://webservices.memorix.nl/genealogy/person?apiKey=${GENEALOGY_API_KEY}&q=janssen&rows=2&gemeente=Groningen`
  ).then(r => r.json())
  console.log('gemeente=Groningen result count:', gem.person?.length)

  // Test sort
  const sorted = await fetch(
    `https://webservices.memorix.nl/genealogy/person?apiKey=${GENEALOGY_API_KEY}&q=janssen&rows=2&sort=datum+asc`
  ).then(r => r.json())
  console.log('sort=datum asc works:', sorted.person?.length > 0)

  // Test pagination
  const page2 = await fetch(
    `https://webservices.memorix.nl/genealogy/person?apiKey=${GENEALOGY_API_KEY}&q=janssen&rows=2&start=2`
  ).then(r => r.json())
  console.log('start=2 pagination works:', JSON.stringify(page2).includes('person'))

  // Check total count field
  console.log('Total count field:', base.numFound ?? base.total ?? base.count ?? 'not found')
  console.log('Raw (trimmed):', JSON.stringify(base).substring(0, 500))
}

async function auditBeeldbank() {
  console.log('\n=== Beeldbank API ===')

  const base = await fetch(
    `https://webservices.memorix.nl/mediabank/media?apiKey=${BEELDBANK_API_KEY}&q=akerk&rows=2`
  ).then(r => r.json())
  console.log('Base response keys:', Object.keys(base))
  if (base.media?.[0]) {
    console.log('Media keys:', Object.keys(base.media[0]))
    console.log('Metadata keys:', Object.keys(base.media[0].metadata || {}))
    console.log('Sample record:', JSON.stringify(base.media[0], null, 2))
  }

  // Test media_type filter
  const typed = await fetch(
    `https://webservices.memorix.nl/mediabank/media?apiKey=${BEELDBANK_API_KEY}&q=akerk&rows=2&media_type=photo`
  ).then(r => r.json())
  console.log('media_type=photo result count:', typed.media?.length)

  // Test date range
  const dated = await fetch(
    `https://webservices.memorix.nl/mediabank/media?apiKey=${BEELDBANK_API_KEY}&q=groningen&rows=2&from_date=1900&to_date=1950`
  ).then(r => r.json())
  console.log('date range filter works:', dated.media?.length > 0)

  console.log('Total count field:', base.numFound ?? base.total ?? base.count ?? 'not found')
}

auditAlleGroningers().then(auditBeeldbank).catch(console.error)
```

- [ ] **Step 2: Run the audit**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
node server/scripts/auditApis.js 2>&1 | tee /tmp/archie-api-audit.txt
cat /tmp/archie-api-audit.txt
```

- [ ] **Step 3: Document findings**

Review output. Note:
- Exact field names in `person[0].metadata` (look for `deed_type`, `gemeente`, `datum`, `register_naam`, etc.)
- Whether `deed_type` param accepts values like `"doop"`, `"huwelijk"`, `"overlijden"`
- Whether `start` param works for pagination
- Beeldbank: what `media_type` values are accepted, what metadata fields exist
- Whether total count is exposed (for `numFound` or similar)

Update `server/archieTools.js` in Task 4 with any additional params discovered. Delete `server/scripts/auditApis.js` after (it's not committed).

---

## Task 3: Create `server/archieSession.js`

In-memory session map keyed by UUID. Each session stores Gemini `contents[]` history. TTL eviction runs every 15 minutes and drops sessions inactive >2 hours.

**Files:**
- Create: `server/archieSession.js`

- [ ] **Step 1: Create the file**

```js
// server/archieSession.js

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
```

- [ ] **Step 2: Verify the module loads**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
node -e "
import('./server/archieSession.js').then(m => {
  const s = m.getOrCreate('test-123')
  console.log('session created:', Array.isArray(s.contents), s.lastActive instanceof Date)
  m.update('test-123', [{ role: 'user', parts: [] }])
  const s2 = m.getOrCreate('test-123')
  console.log('session updated:', s2.contents.length === 1)
  console.log('PASS')
})
"
```

Expected: three `true` lines and `PASS`.

- [ ] **Step 3: Commit**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
git add server/archieSession.js
git commit -m "feat: add in-memory session store with TTL eviction for Archie chat"
```

---

## Task 4: Create `server/archieTools.js`

Gemini function declarations for all three search tools. Params are based on the API audit from Task 2. Update any params discovered during the audit.

**Files:**
- Create: `server/archieTools.js`

- [ ] **Step 1: Create the file**

```js
// server/archieTools.js
import fetch from 'node-fetch'

const BEELDBANK_API_KEY = 'fd45b590-346a-11e5-a2cb-0800200c9a66'
const GENEALOGY_API_KEY = '6976bb7e-0c61-4f03-bf5b-df645d5fd086'

// Gemini function declarations
export const toolDeclarations = [
  {
    name: 'searchAlleGroningers',
    description: 'Search genealogical records (birth, marriage, death, baptism registers, etc.) in the Groninger Archieven via AlleGroningers. Use multiple calls with different parameters to find comprehensive results.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Keyword search query. Can be a name, place, or combination.'
        },
        deed_type: {
          type: 'string',
          description: 'Type of record. Examples: "doop" (baptism), "huwelijk" (marriage), "overlijden" (death), "begraven" (burial).'
        },
        gemeente: {
          type: 'string',
          description: 'Municipality filter, e.g. "Groningen", "Appingedam".'
        },
        rows: {
          type: 'number',
          description: 'Number of results to return. Default 5, max 20.'
        },
        start: {
          type: 'number',
          description: 'Offset for pagination. Default 0.'
        },
        sort: {
          type: 'string',
          description: 'Sort order, e.g. "datum asc" or "datum desc".'
        }
      },
      required: ['q']
    }
  },
  {
    name: 'searchBeeldbank',
    description: 'Search historical images and photographs in Beeldbank Groningen. Use for visual records, building photos, maps, portraits.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Keyword search query.'
        },
        rows: {
          type: 'number',
          description: 'Number of results to return. Default 5, max 20.'
        },
        start: {
          type: 'number',
          description: 'Offset for pagination. Default 0.'
        },
        from_date: {
          type: 'string',
          description: 'Start of date range filter, e.g. "1900".'
        },
        to_date: {
          type: 'string',
          description: 'End of date range filter, e.g. "1950".'
        }
      },
      required: ['q']
    }
  },
  {
    name: 'searchInventories',
    description: 'Search archive inventories and finding aids. Currently returns no results — this source is under development.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Keyword search query.'
        }
      },
      required: ['q']
    }
  }
]

// Tool executors
async function searchAlleGroningers({ q, deed_type, gemeente, rows = 5, start = 0, sort }) {
  try {
    const params = new URLSearchParams({
      apiKey: GENEALOGY_API_KEY,
      q,
      rows: Math.min(rows, 20),
      start
    })
    if (deed_type) params.set('deed_type', deed_type)
    if (gemeente) params.set('gemeente', gemeente)
    if (sort) params.set('sort', sort)

    const url = `https://webservices.memorix.nl/genealogy/person?${params}`
    const response = await fetch(url)
    const data = await response.json()
    return (data.person || []).map(p => ({
      source: 'AlleGroningers',
      title: p.metadata?.person_display_name || q,
      date: p.metadata?.datum,
      deed_type: p.metadata?.deed_type_title,
      municipality: p.metadata?.register_gemeente,
      register: p.metadata?.register_naam,
      url: `https://www.allegroningers.nl/zoeken-op-naam/persons/${p.entity_uuid}`
    }))
  } catch (e) {
    return { error: e.message }
  }
}

async function searchBeeldbank({ q, rows = 5, start = 0, from_date, to_date }) {
  try {
    const params = new URLSearchParams({
      apiKey: BEELDBANK_API_KEY,
      q,
      rows: Math.min(rows, 20),
      start
    })
    if (from_date) params.set('from_date', from_date)
    if (to_date) params.set('to_date', to_date)

    const url = `https://webservices.memorix.nl/mediabank/media?${params}`
    const response = await fetch(url)
    const data = await response.json()
    return (data.media || []).map(item => ({
      source: 'Beeldbank Groningen',
      title: item.title || 'Afbeelding',
      date: item.metadata?.date,
      description: item.description,
      thumbnail: item.asset?.[0]?.thumb?.small,
      url: `https://www.beeldbankgroningen.nl/beelden/detail/${item.id}`
    }))
  } catch (e) {
    return { error: e.message }
  }
}

function searchInventories() {
  return []
}

export async function executeTool(name, args) {
  switch (name) {
    case 'searchAlleGroningers': return searchAlleGroningers(args)
    case 'searchBeeldbank': return searchBeeldbank(args)
    case 'searchInventories': return searchInventories(args)
    default: return { error: `Unknown tool: ${name}` }
  }
}
```

- [ ] **Step 2: Verify module loads and executors work**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
node -e "
import('./server/archieTools.js').then(async m => {
  console.log('toolDeclarations count:', m.toolDeclarations.length)
  const results = await m.executeTool('searchAlleGroningers', { q: 'janssen', rows: 2 })
  console.log('searchAlleGroningers result type:', Array.isArray(results))
  console.log('first result keys:', results[0] ? Object.keys(results[0]).join(',') : 'no results')
  const bb = await m.executeTool('searchBeeldbank', { q: 'akerk', rows: 2 })
  console.log('searchBeeldbank result type:', Array.isArray(bb))
  const inv = await m.executeTool('searchInventories', { q: 'test' })
  console.log('searchInventories stub:', JSON.stringify(inv))
  console.log('PASS')
})
"
```

Expected: `toolDeclarations count: 3`, arrays returned, `searchInventories stub: []`, `PASS`.

- [ ] **Step 3: Apply audit findings**

If Task 2 revealed additional params not in the tool declarations above (e.g. extra metadata fields, additional filter keys), add them to the appropriate `parameters.properties` block now.

- [ ] **Step 4: Commit**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
git add server/archieTools.js
git commit -m "feat: add Gemini tool declarations and executors for AlleGroningers, Beeldbank, Inventories"
```

---

## Task 5: Create `server/archieRag.js`

LanceDB vector store for the knowledge base. Uses `text-embedding-004` (768-dim) for embeddings. Exposes `addChunks`, `retrieve`, `deleteBySource`, `listDocuments`.

**Files:**
- Create: `server/archieRag.js`

- [ ] **Step 1: Create the file**

```js
// server/archieRag.js
import * as lancedb from '@lancedb/lancedb'
import { GoogleGenerativeAI } from '@google/generative-ai'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, 'database', 'archie-vectors')
const EMBEDDING_DIM = 768

let _table = null
let _embeddingModel = null

function getEmbeddingModel() {
  if (!_embeddingModel) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    _embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' })
  }
  return _embeddingModel
}

async function getTable() {
  if (_table) return _table
  const db = await lancedb.connect(DB_PATH)
  const names = await db.tableNames()
  if (names.includes('documents')) {
    _table = await db.openTable('documents')
  } else {
    // Seed with a dummy record to establish schema, then delete it
    _table = await db.createTable('documents', [{
      id: '__init__',
      source: '__init__',
      title: '__init__',
      chunk_text: '__init__',
      vector: Array(EMBEDDING_DIM).fill(0)
    }])
    await _table.delete("id = '__init__'")
  }
  return _table
}

async function embedText(text) {
  const model = getEmbeddingModel()
  const result = await model.embedContent(text)
  return result.embedding.values
}

// chunks: Array<{ id: string, source: string, title: string, chunk_text: string }>
export async function addChunks(chunks) {
  const table = await getTable()
  const records = await Promise.all(chunks.map(async chunk => ({
    id: chunk.id,
    source: chunk.source,
    title: chunk.title,
    chunk_text: chunk.chunk_text,
    vector: await embedText(chunk.chunk_text)
  })))
  await table.add(records)
}

// Returns top-k chunk_text strings relevant to query
export async function retrieve(query, topK = 5) {
  if (!process.env.GEMINI_API_KEY) return []
  try {
    const table = await getTable()
    const queryVector = await embedText(query)
    const results = await table.search(queryVector).limit(topK).toArray()
    return results.map(r => r.chunk_text)
  } catch {
    return []
  }
}

// Delete all chunks for a given source filename
export async function deleteBySource(source) {
  const table = await getTable()
  await table.delete(`source = '${source.replace(/'/g, "''")}'`)
}

// Returns unique { source, title } entries (one per document)
export async function listDocuments() {
  try {
    const table = await getTable()
    const all = await table.query().toArray()
    const seen = new Set()
    return all
      .filter(r => {
        if (seen.has(r.source) || r.source === '__init__') return false
        seen.add(r.source)
        return true
      })
      .map(r => ({ source: r.source, title: r.title }))
  } catch {
    return []
  }
}

// Split text into ~500-token chunks (paragraph-aware, ~2000 chars)
export function chunkText(text, maxChars = 2000) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0)
  const chunks = []
  let current = ''
  for (const para of paragraphs) {
    const candidate = current ? current + '\n\n' + para : para
    if (candidate.length > maxChars && current.length > 0) {
      chunks.push(current.trim())
      current = para
    } else {
      current = candidate
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}
```

- [ ] **Step 2: Verify module loads (no GEMINI_API_KEY needed for this check)**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
node -e "
import('./server/archieRag.js').then(m => {
  // Test chunkText only (no API key needed)
  const text = 'Para one.\n\nPara two.\n\nPara three.\n\nPara four.'
  const chunks = m.chunkText(text, 20)
  console.log('chunkText splits correctly:', chunks.length > 1)
  console.log('PASS')
})
"
```

Expected: `chunkText splits correctly: true`, `PASS`.

- [ ] **Step 3: Verify RAG with real API key (requires server env)**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
# Source env vars (adjust path if .env is elsewhere)
source .env 2>/dev/null || export $(cat .env | xargs) 2>/dev/null || true
node -e "
import('./server/archieRag.js').then(async m => {
  if (!process.env.GEMINI_API_KEY) { console.log('SKIP: no GEMINI_API_KEY'); return }
  await m.addChunks([{ id: 'test-1', source: 'test.txt', title: 'Test', chunk_text: 'Groninger Archieven beheert historische documenten uit de provincie Groningen.' }])
  const results = await m.retrieve('Groningen documenten', 1)
  console.log('retrieve returned:', results.length > 0)
  const docs = await m.listDocuments()
  console.log('listDocuments:', docs.some(d => d.source === 'test.txt'))
  await m.deleteBySource('test.txt')
  const afterDelete = await m.listDocuments()
  console.log('deleted:', !afterDelete.some(d => d.source === 'test.txt'))
  console.log('PASS')
})
"
```

Expected: `retrieve returned: true`, `listDocuments: true`, `deleted: true`, `PASS`.

- [ ] **Step 4: Commit**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
git add server/archieRag.js
git commit -m "feat: add LanceDB RAG module with text-embedding-004 for Archie knowledge base"
```

---

## Task 6: Replace `server/routes/archie.js` — Agentic Chat Endpoint

Replace the `/search` endpoint with `/chat`. Wire Gemini function calling loop using session history and RAG context.

**Files:**
- Modify: `server/routes/archie.js`

- [ ] **Step 1: Replace the entire file**

```js
// server/routes/archie.js
import express from 'express'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getOrCreate, update } from '../archieSession.js'
import { toolDeclarations, executeTool } from '../archieTools.js'
import { retrieve } from '../archieRag.js'

const router = express.Router()

let genAI = null
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
}

const SYSTEM_INSTRUCTION_BASE = `You are Archie, the digital archivist for the Groninger Archieven.
You help users — both casual visitors and serious researchers — find genealogical records and archival materials.
Use the provided search tools. Search multiple times with different parameters if needed to answer the question thoroughly.
Think step by step. When results are sparse, try alternative spellings or broader queries.
Always share direct URLs to records when available.
Respond in the same language the user uses.`

router.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body
  if (!message || !sessionId) {
    return res.status(400).json({ error: 'message and sessionId are required' })
  }
  if (!genAI) {
    return res.status(503).json({ error: 'GEMINI_API_KEY not configured' })
  }

  try {
    const session = getOrCreate(sessionId)

    // RAG: retrieve relevant knowledge chunks
    const ragChunks = await retrieve(message, 5)
    const ragSection = ragChunks.length > 0
      ? `\n\n## Archive Knowledge\n${ragChunks.join('\n\n---\n\n')}`
      : ''
    const systemInstruction = SYSTEM_INSTRUCTION_BASE + ragSection

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{ functionDeclarations: toolDeclarations }],
      systemInstruction
    })

    const chat = model.startChat({ history: session.contents })

    // First turn: user message
    let response = await chat.sendMessage(message)
    const toolCalls = []

    // Agentic loop: keep executing tools until model stops calling them
    while (true) {
      const fns = response.response.functionCalls()
      if (!fns || fns.length === 0) break

      const functionResponses = await Promise.all(fns.map(async fn => {
        const result = await executeTool(fn.name, fn.args)
        toolCalls.push({ name: fn.name, args: fn.args, result })
        return {
          functionResponse: {
            name: fn.name,
            response: { content: JSON.stringify(result) }
          }
        }
      }))

      response = await chat.sendMessage(functionResponses)
    }

    const reply = response.response.text()

    // Persist updated history
    const updatedHistory = await chat.getHistory()
    update(sessionId, updatedHistory)

    res.json({ reply, toolCalls, sessionId })
  } catch (error) {
    console.error('Archie Chat Error:', error)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

export default router
```

- [ ] **Step 2: Start the server and verify the endpoint**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
npm run server &
sleep 3
curl -s -X POST http://localhost:4008/api/archie/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Hallo, kun je me helpen?","sessionId":"test-session-1"}' | node -e "
process.stdin.setEncoding('utf8')
let data = ''
process.stdin.on('data', d => data += d)
process.stdin.on('end', () => {
  const r = JSON.parse(data)
  console.log('has reply:', typeof r.reply === 'string')
  console.log('has toolCalls:', Array.isArray(r.toolCalls))
  console.log('has sessionId:', r.sessionId === 'test-session-1')
  console.log('PASS')
})
"
kill %1
```

Expected: `has reply: true`, `has toolCalls: true`, `has sessionId: true`, `PASS`.

- [ ] **Step 3: Verify multi-turn — second message in same session has context**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
npm run server &
sleep 3

# First message
curl -s -X POST http://localhost:4008/api/archie/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Zoek naar doopregisters van familie Janssen in Groningen","sessionId":"test-session-2"}' > /tmp/r1.json
echo "First reply length: $(cat /tmp/r1.json | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',x=>d+=x);process.stdin.on('end',()=>console.log(JSON.parse(d).reply?.length))")"

# Second message in same session
curl -s -X POST http://localhost:4008/api/archie/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Kun je ook naar huwelijken zoeken?","sessionId":"test-session-2"}' > /tmp/r2.json
echo "Second reply references context: $(cat /tmp/r2.json | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',x=>d+=x);process.stdin.on('end',()=>{ const r=JSON.parse(d); console.log(typeof r.reply === 'string' && r.reply.length > 0) })")"

kill %1
```

Expected: both replies are non-empty strings.

- [ ] **Step 4: Commit**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
git add server/routes/archie.js
git commit -m "feat: replace Archie /search with agentic /chat endpoint using Gemini function calling and RAG"
```

---

## Task 7: Create `server/routes/archieAdmin.js`

Server-rendered HTML admin panel. Password-protected via `ARCHIE_ADMIN_PASSWORD` env var. Session managed via `express-session` key `archieAdmin`. Supports document upload (`.txt`, `.md`, `.pdf`), list, and delete.

**Files:**
- Create: `server/routes/archieAdmin.js`

- [ ] **Step 1: Create the file**

```js
// server/routes/archieAdmin.js
import express from 'express'
import multer from 'multer'
import pdfParse from 'pdf-parse'
import crypto from 'crypto'
import { addChunks, deleteBySource, listDocuments, chunkText } from '../archieRag.js'

const router = express.Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['text/plain', 'text/markdown', 'application/pdf']
    const extOk = /\.(txt|md|pdf)$/i.test(file.originalname)
    if (allowed.includes(file.mimetype) || extOk) cb(null, true)
    else cb(new Error('Only .txt, .md, and .pdf files are allowed'))
  }
})

function requireAdmin(req, res, next) {
  if (req.session?.archieAdmin) return next()
  res.redirect('/archie/admin')
}

function loginPage(error = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Archie Admin — Login</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); width: 320px; }
    h1 { margin: 0 0 1.5rem; font-size: 1.25rem; }
    input[type=password] { width: 100%; padding: 0.5rem; box-sizing: border-box; margin-bottom: 1rem; border: 1px solid #ddd; border-radius: 4px; }
    button { background: #d97706; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; width: 100%; }
    .error { color: #dc2626; font-size: 0.875rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Archie Admin</h1>
    ${error ? `<p class="error">${error}</p>` : ''}
    <form method="POST" action="/archie/admin/login">
      <input type="password" name="password" placeholder="Admin password" autofocus>
      <button type="submit">Log in</button>
    </form>
  </div>
</body>
</html>`
}

function dashboardPage(docs) {
  const rows = docs.length === 0
    ? '<tr><td colspan="2" style="color:#999;text-align:center;">No documents uploaded yet.</td></tr>'
    : docs.map(doc => `
      <tr>
        <td>${escapeHtml(doc.title || doc.source)}</td>
        <td>
          <form method="POST" action="/archie/admin/documents/${encodeURIComponent(doc.source)}/delete" style="display:inline">
            <button type="submit" onclick="return confirm('Delete ${escapeHtml(doc.source)}?')">Delete</button>
          </form>
        </td>
      </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Archie Admin — Knowledge Base</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f5f5f5; margin: 0; padding: 2rem; }
    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 640px; margin: 0 auto; }
    h1 { margin: 0 0 0.25rem; font-size: 1.25rem; }
    .subtitle { color: #666; font-size: 0.875rem; margin-bottom: 1.5rem; }
    .upload-section { display: flex; gap: 0.5rem; margin-bottom: 2rem; }
    input[type=file] { flex: 1; border: 1px solid #ddd; border-radius: 4px; padding: 0.4rem; }
    button.primary { background: #d97706; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
    button.danger { background: #dc2626; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; border-bottom: 2px solid #eee; padding: 0.5rem 0; font-size: 0.875rem; color: #666; }
    td { padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0; }
    .logout { float: right; font-size: 0.875rem; color: #666; text-decoration: none; }
    .error { color: #dc2626; font-size: 0.875rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h1>Archie Admin — Knowledge Base</h1>
      <form method="POST" action="/archie/admin/logout" style="display:inline">
        <button type="submit" style="background:none;border:none;color:#666;cursor:pointer;font-size:0.875rem">Log out</button>
      </form>
    </div>
    <p class="subtitle">Upload documents to expand Archie's knowledge. Accepts .txt, .md, .pdf</p>
    <form method="POST" action="/archie/admin/documents" enctype="multipart/form-data" class="upload-section">
      <input type="file" name="file" accept=".txt,.md,.pdf" required>
      <button type="submit" class="primary">Upload</button>
    </form>
    <table>
      <thead><tr><th>Document</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// GET /archie/admin — login form or redirect to documents
router.get('/', (req, res) => {
  if (req.session?.archieAdmin) return res.redirect('/archie/admin/documents')
  res.send(loginPage())
})

// POST /archie/admin/login
router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const { password } = req.body
  const adminPassword = process.env.ARCHIE_ADMIN_PASSWORD
  if (!adminPassword) {
    return res.send(loginPage('ARCHIE_ADMIN_PASSWORD is not set on the server.'))
  }
  if (password === adminPassword) {
    req.session.archieAdmin = true
    res.redirect('/archie/admin/documents')
  } else {
    res.send(loginPage('Incorrect password.'))
  }
})

// POST /archie/admin/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/archie/admin'))
})

// GET /archie/admin/documents
router.get('/documents', requireAdmin, async (req, res) => {
  const docs = await listDocuments()
  res.send(dashboardPage(docs))
})

// POST /archie/admin/documents — upload, chunk, embed, store
router.post('/documents', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.')

  const filename = req.file.originalname
  const mimetype = req.file.mimetype

  try {
    let text
    if (mimetype === 'application/pdf' || filename.endsWith('.pdf')) {
      const data = await pdfParse(req.file.buffer)
      text = data.text
    } else {
      text = req.file.buffer.toString('utf8')
    }

    if (!text.trim()) {
      return res.send(loginPage(`File "${filename}" appears to be empty or unreadable.`))
    }

    const textChunks = chunkText(text)
    const chunks = textChunks.map((chunk, i) => ({
      id: `${filename}-${i}-${crypto.randomUUID()}`,
      source: filename,
      title: filename,
      chunk_text: chunk
    }))

    await addChunks(chunks)
    res.redirect('/archie/admin/documents')
  } catch (err) {
    console.error('Admin upload error:', err)
    res.status(500).send(`Upload failed: ${escapeHtml(err.message)}`)
  }
})

// POST /archie/admin/documents/:source/delete — remove document + chunks
router.post('/documents/:source/delete', requireAdmin, async (req, res) => {
  const source = decodeURIComponent(req.params.source)
  await deleteBySource(source)
  res.redirect('/archie/admin/documents')
})

export default router
```

- [ ] **Step 2: Verify module loads**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
node -e "
import('./server/routes/archieAdmin.js').then(m => {
  console.log('admin router loaded:', typeof m.default === 'function')
  console.log('PASS')
})
"
```

Expected: `admin router loaded: true`, `PASS`.

- [ ] **Step 3: Commit**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
git add server/routes/archieAdmin.js
git commit -m "feat: add server-rendered Archie admin panel for knowledge base management"
```

---

## Task 8: Update `server/index.js` — Add Session Middleware and Mount Admin Routes

Add `express-session` middleware globally. Mount admin routes at `/archie/admin` **before** the static file serving (order matters — Express matches first-registered route).

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add express-session import**

In `server/index.js`, add after the existing imports (around line 37, after `import mime from 'mime-types'`):

```js
import session from 'express-session'
import archieAdminRoutes from './routes/archieAdmin.js'
```

- [ ] **Step 2: Add session middleware after `app.use(express.json())`**

Find this block (around line 165–170):
```js
app.use(cors());
app.use(express.json());
```

Add after it:
```js
app.use(session({
  secret: process.env.ARCHIE_SESSION_SECRET || 'archie-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}))
```

- [ ] **Step 3: Mount admin routes before the static file middleware**

Find this line (around line 182):
```js
app.use('/archie', express.static(path.join(__dirname, '../dist'), { redirect: true }));
```

Add **before** it:
```js
// Archie admin panel (server-rendered, must be before static file serving)
app.use('/archie/admin', archieAdminRoutes);
```

- [ ] **Step 4: Start the server and verify admin login page loads**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
npm run server &
sleep 3
curl -s http://localhost:4008/archie/admin | grep -c 'Archie Admin'
kill %1
```

Expected: output `1` (the page title appears once).

- [ ] **Step 5: Verify chat endpoint still works**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
npm run server &
sleep 3
curl -s -X POST http://localhost:4008/api/archie/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"test","sessionId":"verify-8"}' | node -e "
process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',x=>d+=x)
process.stdin.on('end',()=>{ const r=JSON.parse(d); console.log('ok:', 'reply' in r || 'error' in r) })
"
kill %1
```

Expected: `ok: true`.

- [ ] **Step 6: Commit**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
git add server/index.js
git commit -m "feat: add express-session middleware and mount Archie admin routes"
```

---

## Task 9: Create `server/scripts/scrapeGA.js`

One-time scraper that fetches content from the Groninger Archieven website and AlleGroningers help pages, chunks it, embeds it, and stores it in LanceDB.

**Files:**
- Create: `server/scripts/scrapeGA.js`

- [ ] **Step 1: Create the scraper**

```js
// server/scripts/scrapeGA.js
// Run once: node server/scripts/scrapeGA.js
// Requires GEMINI_API_KEY in environment.

import fetch from 'node-fetch'
import { addChunks, chunkText } from '../archieRag.js'

const SOURCES = [
  // Groninger Archieven research guides
  { url: 'https://www.groningerarchieven.nl/zoeken/hoe-zoek-ik', title: 'GA: Hoe zoek ik?' },
  { url: 'https://www.groningerarchieven.nl/zoeken/wat-zoek-ik/genealogie', title: 'GA: Genealogie' },
  { url: 'https://www.groningerarchieven.nl/zoeken/wat-zoek-ik/archieven', title: 'GA: Archieven' },
  // AlleGroningers help
  { url: 'https://www.allegroningers.nl/over', title: 'AlleGroningers: Over' },
]

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Archie-Scraper/1.0 (Groninger Archieven research bot)' },
      timeout: 15000
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const html = await response.text()
    // Strip HTML tags, collapse whitespace
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{2,}/g, '\n')
      .trim()
  } catch (err) {
    console.error(`  Failed to fetch ${url}: ${err.message}`)
    return null
  }
}

async function run() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is required. Set it in .env or export it.')
    process.exit(1)
  }

  console.log('Starting Groninger Archieven knowledge base scrape...\n')
  let totalChunks = 0

  for (const source of SOURCES) {
    console.log(`Fetching: ${source.url}`)
    const text = await fetchText(source.url)
    if (!text || text.length < 100) {
      console.log('  Skipped (empty or too short)\n')
      continue
    }

    const filename = source.title.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.scraped'
    const textChunks = chunkText(text)
    const chunks = textChunks.map((chunk, i) => ({
      id: `${filename}-${i}`,
      source: filename,
      title: source.title,
      chunk_text: chunk
    }))

    console.log(`  ${textChunks.length} chunks, embedding...`)
    await addChunks(chunks)
    totalChunks += chunks.length
    console.log(`  Done\n`)
  }

  console.log(`Scrape complete. ${totalChunks} chunks added to knowledge base.`)
  process.exit(0)
}

run()
```

- [ ] **Step 2: Run the scraper (requires GEMINI_API_KEY)**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
source .env 2>/dev/null || export $(cat .env | xargs) 2>/dev/null || true
node server/scripts/scrapeGA.js
```

Expected: output showing fetched pages, chunk counts, and `Scrape complete.`

If any URLs return 404 or empty content, that's acceptable — the scraper skips them with a warning.

- [ ] **Step 3: Commit**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
git add server/scripts/scrapeGA.js
git commit -m "feat: add one-time GA website scraper to seed Archie knowledge base"
```

---

## Task 10: Update Frontend

Replace the `/search` API call with `/chat`. Add `sessionId` management via `sessionStorage`. Display tool calls as collapsible "Searching…" indicators while the agent loops.

**Files:**
- Modify: `src/utils/api.js`
- Modify: `src/components/ArchieInterface.jsx`

- [ ] **Step 1: Add `chat` to `src/utils/api.js`**

In `src/utils/api.js`, find and replace the `archie` block:

```js
  // Archie chat (public or protected based on server config)
  archie: {
    chat: (message, sessionId) => authenticatedFetch('/api/archie/chat', {
      method: 'POST',
      body: JSON.stringify({ message, sessionId }),
    }).then(res => res.json()),
  },
```

(Remove the old `search` method entirely.)

- [ ] **Step 2: Rewrite `src/components/ArchieInterface.jsx`**

```jsx
// src/components/ArchieInterface.jsx
import React, { useState, useEffect, useRef } from 'react'
import { api } from '../utils/api'
import { History, ExternalLink, Loader2, Send, ChevronDown, ChevronUp, Search } from 'lucide-react'

function getOrCreateSessionId() {
  let id = sessionStorage.getItem('archie-session-id')
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem('archie-session-id', id)
  }
  return id
}

const ArchieInterface = () => {
  const [messages, setMessages] = useState([{
    type: 'assistant',
    content: "Hello! I'm Archie, your archive assistant. I can help you find people in AlleGroningers, photos in the Beeldbank, or historical collections in the Groningen Archives. What are you looking for today?",
    timestamp: new Date(),
    toolCalls: []
  }])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const sessionIdRef = useRef(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    sessionIdRef.current = getOrCreateSessionId()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage = input
    setInput('')
    setMessages(prev => [...prev, {
      type: 'user',
      content: userMessage,
      timestamp: new Date(),
      toolCalls: []
    }])
    setIsLoading(true)

    try {
      const response = await api.archie.chat(userMessage, sessionIdRef.current)
      setMessages(prev => [...prev, {
        type: 'assistant',
        content: response.reply || 'Geen antwoord ontvangen.',
        timestamp: new Date(),
        toolCalls: response.toolCalls || []
      }])
    } catch (error) {
      console.error('Archie Chat Error:', error)
      setMessages(prev => [...prev, {
        type: 'assistant',
        content: "I'm sorry, I encountered an error. Please try again later.",
        timestamp: new Date(),
        toolCalls: []
      }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg mr-3">
          <History className="w-6 h-6 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-none">Archie</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Groningen Archive Assistant</p>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] sm:max-w-2xl rounded-2xl p-4 shadow-sm ${
              msg.type === 'user'
                ? 'bg-blue-600 text-white rounded-br-none'
                : 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-800 rounded-bl-none'
            }`}>
              {msg.toolCalls?.length > 0 && <ToolCallList toolCalls={msg.toolCalls} />}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              <p className="text-[10px] mt-2 opacity-50 text-right">
                {msg.timestamp.toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl rounded-bl-none p-4 shadow-sm flex items-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
              <span className="text-sm text-gray-500">Archie is searching the vaults…</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about a person, place, or historical topic…"
            className="w-full pl-4 pr-12 py-3 bg-gray-100 dark:bg-gray-800 border-none rounded-xl focus:ring-2 focus:ring-amber-500 dark:text-white"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </form>
        <p className="text-[10px] text-center text-gray-400 mt-2">
          Tip: Try "What is the oldest baptism in the Akerk?" or a family name.
        </p>
      </div>
    </div>
  )
}

const ToolCallList = ({ toolCalls }) => {
  const [expanded, setExpanded] = useState(false)

  const labelFor = (name) => ({
    searchAlleGroningers: 'Searched AlleGroningers',
    searchBeeldbank: 'Searched Beeldbank',
    searchInventories: 'Searched inventories'
  }[name] || `Called ${name}`)

  return (
    <div className="mb-3 border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Search className="w-3 h-3" />
          {toolCalls.length} search{toolCalls.length !== 1 ? 'es' : ''} performed
        </span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="divide-y divide-amber-100 dark:divide-amber-900/30">
          {toolCalls.map((tc, i) => (
            <div key={i} className="px-3 py-2 bg-white dark:bg-gray-800/50">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{labelFor(tc.name)}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
                {JSON.stringify(tc.args)}
              </p>
              {Array.isArray(tc.result) && tc.result.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {tc.result.map((item, j) => (
                    <div key={j} className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-600 dark:text-gray-400 truncate pr-2">{item.title}</span>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 shrink-0">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ArchieInterface
```

- [ ] **Step 3: Build and verify no compile errors**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
npm run build 2>&1 | tail -20
```

Expected: build completes with no errors. May show warnings (acceptable).

- [ ] **Step 4: Run full stack and do end-to-end smoke test**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
npm run dev &
sleep 5
# Test chat via API (frontend is visually tested in browser)
curl -s -X POST http://localhost:4008/api/archie/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Zoek doopregisters van Janssen in Groningen","sessionId":"e2e-smoke-1"}' | node -e "
process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',x=>d+=x)
process.stdin.on('end',()=>{
  const r=JSON.parse(d)
  console.log('reply present:', typeof r.reply === 'string' && r.reply.length > 10)
  console.log('toolCalls array:', Array.isArray(r.toolCalls))
  console.log('has search results:', r.toolCalls?.some(tc => Array.isArray(tc.result) && tc.result.length > 0))
  console.log('PASS')
})
"
kill %1
```

Expected: `reply present: true`, `toolCalls array: true`, `has search results: true`, `PASS`.

- [ ] **Step 5: Commit**

```bash
cd /Users/lieuwejongsma/projects/archie-chatbot
git add src/utils/api.js src/components/ArchieInterface.jsx
git commit -m "feat: update Archie frontend to use /chat with sessionId and collapsible tool call indicators"
```

---

## Post-Implementation Checklist

- [ ] Admin panel is accessible at `/archie/admin` and login works with `ARCHIE_ADMIN_PASSWORD`
- [ ] Uploading a `.txt` file via admin panel adds chunks to LanceDB and appears in document list
- [ ] Deleting a document removes it from the list
- [ ] `node server/scripts/scrapeGA.js` runs to completion and seeds the knowledge base
- [ ] Asking Archie "wat is een doopregister?" returns an answer that shows knowledge from the scraped corpus (check via RAG context appearing in system instruction logs if needed)
- [ ] Multi-turn conversation works: second message references context from first
- [ ] Tool call indicators in frontend are collapsible and show search params + results
