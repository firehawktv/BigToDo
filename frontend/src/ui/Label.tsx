import type { ComponentPropsWithoutRef } from 'react'
import styles from './forms.module.css'

export function Label({ className, ...rest }: ComponentPropsWithoutRef<'label'>) {
  const classes = [styles.label, className].filter(Boolean).join(' ')
  return <label className={classes} {...rest} />
}
