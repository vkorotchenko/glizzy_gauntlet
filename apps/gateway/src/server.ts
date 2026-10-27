import { resolve } from 'node:path'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 3000)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

const app = createApp({
  apiOrigin: process.env.API_ORIGIN ?? 'http://127.0.0.1:8080',
  webRoot:
    process.env.WEB_ROOT ?? resolve(import.meta.dirname, '../../web/dist'),
})

const server = app.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`Gateway listening on port ${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
