import webpush from 'web-push'
import { pushConfig } from './config.js'

webpush.setVapidDetails(pushConfig.subject, pushConfig.publicKey, pushConfig.privateKey)

export { webpush }
