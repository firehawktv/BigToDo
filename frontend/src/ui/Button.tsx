import type { ComponentPropsWithoutRef } from 'react'
import styles from './Button.module.css'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'default' | 'small'

type ButtonProps = {
  variant?: Variant
  size?: Size
} & ComponentPropsWithoutRef<'button'>

export function Button({
  variant = 'secondary',
  size = 'default',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], styles[size], className].filter(Boolean).join(' ')
  return <button type={type} className={classes} {...rest} />
}
