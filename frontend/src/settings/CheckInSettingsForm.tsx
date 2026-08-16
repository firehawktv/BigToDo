import { type FormEvent, useEffect, useState } from 'react'
import { useCheckInSettingsQuery, useUpdateCheckInSettings } from './useCheckInSettings.js'
import { Card, Checkbox, Label, TextInput, Button } from '../ui/index.js'
import styles from './CheckInSettingsForm.module.css'

export function CheckInSettingsForm() {
  const { data: settings } = useCheckInSettingsQuery()
  const updateSettings = useUpdateCheckInSettings()

  const [enabled, setEnabled] = useState(false)
  const [activeFrom, setActiveFrom] = useState('')
  const [activeTo, setActiveTo] = useState('')
  const [checkInsPerDay, setCheckInsPerDay] = useState('')
  const [timezone, setTimezone] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    if (settings === undefined) return
    setEnabled(settings.enabled)
    setActiveFrom(settings.activeFrom)
    setActiveTo(settings.activeTo)
    setCheckInsPerDay(String(settings.checkInsPerDay))
    setTimezone(settings.timezone)
  }, [settings])

  if (settings === undefined) return null

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    setJustSaved(false)

    // Mirrors the backend's own activeFrom < activeTo check — fixed-width,
    // zero-padded HH:MM strings compare correctly lexically.
    if (activeFrom >= activeTo) {
      setValidationError('Active-from time must be before active-to time')
      return
    }
    setValidationError(null)

    updateSettings.mutate(
      {
        enabled,
        activeFrom,
        activeTo,
        checkInsPerDay: Number(checkInsPerDay),
        timezone,
      },
      { onSuccess: () => setJustSaved(true) },
    )
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.checkboxRow}>
          <Checkbox
            id="check-in-enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <Label htmlFor="check-in-enabled" className={styles.label}>
            Enabled
          </Label>
        </div>

        <div className={styles.row}>
          <div>
            <Label htmlFor="check-in-active-from">From</Label>
            <TextInput
              id="check-in-active-from"
              type="time"
              className="mono-figure"
              value={activeFrom}
              onChange={(e) => setActiveFrom(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="check-in-active-to">Until</Label>
            <TextInput
              id="check-in-active-to"
              type="time"
              className="mono-figure"
              value={activeTo}
              onChange={(e) => setActiveTo(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="check-in-count">How many times per day</Label>
          <TextInput
            id="check-in-count"
            type="number"
            min="0"
            className="mono-figure"
            value={checkInsPerDay}
            onChange={(e) => setCheckInsPerDay(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="check-in-timezone">Timezone</Label>
          <TextInput
            id="check-in-timezone"
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
        </div>

        {validationError !== null && (
          <p role="alert" className={styles.error}>
            {validationError}
          </p>
        )}
        {justSaved && <p className={styles.saved}>Saved</p>}

        <Button type="submit" variant="primary" disabled={updateSettings.isPending}>
          Save
        </Button>
      </form>
    </Card>
  )
}
