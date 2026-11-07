// React 18's DOM typings predate the Popover API.
import 'react'

declare module 'react' {
  interface HTMLAttributes<T> {
    popover?: 'auto' | 'manual' | 'hint' | ''
  }
  interface ButtonHTMLAttributes<T> {
    popovertarget?: string
    popovertargetaction?: 'toggle' | 'show' | 'hide'
  }
}
