import type { ComponentPropsWithoutRef } from 'react'
import styles from './forms.module.css'

export function TextInput({ className, ...rest }: ComponentPropsWithoutRef<'input'>) {
  const classes = [styles.field, className].filter(Boolean).join(' ')
  return <input className={classes} {...rest} />
}
