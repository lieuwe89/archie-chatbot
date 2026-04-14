# Changelog

## [1.8.4] - 2026-04-07
### Fixed
- Chunked file upload (256 KB per request) to bypass proxy body-stream timeout on large PDFs

## [1.8.3] - 2026-04-06
### Added
- Persist LanceDB vector store and SQLite auth DB via Fly.io volume at `/data`

## [1.8.2] - 2026-04-06
### Fixed
- Move full PDF pipeline (extract → chunk → embed) to background job to avoid upload request timeout

## [1.8.1] - 2026-04-05
### Fixed
- Background async indexing to avoid proxy timeout on document upload

## [1.8.0] - 2026-04-04
### Added
- Batch embedding: up to 50 chunks per Gemini API call (~3× faster indexing)
- Upload progress indicator in admin panel

## [1.7.1] - 2026-03-31
### Fixed
- Auto-expand tool call panel when Beeldbank search returns images

## [1.7.0] - 2026-03-30
### Added
- Clickable links in chat responses
- Beeldbank image thumbnails rendered inline in tool call panel
- Persistent Handle identifiers (hdl.handle.net) preferred over direct URLs in genealogy results
- Fixed pdf-parse import for ESM

## [1.6.1] - 2026-03-25
### Fixed
- Serve chat API under `/archie/api/` for nginx-proxied deployments

## [1.6.0] - 2026-03-24
### Added
- Auto-create/update admin user from environment variables on startup

## [1.5.0] - 2026-03-20
### Added
- Initial Archie implementation: RAG system with LanceDB + Gemini embeddings
- Admin panel at `/archie/admin` for knowledge base management (upload, list, delete)
- Agentic chat loop with Gemini function calling
- AlleGroningers genealogy API integration
- Beeldbank Groningen image search integration
- Session management with 2-hour TTL
- One-time scraper to seed knowledge base from Groninger Archieven website
