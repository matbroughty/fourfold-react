import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['{shared,server,scripts}/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
