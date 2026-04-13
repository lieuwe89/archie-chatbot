// src/components/ArchieInterface.jsx
import React, { useState, useEffect, useRef } from 'react'
import { api } from '../utils/api'
import { History, ExternalLink, Loader2, Send, ChevronDown, ChevronUp, Search } from 'lucide-react'

function getOrCreateSessionId() {
  let id = sessionStorage.getItem('archie-session-id')
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem('archie-session-id', id)
  }
  return id
}

const ArchieInterface = () => {
  const [messages, setMessages] = useState([{
    type: 'assistant',
    content: "Hello! I'm Archie, your archive assistant. I can help you find people in AlleGroningers, photos in the Beeldbank, or historical collections in the Groningen Archives. What are you looking for today?",
    timestamp: new Date(),
    toolCalls: []
  }])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const sessionIdRef = useRef(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    sessionIdRef.current = getOrCreateSessionId()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage = input
    setInput('')
    setMessages(prev => [...prev, {
      type: 'user',
      content: userMessage,
      timestamp: new Date(),
      toolCalls: []
    }])
    setIsLoading(true)

    try {
      const response = await api.archie.chat(userMessage, sessionIdRef.current)
      setMessages(prev => [...prev, {
        type: 'assistant',
        content: response.reply || 'Geen antwoord ontvangen.',
        timestamp: new Date(),
        toolCalls: response.toolCalls || []
      }])
    } catch (error) {
      console.error('Archie Chat Error:', error)
      setMessages(prev => [...prev, {
        type: 'assistant',
        content: "I'm sorry, I encountered an error. Please try again later.",
        timestamp: new Date(),
        toolCalls: []
      }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg mr-3">
          <History className="w-6 h-6 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-none">Archie</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Groningen Archive Assistant</p>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] sm:max-w-2xl rounded-2xl p-4 shadow-sm ${
              msg.type === 'user'
                ? 'bg-blue-600 text-white rounded-br-none'
                : 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-800 rounded-bl-none'
            }`}>
              {msg.toolCalls?.length > 0 && <ToolCallList toolCalls={msg.toolCalls} />}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              <p className="text-[10px] mt-2 opacity-50 text-right">
                {msg.timestamp.toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl rounded-bl-none p-4 shadow-sm flex items-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
              <span className="text-sm text-gray-500">Archie is searching the vaults…</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about a person, place, or historical topic…"
            className="w-full pl-4 pr-12 py-3 bg-gray-100 dark:bg-gray-800 border-none rounded-xl focus:ring-2 focus:ring-amber-500 dark:text-white"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </form>
        <p className="text-[10px] text-center text-gray-400 mt-2">
          Tip: Try "What is the oldest baptism in the Akerk?" or a family name.
        </p>
      </div>
    </div>
  )
}

const ToolCallList = ({ toolCalls }) => {
  const [expanded, setExpanded] = useState(false)

  const labelFor = (name) => ({
    searchAlleGroningers: 'Searched AlleGroningers',
    searchBeeldbank: 'Searched Beeldbank',
    searchInventories: 'Searched inventories'
  }[name] || `Called ${name}`)

  return (
    <div className="mb-3 border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Search className="w-3 h-3" />
          {toolCalls.length} search{toolCalls.length !== 1 ? 'es' : ''} performed
        </span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="divide-y divide-amber-100 dark:divide-amber-900/30">
          {toolCalls.map((tc, i) => (
            <div key={i} className="px-3 py-2 bg-white dark:bg-gray-800/50">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{labelFor(tc.name)}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
                {JSON.stringify(tc.args)}
              </p>
              {Array.isArray(tc.result?.records) && tc.result.records.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {tc.result.records.map((item, j) => (
                    <div key={j} className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-600 dark:text-gray-400 truncate pr-2">{item.title}</span>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 shrink-0">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ArchieInterface
