import { type FormEvent, useEffect, useState } from 'react'
import { useCheckInSettingsQuery, useUpdateCheckInSettings } from './useCheckInSettings.js'

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
    <form onSubmit={handleSubmit}>
      <label htmlFor="check-in-enabled">Enabled</label>
      <input
        id="check-in-enabled"
        type="checkbox"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
      />

      <label htmlFor="check-in-active-from">From</label>
      <input
        id="check-in-active-from"
        type="time"
        value={activeFrom}
        onChange={(e) => setActiveFrom(e.target.value)}
      />

      <label htmlFor="check-in-active-to">Until</label>
      <input
        id="check-in-active-to"
        type="time"
        value={activeTo}
        onChange={(e) => setActiveTo(e.target.value)}
      />

      <label htmlFor="check-in-count">How many times per day</label>
      <input
        id="check-in-count"
        type="number"
        min="0"
        value={checkInsPerDay}
        onChange={(e) => setCheckInsPerDay(e.target.value)}
      />

      <label htmlFor="check-in-timezone">Timezone</label>
      <input
        id="check-in-timezone"
        type="text"
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
      />

      {validationError !== null && <p role="alert">{validationError}</p>}
      {justSaved && <p>Saved</p>}

      <button type="submit" disabled={updateSettings.isPending}>
        Save
      </button>
    </form>
  )
}
