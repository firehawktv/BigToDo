import type { ReactNode } from 'react'
import styles from './Modal.module.css'

/**
 * A clipped overlay sheet — the one place the board allows real elevation,
 * since a modal is a genuine interruption, not decoration. Purely
 * presentational: it owns no close-on-backdrop-click or Escape handling
 * beyond what the caller already wires up via its own controls.
 */
export function Modal({ children }: { children: ReactNode }) {
  return (
    <div className={styles.overlay}>
      <div className={styles.panel} role="dialog">
        {children}
      </div>
    </div>
  )
}
