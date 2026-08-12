import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TokenGate } from './auth/TokenGate.js'

const queryClient = new QueryClient()

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TokenGate>
        <div>Signed in. Screens arrive in later tasks.</div>
      </TokenGate>
    </QueryClientProvider>
  )
}
