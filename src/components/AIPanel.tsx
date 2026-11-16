import { useEffect, useRef, useState } from 'react'
import { Sparkles, X, Send, ListChecks, WandSparkles, SpellCheck, PenLine, FileText, CopyPlus } from 'lucide-react'
import { api, type Doc } from '../api'

type Message = { role: 'user' | 'assistant' | 'error'; text: string }

const QUICK_ACTIONS = [
  { id: 'summarize', label: 'Summarize', icon: ListChecks },
  { id: 'improve', label: 'Improve writing', icon: WandSparkles },
  { id: 'grammar', label: 'Fix grammar', icon: SpellCheck },
  { id: 'continue', label: 'Continue writing', icon: PenLine },
] as const

type Props = {
  doc: Doc
  canEdit: boolean
  // Saves any pending edits so the AI sees the latest version of the document.
  flushSave: () => Promise<void>
  onInsert: (text: string) => void
  onClose: () => void
}

export function AIPanel({ doc, canEdit, flushSave, onInsert, onClose }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.aiStatus().then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false))
  }, [])

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages])

  async function ask(body: { action?: string; question?: string }, label: string) {
    if (busy || !enabled) return
    setBusy(true)
    setMessages((m) => [...m, { role: 'user', text: label }])
    try {
      await flushSave()
      const { text } = await api.askAI(doc.id, body)
      setMessages((m) => [...m, { role: 'assistant', text }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'error', text: (e as Error).message }])
    } finally {
      setBusy(false)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q) return
    setQuestion('')
    ask({ question: q }, q)
  }

  return (
    <aside className="ai-panel" aria-label="AI assistant">
      <div className="ai-header">
        <div className="ai-title">
          <div className="ai-icon"><Sparkles size={18} /></div>
          <div>
            <strong>AI Assistant</strong>
            <small>Powered by Gemini</small>
          </div>
        </div>
        <button className="ai-close" onClick={onClose} aria-label="Close AI assistant"><X size={17} /></button>
      </div>

      {enabled === false && (
        <div className="ai-status">
          <span className="status-dot" /> AI is not configured on this server (set GEMINI_API_KEY). Everything else works without it.
        </div>
      )}

      {messages.length === 0 ? (
        <div className="ai-welcome">
          <div className="ai-welcome-icon"><Sparkles size={22} /></div>
          <h3>How can I help?</h3>
          <p>Summarize, polish, or extend this document, or ask a question about it.</p>
        </div>
      ) : (
        <div className="chat-messages">
          {messages.map((m, i) => (
            <div key={i} className={`chat-message ${m.role === 'user' ? 'user' : 'assistant'} ${m.role === 'error' ? 'error' : ''}`}>
              <span>{m.role === 'user' ? 'You' : m.role === 'error' ? 'Error' : 'Assistant'}</span>
              <p>{m.text}</p>
              {m.role === 'assistant' && canEdit && (
                <button className="insert-button" onClick={() => onInsert(m.text)}>
                  <CopyPlus size={12} /> Insert into document
                </button>
              )}
            </div>
          ))}
          {busy && <div className="chat-message assistant"><span>Assistant</span><p className="typing">Thinking…</p></div>}
          <div ref={endRef} />
        </div>
      )}

      <div className="quick-actions">
        {QUICK_ACTIONS.map(({ id, label, icon: Icon }) => (
          <button key={id} disabled={busy || !enabled} onClick={() => ask({ action: id }, label)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      <div className="ai-context">
        <FileText size={13} /> <span>Using: {doc.title}</span>
      </div>

      <form className="ai-input-area" onSubmit={submit}>
        <textarea
          placeholder={enabled ? 'Ask about this document…' : 'AI assistant unavailable'}
          value={question}
          disabled={!enabled}
          maxLength={2000}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e)
          }}
        />
        <button type="submit" disabled={busy || !enabled || !question.trim()} aria-label="Send"><Send size={15} /></button>
      </form>
      <p className="ai-disclaimer">AI output can be wrong. Review it before inserting.</p>
    </aside>
  )
}
