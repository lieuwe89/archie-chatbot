// server/routes/archie.js
import express from 'express'
import { initializeLLMProvider, getProviderName } from '../llm-factory.js'
import { getOrCreate, update } from '../archieSession.js'
import { toolDeclarations, executeTool } from '../archieTools.js'
import { retrieve } from '../archieRag.js'

const router = express.Router()

let llmProvider = null

export async function reinitializeLLMProvider() {
  try {
    const providerName = getProviderName(process.env.LLM_PROVIDER || 'gemini')
    const apiKeyEnvVar = `${providerName.toUpperCase()}_API_KEY`
    const apiKey = process.env[apiKeyEnvVar]

    if (!apiKey) {
      console.warn(`[Archie] ${apiKeyEnvVar} not configured`)
      llmProvider = null
      return
    }

    llmProvider = await initializeLLMProvider(providerName, apiKey)
    console.log(`[Archie] Initialized ${providerName} provider`)
  } catch (error) {
    console.error('[Archie] Error initializing LLM provider:', error.message)
    llmProvider = null
  }
}

// Delay initialization to ensure env vars are loaded
setTimeout(reinitializeLLMProvider, 100)

const SYSTEM_INSTRUCTION_BASE = `You are Archie, the digital archivist for the Groninger Archieven.
You help users — both casual visitors and serious researchers — find genealogical records and archival materials.
Use the provided search tools. Search multiple times with different parameters if needed to answer the question thoroughly.
Think step by step. When results are sparse, try alternative spellings or broader queries.
Always share direct URLs to records when available. When a record has a Handle persistent identifier (hdl.handle.net), prefer that over other URLs — Handle links are permanent and citable.
Respond in the same language the user uses.

Tool selection priority for catalog/inventory questions:
- searchArchieCatalog is a local mirror of the Groninger Archieven finding aids (EAD, harvested via OAI-PMH). PREFER this tool first whenever the user asks about a specific fonds, collection, archive number, family archive, parish, institution, or any historical body that may have an inventory. It returns structured data: archive number, title, creator, date range, and persistent handle URL. Free and instant. Use boolean operators (OR, AND, NOT, NEAR) and prefix wildcards (e.g. "godlin*") for richer queries.
- For personal name queries: ALWAYS search both:
  1. searchArchieCatalog first with the surname (e.g., "van Rasquert", "Ewsum") to find family archives and document collections.
  2. searchAlleGroningers for genealogical records (birth/marriage/death). If the full name yields no results, try the surname alone or with fuzzy: true.
- Only fall back to searchGroningerarchieven (Tavily web search) when searchArchieCatalog returns no relevant hits, or when the question is about news, opening hours, visitor info, or anything outside the catalog.

Web search tools are powered by Tavily and are strictly limited to the following domains: groningerarchieven.nl, poparchiefgroningen.nl, filmbankgroningen.nl, groningerkentekens.nl. Do not claim to have searched or found information from any other website.
- searchGroningerarchieven searches groningerarchieven.nl for archive collections, historical persons, locations, events, opening hours, and visitor information.
- searchPoparchiefGroningen searches poparchiefgroningen.nl for pop music, bands, venues, and cultural events in Groningen.
- searchFilmbankGroningen searches filmbankgroningen.nl for films, videos, cinema, and moving image collections related to Groningen.
- searchGroningerkentekens searches groningerkentekens.nl for historical vehicle licence plates (kentekens) from the province of Groningen.
- searchOpenArch is for genealogical data across the Netherlands.
- For genealogical searches (AlleGroningers, OpenArch), if an exact name search yields no results, try setting fuzzy: true or use wildcards yourself (e.g. "Pieters*" or "Vri?s").
- If a specific name search (e.g. "Full Name") yields no results, try broader variations (e.g. "Last Name") or split the name into separate keywords.
- If no results answer the question, say clearly you could not find that information. Do NOT fall back on general knowledge or other sources.
- Always cite the exact URL(s) where you found the answer.
- Research guides (onderzoeksgidsen) are available in the internal knowledge base, but if you cannot find what you need there, feel free to use searchGroningerarchieven.
- When the user asks about upcoming or future activities, events, or programmes, only show items whose date is strictly after today's date. Never list activities that have already taken place.`

router.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body
  if (!message || !sessionId) {
    return res.status(400).json({ error: 'message and sessionId are required' })
  }
  if (!llmProvider) {
    const provider = getProviderName(process.env.LLM_PROVIDER || 'gemini')
    return res.status(503).json({ error: `${provider.toUpperCase()}_API_KEY not configured` })
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

    // Convert session.contents to normalized message format
    const messages = (session.contents || []).map(content => {
      if (typeof content === 'string') {
        return { role: 'user', content }
      }
      if (content.role) {
        return content
      }
      return { role: 'user', content: JSON.stringify(content) }
    })

    // Add current user message
    messages.push({ role: 'user', content: message })

    // Get initial response from provider
    let response = await llmProvider.chat(messages, toolDeclarations, systemInstruction)
    let reply = response.text || ''
    const allToolCalls = []

    // Tool execution loop
    let currentMessages = [...messages]
    while (response.toolCalls?.length > 0) {
      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        response.toolCalls.map(async tc => ({
          name: tc.name,
          args: tc.args,
          toolUseId: tc.toolUseId,
          result: await executeTool(tc.name, tc.args)
        }))
      )

      // Track all tool calls for response
      allToolCalls.push(...toolResults)

      // Add assistant response to messages (with tool_calls if any)
      const assistantMsg = {
        role: 'assistant',
        content: reply
      }
      if (llmProvider.lastAssistantMessage?.tool_calls?.length > 0) {
        assistantMsg.tool_calls = llmProvider.lastAssistantMessage.tool_calls
      }
      currentMessages.push(assistantMsg)

      // Add tool results to messages
      for (const toolResult of toolResults) {
        currentMessages.push(llmProvider.formatToolResponse(toolResult.name, toolResult.result))
      }

      // Get next response
      response = await llmProvider.chat(currentMessages, toolDeclarations, systemInstruction)
      reply = response.text || ''
    }

    // Surface Tavily quota warning if any Tavily-backed tool call was near the daily limit
    const TAVILY_TOOLS = new Set([
      'searchGroningerarchieven',
      'searchPoparchiefGroningen',
      'searchFilmbankGroningen',
      'searchGroningerkentekens'
    ])
    const cseWarning = allToolCalls.some(t => TAVILY_TOOLS.has(t.name) && t.result?.nearDailyLimit)

    // Persist updated messages
    const normalizedMessages = currentMessages.map(m => ({
      role: m.role,
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
    }))
    update(sessionId, normalizedMessages)

    res.json({ reply, toolCalls: allToolCalls.map(tc => ({ name: tc.name, args: tc.args, result: tc.result })), cseWarning, sessionId })
  } catch (error) {
    console.error('Archie Chat Error:', error)
    res.status(500).json({ error: 'Internal Server Error', details: error.message })
  }
})

export default router
