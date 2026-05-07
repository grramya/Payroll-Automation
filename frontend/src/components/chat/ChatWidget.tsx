import {
  useRef, useState, useEffect, useCallback,
  type KeyboardEvent, type ChangeEvent,
} from 'react'
import ChatMessage, { type ChatMsg } from './ChatMessage'

const WELCOME: ChatMsg = {
  role: 'assistant',
  content:
    "Hello! I'm your **AI Financial Analytics Assistant**.\n\n" +
    "I can help you:\n" +
    "- Analyze financial reports and KPIs\n" +
    "- Generate charts and dashboards\n" +
    "- Interpret trends, variances, and anomalies\n" +
    "- Provide executive-grade reporting insights\n\n" +
    "You can paste financial data or report text into the context box below to ground my analysis. How can I help you today?",
}

function getToken(): string {
  return (
    localStorage.getItem('pje_token') ||
    sessionStorage.getItem('pje_token') ||
    ''
  )
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME])
  const [input, setInput] = useState('')
  const [context, setContext] = useState('')
  const [showContext, setShowContext] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setError(null)

    const userMsg: ChatMsg = { role: 'user', content: text }
    const history = [...messages, userMsg]
    setMessages(history)
    setLoading(true)

    // Append empty assistant slot that we'll stream into
    const assistantIdx = history.length
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, content: m.content })),
          context: context.trim() || null,
        }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.detail ?? `HTTP ${res.status}`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Process all complete SSE lines from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') { setLoading(false); return }
          try {
            const parsed = JSON.parse(payload)
            if (parsed.error) {
              setError(parsed.error)
              setLoading(false)
              return
            }
            if (parsed.text) {
              setMessages(prev => {
                const next = [...prev]
                next[assistantIdx] = {
                  ...next[assistantIdx],
                  content: next[assistantIdx].content + parsed.text,
                }
                return next
              })
            }
          } catch { /* partial chunk, skip */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message ?? 'Failed to reach the chat service.')
      }
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, context])

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const clearChat = () => {
    abortRef.current?.abort()
    setMessages([WELCOME])
    setError(null)
    setLoading(false)
    setInput('')
  }

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen(v => !v)}
        title={open ? 'Close AI Assistant' : 'Open AI Assistant'}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: 'var(--p)',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(64,15,97,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1400,
          transition: 'transform 0.15s, background 0.15s',
          fontSize: 22,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--p-dark)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'var(--p)')}
      >
        {open ? '✕' : '💬'}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: 86,
          right: 24,
          width: 420,
          height: 620,
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 8px 40px rgba(64,15,97,0.18), 0 2px 8px rgba(0,0,0,0.12)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1399,
          overflow: 'hidden',
          border: '1px solid rgba(64,15,97,0.12)',
        }}>

          {/* Header */}
          <div style={{
            background: 'var(--p)',
            color: '#fff',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700,
            }}>
              AI
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>Financial AI Assistant</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>Analytics &amp; Reporting</div>
            </div>
            <button
              onClick={clearChat}
              title="New conversation"
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none',
                color: '#fff', borderRadius: 6, padding: '3px 8px',
                fontSize: 11, cursor: 'pointer',
              }}
            >
              New chat
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px 14px 6px',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {messages.map((msg, i) => (
              <ChatMessage key={i} msg={msg} />
            ))}
            {loading && messages[messages.length - 1]?.content === '' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', color: 'var(--muted)', fontSize: 12 }}>
                <span style={{ display: 'flex', gap: 3 }}>
                  {[0, 1, 2].map(i => (
                    <span key={i} style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: 'var(--p)', display: 'inline-block',
                      animation: `chatBounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </span>
                Thinking…
              </div>
            )}
            {error && (
              <div style={{
                background: 'var(--err-bg)', color: 'var(--err)',
                padding: '8px 12px', borderRadius: 8, fontSize: 12, margin: '4px 0',
              }}>
                {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Context toggle */}
          <div style={{ padding: '0 14px', flexShrink: 0 }}>
            <button
              onClick={() => setShowContext(v => !v)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--p)', fontSize: 11, padding: '4px 0',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <span style={{ fontSize: 13 }}>{showContext ? '▾' : '▸'}</span>
              {context.trim() ? '✓ Context attached' : 'Attach financial data / context'}
            </button>
            {showContext && (
              <textarea
                value={context}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setContext(e.target.value)}
                placeholder="Paste CSV, table, or financial report text here…"
                rows={4}
                style={{
                  width: '100%', resize: 'vertical', fontSize: 12,
                  padding: '8px 10px', borderRadius: 8,
                  border: '1px solid var(--border)',
                  outline: 'none', fontFamily: 'monospace',
                  background: '#fafafa', color: 'var(--text)',
                  boxSizing: 'border-box', marginBottom: 6,
                }}
              />
            )}
          </div>

          {/* Input row */}
          <div style={{
            padding: '8px 14px 14px',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
            flexShrink: 0,
            borderTop: '1px solid var(--border)',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about your financial data… (Enter to send)"
              rows={2}
              disabled={loading}
              style={{
                flex: 1,
                resize: 'none',
                fontSize: 13,
                padding: '9px 12px',
                borderRadius: 10,
                border: '1.5px solid var(--border)',
                outline: 'none',
                fontFamily: 'inherit',
                background: loading ? '#f5f5f5' : '#fff',
                color: 'var(--text)',
                transition: 'border-color 0.15s',
                boxSizing: 'border-box',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--p)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              style={{
                background: 'var(--p)',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                padding: '0 16px',
                height: 44,
                cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                opacity: input.trim() && !loading ? 1 : 0.5,
                fontSize: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'opacity 0.15s',
              }}
              title="Send (Enter)"
            >
              ↑
            </button>
          </div>
        </div>
      )}

      {/* Bounce animation for thinking dots */}
      <style>{`
        @keyframes chatBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-5px); }
        }
      `}</style>
    </>
  )
}
