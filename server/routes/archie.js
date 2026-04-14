// server/routes/archie.js
import express from 'express'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getOrCreate, update } from '../archieSession.js'
import { toolDeclarations, executeTool } from '../archieTools.js'
import { retrieve } from '../archieRag.js'

const router = express.Router()

let genAI = null
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
}

const SYSTEM_INSTRUCTION_BASE = `You are Archie, the digital archivist for the Groninger Archieven.
You help users — both casual visitors and serious researchers — find genealogical records and archival materials.
Use the provided search tools. Search multiple times with different parameters if needed to answer the question thoroughly.
Think step by step. When results are sparse, try alternative spellings or broader queries.
Always share direct URLs to records when available. When a record has a Handle persistent identifier (hdl.handle.net), prefer that over other URLs — Handle links are permanent and citable.
Respond in the same language the user uses.

When you use the searchGroningerarchieven tool:
- Only use results that originate from www.groningerarchieven.nl. Ignore any result from another domain.
- If no result from www.groningerarchieven.nl answers the question, say clearly that you could not find that information on www.groningerarchieven.nl. Do NOT use your general knowledge or other sources as a fallback.
- Always cite the exact URL(s) from www.groningerarchieven.nl where you found the answer.
- Never use searchGroningerarchieven for research guides (onderzoeksgidsen) — those are fully available in the internal knowledge base (Archive Knowledge section above). Always consult the knowledge base first for research guide questions.`

router.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body
  if (!message || !sessionId) {
    return res.status(400).json({ error: 'message and sessionId are required' })
  }
  if (!genAI) {
    return res.status(503).json({ error: 'GEMINI_API_KEY not configured' })
  }

  try {
    const session = getOrCreate(sessionId)

    // RAG: retrieve relevant knowledge chunks
    const ragChunks = await retrieve(message, 5)
    const ragSection = ragChunks.length > 0
      ? `\n\n## Archive Knowledge\n${ragChunks.join('\n\n---\n\n')}`
      : ''
    const systemInstruction = SYSTEM_INSTRUCTION_BASE + ragSection

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{ functionDeclarations: toolDeclarations }],
      systemInstruction
    })

    const chat = model.startChat({ history: session.contents })

    // First turn: user message
    let response = await chat.sendMessage(message)
    const toolCalls = []

    // Agentic loop: keep executing tools until model stops calling them
    while (true) {
      const fns = response.response.functionCalls()
      if (!fns || fns.length === 0) break

      const functionResponses = await Promise.all(fns.map(async fn => {
        const result = await executeTool(fn.name, fn.args)
        toolCalls.push({ name: fn.name, args: fn.args, result })
        return {
          functionResponse: {
            name: fn.name,
            response: { content: JSON.stringify(result) }
          }
        }
      }))

      response = await chat.sendMessage(functionResponses)
    }

    const reply = response.response.text()

    // Surface CSE quota warning if any website-search tool call was near the daily limit
    const cseWarning = toolCalls.some(t => t.name === 'searchGroningerarchieven' && t.result?.nearDailyLimit)

    // Persist updated history
    const updatedHistory = await chat.getHistory()
    update(sessionId, updatedHistory)

    res.json({ reply, toolCalls, cseWarning, sessionId })
  } catch (error) {
    console.error('Archie Chat Error:', error)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

export default router
