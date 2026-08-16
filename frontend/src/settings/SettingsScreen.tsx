import { PushSettings } from '../push/PushSettings.js'
import { CheckInSettingsForm } from './CheckInSettingsForm.js'
import styles from './SettingsScreen.module.css'

export function SettingsScreen() {
  return (
    <div>
      <h1 className={styles.title}>Settings</h1>
      <PushSettings />
      <h2 className={styles.sectionHeading}>Check-in schedule</h2>
      <CheckInSettingsForm />
    </div>
  )
}
