import type { ComponentPropsWithoutRef } from 'react'
import styles from './forms.module.css'

export function TextArea({ className, ...rest }: ComponentPropsWithoutRef<'textarea'>) {
  const classes = [styles.field, className].filter(Boolean).join(' ')
  return <textarea className={classes} {...rest} />
}
