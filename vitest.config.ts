import { defineConfig } from 'vitest/config'

// Only `src/core/**` is unit tested: it is the one layer that never touches the
// `figma` global, so it needs no mocking. See CLAUDE.md → Development rules.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
})
