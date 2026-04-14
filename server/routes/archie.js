// server/routes/archie.js
import express from 'express'
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai'
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

When using web search tools (searchGroningerarchieven, searchInventories, searchPoparchiefGroningen, searchFilmbankGroningen, googleSearch):
- Only use results from the tool's specific domain (except for googleSearch). Ignore results from any other domain.
- searchGroningerarchieven is for general information about the archives (opening hours, visitor info).
- searchInventories is specifically for searching archive inventories and finding aids (inventarissen).
- searchPoparchiefGroningen is for pop music, bands, and cultural events in Groningen.
- searchFilmbankGroningen is for films and moving images.
- googleSearch is for general web search when the specialized tools are insufficient.
- If no results answer the question, say clearly you could not find that information. Do NOT fall back on general knowledge or other sources.
- Always cite the exact URL(s) where you found the answer.
- Never use searchGroningerarchieven or searchInventories for research guides (onderzoeksgidsen) — those are fully covered by the internal knowledge base above.`

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
    
    const now = new Date()
    const dateContext = `\n\nToday is ${now.toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. Current time: ${now.toLocaleTimeString('nl-NL')}.`
    
    const systemInstruction = SYSTEM_INSTRUCTION_BASE + ragSection + dateContext + `\n\nFor questions about current events, opening hours for specific dates, or any information that might change over time, ALWAYS prioritize using the search tools over the provided Archive Knowledge chunks.`

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{ functionDeclarations: toolDeclarations }],
      systemInstruction,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
      ],
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

    let reply = ''
    try {
      reply = response.response.text()
    } catch (e) {
      console.warn('[Archie] Error calling text() - possibly blocked:', e.message)
      if (response.response.promptFeedback?.blockReason) {
         console.warn('[Archie] Block reason:', response.response.promptFeedback.blockReason)
      }
    }

    if (!reply) {
      console.warn('[Archie] Empty reply from Gemini. Response object:', JSON.stringify(response.response, null, 2))
    }

    // Surface CSE quota warning if any CSE-backed tool call was near the daily limit
    const CSE_TOOLS = new Set(['searchGroningerarchieven', 'searchInventories', 'searchPoparchiefGroningen', 'searchFilmbankGroningen', 'googleSearch'])
    const cseWarning = toolCalls.some(t => CSE_TOOLS.has(t.name) && t.result?.nearDailyLimit)

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
