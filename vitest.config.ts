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
      // `json-summary` alongside the readable ones because the text table
      // cannot be trusted on its own: on vitest 4.1.11 it silently omits a
      // file that is at 100% (`obstacleScan.ts`, 31/31 statements), and
      // neither `skipFull` setting brings the row back. The JSON carries
      // every file, so it is the one to read a number off.
      reporter: ['text', 'html', 'json-summary']
    }
  }
})
