export interface Config {
  databaseUrl: string
  apiToken: string
  port: number
  host: string
  logLevel: string
}

const MIN_TOKEN_LENGTH = 32

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = required(env, 'DATABASE_URL')
  const apiToken = required(env, 'API_TOKEN')

  if (apiToken.length < MIN_TOKEN_LENGTH) {
    throw new Error(`API_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`)
  }

  const rawPort = env.PORT ?? '3000'
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got: ${rawPort}`)
  }

  return {
    databaseUrl,
    apiToken,
    port,
    host: env.HOST ?? '0.0.0.0',
    logLevel: env.LOG_LEVEL ?? 'info',
  }
}

export const config = loadConfig()
