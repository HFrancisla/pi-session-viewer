import type { ReactNode } from 'react'

interface PanelHeaderProps {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
}

export function PanelHeader({ title, subtitle, action, className = '' }: PanelHeaderProps) {
  return (
    <div className={`panel-heading ${className}`.trim()}>
      <div className="panel-heading-copy">
        <h2>{title}</h2>
        {subtitle != null && <p>{subtitle}</p>}
      </div>
      {action != null && <div className="panel-heading-actions">{action}</div>}
    </div>
  )
}
