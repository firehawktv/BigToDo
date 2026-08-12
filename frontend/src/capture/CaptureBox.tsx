import { type FormEvent, useState } from 'react'
import { useCapture } from './useCapture.js'
import { CaptureResult } from './CaptureResult.js'
import { apiErrorMessage } from '../api/errors.js'

export function CaptureBox() {
  const [text, setText] = useState('')
  const capture = useCapture()

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    const trimmed = text.trim()
    if (trimmed === '') return
    capture.mutate(trimmed, { onSuccess: () => setText('') })
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Dump your tasks, or ask 'I have 20 minutes'…"
        />
        <button type="submit" disabled={capture.isPending}>
          Go
        </button>
      </form>
      {capture.isError && (
        <p role="alert">{apiErrorMessage(capture.error, 'Something went wrong capturing that.')}</p>
      )}
      {capture.data !== undefined && <CaptureResult result={capture.data} />}
    </div>
  )
}
