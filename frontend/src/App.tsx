import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TokenGate } from './auth/TokenGate.js'
import { TaskList } from './tasks/TaskList.js'

const queryClient = new QueryClient()

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TokenGate>
        <TaskList />
      </TokenGate>
    </QueryClientProvider>
  )
}
