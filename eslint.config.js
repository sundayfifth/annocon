import figmaPlugins from '@figma/eslint-plugin-figma-plugins'
import tseslint from 'typescript-eslint'

/**
 * The Figma rules are the point of linting here: `documentAccess:
 * "dynamic-page"` forbids the synchronous node APIs, and these rules catch
 * every one of them at lint time instead of at runtime in a real file.
 */
export default tseslint.config(
  { ignores: ['build/**', 'manifest.json', 'node_modules/**'] },
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
  {
    files: ['eslint.config.js', 'vitest.config.ts'],
    ...tseslint.configs.disableTypeChecked
  }
)
