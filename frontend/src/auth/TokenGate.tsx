import { type FormEvent, type ReactNode, useState } from 'react'
import { notifyTokenChanged, setAuthToken, useAuthToken } from './useAuthToken.js'

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
    <form onSubmit={handleSubmit}>
      <label htmlFor="api-token">Access token</label>
      <input
        id="api-token"
        type="password"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        autoComplete="off"
      />
      <button type="submit">Continue</button>
    </form>
  )
}
