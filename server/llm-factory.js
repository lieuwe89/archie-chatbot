import { GeminiProvider } from './providers/gemini.js'
import { ClaudeProvider } from './providers/claude.js'
import { OpenRouterProvider } from './providers/openrouter.js'

export async function initializeLLMProvider(providerName, apiKey) {
  const normalizedName = (providerName || 'gemini').toLowerCase()

  let provider
  switch (normalizedName) {
    case 'gemini':
      provider = new GeminiProvider(apiKey)
      break
    case 'claude':
      provider = new ClaudeProvider(apiKey)
      break
    case 'openrouter':
      provider = new OpenRouterProvider(apiKey)
      break
    default:
      throw new Error(`Unknown LLM provider: ${providerName}. Supported: gemini, claude, openrouter`)
  }

  await provider.initialize()
  return provider
}

export function getProviderName(providerName) {
  const normalized = (providerName || 'gemini').toLowerCase()
  const validProviders = ['gemini', 'claude', 'openrouter']
  if (!validProviders.includes(normalized)) {
    throw new Error(`Unknown provider: ${providerName}`)
  }
  return normalized
}
