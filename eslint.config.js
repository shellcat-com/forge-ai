import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "dist/**",
      "dist-cloud/**",
      "dist-engine/**",
      "cloudflare/scheduler/.wrangler/**",
      "runner/evidence/**",
      "public/monaco/**",
      "templates/**",
      "node_modules/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "next-env.d.ts",
    ],
  },
  js.configs.recommended,
  { files: ['public/**/*.js'], languageOptions: { globals: { localStorage: 'readonly', document: 'readonly', matchMedia: 'readonly' } } },
  { files: ['server/**/*.mjs', 'scripts/**/*.mjs'], languageOptions: { globals: { fetch: 'readonly', Response: 'readonly', Buffer: 'readonly', AbortController: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', process: 'readonly', console: 'readonly' } } },
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "runtime/**/*.mjs", "server/**/*.mjs", "tests/engine/**/*.mjs", "drizzle.config.mjs"],
    languageOptions: {
      globals: {
        URL: "readonly",
        fetch: "readonly",
        Response: "readonly",
        AbortController: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: { "@typescript-eslint/consistent-type-imports": "error" },
  },
);
