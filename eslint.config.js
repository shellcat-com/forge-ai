import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dist-cloud', 'dist-engine', 'coverage', 'templates/**/.next/**', 'runner/evidence/**',
    // Candidate app uses its own pinned Next.js ESLint/toolchain; engine policy files remain checked here.
    'templates/**/app/**', 'templates/**/components/**', 'templates/**/lib/**', 'templates/**/platform/**',
    'templates/**/next*.ts', 'templates/**/next*.mjs', 'templates/**/eslint.config.mjs'] },
  js.configs.recommended,
  { files: ['public/**/*.js'], languageOptions: { globals: { localStorage: 'readonly', document: 'readonly', matchMedia: 'readonly' } } },
  { files: ['server/**/*.mjs', 'scripts/**/*.mjs', 'tests/engine/**/*.mjs', 'drizzle.config.mjs'], languageOptions: { globals: { URL: 'readonly', fetch: 'readonly', Response: 'readonly', Buffer: 'readonly', AbortController: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', process: 'readonly', console: 'readonly' } } },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
)
