import type { KeyboardEvent } from 'react'

export interface TabOption<Value extends string> {
  value: Value
  label: string
  accessibleLabel?: string
  title?: string
}

interface TabListProps<Value extends string> {
  items: readonly TabOption<Value>[]
  value: Value
  onChange: (value: Value) => void
  label: string
  idPrefix: string
  panelId: string
}

export function TabList<Value extends string>({ items, value, onChange, label, idPrefix, panelId }: TabListProps<Value>) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next].focus()
    onChange(items[next].value)
  }

  return (
    <div className="tab-list" role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
      {items.map((item) => (
        <button
          key={item.value}
          id={`${idPrefix}-${item.value}`}
          type="button"
          role="tab"
          aria-label={item.accessibleLabel}
          aria-selected={item.value === value}
          aria-controls={panelId}
          tabIndex={item.value === value ? 0 : -1}
          title={item.title}
          onClick={() => onChange(item.value)}
        >{item.label}</button>
      ))}
    </div>
  )
}
