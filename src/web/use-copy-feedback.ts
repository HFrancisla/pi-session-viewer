import { useEffect, useState } from 'react'

/**
 * Use the native clipboard when available, then fall back to a temporary
 * textarea for browsers that deny the API on a local (non-HTTPS) origin.
 */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Try the legacy clipboard path before reporting a failure.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable')
  } finally {
    textarea.remove()
  }
}

export function useCopyFeedback() {
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  useEffect(() => {
    if (status === 'idle') return
    const timeout = window.setTimeout(() => setStatus('idle'), 2400)
    return () => window.clearTimeout(timeout)
  }, [status])

  const copy = async (text: string): Promise<void> => {
    try {
      await copyText(text)
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  return { status, copy }
}
