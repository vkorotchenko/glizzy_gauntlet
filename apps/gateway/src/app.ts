import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { extname, join } from 'node:path'

type GatewayOptions = {
  apiOrigin: string
  webRoot: string
}

function within(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`)
}

export function createApp({ apiOrigin, webRoot }: GatewayOptions) {
  const origin = new URL(apiOrigin)
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('API_ORIGIN must be an HTTP(S) origin without credentials')
  }

  const app = express()
  app.disable('x-powered-by')
  app.use((_request, response, next) => {
    response.set({
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    })
    next()
  })

  app.get('/healthz', (_request, response) => {
    response.json({ status: 'UP' })
  })

  app.use(
    createProxyMiddleware({
      target: origin.origin,
      pathFilter: (path) =>
        ['/api/v1', '/auth', '/oauth2', '/login/oauth2'].some((prefix) =>
          within(path, prefix),
        ),
      changeOrigin: false,
      xfwd: false,
      proxyTimeout: 10_000,
      timeout: 10_000,
      on: {
        proxyReq: (proxyRequest) => {
          for (const header of proxyRequest.getHeaderNames()) {
            if (header === 'forwarded' || header.startsWith('x-forwarded-')) {
              proxyRequest.removeHeader(header)
            }
          }
        },
        error: (_error, _request, response) => {
          if ('writeHead' in response && !response.headersSent) {
            response.writeHead(502, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            })
            response.end(JSON.stringify({ error: 'API_UNAVAILABLE' }))
          }
        },
      },
    }),
  )

  app.use((request, response, next) => {
    if (
      ['/api', '/auth', '/oauth2', '/login', '/actuator'].some((prefix) =>
        within(request.path, prefix),
      ) ||
      request.path.split('/').some((part) => part.startsWith('.'))
    ) {
      response.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    next()
  })

  app.use(express.static(webRoot, { index: false, dotfiles: 'deny' }))
  app.use((request, response, next) => {
    if (
      request.method !== 'GET' ||
      within(request.path, '/assets') ||
      extname(request.path) ||
      !request.accepts('html')
    ) {
      response.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.sendFile(join(webRoot, 'index.html'), (error) => {
      if (error) next(error)
    })
  })

  app.use(
    (
      _error: unknown,
      _request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      if (response.headersSent) {
        next(_error)
        return
      }
      response.status(500).json({ error: 'GATEWAY_ERROR' })
    },
  )

  return app
}
