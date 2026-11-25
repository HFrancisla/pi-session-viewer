import { ArrowRight, Bot, ChevronDown } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SubagentReference } from '../../core/types'
import { useI18n } from '../i18n'

interface Props {
  eventId: string
  references: SubagentReference[]
  onSelect: () => void
  onOpen: (reference: SubagentReference) => void
}

export function SubagentControl({ eventId, references, onSelect, onOpen }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const multiple = references.length > 1
  const id = 'subagent-options-' + eventId

  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return
    const button = trigger.current
    const menu = popup.current
    const anchor = button.getBoundingClientRect()
    const gap = 4
    const margin = 8
    const below = Math.max(0, innerHeight - anchor.bottom - gap - margin)
    const above = Math.max(0, anchor.top - gap - margin)
    const useBelow = below >= menu.offsetHeight || below >= above
    menu.style.maxHeight = Math.min(innerHeight / 2, useBelow ? below : above) + 'px'
    const left = Math.max(margin, Math.min(anchor.left, innerWidth - menu.offsetWidth - margin))
    const top = useBelow ? anchor.bottom + gap : anchor.top - gap - menu.offsetHeight
    menu.style.left = left + 'px'
    menu.style.top = top + 'px'

    const outside = (event: Event) => {
      if (event.target instanceof Node && !button.contains(event.target) && !menu.contains(event.target)) setOpen(false)
    }
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menu.contains(event.target)) return
      setOpen(false)
    }
    const resize = () => setOpen(false)
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      button.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
    }
  }, [open])

  if (!references.length) return null

  return (
    <span className="event-subagent-control">
      <button
        ref={trigger}
        type="button"
        className="event-subagent-tag"
        aria-label={multiple ? `${t.timeline.openSubagent} (${references.length})` : `${t.timeline.openSubagent}: ${references[0].agentName ?? t.timeline.subagentTag}`}
        aria-expanded={multiple ? open : undefined}
        aria-controls={multiple && open ? id : undefined}
        title={multiple ? t.timeline.chooseSubagent : t.timeline.openSubagent}
        onClick={(event) => {
          event.stopPropagation()
          onSelect()
          if (multiple) setOpen(value => !value)
          else onOpen(references[0])
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (open && event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault()
            popup.current?.querySelector('button')?.focus()
          }
        }}
      >
        <Bot size={12} aria-hidden="true" />
        <span>{multiple ? `${references.length} ${t.timeline.subagentTag}` : references[0].agentName ?? t.timeline.subagentTag}</span>
        <span className="subagent-tag-arrow" aria-hidden="true">{multiple ? <ChevronDown size={12} /> : <ArrowRight size={12} />}</span>
      </button>
      {multiple && open && createPortal(
        <div
          ref={popup}
          id={id}
          className="event-subagent-options"
          role="group"
          aria-label={t.timeline.chooseSubagent}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
          onKeyDown={event => {
            event.stopPropagation()
            const buttons = Array.from(event.currentTarget.querySelectorAll('button'))
            const first = buttons[0]
            const last = buttons.at(-1)
            if (event.key === 'Tab' && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
              event.preventDefault()
              trigger.current?.focus({ preventScroll: true })
              setOpen(false)
            }
          }}
        >
          {references.map((reference, index) => {
            const name = reference.agentName ?? `${t.timeline.subagentTag} ${index + 1}`
            return (
              <button
                key={reference.targetFile}
                type="button"
                className="event-subagent-choice"
                aria-label={`${t.timeline.openSubagent}: ${name}`}
                title={reference.sessionName ?? name}
                onClick={() => {
                  trigger.current?.focus({ preventScroll: true })
                  setOpen(false)
                  onSelect()
                  onOpen(reference)
                }}
              >
                <Bot size={12} aria-hidden="true" />
                <span>{name}</span>
                <span className="subagent-tag-arrow" aria-hidden="true"><ArrowRight size={12} /></span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </span>
  )
}
