import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { config } from '../../src/config.js'
import { setupTestDatabase } from './db.js'

export async function buildTestApp(): Promise<FastifyInstance> {
  await setupTestDatabase()
  return buildApp({ logger: false })
}

export function authHeaders(): { authorization: string } {
  return { authorization: `Bearer ${config.apiToken}` }
}
