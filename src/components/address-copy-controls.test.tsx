/**
 * The copy control that sits next to an address is an icon, not a call to
 * action.
 *
 * WHY THIS FILE EXISTS. Reverting any one of these sites to the full orange
 * `btn-primary` button used to break nothing at all. Only `ReviewSignStep` was
 * pinned, by its own test file, so the other four could be changed back
 * silently. This pins the remaining four.
 *
 * WHY IT MATTERS AND IS NOT DECORATION. A full button beside a 62 character
 * address is wider than the address can spare. On the outputs table at 320px
 * it took the change row's address down to 66px, about 9 characters per line
 * over 7 lines. The icon is 16px, and the same row reads at 128px. This is a
 * legibility property of a screen a customer uses to check where their Bitcoin
 * is going, not a styling preference.
 *
 * The named, deliberate copy actions are deliberately NOT covered here and
 * must stay full buttons: "Copy PSBT", "Copy TXID", "Copy Escrow File",
 * "Copy Signing File" and the wallet guide's file button. The guard at the
 * bottom pins that split, so converting them all wholesale fails too.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Buffer } from 'buffer'
import { EscrowSummary } from '@/components/EscrowSummary'
import { ActionChoiceStep } from '@/components/steps/ActionChoiceStep'
import { WalletViewStep } from '@/components/steps/WalletViewStep'
import { ReviewPsbtStep } from '@/components/steps/ReviewPsbtStep'
import { ResultStep } from '@/components/steps/ResultStep'
import type { PsbtAnalysis } from '@/crypto/psbt-finalizer'
import type { ParsedDescriptor } from '@/crypto/descriptor-parser'

const ADDRESS = 'bcrt1qw3kf7v9x2ta5m0dqs8h4jn6ce2ua7lgzp5ry9x8gf2tvdw0s3jn54khcm'

/**
 * WalletViewStep hands the whole screen to a refusal branch when this is null,
 * and then renders no address at all. Only its nullness is read, never its
 * contents, so this is the smallest value that lets the ordinary screen draw.
 */
const DESCRIPTOR: ParsedDescriptor = {
  scriptType: 'wsh',
  multisigType: 'sortedmulti',
  threshold: 2,
  keys: [],
  raw: 'wsh(sortedmulti(2,A,B,C))',
}

afterEach(() => {
  cleanup()
})

/**
 * The copy control standing next to the address cell, found through the cell
 * rather than by position, so this cannot drift onto some other button.
 */
function copyControlBesideAddress(): HTMLElement {
  const cell = Array.from(document.querySelectorAll('code')).find(
    (el) => el.textContent === ADDRESS,
  )
  if (!cell) throw new Error('no element renders the address in full')
  const group = cell.parentElement!
  const button = group.querySelector('button')
  if (!button) throw new Error('the address has no copy control beside it')
  return button
}

/** Tailwind's spacing scale: one step is 0.25rem, which is 4 CSS pixels. */
const TAILWIND_STEP_PX = 4

/** The smallest comfortable target Apple's guidelines ask for, in pixels. */
const MIN_TARGET_PX = 44

/**
 * The hit box the control offers a finger, in CSS pixels, computed from what
 * it actually renders: the glyph's own sizing class plus the padding on each
 * side of it. Every number in the result comes off the component.
 */
function targetSizePx(button: HTMLElement): number {
  const padding = button.className.split(/\s+/).find((c) => /^p-[\d.]+$/.test(c))
  if (!padding) throw new Error(`the control carries no padding: ${button.className}`)
  const svg = button.querySelector('svg')
  if (!svg) throw new Error('the control draws no icon to measure')
  const glyph = Array.from(svg.classList).find((c) => /^h-[\d.]+$/.test(c))
  if (!glyph) throw new Error(`the icon carries no height class: ${svg.getAttribute('class')}`)
  const glyphPx = Number(glyph.slice('h-'.length)) * TAILWIND_STEP_PX
  const paddingPx = Number(padding.slice('p-'.length)) * TAILWIND_STEP_PX
  return glyphPx + paddingPx * 2
}

/**
 * The width the control claims beside the address, which is the whole point of
 * it being an icon.
 *
 * This replaces a pair of assertions that read `not.toContain('px-5')` and
 * `not.toContain('px-3')`. Those pin a padding value, and padding is not what
 * this file means. The control now carries padding deliberately, to grow a
 * cramped 16px target to 44px for a one handed customer under stress, and a
 * blanket padding ban would have failed that for the wrong reason. What has to
 * hold is that the padding is handed straight back as a negative margin of the
 * same step, so the address cell keeps every pixel it had. Measured at 320px on
 * the outputs table: the change row's address is 131.22px wide with the padding
 * and was 131.22px without it, and the glyph did not move.
 *
 * Both halves are asserted. Padding with no offset steals width from an address
 * that has none to spare; no padding at all is back to the 16px target.
 */
function expectClaimsNoExtraWidth(button: HTMLElement) {
  const classes = button.className.split(/\s+/)
  const padding = classes.find((c) => /^p-[\d.]+$/.test(c))
  const offset = classes.find((c) => /^-m-[\d.]+$/.test(c))

  expect(
    padding,
    `the control carries no padding, so its target is still the bare glyph: ${button.className}`,
  ).toBeDefined()
  expect(
    offset,
    `the control pads without an offsetting negative margin, so it takes width from the address: ${button.className}`,
  ).toBeDefined()
  expect(offset!.replace('-m-', '')).toBe(padding!.replace('p-', ''))

  /*
   * And how big the padding makes it, which the matching pair above does not
   * say. `-m-1 p-1` matches, claims no extra width, and offers a 24px target,
   * which is within 8px of the bare 16px glyph the padding exists to grow.
   */
  expect(
    targetSizePx(button),
    `the padded target is ${targetSizePx(button)}px: ${button.className}`,
  ).toBeGreaterThanOrEqual(MIN_TARGET_PX)
}

/** What every one of these controls has to be. */
function expectIconOnly(button: HTMLElement, name: string) {
  // Positive partners first: the control exists, draws an icon, and is named.
  // If it stopped rendering the negative assertions could not fail.
  expect(button.querySelector('svg')).toBeTruthy()
  expect(button.getAttribute('aria-label')).toBe(name)
  expect(button.className).toContain('text-muted-foreground')

  // No visible text, so the accessible name above is the only name it has.
  expect(button.textContent).toBe('')
  // None of the call to action styling.
  expect(button.className).not.toContain('btn-primary')
  expect(button.className).not.toContain('btn-outline')
  expectClaimsNoExtraWidth(button)

  /*
   * And it aligns the same way on every one of these screens. The row holding
   * the address and this control tops them out together, so beside a wrapped
   * three or four line address the icon stays level with the first line instead
   * of floating in the middle of the block. Four of the five screens used to
   * centre it and only the Choose screen did not, which is why the same control
   * looked different depending on where a customer met it.
   */
  expect(button.parentElement!.className.split(/\s+/)).toContain('items-start')
}

describe('the copy control beside an address is an icon', () => {
  it('on the escrow summary panel', () => {
    render(
      <EscrowSummary
        address={ADDRESS}
        balance={250_000}
        depositCount={1}
        isLoading={false}
        error={null}
        isStandardDerivation
        onLoad={vi.fn()}
      />,
    )
    expectIconOnly(copyControlBesideAddress(), 'Copy escrow address')
  })

  it('on the Choose screen', () => {
    render(
      <ActionChoiceStep
        escrowAddress={ADDRESS}
        network="regtest"
        customEndpoint="http://localhost:8999/api"
        needsCustomEndpoint={false}
        balance={0}
        isLoadingBalance={false}
        balanceError={null}
        balanceChecked
        onLoadBalance={vi.fn()}
        onCustomEndpointChange={vi.fn()}
        onCreateTransaction={vi.fn()}
        onSignExisting={vi.fn()}
        onImportWallet={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expectIconOnly(copyControlBesideAddress(), 'Copy escrow address')
  })

  it('on the wallet view', () => {
    render(
      <WalletViewStep
        parsedDescriptor={DESCRIPTOR}
        addresses={[
          { index: 0, address: ADDRESS, witnessScript: Buffer.alloc(0), publicKeys: [] },
        ]}
        utxos={[]}
        balance={250_000}
        isLoading={false}
        error={null}
        cannotDeriveEscrow={false}
        onLoadWallet={vi.fn()}
        onCreateTransaction={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expectIconOnly(copyControlBesideAddress(), 'Copy escrow address')
  })

  it('on the imported PSBT review, per output', () => {
    const outputs: PsbtAnalysis['outputs'] = [{ address: ADDRESS, value: 250_000, isChange: false }]
    render(
      <ReviewPsbtStep
        analysis={{
          inputCount: 1,
          outputCount: 1,
          totalInputValue: 251_000,
          totalOutputValue: 250_000,
          fee: 1_000,
          feeRate: 2,
          outputs,
          inputValues: [251_000],
          signatureCount: [1],
          isFullySigned: false,
          requiredSignatures: 2,
        }}
        onSign={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expectIconOnly(copyControlBesideAddress(), 'Copy destination address, output 1 of 1')
  })
})

describe('a named copy action is still a full button', () => {
  /**
   * The other half, and the reason the tests above cannot be satisfied by
   * turning every copy control in the app into an icon. This one is a named
   * action a customer is told to take, not an adornment on an address, so it
   * keeps its visible label and its call to action styling.
   */
  it('keeps the visible label and the call to action styling on Copy Signing File', () => {
    render(<ResultStep descriptor="wsh(sortedmulti(2,A,B,C))" onContinue={vi.fn()} />)

    const button = screen.getByRole('button', { name: /Copy Signing File/i })
    // Positive partners: it is there, it says what it does, and it is styled
    // as the action it is.
    expect(button.textContent).toContain('Copy Signing File')
    expect(button.className).toContain('btn-primary')
    expect(button.className).toContain('px-5')
    // And it is NOT the icon treatment.
    expect(button.className).not.toContain('text-muted-foreground')
  })
})
