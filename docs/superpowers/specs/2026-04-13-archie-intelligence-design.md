# Archie Intelligence Upgrade — Design Spec

**Date:** 2026-04-13  
**Status:** Approved  
**Scope:** Agentic search, RAG knowledge base, multi-turn conversation, admin panel

---

## 1. Problem

Current Archie does a single parallel keyword search across three sources, dumps raw results into one Gemini prompt, and returns a synthesis. It has no domain knowledge, no iterative search capability, no conversation memory, and no ability to filter or sort results intelligently. Complex questions like "what is the oldest baptism recorded in the Akerk?" cannot be answered well.

---

## 2. Goals

- Archie searches autonomously and iteratively using Gemini's native function calling
- Archie retains conversation context across a session (multi-turn)
- Archie has access to a curated knowledge base about Groninger Archieven record types, research strategies, and archive structure (RAG)
- Admins can upload private knowledge documents via a simple admin panel
- All existing API sources (AlleGroningers, Beeldbank) are exposed with their full filter sets

---

## 3. Architecture

```
User message
     │
     ▼
POST /archie/chat  { message, sessionId }
     │
     ├─ Load conversation history (in-memory session map, keyed by sessionId)
     ├─ Retrieve top-5 RAG chunks relevant to message (LanceDB ANN search)
     ├─ Build system instruction: persona + archive knowledge chunks
     ├─ Call Gemini with: system instruction + full contents[] history + tools
     │
     ▼
Gemini agentic loop (runs until model stops calling tools)
     │
     ├─ tool_call: searchAlleGroningers(params)
     ├─ tool_call: searchBeeldbank(params)
     ├─ tool_call: searchInventories(params)   ← stubbed, real later
     │
     └─ final text response
     │
     ▼
Append exchange to session contents[]
Return { reply, toolCalls[], sessionId } to frontend
```

New endpoint `/archie/chat` replaces `/archie/search`. Frontend sends `{ message, sessionId }`.

---

## 4. Gemini Function Calling Tools

Each data source is exposed as a typed Gemini tool. **Filter params must be derived from a thorough API audit during implementation** — do not guess. Test actual API calls and inspect both site sources to produce a complete param map before writing tool definitions.

### `searchAlleGroningers`
Searches genealogical records on AlleGroningers (Memorix genealogy API).  
Params (to be fully enumerated during implementation):
- `q` (string, required) — keyword search
- `deed_type` (string, optional) — e.g. `"doop"`, `"huwelijk"`, `"overlijden"`
- `gemeente` (string, optional) — municipality filter
- `rows` (number, optional) — default 5, max to be determined
- `sort` (string, optional) — e.g. `"datum asc"`
- _...all other supported params discovered during API audit_

### `searchBeeldbank`
Searches images on Beeldbank Groningen (Memorix mediabank API).  
Params (to be fully enumerated during implementation):
- `q` (string, required) — keyword search
- `rows` (number, optional)
- _...all other supported filter params discovered during API audit_

### `searchInventories`
Stubbed — returns empty array. To be implemented in a future phase when Archives Portal Europe API or equivalent is available.

---

## 5. RAG Knowledge Base

### Vector DB: LanceDB
- Embedded Node.js library, no separate server required
- Stored on disk alongside existing SQLite DB
- Table: `documents` with columns `id`, `source`, `title`, `chunk_text`, `vector`
- Embeddings generated with Gemini `text-embedding-004`

### Corpus — Phase 1 (scraped)
- Groninger Archieven website: collection descriptions, research guides, register explanations
- AlleGroningers help/FAQ: deed types, searchable fields
- Node.js scraper script, runs once, chunks and embeds output

### Corpus — Phase 2 (admin-uploaded)
- Private knowledge documents not publicly available
- Uploaded via admin panel (see Section 6)

### Retrieval
On each `/archie/chat` request:
1. Embed user message with `text-embedding-004`
2. ANN search in LanceDB → top-5 relevant chunks
3. Prepend to system instruction as `## Archive Knowledge`

### System Instruction Skeleton
```
You are Archie, the digital archivist for the Groninger Archieven.
You help users — both casual visitors and serious researchers — find genealogical 
records and archival materials.
Use the provided search tools. Search multiple times with different parameters 
if needed to answer the question thoroughly. Think step by step.

## Archive Knowledge
{rag_chunks}
```

---

## 6. Admin Panel

A minimal server-rendered HTML interface for managing the knowledge base. No React — plain HTML served by Express.

### Auth
- Password protected via env var `ARCHIE_ADMIN_PASSWORD`
- Session managed via existing `express-session` middleware, stored under key `archieAdmin`
- No changes to existing user table

### Routes
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/archie/admin` | Login form (if unauthenticated) or dashboard |
| POST | `/archie/admin/login` | Authenticate, set session cookie |
| POST | `/archie/admin/logout` | Clear session |
| GET | `/archie/admin/documents` | List all knowledge documents |
| POST | `/archie/admin/documents` | Upload document (multipart), chunk, embed, store |
| DELETE | `/archie/admin/documents/:source` | Remove document + all its chunks from LanceDB (keyed by filename/source) |

### Upload flow
1. Accept `.txt`, `.md`, `.pdf` files
2. Extract plain text (pdf-parse for PDFs)
3. Chunk into ~500-token windows with paragraph-aware splitting
4. Embed each chunk with `text-embedding-004`
5. Store in LanceDB with `source = filename`, `title = filename`

### Dashboard UI (server-rendered)
```
┌─────────────────────────────────────────┐
│  Archie Admin — Knowledge Base          │
├─────────────────────────────────────────┤
│  [Choose file] [Upload]                 │
│                                         │
│  Documents:                             │
│  ○ doopregister-uitleg.pdf   [Delete]   │
│  ○ hoe-zoek-ik.md            [Delete]   │
│  ○ GA-research-guide.txt     [Delete]   │
└─────────────────────────────────────────┘
```

New file: `server/routes/archieAdmin.js`

---

## 7. Conversation History

Multi-turn managed server-side using Gemini's `contents[]` format.

```js
// server/archieSession.js
const sessions = new Map()
// sessionId → { contents: GeminiContent[], lastActive: Date }

// TTL eviction: sessions inactive >2h are dropped
// Runs on interval (e.g. every 15 min)
```

### Flow
1. Frontend generates UUID sessionId on first load, stores in `sessionStorage`
2. Every chat message sends `{ message, sessionId }`
3. Server fetches or creates session entry
4. Appends user turn, calls Gemini with full `contents[]`
5. Appends model response (including all tool call/result turns) to `contents[]`
6. Returns `{ reply, toolCalls[], sessionId }` to frontend

No DB persistence — server restart clears history. Acceptable for browser session use.

---

## 8. Frontend Changes

Minimal changes to existing React frontend:
- Replace current single search input + results block with a chat thread UI
- Display tool calls as collapsible "Searching..." indicators while Gemini loops
- SessionId managed in `sessionStorage`, sent with every message
- Existing styling (Tailwind) reused

---

## 9. New Files

| File | Purpose |
|------|---------|
| `server/routes/archieAdmin.js` | Admin panel routes |
| `server/archieSession.js` | In-memory session map + TTL eviction |
| `server/archieRag.js` | LanceDB init, embed, retrieve functions |
| `server/archieTools.js` | Gemini tool definitions for all search APIs |
| `server/scripts/scrapeGA.js` | One-time scraper for GA website content |

Modified:
| File | Change |
|------|--------|
| `server/routes/archie.js` | Replace `/search` with `/chat`, wire function calling loop |
| `server/index.js` | Mount `/archie/admin` route |
| `src/` (frontend) | Chat thread UI, sessionId handling |

---

## 10. Out of Scope

- Persisting conversation history across server restarts
- User-specific conversation history
- `searchInventories` real implementation (future phase)
- Phase 2 RAG corpus (private documents) — covered by admin upload
- Streaming responses (future improvement)
