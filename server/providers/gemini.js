import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai'
import { LLMProvider } from './base.js'

export class GeminiProvider extends LLMProvider {
  constructor(apiKey) {
    super(apiKey)
    this.client = null
    this.model = 'gemini-2.5-flash'
    this.lastChat = null
  }

  async initialize() {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY not configured')
    this.client = new GoogleGenerativeAI(this.apiKey)
    this.initialized = true
  }

  async chat(messages, toolDeclarations, systemInstruction) {
    if (!this.initialized) throw new Error('Provider not initialized')
    if (!this.client) throw new Error('Gemini client not available')

    const model = this.client.getGenerativeModel({
      model: this.model,
      tools: toolDeclarations?.length > 0 ? [{ functionDeclarations: toolDeclarations }] : undefined,
      systemInstruction,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
      ]
    })

    // Convert normalized messages to Gemini format
    const history = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }))

    const chat = model.startChat({ history })
    this.lastChat = chat
    const userMessage = messages[messages.length - 1]?.content || ''
    const response = await chat.sendMessage(userMessage)

    // Check for blocked content
    if (response.response.promptFeedback?.blockReason) {
      throw new Error(`Blocked: ${response.response.promptFeedback.blockReason}`)
    }

    return this.parseResponse(response)
  }

  async continueChat(toolResults) {
    if (!this.lastChat) throw new Error('No active chat session')

    const functionResponses = toolResults.map(tr => ({
      functionResponse: {
        name: tr.name,
        response: { content: JSON.stringify(tr.result) }
      }
    }))

    const response = await this.lastChat.sendMessage(functionResponses)
    return this.parseResponse(response)
  }

  parseResponse(response) {
    let text = ''
    let toolCalls = []
    const finishReason = response.response.candidates?.[0]?.finishReason

    // Extract text
    try {
      text = response.response.text()
    } catch (e) {
      if (finishReason === 'SAFETY') {
        text = 'Content blocked by safety filter'
      } else if (finishReason === 'RECITATION') {
        text = 'Response blocked due to copyright concerns'
      } else if (finishReason !== 'STOP') {
        text = `No response generated (Reason: ${finishReason})`
      }
    }

    // Extract tool calls
    const fns = response.response.functionCalls()
    if (fns && fns.length > 0) {
      toolCalls = fns.map(fn => ({ name: fn.name, args: fn.args }))
    }

    return { text, toolCalls }
  }

  formatToolResponse(toolName, result) {
    return {
      role: 'tool',
      content: JSON.stringify(result)
    }
  }
}
