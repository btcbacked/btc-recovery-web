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

/**
 * Every colour the `background` gradient of a rule in styles.css can paint.
 *
 * Read from the rule rather than a token because the button gradient is not a
 * token: it is written inline in .btn-primary, and a guard that copied its
 * stops here would go stale the moment someone retuned the orange.
 *
 * The declared stops are sampled pairwise rather than measured on their own.
 * Contrast against a fixed ink is monotonic in backdrop luminance, and
 * luminance is convex along an sRGB segment, so a segment's darkest point is
 * not guaranteed to be one of its endpoints. It happens to be for both
 * gradients here, but asserting on the colours instead of the named stops is
 * the same few lines and does not depend on that staying true.
 */
function gradientColorsOf(selector: string): RGB[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const rule = stylesSource.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  if (!rule?.[1]) throw new Error(`styles.css has no rule ${selector}`)
  const background = rule[1].match(/background:\s*([^;]+);/)
  if (!background?.[1]) throw new Error(`${selector} declares no background`)
  const stops = background[1].match(/rgba?\([^)]*\)|#[0-9a-f]{6}/gi)
  if (!stops || stops.length < 2) throw new Error(`${selector} is not a gradient: ${background[1]}`)

  const rgb = stops.map((stop) => parseColor(stop).rgb)
  return rgb.flatMap((from, i) => {
    const to = rgb[i + 1]
    if (!to) return [from]
    return Array.from(
      { length: 21 },
      (_, step) => from.map((c, k) => Math.round(c + (to[k]! - c) * (step / 20))) as RGB
    )
  })
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

describe('the primary button label is readable on the orange it sits on', () => {
  /*
   * --primary-foreground labels every orange fill in this tool and nothing
   * else: all 19 .btn-primary buttons (Continue, Derive, Sign, Broadcast,
   * Copy) and the StepIndicator's current step. There is no site where it
   * lands on a dark surface, which is why the token itself carries the fix.
   *
   * It shipped as the brand light #f3f3f3 on the brand orange, 2.09:1 at rest
   * and 1.97:1 on hover. These are the only buttons in a tool a customer opens
   * when BTCBacked no longer exists, so an unreadable label here strands them
   * with no support line to call.
   */
  const fills: [name: string, colors: () => RGB[]][] = [
    ['the .btn-primary gradient at rest', () => gradientColorsOf('.btn-primary')],
    [
      'the .btn-primary gradient on hover',
      () => gradientColorsOf('.btn-primary:hover:not(:disabled)'),
    ],
    // :active restates only transform and box-shadow, so the fill under a
    // pressed button is whatever hover already put there.
    ['the StepIndicator current step (bg-primary)', () => [parseColor(readToken('primary')).rgb]],
  ]

  it.each(fills)('clears WCAG AA at every point of %s', (_name, colors) => {
    const worst = colors()
      .map((bg) => ({ bg, ratio: contrastRatio(inkOn('primary-foreground', bg), bg) }))
      .reduce((a, b) => (a.ratio <= b.ratio ? a : b))
    expect(worst.ratio, `worst swatch rgb(${worst.bg})`).toBeGreaterThanOrEqual(AA)
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

/* ---------- the disabled state of the primary button ---------- */

/**
 * Every .btn-primary class list in the app that can actually be disabled, read
 * out of the components instead of copied here.
 *
 * Copying the class list into the test would let the markup and the guard drift
 * apart, which is the same shape of failure this file already exists to catch.
 */
const componentSources = import.meta.glob('./components/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function disableablePrimaryButtons(): [file: string, classes: string][] {
  return Object.entries(componentSources).flatMap(([file, source]) =>
    [...source.matchAll(/['"]([^'"]*\bbtn-primary\b[^'"]*)['"]/g)]
      .map((match) => match[1])
      .filter((classes): classes is string => !!classes && classes.includes('disabled:'))
      .map((classes): [string, string] => [file.replace('./components/', ''), classes])
  )
}

/**
 * Attach the compiled stylesheet to the document, render the button, and read
 * back what the cascade actually settled on.
 *
 * This is the only assertion in this file that resolves a cascade rather than a
 * value, and it has to, because the bug it guards was never about a value: both
 * the gradient and the disabled fill were correct and both were present. Layer
 * order decided between them. Reading either declaration on its own shows
 * nothing wrong.
 *
 * jsdom does honour @layer here, which is what makes this work: given the
 * unfixed stylesheet it reports the gradient, exactly as Chrome does. It does
 * NOT substitute var(), so `background` comes back as the literal
 * `var(--button-primary-disabled-bg)`. Assertions below accept either that or a
 * resolved colour, so implementing var() in jsdom cannot turn this red.
 */
function computedButton(css: string, classes: string, isDisabled: boolean) {
  document.head.replaceChildren()
  document.body.replaceChildren()
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  const button = document.createElement('button')
  button.className = classes
  button.disabled = isDisabled
  document.body.appendChild(button)
  const computed = getComputedStyle(button)
  return {
    background: computed.background,
    backgroundImage: computed.backgroundImage,
    boxShadow: computed.boxShadow,
  }
}

describe('a disabled .btn-primary actually renders disabled', () => {
  /*
   * .btn-primary is unlayered and Tailwind emits disabled:bg-* and
   * disabled:shadow-none into @layer utilities, so for the whole life of the
   * repo every disabled primary button kept the full orange gradient and the
   * full lift shadow. Only disabled:text-* landed, because .btn-primary sets no
   * color. A customer could not tell a dead button from a live one.
   *
   * The fix is .btn-primary:disabled in styles.css. These tests fail against
   * the stylesheet as it shipped.
   */
  const buttons = disableablePrimaryButtons()
  let css: string

  beforeAll(async () => {
    const compiler = await compile(stylesSource, { base: '/', loadStylesheet })
    css = compiler.build(buttons.flatMap(([, classes]) => classes.split(/\s+/)))
  })

  it('finds the buttons it is meant to be guarding', () => {
    expect(buttons.length).toBeGreaterThan(0)
  })

  it.each(buttons)('%s loses the gradient when disabled', (_file, classes) => {
    const off = computedButton(css, classes, true)
    expect(off.backgroundImage).not.toMatch(/gradient/)
    expect(off.background).not.toMatch(/gradient/)
  })

  it.each(buttons)('%s paints the disabled fill when disabled', (_file, classes) => {
    const { rgb } = parseColor(readToken('button-primary-disabled-bg'))
    const { background } = computedButton(css, classes, true)
    expect(
      background.includes('button-primary-disabled-bg') ||
        background.includes(`rgb(${rgb.join(', ')})`),
      `background computed to ${background}`
    ).toBe(true)
  })

  it.each(buttons)('%s loses the lift shadow when disabled', (_file, classes) => {
    expect(computedButton(css, classes, true).boxShadow).toBe('none')
  })

  it.each(buttons)('%s keeps the gradient when enabled', (_file, classes) => {
    // The other half of the guard: a fix that killed the gradient outright
    // would satisfy every assertion above.
    expect(computedButton(css, classes, false).backgroundImage).toMatch(/gradient/)
  })
})

describe('a disabled primary button is legible and reads as not live', () => {
  it('its label clears AA on the fill it sits on', () => {
    /*
     * WCAG 1.4.3 exempts disabled controls, so this is a deliberate choice
     * rather than a rule. These labels are Continue, Derive, Sign, Load JSON
     * and Broadcast: a customer has to be able to read what is blocked to work
     * out how to unblock it, and the grey fill already carries the "off"
     * signal on its own.
     */
    const fill = parseColor(readToken('button-primary-disabled-bg')).rgb
    expect(contrastRatio(inkOn('button-primary-disabled-fg', fill), fill)).toBeGreaterThanOrEqual(
      AA
    )
  })

  it('its fill is grey where a live button is orange', () => {
    /*
     * The two states used to differ only in label colour, on the same orange.
     * Now the fill does the work, so assert that: a live button is strongly
     * chromatic, a dead one is flat grey. Measured as channel spread because
     * that is what "the orange is gone" means numerically.
     */
    const chroma = (color: RGB) => Math.max(...color) - Math.min(...color)
    expect(chroma(parseColor(readToken('button-primary-disabled-bg')).rgb)).toBe(0)
    expect(Math.min(...gradientColorsOf('.btn-primary').map(chroma))).toBeGreaterThan(60)
  })
})

/* ---------- foreground tokens ---------- */

/**
 * `--x-foreground` means "the ink for `--x`". Four of these shipped as the
 * brand light #f3f3f3 over mid-brightness status fills, where they land at
 * 2.12:1 to 4.12:1, and none of them had a single consumer. An unused token
 * that is wrong is worse than no token: it reads as a sanctioned answer, so the
 * first person to reach for one lands the exact defect .btn-primary just had.
 * They are deleted.
 *
 * This guard is stricter than "delete the unused ones" and much simpler: every
 * `--x-foreground` that exists must be readable on `--x`, consumer or not. That
 * needs no consumer census to stay honest, and it fails the moment one of the
 * four is reintroduced.
 *
 * Enumerating from the stylesheet is safe here, unlike SEMANTIC_COLOR_TOKENS
 * above. That list asserts presence, so deriving it would shrink both sides at
 * once. This asserts a measured ratio between two different tokens, so a new
 * token can only add coverage and a deleted one cannot hide a defect.
 */
const FOREGROUND_FILL: Record<string, string> = {
  // The page ink. The surface it names is the page.
  foreground: 'background',
}

function foregroundTokens(): [token: string, fill: string][] {
  const seen = new Set<string>()
  const pairs: [string, string][] = []
  for (const [, token] of stylesSource.matchAll(/^\s*--([\w-]*foreground):/gm)) {
    // Skip the @theme registrations, which alias the tokens below rather than
    // declaring a new colour.
    if (!token || token.startsWith('color-') || seen.has(token)) continue
    seen.add(token)
    pairs.push([token, FOREGROUND_FILL[token] ?? token.replace(/-foreground$/, '')])
  }
  return pairs
}

describe('every -foreground token is readable on the fill it names', () => {
  const pairs = foregroundTokens()

  it('finds the tokens it is meant to be guarding', () => {
    expect(pairs.length).toBeGreaterThan(0)
  })

  // readToken throws if the fill does not exist, so a --x-foreground without an
  // --x fails here rather than passing quietly.
  it.each(pairs)('--%s clears AA on --%s', (token, fill) => {
    const bg = parseColor(readToken(fill)).rgb
    expect(contrastRatio(inkOn(token, bg), bg)).toBeGreaterThanOrEqual(AA)
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

/* ---------- the numbered step list ---------- */

/**
 * THIS GUARDS THE RULE, NOT THE RENDER. Say so plainly, because the distinction
 * is the whole reason the defect below shipped and stayed shipped.
 *
 * jsdom has no layout engine. It will happily report `display: flex` on an <li>
 * and has no opinion at all about where the boxes land, so no assertion in this
 * repo can see a sentence broken into columns. A true layout guard would need a
 * real browser and a bounding box check. What is available here is the
 * stylesheet as text, and the defect was entirely expressible in it.
 *
 * THE DEFECT: `.step-list-item { display: flex }`. An <li> set to flex makes
 * every child its own flex ITEM, so each <strong> became a box and each run of
 * text between them became an anonymous box. Every numbered step in all three
 * wallet guide tabs, wherever it named a control in bold, was laid out as
 * ragged side by side columns instead of a sentence, and the Bitcoin Core
 * <code> command blocks sat beside their prose rather than beneath it.
 *
 * Measured: the ENTIRE `.step-list-item` rule can be deleted and the full suite
 * still passes. Nothing else in 28 files touches it.
 */
describe('the numbered step list flows as a sentence, not as columns', () => {
  /**
   * The declarations inside one rule of styles.css, with comments stripped.
   *
   * Stripping matters: these rules are heavily commented, and the comments name
   * the very properties being asserted absent. A prose mention of `margin-top`
   * explaining why there is no margin-top would otherwise fail the test.
   */
  function ruleBody(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    const rule = stylesSource.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'))
    if (!rule?.[1]) throw new Error(`styles.css has no rule ${selector}`)
    return rule[1].replace(/\/\*[\s\S]*?\*\//g, '')
  }

  it('finds the rules it is meant to be guarding', () => {
    // Both negatives below are satisfied by a rule that does not exist, so the
    // rules have to be proven present by something they positively declare.
    expect(ruleBody('.step-list-item')).toMatch(/counter-increment:\s*step-counter/)
    expect(ruleBody('.step-list-item::before')).toMatch(/content:\s*counter\(step-counter\)/)
  })

  it('the list item is not a flex container', () => {
    const body = ruleBody('.step-list-item')

    // The negative, and its positive partner: the item is not flex BECAUSE it
    // is a positioned block reserving room for the number on its left. Without
    // the positive half, deleting the whole rule satisfies this test.
    expect(body).not.toMatch(/display:\s*flex/)
    expect(body).toMatch(/position:\s*relative/)
    expect(body).toMatch(/padding:[^;]*\b30px\b/)
  })

  it('the negative assertion above is still capable of failing', () => {
    // The live control. `not.toMatch` passes against an empty string, a renamed
    // class or a moved rule, so the pattern itself is exercised against text
    // that must match. This repo has 152 negative string assertions and 15 of
    // them already match nothing at all.
    expect('  display: flex;').toMatch(/display:\s*flex/)
  })

  it('the number is lifted out of the text flow', () => {
    const before = ruleBody('.step-list-item::before')

    expect(before).toMatch(/position:\s*absolute/)
    expect(before).toMatch(/left:\s*0/)

    // `margin-top` was a nudge against `align-items: baseline`. Against an
    // absolute `top` it double counts, and the number sits low.
    expect(before).not.toMatch(/margin-top/)

    // `flex-shrink` only means anything to a flex child, which this no longer
    // is. Left in place it reads as load bearing and is a no-op.
    expect(before).not.toMatch(/flex-shrink/)
  })

  it('one top value can serve both lists, because the line height is pinned', () => {
    // `WalletGuideStep` items carry text-sm (a 20px line box); the
    // `ExportPsbtStep` list inherits text-xs (16px). An absolutely positioned
    // circle cannot align in both unless the first line box is the same height
    // in both, so the item pins it to the circle's own 20px.
    const item = ruleBody('.step-list-item')
    const before = ruleBody('.step-list-item::before')

    const lineHeight = item.match(/line-height:\s*(\d+)px/)?.[1]
    const circleHeight = before.match(/height:\s*(\d+)px/)?.[1]
    expect(lineHeight).toBeDefined()
    expect(circleHeight).toBe(lineHeight)

    // And the circle starts level with the first line, so `top` has to equal
    // the padding the item puts above that line.
    const paddingTop = item.match(/padding:\s*(\d+)px/)?.[1]
    const top = before.match(/top:\s*(\d+)px/)?.[1]
    expect(top).toBeDefined()
    expect(top).toBe(paddingTop)
  })
})
