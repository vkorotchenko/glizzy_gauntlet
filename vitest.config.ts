import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['apps/web/vitest.config.ts', 'apps/gateway/vitest.config.ts'],
  },
})
