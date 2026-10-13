import { describe, expect, it } from 'vitest'
import indexHtml from '../index.html?raw'
import stylesCss from './styles.css?raw'
import mainTsx from './main.tsx?raw'
import outfitCss from '@fontsource-variable/outfit?raw'

/**
 * Once open, on the default networks, the tool must contact no host except
 * mempool.space. The typeface is bundled from @fontsource-variable/outfit and
 * inlined into the build, so no font or stylesheet may be fetched from
 * anywhere else.
 *
 * These read the sources, not dist/: the workflows run the tests before the
 * build, so dist/ does not exist yet.
 */

// Each file with a line from its real content, so a stubbed or empty import
// cannot pass the host check by having nothing in it.
const SOURCES: [file: string, source: string, content: string][] = [
  ['index.html', indexHtml, '<div id="root"></div>'],
  ['src/styles.css', stylesCss, "@import 'tailwindcss'"],
  ['src/main.tsx', mainTsx, 'createRoot('],
  ['@fontsource-variable/outfit/index.css', outfitCss, '@font-face'],
]

// Every non-test script of the app, TypeScript or JavaScript, as text.
const APP_SOURCES = import.meta.glob<string>(
  [
    './**/*.{ts,tsx,js,jsx,mjs,cjs}',
    '!./**/*.test.{ts,tsx,js,jsx,mjs,cjs}',
    '!./**/__fixtures__/**',
  ],
  { query: '?raw', import: 'default', eager: true },
)

// Every stylesheet under src, as text, so one added later is checked too.
const CSS_SOURCES = import.meta.glob<string>('./**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// The whole authority after any //, so a user@ prefix, a port or an IPv6
// address stays inside the capture and has to match as a whole.
const AUTHORITY_PATTERN = /\/\/([^\s/?#'"`()<>\\;,]*)/g
const MEMPOOL_HOST = /^(?:\*\.)?(?:[a-z0-9-]+\.)*mempool\.space$/i

// In code // also starts a comment, so only count a // that follows a URL
// scheme, a quote, a bracket or an =.
const SOURCE_URL_PATTERN = /(?:[a-z][a-z0-9+.-]*:|['"`(=])\/\/([^\s/?#'"`()<>\\]*)/gi
// mempool.space and its subdomains, and the regtest default
// http://localhost:8999 from crypto/networks.ts.
const ALLOWED_SOURCE_HOST = /^(?:(?:[a-z0-9-]+\.)*mempool\.space|localhost:8999)$/i

function captures(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]!).filter(Boolean)
}

// The hosts a source names that it may not. The host tests and the self-test
// below both call these.
function otherHosts(source: string): string[] {
  return captures(source, AUTHORITY_PATTERN).filter((host) => !MEMPOOL_HOST.test(host))
}

function otherAppHosts(source: string): string[] {
  return captures(source, SOURCE_URL_PATTERN).filter((host) => !ALLOWED_SOURCE_HOST.test(host))
}

function unquote(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2')
}

const BODY_FIRST_FAMILY = stylesCss.match(/body\s*\{[^}]*?font-family:\s*([^,;]+)/)?.[1]?.trim()

describe('external hosts', () => {
  it.each(SOURCES)('reads the real %s, not an empty stub', (_file, source, content) => {
    expect(source).toContain(content)
  })

  it.each(SOURCES)('%s names no host other than mempool.space', (_file, source) => {
    expect(otherHosts(source)).toEqual([])
  })
})

describe('external hosts in the app code', () => {
  it('scans the real sources, crypto/networks.ts and BroadcastStep.tsx included', () => {
    expect(APP_SOURCES['./crypto/networks.ts']).toContain("'https://mempool.space/api'")
    expect(APP_SOURCES['./components/steps/BroadcastStep.tsx']).toContain('https://mempool.space/tx/')
  })

  it('reads every scanned file as text, not an empty stub', () => {
    expect(Object.keys(APP_SOURCES).filter((file) => !APP_SOURCES[file])).toEqual([])
  })

  it('names no host other than mempool.space and the regtest localhost default', () => {
    const unexpected = Object.entries(APP_SOURCES).flatMap(([file, source]) =>
      otherAppHosts(source).map((host) => `${file}: ${host}`),
    )
    expect(unexpected).toEqual([])
  })
})

describe('external hosts in the stylesheets', () => {
  it('scans the real stylesheets, styles.css included', () => {
    expect(CSS_SOURCES['./styles.css']).toContain("@import 'tailwindcss'")
  })

  it('reads every scanned file as text, not an empty stub', () => {
    expect(Object.keys(CSS_SOURCES).filter((file) => !CSS_SOURCES[file])).toEqual([])
  })

  it('names no host other than mempool.space', () => {
    const unexpected = Object.entries(CSS_SOURCES).flatMap(([file, source]) =>
      otherHosts(source).map((host) => `${file}: ${host}`),
    )
    expect(unexpected).toEqual([])
  })
})

// Each check is run on URLs it must flag and one it must pass, quoted the way
// a source file holds them, so a check that flags nothing cannot stay green.
describe('the host checks themselves', () => {
  it.each([
    ['file', otherHosts],
    ['app code', otherAppHosts],
  ])('the %s check flags other hosts and passes mempool.space', (_check, other) => {
    const flagged = ['https://fonts.googleapis.com/x', '//evil.com', 'https://mempool.space@evil.com']
    expect(flagged.map((url) => other(`'${url}'`))).toEqual([
      ['fonts.googleapis.com'],
      ['evil.com'],
      ['mempool.space@evil.com'],
    ])
    expect(other("'https://mempool.space/api'")).toEqual([])
  })
})

describe('bundled Outfit font', () => {
  it('main.tsx imports the bundled font package', () => {
    expect(mainTsx).toMatch(/^import '@fontsource-variable\/outfit'$/m)
  })

  // The package declares its @font-face as 'Outfit Variable'. Any other name
  // here silently falls back to a system font.
  it('the body font stack starts with the bundled family name', () => {
    expect(BODY_FIRST_FAMILY).toBe("'Outfit Variable'")
  })

  // The package stylesheet main.tsx imports is read as well, so a version bump
  // that renames the family or loads a face from elsewhere fails here.
  it('the package declares only the family the body font stack starts with', () => {
    const declared = new Set(captures(outfitCss, /font-family:\s*([^;]+)/g).map(unquote))
    expect(declared).toEqual(new Set([unquote(BODY_FIRST_FAMILY ?? '')]))
  })

  it('every url() in the package stylesheet points at its own files', () => {
    const urls = captures(outfitCss, /url\(\s*['"]?([^'")\s]*)/gi)
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.filter((url) => !url.startsWith('./files/'))).toEqual([])
  })
})
