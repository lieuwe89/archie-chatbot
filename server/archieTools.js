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

function searchInventories() {
  return { records: [], total: 0 }
}

export async function executeTool(name, args) {
  switch (name) {
    case 'searchAlleGroningers': return searchAlleGroningers(args)
    case 'searchBeeldbank': return searchBeeldbank(args)
    case 'searchInventories': return searchInventories(args)
    default: return { error: `Unknown tool: ${name}` }
  }
}
