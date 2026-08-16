import { type FormEvent, type ReactNode, useState } from 'react'
import { notifyTokenChanged, setAuthToken, useAuthToken } from './useAuthToken.js'
import { Card, Button, TextInput, Label } from '../ui/index.js'
import styles from './TokenGate.module.css'

export function TokenGate({ children }: { children: ReactNode }): ReactNode {
  const token = useAuthToken()
  const [draft, setDraft] = useState('')

  if (token !== null) return children

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    const trimmed = draft.trim()
    if (trimmed === '') return
    setAuthToken(trimmed)
    notifyTokenChanged()
  }

  return (
    <div className={styles.screen}>
      <Card className={styles.card}>
        <h1 className={styles.title}>ToDo App</h1>
        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <Label htmlFor="api-token">Access token</Label>
            <TextInput
              id="api-token"
              type="password"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoComplete="off"
            />
          </div>
          <Button type="submit" variant="primary" className={styles.submit}>
            Continue
          </Button>
        </form>
      </Card>
    </div>
  )
}
