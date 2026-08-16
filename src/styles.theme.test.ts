import { beforeAll, describe, expect, it } from 'vitest'
import { compile } from 'tailwindcss'
import stylesSource from './styles.css?raw'
import tailwindSource from 'tailwindcss/index.css?raw'

/**
 * Guard for the design token layer.
 *
 * Tailwind v4 emits a colour utility only for names registered under the
 * --color-* namespace in an @theme block. A token declared in :root alone
 * produces the custom property and NO utility, so `text-warning` compiles to
 * nothing and the element silently falls back to inherited text. Nothing about
 * that fails: the markup looks styled, tsc is happy and the build is green.
 *
 * This shipped once. Every semantic colour in the app was dead for the whole
 * life of the repo because no @theme block existed, and no test noticed.
 *
 * So these tests compile the real src/styles.css with the real Tailwind and
 * assert the utilities actually come out. Adding a semantic colour utility to
 * a component means adding its token to SEMANTIC_COLOR_TOKENS below.
 */

/**
 * Every semantic colour token a utility in src/ depends on.
 *
 * This list is deliberately hand written rather than derived from the @theme
 * block. Deriving it would make the test circular: deleting a token would
 * shrink both sides at once and the suite would stay green.
 */
const SEMANTIC_COLOR_TOKENS = [
  'background',
  'foreground',
  'card',
  'primary',
  'primary-foreground',
  'primary-text',
  'muted',
  'muted-foreground',
  'accent',
  'border',
  'ring',
  'destructive',
  'destructive-text',
  'success',
  'success-text',
  'warning',
  'warning-text',
  'info',
] as const

/**
 * Resolve the `@import`s at the top of styles.css.
 *
 * Tailwind's own entry is loaded for real, because it carries the utility
 * definitions under test. tw-animate-css is stubbed: it only contributes
 * animation utilities, so it cannot affect whether a colour utility generates,
 * and stubbing it keeps this test off the package's internal file layout.
 */
async function loadStylesheet(id: string) {
  if (id === 'tailwindcss') {
    return { path: id, base: '/', content: tailwindSource }
  }
  if (id === 'tw-animate-css') {
    return { path: id, base: '/', content: '' }
  }
  throw new Error(`styles.css imports ${id}, which this test does not resolve`)
}

/** The declarations Tailwind generated for a single class, or null if it generated none. */
function declarationsFor(css: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const match = css.match(new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`))
  return match?.[1] ? match[1].replace(/\s+/g, ' ').trim() : null
}

describe('semantic colour tokens generate utilities', () => {
  let css: string

  beforeAll(async () => {
    const compiler = await compile(stylesSource, { base: '/', loadStylesheet })
    css = compiler.build([
      ...SEMANTIC_COLOR_TOKENS.flatMap((token) => [`text-${token}`, `bg-${token}`]),
      'bg-warning/10',
    ])
  })

  it.each(SEMANTIC_COLOR_TOKENS)('text-%s resolves to its colour token', (token) => {
    // Asserting the property and not just the class name is the point: if a
    // token were registered under the --text-* namespace instead of --color-*,
    // `text-<token>` would still generate, but as a font-size.
    expect(declarationsFor(css, `text-${token}`)).toBe(`color: var(--${token});`)
  })

  it.each(SEMANTIC_COLOR_TOKENS)('bg-%s resolves to its colour token', (token) => {
    expect(declarationsFor(css, `bg-${token}`)).toBe(`background-color: var(--${token});`)
  })

  it('generates the opacity modifier the warning banners are built from', () => {
    // Matched by hand rather than with declarationsFor: the rule nests an
    // @supports block for color-mix, so it is not brace balanced.
    const start = css.indexOf('.bg-warning\\/10')
    expect(start).toBeGreaterThan(-1)
    expect(css.slice(start, start + 300)).toContain('var(--warning)')
  })
})

/* ---------- WCAG 2.1 relative luminance and contrast ---------- */

type RGB = [number, number, number]

function luminance(rgb: RGB): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Flatten a translucent foreground over an opaque backdrop, as the browser does. */
function composite(fg: RGB, alpha: number, bg: RGB): RGB {
  return fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]!)) as RGB
}

/* ---------- read the real values out of styles.css ---------- */

/**
 * Every number below is derived from the stylesheet, never written down here.
 *
 * A guard that hardcodes the colour it expects only proves the constant in the
 * test equals the constant in the test. Pale values ship anyway, because the
 * author who changes the token does not think to change the copy of it.
 */
function readToken(name: string): string {
  const match = stylesSource.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'))
  if (!match?.[1]) throw new Error(`token --${name} is not declared in styles.css`)
  const value = match[1].trim()
  // --muted-foreground is `var(--text-muted)`, so follow one level of aliasing.
  const alias = value.match(/^var\(--([\w-]+)\)$/)
  return alias?.[1] ? readToken(alias[1]) : value
}

/** Parse `#rrggbb` or `rgba(r, g, b, a)` into a triple plus its own alpha. */
function parseColor(value: string): { rgb: RGB; alpha: number } {
  const rgba = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/)
  if (rgba) {
    return {
      rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])] as RGB,
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    }
  }
  const channels = value.replace('#', '').match(/../g)
  if (!channels || channels.length < 3) throw new Error(`not a colour: ${value}`)
  return {
    rgb: [
      parseInt(channels[0]!, 16),
      parseInt(channels[1]!, 16),
      parseInt(channels[2]!, 16),
    ],
    alpha: 1,
  }
}

/** The first colour stop of a gradient token, which is where these gradients peak. */
function peakOf(value: string): { rgb: RGB; alpha: number } {
  const stop = value.match(/rgba?\([^)]*\)|#[0-9a-f]{6}/i)
  if (!stop) throw new Error(`no colour stop in: ${value}`)
  return parseColor(stop[0])
}

/* ---------- the surfaces text actually renders on ---------- */

/**
 * Nothing in this app sits on bare white, so nothing may be measured against
 * it. Every screen stacks, bottom to top:
 *
 *   --background            the page, #ffffff
 *   --page-bg-gradient      a warm radial wash, at its peak here
 *   --auth-ambient-glow     a second warm wash, at its peak here
 *   --glass-bg              the card, 85% white over all of that
 *   bg-<token>/<pct>        whatever tint a banner or badge adds
 *
 * The warm layers pull the card slightly off white and therefore slightly
 * *down* in contrast, so measuring on white flatters every number. Build the
 * real thing instead.
 */
function cardSurface(): RGB {
  const page = parseColor(readToken('background')).rgb
  const gradient = peakOf(readToken('page-bg-gradient'))
  const ambient = peakOf(readToken('auth-ambient-glow'))
  const glass = parseColor(readToken('glass-bg'))
  return composite(
    glass.rgb,
    glass.alpha,
    composite(ambient.rgb, ambient.alpha, composite(gradient.rgb, gradient.alpha, page))
  )
}

/** The opaque surface a Tailwind `bg-<token>/<pct>` tint produces over the card. */
function tint(token: string, pct: number, base: RGB = cardSurface()): RGB {
  return composite(parseColor(readToken(token)).rgb, pct / 100, base)
}

/** What a token actually paints as on `bg`, flattening the token's own alpha. */
function inkOn(token: string, bg: RGB): RGB {
  const { rgb, alpha } = parseColor(readToken(token))
  return alpha === 1 ? rgb : composite(rgb, alpha, bg)
}

/** WCAG 2.1 AA for body copy. Every text token here is body size, so 3:1 never applies. */
const AA = 4.5

describe('text-role colour tokens are readable on the surface they render on', () => {
  const cases: [backdrop: string, token: string, surface: () => RGB][] = [
    // Errors. Every error message this tool can show is one of these.
    ['a bg-destructive/10 error banner', 'destructive-text', () => tint('destructive', 10)],
    ['the glass card (field errors, wizard crash copy)', 'destructive-text', cardSurface],
    ['a bg-destructive/5 drop zone in error', 'destructive-text', () => tint('destructive', 5)],
    // Success.
    ['a bg-success/10 badge (mainnet, signature status)', 'success-text', () => tint('success', 10)],
    ['the glass card (drop zone confirmation)', 'success-text', cardSurface],
    // Brand.
    ['a bg-primary/10 selected fee preset', 'primary-text', () => tint('primary', 10)],
    // Warning, the pair that established this pattern.
    ['a bg-warning/10 banner', 'warning-text', () => tint('warning', 10)],
  ]

  it.each(cases)('%s is readable in --%s', (_backdrop, token, surface) => {
    const bg = surface()
    expect(contrastRatio(inkOn(token, bg), bg)).toBeGreaterThanOrEqual(AA)
  })
})

describe('--muted-foreground is readable on every surface it lands on', () => {
  /*
   * ~128 sites, and they are not all on the card. The "what to do next" panels
   * are bg-accent/50, the 10px pill badges and the wallet-guide code chips are
   * a full bg-accent, NetworkBadge regtest is bg-muted, and BroadcastStep sets
   * muted copy over its bg-destructive/10 failure block. bg-destructive/10 is
   * the darkest of them and therefore the one that sets the alpha.
   */
  const surfaces: [string, () => RGB][] = [
    ['the bare glass card', cardSurface],
    ['a bg-accent/50 info panel', () => tint('accent', 50)],
    ['a full bg-accent pill badge', () => parseColor(readToken('accent')).rgb],
    ['a bg-muted regtest badge', () => parseColor(readToken('muted')).rgb],
    ['a code block', () => parseColor(readToken('code-bg')).rgb],
    ['bg-destructive/10 failure copy', () => tint('destructive', 10)],
    ['a bg-primary/10 selected fee preset', () => tint('primary', 10)],
  ]

  it.each(surfaces)('clears WCAG AA on %s', (_name, surface) => {
    const bg = surface()
    expect(contrastRatio(inkOn('muted-foreground', bg), bg)).toBeGreaterThanOrEqual(AA)
  })
})

describe('the bright tokens stay fills, which is why the -text pairs exist', () => {
  /*
   * Each of these is doing a non-text job: banner tints, card borders, and the
   * decorative aria-hidden icons that sit beside the copy. Flattening one to
   * make it readable would cost the signal the colour carries, so the split is
   * deliberate.
   *
   * If one of these ever fails, that token became readable on its own tint and
   * the pair could be collapsed back into a single token.
   */
  it.each(['destructive', 'success', 'primary', 'warning'])(
    '--%s is not readable as body copy on its own tint',
    (token) => {
      const bg = tint(token, 10)
      expect(contrastRatio(inkOn(token, bg), bg)).toBeLessThan(AA)
    }
  )
})
