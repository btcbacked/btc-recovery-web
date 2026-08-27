/**
 * The copied feedback on CopyButton, and the target it offers a finger.
 *
 * WHY THIS FILE EXISTS. Nothing pinned any of it. Replacing the icon variant's
 * `copied ? <Check/> : <Copy/>` with an unconditional <Copy/> left the whole
 * suite green, and so did every one of the four defects closed below.
 *
 * WHY IT MATTERS. This control sits beside a Bitcoin address on the screens a
 * customer reads immediately before an irreversible signature. The icon variant
 * carries no visible "Copied!" text and the opacity cue is deliberately
 * suppressed for it, so the icon swap and the toast are its only two feedback
 * channels.
 *
 * WHICH CHANNEL IS PINNED, AND WHY IT CHANGED. This file used to read a hidden
 * aria-live region rendered inside the button. That region is gone. Two
 * separate problems put it there: the app's own toast already announced the
 * same words through its own live region, so Chrome's accessibility tree held
 * "Copied to clipboard" twice after a single click, and a live region nested
 * inside a button is unreliable in real assistive technology anyway, because a
 * button's children are presentational. So these tests were not deleted, they
 * were repointed at the toast, which is a proper live region outside the button
 * and demonstrably works. The assertions below read it through its aria-live
 * attribute and prove the announcement lands exactly once.
 *
 * The icon identity is read off lucide's own class (`lucide-copy` against
 * `lucide-check`) rather than off anything this file supplies, so the swap has
 * to actually happen in the component for these to pass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { Toaster } from 'sonner'
import { CopyButton } from './CopyButton'

/** What the control copies. Never the thing any assertion below reads back. */
const PAYLOAD = 'bcrt1qw3kf7v9x2ta5m0dqs8h4jn6ce2ua7lgzp5ry9x8gf2tvdw0s3jn54khcm'

/** The announcement, written out by hand rather than imported from anywhere. */
const ANNOUNCEMENT = 'Copied to clipboard'

const writeText = vi.fn()

/**
 * Every region on the page a screen reader is watching, found by the aria-live
 * attribute that is what makes a region an announcement at all: an element
 * holding the same words without it announces nothing.
 */
function liveRegions(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-live]'))
}

/** The regions currently holding the copied announcement. */
function announcingRegions(): HTMLElement[] {
  return liveRegions().filter((r) => (r.textContent ?? '').includes(ANNOUNCEMENT))
}

/**
 * The one region saying it, insisting there is exactly one. Two would mean a
 * screen reader hears the confirmation twice, which is what the region inside
 * the button caused; none would mean nothing was announced at all.
 */
function soleAnnouncingRegion(): HTMLElement {
  const found = announcingRegions()
  if (found.length !== 1) {
    throw new Error(`${found.length} live regions announce the copy, expected exactly 1`)
  }
  return found[0]!
}

/** The single icon the control draws. */
function icon(button: HTMLElement): SVGElement {
  const svgs = button.querySelectorAll('svg')
  if (svgs.length !== 1) throw new Error(`the control draws ${svgs.length} icons, expected 1`)
  return svgs[0] as SVGElement
}

/** Tailwind's spacing scale: one step is 0.25rem, which is 4 CSS pixels. */
const TAILWIND_STEP_PX = 4

/** The smallest comfortable target Apple's guidelines ask for, in pixels. */
const MIN_TARGET_PX = 44

/**
 * The hit box the control offers a finger, in CSS pixels, computed from what
 * it actually renders: the glyph's own sizing class plus the padding on each
 * side of it. Every number in the result comes off the component, so shrinking
 * either one there moves this.
 */
function targetSizePx(button: HTMLElement): number {
  const padding = button.className.split(/\s+/).find((c) => /^p-[\d.]+$/.test(c))
  if (!padding) throw new Error(`the control carries no padding: ${button.className}`)
  const glyph = Array.from(icon(button).classList).find((c) => /^h-[\d.]+$/.test(c))
  if (!glyph) {
    throw new Error(`the icon carries no height class: ${icon(button).getAttribute('class')}`)
  }
  const glyphPx = Number(glyph.slice('h-'.length)) * TAILWIND_STEP_PX
  const paddingPx = Number(padding.slice('p-'.length)) * TAILWIND_STEP_PX
  return glyphPx + paddingPx * 2
}

/** The control with the app's toast mounted beside it, as the app mounts it. */
function renderWithToast(ui: React.ReactElement) {
  return render(
    <>
      {ui}
      <Toaster position="top-center" richColors />
    </>,
  )
}

beforeEach(() => {
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  cleanup()
})

describe('CopyButton announces the copy into a live region', () => {
  it('on the button variant, through the toast and not from inside the button', async () => {
    renderWithToast(<CopyButton text={PAYLOAD} label="Copy PSBT" />)
    const button = screen.getByRole('button', { name: 'Copy PSBT' })

    // Positive partner: a live region is mounted and is silent before the
    // click, so the assertions below cannot pass on a region that never
    // existed or on one that was already saying the words.
    expect(liveRegions().length).toBeGreaterThan(0)
    expect(announcingRegions()).toHaveLength(0)

    fireEvent.click(button)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(announcingRegions()).toHaveLength(1))

    // Exactly one region says it, which soleAnnouncingRegion insists on.
    const region = soleAnnouncingRegion()
    expect(region.getAttribute('aria-live')).toBe('polite')
    // And it is outside the control, where assistive technology reads it.
    expect(button.contains(region)).toBe(false)
  })

  it('on the icon variant, which has no visible text to fall back on', async () => {
    renderWithToast(<CopyButton text={PAYLOAD} variant="icon" ariaLabel="Copy escrow address" />)
    const button = screen.getByRole('button', { name: 'Copy escrow address' })

    // Positive partners: a silent live region is mounted, and this variant
    // really does render no visible words of its own.
    expect(liveRegions().length).toBeGreaterThan(0)
    expect(announcingRegions()).toHaveLength(0)
    expect(button.textContent).toBe('')

    fireEvent.click(button)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(announcingRegions()).toHaveLength(1))

    const region = soleAnnouncingRegion()
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(button.contains(region)).toBe(false)
    // The control itself still says nothing, so the announcement above is the
    // only thing that spoke and it did not come from the button.
    expect(button.textContent).toBe('')
  })
})

describe('CopyButton shows the copy landed', () => {
  it('swaps the copy icon for a tick on the icon variant', async () => {
    render(<CopyButton text={PAYLOAD} variant="icon" ariaLabel="Copy escrow address" />)
    const button = screen.getByRole('button', { name: 'Copy escrow address' })

    // Positive partner: an icon is drawn at rest, and it is the copy icon.
    const before = icon(button)
    expect(before.classList.contains('lucide-copy')).toBe(true)
    expect(before.classList.contains('lucide-check')).toBe(false)

    fireEvent.click(button)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))

    // After: still exactly one icon, so this cannot pass by the icon
    // disappearing, and that icon is now the tick.
    await waitFor(() => expect(icon(button).classList.contains('lucide-check')).toBe(true))
    expect(icon(button).classList.contains('lucide-copy')).toBe(false)
  })

  it('swaps the icon and the visible label on the button variant', async () => {
    render(<CopyButton text={PAYLOAD} label="Copy PSBT" />)
    const button = screen.getByRole('button', { name: 'Copy PSBT' })

    // Positive partners: the label and the copy icon are both there at rest.
    expect(button.textContent).toContain('Copy PSBT')
    expect(icon(button).classList.contains('lucide-copy')).toBe(true)

    fireEvent.click(button)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))

    await waitFor(() => expect(icon(button).classList.contains('lucide-check')).toBe(true))
    expect(icon(button).classList.contains('lucide-copy')).toBe(false)
    // The visible label turns over too, and the resting label is gone.
    expect(button.textContent).toContain('Copied!')
    expect(button.textContent).not.toContain('Copy PSBT')
  })
})

describe('CopyButton restarts the two seconds on a second click', () => {
  /**
   * The defect this pins. The revert used to be scheduled like this:
   *
   *   setCopied(true)
   *   const timer = setTimeout(() => { ... setCopied(false) }, 2000)
   *   return () => clearTimeout(timer)
   *
   * That return value reads as cleanup and is not one. It is an onClick's
   * return value, and React never calls it, so nothing ever cleared the timer.
   * Two clicks left two timers running and the FIRST one still reverted the
   * tick two seconds after the FIRST click. Clicking again at 1.5s therefore
   * put the tick back 0.5s later instead of 2s later. Customers double tap this
   * control when they are unsure it worked, so the case the bug got wrong is
   * the case it is most often in.
   */
  it('does not let the first click revert the second click early', async () => {
    vi.useFakeTimers()
    try {
      render(<CopyButton text={PAYLOAD} variant="icon" ariaLabel="Copy escrow address" />)
      const button = screen.getByRole('button', { name: 'Copy escrow address' })

      // First click at t=0.
      fireEvent.click(button)
      await act(async () => {})
      expect(icon(button).classList.contains('lucide-check')).toBe(true)

      // t=1500. Still ticked, and the first click's revert has not fired yet.
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
      expect(icon(button).classList.contains('lucide-check')).toBe(true)

      // Second click at t=1500. The control really did copy again, so this
      // cannot pass by the second click being swallowed.
      fireEvent.click(button)
      await act(async () => {})
      expect(writeText).toHaveBeenCalledTimes(2)
      expect(icon(button).classList.contains('lucide-check')).toBe(true)

      // t=3400. That is 1900ms after the second click, and 1400ms after the
      // moment the first click's orphaned timer used to fire. The tick has to
      // still be there: the second click bought a fresh two seconds.
      await act(async () => {
        vi.advanceTimersByTime(1900)
      })
      expect(icon(button).classList.contains('lucide-check')).toBe(true)

      // t=3600, just past two seconds after the second click. Now it reverts,
      // so this cannot pass by the tick simply never going away.
      await act(async () => {
        vi.advanceTimersByTime(200)
      })
      expect(icon(button).classList.contains('lucide-copy')).toBe(true)
      expect(icon(button).classList.contains('lucide-check')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * WHY THIS TEST WAS REWRITTEN. It used to unmount, run the clock forward,
   * and assert that a `window` error listener had not fired. React removed the
   * setState-on-unmounted-component warning in 18, and 19 does not warn
   * either, so a timer surviving the unmount would raise nothing and that
   * listener could never be called. The assertion was unfalsifiable: emptying
   * the component's cleanup left it passing, along with the rest of the suite.
   *
   * It now reads the pending timer itself, which is the thing the cleanup
   * exists to cancel and the only observable this component leaves behind.
   */
  it('clears the pending revert when the control unmounts', async () => {
    vi.useFakeTimers()
    try {
      const view = render(
        <CopyButton text={PAYLOAD} variant="icon" ariaLabel="Copy escrow address" />,
      )
      const button = screen.getByRole('button', { name: 'Copy escrow address' })

      fireEvent.click(button)
      await act(async () => {})

      // Positive partners: the click really ticked, and it really left a
      // revert scheduled. Without these the count after the unmount would also
      // read zero on a control that never scheduled anything.
      expect(icon(button).classList.contains('lucide-check')).toBe(true)
      expect(vi.getTimerCount()).toBe(1)

      // Unmount with that revert still pending.
      view.unmount()

      // The cleanup cancelled it, rather than leaving it to fire into a
      // component that is gone.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('CopyButton gives the icon variant a real target and the app focus ring', () => {
  /**
   * Measured at 16 by 16 pixels at every width on all five screens that carry
   * this control. Apple asks 44, Material 48, WCAG 2.5.8 asks 24. It cleared
   * WCAG only through the spacing exception, the nearest control being 109px
   * away on a phone, so this was ergonomics rather than a conformance failure,
   * on a control used one handed under stress.
   *
   * The fix is the idiom this codebase already uses twice, at AppLayout's logo
   * button and PasswordStep's reveal toggle: padding to grow the target, and a
   * negative margin of the same step to hand the width straight back. Measured
   * after the change, at 320px on the outputs table: the button's hit box is
   * 44 by 44, the glyph is still 16 by 16 and has not moved, and the change
   * row's address cell is 131.22px wide both before and after.
   */
  it('pads the target to 44px and gives the width back, so the address loses nothing', () => {
    render(<CopyButton text={PAYLOAD} variant="icon" ariaLabel="Copy escrow address" />)
    const button = screen.getByRole('button', { name: 'Copy escrow address' })
    const classes = button.className.split(/\s+/)

    const padding = classes.find((c) => /^p-[\d.]+$/.test(c))
    const offset = classes.find((c) => /^-m-[\d.]+$/.test(c))

    // Padding has to be there, or the target is back to the bare 16px glyph.
    expect(padding, `no padding, so the target is still the bare glyph: ${button.className}`).toBeDefined()
    // And it has to be handed back, or the control steals width from an
    // address that has none to spare.
    expect(offset, `padding with no offsetting negative margin: ${button.className}`).toBeDefined()
    expect(offset!.replace('-m-', '')).toBe(padding!.replace('p-', ''))

    /*
     * How big the padding actually makes it, which none of the above says.
     * A matching pair proves the layout is unchanged and nothing more: `-m-1
     * p-1` satisfies every assertion above and hands back a 24px target, which
     * is within 8px of the 16px glyph this class list exists to grow. 44 is
     * the number the docblock measured in Chrome and the number Apple asks
     * for, so it is the floor rather than the exact figure: padding this
     * control further is not a regression, and taking it away is.
     */
    expect(
      targetSizePx(button),
      `the padded target is ${targetSizePx(button)}px: ${button.className}`,
    ).toBeGreaterThanOrEqual(MIN_TARGET_PX)

    // And the padding is what grew it. Growing the glyph would reach the same
    // number and take back the width the negative margin just handed over.
    const glyphClasses = Array.from(icon(button).classList)
    expect(glyphClasses).toContain('h-4')
    expect(glyphClasses).toContain('w-4')
  })

  it('draws the app focus ring rather than the browser default', () => {
    render(<CopyButton text={PAYLOAD} variant="icon" ariaLabel="Copy escrow address" />)
    const button = screen.getByRole('button', { name: 'Copy escrow address' })
    const classes = button.className.split(/\s+/)

    /*
     * Measured before this was added: Chrome's stock `outline: auto 1px
     * rgb(0, 95, 204)` at offset 0, hugging a 16px glyph. Measured after: the
     * brand ring, `solid 2px rgb(254, 121, 33)` at offset 2px. These are the
     * exact classes the sibling controls in PasswordStep and AppLayout use,
     * less the bare `focus-visible:outline` those two also carry, which `cn`
     * drops as superseded by the width and which Tailwind v4 does not need.
     */
    expect(classes).toContain('focus-visible:outline-2')
    expect(classes).toContain('focus-visible:outline-offset-2')
    expect(classes).toContain('focus-visible:outline-ring')
  })
})
