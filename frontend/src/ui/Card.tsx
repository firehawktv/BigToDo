import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import styles from './Card.module.css'

type CardProps<T extends ElementType> = {
  as?: T
  /**
   * A card that is captured but not yet confirmed — the AI-parsed review
   * batch. Renders slightly askew with a harder paper-edge shadow, per
   * DESIGN.md's "not yet filed" raise, instead of the flat resting state
   * every other card uses.
   */
  loose?: boolean
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children'>

export function Card<T extends ElementType = 'div'>({
  as,
  loose = false,
  className,
  children,
  ...rest
}: CardProps<T>) {
  const Tag = as ?? 'div'
  const classes = [styles.card, loose ? styles.loose : '', className].filter(Boolean).join(' ')
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  )
}
