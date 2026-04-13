// server/scripts/scrapeGA.js
// Run once: node server/scripts/scrapeGA.js
// Requires GEMINI_API_KEY in environment.

import fetch from 'node-fetch'
import { addChunks, chunkText } from '../archieRag.js'

const SOURCES = [
  { url: 'https://www.groningerarchieven.nl/zoeken/hoe-zoek-ik', title: 'GA: Hoe zoek ik?' },
  { url: 'https://www.groningerarchieven.nl/zoeken/wat-zoek-ik/genealogie', title: 'GA: Genealogie' },
  { url: 'https://www.groningerarchieven.nl/zoeken/wat-zoek-ik/archieven', title: 'GA: Archieven' },
  { url: 'https://www.allegroningers.nl/over', title: 'AlleGroningers: Over' },
]

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Archie-Scraper/1.0 (Groninger Archieven research bot)' },
      timeout: 15000
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const html = await response.text()
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{2,}/g, '\n')
      .trim()
  } catch (err) {
    console.error(`  Failed to fetch ${url}: ${err.message}`)
    return null
  }
}

async function run() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is required. Set it in .env or export it.')
    process.exit(1)
  }

  console.log('Starting Groninger Archieven knowledge base scrape...\n')
  let totalChunks = 0

  for (const source of SOURCES) {
    console.log(`Fetching: ${source.url}`)
    const text = await fetchText(source.url)
    if (!text || text.length < 100) {
      console.log('  Skipped (empty or too short)\n')
      continue
    }

    const filename = source.title.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.scraped'
    const textChunks = chunkText(text)
    const chunks = textChunks.map((chunk, i) => ({
      id: `${filename}-${i}`,
      source: filename,
      title: source.title,
      chunk_text: chunk
    }))

    console.log(`  ${textChunks.length} chunks, embedding...`)
    await addChunks(chunks)
    totalChunks += chunks.length
    console.log(`  Done\n`)
  }

  console.log(`Scrape complete. ${totalChunks} chunks added to knowledge base.`)
  process.exit(0)
}

run()
