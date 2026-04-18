import Anthropic from '@anthropic-ai/sdk'
import { LLMProvider } from './base.js'

export class ClaudeProvider extends LLMProvider {
  constructor(apiKey) {
    super(apiKey)
    this.client = null
    this.model = 'claude-3-5-sonnet-20241022'
    this.messageHistory = []
  }

  async initialize() {
    if (!this.apiKey) throw new Error('CLAUDE_API_KEY not configured')
    this.client = new Anthropic({ apiKey: this.apiKey })
    this.initialized = true
  }

  async chat(messages, toolDeclarations, systemInstruction) {
    if (!this.initialized) throw new Error('Provider not initialized')
    if (!this.client) throw new Error('Claude client not available')

    // Convert normalized messages to Claude format
    const claudeMessages = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }))

    // Store for continuation
    this.messageHistory = claudeMessages

    // Convert tool declarations from Gemini to Claude format
    const tools = toolDeclarations?.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: {
        type: 'object',
        properties: tool.parameters?.properties || {},
        required: tool.parameters?.required || []
      }
    })) || []

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemInstruction,
      tools: tools.length > 0 ? tools : undefined,
      messages: claudeMessages
    })

    return this.parseResponse(response)
  }

  async continueChat(toolResults, toolDeclarations, systemInstruction) {
    if (!this.client) throw new Error('Claude client not available')

    // Add previous assistant response
    const assistantContent = this.lastAssistantContent
    if (assistantContent) {
      this.messageHistory.push({
        role: 'assistant',
        content: assistantContent
      })
    }

    // Add tool results
    const toolResultContent = toolResults.map(tr => ({
      type: 'tool_result',
      tool_use_id: tr.toolUseId || tr.name,
      content: JSON.stringify(tr.result)
    }))

    this.messageHistory.push({
      role: 'user',
      content: toolResultContent
    })

    // Convert tool declarations
    const tools = toolDeclarations?.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: {
        type: 'object',
        properties: tool.parameters?.properties || {},
        required: tool.parameters?.required || []
      }
    })) || []

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemInstruction,
      tools: tools.length > 0 ? tools : undefined,
      messages: this.messageHistory
    })

    return this.parseResponse(response)
  }

  parseResponse(response) {
    let text = ''
    let toolCalls = []
    const assistantContent = []

    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          name: block.name,
          args: block.input,
          toolUseId: block.id
        })
        assistantContent.push(block)
      } else {
        assistantContent.push(block)
      }
    }

    this.lastAssistantContent = assistantContent

    return { text, toolCalls: toolCalls.map(tc => ({ name: tc.name, args: tc.args })) }
  }

  formatToolResponse(toolName, result) {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolName,
          content: JSON.stringify(result)
        }
      ]
    }
  }
}
