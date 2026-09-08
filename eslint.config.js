import figmaPlugins from '@figma/eslint-plugin-figma-plugins'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * The Figma rules are the point of linting here: `documentAccess:
 * "dynamic-page"` forbids the synchronous node APIs, and these rules catch
 * every one of them at lint time instead of at runtime in a real file.
 */
export default tseslint.config(
  { ignores: ['build/**', 'coverage/**', 'manifest.json', 'node_modules/**'] },
  ...tseslint.configs.recommendedTypeChecked,
  figmaPlugins.flatConfigs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  /**
   * `src/ui.tsx` is Preact, and Preact's hooks follow React's rules exactly —
   * so the same two mistakes are available: calling a hook conditionally, and
   * a dependency list that has drifted from what the effect actually reads.
   * Neither shows up as a type error or a failing test; both show up as a
   * panel that is subtly out of date.
   *
   * Worth having before the UI is split into components, which is when
   * dependency lists get rewritten by hand.
   */
  {
    files: ['src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['eslint.config.js', 'vitest.config.ts'],
    ...tseslint.configs.disableTypeChecked
  }
)
