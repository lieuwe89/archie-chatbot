// Base class for all LLM providers
export class LLMProvider {
  constructor(apiKey) {
    if (!apiKey) throw new Error('API key is required')
    this.apiKey = apiKey
    this.initialized = false
  }

  async initialize() {
    throw new Error('initialize() must be implemented by subclass')
  }

  async chat(messages, tools, systemInstruction) {
    throw new Error('chat() must be implemented by subclass')
  }

  parseResponse(response) {
    throw new Error('parseResponse() must be implemented by subclass')
  }

  formatToolResponse(toolName, result) {
    throw new Error('formatToolResponse() must be implemented by subclass')
  }

  // Normalize different message formats to common structure
  toNormalizedMessage(message) {
    return {
      role: message.role,
      content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
    }
  }
}
