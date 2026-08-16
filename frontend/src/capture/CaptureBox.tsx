import { type FormEvent, useState } from 'react'
import { useCapture } from './useCapture.js'
import { CaptureResult } from './CaptureResult.js'
import { apiErrorMessage } from '../api/errors.js'
import { Card, Button, TextArea } from '../ui/index.js'
import styles from './CaptureBox.module.css'

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
    <div className={styles.strip}>
      <Card>
        <form onSubmit={handleSubmit} className={styles.form}>
          <TextArea
            className={styles.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Dump your tasks, or ask 'I have 20 minutes'…"
          />
          <Button type="submit" variant="primary" className={styles.submit} disabled={capture.isPending}>
            Go
          </Button>
        </form>
        {capture.isError && (
          <p role="alert" className={styles.error}>
            {apiErrorMessage(capture.error, 'Something went wrong capturing that.')}
          </p>
        )}
      </Card>
      {capture.data !== undefined && <CaptureResult result={capture.data} />}
    </div>
  )
}
