/**
 * One-off VAPID keypair generation. Run once per deployment and put the output
 * in .env — regenerating invalidates every existing push subscription, so the
 * user would have to re-subscribe on every device.
 *
 *   npm run vapid:generate
 */
import webpush from 'web-push'

const keys = webpush.generateVAPIDKeys()

console.log('Add these to your .env file:\n')
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`)
console.log('\nThe public key is safe to serve to the client; the private key is not.')
