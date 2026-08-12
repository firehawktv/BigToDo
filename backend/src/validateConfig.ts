import { config } from './config.js'
import { databaseConfig } from './db/config.js'
import { aiConfig } from './ai/config.js'
import { pushConfig } from './push/config.js'
import { getWebPush } from './push/webPush.js'

/**
 * Forces every config module to validate its environment, once, deliberately,
 * at process boot — rather than as a side effect of whichever module happens
 * to be imported first. Call this once, early in server.ts, before the app
 * starts serving requests. Each underlying accessor is memoized, so this is
 * the only place the validation cost is paid; every later call from a route
 * handler or scheduler tick is free.
 */
export function validateConfig(): void {
  config()
  databaseConfig()
  aiConfig()
  pushConfig()
  getWebPush() // also validates the VAPID public key is a real 65-byte EC point
}
