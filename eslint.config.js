import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  js.configs.recommended,
  { files: ['public/**/*.js'], languageOptions: { globals: { localStorage: 'readonly', document: 'readonly', matchMedia: 'readonly' } } },
  { files: ['server/**/*.mjs', 'scripts/**/*.mjs'], languageOptions: { globals: { fetch: 'readonly', Response: 'readonly', Buffer: 'readonly', AbortController: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', process: 'readonly', console: 'readonly' } } },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
)
