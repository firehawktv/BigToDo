import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TokenGate } from './auth/TokenGate.js'
import { TaskList } from './tasks/TaskList.js'
import { CaptureBox } from './capture/CaptureBox.js'
import { SettingsScreen } from './settings/SettingsScreen.js'
import styles from './App.module.css'

const queryClient = new QueryClient()

type Screen = 'tasks' | 'settings'

export function App() {
  const [screen, setScreen] = useState<Screen>('tasks')

  return (
    <QueryClientProvider client={queryClient}>
      <TokenGate>
        <div className={styles.shell}>
          <main className={styles.content}>
            {screen === 'tasks' ? (
              <>
                <CaptureBox />
                <TaskList />
              </>
            ) : (
              <SettingsScreen />
            )}
          </main>

          <nav className={styles.tabs}>
            <button
              type="button"
              className={styles.tab}
              onClick={() => setScreen('tasks')}
              disabled={screen === 'tasks'}
            >
              Tasks
            </button>
            <button
              type="button"
              className={styles.tab}
              onClick={() => setScreen('settings')}
              disabled={screen === 'settings'}
            >
              Settings
            </button>
          </nav>
        </div>
      </TokenGate>
    </QueryClientProvider>
  )
}
