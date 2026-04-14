// server/archieRag.js
import * as lancedb from '@lancedb/lancedb'
import { GoogleGenerativeAI } from '@google/generative-ai'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'archie-vectors')
  : path.join(__dirname, 'database', 'archie-vectors')
const EMBEDDING_DIM = 3072

let _table = null
let _embeddingModel = null

function getEmbeddingModel() {
  if (!_embeddingModel) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    _embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' })
  }
  return _embeddingModel
}

async function getTable() {
  if (_table) return _table
  const db = await lancedb.connect(DB_PATH)
  const names = await db.tableNames()
  if (names.includes('documents')) {
    _table = await db.openTable('documents')
  } else {
    // Seed with a dummy record to establish schema, then delete it
    _table = await db.createTable('documents', [{
      id: '__init__',
      source: '__init__',
      title: '__init__',
      chunk_text: '__init__',
      vector: Array(EMBEDDING_DIM).fill(0)
    }])
    await _table.delete("id = '__init__'")
  }
  return _table
}

async function embedText(text) {
  const model = getEmbeddingModel()
  const result = await model.embedContent(text)
  return result.embedding.values
}

// Embed multiple texts in one API call (up to 100 per batch)
async function embedBatch(texts) {
  const model = getEmbeddingModel()
  const result = await model.batchEmbedContents({
    requests: texts.map(text => ({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text }] }
    }))
  })
  return result.embeddings.map(e => e.values)
}

const EMBED_BATCH_SIZE = 50 // stay well under API limits

// chunks: Array<{ id: string, source: string, title: string, chunk_text: string }>
export async function addChunks(chunks) {
  const table = await getTable()
  const records = []
  // Batch embed: ~2 API calls for a large PDF instead of 150+
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE)
    const vectors = await embedBatch(batch.map(c => c.chunk_text))
    for (let j = 0; j < batch.length; j++) {
      records.push({
        id: batch[j].id,
        source: batch[j].source,
        title: batch[j].title,
        chunk_text: batch[j].chunk_text,
        vector: vectors[j]
      })
    }
  }
  await table.add(records)
}

// Returns top-k chunk_text strings relevant to query
export async function retrieve(query, topK = 5) {
  if (!process.env.GEMINI_API_KEY) return []
  try {
    const table = await getTable()
    const queryVector = await embedText(query)
    const results = await table.search(queryVector).limit(topK).toArray()
    return results.map(r => r.chunk_text)
  } catch {
    return []
  }
}

// Delete all chunks for a given source filename
export async function deleteBySource(source) {
  const table = await getTable()
  await table.delete(`source = '${source.replace(/'/g, "''")}'`)
}

// Returns unique { source, title } entries (one per document)
export async function listDocuments() {
  try {
    const table = await getTable()
    const all = await table.query().toArray()
    const seen = new Set()
    return all
      .filter(r => {
        if (seen.has(r.source) || r.source === '__init__') return false
        seen.add(r.source)
        return true
      })
      .map(r => ({ source: r.source, title: r.title }))
  } catch {
    return []
  }
}

// Split text into ~500-token chunks (paragraph-aware, ~2000 chars)
export function chunkText(text, maxChars = 2000) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0)
  const chunks = []
  let current = ''
  for (const para of paragraphs) {
    const candidate = current ? current + '\n\n' + para : para
    if (candidate.length > maxChars && current.length > 0) {
      chunks.push(current.trim())
      current = para
    } else {
      current = candidate
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}
