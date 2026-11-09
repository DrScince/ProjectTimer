import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function base(props: IconProps) {
  return {
    viewBox: '0 0 24 24',
    width: '1.1em',
    height: '1.1em',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    focusable: false as const,
    ...props
  }
}

export function IconPause(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconLogin(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M21 3v18" />
    </svg>
  )
}

export function IconLogout(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 7l5 5-5 5" />
      <path d="M19 12H9" />
      <path d="M3 3v18" />
    </svg>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

export function IconUndo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 2.6-6.4L3 9" />
    </svg>
  )
}

export function IconSplit(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M8 7.5L11 16" />
      <path d="M16 7.5L13 16" />
    </svg>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

export function IconX(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  )
}

export function IconEdit(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}
