#!/usr/bin/env node
// server/scripts/harvest.js
// OAI-PMH harvester for the De Ree archieven.nl federation (default config:
// Groninger Archieven, set Open_data_5, prefix oai_ead). Reusable for any
// OAI-PMH 2.0 endpoint by swapping --endpoint / --set / --prefix.
//
// Usage:
//   node server/scripts/harvest.js                    # incremental, default config
//   node server/scripts/harvest.js --full             # ignore last_datestamp, full sweep
//   node server/scripts/harvest.js --from 2024-01-01  # explicit cutoff
//   node server/scripts/harvest.js --limit 50         # stop after N records (smoke test)
//   node server/scripts/harvest.js --dry-run          # parse only, no writes
//   node server/scripts/harvest.js --set Open_data_37 --prefix oai_ead   # other archive

import fetch from 'node-fetch'
import { XMLParser } from 'fast-xml-parser'
import {
  openCatalogDb, makeUpsert, markDeleted,
  makeItemUpsert,
  getHarvestState, saveHarvestState,
  startHarvestRun, finishHarvestRun,
  CATALOG_DB_PATH,
} from '../database/archieCatalog.js'

const DEFAULTS = {
  endpoint: 'https://harvest.archieven.nl/OAI/OAIHandler',
  set: 'Open_data_5',
  prefix: 'oai_ead',
  userAgent: 'archie-chatbot harvester/1.0 (+https://playground.lieuwejongsma.nl/archie)',
  pageDelayMs: 250,
  maxRetries: 5,
  retryBaseMs: 2000,
}

function parseArgs(argv) {
  const args = { ...DEFAULTS, full: false, dryRun: false, limit: null, from: null, dbPath: null }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case '--endpoint': args.endpoint = next(); break
      case '--set':      args.set = next(); break
      case '--prefix':   args.prefix = next(); break
      case '--from':     args.from = next(); break
      case '--limit':    args.limit = parseInt(next(), 10); break
      case '--db':       args.dbPath = next(); break
      case '--full':     args.full = true; break
      case '--dry-run':  args.dryRun = true; break
      case '--help': case '-h':
        printHelp(); process.exit(0)
      default:
        console.error(`Unknown arg: ${a}`); printHelp(); process.exit(2)
    }
  }
  return args
}

function printHelp() {
  console.log(`OAI-PMH harvester

  --endpoint URL   OAI base (default: ${DEFAULTS.endpoint})
  --set NAME       OAI set spec (default: ${DEFAULTS.set})
  --prefix NAME    metadata prefix (default: ${DEFAULTS.prefix})
  --from DATE      override 'from' (YYYY-MM-DD); default = last_datestamp - 1 day
  --full           force full sweep, ignore last_datestamp
  --limit N        stop after N records (smoke test)
  --dry-run        parse only, no DB writes
  --db PATH        override DB file path
`)
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  cdataPropName: '__cdata',
  textNodeName: '#text',
})

async function fetchOAI(endpoint, params, ua, attempt = 1, maxRetries = DEFAULTS.maxRetries) {
  const url = new URL(endpoint)
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v)
  }
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': ua, 'Accept': 'application/xml' },
      timeout: 60000,
    })
    if (res.status === 503 || res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10) * 1000
      const wait = retryAfter || DEFAULTS.retryBaseMs * 2 ** (attempt - 1)
      if (attempt > maxRetries) throw new Error(`OAI ${res.status} after ${maxRetries} retries`)
      console.warn(`  [retry ${attempt}] HTTP ${res.status}, sleeping ${wait}ms`)
      await sleep(wait)
      return fetchOAI(endpoint, params, ua, attempt + 1, maxRetries)
    }
    if (!res.ok) throw new Error(`OAI HTTP ${res.status} ${res.statusText}`)
    return await res.text()
  } catch (err) {
    if (attempt > maxRetries) throw err
    const wait = DEFAULTS.retryBaseMs * 2 ** (attempt - 1)
    console.warn(`  [retry ${attempt}] ${err.message}, sleeping ${wait}ms`)
    await sleep(wait)
    return fetchOAI(endpoint, params, ua, attempt + 1, maxRetries)
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function asArray(x) {
  if (x == null) return []
  return Array.isArray(x) ? x : [x]
}

function textOf(node) {
  if (node == null) return null
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (node.__cdata != null) return String(node.__cdata)
  if (node['#text'] != null) return String(node['#text'])
  return null
}

function flattenText(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).filter(Boolean).join(' ')
  if (node.__cdata != null) return String(node.__cdata)
  let out = []
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('@')) continue
    if (k === '#text') { out.push(String(v)); continue }
    if (k === '__cdata') { out.push(String(v)); continue }
    out.push(flattenText(v))
  }
  return out.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

function parseDateRange(unitdate) {
  // unitdate may be array (multiple) or single. Look at @normal first.
  const list = asArray(unitdate)
  for (const u of list) {
    const normal = u && u['@normal']
    if (normal) {
      const m = String(normal).match(/^(\d{4})(?:-\d{2}(?:-\d{2})?)?(?:\/(\d{4})(?:-\d{2}(?:-\d{2})?)?)?$/)
      if (m) return { from: parseInt(m[1], 10), to: m[2] ? parseInt(m[2], 10) : parseInt(m[1], 10) }
    }
  }
  // Fallback: scrape years from text content
  const text = list.map(flattenText).join(' ')
  const years = (text.match(/\b1[0-9]{3}|20[0-2][0-9]\b/g) || []).map(n => parseInt(n, 10))
  if (years.length === 0) return { from: null, to: null }
  return { from: Math.min(...years), to: Math.max(...years) }
}

// Extract a normalized record from one OAI <record> object.
// Returns null for records without an EAD body (e.g. deletion-only headers).
function extractEadRecord(record, setSpec, metadataPrefix, fetchedAt) {
  const header = record.header || {}
  const guid = textOf(header.identifier)
  const datestamp = textOf(header.datestamp)
  const isDeleted = header['@status'] === 'deleted'

  if (isDeleted || !record.metadata) {
    return { guid, datestamp, isDeleted: true }
  }

  const ead = record.metadata.ead
  if (!ead) return null

  const eadheader = ead.eadheader || {}
  const archdesc = ead.archdesc || {}
  const did = archdesc.did || {}

  const titleproper = eadheader.filedesc?.titlestmt?.titleproper
  const title = textOf(titleproper) || flattenText(did.unittitle) || '(untitled)'

  const author = eadheader.filedesc?.titlestmt?.author
  const origination = did.origination
  const creator = textOf(author) || flattenText(origination) || null

  // unitids: archive_no carries @repositorycode; handle has @type="handle"
  let archive_no = null
  let repository_code = null
  let handle = null
  for (const u of asArray(did.unitid)) {
    if (!u) continue
    if (u['@type'] === 'handle') {
      handle = textOf(u) || flattenText(u)
    } else if (u['@repositorycode']) {
      archive_no = textOf(u) || flattenText(u)
      repository_code = u['@repositorycode']
    }
  }
  if (!archive_no) {
    archive_no = textOf(eadheader.eadid) || guid
    repository_code = eadheader.eadid?.['@mainagencycode'] || null
  }

  const { from: date_from, to: date_to } = parseDateRange(did.unitdate)

  const language = textOf(eadheader.profiledesc?.langusage?.language)
    || eadheader.profiledesc?.langusage?.language?.['@langcode']
    || null

  // scope: prefer scopecontent; fall back to abstract or did notes
  const scopeParts = [
    flattenText(archdesc.scopecontent),
    flattenText(did.abstract),
    flattenText(did.note),
    flattenText(archdesc.bioghist),
  ].filter(Boolean)
  const scope = scopeParts.join('\n').replace(/\s+\n/g, '\n').slice(0, 50_000) || null

  const subjects = []
  for (const ca of asArray(archdesc.controlaccess)) {
    for (const inner of asArray(ca?.controlaccess)) {
      for (const s of asArray(inner?.subject)) subjects.push(textOf(s) || flattenText(s))
      for (const g of asArray(inner?.geogname)) subjects.push(textOf(g) || flattenText(g))
      for (const p of asArray(inner?.persname)) subjects.push(textOf(p) || flattenText(p))
    }
    for (const s of asArray(ca?.subject)) subjects.push(textOf(s) || flattenText(s))
  }
  const cleanSubjects = [...new Set(subjects.filter(Boolean).map(s => s.trim()))]

  return {
    guid,
    handle,
    archive_no: String(archive_no),
    repository_code: repository_code || 'UNKNOWN',
    set_spec: setSpec,
    metadata_prefix: metadataPrefix,
    title: title.slice(0, 1000),
    creator: creator ? creator.slice(0, 500) : null,
    date_from,
    date_to,
    scope,
    subjects: cleanSubjects.length ? JSON.stringify(cleanSubjects) : null,
    language,
    datestamp,
    fetched_at: fetchedAt,
    is_deleted: 0,
    isDeleted: false,
  }
}

// Extract items/components from EAD hierarchy
function extractItemsFromEad(ead, archive_no, repository_code, datestamp, fetchedAt) {
  const items = []

  function extractComponent(component, level = 1) {
    if (!component) return

    const did = component.did || {}
    const itemGuid = textOf(did.unitid)
    if (!itemGuid) return // Skip items without identifiers

    let handle = null
    for (const u of asArray(did.unitid)) {
      if (!u) continue
      if (u['@type'] === 'handle') {
        handle = textOf(u) || flattenText(u)
        break
      }
    }

    const title = flattenText(did.unittitle) || `(Item ${itemGuid})`
    const creator = flattenText(did.origination) || null

    // Description: prefer scopecontent, then abstract, then note
    const descParts = [
      flattenText(component.scopecontent),
      flattenText(did.abstract),
      flattenText(did.note),
    ].filter(Boolean)
    const description = descParts.join('\n').replace(/\s+\n/g, '\n').slice(0, 10_000) || null

    const { from: date_from, to: date_to } = parseDateRange(did.unitdate)

    items.push({
      guid: `${archive_no}-${itemGuid}`.substring(0, 255),
      handle,
      archive_no: String(archive_no),
      repository_code,
      title: title.slice(0, 1000),
      creator: creator ? creator.slice(0, 500) : null,
      description,
      date_from,
      date_to,
      datestamp,
      fetched_at: fetchedAt,
      is_deleted: 0,
    })

    // Recurse into child components
    for (const childKey of Object.keys(component)) {
      if (childKey.match(/^c\d+$/)) {
        const children = asArray(component[childKey])
        for (const child of children) {
          extractComponent(child, level + 1)
        }
      }
    }
  }

  const archdesc = ead.archdesc || {}
  // Start extracting from child components (c01, c02, etc.)
  for (const key of Object.keys(archdesc)) {
    if (key.match(/^c\d+$/)) {
      const children = asArray(archdesc[key])
      for (const child of children) {
        extractComponent(child, 1)
      }
    }
  }

  return items
}

async function harvest(args) {
  const db = args.dryRun ? null : openCatalogDb(args.dbPath || undefined)
  const upsert = db ? makeUpsert(db) : null

  // Determine `from` value
  let fromParam = args.from
  if (!fromParam && !args.full && db) {
    const state = getHarvestState(db, args.endpoint, args.set, args.prefix)
    if (state?.last_datestamp) {
      // back off one day to be safe (granularity day)
      const d = new Date(state.last_datestamp)
      d.setUTCDate(d.getUTCDate() - 1)
      fromParam = d.toISOString().slice(0, 10)
      console.log(`Resuming from ${fromParam} (last_datestamp=${state.last_datestamp})`)
    }
  }

  const startedAt = new Date().toISOString()
  let runId = null
  if (db) {
    runId = startHarvestRun(db, {
      endpoint: args.endpoint,
      set_spec: args.set,
      metadata_prefix: args.prefix,
      started_at: startedAt,
      from_param: fromParam,
    })
  }

  let resumptionToken = null
  let seen = 0, inserted = 0, updated = 0, deleted = 0, itemsInserted = 0
  let lastDatestamp = null
  let completeListSize = null
  let pageNum = 0
  const fetchedAt = new Date().toISOString()
  let itemUpsert = null
  if (db) itemUpsert = makeItemUpsert(db)

  try {
    do {
      pageNum++
      const params = resumptionToken
        ? { verb: 'ListRecords', resumptionToken }
        : { verb: 'ListRecords', metadataPrefix: args.prefix, set: args.set, ...(fromParam ? { from: fromParam } : {}) }

      const xmlText = await fetchOAI(args.endpoint, params, args.userAgent)
      const parsed = xml.parse(xmlText)
      const oai = parsed['OAI-PMH']
      if (!oai) throw new Error('Missing OAI-PMH root in response')

      if (oai.error) {
        const code = oai.error?.['@code'] || 'unknown'
        const msg = textOf(oai.error) || flattenText(oai.error)
        if (code === 'noRecordsMatch') { console.log('No records match (incremental sweep up to date).'); break }
        throw new Error(`OAI error [${code}]: ${msg}`)
      }

      const list = oai.ListRecords
      if (!list) { console.log('Empty ListRecords response.'); break }

      const records = asArray(list.record)
      const tokenNode = list.resumptionToken
      if (tokenNode) {
        const size = tokenNode['@completeListSize']
        if (size && completeListSize == null) completeListSize = parseInt(size, 10)
      }

      console.log(`Page ${pageNum}: ${records.length} records${completeListSize ? ` (total ${completeListSize})` : ''}`)

      for (const r of records) {
        const rec = extractEadRecord(r, args.set, args.prefix, fetchedAt)
        if (!rec) continue
        if (rec.datestamp && (!lastDatestamp || rec.datestamp > lastDatestamp)) lastDatestamp = rec.datestamp
        seen++

        if (db) {
          if (rec.isDeleted) {
            if (markDeleted(db, rec.guid, rec.datestamp, fetchedAt)) deleted++
          } else {
            const result = upsert(rec)
            if (result === 'inserted') inserted++
            else updated++

            // Extract and store item-level records
            if (r.metadata?.ead) {
              const items = extractItemsFromEad(r.metadata.ead, rec.archive_no, rec.repository_code, rec.datestamp, fetchedAt)
              for (const item of items) {
                itemUpsert(item)
                itemsInserted++
              }
            }
          }
        }

        if (args.limit && seen >= args.limit) {
          console.log(`Hit --limit ${args.limit}, stopping.`)
          resumptionToken = null
          break
        }
      }

      if (args.limit && seen >= args.limit) break

      // resumptionToken: text content drives next request; empty element = end
      if (tokenNode) {
        const tokenText = textOf(tokenNode) || flattenText(tokenNode)
        resumptionToken = tokenText && tokenText.length ? tokenText : null
      } else {
        resumptionToken = null
      }

      if (resumptionToken) await sleep(args.pageDelayMs)
    } while (resumptionToken)

    if (db) {
      const state = getHarvestState(db, args.endpoint, args.set, args.prefix) || { total_seen: 0 }
      saveHarvestState(db, {
        endpoint: args.endpoint,
        set_spec: args.set,
        metadata_prefix: args.prefix,
        last_completed_at: new Date().toISOString(),
        last_datestamp: lastDatestamp || state.last_datestamp || null,
        last_resumption_token: null,
        total_seen: (state.total_seen || 0) + seen,
      })
      finishHarvestRun(db, runId, {
        finished_at: new Date().toISOString(),
        records_seen: seen,
        records_inserted: inserted,
        records_updated: updated,
        records_deleted: deleted,
        status: 'ok',
        error: null,
      })
    }

    console.log(`\nDone. archives: seen=${seen} inserted=${inserted} updated=${updated} deleted=${deleted}`)
    console.log(`       items: inserted=${itemsInserted}`)
    if (db) console.log(`DB: ${args.dbPath || CATALOG_DB_PATH}`)
    return { seen, inserted, updated, deleted, itemsInserted }
  } catch (err) {
    if (db && runId) {
      finishHarvestRun(db, runId, {
        finished_at: new Date().toISOString(),
        records_seen: seen,
        records_inserted: inserted,
        records_updated: updated,
        records_deleted: deleted,
        status: 'failed',
        error: err.message,
      })
    }
    throw err
  } finally {
    if (db) db.close()
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const args = parseArgs(process.argv)
  harvest(args).catch(err => {
    console.error('Harvest failed:', err)
    process.exit(1)
  })
}

export { harvest, extractEadRecord }
