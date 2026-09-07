import { defineConfig } from 'vitest/config'

// Only `src/core/**` is unit tested: it is the one layer that never touches the
// `figma` global, so it needs no mocking. See CLAUDE.md → Development rules.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Only what the tests can actually reach. Reporting on `src/scene/**`
      // and `src/ui.tsx` would just print zeroes and bury the number that
      // means something.
      include: ['src/core/**'],
      reporter: ['text', 'html']
    }
  }
})
