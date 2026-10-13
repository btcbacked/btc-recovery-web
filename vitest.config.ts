import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const isCryptoCoverageScope = env?.COVERAGE_SCOPE === 'crypto'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'jsdom',
    // Vitest replaces CSS imports with empty strings by default, including
    // `?raw` ones. styles.theme.test.ts reads styles.css and Tailwind's
    // index.css as text to compile them with Tailwind, and
    // external-hosts.test.ts reads every CSS file under src and the Outfit
    // font package's index.css as text to check them, so these have to be
    // exempt. Scoped to these files so every other CSS import stays stubbed.
    css: {
      include: [
        /src[\\/].*\.css/,
        /@fontsource-variable[\\/]outfit[\\/]index\.css/,
        /tailwindcss[\\/]index\.css/,
      ],
    },
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
