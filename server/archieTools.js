import fetch from 'node-fetch'
import { recordCseRequest } from './archieSearchMonitor.js'

const BEELDBANK_API_KEY = 'fd45b590-346a-11e5-a2cb-0800200c9a66'
const GENEALOGY_API_KEY = '6976bb7e-0c61-4f03-bf5b-df645d5fd086'
const CSE_API_KEY = process.env.GOOGLE_CSE_KEY
const CSE_CX = process.env.GOOGLE_CSE_CX

// Gemini function declarations
export const toolDeclarations = [
  {
    name: 'searchGroningerarchieven',
    description: 'Search www.groningerarchieven.nl for institutional information: opening hours, contact details, visitor info, collections overview, events, policies, reading room rules, and general archive information. Use this tool for questions about the Groninger Archieven as an institution. Do NOT use this for genealogical person records or historical images — use searchAlleGroningers and searchBeeldbank for those. Do NOT use this for research guides (onderzoeksgidsen) — those are available in the internal knowledge base, use that instead.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search query, e.g. "openingstijden" or "aanvragen archiefstukken".'
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
    description: 'Search archive inventories and finding aids on www.groningerarchieven.nl. Use for questions about specific archive collections, inventory numbers, collection descriptions, and finding aids.',
    parameters: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Keyword search query, e.g. "inventarisnummer" or collection name.'
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
    name: 'googleSearch',
    description: 'General web search. Use this to identify people, find historical background, or search other historical/archival websites (like Delpher, Wikipedia, or Archieven.nl). Essential when local archival tools yield no results for a specific person or topic.',
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
  }
]

// Shared helper: search a specific site via Google Custom Search API
async function searchSite(q, siteHost) {
  if (!CSE_API_KEY || !CSE_CX) {
    return { error: 'Google Custom Search not configured (GOOGLE_CSE_KEY / GOOGLE_CSE_CX missing).' }
  }

  const monitor = recordCseRequest()
  if (monitor.overLimit) {
    return { error: 'Daily Google Custom Search quota (100 requests) has been reached. Try again tomorrow.' }
  }

  try {
    const params = new URLSearchParams({
      key: CSE_API_KEY,
      cx: CSE_CX,
      q,
      num: 5
    })
    if (siteHost) {
      params.set('siteSearch', siteHost)
      params.set('siteSearchFilter', 'i')  // 'i' = include only this site
    }
    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`)
    const data = await response.json()

    if (data.error) {
      return { error: `CSE API error: ${data.error.message}` }
    }

    const results = (data.items || []).map(item => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet
    }))

    return {
      results,
      total: data.searchInformation?.totalResults ?? 0,
      usageToday: monitor.count,
      nearDailyLimit: monitor.nearLimit
    }
  } catch (e) {
    return { error: e.message }
  }
}

async function searchGroningerarchieven({ q }) {
  return searchSite(q, 'www.groningerarchieven.nl')
}

async function searchPoparchiefGroningen({ q }) {
  return searchSite(q, 'poparchiefgroningen.nl')
}

async function searchFilmbankGroningen({ q }) {
  return searchSite(q, 'filmbankgroningen.nl')
}

async function googleSearch({ q }) {
  return searchSite(q)
}

async function searchAlleGroningers({ q, deed_type, gemeente, rows = 5, start = 0 }) {
  try {
    const params = new URLSearchParams({
      apiKey: GENEALOGY_API_KEY,
      q,
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

async function searchInventories({ q }) {
  return searchSite(q, 'www.groningerarchieven.nl')
}

export async function executeTool(name, args) {
  switch (name) {
    case 'searchGroningerarchieven': return searchGroningerarchieven(args)
    case 'searchPoparchiefGroningen': return searchPoparchiefGroningen(args)
    case 'searchFilmbankGroningen': return searchFilmbankGroningen(args)
    case 'searchAlleGroningers': return searchAlleGroningers(args)
    case 'searchBeeldbank': return searchBeeldbank(args)
    case 'searchInventories': return searchInventories(args)
    case 'googleSearch': return googleSearch(args)
    default: return { error: `Unknown tool: ${name}` }
  }
}
