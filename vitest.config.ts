import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const isCryptoCoverageScope = env?.COVERAGE_SCOPE === 'crypto'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'jsdom',
    // Vitest replaces CSS imports with empty strings by default, including
    // `?raw` ones. styles.theme.test.ts reads both of these files as text to
    // compile them with Tailwind, so they have to be exempt. Scoped to these
    // two files so every other CSS import stays stubbed.
    css: { include: [/src[\\/]styles\.css/, /tailwindcss[\\/]index\.css/] },
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: isCryptoCoverageScope ? ['src/crypto/**/*.ts'] : ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/main.tsx',
      ],
      thresholds: isCryptoCoverageScope
        ? {
            statements: 90,
            branches: 85,
            functions: 95,
            lines: 90,
          }
        : {
            statements: 20,
            branches: 60,
            functions: 50,
            lines: 20,
          },
    },
  },
  define: {
    global: 'globalThis',
  },
})
