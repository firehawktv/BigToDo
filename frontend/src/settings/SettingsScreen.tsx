import { PushSettings } from '../push/PushSettings.js'
import { CheckInSettingsForm } from './CheckInSettingsForm.js'

export function SettingsScreen() {
  return (
    <div>
      <h1>Settings</h1>
      <PushSettings />
      <h2>Check-in schedule</h2>
      <CheckInSettingsForm />
    </div>
  )
}
