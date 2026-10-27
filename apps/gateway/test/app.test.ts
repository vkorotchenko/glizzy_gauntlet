import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type RequestListener, type Server } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import { createApp } from '../src/app.js'

const servers: Server[] = []
const webRoot = fileURLToPath(new URL('./fixtures', import.meta.url))

async function backend(handler: RequestListener) {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No TCP address')
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

describe('gateway boundaries', () => {
  it('preserves API paths, query strings, cookies, CSRF headers, and request bodies', async () => {
    const api = await backend(async (incoming, outgoing) => {
      let body = ''
      for await (const chunk of incoming) body += chunk
      outgoing.setHeader('Content-Type', 'application/json')
      outgoing.end(
        JSON.stringify({
          path: incoming.url,
          cookie: incoming.headers.cookie,
          csrf: incoming.headers['x-csrf-token'],
          forwarded: incoming.headers['x-forwarded-host'] ?? null,
          body: JSON.parse(body),
        }),
      )
    })
    const app = createApp({ apiOrigin: api.origin, webRoot })
    const response = await request(app)
      .post('/api/v1/meals?draft=true')
      .set('Cookie', 'session=test-session')
      .set('X-CSRF-Token', 'test-csrf')
      .set('X-Forwarded-Host', 'untrusted.invalid')
      .send({ wholeCount: 2 })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      path: '/api/v1/meals?draft=true',
      cookie: 'session=test-session',
      csrf: 'test-csrf',
      forwarded: null,
      body: { wholeCount: 2 },
    })
  })

  it('forwards OAuth redirects and leaves upstream API errors as JSON', async () => {
    const api = await backend((incoming, outgoing) => {
      if (incoming.url === '/oauth2/authorization/google') {
        outgoing.writeHead(302, { Location: 'https://accounts.google.com/' })
        outgoing.end()
        return
      }
      outgoing.writeHead(404, { 'Content-Type': 'application/json' })
      outgoing.end('{"error":"MISSING"}')
    })
    const app = createApp({ apiOrigin: api.origin, webRoot })
    const redirect = await request(app).get('/oauth2/authorization/google')
    expect(redirect.status).toBe(302)
    expect(redirect.headers.location).toBe('https://accounts.google.com/')
    const missing = await request(app).get('/api/v1/unknown')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'MISSING' })
  })

  it('serves SPA routes but does not turn internal endpoints or missing assets into HTML', async () => {
    const app = createApp({ apiOrigin: 'http://127.0.0.1:1', webRoot })
    const page = await request(app).get('/competitions/example').accept('html')
    expect(page.status).toBe(200)
    expect(page.text).toContain('Glizzy Gauntlet shell')
    for (const path of [
      '/actuator/health',
      '/api/v2/status',
      '/assets/missing.js',
      '/.env',
    ]) {
      const missing = await request(app).get(path).accept('html')
      expect(missing.status).toBe(404)
      expect(missing.type).toBe('application/json')
    }
  })

  it('returns a recoverable JSON error when the API is unreachable', async () => {
    const api = await backend((_incoming, outgoing) => outgoing.end())
    await new Promise<void>((resolve) => api.server.close(() => resolve()))
    const app = createApp({ apiOrigin: api.origin, webRoot })
    const response = await request(app).get('/api/v1/status')
    expect(response.status).toBe(502)
    expect(response.body).toEqual({ error: 'API_UNAVAILABLE' })
  })
})
