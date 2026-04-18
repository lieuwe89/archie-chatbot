import OpenAI from 'openai'
import { LLMProvider } from './base.js'

export class OpenRouterProvider extends LLMProvider {
  constructor(apiKey) {
    super(apiKey)
    this.client = null
    this.model = 'openai/gpt-3.5-turbo'
    this.messageHistory = []
  }

  async initialize() {
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY not configured')
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://archie-chatbot.local',
        'X-Title': 'Archie Chatbot'
      }
    })
    this.initialized = true
  }

  async chat(messages, toolDeclarations, systemInstruction) {
    if (!this.initialized) throw new Error('Provider not initialized')
    if (!this.client) throw new Error('OpenRouter client not available')

    // Convert normalized messages to OpenAI format
    const openaiMessages = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }))

    // Add system instruction as first message if present
    if (systemInstruction) {
      openaiMessages.unshift({
        role: 'system',
        content: systemInstruction
      })
    }

    this.messageHistory = openaiMessages

    // Convert tool declarations from Gemini to OpenAI format
    const tools = toolDeclarations?.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: {
          type: 'object',
          properties: tool.parameters?.properties || {},
          required: tool.parameters?.required || []
        }
      }
    })) || []

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      max_tokens: 2048
    })

    return this.parseResponse(response)
  }

  async continueChat(toolResults, toolDeclarations, systemInstruction) {
    if (!this.client) throw new Error('OpenRouter client not available')

    // Add previous assistant message and tool results
    if (this.lastAssistantMessage) {
      this.messageHistory.push(this.lastAssistantMessage)
    }

    for (const tr of toolResults) {
      this.messageHistory.push({
        role: 'tool',
        tool_call_id: tr.toolCallId || tr.name,
        content: JSON.stringify(tr.result)
      })
    }

    // Convert tool declarations
    const tools = toolDeclarations?.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: {
          type: 'object',
          properties: tool.parameters?.properties || {},
          required: tool.parameters?.required || []
        }
      }
    })) || []

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: this.messageHistory,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      max_tokens: 2048
    })

    return this.parseResponse(response)
  }

  parseResponse(response) {
    let text = ''
    let toolCalls = []

    const choice = response.choices[0]
    const message = choice.message

    if (message.content) {
      text = message.content
    }

    // Store for continuation
    this.lastAssistantMessage = {
      role: 'assistant',
      content: message.content || '',
      tool_calls: message.tool_calls || []
    }

    if (message.tool_calls) {
      toolCalls = message.tool_calls.map(tc => ({
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments || '{}'),
        toolCallId: tc.id
      }))
    }

    return { text, toolCalls: toolCalls.map(tc => ({ name: tc.name, args: tc.args, toolCallId: tc.toolCallId })) }
  }

  formatToolResponse(toolName, result) {
    return {
      role: 'tool',
      tool_call_id: toolName,
      content: JSON.stringify(result)
    }
  }
}
