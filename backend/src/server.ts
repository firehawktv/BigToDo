import { buildApp } from './app.js'
import { config } from './config.js'

const app = await buildApp()

try {
  await app.listen({ port: config.port, host: config.host })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(
      () => process.exit(0),
      (error) => {
        app.log.error(error)
        process.exit(1)
      },
    )
  })
}
