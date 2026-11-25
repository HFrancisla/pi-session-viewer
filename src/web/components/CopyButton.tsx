import { Check, Copy, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'

type CopyStatus = 'success' | 'error'
type Feedback = { owner: string; text: string; status: CopyStatus }

const CopyContext = createContext<{
  feedback: Feedback | null
  copy: (owner: string, text: string) => Promise<void>
  clear: (owner: string) => void
} | null>(null)

/** One feedback channel for the whole workspace; only the latest copy wins. */
export function CopyFeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const pending = useRef<{ owner: string; text: string } | null>(null)

  const clear = useCallback((owner: string) => {
    if (pending.current?.owner === owner) pending.current = null
    setFeedback(current => current?.owner === owner ? null : current)
  }, [])

  const copy = useCallback(async (owner: string, text: string) => {
    const request = { owner, text }
    pending.current = request
    setFeedback(null)
    let status: CopyStatus = 'success'
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      status = 'error'
    }
    if (pending.current !== request) return
    pending.current = null
    setFeedback({ owner, text, status })
  }, [])

  useEffect(() => {
    if (!feedback) return
    const timeout = window.setTimeout(() => setFeedback(null), 2400)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  return (
    <CopyContext.Provider value={{ feedback, copy, clear }}>
      {children}
      {feedback && (
        <span role="status" className={`copy-status-toast${feedback.status === 'error' ? ' is-error' : ''}`}>
          {feedback.status === 'success' ? t.common.copiedTooltip : t.common.copyFailed}
        </span>
      )}
    </CopyContext.Provider>
  )
}

interface CopyButtonProps {
  text: string
  label?: string
  disabled?: boolean
  detail?: string
  className?: string
}

/** All copy actions use the same icon, accessible name and visible feedback. */
export function CopyButton({ text, label, disabled, detail, className = '' }: CopyButtonProps) {
  const { t } = useI18n()
  const owner = useId()
  const context = useContext(CopyContext)
  if (!context) throw new Error('CopyButton requires CopyFeedbackProvider')
  const { feedback, copy, clear } = context
  useEffect(() => () => clear(owner), [clear, owner, text])
  const status = feedback?.owner === owner && feedback.text === text ? feedback.status : 'idle'
  const name = label ?? t.common.copy
  const Icon = status === 'success' ? Check : status === 'error' ? X : Copy
  return (
    <button
      type="button"
      className={`icon-button copy-button ${className}`.trim()}
      data-copy-status={status}
      onClick={() => void copy(owner, text)}
      disabled={disabled}
      title={detail ? `${name}\n${detail}` : name}
      aria-label={name}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  )
}
