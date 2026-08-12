import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TokenGate } from './auth/TokenGate.js'
import { TaskList } from './tasks/TaskList.js'
import { CaptureBox } from './capture/CaptureBox.js'
import { SettingsScreen } from './settings/SettingsScreen.js'

const queryClient = new QueryClient()

type Screen = 'tasks' | 'settings'

export function App() {
  const [screen, setScreen] = useState<Screen>('tasks')

  return (
    <QueryClientProvider client={queryClient}>
      <TokenGate>
        <nav>
          <button type="button" onClick={() => setScreen('tasks')} disabled={screen === 'tasks'}>
            Tasks
          </button>
          <button type="button" onClick={() => setScreen('settings')} disabled={screen === 'settings'}>
            Settings
          </button>
        </nav>

        {screen === 'tasks' ? (
          <>
            <CaptureBox />
            <TaskList />
          </>
        ) : (
          <SettingsScreen />
        )}
      </TokenGate>
    </QueryClientProvider>
  )
}
