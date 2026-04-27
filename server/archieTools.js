import fetch from 'node-fetch'
import { recordSearchRequest } from './archieSearchMonitor.js'
import { openCatalogDb, search as catalogSearch } from './database/archieCatalog.js'

const BEELDBANK_API_KEY = process.env.BEELDBANK_API_KEY || 'fd45b590-346a-11e5-a2cb-0800200c9a66'
const GENEALOGY_API_KEY = process.env.GENEALOGY_API_KEY || '6976bb7e-0c61-4f03-bf5b-df645d5fd086'
const TAVILY_API_KEY = process.env.TAVILY_API_KEY

// Domains available for Tavily web search
const TAVILY_DOMAINS = [
  'groningerarchieven.nl',
  'poparchiefgroningen.nl',
  'filmbankgroningen.nl',
  'groningerkentekens.nl'
]

// Gemini function declarations
export const toolDeclarations = [
  {
    name: 'searchArchieCatalog',
    description: 'Search the local mirror of Groninger Archieven inventory finding aids (EAD records harvested via OAI-PMH). Returns archive numbers, titles, creators, date ranges, and persistent handle URLs. PREFER this over searchGroningerarchieven for any question about specific fonds, collections, inventories, or historical institutions/families that may have an archive number. Free, instant, structured data.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search query in Dutch or English. Diacritics are folded (a == ä). Multiple words are AND-combined. Append * for prefix match (e.g. "godlin*"). Use OR/NEAR for boolean queries.'
        },
        limit: {
          type: 'number',
          description: 'Number of results to return. Default 10, max 25.'
        }
      },
      required: ['q']
    }
  },
  {
    name: 'searchGroningerarchieven',
    description: 'Search groningerarchieven.nl via web search for general institutional information (opening hours, visitor info, news pages) or any topic NOT covered by searchArchieCatalog. Prefer searchArchieCatalog first for actual catalog/inventory queries.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search query.'
        }
      },
      required: ['q']
    }
  },
  {
    name: 'searchAlleGroningers',
    description: 'Search genealogical records (birth, marriage, death, baptism registers, etc.) in the Groninger Archieven via AlleGroningers. Use multiple calls with different parameters to find comprehensive results.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Keyword search query. Can be a name, place, or combination. Supports wildcards (*, ?) and fuzzy search (~).'
        },
        fuzzy: {
          type: 'boolean',
          description: 'If true, automatically perform a fuzzy search (spelling variations) on each word of the query.'
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
    name: 'searchOpenArch',
    description: 'Search genealogical data across many Dutch archives via OpenArch.nl. Useful when AlleGroningers yields no results.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search query (name, place). Supports wildcards (*, ?) and fuzzy search (~).'
        },
        fuzzy: {
          type: 'boolean',
          description: 'If true, automatically perform a fuzzy search (spelling variations) on each word of the query.'
        }
      },
      required: ['q']
    }
  },
  {
    name: 'searchPoparchiefGroningen',
    description: 'Search poparchiefgroningen.nl for information about pop music, pop culture, concerts, bands, venues, and current cultural events in Groningen. Use this tool whenever the question is about pop music, pop culture, or contemporary cultural life in Groningen.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search query, e.g. a band name, venue, or event.'
        }
      },
      required: ['q']
    }
  },
  {
    name: 'searchFilmbankGroningen',
    description: 'Search filmbankgroningen.nl for information about films, videos, cinema, and moving image collections related to Groningen. Use this tool whenever the words "film", "video", "cinema", or "documentaire" appear in the question.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search query, e.g. a film title, director, or subject.'
        }
      },
      required: ['q']
    }
  },
  {
    name: 'searchGroningerkentekens',
    description: 'Search groningerkentekens.nl for information about historical vehicle licence plates (kentekens) from the province of Groningen.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search query, e.g. a licence plate number, vehicle type, or owner name.'
        }
      },
      required: ['q']
    }
  }
]

// Shared helper: search via Tavily, optionally restricted to specific domains
async function searchSite(q, includeDomains) {
  if (!TAVILY_API_KEY) {
    return { error: 'Tavily API not configured (TAVILY_API_KEY missing).' }
  }

  const monitor = recordSearchRequest()

  try {
    const body = {
      api_key: TAVILY_API_KEY,
      query: q,
      max_results: 5,
      search_depth: 'advanced'
    }
    if (includeDomains && includeDomains.length > 0) {
      body.include_domains = includeDomains
    }

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await response.json()

    if (!response.ok) {
      console.error('[Tavily ERROR]', data)
      return { error: `Tavily API error: ${data.message || response.status}` }
    }

    const results = (data.results || []).map(item => ({
      title: item.title,
      url: item.url,
      snippet: item.content
    }))

    if (results.length === 0) {
      console.log(`[Tavily] No results for "${q}" (domains: ${includeDomains?.join(', ') || 'all'})`)
    }

    return {
      results,
      total: results.length,
      usageToday: monitor.count,
      nearDailyLimit: monitor.nearLimit
    }
  } catch (e) {
    console.error('[Tavily FETCH ERROR]', e)
    return { error: `Network error reaching Tavily: ${e.message}` }
  }
}

async function searchGroningerarchieven({ q }) {
  return searchSite(q, ['groningerarchieven.nl'])
}

async function searchPoparchiefGroningen({ q }) {
  return searchSite(q, ['poparchiefgroningen.nl'])
}

async function searchFilmbankGroningen({ q }) {
  return searchSite(q, ['filmbankgroningen.nl'])
}

async function searchGroningerkentekens({ q }) {
  return searchSite(q, ['groningerkentekens.nl'])
}

function applyFuzzy(q) {
  if (!q) return q
  // Split by space, add ~ to each word if not already present and not a wildcard
  return q.split(/\s+/)
    .map(word => {
      if (word.length < 3) return word // too short for fuzzy
      if (word.includes('*') || word.includes('?') || word.includes('~')) return word
      return `${word}~`
    })
    .join(' ')
}

async function searchOpenArch({ q, fuzzy }) {
  try {
    const query = fuzzy ? applyFuzzy(q) : q
    const params = new URLSearchParams({
      name: query,
      lang: 'nl',
      number_of_results: 10
    })
    const url = `https://api.openarch.nl/1.0/search.json?${params}`
    const response = await fetch(url)
    const data = await response.json()

    const records = (data.result || []).map(item => ({
      source: 'OpenArch',
      title: `${item.voornaam || ''} ${item.tussenvoegsel || ''} ${item.achternaam || ''}`.trim() || q,
      date: item.datum,
      deed_type: item.brontype,
      municipality: item.plaats,
      url: `https://www.openarch.nl/show.php?archive=${item.archive}&identifier=${item.identifier}`,
      description: `${item.rol}: ${item.voornaam} ${item.achternaam}`
    }))

    return { records, total: data.number_of_results }
  } catch (e) {
    console.error('[OpenArch API ERROR]', e)
    return { error: `OpenArch API error: ${e.message}` }
  }
}

async function searchAlleGroningers({ q, fuzzy, deed_type, gemeente, rows = 5, start = 0 }) {
  try {
    const query = fuzzy ? applyFuzzy(q) : q
    const params = new URLSearchParams({
      apiKey: GENEALOGY_API_KEY,
      q: query,
      rows: Math.min(rows, 20),
      start
    })
    if (deed_type) params.set('deed_type', deed_type)
    if (gemeente) params.set('gemeente', gemeente)

    const url = `https://webservices.memorix.nl/genealogy/person?${params}`
    const response = await fetch(url)
    const data = await response.json()
    const total = data.metadata?.pagination?.total
    const records = (data.person || []).map(p => {
      const handleRaw = p.handle || p.pid || p.persistent_id || p.metadata?.handle || p.metadata?.pid
      const handle = handleRaw
        ? (handleRaw.startsWith('http') ? handleRaw : `https://hdl.handle.net/${handleRaw}`)
        : null
      return {
        source: 'AlleGroningers',
        title: p.metadata?.person_display_name || q,
        date: p.metadata?.datum,
        deed_type: p.metadata?.deed_type_title,
        municipality: p.metadata?.register_gemeente,
        register: p.metadata?.register_naam,
        occupation: p.metadata?.beroep,
        url: handle || `https://www.allegroningers.nl/zoeken-op-naam/persons/${p.entity_uuid}`,
        handle: handle || null
      }
    })
    return { records, total }
  } catch (e) {
    return { error: e.message }
  }
}

let _catalogDb = null
function getCatalogDb() {
  if (!_catalogDb) _catalogDb = openCatalogDb()
  return _catalogDb
}

const FTS_OPERATORS = /^(AND|OR|NOT|NEAR)$/

function sanitizeFtsQuery(raw) {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const tokens = trimmed.split(/\s+/).map(tok => {
    if (FTS_OPERATORS.test(tok)) return tok
    const cleaned = tok.replace(/["()]/g, '')
    if (!cleaned) return null
    if (/^[A-Za-z0-9_]+\*?$/.test(cleaned)) return cleaned
    return `"${cleaned.replace(/"/g, '""')}"`
  }).filter(Boolean)
  return tokens.length ? tokens.join(' ') : null
}

async function searchArchieCatalog({ q, limit = 10 }) {
  const ftsQuery = sanitizeFtsQuery(q)
  if (!ftsQuery) return { error: 'Empty or invalid query.' }
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 10, 25))

  try {
    const db = getCatalogDb()
    const rows = catalogSearch(db, ftsQuery, safeLimit)
    const records = rows.map(r => ({
      source: 'Groninger Archieven (catalog)',
      title: r.title,
      archive_no: r.archive_no,
      repository_code: r.repository_code,
      creator: r.creator,
      date_from: r.date_from,
      date_to: r.date_to,
      snippet: r.snippet,
      handle: r.handle || null,
      url: r.handle
        || `https://www.groningerarchieven.nl/archieven?mivast=5&miadt=5&mizig=${r.archive_no}&miview=inv2`,
    }))
    return { records, total: records.length, query: ftsQuery }
  } catch (e) {
    console.error('[archieCatalog ERROR]', e)
    return { error: `Catalog search failed: ${e.message}` }
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
    const total = data.metadata?.pagination?.total
    const records = (data.media || []).map(item => {
      const date = Array.isArray(item.metadata)
        ? item.metadata.find(m => m.field === 'date')?.value
        : null
      const creator = Array.isArray(item.metadata)
        ? item.metadata.find(m => m.field === 'creator')?.value
        : null
      const handleRaw = item.handle || item.pid || item.persistent_id
        || (Array.isArray(item.metadata) ? item.metadata.find(m => m.field === 'handle' || m.field === 'pid')?.value : null)
      const handle = handleRaw
        ? (handleRaw.startsWith('http') ? handleRaw : `https://hdl.handle.net/${handleRaw}`)
        : null
      return {
        source: 'Beeldbank Groningen',
        title: item.title || 'Afbeelding',
        date,
        creator,
        description: item.description,
        thumbnail: item.asset?.[0]?.thumb?.small,
        url: handle || `https://www.beeldbankgroningen.nl/beelden/detail/${item.id}`,
        handle: handle || null
      }
    })
    return { records, total }
  } catch (e) {
    return { error: e.message }
  }
}

export async function executeTool(name, args) {
  switch (name) {
    case 'searchArchieCatalog': return searchArchieCatalog(args)
    case 'searchGroningerarchieven': return searchGroningerarchieven(args)
    case 'searchPoparchiefGroningen': return searchPoparchiefGroningen(args)
    case 'searchFilmbankGroningen': return searchFilmbankGroningen(args)
    case 'searchGroningerkentekens': return searchGroningerkentekens(args)
    case 'searchAlleGroningers': return searchAlleGroningers(args)
    case 'searchBeeldbank': return searchBeeldbank(args)
    case 'searchOpenArch': return searchOpenArch(args)
    default: return { error: `Unknown tool: ${name}` }
  }
}
