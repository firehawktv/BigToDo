import webpush from 'web-push'
import { pushConfig } from './config.js'

let configured = false

/**
 * Returns the web-push client, configuring VAPID details on first call rather
 * than at import time. This is what stops importing this module — which
 * happens transitively via app.ts's route registration — from forcing VAPID
 * key validation on every process that merely builds the Fastify app.
 */
export function getWebPush(): typeof webpush {
  if (!configured) {
    const { subject, publicKey, privateKey } = pushConfig()
    webpush.setVapidDetails(subject, publicKey, privateKey)
    configured = true
  }
  return webpush
}
