import type { ComponentPropsWithoutRef } from 'react'
import styles from './Checkbox.module.css'

export function Checkbox({ className, ...rest }: ComponentPropsWithoutRef<'input'>) {
  const classes = [styles.checkbox, className].filter(Boolean).join(' ')
  return <input type="checkbox" className={classes} {...rest} />
}
