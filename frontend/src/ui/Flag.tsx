import type { ReactNode } from 'react'
import styles from './Flag.module.css'

/**
 * The system's one reserved use of amber outside the primary action and
 * check-off confirmation — see DESIGN.md's One Flag Rule. Reserve this for
 * genuinely urgent signals (high priority, overdue), never decoration.
 */
export function Flag({ children }: { children: ReactNode }) {
  return <span className={styles.flag}>{children}</span>
}
