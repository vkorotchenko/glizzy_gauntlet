import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'gateway',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
