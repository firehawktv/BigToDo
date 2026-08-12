import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TokenGate } from '../../src/auth/TokenGate.js'
import { clearAuthToken } from '../../src/auth/useAuthToken.js'

describe('TokenGate', () => {
  afterEach(() => {
    localStorage.setItem('todo:apiToken', 'test-token-0123456789abcdef0123456789')
  })

  it('renders children when a token is already stored', () => {
    render(
      <TokenGate>
        <div>Protected content</div>
      </TokenGate>,
    )

    expect(screen.getByText('Protected content')).toBeInTheDocument()
  })

  it('shows the token entry form when no token is stored', () => {
    clearAuthToken()

    render(
      <TokenGate>
        <div>Protected content</div>
      </TokenGate>,
    )

    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/access token/i)).toBeInTheDocument()
  })

  it('stores the token and reveals children after a valid submission', async () => {
    clearAuthToken()
    const user = userEvent.setup()

    render(
      <TokenGate>
        <div>Protected content</div>
      </TokenGate>,
    )

    await user.type(screen.getByLabelText(/access token/i), 'my-real-token')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByText('Protected content')).toBeInTheDocument()
    expect(localStorage.getItem('todo:apiToken')).toBe('my-real-token')
  })

  it('does not submit a blank token', async () => {
    clearAuthToken()
    const user = userEvent.setup()

    render(
      <TokenGate>
        <div>Protected content</div>
      </TokenGate>,
    )

    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })
})
