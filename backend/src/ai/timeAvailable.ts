/**
 * Detects "I have N minutes" style queries typed into the capture box.
 *
 * The whole input must look like the query — matching a duration ANYWHERE in
 * the text would swallow real captures like "call the dentist in 20 minutes",
 * turning a task the user meant to save into a search that saves nothing. When
 * in doubt this returns null and the text is captured as tasks, which is the
 * recoverable direction to be wrong in.
 */

/** Longer than a day is not a "what can I get done right now" question. */
const MAX_MINUTES = 1440

const LEAD_IN = String.raw`(?:i\s*(?:'ve|\s+have|\s+got|'ve\s+got|\s+have\s+got)\s+)?`
const TRAILER = String.raw`(?:\s+(?:free|left|spare|available|to\s+spare|to\s+kill))?`
const QUESTION = String.raw`(?:\s*[,\-–—]?\s*what\s+(?:can|should)\s+i\s+(?:do|get\s+done|work\s+on)\s*)?`

const NUMERIC = new RegExp(
  `^${LEAD_IN}(\\d{1,4})\\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)${TRAILER}${QUESTION}[.!?]*$`,
)

const HALF_HOUR = new RegExp(`^${LEAD_IN}half\\s+an\\s+hour${TRAILER}${QUESTION}[.!?]*$`)

export function detectTimeAvailable(rawText: string): number | null {
  const normalized = rawText.trim().toLowerCase().replace(/\s+/g, ' ')
  if (normalized === '') return null

  if (HALF_HOUR.test(normalized)) return 30

  const match = NUMERIC.exec(normalized)
  if (match === null) return null

  const amount = Number(match[1])
  const unit = match[2]!
  if (!Number.isInteger(amount) || amount <= 0) return null

  const minutes = unit.startsWith('h') ? amount * 60 : amount
  return minutes > 0 && minutes <= MAX_MINUTES ? minutes : null
}
