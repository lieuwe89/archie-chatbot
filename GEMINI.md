# Archie — Groninger Archieven Chatbot

Archie is an AI-powered archival assistant for the Groninger Archieven. It provides natural language search across genealogical records, historical images, and archive inventories using a Retrieval-Augmented Generation (RAG) architecture and an agentic tool-use loop.

## Project Overview

*   **Type:** Full-stack Node.js/Express and React/Vite application.
*   **AI Engine:** Google Gemini 2.5 Flash for chat and `gemini-embedding-001` for RAG.
*   **RAG System:** Uses LanceDB (vector store) to index research guides and uploaded documents.
*   **Agentic Tools:** Archie can autonomously call external APIs including:
    *   **AlleGroningers:** Genealogical records.
    *   **Beeldbank Groningen:** Historical images.
    *   **Google Custom Search (CSE):** Targeted search for archive-related websites.
*   **Database:** SQLite (`better-sqlite3`) for user authentication and session monitoring.

## Architecture

### Backend (`server/`)
*   `index.js`: Main entry point setting up Express and WebSockets.
*   `routes/archie.js`: Core chatbot logic, implements the agentic loop and RAG integration.
*   `archieRag.js`: Handles embedding generation and vector search via LanceDB.
*   `archieTools.js`: Defines the tool declarations and execution logic for external APIs.
*   `archieSession.js`: Manages in-memory chat sessions.

### Frontend (`src/`)
*   Built with React and Vite.
*   Styling via Tailwind CSS.
*   Key components include a terminal-like chat interface (`ArchieInterface.jsx`) and an admin panel for RAG management.

## Building and Running

### Prerequisites
*   Node.js 20+
*   Google Gemini API Key
*   Google Custom Search Key/CX (for external web search tools)

### Setup
1.  Install dependencies: `npm install`
2.  Configure environment variables in `.env`:
    ```env
    GEMINI_API_KEY=your_key
    ARCHIE_ADMIN_PASSWORD=your_admin_password
    GOOGLE_CSE_KEY=your_cse_key
    GOOGLE_CSE_CX=your_cse_cx
    NODE_ENV=development
    ```
3.  Seed the initial knowledge base: `node server/scripts/scrapeGA.js`

### Key Commands
*   **Development:** `npm run dev` (runs frontend and backend concurrently)
*   **Production Build:** `npm run build`
*   **Run Server:** `npm run server`
*   **Start (Build + Run):** `npm start`

## Development Conventions

*   **ES Modules:** The project uses native ES modules (`"type": "module"` in `package.json`).
*   **Function Calling:** Tools are defined as Gemini function declarations in `server/archieTools.js`.
*   **RAG Implementation:** Large documents are chunked into ~2000-character segments with 3072-dimension embeddings.
*   **Persistent Data:** In production, data is stored in `/data` (mounted Fly.io volume). In development, it defaults to `server/database/`.
*   **Authentication:** JWT-based for user accounts; simple password-based for the `/archie/admin` panel.
