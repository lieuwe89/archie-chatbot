# Archie — Groninger Archieven Chatbot

Archie is an AI-powered archival assistant for the [Groninger Archieven](https://www.groningerarchieven.nl). It lets users search across genealogical records, historical images, and archive inventories using natural language.

**Live:** `playground.lieuwejongsma.nl/archie`

---

## What it does

Users ask questions in Dutch or English. Archie uses Gemini to understand the question, calls the relevant archive APIs and search tools as tools, and synthesises results into a readable answer. It can run multiple searches in a single response (agentic loop). The model automatically decides which tool(s) to use based on the question.

**Supported sources:**
- **AlleGroningers** — genealogical records (birth, marriage, death, baptism, burial)
- **Beeldbank Groningen** — historical images, photographs, maps, portraits
- **Groninger Archieven website** — opening hours, contact, events, policies, collection overviews, archive inventories (via Google Custom Search)
- **Poparchief Groningen** — pop music, concerts, bands, cultural events (via Google Custom Search)
- **Filmbank Groningen** — films, video, cinema collections (via Google Custom Search)
- **RAG knowledge base** — research guides and uploaded documents (internal vector store)

---

## Stack

### Frontend
| Library | Version | Role |
|---------|---------|------|
| React | 18 | Component framework |
| Vite | 7 | Build tool & dev server |
| Tailwind CSS | 3.4 | Styling |
| react-markdown + remark-gfm | — | Markdown rendering |
| react-dropzone | 14 | File upload UI |
| Lucide React | — | Icons |
| xterm.js + WebGL addon | 5.3 | Embedded terminal (main app) |
| CodeMirror 6 | — | File editor (main app) |

### Backend
| Library | Version | Role |
|---------|---------|------|
| Express | 4.18 | HTTP server (port 4008) |
| ws | 8.14 | WebSocket server |
| better-sqlite3 | 12 | Auth database (SQLite) |
| bcrypt | 6 | Password hashing |
| jsonwebtoken | 9 | JWT auth tokens |
| express-session | 1.19 | Admin panel sessions |
| multer | 2 | File upload handling |
| pdf-parse | 2.4 | PDF text extraction |

### AI & RAG
| Component | Detail |
|-----------|--------|
| Chat model | Google Gemini 2.5 Flash |
| Embedding model | Google Gemini `embedding-001` (3072 dimensions) |
| Vector store | LanceDB 0.27 (serverless, file-based) |
| API client | `@google/generative-ai` 0.21 |
| Function calling | Gemini native tool use (agentic loop) |

### Deployment
| Component | Detail |
|-----------|--------|
| Platform | Fly.io (region: `ams`) |
| Container | Docker, Node.js 20 bookworm-slim |
| Persistent storage | Fly.io volume `archie_data` → `/data` |
| VM | 512 MB RAM, 1 shared CPU, scale-to-zero |

---

## Architecture

```
Browser
  └── ArchieInterface.jsx (React)
        │  POST /archie/api/archie/chat
        ▼
  server/routes/archie.js
        │  1. Embed user query (Gemini embedding-001)
        │  2. Semantic search → top 5 chunks from LanceDB
        │  3. Build system prompt (base instructions + RAG context)
        │  4. Start Gemini chat session
        │
        ├─ Agentic loop ──────────────────────────────────────────────┐
        │    model returns function calls?                             │
        │    yes → execute tools in parallel → send results back ─────┘
        │    no  → return final text reply
        │
        └── { reply, toolCalls, sessionId } → browser
```

### RAG pipeline

```
Admin uploads file
  └── Browser chunks file into 256 KB pieces → POST /upload-chunk (each)
        │
        └── Server reassembles chunks
              │
              ├── PDF? → pdf-parse extracts text
              │
              └── Chunk text into ~2000-char segments (paragraph-aware)
                    │
                    └── Batch embed (up to 50 chunks/call) via Gemini
                          │
                          └── Insert into LanceDB `documents` table
                                { id, source, title, chunk_text, vector[3072] }
```

### Tool declarations (function calling)

| Tool | API | Returns |
|------|-----|---------|
| `searchAlleGroningers(q, deed_type?, gemeente?, rows?, start?)` | Memorix genealogy API | Name, deed type, date, municipality, register, Handle URL |
| `searchBeeldbank(q, rows?, start?, from_date?, to_date?)` | Memorix media bank API | Images with thumbnails, creator, date, Handle URL |
| `searchGroningerarchieven(q)` | Google Custom Search (`groningerarchieven.nl`) | Page title, URL, snippet |
| `searchInventories(q)` | Google Custom Search (`groningerarchieven.nl`) | Archive inventory pages, collection descriptions |
| `searchPoparchiefGroningen(q)` | Google Custom Search (`poparchiefgroningen.nl`) | Pop music, concerts, bands, cultural events |
| `searchFilmbankGroningen(q)` | Google Custom Search (`filmbankgroningen.nl`) | Films, video collections, cinema |

All CSE-backed tools share a 100 req/day free quota. Usage is tracked in SQLite (`cse_usage` table); the server logs a warning at 80 and 95 requests and includes a `cseWarning` flag in the chat API response.

---

## Session management

- In-memory per-user session store (`server/archieSession.js`)
- Sessions identified by UUID stored in browser `sessionStorage` (per tab)
- Sessions expire after 2 hours of inactivity; eviction runs every 15 minutes
- **Not persisted** — chat history is lost on server restart

---

## Local development

### Prerequisites
- Node.js 20+
- A Google Gemini API key

### Setup

```bash
cd archie-chatbot
npm install
```

Create a `.env` file:

```env
GEMINI_API_KEY=your-key-here
ARCHIE_ADMIN_PASSWORD=choose-a-password
NODE_ENV=development
```

Start development servers (Express + Vite concurrently):

```bash
npm run dev
```

- Frontend: `http://localhost:4009`
- API: `http://localhost:4008`

First visit shows a registration screen. Register the first user — this becomes the admin account.

### Seed the knowledge base

Run once to scrape official Groninger Archieven help pages into the vector store:

```bash
node server/scripts/scrapeGA.js
```

---

## Admin panel

`/archie/admin` — password-protected (uses `ARCHIE_ADMIN_PASSWORD` env var, not a user account).

From here you can:
- Upload `.txt`, `.md`, or `.pdf` files (max 10 MB)
- View indexed documents
- Delete documents from the knowledge base

Uploads are processed in the background. Large PDFs are chunked client-side (256 KB per request) to avoid proxy timeouts.

---

## Data storage

| Data | Location (prod) | Location (dev) |
|------|-----------------|----------------|
| Vector store | `/data/archie-vectors/` (LanceDB) | `./server/database/archie-vectors/` |
| Auth database | `/data/geminicliui_auth.db` (SQLite) | `./server/database/geminicliui_auth.db` |
| Sessions | In-memory only | In-memory only |

### Auth database schema

**Table:** `geminicliui_users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `username` | TEXT UNIQUE | Login name (email recommended) |
| `password_hash` | TEXT | bcrypt hash |
| `created_at` | DATETIME | Auto |
| `last_login` | DATETIME | Nullable |
| `is_active` | BOOLEAN | Default 1 |

---

## Deployment (Fly.io)

```bash
fly deploy
```

### Required secrets

```bash
fly secrets set GEMINI_API_KEY=...
fly secrets set ARCHIE_ADMIN_PASSWORD=...
fly secrets set GOOGLE_CSE_KEY=...
fly secrets set GOOGLE_CSE_CX=...
```

### fly.toml highlights

- `primary_region = "ams"` — Amsterdam
- Volume `archie_data` mounted at `/data` for persistent vector store and auth DB
- `auto_stop_machines = true` / `min_machines_running = 0` — scales to zero when idle
- `force_https = true`

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Generative AI API key |
| `ARCHIE_ADMIN_PASSWORD` | Yes | Password for `/archie/admin` |
| `GOOGLE_CSE_KEY` | Yes | Google Custom Search API key (100 req/day free) |
| `GOOGLE_CSE_CX` | Yes | Programmable Search Engine ID (`cx`) |
| `NODE_ENV` | No | Set to `production` in prod |
| `DATA_DIR` | No | Override data directory (default: `/data` in prod, `./server/database` in dev) |

---

## License

MIT
