import type { ComponentPropsWithoutRef } from 'react'
import styles from './forms.module.css'

export function Select({ className, ...rest }: ComponentPropsWithoutRef<'select'>) {
  const classes = [styles.field, className].filter(Boolean).join(' ')
  return <select className={classes} {...rest} />
}
