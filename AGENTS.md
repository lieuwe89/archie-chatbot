# AGENTS.md

This document contains essential context, commands, and architectural patterns to help AI agents work effectively within the Archie Chatbot repository.

## 📌 Project Overview
Archie is an AI-powered archival assistant for the Groninger Archieven. It uses a Retrieval-Augmented Generation (RAG) architecture and an agentic tool-use loop to provide natural language search across genealogical records, historical images, and archive inventories.

**Tech Stack:**
- **Frontend:** React, Vite, Tailwind CSS (`src/`)
- **Backend:** Node.js, Express (`server/`)
- **AI/LLM:** Google Gemini 2.5 Flash, `gemini-embedding-001`
- **Database:** SQLite (`better-sqlite3`) for auth/sessions, LanceDB for RAG vector storage
- **Module System:** Native ES Modules (`"type": "module"`)

## 🚀 Key Commands
Run these from the project root:

- **`npm run dev`** - Starts both the Vite frontend and the Node server concurrently.
- **`npm run build`** - Builds the frontend for production.
- **`npm run server`** - Runs only the backend server (`node server/index.js`).
- **`npm start`** - Builds the frontend and starts the backend server.
- **`node server/scripts/scrapeGA.js`** - Seeds the initial knowledge base for RAG.

## 🏗️ Code Organization & Architecture

### Backend (`server/`)
- `index.js`: Main entry point setting up Express, WebSockets, and loading environment variables (it manually reads `.env`).
- `routes/archie.js`: Core chatbot logic. It contains the main Gemini system prompt, initializes the session, performs the RAG retrieval, and manages the chat interaction.
- `archieTools.js`: Defines the agentic tools using Gemini function declarations. Archie can autonomously call APIs like AlleGroningers, OpenArch, and Tavily for targeted web search.
- `archieRag.js`: Handles embedding generation and LanceDB vector search. Large documents are chunked into ~2000-character segments with 3072-dimension embeddings.
- `archieSession.js`: Manages in-memory chat sessions.
- `database/`: Contains SQLite initialization and queries. Persistent data in production is stored in `/data` (a mounted Fly.io volume), while dev defaults to `server/database/`.

### Frontend (`src/`)
- React/Vite app using Tailwind CSS for styling.
- Features a terminal-like interface and an admin panel for RAG management (`/archie/admin`).

## ⚠️ Important Gotchas & Conventions

1. **Strict Domain Search:** The web search tool is powered by Tavily and is strictly limited to four domains: `groningerarchieven.nl`, `poparchiefgroningen.nl`, `filmbankgroningen.nl`, `groningerkentekens.nl`.
2. **Persistent Links:** The system is explicitly instructed to prefer Handle identifiers (`hdl.handle.net`) for persistent and citable links to records.
3. **Authentication:** User accounts use JWT. The admin panel (`/archie/admin`) uses a simple password based on `ARCHIE_ADMIN_PASSWORD` in `.env`.
4. **Environment Variables:** Must include `GEMINI_API_KEY`, `ARCHIE_ADMIN_PASSWORD`, and `TAVILY_API_KEY`.
5. **No Typescript:** The project uses plain `.js` and `.jsx` files. Rely on ES modules conventions.
6. **Tool Usage:** When Archie is asked for genealogical searches, the agent often tries different search strategies (fuzzy matching, wildcards) internally if initial results are sparse, as instructed by the system prompt in `routes/archie.js`.

## 🔒 Security Note
When working on authentication or session management, refer to `server/middleware/auth.js` for existing token validation and websocket authentication flows.
