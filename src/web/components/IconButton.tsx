import type { ButtonHTMLAttributes, ComponentType } from 'react'

interface IconProps {
  size?: number
  className?: string
  'aria-hidden'?: boolean
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type' | 'aria-label'> {
  icon: ComponentType<IconProps>
  label: string
  iconSize?: number
  iconClassName?: string
}

export function IconButton({
  icon: Icon,
  label,
  iconSize = 16,
  iconClassName,
  className = '',
  title = label,
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type="button"
      className={`icon-button ${className}`.trim()}
      title={title}
      aria-label={label}
    >
      <Icon size={iconSize} className={iconClassName} aria-hidden={true} />
    </button>
  )
}
