# OAI-PMH Harvester

Local mirror of archive finding aids harvested over OAI-PMH 2.0. Defaults to the **De Ree** federation (`archieven.nl`) and the **Groninger Archieven** open-data set, but the script is generic — point it at any OAI-PMH endpoint and metadata prefix and it will index records into the same SQLite/FTS5 schema.

> Designed for reuse across projects. The two files (`server/database/archieCatalog.js`, `server/scripts/harvest.js`) have no dependency on the rest of archie-chatbot beyond `better-sqlite3`, `fast-xml-parser`, and `node-fetch`. Lift them into another project as a unit.

---

## 1. What it does

| Step | Behavior |
|---|---|
| 1 | Walks an OAI-PMH endpoint via `verb=ListRecords` + `resumptionToken`. |
| 2 | Parses each record (default: EAD 2002 finding aids) into a normalized row. |
| 3 | Upserts into `inventories` (SQLite) keyed on the OAI `<identifier>` GUID. |
| 4 | Mirrors content into `inventories_fts` (SQLite FTS5, `unicode61 remove_diacritics 2`). |
| 5 | Records `<datestamp>` high-water mark in `harvest_state` for incremental sweeps. |
| 6 | Logs every run into `harvest_runs` (start, finish, counts, error). |

Default config produces ~2,800 rows for the Groninger Archieven set, ~50 MB on disk.

---

## 2. Files

```
server/
├── database/
│   └── archieCatalog.js   # DB module: schema, upsert, search, state I/O
└── scripts/
    └── harvest.js         # CLI entry + OAI walker + EAD extractor
```

`archieCatalog.js` is also the public API for the rest of the app (e.g. `archieSearch()` tool wraps `search(db, query, limit)`).

---

## 3. CLI usage

```bash
# Default: incremental harvest of Groninger Archieven (Open_data_5, oai_ead)
node server/scripts/harvest.js

# Force full re-sweep
node server/scripts/harvest.js --full

# Explicit `from=YYYY-MM-DD`
node server/scripts/harvest.js --from 2025-01-01

# Smoke test: stop after N records
node server/scripts/harvest.js --limit 50 --db /tmp/test.db

# Dry run: parse only, no DB writes
node server/scripts/harvest.js --dry-run --limit 100

# Different archive in same federation
node server/scripts/harvest.js --set Open_data_37   # Drents Archief

# Different OAI endpoint entirely
node server/scripts/harvest.js \
  --endpoint https://example.org/oai \
  --set my_set --prefix oai_dc
```

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--endpoint` | `https://harvest.archieven.nl/OAI/OAIHandler` | OAI base URL |
| `--set` | `Open_data_5` | OAI `set` parameter |
| `--prefix` | `oai_ead` | OAI `metadataPrefix` |
| `--from` | (auto) | OAI `from` (YYYY-MM-DD); skipped on `--full` |
| `--full` | off | Ignore `last_datestamp`, full sweep |
| `--limit N` | off | Stop after N records (smoke test) |
| `--db PATH` | `$DATA_DIR/archie_catalog.db` | DB file location |
| `--dry-run` | off | Parse only, no DB writes |

### DB path resolution

```
process.env.ARCHIE_CATALOG_DB
  ?? path.join(process.env.DATA_DIR, 'archie_catalog.db')
  ?? path.join(__dirname, 'archie_catalog.db')   // repo-local fallback
```

`DATA_DIR` is the same env var [archieRag.js](../server/archieRag.js) reads — Fly volume mount at `/data`.

### Exit codes

- `0` ok
- `1` harvest failed (network, parse, DB error). The run row in `harvest_runs` is updated with `status='failed'` + `error` message before exit.
- `2` bad CLI args.

---

## 4. Schema

```sql
inventories (
  guid             TEXT PRIMARY KEY,    -- OAI <identifier>
  handle           TEXT,                -- e.g. https://hdl.handle.net/...
  archive_no       TEXT NOT NULL,       -- local archive id (e.g. "236")
  repository_code  TEXT NOT NULL,       -- ISIL (e.g. "NL-GnGRA")
  set_spec         TEXT NOT NULL,       -- OAI set
  metadata_prefix  TEXT NOT NULL,       -- oai_ead | oai_mi | oai_dc | ...
  title            TEXT NOT NULL,
  creator          TEXT,
  date_from        INTEGER,             -- earliest year
  date_to          INTEGER,             -- latest year
  scope            TEXT,                -- scopecontent / abstract / notes (joined)
  subjects         TEXT,                -- JSON array of strings
  language         TEXT,
  datestamp        TEXT NOT NULL,       -- OAI <datestamp>
  fetched_at       TEXT NOT NULL,       -- ISO timestamp of harvest
  is_deleted       INTEGER NOT NULL DEFAULT 0
)

inventories_fts USING fts5(
  title, scope, creator, subjects,
  content='inventories', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
)

harvest_state (
  endpoint, set_spec, metadata_prefix,    -- composite key
  last_completed_at, last_datestamp,
  last_resumption_token, total_seen
)

harvest_runs (
  id, endpoint, set_spec, metadata_prefix,
  started_at, finished_at,
  records_seen, records_inserted, records_updated, records_deleted,
  from_param, status, error
)
```

`unicode61 remove_diacritics 2` matches Dutch search expectations: `groninger` finds `Gröninger`.

FTS sync is trigger-based, not external-content-rebuild. No need to call `INSERT INTO inventories_fts(inventories_fts) VALUES('rebuild')` after writes.

---

## 5. Incremental harvests

The first run does a full sweep. Each subsequent run:

1. Looks up `harvest_state.last_datestamp` for `(endpoint, set_spec, metadata_prefix)`.
2. Subtracts one day (granularity is `YYYY-MM-DD`, not seconds — overlap is safer than gaps).
3. Sends `from=YYYY-MM-DD` on the first `ListRecords` request.
4. Walks the resumption token chain.
5. Updates `harvest_state.last_datestamp` to the max `<datestamp>` actually seen this run.

Idempotency: every record is written via `INSERT … ON CONFLICT(guid) DO UPDATE`. Re-running the same window is safe — second run reports 0 inserted, N updated.

OAI deletions: records where `<header status="deleted">` flip `is_deleted=1`. Search queries filter `is_deleted=0` by default. The row stays so we can detect re-additions.

OAI errors: response body containing `<error code="noRecordsMatch">` is treated as success (incremental sweep already up to date).

---

## 6. Reuse pattern: another OAI endpoint

The script makes only two assumptions specific to EAD:

1. The metadata payload is shaped like `record.metadata.ead.archdesc.did.unitid` (handles, archive number).
2. The dating signal is on `unitdate[@normal]`.

To harvest a different schema (Dublin Core, MODS, custom), replace `extractEadRecord()` in `harvest.js`. The rest — pagination, retries, FTS triggers, run log — is schema-agnostic.

Suggested refactor when you actually need a second extractor:

```js
// harvest.js
import { extractEadRecord } from './extractors/ead.js'
import { extractDcRecord }  from './extractors/dc.js'

const EXTRACTORS = { oai_ead: extractEadRecord, oai_dc: extractDcRecord }
const extract = EXTRACTORS[args.prefix] || (() => { throw new Error(...) })
```

Until then, `oai_ead` is the only path.

---

## 7. Operational notes

### Network behavior

- Page delay: 250 ms between page fetches (configurable via `DEFAULTS.pageDelayMs`).
- Retries: 5 attempts, exponential backoff 2s → 32s, on `503`, `429`, network timeout. `Retry-After` header is honored when present.
- Per-page timeout: 60 s.
- Total run time for a full Groninger sweep: ~10 minutes wall-clock.

### Resource use

- ~250 KB peak per page (3 records × ~80 KB EAD each).
- SQLite WAL on. Single writer (the script). Safe to run while the chatbot reads concurrently — readers see the pre-commit snapshot.
- ~50 MB DB file at full population. Drop scope to fit < 20 MB if needed.

### Crash recovery

If the script dies mid-sweep:

- Records up to the last completed page are committed (each upsert is its own transaction).
- `harvest_runs.status` stays `'running'` if the process was killed; manually mark stale rows as `'failed'` if it bothers you.
- Next run reads `last_datestamp` from `harvest_state` (only updated on successful completion) and replays from there.
- `last_resumption_token` is currently always nulled at run end — not used for mid-sweep resume because tokens expire (~5 min). Re-running with `--from` and re-walking from start is reliable enough for a 10-minute job.

### What the script does NOT do

- No raw XML retention. Source-of-truth is the upstream endpoint. If you need the full EAD bytes, add `raw_xml TEXT` to the schema and store inside `extractEadRecord`. Adds ~700 MB at full population — gzip if keeping.
- No deletion of stale rows for sets that switch identifiers. If a record's GUID changes upstream, the old row sits forever. Workaround: `--full` periodically and DELETE rows where `fetched_at < $cutoff`.
- No multi-extractor dispatch (see §6).
- No SRU/CQL — De Ree doesn't expose it; see [Groninger Archieven API.md](../../../Documents/Obsidian%20Vault/Knowledge/Groninger%20Archieven%20API.md) §5.

---

## 8. Scheduling on Fly.io

Two viable patterns; pick one.

### A. In-process scheduler (simplest)

Add to `server/index.js` (after DB init):

```js
import { harvest } from './scripts/harvest.js'

if (process.env.ENABLE_HARVEST === '1') {
  const run = () => harvest({
    endpoint: 'https://harvest.archieven.nl/OAI/OAIHandler',
    set: 'Open_data_5', prefix: 'oai_ead',
    userAgent: 'archie-chatbot/2.x',
    pageDelayMs: 250, maxRetries: 5, retryBaseMs: 2000,
  }).catch(err => console.error('harvest failed', err))
  setTimeout(run, 60_000)              // initial delay so boot is fast
  setInterval(run, 24 * 60 * 60 * 1000) // nightly
}
```

Pros: no extra Fly machine, runs on the existing process.
Cons: `auto_stop_machines = true` may suspend the VM mid-harvest. Mitigate with `min_machines_running = 1` during the harvest window, or accept that the next request will resume.

### B. Separate Fly machine with cron-style schedule

```toml
[processes]
  app = "node server/index.js"
  harvest = "node server/scripts/harvest.js"

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
```

Then drive with `flyctl machine run --schedule daily ... -- harvest` or [Fly's scheduled machine API](https://fly.io/docs/apps/scheduled-machines/). Both processes share the volume mount at `/data`.

Pros: clean separation, no live-reqest interference.
Cons: extra machine. Trivial cost (idle machine ~$0).

Recommendation: **start with A**, switch to B if the harvest ever interferes with chat latency.

---

## 9. Querying

Use `search(db, query, limit)` from `archieCatalog.js`:

```js
import { openCatalogDb, search } from './database/archieCatalog.js'
const db = openCatalogDb()
const rows = search(db, 'predikant Godlinze', 10)
// → [{ guid, handle, archive_no, title, creator, date_from, date_to, snippet, rank }, ...]
```

FTS5 query syntax (the `MATCH` operand) supports:

- `kerk OR predikant`
- `"hervormde gemeente"` (phrase)
- `predikant NEAR/5 godlinze`
- `gron*` (prefix)
- column-scoped: `title:godlinze`

Default join filter is `is_deleted = 0`.

To paginate beyond a single result set, FTS5 has no built-in offset that's stable under updates — use `WHERE rowid < :last_rowid ORDER BY rank` keyset pagination, or just use `LIMIT/OFFSET` and accept the occasional duplicate at the boundary.

---

## 10. Known data quirks (Groninger Archieven, oai_ead)

- ~1 record per ~20 lacks a usable `metadata/ead` body. The extractor returns `null`; the harvester silently skips. Report shows `seen` > `inserted+updated`.
- `unitdate@normal` is usually `YYYY/YYYY` but may be `YYYY-MM-DD/YYYY-MM-DD` or single year. The regex handles all three.
- `creator` may come from `<author>` (cataloguer) or `<origination>` (record creator). Cataloguer wins because it's reliably present; for genealogy use cases this is the wrong choice — swap to `origination` first if you care.
- Some older fonds repeat `controlaccess > controlaccess` (nested twice). Extractor walks both layers.

---

## 11. Adding a future extractor

Skeleton for, say, `oai_mi` (the De Ree native MAIS-internal schema):

```js
function extractMiRecord(record, setSpec, metadataPrefix, fetchedAt) {
  const header = record.header || {}
  if (header['@status'] === 'deleted' || !record.metadata) {
    return { guid: textOf(header.identifier), datestamp: textOf(header.datestamp), isDeleted: true }
  }
  const mi = record.metadata.mi   // root tag depends on schema
  // ...map mi.* into the same {guid, archive_no, title, scope, ...} shape
}
```

Shape contract (return value):

```ts
type ExtractedRecord =
  | { isDeleted: true, guid: string, datestamp: string }
  | {
      isDeleted: false,
      guid: string, handle: string|null,
      archive_no: string, repository_code: string,
      set_spec: string, metadata_prefix: string,
      title: string, creator: string|null,
      date_from: number|null, date_to: number|null,
      scope: string|null, subjects: string|null /* JSON */, language: string|null,
      datestamp: string, fetched_at: string,
      is_deleted: 0
    }
  | null   // skip silently
```

---

## 12. Source upstream

- OAI endpoint discovery: <https://opendata.archieven.nl/nl/over-harvesten>
- Set list (per-institution `adtid`): <https://opendata.archieven.nl/nl/datasets>
- Schema reference: [Groninger Archieven API.md](../../../Documents/Obsidian%20Vault/Knowledge/Groninger%20Archieven%20API.md) §3 — endpoint paths, verbs, available metadata formats.
- EAD 2002 schema: <http://www.loc.gov/ead/ead.xsd>

Verified live: 2026-04-27.
